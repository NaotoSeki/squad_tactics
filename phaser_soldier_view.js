/**
 * phaser_soldier_view.js -- WS-G+: 19モーション実スプライト統合（sim_battle.html 専用）
 *
 * UnitView (phaser_unit.js) のサブクラス。phaser_unit.js は buildInfantrySprite /
 * updateInfantryAnim の2フックを持つ純粋抽出リファクタのみで、凍結ビルド
 * (index.html / phaser_bridge.js) の挙動は不変。本ファイルは sim_battle.html
 * だけが読み込む（Strangler Fig）。
 *
 * アセット: asset/sprites/soldier/<action>.png + manifest.json
 * （scripts/repack_soldier_sheets.py が生成。8方向 dir-major 連番、
 *   フレーム index = dir * frames + f）
 *
 * 状態マッピング（sim_core の snapshot を u._sim で受ける）:
 *   姿勢:  pinned || sup>=PINNED_AT → prone / suppressed || sup>=SUPPRESSED_AT → kneel / else stand
 *   動作:  移動中 → forward / engage → fire / else idle
 *   方向:  移動ベクトル > SHOT イベントの射線 > sim の facing
 *   死亡:  DOWN イベントで scene が spawnCorpse() → dying を一回再生し最終フレームで残置
 *   手榴弾: GRENADE イベントで playThrow() → throw_grenade を一回再生（one-shot 優先）
 *
 * manifest のベイク済み action 遷移クリップ（trans_<from>__<to>）を優先し、無い組合せは
 * ゴーストクロスフェードで補間。表示方向は45°ずつ回頭し、個体別の位相・速度差で同期感を抑える。
 */

// ロードする 19 アクション（姿勢遷移 4 種を含む）。manifest 取得成功時は
// loadSoldierManifest がキー一覧で上書きする（遷移クリップ等の増分を自動追従）
window.SOLDIER_LOAD_ACTIONS = [
    'stand_idle', 'stand_forward', 'stand_fire', 'stand_dying', 'stand_throw_grenade',
    'kneel_idle', 'kneel_forward', 'kneel_fire', 'kneel_dying', 'kneel_throw_grenade',
    'prone_idle', 'prone_forward', 'prone_fire', 'prone_dying', 'prone_throw_grenade',
    'stand_to_kneel', 'kneel_to_stand', 'kneel_to_prone', 'prone_to_kneel',
];

// 姿勢レベル: 0=stand, 1=kneel, 2=prone
const POSTURE_NAMES = ['stand', 'kneel', 'prone'];
// ターン制本編の u.stance（姿勢メニュー）→ 姿勢レベル。crouch は kneel 表示
const STANCE_LEVEL = { stand: 0, crouch: 1, prone: 2 };
const POSTURE_TRANS = { '0>1': 'stand_to_kneel', '1>0': 'kneel_to_stand', '1>2': 'kneel_to_prone', '2>1': 'prone_to_kneel' };
const UNDER_FIRE_T = 75;   // 被弾判定の持続 tick（撃たれたら身を低くする）
const POSTURE_HOLD_T = 50; // 姿勢を上げ直すまでの最低保持 tick（ピクつき防止）
const COVER_LEAN_MIN = 0.3; // この遮蔽値(0..1)以上で「遮蔽中」とみなす（縁寄せ＋cover_fire 変種）
const COVER_LEAN_PX = 2.5;  // 遮蔽射撃時に射線方向へ身を乗り出すオフセット（表示20px基準）

// 画面上の兵士の見かけ高さ（px）。2026-07-13、建物との比較が「デカすぎる」との
// 指摘を受け実測ベースで再算出: bldg_s2_d0(3階建、生成コードのRNGを複製し
// 実世界高さ11.93mと確定)の描画ピクセル高さ(298px, source 576x768空間)から
// 垂直投影係数 24.98px/m を逆算。兵士の実身長1.75mを同係数で換算すると
// ゲーム画面(HEX_SIZE=54)で約9.2px — が、これは視認性が壊れるほど小さい
// (スプライト詳細が潰れる)ため、伝統的なウォーゲームの可読性ブースト(~2倍)を
// 適用し20pxに設定。旧38pxは物理比の約4倍でオーバースケールだった。
// window.SOLDIER_VIEW_H で実行時上書き可。
const SOLDIER_VIEW_H = 20;

/**
 * 画面座標デルタ → シートの方向行。y は下向き正。
 * manifest.dirOrder が正本: row 0..7 = S,SE,E,NE,N,NW,W,SW。
 * 以前は古い検分メモを優先して左右反転しており、射撃時に反対方向を向いていた。
 */
function soldierDirFromDelta(dx, dy) {
    if (!dx && !dy) return 0;
    let k = Math.round(Math.atan2(-dy, dx) / (Math.PI / 4)) + 2; // E=2 基準（S,SE,E,...順）
    k %= 8; if (k < 0) k += 8;
    return k;
}

/** sim の facing {q,r}（軸座標ベクトル）→ 方向行。hexToPx と同じ射影。 */
function soldierDirFromFacing(f) {
    if (!f) return 0;
    const dx = Math.sqrt(3) * (f.q + f.r / 2);
    const dy = 1.5 * f.r;
    return soldierDirFromDelta(dx, dy);
}

/** 個体別アニメ速度・位相用の単純な安定ハッシュ。 */
function soldierAnimHash(id) {
    const str = String(id == null ? '' : id);
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h + str.charCodeAt(i) * 31) >>> 0;
    return h;
}

class SoldierUnitView extends UnitView {
    constructor(scene, unitLayer, hpLayer) {
        super(scene, unitLayer, hpLayer); // defineAnimations() はこの中で呼ばれる
        this._faceDir = new Map();   // soldierId -> 直近の射線方向（SHOT イベント由来）
        this._oneShot = new Map();   // soldierId -> { key, started } 一回性アニメ
        this._underFire = new Map(); // soldierId -> 最後に撃たれた tick
        this._corpses = [];
    }

    static manifestReady() {
        const man = window.SOLDIER_MANIFEST;
        return !!(man && man.actions && man.version >= 2 && man.charH > 0);
    }

    /** 表示スケール（立ち身長 SOLDIER_VIEW_H px に正規化）。window.SOLDIER_VIEW_H でライブ調整可 */
    static displayScale() {
        return (window.SOLDIER_VIEW_H || SOLDIER_VIEW_H) / window.SOLDIER_MANIFEST.charH;
    }

    /**
     * 疑似tick（25Hz相当）。RTwP(sim_battle)では sim の実tick、
     * ターン制本編(index.html)では scene.time から合成する。
     */
    _now() {
        if (this.scene.sim && this.scene.sim._tick != null) return this.scene.sim._tick;
        return Math.floor(this.scene.time.now / 40);
    }

    defineAnimations() {
        super.defineAnimations();
        const man = window.SOLDIER_MANIFEST;
        if (!man || !man.actions) return;
        const anims = this.scene.anims;
        if (anims.exists('sold_stand_idle_0')) return;
        for (const [name, meta] of Object.entries(man.actions)) {
            const tex = 'sold_' + name;
            if (!this.scene.textures.exists(tex)) continue;
            const n = meta.frames;
            // cower は「制圧下で縮こまり続ける」持続状態、run は移動サイクルなのでループ側。
            // dive_prone / hit / reload は一回性なので非ループ（reload をループさせると
            // 弾倉を何度も入れ直す絵になる。_oneShot と postureTrans は完了検知に isPlaying を使う）
            const loop = !/^trans_/.test(name) && /(_idle|_forward|_fire|_cower|_run)$/.test(name);
            const fps = Math.max(1, Math.round((man.srcFps || 24) / (meta.stride || 1)));
            for (let d = 0; d < 8; d++) {
                const frames = [];
                for (let f = 0; f < n; f++) frames.push(d * n + f);
                anims.create({
                    key: `sold_${name}_${d}`,
                    frames: anims.generateFrameNumbers(tex, { frames }),
                    frameRate: fps,
                    repeat: loop ? -1 : 0,
                });
            }
        }
    }

    /** UnitView フック: 新シートで歩兵スプライトを生成（無ければ旧 crawl にフォールバック） */
    buildInfantrySprite(u) {
        if (!SoldierUnitView.manifestReady() || !this.scene.textures.exists('sold_stand_idle')) {
            return super.buildInfantrySprite(u);
        }
        const man = window.SOLDIER_MANIFEST;
        const scale = SoldierUnitView.displayScale();
        const meta = man.actions.stand_idle;

        // v2 manifest はアクション別クロップ＋足元アンカー原点（originX/Y）。
        // 原点＝接地点なので、コンテナ内オフセットはわずかに沈める程度でよい
        // 影は v7 タイルの太陽（南西上空 → 影は東〜南東落ち）に合わせ右へオフセット。
        // 真下影だと建物影とベクトルが食い違い、兵士が浮いて見える
        const sprite = this.scene.add.sprite(0, 0, 'sold_stand_idle', 0);
        sprite.setOrigin(meta.originX, meta.originY);
        sprite.setScale(scale);
        sprite._soldMeta = meta;
        sprite._soldierAnimHash = soldierAnimHash(u.id);
        sprite.anims.timeScale = 0.92 + (sprite._soldierAnimHash % 16) / 100;
        sprite.play('sold_stand_idle_0');
        // sim のチームは 'A'/'B'（UnitView 既定の 'player' 判定は写実スプライトだと
        // 全員が敵色紫になる）。味方=無着色、敵=薄赤で識別。
        if (u.team === 'player' || u.team === 'A') sprite.clearTint();
        else sprite.setTint(0xffb0a0);
        let shadow;
        if (window.AlphaLightSpace && window.AlphaLightSpace.createSunShadow) {
            shadow = window.AlphaLightSpace.createSunShadow(this.scene, sprite, {
                castScale: 0.34,
                flatten: 0.30,
                widthScale: 1.05,
                alpha: 0.37,
            });
        } else {
            shadow = this.scene.add.sprite(8, 2, 'sold_stand_idle', 0);
            shadow.setTint(0x000000);
            shadow.setAlpha(0.3);
            shadow.setOrigin(meta.originX, meta.originY);
            shadow.setScale(scale * 1.15, scale * 0.3);
        }
        if (shadow) shadow._soldMeta = meta;
        return { shadow, sprite };
    }

    /** UnitView フック: 毎フレームのアニメ選択（姿勢×動作×方向） */
    updateInfantryAnim(visual, u, isMoving) {
        const spr = visual.sprite;
        if (!spr || !SoldierUnitView.manifestReady()
            || spr.texture.key.indexOf('sold_') !== 0) {
            return super.updateInfantryAnim(visual, u, isMoving);
        }
        // RTwP では sim スナップショット、ターン制本編には無いので合成
        // （姿勢は被弾トラッキングのみで決まり、射撃は triggerAttack の one-shot）
        const s = u._sim || { id: u.id, state: isMoving ? 'move' : 'idle', suppression: 0, facing: null };
        const tick = this._now();
        let os = this._oneShot.get(u.id);

        // ---- 方向 ----
        let dir;
        const targetId = s.engageTargetId || u._rtwpPendingTargetId || u._rtwpTargetId;
        let targetVisual = targetId != null
            ? (this.visuals.get(targetId) || this.visuals.get(String(targetId)))
            : null;
        if (!targetVisual && typeof targetId === 'string' && /^\d+$/.test(targetId)) {
            targetVisual = this.visuals.get(Number(targetId));
        }
        if (isMoving) {
            dir = soldierDirFromDelta(visual.lastDx || 0, visual.lastDy || 0);
        } else if (targetVisual && targetVisual.container && visual.container) {
            // SHOTが発生した瞬間だけでなく、照準・観測・再装填中も現在の対敵方向を保持。
            dir = soldierDirFromDelta(
                targetVisual.container.x - visual.container.x,
                targetVisual.container.y - visual.container.y
            );
        } else if (this._faceDir.has(u.id)) {
            dir = this._faceDir.get(u.id);
        } else if (s.facing) {
            dir = soldierDirFromFacing(s.facing);
        } else {
            dir = visual.soldierDir != null ? visual.soldierDir : 0;
        }
        visual.soldierDir = dir;

        // 目標方向は保持しつつ、通常時だけ3tickごとに45°ずつ回頭する。
        // 射撃・one-shot・出現直後は演出の意図を優先して即時に向ける。
        if (visual.dispDir == null || os || s.state === 'engage') {
            visual.dispDir = dir;
            visual.dispDirTick = tick;
        } else if (visual.dispDir !== dir && tick - (visual.dispDirTick || 0) >= 3) {
            const cw = (dir - visual.dispDir + 8) % 8;
            visual.dispDir = (visual.dispDir + (cw <= 4 ? 1 : -1) + 8) % 8;
            visual.dispDirTick = tick;
        }
        const dispDir = visual.dispDir;

        // ---- L3 被弾フリンチ: 新規被弾を検知したら hit/flinch を one-shot（アセットが
        // あれば優先。無ければ何もせず、既存の姿勢低下＝_postureLevelOf で代用される）----
        if (!os) {
            const uf = this._underFire.get(u.id);
            if (uf != null && uf !== visual.lastFlinchUf && tick - uf <= 2) {
                visual.lastFlinchUf = uf;
                const post = POSTURE_NAMES[visual.postureLv || 0] || 'stand';
                const fname = this._firstAnim([`${post}_hit`, `${post}_flinch`], dispDir);
                if (fname) {
                    this._oneShot.set(u.id, { key: `sold_${fname}_${dispDir}`, started: false });
                    os = this._oneShot.get(u.id);
                }
            }
        }

        // ---- one-shot（手榴弾投擲・ターン制の射撃など）が再生中なら優先 ----
        if (os) {
            if (os.untilTick != null && tick >= os.untilTick) {
                this._oneShot.delete(u.id); // 時限式（ループアニメ流用時）
                visual.curActName = this._actionNameFromKey(os.key);
            } else if (!os.started) {
                if (this.scene.anims.exists(os.key)) {
                    os.started = true;
                    spr.play(os.key);
                    if (os.untilTick == null) {
                        spr.once('animationcomplete-' + os.key, () => {
                            if (this._oneShot.get(u.id) === os) {
                                this._oneShot.delete(u.id);
                                visual.curActName = this._actionNameFromKey(os.key);
                            }
                        });
                    }
                } else {
                    this._oneShot.delete(u.id);
                }
                if (os.started) { this._syncShadowTex(visual, spr); return; }
            } else {
                this._syncShadowTex(visual, spr);
                return;
            }
        }

        // ---- 姿勢: 遷移アニメを挟んだステートマシン ----
        // ターン制本編は姿勢メニュー（u.stance）が正本。RTwP は制圧度＋被弾から導出
        const stanceDriven = !u._sim && u.stance != null;
        const target = stanceDriven
            ? (STANCE_LEVEL[u.stance] != null ? STANCE_LEVEL[u.stance] : 0)
            : this._postureLevelOf(s, tick);
        if (visual.postureLv == null) visual.postureLv = target; // 出現時は即時

        // ヒステリシス: 姿勢を上げ直す（伏せ→立ち方向）のは HOLD 経過後のみ。
        // プレイヤーの明示的な姿勢変更（stance）は即時反映
        if (target > visual.postureLv) visual.postureHoldUntil = tick + POSTURE_HOLD_T;
        let effTarget = target;
        if (!stanceDriven && target < visual.postureLv && tick < (visual.postureHoldUntil || 0)) {
            effTarget = visual.postureLv;
        }

        // 遷移再生中はそれを優先。終わっていたら段を確定
        if (visual.postureTrans) {
            const cur = spr.anims.currentAnim;
            if (cur && cur.key === visual.postureTrans.key && spr.anims.isPlaying) {
                this._syncShadowTex(visual, spr);
                return;
            }
            visual.postureLv = visual.postureTrans.step;
            visual.postureTrans = null;
        }

        // アクション遷移が始まった後は完走させる。姿勢遷移より先に中断すると
        // currentAnim 判定が崩れるため、次の姿勢切替は完了後のtickで開始する。
        if (visual.actTrans) {
            const cur = spr.anims.currentAnim;
            if (cur && cur.key === visual.actTrans.key && spr.anims.isPlaying) {
                this._syncShadowTex(visual, spr);
                return;
            }
            visual.curActName = visual.actTrans.next;
            visual.actTrans = null;
        }

        // 立ち→伏せの二段落ちは、被弾中だけ「飛び込み伏せ」1本へ置き換える（回避行動）。
        // stand_to_kneel→kneel_to_prone の連鎖より短く、緊急動作として読める。
        // アセットが無い環境では下の1段ずつ遷移へ自動フォールバックする。
        if (effTarget === 2 && visual.postureLv === 0 && this._recentlyUnderFire(s, tick)) {
            const dive = this._firstAnim(['stand_dive_prone'], dispDir);
            if (dive) {
                const diveKey = `sold_${dive}_${dispDir}`;
                visual.postureTrans = { key: diveKey, step: 2 };
                spr.play(diveKey);
                this._syncShadowTex(visual, spr);
                return;
            }
        }

        // 目標姿勢へ1段ずつ遷移（stand↔kneel↔prone。stand↔prone は kneel 経由で連鎖）
        if (effTarget !== visual.postureLv) {
            const step = visual.postureLv + Math.sign(effTarget - visual.postureLv);
            const name = POSTURE_TRANS[visual.postureLv + '>' + step];
            const key = `sold_${name}_${dispDir}`;
            if (name && this.scene.anims.exists(key)) {
                visual.postureTrans = { key, step };
                spr.play(key);
                this._syncShadowTex(visual, spr);
                return;
            }
            visual.postureLv = effTarget; // 遷移アセットが無ければ即時切替
        }

        const posture = POSTURE_NAMES[visual.postureLv] || 'stand';
        let action = 'idle';
        if (isMoving) action = 'forward';
        else if (s.state === 'reload') action = 'reload';
        else if (s.state === 'engage') action = 'fire';

        // ---- L3 文脈変種（アセットが manifest にあれば優先、無ければ基本形に自動フォールバック）----
        //   遮蔽中の射撃 → cover_fire ／ 重制圧下の静止 → cower
        const inCover = this._coverAt(u) >= COVER_LEAN_MIN;
        let next = `${posture}_${action}`;
        if (action === 'fire' && inCover) {
            next = this._firstAnim([`${posture}_cover_fire`, next], dispDir) || next;
        } else if (action === 'idle' && this._heavySuppressed(s, tick)) {
            next = this._firstAnim([`${posture}_cower`, `cower`, next], dispDir) || next;
        } else if (action === 'idle' && inCover) {
            // 遮蔽内で撃っていない間は物陰に身を潜める。重制圧(cower)の方が緊急なので
            // 上の分岐を先に評価する。cover_idle が無い環境では基本形へ自動フォールバック。
            next = this._firstAnim([`${posture}_cover_idle`, next], dispDir) || next;
        } else if (action === 'forward' && this._recentlyUnderFire(s, tick)) {
            // 撃たれながらの移動＝躍進なので走る。sim には歩/走の速度区分が無いため、
            // 「被弾中の移動」を唯一の確かな走行トリガとして使う（自動Coverの退避と一致する）。
            next = this._firstAnim([`${posture}_run`, next], dispDir) || next;
        } else if (action === 'reload') {
            // 姿勢別リロードが無い環境では「その姿勢の idle」へ落とす。下の大域
            // フォールバックは stand_idle なので、ここで受け止めないと伏せた兵士が
            // 立ち上がってしまう（伏せリロードは graft では作れず専用クリップが必要）。
            next = this._firstAnim([`${posture}_reload`, `${posture}_idle`], dispDir) || next;
        }
        let key = `sold_${next}_${dispDir}`;
        if (!this.scene.anims.exists(key)) {
            next = 'stand_idle';
            key = `sold_stand_idle_${dispDir}`;
        }

        // 遮蔽射撃なら射線方向へ身を乗り出す（縁寄せ）。それ以外は中央へ戻す。
        // 低仰角カメラに合わせ縦成分は抑える。実オフセットは _syncShadowTex でイージング。
        if (action === 'fire' && inCover) {
            const lv = this._dirToScreenVec(dispDir);
            visual.leanTarget = { x: lv.x * COVER_LEAN_PX, y: lv.y * COVER_LEAN_PX * 0.6 };
        } else {
            visual.leanTarget = { x: 0, y: 0 };
        }

        // ---- アクション遷移: ベイク済み clip → ゴーストクロスフェード → 即時切替 ----
        // 方向だけの変更は同一 action とみなし、下の play(key, true) に任せる。
        const actionChanged = visual.curActName !== next;
        if (visual.curActName == null) {
            visual.curActName = next; // 初期出現は遷移・ゴーストなし
            spr.play(key, true);
            this._setLoopPhase(spr);
        } else if (actionChanged) {
            const transKey = `sold_trans_${visual.curActName}__${next}_${dispDir}`;
            if (this.scene.anims.exists(transKey)) {
                visual.actTrans = { key: transKey, next };
                spr.play(transKey);
                this._syncShadowTex(visual, spr);
                return;
            }

            this._spawnActionGhost(visual, spr);
            visual.curActName = next;
            spr.play(key, true);
            this._setLoopPhase(spr);
        } else {
            spr.play(key, true); // ignoreIfPlaying — 同一キーなら継続
        }
        this._syncShadowTex(visual, spr);
    }

    /** ループアニメ開始時だけ、個体ごとの安定位相を与える。 */
    _setLoopPhase(spr) {
        const name = this._actionNameFromKey(spr.anims.currentAnim && spr.anims.currentAnim.key);
        if (!name || /^trans_/.test(name) || !/(_idle|_forward|_fire|_cower|_run)$/.test(name)) return;
        const h = spr._soldierAnimHash || 0;
        spr.anims.setProgress(((h >>> 4) % 997) / 997);
    }

    /** sold_<action>_<dir> 形式のアニメキーから action 名を取り出す。 */
    _actionNameFromKey(key) {
        const m = /^sold_(.+)_[0-7]$/.exec(key || '');
        return m ? m[1] : null;
    }

    /** 現在フレームを短時間だけ残して、ベイク済みでない action 切替を補間する。 */
    _spawnActionGhost(visual, spr) {
        this._destroyGhost(visual);
        if (!visual.container || !spr.texture || !spr.frame) return;

        const ghost = this.scene.add.sprite(spr.x, spr.y, spr.texture.key, spr.frame.name);
        ghost.setOrigin(spr.originX, spr.originY);
        ghost.setScale(spr.scaleX, spr.scaleY);
        ghost.setAlpha(spr.alpha);
        ghost.setFlip(spr.flipX, spr.flipY);
        ghost.setRotation(spr.rotation);
        ghost.setTint(spr.tintTopLeft, spr.tintTopRight, spr.tintBottomLeft, spr.tintBottomRight);

        const index = visual.container.getIndex(spr);
        visual.container.addAt(ghost, index >= 0 ? index : visual.container.length);
        visual._ghost = ghost;
        this.scene.tweens.add({
            targets: ghost,
            alpha: 0,
            duration: 90,
            onComplete: () => {
                if (visual._ghost === ghost) visual._ghost = null;
                if (ghost && ghost.active) ghost.destroy();
            },
        });
    }

    _destroyGhost(visual) {
        const ghost = visual && visual._ghost;
        if (ghost) {
            try { ghost.destroy(); } catch (e) { }
            visual._ghost = null;
        }
    }

    /** テクスチャ（=アクション）切替時に per-action 原点を適用し、影を追従させる */
    _syncShadowTex(visual, spr) {
        this._applyActionOrigin(spr);
        const sh = visual.shadowSprite;
        if (sh && sh.texture) {
            if (sh.texture.key !== spr.texture.key) sh.setTexture(spr.texture.key);
            this._applyActionOrigin(sh);
            if (window.AlphaLightSpace && window.AlphaLightSpace.syncSunShadow) {
                window.AlphaLightSpace.syncSunShadow(sh, spr, {
                    castScale: 0.34,
                    flatten: 0.30,
                    widthScale: 1.05,
                    alpha: 0.37,
                });
            }
        }
        // 遮蔽射撃の「身乗り出し」オフセットをイージング適用（本体スプライトのみ。
        // 影は接地させたままにして浮きを防ぐ）。leanTarget は毎フレーム上流が設定する。
        const t = visual.leanTarget || (visual.leanTarget = { x: 0, y: 0 });
        const c = visual.leanCur || (visual.leanCur = { x: 0, y: 0 });
        c.x += (t.x - c.x) * 0.25;
        c.y += (t.y - c.y) * 0.25;
        if (Math.abs(t.x - c.x) < 0.02 && Math.abs(t.y - c.y) < 0.02) { c.x = t.x; c.y = t.y; }
        spr.setPosition(c.x, c.y);
    }

    /**
     * u の居るヘックスの遮蔽値を 0..1 に正規化して返す（取得不能は 0）。
     * RTwP(sim_battle)は map.cover() が 0..1、ターン制本編は tile.cover が 0..100 と
     * スケールが異なるため、1 を超える値は /100 で正規化する。
     */
    _coverAt(u) {
        if (!u) return 0;
        const norm = (v) => (typeof v === 'number' ? (v > 1 ? v / 100 : v) : 0);
        try {
            const sc = this.scene;
            if (sc && sc.map && typeof sc.map.cover === 'function') {
                return norm(sc.map.cover({ q: u.q, r: u.r }));
            }
            const gm = (typeof window !== 'undefined') && window.gameLogic && window.gameLogic.map;
            const t = gm && gm[u.q] && gm[u.q][u.r];
            if (t) {
                if (typeof t.cover === 'number') return norm(t.cover);
                if (t.terrain && typeof t.terrain.cover === 'number') return norm(t.terrain.cover);
                if (t.building) return 0.6; // 建物内は高遮蔽扱い
            }
        } catch (e) { /* マップ未整備環境では遮蔽なし扱い */ }
        return 0;
    }

    /** 候補アクション名のうち、指定方向のアニメが存在する最初のものを返す（無ければ null）。 */
    _firstAnim(candidates, dispDir) {
        for (const name of candidates) {
            if (name && this.scene.anims.exists(`sold_${name}_${dispDir}`)) return name;
        }
        return null;
    }

    /** シート方向行 → 画面上の単位ベクトル（soldierDirFromDelta の逆写像）。 */
    _dirToScreenVec(row) {
        const th = Math.PI / 2 - (row % 8) * (Math.PI / 4);
        return { x: Math.cos(th), y: Math.sin(th) };
    }

    /**
     * 直近 UNDER_FIRE_T tick 以内に撃たれたか。_postureLevelOf の姿勢低下と同じ判定を
     * 使うので、姿勢が落ちる場面＝飛び込み伏せを出す場面が一致する。
     */
    _recentlyUnderFire(s, tick) {
        if (!s) return false;
        const uf = this._underFire.get(s.id);
        return uf != null && tick - uf <= UNDER_FIRE_T;
    }

    /** 制圧が重い（cower 相当＝伏せて縮こまる）状態か。 */
    _heavySuppressed(s, tick) {
        const T = (typeof SIM_TUNING !== 'undefined') ? SIM_TUNING : {};
        return s.state === 'pinned' || s.suppression >= (T.PINNED_AT || 999);
    }

    _applyActionOrigin(obj) {
        const man = window.SOLDIER_MANIFEST;
        if (!man || !obj.texture || obj.texture.key.indexOf('sold_') !== 0) return;
        const meta = man.actions[obj.texture.key.slice(5)];
        if (meta && obj._soldMeta !== meta) {
            obj.setOrigin(meta.originX, meta.originY);
            obj._soldMeta = meta;
        }
    }

    /** scene の SHOT イベントから: 射手を射線方向へ向け、被弾側を「被射撃中」として記録 */
    noteShot(shooterId, fromPx, toPx, targetId) {
        const shooterVisual = this.visuals.get(shooterId);
        const targetVisual = targetId != null ? this.visuals.get(targetId) : null;
        const a = shooterVisual && shooterVisual.container ? shooterVisual.container : fromPx;
        const b = targetVisual && targetVisual.container ? targetVisual.container : toPx;
        this._faceDir.set(shooterId, soldierDirFromDelta(b.x - a.x, b.y - a.y));
        if (targetId != null) this._underFire.set(targetId, this._now());
    }

    /**
     * ターン制本編の攻撃演出（Renderer.playAttackAnim → UnitView.triggerAttack）。
     * 旧実装は crawl を目標方向へ再生するだけだった。新スプライトでは
     * 目標方向を向いて fire を時限 one-shot 再生し、被弾側を記録する。
     */
    triggerAttack(attacker, target) {
        const visual = this.visuals.get(attacker.id);
        if (!visual || !visual.sprite || (attacker.def && attacker.def.isTank)) {
            return super.triggerAttack(attacker, target);
        }
        if (visual.sprite.texture.key.indexOf('sold_') !== 0) {
            return super.triggerAttack(attacker, target);
        }
        if (typeof Renderer === 'undefined') return;
        const targetVisual = target && this.visuals.get(target.id);
        const a = visual.container || Renderer.hexToPx(attacker.q, attacker.r);
        const b = targetVisual && targetVisual.container
            ? targetVisual.container : Renderer.hexToPx(target.q, target.r);
        const dir = soldierDirFromDelta(b.x - a.x, b.y - a.y);
        this._faceDir.set(attacker.id, dir);
        visual.soldierDir = dir;
        visual.dispDir = dir; // triggerAttack 起因の回頭は即時
        visual.dispDirTick = this._now();
        if (target && target.id != null) this._underFire.set(target.id, this._now());
        const posture = POSTURE_NAMES[visual.postureLv || 0] || 'stand';
        // fire はループ定義なので時限式 one-shot（約1秒）で流用する
        this._oneShot.set(attacker.id, { key: `sold_${posture}_fire_${dir}`, started: false, untilTick: this._now() + 25 });
    }

    /** scene の GRENADE イベントから: 投擲 one-shot（姿勢対応） */
    playThrow(simSoldier, fromPx, toPx) {
        if (!SoldierUnitView.manifestReady()) return;
        const dir = soldierDirFromDelta(toPx.x - fromPx.x, toPx.y - fromPx.y);
        this._faceDir.set(simSoldier.id, dir);
        const visual = this.visuals.get(simSoldier.id);
        if (visual) {
            visual.soldierDir = dir;
            visual.dispDir = dir;
            visual.dispDirTick = this._now();
        }
        const posture = this._postureOf(simSoldier);
        this._oneShot.set(simSoldier.id, { key: `sold_${posture}_throw_grenade_${dir}`, started: false });
    }

    /** scene の DOWN イベントから: dying を一回再生し、最終フレームで死体として残す */
    spawnCorpse(simSoldier) {
        if (!SoldierUnitView.manifestReady()) return;
        if (!this._corpseSpawned) this._corpseSpawned = new Set();
        if (this._corpseSpawned.has(simSoldier.id)) return;
        this._corpseSpawned.add(simSoldier.id);
        const man = window.SOLDIER_MANIFEST;
        const v = this.visuals.get(simSoldier.id); // dispatch は視覚破棄より先に走る
        const p = (v && v.container)
            ? { x: v.container.x, y: v.container.y }
            : Renderer.hexToPx(simSoldier.q, simSoldier.r);
        const dir = this._faceDir.get(simSoldier.id)
            ?? (v && v.dispDir) ?? (v && v.soldierDir) ?? soldierDirFromFacing(simSoldier.facing);
        // 死亡時は「表示中の姿勢」から倒れる（遷移中なら sim 由来の姿勢へフォールバック）
        const posture = (v && v.postureLv != null && !v.postureTrans)
            ? (POSTURE_NAMES[v.postureLv] || 'stand')
            : this._postureOf(simSoldier);
        this._spawnCorpseAt(p.x, p.y, dir, posture);
        this._faceDir.delete(simSoldier.id);
        this._oneShot.delete(simSoldier.id);
    }

    /**
     * 姿勢レベル決定（0=stand, 1=kneel, 2=prone）:
     *   制圧ベース: pinned/PINNED_AT→2, suppressed/SUPPRESSED_AT→1
     *   被射撃中（直近 UNDER_FIRE_T tick 内に撃たれた）: 最低でも膝立ち、
     *   制圧も受けているなら伏せ — 「撃たれたら身を低くする」
     */
    _postureLevelOf(s, tick) {
        const T = (typeof SIM_TUNING !== 'undefined') ? SIM_TUNING : {};
        let lv = 0;
        // 姿勢フラグ(sim の prone)が正本。行動不能は倒れているので必ず伏せ姿勢。
        if (s.prone === true || s.state === 'incap') return 2;
        if (s.state === 'pinned' || s.state === 'down' || s.suppression >= (T.PINNED_AT || 999)) lv = 2;
        else if (s.state === 'suppressed' || s.suppression >= (T.SUPPRESSED_AT || 999)) lv = 1;
        const uf = this._underFire.get(s.id);
        if (uf != null && tick - uf <= UNDER_FIRE_T) lv = (lv >= 1) ? 2 : Math.max(lv, 1);
        return lv;
    }

    _postureOf(s) {
        return POSTURE_NAMES[this._postureLevelOf(s, this._now())] || 'stand';
    }

    /** UnitView フック: 死亡時（hp<=0 で視覚破棄される直前）— ターン制本編の死体化 */
    onUnitDead(u, visual) {
        // 以前は `u._sim` があれば「DOWNイベント側が死体を作る」前提で抜けていたが、
        // その担当は sim_battle.html の sim_scene にしか無く、本編(RTwP)では
        // 誰も作らないまま視覚だけ破棄されていた＝死体が消えた。経路で分けるのを
        // やめ、id で二重生成だけ防ぐ（どちらの経路が先に来ても1体だけ残る）。
        if (!SoldierUnitView.manifestReady() || !visual || !visual.container) return;
        if (u.def && u.def.isTank) return;
        if (visual.sprite && visual.sprite.texture.key.indexOf('sold_') !== 0) return;
        if (!this._corpseSpawned) this._corpseSpawned = new Set();
        if (this._corpseSpawned.has(u.id)) return;
        this._corpseSpawned.add(u.id);
        const dir = this._faceDir.get(u.id) ?? visual.dispDir ?? visual.soldierDir ?? 0;
        const posture = POSTURE_NAMES[visual.postureLv || 0] || 'stand';
        this._spawnCorpseAt(visual.container.x, visual.container.y, dir, posture);
        this._faceDir.delete(u.id);
        this._oneShot.delete(u.id);
    }

    _spawnCorpseAt(x, y, dir, posture) {
        const man = window.SOLDIER_MANIFEST;
        const key = `sold_${posture}_dying_${dir}`;
        if (!this.scene.anims.exists(key)) return;
        const meta = man.actions[`${posture}_dying`];
        const c = this.scene.add.sprite(x, y + 2, `sold_${posture}_dying`, 0);
        c.setOrigin(meta.originX, meta.originY);
        c.setScale(SoldierUnitView.displayScale());
        // ユニットレイヤ内でYソート（生存ユニット(depth=y)や建物(y-0.5)よりわずかに奥）
        c.setDepth(y - 0.6);
        if (this.unitLayer) this.unitLayer.add(c);
        c.setTint(0xbbbbbb);
        c.play(key); // repeat:0 → 最終フレームで停止＝死体
        this._corpses.push(c);
    }

    clear() {
        this.visuals.forEach((visual) => this._destroyGhost(visual));
        super.clear();
        this._corpses.forEach((c) => { try { c.destroy(); } catch (e) { } });
        this._corpses = [];
        this._faceDir.clear();
        this._oneShot.clear();
        this._underFire.clear();
    }
}

if (typeof window !== 'undefined') {
    window.SoldierUnitView = SoldierUnitView;
    window.soldierDirFromDelta = soldierDirFromDelta;

    /**
     * manifest の先行フェッチ（結果は window.SOLDIER_MANIFEST）。
     * ターン制本編は起動が同期的なのでスクリプト読込時に走らせておき、
     * preload 時点で解決済みであることを期待する（未解決/失敗なら
     * SOLDIER_MANIFEST が falsy のまま旧 soldier_crawl で劣化動作）。
     */
    window.loadSoldierManifest = function () {
        if (window._soldierManifestPromise) return window._soldierManifestPromise;
        window._soldierManifestPromise = fetch('asset/sprites/soldier/manifest.json')
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)
            .then((m) => {
                const valid = (m && m.actions && m.version >= 2) ? m : null;
                if (valid) window.SOLDIER_LOAD_ACTIONS = Object.keys(valid.actions);
                window.SOLDIER_MANIFEST = valid;
                return window.SOLDIER_MANIFEST;
            });
        return window._soldierManifestPromise;
    };
    window.loadSoldierManifest();
}

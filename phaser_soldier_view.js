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

// 歩調の上下動（表示20px基準の振幅px）。**本体だけを動かし影は接地させたまま**にする。
// 2026-08-03 追加（ディレクター指摘「重みが感じられない」）。実測の裏付け:
// stand_forward は頭頂の上下が**全14フレームで0px**＝歩きには元々まったく縦の動きが
// 無かった。stand_run は6px(シート空間、表示換算1.7px)持つが、谷が p=0・山が p=0.25 に
// 来るので、同位相のサイン波を足して増幅する（逆位相だと打ち消してぼやける）。
// 匍匐は対象外 — 伏せた体は跳ねない。
const GAIT_BOB_WALK_PX = 0.8;  // 歩き。元が0なのでここが唯一の縦の手がかり
const GAIT_BOB_RUN_PX = 1.3;   // 走り。焼き込み済みの上下に上乗せする
const GAIT_STRIDES = 2;        // 1ループ＝2歩（cx曲線に山が2つ。実測）

// 回頭（2026-08-03 ディレクター指摘「バックステップで後退する / 発砲方向を向かない」）。
// 旧実装は状況を問わず 45°/3tick で、180°の反転に 0.9秒＝**0.75ヘックスぶん後ろ歩き**して
// いた（135°で0.5hex。scratchpad の実測）。移動中はズレの上限を設けて詰める。
const TURN_STEP_T = 3;       // 静止時の回頭間隔(tick)。45°ずつ刻む見え方は維持する
const TURN_STEP_T_MOVE = 1;  // 移動中は速く回る
const MOVE_FACE_MAX_LAG = 1; // 移動中に許す向きのズレ(45°単位)。超過分は待たずに詰める

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
 * シートの実際の行順（2026-08-03、シルエット実測で確定）。
 *
 * 旧コメントと `manifest.dirOrder` は `S,SE,E,NE,N,NW,W,SW` を主張していたが、
 * **これは repack スクリプトのハードコード文字列で実測ではなく、鏡像かつ45°ずれていた。**
 * 実測の根拠（prone_idle / stand_fire で一致）:
 *   - シルエット幅が最小なのは row 1,5（視線軸に沿う＝N/S）、最大は row 3,7（横向き＝E/W）。
 *     **カーディナルが奇数行に来る**ので「row 0 = S」は原理的にありえない。
 *   - 東西の別は絵で確定: row 3 は小銃が画面左＝W、row 7 は右＝E。
 *   - 体の重心は常に狙いと反対側へ寄る（脚が後ろに伸びる）ので、これが機械判定に使える。
 * 「撃ち合っている二人が互いに逆を向く」の原因がこれ。正本は `tests/test_soldier_dir_order.py`
 * が実シートのピクセルから検証する。
 */
const SHEET_DIR_ORDER = ['SE', 'S', 'SW', 'W', 'NW', 'N', 'NE', 'E'];
const SHEET_ROW_S = SHEET_DIR_ORDER.indexOf('S');   // = 1（無方向時の既定＝手前向き）

/**
 * 画面座標デルタ → シートの方向行。y は下向き正。
 */
function soldierDirFromDelta(dx, dy) {
    if (!dx && !dy) return SHEET_ROW_S;
    // いったん S=0,SE=1,E=2,NE=3,N=4,NW=5,W=6,SW=7 の中間表現へ（読みやすさのため）
    let k = Math.round(Math.atan2(-dy, dx) / (Math.PI / 4)) + 2;
    k %= 8; if (k < 0) k += 8;
    // → 実シート行。row1=S を起点に行が増えるほど時計回り（S→SW→W→…）
    return (1 - k + 8) % 8;
}

/** sim の facing {q,r}（軸座標ベクトル）→ 方向行。hexToPx と同じ射影。 */
function soldierDirFromFacing(f) {
    if (!f) return SHEET_ROW_S;
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
        const targetId = u._rtwpPendingTargetId || s.engageTargetId || u._rtwpTargetId;
        const pendingHex = u._rtwpPendingTargetHex;
        const pendingFacingHex = u._rtwpPendingFiringHex || pendingHex;
        const targetVisual = this._visualById(targetId);
        const moveDir = this._moveFacing(s, u, visual, isMoving);
        if (targetVisual && targetVisual.container && visual.container) {
            // SHOTが発生した瞬間だけでなく、照準・観測・再装填中も現在の対敵方向を保持。
            dir = soldierDirFromDelta(
                targetVisual.container.x - visual.container.x,
                targetVisual.container.y - visual.container.y
            );
        } else if (pendingFacingHex
            && (pendingFacingHex.q !== u.q || pendingFacingHex.r !== u.r)) {
            dir = soldierDirFromFacing({
                q: pendingFacingHex.q - u.q, r: pendingFacingHex.r - u.r,
            });
        } else if (moveDir != null) {
            dir = moveDir;
        } else if (s.engageHex && (s.engageHex.q !== u.q || s.engageHex.r !== u.r)) {
            // 面制圧(TARGET_HEX)は個体ではなく地点を撃つので engageTargetId が null。
            // ここを見ないと「撃てと命じた方角を向かないまま撃つ」ことになる
            // （撃ち始めれば SHOT 由来の _faceDir が後追いで合わせるが、発砲前と
            //   観測休止中は前の向きのまま固まる）。
            dir = soldierDirFromFacing({ q: s.engageHex.q - u.q, r: s.engageHex.r - u.r });
        } else if (this._faceDir.has(u.id)) {
            dir = this._faceDir.get(u.id);
        } else if (s.facing) {
            dir = soldierDirFromFacing(s.facing);
        } else {
            dir = visual.soldierDir != null ? visual.soldierDir : 0;
        }
        visual.soldierDir = dir;

        // 目標方向は保持しつつ、静止時は3tickごとに45°ずつ回頭する。
        // 射撃・one-shot・出現直後は演出の意図を優先して即時に向ける。
        if (visual.dispDir == null || os || s.state === 'engage' || targetId || pendingHex) {
            visual.dispDir = dir;
            visual.dispDirTick = tick;
        } else if (visual.dispDir !== dir) {
            const cw = (dir - visual.dispDir + 8) % 8;
            const sign = cw <= 4 ? 1 : -1;
            const lag = Math.min(cw, 8 - cw);   // 最短で何歩ぶんズレているか（1..4）
            let steps = 0;
            // **移動中は45°を超えてズレたまま歩かない。** 超過分は回頭間隔を待たずに
            // 詰める。これが無いと、向きが追いつく前に translate が始まって
            // 「後ろ歩き」になる（旧実装の180°反転で0.75ヘックスぶん）。
            if (isMoving && lag > MOVE_FACE_MAX_LAG) steps = lag - MOVE_FACE_MAX_LAG;
            const every = isMoving ? TURN_STEP_T_MOVE : TURN_STEP_T;
            if (tick - (visual.dispDirTick || 0) >= every) steps += 1;
            if (steps > 0) {
                visual.dispDir = (visual.dispDir + sign * Math.min(steps, lag) + 8) % 8;
                visual.dispDirTick = tick;
            }
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
        let target = stanceDriven
            ? (STANCE_LEVEL[u.stance] != null ? STANCE_LEVEL[u.stance] : 0)
            : this._postureLevelOf(s, tick);
        if (!isMoving && s.weapon && s.weapon.code === 'm2_mortar') target = Math.max(1, target);
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
        // `isMoving` は画面上で滑っているかどうかでしかない。同じヘックスに味方が
        // 出入りすると散布オフセット（UnitView._calcUnitOffset）が組み替わって
        // 全員が横滑りするので、**自力で動けない兵**まで移動アニメを始めてしまう
        // ——倒れた兵がにじり歩く絵になる（2026-08-03 実測: 移動サンプルの10%が
        // これで、全て state=incap だった）。動けるかどうかは sim に訊く。
        if (isMoving && this._canLocomote(s, u)) action = 'forward';
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
        } else if (action === 'forward' && this._isRunning(s, tick)) {
            // 走る/歩くの切替は sim の実効モードが正本（_effMoveMode）。伏せ姿勢には
            // 走りのシートが無いので prone_forward（匍匐）へ自動フォールバックする。
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

        // 遮蔽射撃の「身乗り出し」オフセットをイージング適用（本体スプライトのみ）。
        // leanTarget は毎フレーム上流が設定する。
        const t = visual.leanTarget || (visual.leanTarget = { x: 0, y: 0 });
        const c = visual.leanCur || (visual.leanCur = { x: 0, y: 0 });
        c.x += (t.x - c.x) * 0.25;
        c.y += (t.y - c.y) * 0.25;
        if (Math.abs(t.x - c.x) < 0.02 && Math.abs(t.y - c.y) < 0.02) { c.x = t.x; c.y = t.y; }

        // **影は接地位置から作る。** syncSunShadow は source.x/y を読むので、歩調の
        // 上下を乗せた後に呼ぶと影まで一緒に跳ねて足元が浮く。接地位置で置く →
        // 影を作る → 本体にだけ上下を足す、の順で「体だけが弾む」絵になる。
        spr.setPosition(c.x, c.y);
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
        spr.setPosition(c.x, c.y + this._gaitBob(spr));
    }

    /**
     * 歩調に合わせた上下動（サイン波）。歩き・走りだけに掛かり、匍匐と静止には掛からない。
     *
     * 位相はクリップの再生位置に固定する（時間で回すと足の接地とずれて、足が地面に
     * 着いた瞬間に体が浮く絵になる）。1ループ＝2歩で、**接地の谷を p=0 に置く** —
     * stand_run の焼き込み済みの上下（谷 p=0 / 山 p=0.25）と同位相にして増幅するため。
     * 逆位相にすると打ち消し合って、上下しているのにぼやけて見える。
     * @returns {number} y へ足すオフセット（負＝上）
     */
    _gaitBob(spr) {
        const st = spr.anims;
        const anim = st && st.currentAnim;
        if (!anim) return 0;
        const name = this._actionNameFromKey(anim.key);
        // 伏せ(prone_forward)は跳ねない。_forward の語尾で一括りにしないこと
        const amp = /^(stand|kneel)_run$/.test(name) ? GAIT_BOB_RUN_PX
            : /^(stand|kneel)_forward$/.test(name) ? GAIT_BOB_WALK_PX
                : 0;
        if (!amp) return 0;
        // frame.index は1始まり。getProgress() はバージョンによって量子化の仕様が
        // 違うので、フレーム番号から自前で出す（スプライト自体が24fps刻みなので、
        // ここだけ滑らかにしても意味が無い）
        const total = (anim.frames && anim.frames.length) || 1;
        const idx = st.currentFrame ? (st.currentFrame.index - 1) : 0;
        const p = total > 0 ? (idx / total) : 0;
        // 持ち上がり量: p=0 で最小(接地)、p=0.25 で最大。-cos = 1/4位相ずらしのサイン波
        const lift = -Math.cos(2 * Math.PI * GAIT_STRIDES * p); // -1..+1
        return -amp * lift;   // y は下向き正なので反転して返す
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

    /**
     * シート方向行 → 画面上の単位ベクトル（soldierDirFromDelta の逆写像）。
     * row1=S(0,+1) を起点に、行が増えるほど時計回り（S→SW→W→…）。
     * 旧実装は行が増えるほど反時計回りで、行順そのものと同じく鏡像だった。
     */
    _dirToScreenVec(row) {
        const r = (((row | 0) % 8) + 8) % 8;
        const th = Math.PI / 2 + (r - SHEET_ROW_S) * (Math.PI / 4);
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

    /**
     * ユニットID → visual。**本編のIDは `Math.random()` 由来の小数**で、sim へは
     * `String(id)` で渡している。`visuals` のキーは数値のままなので、文字列で
     * 引くと必ず外れる。旧実装のフォールバックは `/^\d+$/`（整数のみ）で小数を
     * 弾いていたため、本編では「狙っている相手を向き続ける」分岐が**一度も成立
     * していなかった** —— 撃った瞬間の `_faceDir` だけが頼りで、次弾までの照準・
     * 観測休止・装填中は前の向きのまま固まっていた（発砲方向を向かない件の一因）。
     * sim_battle.html は文字列IDなので、そちらでは露見しない。
     */
    _visualById(id) {
        if (id == null) return null;
        let v = this.visuals.get(id) || this.visuals.get(String(id));
        if (!v && typeof id === 'string' && id !== '') {
            const n = Number(id);
            if (!Number.isNaN(n)) v = this.visuals.get(n);
        }
        return v || null;
    }

    /**
     * 自力で移動しうる状態か。行動不能・戦死は「滑っていても歩いてはいない」。
     *
     * スプライトが到着位置へ寄り直すだけの滑りは正常な動作（1ヘックスぶん遅れて
     * 追走することがある）なので、状態が move かどうかでは判定しない —— それだと
     * 経路の最後で本当に歩いている兵まで idle に落ちて滑る。
     */
    _canLocomote(s, u) {
        if (u && u.hp <= 0) return false;
        return !(s && (s.state === 'incap' || s.state === 'down'));
    }

    /**
     * 移動中の向き。**sim の facing が正本**で、画面上のピクセル差分は使わない。
     *
     * ピクセル差分（`visual.lastDx/lastDy`）を向きに使うと、同じヘックスに味方が
     * 出入りするたびに散布オフセット（`UnitView._calcUnitOffset`）が組み替わり、
     * その横滑りを「移動方向」と誤読して兵士がその場で回れ右する —— これが
     * バックステップの正体。到着判定は 0.15px なので、わずかな寄り直しでも
     * `isMoving` が立ってしまう。
     *
     * `s.facing` は sim が1マス進むたびに「いまアニメートしている step の向き」を
     * 入れるので、スプライトの滑りと必ず一致する。まだ一歩も進んでいない兵は
     * null を返し、射線・面制圧・直近の向きへ判断を譲る。
     *
     * @returns {number|null} 方向行 0..7、移動中でなければ null
     */
    _moveFacing(s, u, visual, isMoving) {
        if (!isMoving) return null;
        // ターン制本編（sim スナップショット無し）は従来どおり画面差分で向く
        if (!u || !u._sim) return soldierDirFromDelta(visual.lastDx || 0, visual.lastDy || 0);
        return s.facing ? soldierDirFromFacing(s.facing) : null;
    }

    /**
     * そのマスを実際にどう渡っているか（walk/rush/crawl）。
     *
     * 命令は「移動」1つで、渡り方は1マスごとに sim_policy.pickMoveStep が決める。
     * 生の `moveMode` はその間 'auto' に据え置かれるため、ここを見ないと走りの
     * シートが一度も選ばれない。`stepMode` を持たない経路（ターン制本編の合成
     * スナップショット・古いセーブ）では従来どおり `moveMode` へ落ちる。
     */
    _effMoveMode(s) {
        if (!s) return 'walk';
        if (s.stepMode) return s.stepMode;
        return (s.moveMode && s.moveMode !== 'auto') ? s.moveMode : 'walk';
    }

    /** 走行サイクルを出すか。匍匐中は走らない（伏せたまま進んでいる）。 */
    _isRunning(s, tick) {
        const mode = this._effMoveMode(s);
        if (mode === 'crawl') return false;
        // 被弾中の移動＝躍進。stepMode を持たない経路でも躍進だけは見えるよう残す。
        return mode === 'rush' || this._recentlyUnderFire(s, tick);
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
        // The mortar crew works from a kneeling posture; the existing kneel-fire
        // clip reads as the loader leaning in and dropping a round into the tube.
        const mortarAttack = (attacker.weapon && attacker.weapon.code === 'm2_mortar')
            || (window.M2Mortar && M2Mortar.isAssembled(attacker));
        const posture = mortarAttack
            ? 'kneel' : (POSTURE_NAMES[visual.postureLv || 0] || 'stand');
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
        // 遮蔽から開豁地へ出る前の一拍（sim_policy の observeT）は、立ったまま棒立ちで
        // 待つのではなく身を屈めて頃合いを窺う。走り出す直前の「溜め」が見える。
        if (s.observeT > 0) lv = Math.max(lv, 1);
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

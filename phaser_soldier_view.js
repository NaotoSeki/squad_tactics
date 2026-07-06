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
 */

// ロードする 19 アクション（姿勢遷移 4 種を含む）
window.SOLDIER_LOAD_ACTIONS = [
    'stand_idle', 'stand_forward', 'stand_fire', 'stand_dying', 'stand_throw_grenade',
    'kneel_idle', 'kneel_forward', 'kneel_fire', 'kneel_dying', 'kneel_throw_grenade',
    'prone_idle', 'prone_forward', 'prone_fire', 'prone_dying', 'prone_throw_grenade',
    'stand_to_kneel', 'kneel_to_stand', 'kneel_to_prone', 'prone_to_kneel',
];

// 姿勢レベル: 0=stand, 1=kneel, 2=prone
const POSTURE_NAMES = ['stand', 'kneel', 'prone'];
const POSTURE_TRANS = { '0>1': 'stand_to_kneel', '1>0': 'kneel_to_stand', '1>2': 'kneel_to_prone', '2>1': 'prone_to_kneel' };
const UNDER_FIRE_T = 75;   // 被弾判定の持続 tick（撃たれたら身を低くする）
const POSTURE_HOLD_T = 50; // 姿勢を上げ直すまでの最低保持 tick（ピクつき防止）

// 画面上の兵士の見かけ高さ（px）。旧 soldier_crawl は 256*0.15 ≈ 38px だった
const SOLDIER_VIEW_H = 50;

/**
 * 画面座標デルタ → シートの方向行。y は下向き正。
 * シートの行順はラベル(S,SE,E,...)と逆回転で、実際の見た目は
 * row: 0=S, 1=SW, 2=W, 3=NW, 4=N, 5=NE, 6=E, 7=SE（実測: stand_fire 検分）。
 * よって S,SE,E,... 系の方位インデックス k に対し使用行 = (8-k)%8。
 */
function soldierDirFromDelta(dx, dy) {
    if (!dx && !dy) return 0;
    let k = Math.round(Math.atan2(-dy, dx) / (Math.PI / 4)) + 2; // E=2 基準（S,SE,E,...順）
    k %= 8; if (k < 0) k += 8;
    return (8 - k) % 8;
}

/** sim の facing {q,r}（軸座標ベクトル）→ 方向行。hexToPx と同じ射影。 */
function soldierDirFromFacing(f) {
    if (!f) return 0;
    const dx = Math.sqrt(3) * (f.q + f.r / 2);
    const dy = 1.5 * f.r;
    return soldierDirFromDelta(dx, dy);
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
        return !!(man && man.actions && man.frameWidth > 0);
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
            const loop = /(_idle|_forward|_fire)$/.test(name);
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
        const scale = SOLDIER_VIEW_H / man.frameHeight;
        const ox = (man.anchorX != null) ? man.anchorX : 0.5;

        const shadow = this.scene.add.sprite(2, -18, 'sold_stand_idle', 0);
        shadow.setTint(0x000000);
        shadow.setAlpha(0.35);
        shadow.setOrigin(ox, 0.52);
        shadow.setScale(scale * 1.05, scale * 0.32);

        const sprite = this.scene.add.sprite(0, -20, 'sold_stand_idle', 0);
        sprite.setOrigin(ox, 0.55);
        sprite.setScale(scale);
        sprite.play('sold_stand_idle_0');
        // sim のチームは 'A'/'B'（UnitView 既定の 'player' 判定は写実スプライトだと
        // 全員が敵色紫になる）。味方=無着色、敵=薄赤で識別。
        if (u.team === 'player' || u.team === 'A') sprite.clearTint();
        else sprite.setTint(0xffb0a0);
        return { shadow, sprite };
    }

    /** UnitView フック: 毎フレームのアニメ選択（姿勢×動作×方向） */
    updateInfantryAnim(visual, u, isMoving) {
        const spr = visual.sprite;
        const s = u._sim;
        if (!spr || !s || !SoldierUnitView.manifestReady()
            || spr.texture.key.indexOf('sold_') !== 0) {
            return super.updateInfantryAnim(visual, u, isMoving);
        }

        // ---- 方向 ----
        let dir;
        if (isMoving) {
            dir = soldierDirFromDelta(visual.lastDx || 0, visual.lastDy || 0);
        } else if (s.state === 'engage' && this._faceDir.has(u.id)) {
            dir = this._faceDir.get(u.id);
        } else if (visual.soldierDir != null) {
            dir = visual.soldierDir;
        } else {
            dir = soldierDirFromFacing(s.facing);
        }
        visual.soldierDir = dir;

        // ---- one-shot（手榴弾投擲など）が再生中なら優先 ----
        const os = this._oneShot.get(u.id);
        if (os) {
            if (!os.started) {
                if (this.scene.anims.exists(os.key)) {
                    os.started = true;
                    spr.play(os.key);
                    spr.once('animationcomplete-' + os.key, () => this._oneShot.delete(u.id));
                } else {
                    this._oneShot.delete(u.id);
                }
            }
            if (os.started) { this._syncShadowTex(visual, spr); return; }
        }

        // ---- 姿勢（制圧度＋被弾）: 遷移アニメを挟んだステートマシン ----
        const tick = (this.scene.sim && this.scene.sim._tick) || 0;
        const target = this._postureLevelOf(s, tick);
        if (visual.postureLv == null) visual.postureLv = target; // 出現時は即時

        // ヒステリシス: 姿勢を上げ直す（伏せ→立ち方向）のは HOLD 経過後のみ
        if (target > visual.postureLv) visual.postureHoldUntil = tick + POSTURE_HOLD_T;
        let effTarget = target;
        if (target < visual.postureLv && tick < (visual.postureHoldUntil || 0)) {
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

        // 目標姿勢へ1段ずつ遷移（stand↔kneel↔prone。stand↔prone は kneel 経由で連鎖）
        if (effTarget !== visual.postureLv) {
            const step = visual.postureLv + Math.sign(effTarget - visual.postureLv);
            const name = POSTURE_TRANS[visual.postureLv + '>' + step];
            const key = `sold_${name}_${dir}`;
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
        else if (s.state === 'engage') action = 'fire';

        let key = `sold_${posture}_${action}_${dir}`;
        if (!this.scene.anims.exists(key)) key = `sold_stand_idle_${dir}`;
        spr.play(key, true); // ignoreIfPlaying — 同一キーなら継続
        this._syncShadowTex(visual, spr);
    }

    _syncShadowTex(visual, spr) {
        const sh = visual.shadowSprite;
        if (sh && sh.texture && sh.texture.key !== spr.texture.key) {
            sh.setTexture(spr.texture.key);
        }
    }

    /** scene の SHOT イベントから: 射手を射線方向へ向け、被弾側を「被射撃中」として記録 */
    noteShot(shooterId, fromPx, toPx, targetId) {
        this._faceDir.set(shooterId, soldierDirFromDelta(toPx.x - fromPx.x, toPx.y - fromPx.y));
        if (targetId != null) {
            const tick = (this.scene.sim && this.scene.sim._tick) || 0;
            this._underFire.set(targetId, tick);
        }
    }

    /** scene の GRENADE イベントから: 投擲 one-shot（姿勢対応） */
    playThrow(simSoldier, fromPx, toPx) {
        if (!SoldierUnitView.manifestReady()) return;
        const dir = soldierDirFromDelta(toPx.x - fromPx.x, toPx.y - fromPx.y);
        this._faceDir.set(simSoldier.id, dir);
        const posture = this._postureOf(simSoldier);
        this._oneShot.set(simSoldier.id, { key: `sold_${posture}_throw_grenade_${dir}`, started: false });
    }

    /** scene の DOWN イベントから: dying を一回再生し、最終フレームで死体として残す */
    spawnCorpse(simSoldier) {
        if (!SoldierUnitView.manifestReady()) return;
        const man = window.SOLDIER_MANIFEST;
        const v = this.visuals.get(simSoldier.id); // dispatch は視覚破棄より先に走る
        const p = (v && v.container)
            ? { x: v.container.x, y: v.container.y }
            : Renderer.hexToPx(simSoldier.q, simSoldier.r);
        const dir = this._faceDir.get(simSoldier.id)
            ?? (v && v.soldierDir) ?? soldierDirFromFacing(simSoldier.facing);
        // 死亡時は「表示中の姿勢」から倒れる（遷移中なら sim 由来の姿勢へフォールバック）
        const posture = (v && v.postureLv != null && !v.postureTrans)
            ? (POSTURE_NAMES[v.postureLv] || 'stand')
            : this._postureOf(simSoldier);
        const key = `sold_${posture}_dying_${dir}`;
        if (!this.scene.anims.exists(key)) return;

        const scale = SOLDIER_VIEW_H / man.frameHeight;
        const c = this.scene.add.sprite(p.x, p.y - 20, `sold_${posture}_dying`, 0);
        c.setOrigin((man.anchorX != null) ? man.anchorX : 0.5, 0.55);
        c.setScale(scale);
        c.setDepth(9); // 地形(0)/道路(1.6)/装飾(8) より上、ユニット(20) より下
        c.setTint(0xbbbbbb);
        c.play(key); // repeat:0 → 最終フレームで停止＝死体
        this._corpses.push(c);
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
        if (s.state === 'pinned' || s.state === 'down' || s.suppression >= (T.PINNED_AT || 999)) lv = 2;
        else if (s.state === 'suppressed' || s.suppression >= (T.SUPPRESSED_AT || 999)) lv = 1;
        const uf = this._underFire.get(s.id);
        if (uf != null && tick - uf <= UNDER_FIRE_T) lv = (lv >= 1) ? 2 : Math.max(lv, 1);
        return lv;
    }

    _postureOf(s) {
        const tick = (this.scene.sim && this.scene.sim._tick) || 0;
        return POSTURE_NAMES[this._postureLevelOf(s, tick)] || 'stand';
    }

    clear() {
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
}

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

// v1 でロードする 15 アクション（姿勢遷移 4 種は v2 送り）
window.SOLDIER_LOAD_ACTIONS = [
    'stand_idle', 'stand_forward', 'stand_fire', 'stand_dying', 'stand_throw_grenade',
    'kneel_idle', 'kneel_forward', 'kneel_fire', 'kneel_dying', 'kneel_throw_grenade',
    'prone_idle', 'prone_forward', 'prone_fire', 'prone_dying', 'prone_throw_grenade',
];

// 画面上の兵士の見かけ高さ（px）。旧 soldier_crawl は 256*0.15 ≈ 38px だった
const SOLDIER_VIEW_H = 50;

/** 画面座標デルタ → 方向行 (0..7 = S,SE,E,NE,N,NW,W,SW)。y は下向き正。 */
function soldierDirFromDelta(dx, dy) {
    if (!dx && !dy) return 0;
    let d = Math.round(Math.atan2(-dy, dx) / (Math.PI / 4)) + 2; // E=2 基準
    d %= 8; if (d < 0) d += 8;
    return d;
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
        this._faceDir = new Map();  // soldierId -> 直近の射線方向（SHOT イベント由来）
        this._oneShot = new Map();  // soldierId -> { key, started } 一回性アニメ
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

        // ---- 姿勢（制圧度）× 動作（状態） ----
        const T = (typeof SIM_TUNING !== 'undefined') ? SIM_TUNING : {};
        let posture = 'stand';
        if (s.state === 'pinned' || s.suppression >= (T.PINNED_AT || 999)) posture = 'prone';
        else if (s.state === 'suppressed' || s.suppression >= (T.SUPPRESSED_AT || 999)) posture = 'kneel';

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

    /** scene の SHOT イベントから: 射手を射線方向へ向ける */
    noteShot(shooterId, fromPx, toPx) {
        this._faceDir.set(shooterId, soldierDirFromDelta(toPx.x - fromPx.x, toPx.y - fromPx.y));
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
        const posture = this._postureOf(simSoldier);
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

    _postureOf(s) {
        const T = (typeof SIM_TUNING !== 'undefined') ? SIM_TUNING : {};
        if (s.state === 'pinned' || s.suppression >= (T.PINNED_AT || 999)) return 'prone';
        if (s.state === 'suppressed' || s.suppression >= (T.SUPPRESSED_AT || 999)) return 'kneel';
        return 'stand';
    }

    clear() {
        super.clear();
        this._corpses.forEach((c) => { try { c.destroy(); } catch (e) { } });
        this._corpses = [];
        this._faceDir.clear();
        this._oneShot.clear();
    }
}

if (typeof window !== 'undefined') {
    window.SoldierUnitView = SoldierUnitView;
    window.soldierDirFromDelta = soldierDirFromDelta;
}

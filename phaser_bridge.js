/** PHASER BRIDGE: Precise Click Handling & Aerial Support UI (Safety Check Added) */
let phaserGame = null;
window.HIGH_RES_SCALE = 2.0;
const psFxParams = typeof URLSearchParams !== 'undefined'
    ? new URLSearchParams(window.location.search) : null;
window.PS_ORIGINAL_FX = {
    // Private research benchmark only. Commercial/default runtime never loads PS pixels.
    enabled: !!(window.FxPacks && FxPacks.activeId === 'panzer_reference'),
    preview: !!(window.FxPacks && FxPacks.activeId === 'panzer_reference'
        && psFxParams.get('psfxpreview') === '1'),
    fire: { key: 'ps_fire_cell_00', frames: 133, frameWidth: 89, frameHeight: 175,
        anchorX: 51, anchorY: 165, fps: 30, repeat: true },
    fireAlt: { key: 'ps_fire_cell_01', frames: 135, frameWidth: 91, frameHeight: 188,
        anchorX: 49, anchorY: 176, fps: 30, repeat: true },
    dust: { key: 'ps_gun_light_dust_00', frames: 72, frameWidth: 150, frameHeight: 89,
        anchorX: 66, anchorY: 49, fps: 30, repeat: false },
    smoke: { key: 'ps_gun_medium_smoke_00', frames: 108, frameWidth: 67, frameHeight: 138,
        anchorX: 31, anchorY: 124, fps: 30, repeat: false }
};
// Review-only original Fire V1. It is never loaded or called without the URL gate.
window.PS_FIRE_PROTOTYPE = {
    // V1 used PS imagery as an ImageGen reference and remains research-only/rejected.
    enabled: !!(window.FxPacks && FxPacks.activeId === 'panzer_reference'
        && psFxParams.get('psfireprototype') === '1'),
    key: 'ps_fire_prototype_v1', frames: 32, frameWidth: 96, frameHeight: 160,
    anchorX: 48, anchorY: 154, fps: 30, repeat: true, scale: 0.72
};
window.M2_CRATER_PREVIEW = !!(psFxParams && psFxParams.get('m2craterpreview') === '1');
window.MUZZLE_SMOKE_FX = {
    enabled: !!(psFxParams && (psFxParams.get('muzzlesmoke') === '1'
        || psFxParams.get('muzzlesmokepreview') === '1')),
    preview: !!(psFxParams && psFxParams.get('muzzlesmokepreview') === '1'),
    key: 'ps_muzzle_smoke_v3', frames: 32, fps: 30,
    frameWidth: 72, frameHeight: 64, anchorX: 5, anchorY: 12,
    scale: 0.62, alpha: 0.46, breezeX: 7, breezeY: -3,
    _seq: 0
};
window.PS_FX_INVENTORY_PREVIEW = (window.FxPacks && FxPacks.activeId === 'panzer_reference')
    ? psFxParams.get('psfxfamily') : null;
window.PS_FX_INVENTORY_PREVIEW_CLIP = psFxParams ? Number(psFxParams.get('psfxclip') || 0) : 0;

/**
 * 兵士のHPゲージ/情報アイコン層の深度。戦場の立体物（PS立体物は depth = world Y、
 * 植生レイヤーは 10）より必ず上、戦術ポーズ(90000)より下。
 */
const HP_OVERLAY_DEPTH = 50000;
window.HP_OVERLAY_DEPTH = HP_OVERLAY_DEPTH;

const FUSABLE_UNIT_TYPES = ['rifleman', 'scout', 'gunner', 'sniper', 'mortar_gunner', 'tank_pz4', 'tank_tiger']
  .filter(key => !UNIT_TEMPLATES[key]?.isTank || (typeof FEATURE_TANK_UNITS !== 'undefined' && FEATURE_TANK_UNITS));

function generateFusionData() {
  const skillKeys = Object.keys(typeof SKILLS !== 'undefined' ? SKILLS : {}).filter(z => z !== 'Hero');
  const count = 1 + Math.floor(Math.random() * 3);
  const skills = [];
  for (let i = 0; i < count && skillKeys.length > 0; i++) {
    const idx = Math.floor(Math.random() * skillKeys.length);
    const k = skillKeys.splice(idx, 1)[0];
    if (k) skills.push(k);
  }
  const hpBoost = 0.05 + Math.random() * 0.10;
  const apBonus = Math.random() < 0.15 ? 1 : 0;
  return { skills, hpBoost, apBonus };
} 

window.getCardTextureKey = function(scene, type, portraitIndex, unitName) {
    const key = (unitName ? `card_texture_${type}_p${portraitIndex}_n${unitName}` : ((portraitIndex !== undefined && portraitIndex !== null)
        ? `card_texture_${type}_p${portraitIndex}` : `card_texture_${type}`));
    if (scene.textures.exists(key)) return key;
    if (typeof WPNS !== 'undefined' && WPNS[type]) {
        const w = WPNS[type];
        const canvas = document.createElement('canvas'); canvas.width = 140 * 2; canvas.height = 200 * 2;
        const ctx = canvas.getContext('2d'); ctx.scale(2, 2);
        ctx.fillStyle = "#1a1a1a"; ctx.fillRect(0, 0, 140, 200);
        ctx.strokeStyle = "#d84"; ctx.lineWidth = 2; ctx.strokeRect(0, 0, 140, 200);
        ctx.fillStyle = "#2a201a"; ctx.fillRect(2, 2, 136, 30);
        ctx.fillStyle = "#d84"; ctx.font = "bold 14px sans-serif"; ctx.textAlign = "center"; 
        ctx.fillText(w.name, 70, 22);
        ctx.fillStyle = "#111"; ctx.fillRect(20, 40, 100, 100);
        ctx.fillStyle = "#555"; ctx.font = "10px sans-serif"; ctx.textAlign = "center";
        ctx.fillText("WEAPONRY", 70, 90);
        ctx.fillStyle = "#888"; ctx.font = "10px sans-serif"; 
        ctx.fillText(w.desc || "", 70, 155);
        ctx.fillStyle = "#ccc"; ctx.font = "11px monospace"; 
        ctx.fillText(`RNG:${w.rng||'-'} DMG:${w.dmg||'-'}`, 70, 175);
        ctx.fillStyle = "#d84"; ctx.font = "10px sans-serif"; 
        ctx.fillText(w.type || 'weapon', 70, 190);
        scene.textures.addCanvas(key, canvas); return key;
    }
    let template = { name: type, role: 'unknown', hp: 100, ap: 4, main: 'rifle' };
    if (typeof UNIT_TEMPLATES !== 'undefined' && UNIT_TEMPLATES[type]) { template = UNIT_TEMPLATES[type]; }
    const canvas = document.createElement('canvas'); canvas.width = 140 * 2; canvas.height = 200 * 2;
    const ctx = canvas.getContext('2d'); ctx.scale(2, 2);
    ctx.fillStyle = "#1a1a1a"; ctx.fillRect(0, 0, 140, 200);
    ctx.strokeStyle = "#555"; ctx.lineWidth = 2; ctx.strokeRect(0, 0, 140, 200);
    ctx.fillStyle = "#111"; ctx.fillRect(2, 2, 136, 30);
    ctx.fillStyle = "#d84"; ctx.font = "bold 14px sans-serif"; ctx.textAlign = "center";
    const isInfantry = (template.role && String(template.role).toLowerCase() === 'infantry');
    ctx.fillText((isInfantry && unitName) ? unitName : template.name, 70, 22);
    ctx.fillStyle = "#000"; ctx.fillRect(20, 40, 100, 100);
    let portraitDrawn = false;
    if (type === 'aerial' && scene.textures.exists('aerial_spt')) {
        try {
            const src = scene.textures.get('aerial_spt').getSourceImage();
            if (src && src.width) { ctx.drawImage(src, 20, 40, 100, 100); portraitDrawn = true; }
        } catch (e) { }
    }
    if (!portraitDrawn) {
        const portraitKey = (portraitIndex !== undefined && portraitIndex !== null)
            ? ('portrait_' + ((portraitIndex % (typeof PORTRAIT_AVAILABLE !== 'undefined' ? PORTRAIT_AVAILABLE : 7)) + 1)) : null;
        if (portraitKey && scene.textures.exists(portraitKey)) {
            try {
                const src = scene.textures.get(portraitKey).getSourceImage();
                if (src && src.width) { ctx.drawImage(src, 20, 40, 100, 100); portraitDrawn = true; }
            } catch (e) { }
        }
    }
    if (!portraitDrawn) {
        const seed = type.length * 999; const rnd = function(s) { return Math.abs(Math.sin(s * 12.9898) * 43758.5453) % 1; };
        const skinTones = ["#ffdbac", "#f1c27d", "#e0ac69"]; ctx.fillStyle = skinTones[Math.floor(rnd(seed) * skinTones.length)];
        ctx.beginPath(); ctx.arc(70, 90, 30, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = "#343"; ctx.beginPath(); ctx.arc(70, 80, 32, Math.PI, 0); ctx.lineTo(102, 80); ctx.lineTo(38, 80); ctx.fill();
    }
    ctx.fillStyle = "#888"; ctx.font = "10px sans-serif";
    ctx.fillText(isInfantry ? template.name : (template.role ? template.role.toUpperCase() : "UNIT"), 70, 155);
    let wpnName = template.main || "-"; if (typeof WPNS !== 'undefined' && WPNS[template.main]) { wpnName = WPNS[template.main].name; }
    ctx.fillStyle = "#ccc"; ctx.font = "11px monospace";
    // AP は旧ターン制の資源。RTwP ではHPだけ出す（カード生成は attach より前に走るので isEnabled で見る）
    const rtwpMode = window.RtwpBattle && window.RtwpBattle.isEnabled && window.RtwpBattle.isEnabled();
    ctx.fillText(rtwpMode ? `HP:${template.hp||100}` : `HP:${template.hp||100} AP:${template.ap||4}`, 70, 175);
    ctx.fillStyle = "#d84"; ctx.font = "10px sans-serif";
    ctx.fillText(wpnName, 70, 190);
    scene.textures.addCanvas(key, canvas); return key;
};

window.createGradientTexture = function(scene) {
    const key = 'ui_gradient'; if (scene.textures.exists(key)) return;
    const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 100;
    const ctx = canvas.getContext('2d'); const grd = ctx.createLinearGradient(0, 0, 0, 100);
    grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,0.9)');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, 100, 100); scene.textures.addCanvas(key, canvas);
};

window.createHexTexture = function(scene) {
    if (scene.textures.exists('hex_base')) return;
    const g = scene.make.graphics({x: 0, y: 0, add: false});
    const baseSize = (typeof HEX_SIZE !== 'undefined' ? HEX_SIZE : 54);
    const size = baseSize * window.HIGH_RES_SCALE * 1.02;
    const w = size * Math.sqrt(3); const h = size * 2;
    g.fillStyle(0xffffff); g.beginPath();
    for (let i = 0; i < 6; i++) { const angle_deg = 90 + 60 * i; const angle_rad = Math.PI / 180 * angle_deg; const px = w/2 + size * Math.cos(angle_rad); const py = h/2 + size * Math.sin(angle_rad); if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); }
    g.closePath(); g.fillPath(); g.generateTexture('hex_base', w, h);
};

const Renderer = {
    game: null, 
    isMapDragging: false, 
    isCardDragging: false,
    suppressMapClick: false,
    draggedCardType: null,
    draggedCardFusionData: null,
    draggedCard: null,
    _resizeFrame: 0,
    _resizeTimer: 0,
    _resizeForce: false,
    _resizeRecoveryTimers: [],
    _resizeObserver: null,
    _resizeWatchInstalled: false,
    _inputBoundsWatchInstalled: false,
    _dprMedia: null,
    _dprMediaListener: null,
    _lastAppliedViewport: null,

    init(canvasElement) {
        // 19モーション manifest（phaser_soldier_view.js が先行フェッチ）の解決を待って
        // から Phaser を起動する。preload が manifest の寸法に依存するため。
        // 解決済み/ヘルパー不在なら即起動（旧 soldier_crawl で劣化動作）。
        if (this._bootPending) return;
        if (typeof window.loadSoldierManifest === 'function' && window.SOLDIER_MANIFEST === undefined) {
            this._bootPending = true;
            window.loadSoldierManifest().then(() => { this._bootPending = false; this._boot(canvasElement); });
            return;
        }
        this._boot(canvasElement);
    },

    /**
     * 高DPI対応の受け皿。**現状は常に 1（無効）。**
     *
     * sim_battle.html では実効（dpr=1.5 で画素数2.25倍・61fps維持）だが、本編は
     * 起動時に #game-view の clientWidth が 0 で、Renderer.resize() を呼んでも
     * キャンバスが追従しない既存の挙動がある（この変更の前から同じ）。正しい寸法に
     * 到達できないため実機で検証できず、未検証のまま本編の描画解像度を変えるのは
     * 避けている。キャンバスのリサイズが直った後に 1 以外を入れれば効く。
     */
    RENDER_DPR: 1,

    _boot(canvasElement) {
        const initialSize = this._measureGameView() || { width: 1280, height: 720 };
        const config = { type: Phaser.AUTO, parent: 'game-view', width: initialSize.width, height: initialSize.height, scale: { parent: 'game-view', mode: Phaser.Scale.NONE, width: initialSize.width, height: initialSize.height, autoRound: true }, backgroundColor: '#2a2824', pixelArt: false, render: { roundPixels: false, mipmapFilter: 'LINEAR_MIPMAP_LINEAR' }, scene: [MainScene, UIScene], fps: { target: 30 }, physics: { default: 'arcade', arcade: { debug: false } }, input: { activePointers: 1 } };
        this.game = new Phaser.Game(config); 
        phaserGame = this.game;
        window.phaserGame = this.game;
        window.notifySidebarResize = () => {
            if (!this.game || !this.game.scene) return;
            const w = this.game.scale.width;
            const h = this.game.scale.height;
            const ui = this.game.scene.getScene('UIScene');
            if (ui && ui.onResize) ui.onResize({ width: w, height: h });
            const main = this.game.scene.getScene('MainScene');
            if (main && main.updateSidebarViewport) {
                main.updateSidebarViewport();
                if (main.mapGenerated && main.centerMap) main.centerMap();
            }
            if (window.phaserSidebar && window.phaserSidebar.onResize) window.phaserSidebar.onResize(w, h);
            if (window.gameLogic && window.gameLogic.updateSidebar) window.gameLogic.updateSidebar();
        };
        window.setHandCardsFusionLevel = function(level) {
            if (!phaserGame || !phaserGame.scene) return;
            const ui = phaserGame.scene.getScene('UIScene');
            if (!ui || !ui.cards) return;
            const L = Math.max(1, Math.min(3, parseInt(level, 10) || 1));
            ui.cards.forEach(function(card) {
                const isUnit = card.cardType && typeof UNIT_TEMPLATES !== 'undefined' && UNIT_TEMPLATES[card.cardType] && !(typeof WPNS !== 'undefined' && WPNS[card.cardType]);
                if (!isUnit) return;
                card.fusionCount = L;
                card.fusionData = L >= 2 ? generateFusionData() : null;
                if (card.sparklerParticles) card.sparklerParticles.length = 0;
            });
        };
        this._installResizeWatch();
        this._installInputBoundsWatch();
        this.scheduleResize(true);
        const startAudio = () => { if(window.Sfx && window.Sfx.ctx && window.Sfx.ctx.state === 'suspended') { window.Sfx.ctx.resume(); } };
        document.addEventListener('click', startAudio); document.addEventListener('keydown', startAudio);
    },
    _measureGameView() {
        const view = document.getElementById('game-view');
        if (!view) return null;
        const rect = view.getBoundingClientRect ? view.getBoundingClientRect() : null;
        const width = Math.round((rect && rect.width) || view.clientWidth || 0);
        const height = Math.round((rect && rect.height) || view.clientHeight || 0);
        if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) return null;
        return { width, height };
    },
    scheduleResize(force = false) {
        if (!this.game) return;
        this._resizeForce = this._resizeForce || force;
        if (this._resizeFrame) cancelAnimationFrame(this._resizeFrame);
        if (this._resizeTimer) clearTimeout(this._resizeTimer);
        this._resizeRecoveryTimers.forEach(clearTimeout);
        this._resizeRecoveryTimers = [];
        // A Windows monitor transition emits several viewport and DPR changes.
        // Applying each intermediate size makes Phaser resize the WebGL buffer
        // repeatedly and can leave a Scene camera on an obsolete scissor rect.
        this._resizeTimer = setTimeout(() => {
            this._resizeTimer = 0;
            const first = this._measureGameView();
            const firstDpr = Number(window.devicePixelRatio) || 1;
            if (!first) return;
            this._resizeFrame = requestAnimationFrame(() => {
                this._resizeFrame = 0;
                const settled = this._measureGameView();
                const settledDpr = Number(window.devicePixelRatio) || 1;
                if (!settled) return;
                if (first.width !== settled.width || first.height !== settled.height || firstDpr !== settledDpr) {
                    this.scheduleResize();
                    return;
                }
                const applyForce = this._resizeForce;
                this._resizeForce = false;
                this.resize(applyForce);
                // Chrome can replace the GPU drawing surface after the CSS
                // viewport has already settled during a monitor transition.
                // Re-assert cached camera, GL and input state without changing
                // the canvas backing size again.
                [450, 1100].forEach((delay) => {
                    this._resizeRecoveryTimers.push(setTimeout(() => this.recoverViewport(), delay));
                });
            });
        }, 160);
    },
    _watchDevicePixelRatio() {
        if (!window.matchMedia) return;
        if (this._dprMedia && this._dprMediaListener) {
            if (this._dprMedia.removeEventListener) this._dprMedia.removeEventListener('change', this._dprMediaListener);
            else if (this._dprMedia.removeListener) this._dprMedia.removeListener(this._dprMediaListener);
        }
        const dpr = Number(window.devicePixelRatio) || 1;
        this._dprMedia = window.matchMedia(`(resolution: ${dpr}dppx)`);
        this._dprMediaListener = () => {
            this._watchDevicePixelRatio();
            this.scheduleResize();
        };
        if (this._dprMedia.addEventListener) this._dprMedia.addEventListener('change', this._dprMediaListener);
        else if (this._dprMedia.addListener) this._dprMedia.addListener(this._dprMediaListener);
    },
    _installResizeWatch() {
        if (this._resizeWatchInstalled) return;
        this._resizeWatchInstalled = true;
        const queue = () => this.scheduleResize();
        window.addEventListener('resize', queue);
        window.addEventListener('pageshow', () => this.scheduleResize(true));
        if (window.visualViewport) window.visualViewport.addEventListener('resize', queue);
        const view = document.getElementById('game-view');
        if (view && typeof ResizeObserver !== 'undefined') {
            this._resizeObserver = new ResizeObserver(queue);
            this._resizeObserver.observe(view);
        }
        this._watchDevicePixelRatio();
    },
    _installInputBoundsWatch() {
        if (this._inputBoundsWatchInstalled || !this.game || !this.game.canvas) return;
        this._inputBoundsWatchInstalled = true;
        const refresh = () => this._refreshInputBounds();
        // Capture runs before Phaser's own bubbling listeners, so a first
        // click immediately after crossing monitors uses the new coordinates.
        ['pointerdown', 'pointermove', 'wheel'].forEach((type) => {
            this.game.canvas.addEventListener(type, refresh, { capture: true, passive: true });
        });
    },
    _refreshInputBounds() {
        const scale = this.game && this.game.scale;
        if (!scale) return false;
        if (scale.updateBounds) scale.updateBounds();
        const bounds = scale.canvasBounds;
        const base = scale.baseSize;
        if (scale.displayScale && bounds && base && bounds.width > 0 && bounds.height > 0) {
            scale.displayScale.set(base.width / bounds.width, base.height / bounds.height);
        }
        return true;
    },
    resize(force = false) {
        if (!this.game || !this.game.scale) return false;
        const size = this._measureGameView();
        if (!size) return false;
        const dpr = Number(window.devicePixelRatio) || 1;
        const canvas = this.game.canvas || (this.game.renderer && this.game.renderer.canvas);
        const resolution = (this.game.renderer && Number(this.game.renderer.resolution)) || 1;
        const expectedBufferWidth = Math.round(size.width * resolution);
        const expectedBufferHeight = Math.round(size.height * resolution);
        const canvasRect = canvas && canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
        const canvasMatches = !canvas || (
            canvas.width === expectedBufferWidth
            && canvas.height === expectedBufferHeight
            && (!canvasRect || (
                Math.round(canvasRect.width) === size.width
                && Math.round(canvasRect.height) === size.height
            ))
        );
        const last = this._lastAppliedViewport;
        const scaleMatches = Math.round(this.game.scale.width) === size.width
            && Math.round(this.game.scale.height) === size.height;
        if (!force && last && last.width === size.width && last.height === size.height
            && last.dpr === dpr && scaleMatches && canvasMatches) return false;
        this._lastAppliedViewport = { width: size.width, height: size.height, dpr };
        this.game.scale.resize(size.width, size.height);
        this._synchronizeSceneCameras(size.width, size.height);
        this._resetWebGLViewport(size.width, size.height);
        this._refreshInputBounds();
        return true;
    },
    recoverViewport() {
        if (!this.game || !this.game.scale) return false;
        const size = this._measureGameView();
        if (!size) return false;
        const canvas = this.game.canvas;
        const scaleMismatch = Math.round(this.game.scale.width) !== size.width
            || Math.round(this.game.scale.height) !== size.height;
        const canvasMismatch = canvas && (canvas.width !== size.width || canvas.height !== size.height);
        if (scaleMismatch || canvasMismatch) return this.resize(true);
        this._synchronizeSceneCameras(size.width, size.height);
        this._resetWebGLViewport(size.width, size.height);
        this._refreshInputBounds();
        return true;
    },
    _synchronizeSceneCameras(width, height) {
        const scenes = this.game && this.game.scene && this.game.scene.scenes;
        if (!Array.isArray(scenes)) return;
        scenes.forEach((scene) => {
            const camera = scene && scene.cameras && scene.cameras.main;
            if (!camera) return;
            camera.setPosition(0, 0);
            camera.setSize(width, height);
        });
        const main = this.game.scene.getScene && this.game.scene.getScene('MainScene');
        if (main && main.mapGenerated && main.centerMap) main.centerMap();
        if (main && main.tacticalMinimap && main.tacticalMinimap.layout) main.tacticalMinimap.layout();
    },
    _resetWebGLViewport(width, height) {
        const renderer = this.game && this.game.renderer;
        const gl = renderer && renderer.gl;
        if (!gl) return;
        // Phaser 3.60 clears before it resets the frame scissor. Replace both
        // its cached state and the actual WebGL state so an obsolete UI-camera
        // scissor cannot preserve strips from the previous monitor.
        if (renderer.resize) renderer.resize(width, height);
        const full = renderer.defaultScissor || [0, 0, width, height];
        full[0] = 0;
        full[1] = 0;
        full[2] = width;
        full[3] = height;
        renderer.currentScissor = full;
        if (renderer.scissorStack) {
            renderer.scissorStack.length = 0;
            renderer.scissorStack.push(full);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, width, height);
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(0, Math.max(0, gl.drawingBufferHeight - height), width, height);
    },
    hexToPx(q, r) { return { x: HEX_SIZE * Math.sqrt(3) * (q + r/2), y: HEX_SIZE * (3/2) * r }; },
    pxToHex(mx, my) { const main = phaserGame.scene.getScene('MainScene'); if(!main) return {q:0, r:0}; const w = main.cameras.main.getWorldPoint(mx, my); return this.roundHex((Math.sqrt(3)/3*w.x - w.y/3)/HEX_SIZE, (2/3*w.y)/HEX_SIZE); },
    roundHex(q,r) { let rq=Math.round(q), rr=Math.round(r), rs=Math.round(-q-r); const dq=Math.abs(rq-q), dr=Math.abs(rr-r), ds=Math.abs(rs-(-q-r)); if(dq>dr&&dq>ds) rq=-rr-rs; else if(dr>ds) rr=-rq-rs; return {q:rq, r:rr}; },
    centerOn(q, r) { const main = this.game.scene.getScene('MainScene'); if (main && main.centerCamera) main.centerCamera(q, r); },
    centerMap() { const main = this.game.scene.getScene('MainScene'); if (main && main.centerMap) main.centerMap(); },
    showFloatText(q, r, text, color) { const main = this.game.scene.getScene('MainScene'); if (main && main.showFloatText) main.showFloatText(q, r, text, color); },
    dealCards(types) { let ui = this.game.scene.getScene('UIScene'); if(!ui || !ui.sys) ui = this.game.scene.scenes.find(s => s.scene.key === 'UIScene'); if(ui) ui.dealStart(types); },
    dealCard(typeOrData) { const ui = this.game.scene.getScene('UIScene'); if(ui) ui.addCardToHand(typeOrData); },
    getFusedCardsFromHand() {
        const ui = this.game ? this.game.scene.getScene('UIScene') : null;
        if (!ui || !ui.cards) return [];
        return ui.cards.filter(c => c.fusionData).map(c => ({
            type: c.cardType,
            fusionData: c.fusionData,
            fusionCount: c.fusionCount,
            name: c.unitName,
            portraitIndex: c.portraitIndex
        }));
    },
    checkUIHover(x, y, pointerEvent) { 
        if (this.isCardDragging) return true;
        const app = document.getElementById('app');
        if (app && app.classList.contains('phaser-sidebar') && this.game) {
            const w = this.game.scale.width;
            if (x >= w - (window.getSidebarWidth ? window.getSidebarWidth() : 340)) return true;
        }
        const ui = this.game ? this.game.scene.getScene('UIScene') : null; 
        if (ui) {
            for (let card of ui.cards) { const dx = Math.abs(x - card.x); const dy = Math.abs(y - card.y); if (dx < 70 && dy < 100) return true; } 
        }
        const checkX = (pointerEvent && pointerEvent.clientX !== undefined) ? pointerEvent.clientX : x;
        const checkY = (pointerEvent && pointerEvent.clientY !== undefined) ? pointerEvent.clientY : y;
        const menus = ['context-menu', 'command-menu', 'warning-modal'];
        for (let id of menus) {
            const el = document.getElementById(id);
            if (el && el.offsetParent !== null) { 
                const rect = el.getBoundingClientRect();
                if (checkX >= rect.left && checkX <= rect.right && checkY >= rect.top && checkY <= rect.bottom) { return true; }
            }
        }
        return false; 
    },
    playAttackAnim(attacker, target) { const main = this.game.scene.getScene('MainScene'); if (main && main.unitView) main.unitView.triggerAttack(attacker, target); },
    getMuzzlePoint(attacker, target) { const main = this.game.scene.getScene('MainScene'); return main && main.unitView && main.unitView.getMuzzlePoint ? main.unitView.getMuzzlePoint(attacker, target) : null; },
    playExplosion(x, y, tier, hex, opts) { const main = this.game.scene.getScene('MainScene'); if (main) main.triggerExplosion(x, y, tier, hex, opts); },
    playPsFx(x, y, kind, opts) { const main = this.game.scene.getScene('MainScene'); return !!(main && main.playPsOriginalFx(x, y, kind, opts)); },
    playMuzzleFlash(x, y, angle, weapon) { const main = this.game.scene.getScene('MainScene'); if (main && main.triggerMuzzleFlash) main.triggerMuzzleFlash(x, y, angle, weapon); },
    playMuzzleBurst(x, y, angle, weapon, rounds) { if (window.VFX && window.VFX.playMuzzleBurst) window.VFX.playMuzzleBurst(x, y, angle, weapon, rounds); else this.playMuzzleFlash(x, y, angle, weapon); },
    playMuzzleSmoke(x, y, angle, weapon, rounds, opts) { const main = this.game.scene.getScene('MainScene'); return !!(main && main.playMuzzleSmoke(x, y, angle, weapon, rounds, opts)); },
    playImpactSmoke(x, y, scale) { if (window.VFX && window.VFX.playImpactSmoke) window.VFX.playImpactSmoke(x, y, scale); },
    generateFaceIcon(seed) { const c = document.createElement('canvas'); c.width = 64; c.height = 64; const ctx = c.getContext('2d'); const rnd = function() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }; ctx.fillStyle = "#334"; ctx.fillRect(0,0,64,64); const skinTones = ["#ffdbac", "#f1c27d", "#e0ac69", "#8d5524"]; ctx.fillStyle = skinTones[Math.floor(rnd() * skinTones.length)]; ctx.beginPath(); ctx.arc(32, 36, 18, 0, Math.PI*2); ctx.fill(); ctx.fillStyle = "#343"; ctx.beginPath(); ctx.arc(32, 28, 20, Math.PI, 0); ctx.lineTo(54, 30); ctx.lineTo(10, 30); ctx.fill(); ctx.strokeStyle = "#121"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(10,28); ctx.lineTo(54,28); ctx.stroke(); ctx.fillStyle = "#000"; const eyeY = 36; const eyeOff = 6 + rnd()*2; ctx.fillRect(32-eyeOff-2, eyeY, 4, 2); ctx.fillRect(32+eyeOff-2, eyeY, 4, 2); ctx.strokeStyle = "#a76"; ctx.lineWidth = 1; ctx.beginPath(); const mouthW = 4 + rnd()*6; ctx.moveTo(32-mouthW/2, 48); ctx.lineTo(32+mouthW/2, 48); ctx.stroke(); if (rnd() < 0.5) { ctx.fillStyle = "rgba(0,0,0,0.2)"; ctx.fillRect(20 + rnd()*20, 30 + rnd()*20, 4, 2); } return c.toDataURL(); }
};
window.Renderer = Renderer;

/**
 * KHAOS製シネマティック爆発 (asset/explosion_khaos_*_384.png, 5ティア×3バリアント)。
 * メタデータは各シートの .json サイドカーと一致させること。
 * sizeMul はヘックス幅(√3*HEX_SIZE)に対する表示倍率。
 * shake は Phaser cameras.main.shake(duration, intensity)。
 */
window.KHAOS_FX = {
    TIERS: {
        t1_12mm:       { frames: 8,  fps: 20, sizeMul: 1.0 },
        t2_grenade:    { frames: 12, fps: 20, sizeMul: 1.3 },
        t3_mortar60:   { frames: 18, fps: 20, sizeMul: 1.7 },
        t4_shell120:   { frames: 32, fps: 24, sizeMul: 2.3, shake: { dur: 320, int: 0.006 }, damageBuilding: true },
        t5_aerialbomb: { frames: 40, fps: 24, sizeMul: 3.0, shake: { dur: 600, int: 0.014 }, damageBuilding: true },
    },
    /**
     * 立体物(建物/柵/低木)への破壊半径と段階数。半径はワールドpx。
     * ヘックス幅(√3*HEX_SIZE≈93.5)を基準にティアの sizeMul と揃えてある。
     * severity = 一度の着弾で進む破壊段階。建物は4〜6段階あるので、
     * 小口径では崩れきらず、大口径は一撃で複数段階進む。
     */
    BLAST: {
        t1_12mm:       { radius: 26,  severity: 0 },  // 銃弾。痕は残るが構造は壊さない
        t2_grenade:    { radius: 45,  severity: 1 },
        t3_mortar60:   { radius: 70,  severity: 1 },
        t4_shell120:   { radius: 105, severity: 2 },
        t5_aerialbomb: { radius: 150, severity: 3 },
    },
    VARIANTS: ['', '_v2', '_v3'],
    FRAME: 384,
    key(tier, v) { return `khaos_${tier}${v}`; },
    /** asset/muzzle_flash_128.png (4フレーム、2026-07-13納品) */
    MUZZLE_READY: true
};

/** デッキカードをサイドバー装備スロットへ D&D できるか */
function cardCanEquipToLoadout(cardOrCode) {
    const src = (cardOrCode && cardOrCode.weaponData) || cardOrCode;
    if (window.gameLogic && window.gameLogic.canEquipItemFromDeck) {
        return window.gameLogic.canEquipItemFromDeck(src);
    }
    const code = typeof src === 'string' ? src : src && src.code;
    return !!(typeof WPNS !== 'undefined' && code && WPNS[code] && WPNS[code].attr === (typeof ATTR !== 'undefined' ? ATTR.WEAPON : 'Weaponry'));
}

class Card extends Phaser.GameObjects.Container {
    constructor(scene, x, y, typeOrData) {
        super(scene, x, y);
        const isObj = typeof typeOrData === 'object' && typeOrData !== null;
        this.cardType = isObj ? typeOrData.type : typeOrData;
        this.fusionData = isObj && typeOrData.fusionData ? typeOrData.fusionData : null;
        this.fusionCount = isObj && typeOrData.fusionCount != null ? typeOrData.fusionCount : (this.fusionData ? 2 : 0);
        this.portraitIndex = isObj && typeOrData.portraitIndex !== undefined ? typeOrData.portraitIndex : undefined;
        // 武器カードの場合、実インスタンス（弾数などの状態を含む）を保持できる
        this.weaponData = isObj && typeOrData.weaponData ? typeOrData.weaponData : null;
        this.isRainbowWeapon = !!(this.weaponData && this.weaponData.isRainbow);
        this.unitName = isObj && typeOrData.name ? typeOrData.name : undefined;
        this.scene = scene; this.setSize(140, 200);
        const texKey = window.getCardTextureKey(scene, this.cardType, this.portraitIndex, this.unitName);
        this.frameImage = scene.add.image(0, 0, texKey).setDisplaySize(140, 200);
        this.frameImage.setInteractive({ useHandCursor: true, draggable: true });
        const shadow = scene.add.rectangle(6, 6, 130, 190, 0x000000, 0.5); this.add(shadow); this.add(this.frameImage);
        this.rainbowGraphics = scene.add.graphics().setDepth(1);
        this.fusionCandidateGraphics = scene.add.graphics().setDepth(2);
        this.auraGraphics = scene.add.graphics().setDepth(2.5);
        this.glossGraphics = scene.add.graphics().setDepth(3);
        this.glossMask = scene.make.graphics({ add: false });
        this.glossMask.fillStyle(0xffffff, 1);
        this.glossMask.fillRect(-70, -100, 140, 200);
        this.glossMask.setVisible(false);
        this.add(this.glossMask);
        this.glossGraphics.setMask(this.glossMask.createGeometryMask());
        this.sparklerParticles = [];
        this.add(this.rainbowGraphics); this.add(this.fusionCandidateGraphics); this.add(this.auraGraphics); this.add(this.glossGraphics);
        this.setScrollFactor(0); this.baseX = x; this.baseY = y; this.physX = x; this.physY = y; this.velocityX = 0; this.velocityY = 0; this.velocityAngle = 0; this.targetX = x; this.targetY = y; this.dragOffsetX = 0; this.dragOffsetY = 0;
        this.frameImage.on('pointerover', this.onHover, this); this.frameImage.on('pointerout', this.onHoverOut, this); this.frameImage.on('dragstart', this.onDragStart, this); this.frameImage.on('drag', this.onDrag, this); this.frameImage.on('dragend', this.onDragEnd, this);
        this.rainbowDmgText = null;
        if (this.isRainbowWeapon && this.weaponData && this.weaponData.rainbowDmgBonus != null) {
            this.rainbowDmgText = scene.add.text(32, 75, '+' + this.weaponData.rainbowDmgBonus, { fontSize: '11px', color: '#eecc00', fontFamily: 'monospace' });
            this.rainbowDmgText.setOrigin(0, 0.5);
            if (this.rainbowDmgText.setResolution) this.rainbowDmgText.setResolution(2);
            this.rainbowDmgText.setDepth(4);
            this.add(this.rainbowDmgText);
        }
        scene.add.existing(this);
    }
    updatePhysics() { 
        if (!this.scene || !this.frameImage) return; 
        const isFusionCandidate = Renderer.isCardDragging && Renderer.draggedCard && Renderer.draggedCard !== this && FUSABLE_UNIT_TYPES.includes(Renderer.draggedCard.cardType) && this.cardType === Renderer.draggedCard.cardType;
        if (this.fusionCandidateGraphics) {
            this.fusionCandidateGraphics.clear();
            if (isFusionCandidate) {
                const pulse = 0.6 + 0.4 * Math.sin((this.scene.time || { now: 0 }).now * 0.005);
                this.fusionCandidateGraphics.lineStyle(4, 0xffdd44, pulse);
                this.fusionCandidateGraphics.strokeRect(-70, -100, 140, 200);
                this.fusionCandidateGraphics.lineStyle(2, 0xffffff, pulse * 0.8);
                this.fusionCandidateGraphics.strokeRect(-72, -102, 144, 204);
            }
        }
        if (this.rainbowGraphics) {
            const showRainbow = this.fusionData || this.isRainbowWeapon;
            if (showRainbow) {
            this.rainbowGraphics.clear();
            const t = (this.scene.time || { now: 0 }).now * 0.001;
            const count = this.isRainbowWeapon ? 2 : Math.max(2, this.fusionCount || 2);
            const speed = count <= 2 ? 0.08 : (count >= 4 ? 0.42 : 0.28);
            const w = 70; const h = 100; const pad = 2; const segs = 96;
            const colors = [0xff0000, 0xff4400, 0xff8800, 0xffcc00, 0xffff00, 0xaaff00, 0x00ff00, 0x00ff88, 0x0088ff, 0x4400ff, 0x8800ff];
            for (let i = 0; i < segs; i++) {
                const u = (i / segs + t * speed) % 1;
                const ci = Math.floor(u * colors.length) % colors.length;
                const c0 = colors[ci]; const c1 = colors[(ci + 1) % colors.length];
                const mix = (u * colors.length) % 1;
                const r = ((c0 >> 16) & 0xff) * (1 - mix) + ((c1 >> 16) & 0xff) * mix;
                const g = ((c0 >> 8) & 0xff) * (1 - mix) + ((c1 >> 8) & 0xff) * mix;
                const b = (c0 & 0xff) * (1 - mix) + (c1 & 0xff) * mix;
                const blended = (r << 16) | (g << 8) | b;
                const lineW = count >= 4 ? 4 : (count >= 3 ? 3 : 2);
                const alpha = count >= 4 ? 1 : (count >= 3 ? 0.95 : 0.88);
                this.rainbowGraphics.lineStyle(lineW, blended, alpha);
                const frac = i / segs; const nextFrac = (i + 1) / segs;
                const rad = (f) => { let u2 = f * 4; if (u2 >= 4) u2 = 3.9999; const side = Math.floor(u2) % 4; const v = u2 - Math.floor(u2); let x, y; if (side === 0) { x = -w - pad + v * 2 * (w + pad); y = -h - pad; } else if (side === 1) { x = w + pad; y = -h - pad + v * 2 * (h + pad); } else if (side === 2) { x = w + pad - v * 2 * (w + pad); y = h + pad; } else { x = -w - pad; y = h + pad - v * 2 * (h + pad); } return { x, y }; };
                const p1 = rad(frac); const p2 = rad(nextFrac);
                this.rainbowGraphics.beginPath(); this.rainbowGraphics.moveTo(p1.x, p1.y); this.rainbowGraphics.lineTo(p2.x, p2.y); this.rainbowGraphics.strokePath();
            }
            if (count >= 3 && this.auraGraphics) {
                this.auraGraphics.clear();
                const baseOff = 2;
                const pts = 50;
                const colors = [0xffdd66, 0xffaa44, 0xff8844];
                const vel = Math.sqrt((this.velocityX || 0) ** 2 + (this.velocityY || 0) ** 2);
                const inertiaGain = Math.min(2.2, 1 + vel * 0.35);
                const hoverGain = this.isHovering ? 1.5 : 1;
                const dragGain = this.isDragging ? 1.7 : 1;
                let cursorNear = 0;
                let neighborNear = 0;
                if (this.scene && this.scene.input && this.scene.input.activePointer) {
                    const ptr = this.scene.input.activePointer;
                    const hand = this.scene.handContainer;
                    const inHand = hand && this.parentContainer === hand;
                    const cx = inHand ? (hand.x + this.x) : this.x;
                    const cy = inHand ? (hand.y + this.y) : this.y;
                    const d = Math.hypot(ptr.x - cx, ptr.y - cy);
                    cursorNear = 1 / (1 + d / 45);
                }
                if (this.scene && this.scene.cards) {
                    this.scene.cards.forEach(function(c) {
                        if (c === this || !c.active || c.parentContainer !== this.parentContainer) return;
                        const dist = Math.hypot(this.x - c.x, this.y - c.y);
                        if (dist < 200) neighborNear += 1 / (1 + dist / 55);
                    }.bind(this));
                    neighborNear = Math.min(1.8, neighborNear * 0.35);
                }
                const response = inertiaGain * hoverGain * dragGain * (1 + 1.4 * cursorNear + 0.4 * neighborNear);
                const is4Fusion = count >= 4;
                const rhythm = 0.65 + 0.35 * Math.sin(t * 1.0) + 0.25 * Math.sin(t * 1.85);
                const waveMult = is4Fusion ? 1.85 : 1;
                for (let j = 0; j < 3; j++) {
                    const off = baseOff + (j + 1) * 2.5;
                    const phase = t * (is4Fusion ? 4.5 : 3.2) + j * 2.1;
                    const alpha = 0.32 + 0.28 * (1 - j * 0.28) * (0.5 + 0.5 * Math.sin(t * 2.2 + j * 0.8));
                    this.auraGraphics.lineStyle(is4Fusion ? 3 : 2, colors[j], Math.min(1, alpha * (is4Fusion ? 1.2 : 1)));
                    this.auraGraphics.beginPath();
                    const L = -70 - off, R = 70 + off, T = -100 - off, B = 100 + off;
                    const W = R - L, H = B - T;
                    const wave = (s) => {
                        const soft = (3.8 * Math.sin(1.4 * s + phase) + 2.2 * Math.sin(2.2 * s + phase * 1.3)) * waveMult;
                        const hi = (1.0 * Math.sin(8 * s + t * (is4Fusion ? 18 : 12)) + 0.85 * Math.sin(13 * s + t * (is4Fusion ? 22 : 16) + j)) * rhythm * waveMult;
                        const jelly = (0.75 * Math.sin(19 * s + t * 20) + 0.6 * Math.sin(26 * s + t * 17 + j * 1.7) + 0.45 * Math.sin(33 * s + t * 24 + j * 0.9)) * response * rhythm * waveMult;
                        return soft + hi + jelly;
                    };
                    for (let i = 0; i <= pts; i++) {
                        const u = i / pts;
                        let x, y, s;
                        if (u < 0.25) {
                            s = u * 4; x = L + W * (u / 0.25); y = T + wave(s);
                        } else if (u < 0.5) {
                            s = 1 + (u - 0.25) * 4; y = T + H * ((u - 0.25) / 0.25); x = R + wave(s);
                        } else if (u < 0.75) {
                            s = 2 + (u - 0.5) * 4; x = R - W * ((u - 0.5) / 0.25); y = B + wave(s);
                        } else {
                            s = 3 + (u - 0.75) * 4; y = B - H * ((u - 0.75) / 0.25); x = L + wave(s);
                        }
                        if (i === 0) this.auraGraphics.moveTo(x, y); else this.auraGraphics.lineTo(x, y);
                    }
                    this.auraGraphics.closePath(); this.auraGraphics.strokePath();
                }
                if (!this.sparklerParticles) this.sparklerParticles = [];
                const sparkChance = count >= 4 ? 0.28 : 0.08;
                if (Math.random() < sparkChance) {
                    const side = Math.floor(Math.random() * 4);
                    const q = Math.random();
                    let sx, sy, nx, ny;
                    const pad = 75; const padV = 105;
                    if (side === 0) { sx = -pad + q * pad * 2; sy = -padV; nx = 0; ny = -1; }
                    else if (side === 1) { sx = pad; sy = -padV + q * padV * 2; nx = 1; ny = 0; }
                    else if (side === 2) { sx = pad - q * pad * 2; sy = padV; nx = 0; ny = 1; }
                    else { sx = -pad; sy = padV - q * padV * 2; nx = -1; ny = 0; }
                    const jitter = count >= 4 ? 0.6 : 0.3;
                    const vel = count >= 4 ? (2.2 + Math.random() * 2.5) : (1.2 + Math.random() * 2);
                    const vx = nx * vel + (Math.random() - 0.5) * jitter;
                    const vy = ny * vel + (Math.random() - 0.5) * jitter - 0.3;
                    this.sparklerParticles.push({
                        x: sx, y: sy,
                        vx: vx, vy: vy,
                        life: 14 + Math.floor(Math.random() * 12), maxLife: 26,
                        color: Math.random() > 0.4 ? 0xffaa00 : 0xffff88, size: (count >= 4 ? 2.2 : 1.5) + Math.random() * 1.5
                    });
                }
                for (let i = this.sparklerParticles.length - 1; i >= 0; i--) {
                    const p = this.sparklerParticles[i];
                    p.x += p.vx; p.y += p.vy; p.vy += 0.08; p.vx *= 0.98; p.vy *= 0.98;
                    p.life--;
                    if (p.life <= 0) { this.sparklerParticles.splice(i, 1); continue; }
                    const alpha = p.life / p.maxLife;
                    const len = Math.max(4, Math.sqrt(p.vx * p.vx + p.vy * p.vy) * 1.2);
                    const angle = Math.atan2(p.vy, p.vx);
                    const tx = p.x - Math.cos(angle) * len;
                    const ty = p.y - Math.sin(angle) * len;
                    this.auraGraphics.lineStyle(Math.max(1, p.size), p.color, alpha);
                    this.auraGraphics.beginPath(); this.auraGraphics.moveTo(p.x, p.y); this.auraGraphics.lineTo(tx, ty); this.auraGraphics.strokePath();
                }
                if (this.sparklerParticles.length > (count >= 4 ? 120 : 80)) this.sparklerParticles.splice(0, count >= 4 ? 35 : 20);
            }
            if (count >= 4 && this.glossGraphics) {
                this.glossGraphics.clear();
                const angle = Math.atan2(200, 140);
                const bandLen = 260;
                const bandW = 42;
                const speed = 220;
                const diagLen = Math.hypot(140, 200);
                const cycle = diagLen + bandLen;
                const d1 = (t * speed) % cycle;
                const d2 = (t * speed + cycle * 0.5) % cycle;
                const rot = (x, y, cx, cy, a) => ({ x: cx + x * Math.cos(a) - y * Math.sin(a), y: cy + x * Math.sin(a) + y * Math.cos(a) });
                [d1, d2].forEach((d, i) => {
                    const u = d / cycle;
                    const cx = -70 + 140 * u;
                    const cy = -100 + 200 * u;
                    const fade = 0.1 + 0.14 * Math.sin(t * 2.8 + i * 2);
                    const hw = bandLen / 2;
                    const hh = bandW / 2;
                    const p1 = rot(-hw, -hh, cx, cy, angle);
                    const p2 = rot(hw, -hh, cx, cy, angle);
                    const p3 = rot(hw, hh, cx, cy, angle);
                    const p4 = rot(-hw, hh, cx, cy, angle);
                    this.glossGraphics.fillStyle(0xffffff, Math.min(0.3, fade));
                    this.glossGraphics.beginPath();
                    this.glossGraphics.moveTo(p1.x, p1.y);
                    this.glossGraphics.lineTo(p2.x, p2.y);
                    this.glossGraphics.lineTo(p3.x, p3.y);
                    this.glossGraphics.lineTo(p4.x, p4.y);
                    this.glossGraphics.closePath();
                    this.glossGraphics.fillPath();
                });
            } else if (this.glossGraphics) this.glossGraphics.clear();
            } else { this.rainbowGraphics.clear(); if (this.auraGraphics) this.auraGraphics.clear(); if (this.glossGraphics) this.glossGraphics.clear(); if (this.sparklerParticles) this.sparklerParticles.length = 0; }
        }
        if (this.isDragging) { this.setAlpha(0.6); } else {
            const isWeapon = typeof WPNS !== 'undefined' && WPNS[this.cardType];
            const deployMax = (window.gameLogic && window.gameLogic.getDeployCardMax) ? window.gameLogic.getDeployCardMax() : 2;
            const isDisabled = !isWeapon && (window.gameLogic && window.gameLogic.cardsUsed >= deployMax);
            if (isDisabled) { this.frameImage.setTint(0x555555); this.setAlpha(0.6); } else { this.frameImage.clearTint(); this.setAlpha(1.0); }
        }
        if (!this.isDragging && !this.scene.isReturning) {
          let partOffset = 0;
          const hoveredIdx = this.scene.cards.findIndex(c => c.isHovering);
          if (hoveredIdx >= 0) {
            const myIdx = this.scene.cards.indexOf(this);
            partOffset = (myIdx - hoveredIdx) * 28;
          }
          this.targetX = this.baseX + partOffset;
          if (this.scene.isHandDocked) { this.targetY = this.isHovering ? -120 : 60; } else { this.targetY = this.baseY - (this.isHovering ? 30 : 0); }
        } 
        const stiffness = this.isDragging ? 0.2 : 0.08; const damping = 0.65; const ax = (this.targetX - this.physX) * stiffness; const ay = (this.targetY - this.physY) * stiffness; this.velocityX += ax; this.velocityY += ay; this.velocityX *= damping; this.velocityY *= damping; this.physX += this.velocityX; this.physY += this.velocityY; this.setPosition(this.physX, this.physY); let staticAngle = 0; if (this.isDragging) staticAngle = -this.dragOffsetX * 0.4; const targetDynamicAngle = -this.velocityX * 1.5; const totalTargetAngle = staticAngle + targetDynamicAngle; const angleForce = (totalTargetAngle - this.angle) * 0.12; this.velocityAngle += angleForce; this.velocityAngle *= 0.85; this.angle += this.velocityAngle; this.angle = Phaser.Math.Clamp(this.angle, -50, 50); 
    }
    onHover() { if(!this.parentContainer || Renderer.isMapDragging || Renderer.isCardDragging) return; if (this.scene.cancelResetHandOrderTimer) this.scene.cancelResetHandOrderTimer(); this.isHovering = true; this.parentContainer.bringToTop(this); }
    onHoverOut() { this.isHovering = false; if (this.scene.scheduleResetHandOrderIfNoHover) this.scene.scheduleResetHandOrderIfNoHover(); }
    onDragStart(pointer) { 
        if(Renderer.isMapDragging) return;
        const review = window.gameLogic && (window.gameLogic._battleReviewReadOnly
            || window.gameLogic.state === 'REVIEW' || window.gameLogic.state === 'WIN'
            || window.gameLogic.state === 'LOSS');
        if (review) return;
        const isWeapon = typeof WPNS !== 'undefined' && WPNS[this.cardType];
        const deployMax = (window.gameLogic && window.gameLogic.getDeployCardMax) ? window.gameLogic.getDeployCardMax() : 2;
        if (!isWeapon && window.gameLogic && window.gameLogic.cardsUsed >= deployMax) return; 
        this.isDragging = true; Renderer.isCardDragging = true; Renderer.draggedCardType = this.cardType; Renderer.draggedCardFusionData = this.fusionData; Renderer.draggedCard = this;
        this.setAlpha(0.6); this.setScale(1.1); 
        const hand = this.parentContainer; const worldPos = hand.getLocalTransformMatrix().transformPoint(this.x, this.y); hand.remove(this); this.scene.add.existing(this); this.physX = worldPos.x; this.physY = worldPos.y; this.targetX = this.physX; this.targetY = this.physY; this.setDepth(9999); this.dragOffsetX = this.physX - pointer.x; this.dragOffsetY = this.physY - pointer.y; 
    }
    onDrag(pointer) {
        if (!this.isDragging) return;
        this.targetX = pointer.x + this.dragOffsetX;
        this.targetY = pointer.y + this.dragOffsetY;
        const main = this.scene.game.scene.getScene('MainScene');
        const overRightPanel = pointer.x >= this.scene.scale.width - (window.getSidebarWidth ? window.getSidebarWidth() : 340);
        const dropZoneY = this.scene.scale.height * 0.88;
        const canEquipToSlot = cardCanEquipToLoadout(this);
        if (!canEquipToSlot && this.targetY < dropZoneY && !overRightPanel) main.dragHighlightHex = Renderer.pxToHex(pointer.x, pointer.y);
        else main.dragHighlightHex = null;
        const cx = this.targetX; const cy = this.targetY;
        const target = this.findOverlappingSameTypeCardAt(cx, cy);
        if (target && FUSABLE_UNIT_TYPES.includes(this.cardType)) this.scene.fusionTargetCard = target;
        else this.scene.fusionTargetCard = null;
    }
    onDragEnd(pointer) { 
        if(!this.isDragging) return; 
        this.isDragging = false; Renderer.isCardDragging = false; Renderer.draggedCardType = null; Renderer.draggedCardFusionData = null; Renderer.draggedCard = null;
        this.scene.fusionTargetCard = null;
        this.setAlpha(1.0); this.setScale(1.0); 
        const main = this.scene.game.scene.getScene('MainScene'); main.dragHighlightHex = null; 
        const review = window.gameLogic && (window.gameLogic._battleReviewReadOnly
            || window.gameLogic.state === 'REVIEW' || window.gameLogic.state === 'WIN'
            || window.gameLogic.state === 'LOSS');
        if (review) { this.returnToHand(); return; }
        const dropZoneY = this.scene.scale.height * 0.88;
        const sw = this.scene.scale.width;
        const overRightPanel = pointer.x >= sw - (window.getSidebarWidth ? window.getSidebarWidth() : 340);
        const canEquipToSlot = cardCanEquipToLoadout(this);
        const cx = pointer.x + this.dragOffsetX; const cy = pointer.y + this.dragOffsetY;
        const targetCard = this.findOverlappingSameTypeCardAt(cx, cy);
        if (overRightPanel) {
            if (!canEquipToSlot) { this.returnToHand(); return; }
            const sidebar = window.phaserSidebar;
            if (sidebar && sidebar.hitTestSlots(pointer.x, pointer.y) && window.gameLogic && window.gameLogic.equipWeaponFromDeck) {
                const slotTarget = sidebar.hitTestSlots(pointer.x, pointer.y);
                // weaponData があれば弾数等の状態ごと装備、なければ従来どおりコードのみで装備
                const src = this.weaponData || this.cardType;
                window.gameLogic.equipWeaponFromDeck(src, slotTarget);
                this.scene.removeCard(this); this.destroy(); return;
            }
            this.returnToHand(); return;
        }
        if (targetCard && FUSABLE_UNIT_TYPES.includes(this.cardType)) {
            this.scene.fuseCards(this, targetCard);
            return;
        }
        if (canEquipToSlot) { this.returnToHand(); return; }
        if (cy >= dropZoneY) { this.returnToHand(); return; }
        const hex = Renderer.pxToHex(pointer.x, pointer.y); 
        let canDeploy = false; 
        if (window.gameLogic && window.gameLogic.checkDeploy) { 
            if (this.cardType === 'aerial') {
                if (window.gameLogic.isValidHex(hex.q, hex.r)) canDeploy = true; 
                else if(window.gameLogic.log) window.gameLogic.log("配置不可: マップ範囲外です"); 
            } else { canDeploy = window.gameLogic.checkDeploy(hex, this.cardType); }
        } 
        if (canDeploy) this.burnAndConsume(hex); else this.returnToHand(); 
    }
    burnAndConsume(hex) { 
        const type = this.cardType; const fusionData = this.fusionData; const portraitIndex = this.portraitIndex;
        const unitName = this.unitName;
        const fusionCount = Math.max(0, parseInt(this.fusionCount, 10) || (this.fusionData ? 2 : 0));
        this.updatePhysics = () => {}; this.frameImage.setTint(0x552222); this.frameImage.disableInteractive(); 
        this.scene.tweens.add({ targets: this, alpha: 0, scale: 0.5, duration: 200, onComplete: () => { 
            this.scene.removeCard(this); this.destroy(); 
            try { 
                if (type === 'aerial') { if (window.gameLogic) window.gameLogic.triggerBombardment(hex); } 
                else if(window.gameLogic) { window.gameLogic.deployUnit(hex, type, fusionData, portraitIndex, fusionCount, unitName); } 
            } catch(e) { console.error("Logic Error:", e); } 
        }}); 
    }
    returnToHand() { const hand = this.scene.handContainer; this.scene.children.remove(this); hand.add(this); this.setDepth(0); this.physX = this.x; this.physY = this.y; this.targetX = this.baseX; this.targetY = this.baseY; }
    findOverlappingSameTypeCardAt(cx, cy) {
        const dragRect = new Phaser.Geom.Rectangle(cx - 70, cy - 100, 140, 200);
        for (const c of this.scene.cards) {
            if (c === this || !c.active) continue;
            if (c.cardType !== this.cardType) continue;
            try {
                const b = c.getBounds();
                if (!b) continue;
                if (b.contains(cx, cy)) return c;
                if (Phaser.Geom.Rectangle.Overlaps(dragRect, b)) return c;
            } catch (e) { continue; }
        }
        return null;
    }
}

class UIScene extends Phaser.Scene {
    constructor() { super({ key: 'UIScene', active: false }); this.cards=[]; this.handContainer=null; this.gradientBg=null; this.uiVfxGraphics=null; this.isHandDocked = false; this.sidebar = null; this._resetOrderTimer = null; this.fusionTargetCard = null; }
    create() {
        const w = this.scale.width; const h = this.scale.height;
        if(window.createGradientTexture) window.createGradientTexture(this);
        const app = document.getElementById('app');
        const usePhaserSidebar = app && app.classList.contains('phaser-sidebar');
        const sidebarW = window.getSidebarWidth ? window.getSidebarWidth() : 340;
        const gameW = usePhaserSidebar ? Math.max(1, w - sidebarW) : w;
        const centerX = usePhaserSidebar ? (w - sidebarW) / 2 : w / 2;
        if (this.textures.exists('ui_gradient')) { this.gradientBg = this.add.image(centerX, h, 'ui_gradient').setOrigin(0.5, 1).setDepth(0).setDisplaySize(gameW, h*0.175); } else { this.gradientBg = this.add.rectangle(centerX, h, gameW, h*0.175, 0x000000, 0.8).setOrigin(0.5, 1); }
        this.handContainer = this.add.container(centerX, h); this.uiVfxGraphics = this.add.graphics().setDepth(10000); this.scale.on('resize', this.onResize, this);
        if (window.PhaserSidebar) { this.sidebar = new PhaserSidebar(this); this.sidebar.init(); window.phaserSidebar = this.sidebar; }
    }
    onResize(gameSize) { const w = gameSize.width; const h = gameSize.height; const app = document.getElementById('app'); const usePhaserSidebar = app && app.classList.contains('phaser-sidebar'); const sidebarW = window.getSidebarWidth ? window.getSidebarWidth() : 340; const gameW = usePhaserSidebar ? Math.max(1, w - sidebarW) : w; const centerX = usePhaserSidebar ? (w - sidebarW) / 2 : w / 2; if (this.gradientBg) { this.gradientBg.setPosition(centerX, h); this.gradientBg.setDisplaySize(gameW, h * 0.175); } if (this.handContainer) { this.handContainer.setPosition(centerX, h); } if (this.sidebar) this.sidebar.onResize(w, h); }
    update(time, delta) {
        this.cards.forEach(card => { if (card.active) card.updatePhysics(); });
        if (this.sidebar) {
            const ptr = this.input.activePointer;
            this.sidebar.updateLiveStats();
            this.sidebar.updateDropHighlight(ptr.x, ptr.y);
            if (this.sidebar.dragGhost) this.sidebar.updateDragGhost(time, delta);
        }
        this.uiVfxGraphics.clear();
        const cardDragging = typeof Renderer !== 'undefined' && Renderer.isCardDragging;
        const slotDragging = this.sidebar && this.sidebar.dragGhost;
        const draggedCard = (typeof Renderer !== 'undefined' && Renderer.draggedCard) || null;
        const draggedType = (typeof Renderer !== 'undefined' && Renderer.draggedCardType) || null;
        const isEquipDrag = slotDragging || (cardDragging && draggedCard && cardCanEquipToLoadout(draggedCard));
        const deployableAttrs = typeof ATTR !== 'undefined' ? [ATTR.MILITARY, ATTR.SUPPORT, ATTR.RECOVERY] : [];
        const isMapCardDrag = cardDragging && !isEquipDrag && (draggedType === 'aerial' || (typeof UNIT_TEMPLATES !== 'undefined' && UNIT_TEMPLATES[draggedType] && deployableAttrs.indexOf(UNIT_TEMPLATES[draggedType].attr) >= 0));
        if (isEquipDrag) this.drawDropZoneGlow(time, true);
        else if (isMapCardDrag) this.drawMapPerimeterGlow(time);
        if (this.fusionTargetCard && Renderer.draggedCard) this.drawFusionHalo(time);
        if (window.UIVFX) { window.UIVFX.update(); window.UIVFX.draw(this.uiVfxGraphics); }
    }
    drawFusionHalo(time) {
        const t = time * 0.001;
        const g = this.uiVfxGraphics;
        const pulse = 0.7 + 0.3 * Math.sin(t * 8);
        const colors = [0xffff88, 0xffdd44, 0xffaa00, 0xffffff];
        const drawHaloAt = (x, y) => {
            for (let r = 60; r <= 140; r += 20) {
                const a = pulse * (1 - (r - 60) / 100) * 0.25;
                g.lineStyle(4, colors[Math.floor(r / 35) % colors.length], a);
                g.strokeCircle(x, y, r);
            }
        };
        const target = this.fusionTargetCard;
        const drag = Renderer.draggedCard;
        try {
            if (target) { const b = target.getBounds(); if (b) drawHaloAt(b.centerX, b.centerY); }
            if (drag) { const b = drag.getBounds(); if (b) drawHaloAt(b.centerX, b.centerY); }
        } catch (e) {}
    }
    drawWavyHaloLine(g, t, colors, x1, y1, x2, y2, isVertical, segments, haloSpread, cycleMult, phaseOffset) {
        segments = Math.min(segments, 30);
        const k = typeof cycleMult === 'number' ? cycleMult : 1;
        const phase = typeof phaseOffset === 'number' ? phaseOffset : 0;
        const wave = (i, s) => Math.sin((i / segments) * 4 * k * Math.PI + t * 2 + s + phase) * 6 + Math.sin((i / segments) * 2 * k * Math.PI + t * 1.2 + s * 0.7 + phase) * 4;
        
        // Draw 3 layers instead of 5
        for (let layer = 0; layer < 3; layer++) {
            const phaseVal = layer * 0.4 + t * 0.5;
            const col = colors[layer % colors.length];
            const a = 0.12 * (0.6 + 0.4 * Math.sin(t * 2 + layer));
            g.lineStyle(3 + Math.sin(t + layer) * 1.5, col, Math.max(0.03, a));
            g.beginPath();
            for (let i = 0; i <= segments; i++) {
                const u = i / segments;
                const x = x1 + (x2 - x1) * u + (isVertical ? wave(i, phaseVal) : 0);
                const y = y1 + (y2 - y1) * u + (isVertical ? 0 : wave(i, phaseVal));
                if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
            }
            g.strokePath();
        }
        
        // Draw with step = 12 instead of 4, reducing iterations by 3x
        const step = 12;
        for (let o = -haloSpread; o <= haloSpread; o += step) {
            const fade = 1 - (Math.abs(o) / haloSpread) * (Math.abs(o) / haloSpread);
            const col = colors[Math.abs(Math.floor(o * 0.2 + t * 3)) % colors.length];
            g.lineStyle(2, col, Math.max(0.01, 0.1 * fade * (0.7 + 0.3 * Math.sin(t + o * 0.05))));
            g.beginPath();
            for (let i = 0; i <= segments; i++) {
                const u = i / segments;
                const nx = isVertical ? 1 : 0; const ny = isVertical ? 0 : 1;
                const x = x1 + (x2 - x1) * u + nx * o + (isVertical ? wave(i, t + o * 0.1) : 0);
                const y = y1 + (y2 - y1) * u + ny * o + (isVertical ? 0 : wave(i, t + o * 0.1));
                if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
            }
            g.strokePath();
        }
    }
    drawMapPerimeterGlow(time) {
        const sw = this.scale.width;
        const sh = this.scale.height;
        const DECK_ZONE_HEIGHT = sh * 0.12;
        const dropZoneY = sh - DECK_ZONE_HEIGHT;
        const sidebarW = window.getSidebarWidth ? window.getSidebarWidth() : 340;
        const mapRight = sw - sidebarW;
        const g = this.uiVfxGraphics;
        const t = time * 0.001;
        const colors = [0x88ccff, 0xaaddff, 0x6688cc, 0x99bbee];
        const segments = 80;
        this.drawWavyHaloLine(g, t, colors, 0, 0, 0, dropZoneY, true, segments, 28);
        this.drawWavyHaloLine(g, t, colors, 0, 0, mapRight, 0, false, segments, 28);
        this.drawWavyHaloLine(g, t, colors, mapRight, 0, mapRight, dropZoneY, true, segments, 28);
        this.drawWavyHaloLine(g, t, colors, 0, dropZoneY, mapRight, dropZoneY, false, segments, 28);
    }
    drawDropZoneGlow(time, weaponryOnly) {
        const sw = this.scale.width;
        const sh = this.scale.height;
        const sidebarW = window.getSidebarWidth ? window.getSidebarWidth() : 340;
        const DECK_ZONE_HEIGHT = sh * 0.12;
        const dropZoneY = sh - DECK_ZONE_HEIGHT;
        const mapRight = sw - sidebarW;
        const g = this.uiVfxGraphics;
        const t = time * 0.001;
        const colors = [0xffdd66, 0xddaa44, 0xffaa22, 0xdd8844, 0xffcc44];
        g.fillStyle(0xddaa44, 0.025);
        g.fillRect(0, dropZoneY, mapRight, DECK_ZONE_HEIGHT);
        g.fillStyle(0xddaa44, 0.018);
        g.fillRect(mapRight, 0, sidebarW, sh);
        const segs = [
            { x1: 0, y1: dropZoneY, x2: mapRight, y2: dropZoneY, vert: false, len: mapRight },
            { x1: mapRight, y1: dropZoneY, x2: mapRight, y2: 0, vert: true, len: dropZoneY },
            { x1: mapRight, y1: 0, x2: sw, y2: 0, vert: false, len: sidebarW },
            { x1: sw, y1: 0, x2: sw, y2: sh, vert: true, len: sh },
            { x1: sw, y1: sh, x2: 0, y2: sh, vert: false, len: sw },
            { x1: 0, y1: sh, x2: 0, y2: dropZoneY, vert: true, len: sh - dropZoneY }
        ];
        const totalLen = segs.reduce((a, s) => a + s.len, 0);
        let acc = 0;
        const cycleMult = 2;
        const pathCycles = 12;
        for (const s of segs) {
            const phaseOffset = (acc / totalLen) * pathCycles * Math.PI;
            this.drawWavyHaloLine(g, t, colors, s.x1, s.y1, s.x2, s.y2, s.vert, 120, 36, cycleMult, phaseOffset);
            acc += s.len;
        }
    }
    dealStart(types) {
        this.cards = [];
        if (this.handContainer) this.handContainer.removeAll(true);
        this.isHandDocked = false;
        types.forEach((typeOrData, i) => { this.time.delayedCall(i * 150, () => { this.addCardToHand(typeOrData); }); });
        this.time.delayedCall(150 * types.length + 1000, () => { this.isHandDocked = true; });
    }
    addCardToHand(typeOrData) {
        let data = typeof typeOrData === 'object' && typeOrData !== null ? { ...typeOrData } : { type: typeOrData };
        const isUnit = typeof UNIT_TEMPLATES !== 'undefined' && data.type && UNIT_TEMPLATES[data.type] && !(typeof WPNS !== 'undefined' && WPNS[data.type]);
        if (isUnit && data.portraitIndex === undefined && window.campaign && typeof window.campaign.getRandomPortraitIndex === 'function') {
            data.portraitIndex = window.campaign.getRandomPortraitIndex();
        }
        const template = (typeof UNIT_TEMPLATES !== 'undefined' && data.type && UNIT_TEMPLATES[data.type]) ? UNIT_TEMPLATES[data.type] : null;
        const isInfantry = template && template.role && String(template.role).toLowerCase() === 'infantry';
        if (isInfantry && !data.name) {
            data.name = (typeof generateSoldierName === 'function')
                ? generateSoldierName()
                : (FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)] + ' ' + LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]);
        }
        const card = new Card(this, 0, 0, data);
        this.handContainer.add(card); this.cards.push(card); card.physX = 600; card.physY = 300; card.setPosition(card.physX, card.physY); this.arrangeHand();
    }
    fuseCards(dragged, target) {
        const type = dragged.cardType;
        const fusionData = generateFusionData();
        const portraitIndex = dragged.portraitIndex !== undefined ? dragged.portraitIndex : target.portraitIndex;
        const unitName = dragged.unitName || target.unitName;
        const fusionCount = (dragged.fusionCount || 1) + (target.fusionCount || 1);
        this.removeCard(dragged); dragged.destroy();
        this.removeCard(target); target.destroy();
        const card = new Card(this, 0, 0, { type, fusionData, portraitIndex, fusionCount, name: unitName });
        this.handContainer.add(card); this.cards.push(card);
        card.physX = (dragged.physX + target.physX) / 2; card.physY = (dragged.physY + target.physY) / 2;
        card.setPosition(card.physX, card.physY);
        this.arrangeHand();
        if (window.Sfx) Sfx.play('reload');
    }
    removeCard(cardToRemove) { this.cards = this.cards.filter(c => c !== cardToRemove); this.arrangeHand(); }
    cancelResetHandOrderTimer() { if (this._resetOrderTimer) { this.time.removeEvent(this._resetOrderTimer); this._resetOrderTimer = null; } }
    scheduleResetHandOrderIfNoHover() { this.cancelResetHandOrderTimer(); this._resetOrderTimer = this.time.delayedCall(80, this.resetHandCardOrderIfNoHover, [], this); }
    resetHandCardOrderIfNoHover() { this._resetOrderTimer = null; if (this.cards.some(c => c.isHovering)) return; this.resetHandCardOrder(); }
    resetHandCardOrder() {
        if (!this.handContainer || this.cards.length === 0) return;
        const n = this.cards.length;
        for (let i = 0; i < n; i++) {
            this.handContainer.remove(this.cards[i]);
            this.handContainer.addAt(this.cards[i], i);
        }
    }
    arrangeHand() {
        const total = this.cards.length;
        const centerIdx = (total - 1) / 2;
        const cardWidth = 140;
        const maxSpread = 760;
        let step;
        if (total <= 1) step = 0;
        else if (total <= 5) step = 165;
        else step = Math.max(52, Math.min(88, maxSpread / total));
        const overlap = total <= 5 ? 1 : Math.max(0.48, 1 - (total - 5) * 0.035);
        this.cards.forEach((card, i) => {
            const offset = i - centerIdx;
            card.baseX = offset * step * overlap;
            card.baseY = this.isHandDocked ? -120 : -120;
            card.baseDepth = i;
        });
        this.resetHandCardOrder();
    }
}

class MainScene extends Phaser.Scene {
    constructor() { super({ key: 'MainScene' }); this.hexGroup=null; this.decorGroup=null; this.unitGroup=null; this.treeGroup=null; this.hpGroup=null; this.vfxGraphics=null; this.overlayGraphics=null; this.mapGenerated=false; this.dragHighlightHex=null; this.crosshairGroup=null; this.unitView = null; this.tacticalPause = null; this._persistentImpactDecals = []; }
    preload() { 
        if (window.TerrainRender) window.TerrainRender.preload(this);
        if(window.EnvSystem) window.EnvSystem.preload(this);
        if (window.Sfx && window.Sfx.preload) { window.Sfx.preload(this); }
        this.load.spritesheet('us_soldier', 'asset/us-soldier-back-sheet.png', { frameWidth: 128, frameHeight: 128 });
        // 19モーション実スプライト（asset/sprites/soldier, manifest 駆動）。manifest は
        // phaser_soldier_view.js がスクリプト読込時に先行フェッチ済み。未解決なら
        // 旧 soldier_crawl のまま劣化動作（SoldierUnitView 側でフォールバック）。
        const solMan = window.SOLDIER_MANIFEST;
        // 匍匐前進シート(8.3MB)は**そのフォールバック専用**。19モーションが揃うなら
        // 一度も描画に使われないので落とさない。起動時の転送量が約3割減る。
        // 判定は SoldierUnitView.manifestReady() と同じ条件にしてある。
        const solReady = !!(solMan && solMan.actions && solMan.version >= 2 && solMan.charH > 0);
        if (!solReady) {
            // Blender 出力 2048×7680（8列×30行・256pxセル）をそのままシートで使う
            this.load.spritesheet('soldier_crawl', 'asset/soldier_crawl.png', { frameWidth: 256, frameHeight: 256, endFrame: 239 });
        }
        if (solMan && solMan.actions && solMan.version >= 2) {
            for (const name of (window.SOLDIER_LOAD_ACTIONS || [])) {
                const meta = solMan.actions[name];
                if (!meta) continue;
                this.load.spritesheet('sold_' + name, 'asset/sprites/soldier/' + meta.file, {
                    frameWidth: meta.frameW, frameHeight: meta.frameH, endFrame: meta.frames * 8 - 1,
                });
            }
        }
        this.load.spritesheet('soldier_sheet', 'asset/soldier_sheet_1.png', { frameWidth: 128, frameHeight: 128 });
        this.load.spritesheet('tank_sheet', 'asset/tank_sheet_1.png', { frameWidth: 128, frameHeight: 128 });
        this.load.spritesheet('explosion_sheet', 'asset/explosion_sheet_1.png', { frameWidth: 64, frameHeight: 64 });
        if (window.PS_ORIGINAL_FX && PS_ORIGINAL_FX.enabled) {
            for (const meta of [PS_ORIGINAL_FX.fire, PS_ORIGINAL_FX.fireAlt,
                PS_ORIGINAL_FX.dust, PS_ORIGINAL_FX.smoke]) {
                this.load.spritesheet(meta.key, `asset/ps_fx/${meta.key}.png`, {
                    frameWidth: meta.frameWidth, frameHeight: meta.frameHeight,
                    endFrame: meta.frames - 1
                });
            }
        }
        if (window.PS_FIRE_PROTOTYPE && PS_FIRE_PROTOTYPE.enabled) {
            this.load.spritesheet(PS_FIRE_PROTOTYPE.key,
                'asset/ps_fx/prototypes/fire_v1/fire_v1_sheet.png', {
                    frameWidth: PS_FIRE_PROTOTYPE.frameWidth,
                    frameHeight: PS_FIRE_PROTOTYPE.frameHeight,
                    endFrame: PS_FIRE_PROTOTYPE.frames - 1
                });
        }
        if (window.MUZZLE_SMOKE_FX && MUZZLE_SMOKE_FX.enabled) {
            this.load.spritesheet(MUZZLE_SMOKE_FX.key,
                'asset/ps_fx/candidates/muzzle_smoke_v3_original_derived/muzzle_smoke_v3.png', {
                    frameWidth: MUZZLE_SMOKE_FX.frameWidth,
                    frameHeight: MUZZLE_SMOKE_FX.frameHeight,
                    endFrame: MUZZLE_SMOKE_FX.frames - 1
                });
        }
        if (window.M2Mortar) {
            Object.keys(M2Mortar.TEXTURE_KEYS).forEach((code) => {
                const key = M2Mortar.TEXTURE_KEYS[code];
                const path = code === 'map' ? M2Mortar.ASSET_PATHS.map : M2Mortar.ASSET_PATHS[code];
                if (key && path) this.load.image(key, path);
            });
            M2Mortar.ASSEMBLED_SLICE_KEYS.forEach((key, index) => {
                this.load.image(key, M2Mortar.ASSEMBLED_SLICE_PATHS[index]);
            });
        }
        if (window.KHAOS_FX && KHAOS_FX.MUZZLE_READY) {
            // 4形状(行) x pop/fade(列) = 8フレーム。frame = variant*2 + step
            this.load.spritesheet('muzzle_flash', 'asset/muzzle_flash_128.png',
                { frameWidth: 128, frameHeight: 128, endFrame: 7 });
        }
        // 小銃弾着は高解像度3変種を小さく縮小して使う。64px版は輪郭が粗く、
        // 兵士の滑らかなスプライトと粒度が合わなかった。
        ['', '_v2', '_v3'].forEach((suffix, index) => {
            this.load.spritesheet('impact_rifle_' + index,
                `asset/explosion_khaos_t1_12mm${suffix}_384.png`,
                { frameWidth: 384, frameHeight: 384, endFrame: 7 });
        });
        // KHAOS爆発 5ティア×3バリアント（384pxシネマティック版）
        if (window.KHAOS_FX) {
            Object.entries(KHAOS_FX.TIERS).forEach(([tier, m]) => {
                KHAOS_FX.VARIANTS.forEach(v => {
                    this.load.spritesheet(KHAOS_FX.key(tier, v), `asset/explosion_khaos_${tier}${v}_384.png`,
                        { frameWidth: KHAOS_FX.FRAME, frameHeight: KHAOS_FX.FRAME, endFrame: m.frames - 1 });
                });
            });
        }
        // 立体物スプライトの台帳。PNG本体はマップ確定後に必要な分だけ遅延ロードする
        // (全655枚=7MiBを常時読むのは無駄。1マップが使うのは一部)。
        this.load.json('ps_object_manifest', 'asset/environment/ps_objects/manifest.json');
        this.load.once('filecomplete-json-ps_object_manifest', (key, type, data) => {
            if (window.PsObjectLayer) window.PsObjectLayer.manifest = data;
        });
        // Raised 2x overrides are optional and resolved per asset+slot.
        // A manifest.js can set window.RAISED_HD_MANIFEST before this scene;
        // otherwise try the JSON form. A missing JSON leaves canonical PS
        // loading and rendering unchanged.
        const inlineRaisedHdManifest = window.RAISED_HD_MANIFEST
            || (window.PsObjectLayer && window.PsObjectLayer.hdManifest);
        if (inlineRaisedHdManifest) {
            if (window.PsObjectLayer) {
                window.PsObjectLayer.hdManifest = inlineRaisedHdManifest;
            }
        } else {
            this.load.json(
                'raised_hd_manifest',
                'asset/environment/raised_hd/manifest.json'
            );
            this.load.once('filecomplete-json-raised_hd_manifest', (key, type, data) => {
                if (window.PsObjectLayer) window.PsObjectLayer.hdManifest = data;
            });
        }
        // Map-priority trees use the exact-2x PS slot contract. Their catalog
        // stays separate from the padded vegetation textures.
        const inlineTreeHdManifest = window.TREE_HD_PS_MANIFEST
            || (window.PsObjectLayer && window.PsObjectLayer.treeHdManifest);
        if (inlineTreeHdManifest) {
            if (window.PsObjectLayer) {
                window.PsObjectLayer.treeHdManifest = inlineTreeHdManifest;
            }
        } else {
            this.load.json(
                'tree_hd_ps_manifest',
                'asset/environment/trees_hd/production/runtime_ps_manifest.json'
            );
            this.load.once('filecomplete-json-tree_hd_ps_manifest', (key, type, data) => {
                if (window.PsObjectLayer) {
                    window.PsObjectLayer.treeHdManifest = data;
                }
            });
        }
        // PSクレーターのデカール素材。manifest を先に読み、完了時に各PNGを追加投入する。
        // 焼き込み用(window.DecalLayer)なので生きたスプライトにはならない。
        this.load.json('decal_manifest', 'asset/environment/decals/manifest.json');
        this.load.once('filecomplete-json-decal_manifest', (key, type, data) => {
            if (!window.DecalLayer || !data || !data.tiers) return;
            window.DecalLayer.manifest = data;
            Object.values(data.tiers).forEach(list => {
                list.forEach(d => this.load.image('decal_' + d.id, 'asset/environment/decals/' + d.file));
            });
            this.load.start(); // preload中の追加投入を確実に走らせる
        });
        // fir_tree: 128x128 x32コマ。レイアウト 16列x2行（0-15=弱い揺れ、16-31=強風）
        this.load.spritesheet('fir_tree', 'asset/environment/fir_tree.png', { frameWidth: 128, frameHeight: 128, endFrame: 31 });
        for (let i = 1; i <= (typeof PORTRAIT_AVAILABLE !== 'undefined' ? PORTRAIT_AVAILABLE : 7); i++) {
            this.load.image('portrait_' + i, 'asset/portraits/inf_us_' + String(i).padStart(3, '0') + '.jpg');
        }
        this.load.image('aerial_spt', 'asset/portraits/aerial_spt.jpg');
    }
    create() {
        window.createHexTexture(this); this.cameras.main.setBackgroundColor('#303322');
        this.updateSidebarViewport();
        this.scale.on('resize', () => {
            this.updateSidebarViewport();
            if (this.mapGenerated) this.centerMap();
        });
        this.hexGroup = this.add.layer(); this.hexGroup.setDepth(0);
        this.roadGraphics = this.add.graphics().setDepth(1.6);
        this.decorGroup = this.add.container(0, 0); this.decorGroup.setDepth(8);
        this.unitGroup = this.add.layer(); this.unitGroup.setDepth(20);
        this.rubbleFrontGroup = this.add.layer(); this.rubbleFrontGroup.setDepth(21);
        this.treeGroup = this.add.container(0, 0); this.treeGroup.setDepth(9);
        // HPゲージ/情報アイコンは戦場オブジェクトへ必ずオーバレイさせる。
        // PS立体物(phaser_ps_objects)は `depth = world Y` 規約でルート直下に
        // 置かれるため深度は数百〜数千まで伸びる。旧値10では樹冠の裏へ回って
        // 負傷が読めなかった（2026-08-05 ディレクター指摘）。ワールド深度の
        // 上限を確実に超え、かつ戦術ポーズ(90000)やミニマップより下に置く。
        this.hpGroup = this.add.layer(); this.hpGroup.setDepth(HP_OVERLAY_DEPTH);
        this.crosshairGroup = this.add.graphics().setDepth(200);
        this.hitChanceText = this.add.text(0, 0, '', { fontSize: '14px', fontFamily: 'sans-serif', color: '#e8e8f0' }).setScrollFactor(0).setDepth(300).setVisible(false);
        this.vfxGraphics = this.add.graphics().setDepth(2000).setScrollFactor(1);
        this.overlayGraphics = this.add.graphics().setDepth(1500).setScrollFactor(1); 
        if(window.EnvSystem) window.EnvSystem.clear();
        if(window.VFX && window.VFX.bindScene) window.VFX.bindScene(this);
        this.scene.launch('UIScene'); 
        const UnitViewClass = (window.SoldierUnitView && window.SOLDIER_MANIFEST && this.textures.exists('sold_stand_idle'))
            ? window.SoldierUnitView : UnitView;
        this.unitView = new UnitViewClass(this, this.unitGroup, this.hpGroup);
        this.tacticalMinimap = window.TacticalMinimap ? new TacticalMinimap(this) : null;
        if (window.TacticalPauseOverlay) {
            this.tacticalPause = new TacticalPauseOverlay(this, {
                getSoldiers: () => {
                    const rtwp = window.RtwpBattle && window.RtwpBattle.instance;
                    return rtwp && rtwp.sim ? rtwp.sim.soldiers() : [];
                },
                getCommandDelay: (id) => {
                    const rtwp = window.RtwpBattle && window.RtwpBattle.instance;
                    const sim = rtwp && rtwp.sim;
                    return sim && sim.orders && sim.orders.estimateDelay
                        ? sim.orders.estimateDelay(String(id), sim._tick) : null;
                },
                getSelectedId: () => window.gameLogic && window.gameLogic.selectedUnit
                    ? String(window.gameLogic.selectedUnit.id) : null,
                // 矩形選択した全員。ポーズ中も〇が1個しか付かないと、何人へ命じて
                // いるのか分からない（2026-08-04 ディレクター指摘）
                getSelectedIds: () => {
                    const gl = window.gameLogic;
                    if (!gl) return null;
                    if (gl.selectedUnits && gl.selectedUnits.length) {
                        return gl.selectedUnits.map((u) => String(u.id));
                    }
                    return gl.selectedUnit ? [String(gl.selectedUnit.id)] : null;
                },
                // 分隊長AIの采配（LeaderPolicy が leaderState へ残す計画）
                getPlan: () => {
                    const rtwp = window.RtwpBattle && window.RtwpBattle.instance;
                    return rtwp && rtwp.leaderState ? rtwp.leaderState.A.plan || null : null;
                },
                getPosition: (id) => {
                    let v = this.unitView && this.unitView.visuals.get(id);
                    if (!v && this.unitView && this.unitView.visuals) {
                        for (const [key, value] of this.unitView.visuals) {
                            if (String(key) === String(id)) { v = value; break; }
                        }
                    }
                    return v && v.container ? { x: v.container.x, y: v.container.y } : null;
                },
                getDisplayName: (id) => {
                    const rtwp = window.RtwpBattle && window.RtwpBattle.instance;
                    const unit = rtwp && rtwp.unitById && rtwp.unitById.get(String(id));
                    return unit && unit.name ? unit.name : String(id);
                },
                getPendingTargetId: (id) => {
                    const rtwp = window.RtwpBattle && window.RtwpBattle.instance;
                    const unit = rtwp && rtwp.unitById && rtwp.unitById.get(String(id));
                    return unit && unit._rtwpPendingTargetId;
                },
                getPendingTargetHex: (id) => {
                    const rtwp = window.RtwpBattle && window.RtwpBattle.instance;
                    const unit = rtwp && rtwp.unitById && rtwp.unitById.get(String(id));
                    return unit && unit._rtwpPendingTargetHex;
                },
                getPendingTargetMode: (id) => {
                    const rtwp = window.RtwpBattle && window.RtwpBattle.instance;
                    const unit = rtwp && rtwp.unitById && rtwp.unitById.get(String(id));
                    return unit && unit._rtwpPendingTargetMode;
                },
                getPendingFiringHex: (id) => {
                    const rtwp = window.RtwpBattle && window.RtwpBattle.instance;
                    const unit = rtwp && rtwp.unitById && rtwp.unitById.get(String(id));
                    return unit && unit._rtwpPendingFiringHex;
                },
                getPendingApproachPath: (id) => {
                    const rtwp = window.RtwpBattle && window.RtwpBattle.instance;
                    const unit = rtwp && rtwp.unitById && rtwp.unitById.get(String(id));
                    return unit && unit._rtwpPendingApproachPath;
                },
            });
        }
        // 戦雲一時廃止中(window.BATTLE_CLOUD_ENABLED=false)はレンダラ自体を作らない。
        this.battleCloudRenderer = window.BATTLE_CLOUD_ENABLED ? new BattleCloudRenderer(this) : null;
        // カーソル位置を固定したままのズーム。"グリグリ"の手触りはここで決まる。
        //
        // 旧実装は ±0.5 の固定ステップ＋tween だったので、拡大するほど1ステップが
        // 相対的に小さくなり、しかも画面中心へ寄っていくのでカーソルの先が逃げた。
        // 乗算ステップにして、ズーム前後で「カーソルの下にあるワールド座標」を一致させる。
        //
        // Phaser のカメラは**ビューの中心**を軸に拡大するので、scrollX を差分で補正すると
        // 原点の扱いを取り違える（sim_battle.html で実測: 1ステップあたり144pxズレた）。
        // 画面中心からカーソルまでのオフセットがワールド換算で 1/zoom に比例することを使い、
        // 望みの中心を直接 centerOn する。
        this.input.on('wheel', (pointer, gameObjects, deltaX, deltaY) => {
            const cam = this.cameras.main;
            const dpr = (typeof Renderer !== 'undefined' && Renderer.RENDER_DPR) || 1;
            const factor = deltaY > 0 ? 1 / 1.12 : 1.12;
            const range = this._mapZoomRange || { min: 0.28 * dpr, max: 4 * dpr };
            const next = Phaser.Math.Clamp(cam.zoom * factor, range.min, range.max);
            if (next === cam.zoom) return;
            const wp = cam.getWorldPoint(pointer.x, pointer.y);
            const dx = pointer.x - cam.width / 2;
            const dy = pointer.y - cam.height / 2;
            cam.setZoom(next);
            if (this._mapBounds && cam.setBounds) {
                const sidebarW = this._battlefieldSidebarWidth();
                cam.setBounds(
                    this._mapBounds.x,
                    this._mapBounds.y,
                    this._mapBounds.width + sidebarW / next,
                    this._mapBounds.height,
                    false
                );
            }
            cam.centerOn(wp.x - dx / next, wp.y - dy / next);
        });
        
        this.getUnitAtScreenPosition = (screenX, screenY) => {
            if (!window.gameLogic || !this.unitView) return null;
            const world = this.cameras.main.getWorldPoint(screenX, screenY);
            const units = window.gameLogic.units.filter(u => u.hp > 0);
            for (let i = units.length - 1; i >= 0; i--) {
                const v = this.unitView.visuals.get(units[i].id);
                if (v && v.container && v.container.getBounds) {
                    const b = v.container.getBounds();
                    if (b.contains(world.x, world.y)) return units[i];
                }
            }
            return null;
        };
        this.getClosestUnitToScreen = (unitArray, screenX, screenY) => {
            if (!unitArray || unitArray.length === 0 || !this.unitView) return null;
            const world = this.cameras.main.getWorldPoint(screenX, screenY);
            let best = null; let bestDist = Infinity;
            unitArray.forEach(u => {
                const v = this.unitView.visuals.get(u.id);
                if (!v || !v.container) return;
                const cx = v.container.x; const cy = v.container.y;
                const d = (cx - world.x) * (cx - world.x) + (cy - world.y) * (cy - world.y);
                if (d < bestDist) { bestDist = d; best = u; }
            });
            return best;
        };
        this._lastClick = { time: 0, x: 0, y: 0 };
        this.input.on('pointerdown', (p) => { 
            if (Renderer.isCardDragging || Renderer.checkUIHover(p.x, p.y, p.event)) return; 
            if (Renderer.suppressMapClick) { Renderer.suppressMapClick = false; return; }
            const hex = Renderer.pxToHex(p.x, p.y);
            if(p.button === 0) { 
                const now = Date.now();
                const last = this._lastClick;
                const isDoubleClick = (now - last.time < 450) && (Math.abs(p.x - last.x) < 15 && Math.abs(p.y - last.y) < 15);
                this._lastClick = { time: now, x: p.x, y: p.y };

                if (window.__debugInstantKill && isDoubleClick && window.gameLogic && window.gameLogic.getUnitsInHex) {
                    const inHex = window.gameLogic.getUnitsInHex(hex.q, hex.r).filter(u => u.hp > 0);
                    if (inHex.length > 0) {
                        const unit = inHex.length === 1 ? inHex[0] : (this.getClosestUnitToScreen ? this.getClosestUnitToScreen(inHex, p.x, p.y) : inHex[0]);
                        if (unit) {
                            window.gameLogic.applyDamage(unit, unit.hp + 999, 'Instant kill');
                            if (window.gameLogic.updateSidebar) window.gameLogic.updateSidebar();
                            Renderer.isMapDragging = true;
                            return;
                        }
                    }
                }
                // 左ドラッグは**矩形選択**へ割り当てた（2026-08-03 ディレクター指示）。
                // 地図の平行移動はホイールクリックへ移動。ドラッグで地図が動くと、
                // 画面端まで引いた時にPAUSEのスモークの外側（本来の色）が覗いてしまう。
                // クリック確定は pointerup で行う — ここで handleClick すると、
                // 矩形を引き始めた最初の1マスが毎回選択されてしまう。
                //
                // 座標は**画面とワールドの両方**を持つ。ワールド側が枠の描画と当たり
                // 判定の正、画面側はドラッグ判定の閾値（6px）とクリック時の座標用。
                // 閾値だけは画面px でないと、ズームを引いた時に指がやたら動く。
                const wp0 = this.cameras.main.getWorldPoint(p.x, p.y);
                const gl = window.gameLogic;
                const targeting = !!(gl && gl.canDragPendingTargets && gl.canDragPendingTargets());
                // ユニットの見えている範囲から始めた操作は、地面ドラッグへ落とさない。
                // sprite本体のイベントが先に拾うが、透明縁でも同じ意味になる安全弁。
                const directUnit = targeting && this.getUnitAtScreenPosition
                    ? this.getUnitAtScreenPosition(p.x, p.y) : null;
                if (directUnit && gl.onUnitClick) {
                    gl.onUnitClick(directUnit);
                    return;
                }
                Renderer.marquee = {
                    x0: p.x, y0: p.y, x1: p.x, y1: p.y,
                    wx0: wp0.x, wy0: wp0.y, wx1: wp0.x, wy1: wp0.y,
                    active: false, hex: hex,
                    mode: targeting ? 'targets' : 'units',
                    hexes: targeting ? [{ q: hex.q, r: hex.r }] : null,
                    lastHex: targeting ? { q: hex.q, r: hex.r } : null,
                };
            } else if(p.button === 1) {
                // ホイールクリックドラッグ = 地図の平行移動
                Renderer.isMapDragging = true;
            } else if(p.button === 2) {
                if(window.gameLogic && window.gameLogic.handleRightClick) window.gameLogic.handleRightClick(p.x, p.y, hex);
            }
        });

        this.input.on('pointerup', (p) => {
            Renderer.isMapDragging = false;
            const m = Renderer.marquee;
            Renderer.marquee = null;
            this.drawMarquee(null);
            if (!m || p.button !== 0) return;
            if (m.active) {
                if (m.mode === 'targets') {
                    if (window.gameLogic && window.gameLogic.handleTargetDrag) {
                        window.gameLogic.handleTargetDrag(m.hexes || []);
                    }
                    return;
                }
                const units = this.unitsInWorldRect(m.wx0, m.wy0, m.wx1, m.wy1);
                if (window.gameLogic && window.gameLogic.handleMarqueeSelect) {
                    window.gameLogic.handleMarqueeSelect(units, p.x, p.y);
                }
                return;
            }
            // ドラッグしなかった＝ただのクリック。従来どおりの単発処理へ流す
            if (window.gameLogic && window.gameLogic.handleClick) {
                window.gameLogic.handleClick(m.hex, m.x0, m.y0);
            }
        });
        this.input.on('pointermove', (p) => {
            if (Renderer.isCardDragging) return;
            if (p.isDown && Renderer.isMapDragging) { const zoom = this.cameras.main.zoom; this.cameras.main.scrollX -= (p.x - p.prevPosition.x) / zoom; this.cameras.main.scrollY -= (p.y - p.prevPosition.y) / zoom; }
            const m = Renderer.marquee;
            if (m && p.isDown) {
                m.x1 = p.x; m.y1 = p.y;
                const wp = this.cameras.main.getWorldPoint(p.x, p.y);
                m.wx1 = wp.x; m.wy1 = wp.y;
                // 手ぶれをドラッグと誤認しない閾値。これ未満はクリック扱いのまま
                if (!m.active && (Math.abs(m.x1 - m.x0) > 6 || Math.abs(m.y1 - m.y0) > 6)) m.active = true;
                if (m.active && m.mode === 'targets') {
                    const current = Renderer.pxToHex(p.x, p.y);
                    const segment = this.hexDragSegment(m.lastHex, current);
                    const known = new Set((m.hexes || []).map(h => h.q + ',' + h.r));
                    segment.forEach(h => {
                        const valid = !window.gameLogic || !window.gameLogic.isValidHex
                            || window.gameLogic.isValidHex(h.q, h.r);
                        const key = h.q + ',' + h.r;
                        if (valid && !known.has(key)) { known.add(key); m.hexes.push(h); }
                    });
                    m.lastHex = current;
                    if (window.gameLogic && window.gameLogic.handleTargetDragPreview) {
                        window.gameLogic.handleTargetDragPreview(m.hexes || []);
                    }
                    this.drawMarquee(null);
                    return;
                }
                if (m.active) { this.drawMarquee(m); return; }
            }
            if (!Renderer.isMapDragging && window.gameLogic) {
                const hoverHex = Renderer.pxToHex(p.x, p.y);
                const hoverUnit = this.getUnitAtScreenPosition
                    ? this.getUnitAtScreenPosition(p.x, p.y) : null;
                if (window.gameLogic.handleTargetHover) {
                    window.gameLogic.handleTargetHover(hoverHex, hoverUnit);
                }
                if (window.gameLogic.handleHover) window.gameLogic.handleHover(hoverHex);
            }
        });
        this.input.on('gameout', () => {
            if (window.gameLogic && window.gameLogic.handleTargetHover) {
                window.gameLogic.handleTargetHover(null, null);
            }
        });
        this.input.mouse.disableContextMenu();
        this.input.keyboard.on('keydown-ESC', () => { if(window.gameLogic && window.gameLogic.clearSelection) { window.gameLogic.clearSelection(); } });
        this.input.keyboard.on('keydown-TAB', (event) => {
            if (window.gameLogic && window.gameLogic.state === 'PLAY' && window.gameLogic.selectNextUnit) {
                event.preventDefault();
                window.gameLogic.selectNextUnit(event.shiftKey ? -1 : 1);
            }
        });
    }
    /**
     * 矩形選択の枠を描く（**ワールド座標**）。null で消す。
     *
     * 以前は画面座標 + setScrollFactor(0) で描いていたが、scrollFactor 0 が無視するのは
     * スクロールだけで、**ズームはカメラ中心を軸に効いたまま**。そのため枠は
     *     描画位置 = (指定x - 画面中心) * zoom + 画面中心
     * へ飛び、ズームが 1 でない時ほど、また画面端ほどポインタから離れて出ていた。
     * ワールド座標で描けばこの変換自体が消え、必ずポインタの先から出る。
     */
    drawMarquee(m) {
        if (!this._marqueeGfx) {
            this._marqueeGfx = this.add.graphics();
            this._marqueeGfx.setDepth(999999);
        }
        const g = this._marqueeGfx;
        g.clear();
        if (!m) return;
        const x = Math.min(m.wx0, m.wx1), y = Math.min(m.wy0, m.wy1);
        const w = Math.abs(m.wx1 - m.wx0), h = Math.abs(m.wy1 - m.wy0);
        g.fillStyle(0x88ccff, 0.10);
        g.fillRect(x, y, w, h);
        // 線幅もワールド単位なので、ズームで割って画面上は常に細い1本にする
        g.lineStyle(1 / (this.cameras.main.zoom || 1), 0xaaddff, 0.9);
        g.strokeRect(x, y, w, h);
    }

    /** ポインタが飛んだフレームでも途中のhexを取りこぼさない axial 線分。 */
    hexDragSegment(from, to) {
        if (!from || !to) return [];
        const dist = Math.max(Math.abs(from.q - to.q), Math.abs(from.r - to.r),
            Math.abs((from.q + from.r) - (to.q + to.r)));
        if (!dist) return [{ q: to.q, r: to.r }];
        const round = (q, r) => {
            const x = q, z = r, y = -x - z;
            let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
            const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
            if (dx > dy && dx > dz) rx = -ry - rz;
            else if (dy > dz) ry = -rx - rz;
            else rz = -rx - ry;
            return { q: rx, r: rz };
        };
        const out = [];
        for (let i = 0; i <= dist; i++) {
            const t = i / dist;
            const h = round(from.q + (to.q - from.q) * t, from.r + (to.r - from.r) * t);
            if (!out.length || out[out.length - 1].q !== h.q || out[out.length - 1].r !== h.r) out.push(h);
        }
        return out;
    }

    /**
     * ワールド座標の矩形に触れている**自軍の生存兵**を返す。
     *
     * 判定は見えている姿（コンテナの外接矩形＝影とスプライトだけ。HPバーは別レイヤ）
     * との重なりで行う。ヘックス単位だと同ヘックスの散布位置とズレるし、足元の1点
     * だけを見ると、体を囲ったのに掴めないという操作になる。
     */
    unitsInWorldRect(x0, y0, x1, y1) {
        const out = [];
        const gl = window.gameLogic;
        const view = this.unitView;
        if (!gl || !view || !view.visuals) return out;
        const lo = { x: Math.min(x0, x1), y: Math.min(y0, y1) };
        const hi = { x: Math.max(x0, x1), y: Math.max(y0, y1) };
        for (const u of gl.units) {
            if (u.hp <= 0 || u.team !== 'player') continue;
            const vis = view.visuals.get(u.id);
            if (!vis || !vis.container) continue;
            const c = vis.container;
            const b = (typeof c.getBounds === 'function') ? c.getBounds() : null;
            const hit = b
                ? (b.x <= hi.x && b.x + b.width >= lo.x && b.y <= hi.y && b.y + b.height >= lo.y)
                : (c.x >= lo.x && c.x <= hi.x && c.y >= lo.y && c.y <= hi.y);
            if (hit) out.push(u);
        }
        return out;
    }

    updateSidebarViewport() {
        // Keep the main camera on Phaser's standard full-canvas path. The
        // opaque sidebar scene blocks map input, so drawing below it is safe.
        // setPosition + setSize also clears a stale custom-viewport flag.
        this.cameras.main.setPosition(0, 0);
        this.cameras.main.setSize(this.scale.width, this.scale.height);
    }
    _battlefieldSidebarWidth() {
        const app = typeof document !== 'undefined' ? document.getElementById('app') : null;
        return app && app.classList.contains('phaser-sidebar') && window.getSidebarWidth
            ? window.getSidebarWidth()
            : 0;
    }
    triggerExplosion(x, y, tier, hex, opts) {
        const meta = tier && window.KHAOS_FX && KHAOS_FX.TIERS[tier];
        if (!meta) { this._triggerLegacyExplosion(x, y); return; }
        const v = KHAOS_FX.VARIANTS[(Math.random() * KHAOS_FX.VARIANTS.length) | 0];
        const key = KHAOS_FX.key(tier, v);
        if (!this.textures.exists(key)) { this._triggerLegacyExplosion(x, y); return; }
        const animKey = key + '_anim';
        if (!this.anims.exists(animKey)) {
            this.anims.create({
                key: animKey,
                frames: this.anims.generateFrameNumbers(key, { start: 0, end: meta.frames - 1 }),
                frameRate: meta.fps, repeat: 0
            });
        }
        // プレビュー(map_preview_explosions.html)と同じアンカー: 水平中央・爆心をヘックス
        // 中心のやや下に置き、立ち上る煙柱がタイルから上へ抜ける
        const size = Math.sqrt(3) * HEX_SIZE * meta.sizeMul * ((opts && opts.sizeScale) || 1);
        const spr = this.add.sprite(x, y, key, 0);
        spr.setOrigin(0.5, 0.62);
        spr.setScale(size / KHAOS_FX.FRAME);
        spr.setDepth(1999);
        spr.play(animKey);
        spr.once('animationcomplete', () => { spr.destroy(); });

        if (meta.shake) this.cameras.main.shake(meta.shake.dur, meta.shake.int);

        // 着弾痕を地表へ焼き込み、周囲の立体物を段階破壊する(いずれも不可逆)。
        // 煙がタイルを覆った頃に差し込むと、晴れたときには既に痕が残り
        // 建物が崩れている、というPS的な見え方になる。
        const burnDelay = (meta.frames / meta.fps) * 1000 * 0.45;
        const blastTier = (opts && opts.blastTier) || tier;
        const blast = window.KHAOS_FX && KHAOS_FX.BLAST[blastTier];
        const visualOnly = !!(opts && opts.visualOnly);
        const psTier = (opts && opts.psDecalTier) || tier;
        const psScale = opts && opts.psDecalScale;
        if (!visualOnly && ((opts && opts.persistentDecal)
            || (window.DecalLayer && window.DecalLayer.ready()) || window.PsObjectLayer)) {
            setTimeout(() => {
                if (opts && opts.persistentDecal) {
                    this._stampPersistentImpactDecal(x, y, psTier, psScale);
                } else if (window.DecalLayer && window.DecalLayer.ready()) {
                    window.DecalLayer.stamp(x, y, psTier, { scale: psScale });
                }
                // severity 0 (銃弾) は痕だけ残し構造は壊さない
                if (blast && blast.severity > 0 && window.PsObjectLayer && window.PsObjectLayer.count()) {
                    window.PsObjectLayer.damageAt(x, y, blast.radius, blast.severity);
                }
            }, burnDelay);
        }
        // 直撃地点の段階破壊: 煙がタイルを覆った頃に差し替える。
        // 建物があれば建物を、なければ地面（道路寸断・石畳クレーター化）を損傷
        if (!visualOnly && meta.damageBuilding && hex && window.TerrainRenderV7 && window.CityMap && window.CityMap.active) {
            const collapseDelay = (meta.frames / meta.fps) * 1000 * 0.45;
            setTimeout(() => {
                if (!window.TerrainRenderV7.damageBuilding(this, hex.q, hex.r)) {
                    window.TerrainRenderV7.damageGround(this, hex.q, hex.r);
                }
            }, collapseDelay);
        }
    }
    playPsOriginalFx(x, y, kind, opts) {
        const registry = window.PS_ORIGINAL_FX;
        const meta = registry && registry.enabled && registry[kind];
        if (!meta || !this.textures.exists(meta.key)) return false;
        const animKey = meta.key + '_anim';
        if (!this.anims.exists(animKey)) {
            this.anims.create({
                key: animKey,
                frames: this.anims.generateFrameNumbers(meta.key, { start: 0, end: meta.frames - 1 }),
                frameRate: meta.fps,
                repeat: meta.repeat ? -1 : 0
            });
        }
        const sprite = this.add.sprite(x, y, meta.key, 0)
            .setOrigin(meta.anchorX / meta.frameWidth, meta.anchorY / meta.frameHeight)
            .setScale((opts && opts.scale) || 1)
            .setDepth((opts && opts.depth) || 1998);
        sprite.play(animKey);
        if (meta.repeat) {
            const duration = (opts && opts.duration) || 6000;
            if (this.time && this.time.delayedCall) this.time.delayedCall(duration, () => sprite.destroy());
            else setTimeout(() => sprite.destroy(), duration);
        } else {
            sprite.once('animationcomplete', () => sprite.destroy());
        }
        return true;
    }
    playFirePrototype(x, y, opts) {
        const meta = window.PS_FIRE_PROTOTYPE;
        if (!meta || !meta.enabled || !this.textures.exists(meta.key)) return false;
        const animKey = meta.key + '_anim';
        if (!this.anims.exists(animKey)) {
            this.anims.create({
                key: animKey,
                frames: this.anims.generateFrameNumbers(meta.key, { start: 0, end: meta.frames - 1 }),
                frameRate: meta.fps,
                repeat: meta.repeat ? -1 : 0
            });
        }
        const sprite = this.add.sprite(x, y, meta.key, 0)
            .setOrigin(meta.anchorX / meta.frameWidth, meta.anchorY / meta.frameHeight)
            .setScale((opts && opts.scale) || meta.scale)
            .setDepth((opts && opts.depth) || 1998)
            .play(animKey);
        const duration = (opts && opts.duration) || 8000;
        if (this.time && this.time.delayedCall) this.time.delayedCall(duration, () => sprite.destroy());
        return true;
    }
    playMuzzleSmoke(x, y, angle, weapon, rounds, opts) {
        const meta = window.MUZZLE_SMOKE_FX;
        const count = Math.max(1, Math.round(rounds || 1));
        if (!meta || !meta.enabled || !this.textures.exists(meta.key)) return false;
        if (!(opts && opts.reference) && (count >= 5 || (weapon && weapon.type && weapon.type !== 'bullet'))) return false;
        const animKey = meta.key + '_anim';
        if (!this.anims.exists(animKey)) {
            this.anims.create({
                key: animKey,
                frames: this.anims.generateFrameNumbers(meta.key, { start: 0, end: meta.frames - 1 }),
                frameRate: meta.fps,
                repeat: 0
            });
        }
        const reference = !!(opts && opts.reference);
        const alpha = reference ? 0.82 : (count >= 2 ? 0.18 : meta.alpha);
        const scale = reference ? 1 : meta.scale;
        const muzzleLead = reference ? 0 : 3;
        const sprite = this.add.sprite(x + Math.cos(angle) * muzzleLead,
            y + Math.sin(angle) * muzzleLead, meta.key, 0)
            .setOrigin(meta.anchorX / meta.frameWidth, meta.anchorY / meta.frameHeight)
            .setRotation(angle)
            .setScale(scale)
            .setAlpha(alpha)
            .setDepth(1498);
        sprite.play(animKey);
        if (!reference) {
            const seq = ++meta._seq;
            const jitter = (((Math.imul(seq + Math.round(x), 1103515245) >>> 16) & 255) / 255) - 0.5;
            const duration = (meta.frames / meta.fps) * 1000;
            const sampledWind = window.VFX && VFX.getVisualWindVector
                ? VFX.getVisualWindVector(Math.hypot(meta.breezeX, meta.breezeY)) : null;
            const windX = sampledWind ? sampledWind.x : meta.breezeX;
            const windY = sampledWind ? sampledWind.y : meta.breezeY;
            this.tweens.add({
                targets: sprite,
                x: sprite.x + windX + jitter * 2,
                y: sprite.y + windY + jitter,
                duration: duration,
                ease: 'Linear'
            });
        }
        sprite.once('animationcomplete', () => sprite.destroy());
        return true;
    }
    _stampPersistentImpactDecal(x, y, tier, scale) {
        const layer = window.DecalLayer;
        const manifest = layer && layer.manifest;
        const tierName = layer && layer.TIER_MAP ? (layer.TIER_MAP[tier] || tier) : tier;
        const list = manifest && manifest.tiers && manifest.tiers[tierName];
        if (!list || !list.length) return false;
        const decal = list[(Math.random() * list.length) | 0];
        const key = 'decal_' + decal.id;
        if (!this.textures.exists(key)) return false;
        const extra = Number(scale) > 0 ? Number(scale) : 1;
        const image = this.add.image(x, y, key)
            .setOrigin(-decal.ox / decal.w, -decal.oy / decal.h)
            .setScale(extra)
            .setDepth(0.1);
        this._persistentImpactDecals.push(image);
        return true;
    }
    /**
     * 銃口炎。4つの独立した燃焼形状(pop+fade各2フレーム)を毎回ラウンドロビンで
     * 切り替える — 実銃の発射ガスは毎回不揃いに燃えるため、単一クリップの
     * 使い回しでなく形状自体を変えることで連射時の高速点滅が「同じ絵の反復」
     * にならない(2026-07-13 ユーザー要望)。+X向きレンダーを射線方向へ回転。
     * アセット未納品(テクスチャなし)なら静かに何もしない。
     */
    triggerMuzzleFlash(x, y, angle, weapon) {
        if (window.VFX && window.VFX.playMuzzleFlash) {
            window.VFX.playMuzzleFlash(x, y, angle, weapon);
            return;
        }
        if (!this.textures.exists('muzzle_flash')) return;
        const meta = window.KHAOS_FX;
        const variant = meta._muzzleRR = ((meta._muzzleRR || 0) + 1) % 4;
        const animKey = 'muzzle_flash_anim_' + variant;
        if (!this.anims.exists(animKey)) {
            this.anims.create({
                key: animKey,
                frames: this.anims.generateFrameNumbers('muzzle_flash', { start: variant * 2, end: variant * 2 + 1 }),
                frameRate: 40, repeat: 0
            });
        }
        const spr = this.add.sprite(x, y, 'muzzle_flash', variant * 2);
        spr.setOrigin(0.34, 0.5);            // コア実測位置(x≈47-57/128)を銃口支点に
        spr.setRotation(angle);
        spr.setScale(0.32 + Math.random() * 0.08);
        spr.setBlendMode(Phaser.BlendModes.ADD);
        spr.setDepth(1998);
        spr.play(animKey);
        spr.once('animationcomplete', () => { spr.destroy(); });
    }
    _triggerLegacyExplosion(x, y) {
        const explosion = this.add.sprite(x, y, 'explosion_sheet');
        explosion.setDepth(1999);
        explosion.setScale(1.5);
        explosion.play('explosion_anim');
        explosion.once('animationcomplete', () => { explosion.destroy(); });
    }
    /** ヘックス座標(q,r)上に短いフロートテキストを表示（拒否理由など） */
    showFloatText(q, r, text, color) {
        const p = Renderer.hexToPx(q, r);
        const t = this.add.text(p.x, p.y - 40, text, { fontSize: '13px', fontFamily: 'sans-serif', color: color || '#ff5555', fontStyle: 'bold' })
            .setOrigin(0.5, 0.5).setDepth(1998);
        this.tweens.add({
            targets: t,
            y: p.y - 80,
            alpha: 0,
            duration: 900,
            ease: 'Cubic.out',
            onComplete: () => { t.destroy(); }
        });
    }
    centerCamera(q, r) { const p = Renderer.hexToPx(q, r); this.cameras.main.centerOn(p.x, p.y); }
    centerMap() {
        const map = window.gameLogic && window.gameLogic.map;
        if (!map) return;

        // v7 ground tiles extend about 61 px sideways from their hex anchor;
        // tall buildings need substantially more room above than below it.
        const extents = { left: 61, right: 61, top: 100, bottom: 45 };
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let q = 0; q < map.length; q++) {
            const column = map[q];
            if (!column) continue;
            for (let r = 0; r < column.length; r++) {
                const cell = column[r];
                if (!cell || (cell.id === -1 && !cell.city)) continue;
                const p = Renderer.hexToPx(q, r);
                minX = Math.min(minX, p.x - extents.left);
                maxX = Math.max(maxX, p.x + extents.right);
                minY = Math.min(minY, p.y - extents.top);
                maxY = Math.max(maxY, p.y + extents.bottom);
            }
        }
        if (!Number.isFinite(minX)) return;

        // PS正本マップは実体hexの島より背景キャンバスが広い。正本背景がある場合は
        // 画像そのものをカメラ範囲にして、画面端の黒い余白をなくす。
        const variant = window.RuralV29Map && window.RuralV29Map.lastVariant;
        const battlefield = variant && variant.psNative && window.PS_BATTLEFIELDS
            ? window.PS_BATTLEFIELDS[variant.psNative] : null;
        if (battlefield && battlefield.projection
            && Number.isFinite(battlefield.imageWidth) && Number.isFinite(battlefield.imageHeight)) {
            const projection = battlefield.projection;
            minX = projection.topLeftX;
            minY = projection.topLeftY;
            maxX = minX + battlefield.imageWidth * projection.scale;
            maxY = minY + battlefield.imageHeight * projection.scale;
        }

        const camera = this.cameras.main;
        const mapW = maxX - minX;
        const mapH = maxY - minY;
        const sidebarW = this._battlefieldSidebarWidth ? this._battlefieldSidebarWidth() : 0;
        const battlefieldW = Math.max(1, camera.width - sidebarW);
        // containではなくcover。最小ズームでも上下左右に背景色を露出させない。
        const zoomFit = Math.max(battlefieldW / mapW, camera.height / mapH) * 1.01;
        // zoomFit は camera.width から出るので DPR に自動追従するが、クランプの上下限は
        // 実寸基準の値なので DPR 倍しないと高DPI環境だけ range が狭まる。
        const dpr = (typeof Renderer !== 'undefined' && Renderer.RENDER_DPR) || 1;
        // 広域背景を画面いっぱいに敷く。全容はミニマップで保証し、主画面には
        // 地面の無い帯を出さない。
        const minZoom = Phaser.Math.Clamp(zoomFit, 0.24 * dpr, 4 * dpr);
        const maxZoom = Math.max(minZoom, Math.min(5 * dpr, minZoom * 2.75));
        this._mapZoomRange = { min: minZoom, max: maxZoom };
        camera.zoom = minZoom;
        const sidebarWorldW = sidebarW / minZoom;
        this._mapBounds = { x: minX, y: minY, width: mapW, height: mapH };
        if (camera.setBounds) camera.setBounds(minX, minY, mapW + sidebarWorldW, mapH, false);
        camera.centerOn((minX + maxX) / 2 + sidebarWorldW / 2, (minY + maxY) / 2);
        if (this.tacticalMinimap) {
            this.tacticalMinimap.fit({ x: minX, y: minY, w: mapW, h: mapH });
        }
    }
    createMap() {
        if(!window.gameLogic || !window.gameLogic.map) return;
        this._persistentImpactDecals.forEach((image) => { if (image && image.destroy) image.destroy(); });
        this._persistentImpactDecals.length = 0;
        const map = window.gameLogic.map; this.hexGroup.removeAll(true); this.decorGroup.removeAll(true); this.unitGroup.removeAll(true); if(this.rubbleFrontGroup) this.rubbleFrontGroup.removeAll(true); this.treeGroup.removeAll(true); this.hpGroup.removeAll(true);
        if(this.unitView) this.unitView.clear();
        // 農村V29モード: 背景画像レンダラへ全面委譲
        const ruralMode = window.RuralV29Map && window.RuralV29Map.active && window.TerrainRenderRuralV29;
        if (ruralMode) {
            if (this.roadGraphics) this.roadGraphics.clear();
            window.TerrainRenderRuralV29.buildMap(this, this.hexGroup, map);
            // PS正本キャンバスは木・低木まで背景に焼き込み済み。上から散布すると二重になる。
            const psNativeBg = !!(window.RuralV29Map.lastVariant && window.RuralV29Map.lastVariant.psNative);
            if (window.VegetationLayer && !psNativeBg) window.VegetationLayer.build(this, map);
            if (window.SceneComposition) window.SceneComposition.applyGrade(this);
            this.centerMap();
            return;
        }
        // WW2廃墟都市モード: v7タイルレンダラへ全面委譲（旧デコレーションも湧かせない）
        const cityMode = window.CityMap && window.CityMap.active && window.TerrainRenderV7;
        if (cityMode) {
            if (this.roadGraphics) this.roadGraphics.clear();
            window.TerrainRenderV7.buildMap(this, this.hexGroup, map);
            this.centerMap();
            return;
        }
        const useTileTerrain = window.TerrainRender && window.TerrainRender.enabled;
        if (useTileTerrain) {
            window.TerrainRender.buildMap(this, this.hexGroup, map, this.decorGroup, this.roadGraphics);
        } else if (this.roadGraphics) {
            this.roadGraphics.clear();
        }
        this.centerMap();
        for(let q=0; q<MAP_W; q++) {
            for(let r=0; r<MAP_H; r++) { 
                const t = map[q][r]; if(t.id===-1)continue; const pos = Renderer.hexToPx(q, r); 
                const decorId = (t.id === 3 && t.underId != null) ? t.underId : t.id;
                if (!useTileTerrain) {
                    const hex = this.add.image(pos.x, pos.y, 'hex_base').setScale(1/window.HIGH_RES_SCALE); 
                    let tint = 0x555555; if(t.id===0) tint=0x5a5245; else if(t.id===1) tint=0x335522; else if(t.id===2) tint=0x112211; else if(t.id===3) tint=0x4a4845; else if(t.id===4) tint=0x504540; else if(t.id===5) { tint=0x303840; if(window.EnvSystem) window.EnvSystem.registerWater(hex, pos.y, q, r, this.decorGroup); }
                    hex.setTint(tint); this.hexGroup.add(hex);
                }
                if(window.EnvSystem) {
                    const v1 = useTileTerrain && window.TerrainRender.useV1Tiles;
                    if (decorId === 1) {
                        if (v1) {
                            window.EnvSystem.spawnGrassSparse(this, this.decorGroup, pos.x, pos.y, q, r);
                        } else if (!useTileTerrain) {
                            window.EnvSystem.spawnGrass(this, this.decorGroup, pos.x, pos.y);
                        }
                    }
                    if (decorId === 2) {
                        if (v1) window.EnvSystem.spawnTreesSparse(this, this.treeGroup, pos.x, pos.y, q, r);
                        else window.EnvSystem.spawnTrees(this, this.treeGroup, pos.x, pos.y);
                    }
                    if(decorId === 4) window.EnvSystem.spawnRubble(this, pos.x, pos.y, this.decorGroup, this.rubbleFrontGroup);
                }
            } 
        }
    }
    /**
     * 盤面が「揃った」か。地面・立体物は読めたものから描く連鎖ロードなので、
     * 待たずに始めると地面だけの盤面で撃ち合いが始まり、あとから木や建物が
     * 湧いて見える。地形レンダラが別方式なら従来どおり待たない。
     */
    battlefieldReady() {
        const t = window.TerrainRenderRuralV29;
        if (!t || typeof t.isReady !== 'function' || !t._started) return true;
        if (!t.isReady()) return false;
        // 立体物スプライトの追加ロードが走っている間も「揃っていない」
        return !(this.load && this.load.isLoading && this.load.isLoading());
    }

    /**
     * 揃うまで戦場を伏せておく幕。
     * - 幕は不透明。半透明だと「作りかけの盤面が透けて見える」のが一番みすぼらしい。
     * - 寸法は毎フレーム張り直す。起動直後は #game-view の実寸が数フレーム遅れて
     *   確定するため、生成時のサイズで固定すると右下に戦場が覗く。
     * - ミニマップは DOM canvas で幕の外側にいる。準備中は伏せる。
     */
    updateBattlefieldGate(time) {
        const ready = this.battlefieldReady();
        if (!this.battlefieldGate) {
            if (ready || this.battlefieldGateFading) return;
            const veil = this.add.rectangle(0, 0, 10, 10, 0x05070a, 1).setOrigin(0, 0);
            const label = this.add.text(0, 0, '戦場を準備中', {
                fontFamily: 'Share Tech Mono, monospace', fontSize: '18px', color: '#d8e9e5',
            }).setOrigin(0.5, 0.5);
            label.setLetterSpacing && label.setLetterSpacing(2);
            const bar = this.add.graphics();
            const gate = this.add.container(0, 0, [veil, label, bar]);
            gate.setScrollFactor(0).setDepth(100000);
            this.battlefieldGate = gate;
            this.battlefieldGateParts = { veil, label, bar };
            this._setMinimapHidden(true);
        }

        const gate = this.battlefieldGate;
        const { veil, label, bar } = this.battlefieldGateParts;
        const w = this.scale.width, h = this.scale.height;
        veil.setSize(w, h);
        label.setPosition(Math.round(w / 2), Math.round(h / 2) - 12);

        // 進捗の実数は連鎖ロードで拾えないので、往復するスキャンバーで「動いて
        // いる」ことだけを見せる（偽のパーセント表示より正直）。
        const t = (time || 0) * 0.001;
        label.setText('戦場を準備中' + '.'.repeat(1 + (Math.floor(t * 2) % 3)));
        const trackW = Math.min(280, Math.max(160, Math.round(w * 0.22)));
        const trackX = Math.round(w / 2 - trackW / 2), trackY = Math.round(h / 2) + 14;
        const knobW = Math.round(trackW * 0.34);
        const phase = 0.5 - 0.5 * Math.cos(t * 1.9);
        const knobX = trackX + (trackW - knobW) * phase;
        bar.clear();
        bar.fillStyle(0x1a2420, 1).fillRect(trackX, trackY, trackW, 2);
        bar.fillStyle(0x7fd8c4, 0.85).fillRect(knobX, trackY, knobW, 2);

        if (ready) this._revealBattlefield();
    }

    /** 準備完了。幕を溶かして戦場を出す。 */
    _revealBattlefield() {
        const gate = this.battlefieldGate;
        if (!gate || this.battlefieldGateFading) return;
        this.battlefieldGateFading = true;
        this.battlefieldGate = null;
        this._setMinimapHidden(false);
        this.tweens.add({
            targets: gate, alpha: 0, duration: 420, ease: 'Sine.easeOut',
            onComplete: () => {
                gate.destroy(true);
                this.battlefieldGateParts = null;
                this.battlefieldGateFading = false;
            },
        });
    }

    _setMinimapHidden(hidden) {
        const mm = this.tacticalMinimap;
        if (mm && mm.setVisible) mm.setVisible(!hidden);
    }

    update(time, delta) {
        if (this.mapGenerated && window.PS_FX_INVENTORY_PREVIEW
            && !this._psFxInventoryPreviewStarted && window.PsFxInventory) {
            this._psFxInventoryPreviewStarted = true;
            const center = Renderer.hexToPx(Math.floor(MAP_W / 2), Math.floor(MAP_H / 2));
            PsFxInventory.play(this, PS_FX_INVENTORY_PREVIEW,
                PS_FX_INVENTORY_PREVIEW_CLIP, center.x, center.y, { depth: 1498 })
                .then(result => {
                    this.add.text(center.x - 90, center.y - 80,
                        'PANZER STRIKE: ' + result.family.category + ' / ' + result.clip.id, {
                            font: '10px monospace', color: '#e5d9c4', backgroundColor: '#202020'
                        }).setDepth(1499);
                }).catch(err => console.error('PS FX inventory preview', err));
        }
        if (this.mapGenerated && window.M2_CRATER_PREVIEW && !this._m2CraterPreviewPlayed) {
            const center = Renderer.hexToPx(Math.floor(MAP_W / 2), Math.floor(MAP_H / 2));
            if (this._stampPersistentImpactDecal(center.x, center.y, 'medium', 0.50)) {
                this._m2CraterPreviewPlayed = true;
            }
        }
        if (this.mapGenerated && window.PS_ORIGINAL_FX && PS_ORIGINAL_FX.preview
            && !this._psFxPreviewPlayed) {
            this._psFxPreviewPlayed = true;
            const center = Renderer.hexToPx(Math.floor(MAP_W / 2), Math.floor(MAP_H / 2));
            this.playPsOriginalFx(center.x - 90, center.y, 'fire', { duration: 8000 });
            this.playPsOriginalFx(center.x, center.y, 'fireAlt', { duration: 8000 });
            this.playPsOriginalFx(center.x + 90, center.y, 'smoke');
        }
        if (this.mapGenerated && window.PS_FIRE_PROTOTYPE && PS_FIRE_PROTOTYPE.enabled
            && !this._firePrototypePreviewPlayed) {
            this._firePrototypePreviewPlayed = true;
            const center = Renderer.hexToPx(Math.floor(MAP_W / 2), Math.floor(MAP_H / 2));
            this.add.text(center.x - 92, center.y - 88, 'PANZER STRIKE ORIGINAL', {
                font: '10px monospace', color: '#e5d9c4', backgroundColor: '#202020'
            }).setDepth(1999);
            this.add.text(center.x + 28, center.y - 88, 'ORIGINAL FIRE V1 (GATED)', {
                font: '10px monospace', color: '#e5d9c4', backgroundColor: '#202020'
            }).setDepth(1999);
            this.playPsOriginalFx(center.x - 55, center.y, 'fire', { duration: 30000, scale: 0.72 });
            this.playFirePrototype(center.x + 55, center.y, { duration: 30000 });
        }
        if (this.mapGenerated && window.MUZZLE_SMOKE_FX && MUZZLE_SMOKE_FX.preview
            && !this._muzzleSmokePreviewPlayed) {
            this._muzzleSmokePreviewPlayed = true;
            const center = Renderer.hexToPx(Math.floor(MAP_W / 2), Math.floor(MAP_H / 2));
            this.add.text(center.x - 72, center.y - 60, 'ORIGINAL PS RGBA', {
                font: '10px monospace', color: '#e5d9c4', backgroundColor: '#202020'
            }).setDepth(1499);
            this.add.text(center.x + 26, center.y - 60, 'V3 ORIGINAL-DERIVED', {
                font: '10px monospace', color: '#e5d9c4', backgroundColor: '#202020'
            }).setDepth(1499);
            let previewPass = 0;
            const previewShot = () => {
                this.playMuzzleSmoke(center.x - 45, center.y, 0, { type: 'bullet' }, 1, { reference: true });
                this.playMuzzleSmoke(center.x + 45, center.y, 0, { type: 'bullet' }, 1);
                previewPass++;
                if (previewPass < 4) this.time.delayedCall(1400, previewShot);
            };
            previewShot();
        }
        // ★修正: gameLogicが準備できていない、またはマップデータが無い場合は何もしない
        if (!window.gameLogic || !window.gameLogic.map) return;
        
        if (window.VFX && window.VFX.shakeRequest > 0) {
            this.cameras.main.shake(100, window.VFX.shakeRequest * 0.001);
            window.VFX.shakeRequest = 0;
        }
        if (window.VFX) {
            window.VFX.update();
            this.vfxGraphics.clear();
            window.VFX.draw(this.vfxGraphics);
        }
        if (window.EnvSystem) {
            try { window.EnvSystem.update(time); } catch (e) { console.error('EnvSystem.update', e); }
        }
        
        if (window.gameLogic.map.length > 0 && !this.mapGenerated) { this.createMap(); this.mapGenerated = true; }
        this.updateBattlefieldGate(time);

        // RTwP（NORTH_STAR §7 Strangler Fig 最終段階）。**唯一の実行系**。
        // ?rtwp=0 の旧ターン制切り戻しは撤去済み。RtwpBattle が常時シムを回して
        // gameLogic.units へ状態を書き戻すので、下の unitView.update() がそのまま
        // 実時間の動きを描く（描画側の改修は不要）。
        if (window.RtwpBattle && window.RtwpBattle.enabled) {
            // セクターごとに BattleFacade は作り直される（logic_campaign.js）。
            // 「instance が無い時だけ接続」だと、前のセクターのインスタンスが残って
            // いる限り新しい盤面へ繋がらず、面が一切動かなくなる。別の gameLogic を
            // 掴んでいたら繋ぎ直す（決着時の detach と二重の安全弁）。
            const bound = window.RtwpBattle.instance;
            const stale = bound && bound.gameLogic !== window.gameLogic;
            if ((!bound || stale) && window.gameLogic.state === 'PLAY'
                && window.gameLogic.map.length > 0 && this.battlefieldReady()) {
                try { window.RtwpBattle.attach(window.gameLogic); } catch (e) { console.error('RTwP attach', e); }
            }
            const rt = window.RtwpBattle.instance;
            if (rt) { try { rt.update(delta); } catch (e) { console.error('RTwP update', e); } }
        }

        if(this.unitView) this.unitView.update(time, delta);
        if (this.tacticalMinimap) this.tacticalMinimap.update();
        if (this.tacticalPause) {
            const rtwp = window.RtwpBattle && window.RtwpBattle.instance;
            this.tacticalPause.setActive(!!(rtwp && rtwp.paused));
            this.tacticalPause.update();
        }
        if (this.battleCloudRenderer) this.battleCloudRenderer.update(time);
        this.overlayGraphics.clear();
        
        if (this.dragHighlightHex) {
            const h = this.dragHighlightHex;
            if (Renderer.draggedCardType === 'aerial') {
                 if (window.gameLogic && window.gameLogic.isValidHex) {
                    this.overlayGraphics.lineStyle(3, 0xff2222, 0.8); 
                    this.drawDashedHexOutline(this.overlayGraphics, h.q, h.r, time * 0.05);
                    const targets = window.gameLogic.getNeighbors(h.q, h.r);
                    targets.forEach(th => { this.drawDashedHexOutline(this.overlayGraphics, th.q, th.r, time * 0.05); });
                }
            } else {
                let isValid = false;
                if (window.gameLogic && window.gameLogic.checkDeploy) {
                    const hexCap = window.gameLogic.getHexUnitCap ? window.gameLogic.getHexUnitCap() : 5;
                    isValid = window.gameLogic.isValidHex(h.q, h.r) && window.gameLogic.map[h.q][h.r].id !== -1 && window.gameLogic.getUnitsInHex(h.q, h.r).length < hexCap;
                }
                const color = isValid ? 0x00ffff : 0xff0000;
                this.overlayGraphics.lineStyle(3, color, 0.8);
                this.drawHexOutline(this.overlayGraphics, h.q, h.r);
                if(isValid) { this.overlayGraphics.fillStyle(color, 0.2); this.overlayGraphics.fillPath(); }
            }
        }
        
        const selected = window.gameLogic.selectedUnit;
        const targetPreview = window.gameLogic.targetPreview;
        if (targetPreview) {
            const actionColors = { MOVE: 0x55ddff, RUSH: 0x55ddff, CRAWL: 0x55ddff,
                SUPPRESS_HEX: 0xffcc55, ASSAULT: 0xff5555 };
            const previewColor = targetPreview.valid
                ? (actionColors[targetPreview.actionId] || 0x88ddff) : 0xb85a5a;
            if (targetPreview.targetKind === 'hex') {
                (targetPreview.hexes || []).forEach(h => {
                    this.drawFilledHex(this.overlayGraphics, h.q, h.r, previewColor, 0.16);
                    this.overlayGraphics.lineStyle(2, previewColor, 0.9);
                    this.drawHexOutline(this.overlayGraphics, h.q, h.r);
                });
            }
            (targetPreview.assignments || []).forEach(a => {
                if (!a || !a.unit) return;
                const fromVisual = this.unitView && this.unitView.visuals.get(a.unit.id);
                const from = fromVisual && fromVisual.container
                    ? { x: fromVisual.container.x, y: fromVisual.container.y }
                    : Renderer.hexToPx(a.unit.q, a.unit.r);
                let to = null;
                if (a.target && this.unitView) {
                    const targetVisual = this.unitView.visuals.get(a.target.id);
                    if (targetVisual && targetVisual.container) {
                        to = { x: targetVisual.container.x, y: targetVisual.container.y };
                    }
                }
                if (!to && a.hex) to = Renderer.hexToPx(a.hex.q, a.hex.r);
                if (!to && a.target) to = Renderer.hexToPx(a.target.q, a.target.r);
                if (a.plannedFiringHex && a.plannedPath && a.plannedPath.length) {
                    const firing = Renderer.hexToPx(a.plannedFiringHex.q, a.plannedFiringHex.r);
                    this.drawFilledHex(this.overlayGraphics,
                        a.plannedFiringHex.q, a.plannedFiringHex.r, 0x55ddff, 0.16);
                    this.overlayGraphics.lineStyle(2, 0x55ddff, a.valid ? 0.85 : 0.38);
                    this.drawHexOutline(this.overlayGraphics,
                        a.plannedFiringHex.q, a.plannedFiringHex.r);
                    this.drawPlannedPath(this.overlayGraphics, from, a.plannedPath,
                        a.valid ? 0x55ddff : 0x884444, a.valid ? 0.68 : 0.32);
                    if (to) this.drawAssignmentArrow(this.overlayGraphics, firing, to,
                        a.valid ? previewColor : 0x884444, a.valid ? 0.78 : 0.38);
                } else if (to) {
                    this.drawAssignmentArrow(this.overlayGraphics, from, to,
                        a.valid ? previewColor : 0x884444, a.valid ? 0.72 : 0.38);
                }
            });
            if (targetPreview.hoverUnit && this.unitView) {
                const hoverVisual = this.unitView.visuals.get(targetPreview.hoverUnit.id);
                if (hoverVisual && hoverVisual.container) {
                    const pulse = 21 + Math.sin(time * 0.009) * 2;
                    this.overlayGraphics.lineStyle(3, previewColor, targetPreview.valid ? 0.95 : 0.55);
                    this.overlayGraphics.strokeCircle(hoverVisual.container.x, hoverVisual.container.y - 4, pulse);
                }
            }
        }
        if(selected) {
            if(window.gameLogic.reachableHexes && window.gameLogic.reachableHexes.length > 0) { 
                this.overlayGraphics.lineStyle(1, 0xffffff, 0.3); 
                window.gameLogic.reachableHexes.forEach(h => this.drawHexOutline(this.overlayGraphics, h.q, h.r)); 
            }
            const march = window.gameLogic.marchReachableHexes;
            if (march && march.length > 0) {
                this.overlayGraphics.lineStyle(1, 0xddc020, 0.55);
                march.forEach(h => this.drawHexOutline(this.overlayGraphics, h.q, h.r));
                if (!this._marchTurnTexts) this._marchTurnTexts = [];
                this._marchTurnTexts.forEach(t => t.setVisible(false));
                let ti = 0;
                march.forEach(h => {
                    while (ti >= this._marchTurnTexts.length) {
                        this._marchTurnTexts.push(
                            this.add.text(0, 0, '', {
                                fontSize: '11px',
                                fontFamily: 'Share Tech Mono, monospace',
                                color: '#ddc020',
                            }).setDepth(251).setOrigin(0.5, 0.5)
                        );
                    }
                    const pos = Renderer.hexToPx(h.q, h.r);
                    const t = this._marchTurnTexts[ti++];
                    t.setText(String(h.turns));
                    t.setPosition(pos.x, pos.y - 2);
                    t.setVisible(true);
                });
            } else if (this._marchTurnTexts) {
                this._marchTurnTexts.forEach(t => t.setVisible(false));
            }
        } else if (this._marchTurnTexts) {
            this._marchTurnTexts.forEach(t => t.setVisible(false));
        }
        
        const gl = window.gameLogic;
        let overAimTarget = false;
        if (gl && gl.selectedUnit && gl.interactionMode === 'ATTACK' && gl.aimTargetUnit && this.unitView) {
            const aimUnit = gl.aimTargetUnit;
            const visual = this.unitView.visuals.get(aimUnit.id);
            if (visual && visual.container) {
                const bounds = visual.container.getBounds();
                const ptr = this.input.activePointer;
                const wp = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
                overAimTarget = bounds.contains(wp.x, wp.y);
            }
        }
        const hover = window.gameLogic ? window.gameLogic.hoverHex : null;
        if(selected && window.gameLogic.attackLine && window.gameLogic.attackLine.length > 0) {
            const targetUnit = window.gameLogic.aimTargetUnit;
            window.gameLogic.attackLine.forEach(h => {
                const alpha = (h.alpha !== undefined) ? h.alpha : 1;
                this.overlayGraphics.lineStyle(3, 0xff2222, 0.8 * alpha);
                const isUnitTarget = targetUnit && targetUnit.q === h.q && targetUnit.r === h.r;
                const offset = overAimTarget ? 0 : (isUnitTarget ? time * 0.05 : 0);
                this.drawDashedHexOutline(this.overlayGraphics, h.q, h.r, offset);
            });
        }
        const ptr = this.input.activePointer;
        const inAttackMode = gl && gl.selectedUnit && gl.interactionMode === 'ATTACK';
        if (this.hitChanceText) {
            if (inAttackMode && hover && gl.getEstimatedHitChance) {
                const targetUnit = this.getUnitAtScreenPosition ? this.getUnitAtScreenPosition(ptr.x, ptr.y) : null;
                const inHex = gl.getUnitsInHex ? gl.getUnitsInHex(hover.q, hover.r) : [];
                const enemies = inHex.filter(u => u.team !== gl.selectedUnit.team);
                let unit = (targetUnit && inHex.indexOf(targetUnit) >= 0) ? targetUnit : null;
                if (!unit && enemies.length > 0) unit = (this.getClosestUnitToScreen && enemies.length > 1) ? this.getClosestUnitToScreen(enemies, ptr.x, ptr.y) : enemies[0];
                const est = gl.getEstimatedHitChance(gl.selectedUnit, hover, unit);
                if (est) {
                    this.hitChanceText.setPosition(ptr.x + 22, ptr.y - 14);
                    this.hitChanceText.setText(est.isArea ? `~${est.hit}%` : `${est.hit}%`);
                    this.hitChanceText.setVisible(true);
                } else {
                    this.hitChanceText.setVisible(false);
                }
            } else {
                this.hitChanceText.setVisible(false);
            }
        }
        if(selected && hover && window.gameLogic.reachableHexes && window.gameLogic.reachableHexes.some(h => h.q === hover.q && h.r === hover.r)) { this.overlayGraphics.lineStyle(3, 0xffffff, 0.8); this.drawHexOutline(this.overlayGraphics, hover.q, hover.r); }
        else if (selected && hover && window.gameLogic.marchReachableHexes && window.gameLogic.marchReachableHexes.some(h => h.q === hover.q && h.r === hover.r)) { this.overlayGraphics.lineStyle(2, 0xddc020, 0.9); this.drawHexOutline(this.overlayGraphics, hover.q, hover.r); }
        const path = window.gameLogic.path;
        if(path && path.length > 0 && selected) {
            const isMarch = window.gameLogic.marchReachableHexes && hover && window.gameLogic.marchReachableHexes.some(h => h.q === hover.q && h.r === hover.r)
                && !(window.gameLogic.reachableHexes && window.gameLogic.reachableHexes.some(h => h.q === hover.q && h.r === hover.r));
            this.overlayGraphics.lineStyle(3, isMarch ? 0xddc020 : 0xffffff, isMarch ? 0.65 : 0.5);
            this.overlayGraphics.beginPath(); const s = Renderer.hexToPx(selected.q, selected.r); this.overlayGraphics.moveTo(s.x, s.y); path.forEach(p => { const px = Renderer.hexToPx(p.q, p.r); this.overlayGraphics.lineTo(px.x, px.y); }); this.overlayGraphics.strokePath(); 
        }
        this.crosshairGroup.clear();
        if (window.gameLogic.aimTargetUnit) { const u = window.gameLogic.aimTargetUnit; const pos = Renderer.hexToPx(u.q, u.r); this.drawCrosshair(this.crosshairGroup, pos.x, pos.y, time); }
        const canvas = this.game && this.game.canvas;
        if (canvas) {
            if (targetPreview) {
                canvas.style.cursor = targetPreview.valid ? 'crosshair' : 'not-allowed';
            } else if (overAimTarget) {
                const svgBright = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" fill="none" stroke="#f44" stroke-width="2"/><line x1="16" y1="2" x2="16" y2="30" stroke="#f44" stroke-width="2"/><line x1="2" y1="16" x2="30" y2="16" stroke="#f44" stroke-width="2"/></svg>';
                const svgDim = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" fill="none" stroke="#a33" stroke-width="2"/><line x1="16" y1="2" x2="16" y2="30" stroke="#a33" stroke-width="2"/><line x1="2" y1="16" x2="30" y2="16" stroke="#a33" stroke-width="2"/></svg>';
                const phase = Math.floor(time / 280) % 2;
                const url = phase === 0 ? 'url("data:image/svg+xml,' + encodeURIComponent(svgBright) + '") 16 16, crosshair' : 'url("data:image/svg+xml,' + encodeURIComponent(svgDim) + '") 16 16, crosshair';
                canvas.style.cursor = url;
            } else if (inAttackMode) {
                const svgWhite = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" fill="none" stroke="#e8e8f0" stroke-width="2"/><line x1="16" y1="4" x2="16" y2="28" stroke="#e8e8f0" stroke-width="2"/><line x1="4" y1="16" x2="28" y2="16" stroke="#e8e8f0" stroke-width="2"/></svg>';
                canvas.style.cursor = 'url("data:image/svg+xml,' + encodeURIComponent(svgWhite) + '") 16 16, crosshair';
            } else {
                canvas.style.cursor = '';
            }
        }
    }
    drawHexOutline(g, q, r) { const c = Renderer.hexToPx(q, r); g.beginPath(); for(let i=0; i<6; i++) { const a = Math.PI/180*(90+60*i); g.lineTo(c.x+HEX_SIZE*0.9*Math.cos(a), c.y+HEX_SIZE*0.9*Math.sin(a)); } g.closePath(); g.strokePath(); }
    drawFilledHex(g, q, r, color, alpha) {
        const c = Renderer.hexToPx(q, r);
        g.fillStyle(color, alpha);
        g.beginPath();
        for (let i = 0; i < 6; i++) {
            const a = Math.PI / 180 * (90 + 60 * i);
            const x = c.x + HEX_SIZE * 0.9 * Math.cos(a);
            const y = c.y + HEX_SIZE * 0.9 * Math.sin(a);
            if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.closePath();
        g.fillPath();
    }
    drawAssignmentArrow(g, from, to, color, alpha) {
        const dx = to.x - from.x, dy = to.y - from.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 2) return;
        const ux = dx / len, uy = dy / len;
        const endX = to.x - ux * 13, endY = to.y - uy * 13;
        g.lineStyle(2, color, alpha);
        g.beginPath(); g.moveTo(from.x, from.y - 4); g.lineTo(endX, endY); g.strokePath();
        const wing = 7;
        g.beginPath();
        g.moveTo(endX, endY);
        g.lineTo(endX - ux * wing - uy * wing * 0.65, endY - uy * wing + ux * wing * 0.65);
        g.moveTo(endX, endY);
        g.lineTo(endX - ux * wing + uy * wing * 0.65, endY - uy * wing - ux * wing * 0.65);
        g.strokePath();
    }
    drawPlannedPath(g, from, path, color, alpha) {
        if (!path || !path.length) return;
        g.lineStyle(2, color, alpha);
        g.beginPath();
        g.moveTo(from.x, from.y - 4);
        path.forEach(h => {
            const p = Renderer.hexToPx(h.q, h.r);
            g.lineTo(p.x, p.y);
        });
        g.strokePath();
    }
    drawDashedHexOutline(g, q, r, timeOffset = 0) {
        const c = Renderer.hexToPx(q, r); const pts = []; for(let i=0; i<6; i++) { const a = Math.PI/180*(90+60*i); pts.push({ x: c.x+HEX_SIZE*0.9*Math.cos(a), y: c.y+HEX_SIZE*0.9*Math.sin(a) }); }
        const dashLen = 6; const gapLen = 4; const period = dashLen + gapLen; let currentDistInPath = -timeOffset; 
        for(let i=0; i<6; i++) {
            const p1 = pts[i]; const p2 = pts[(i+1)%6]; const dist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y); const dx = (p2.x - p1.x) / dist; const dy = (p2.y - p1.y) / dist;
            let patternPhase = (currentDistInPath % period + period) % period; let distCovered = 0;
            while(distCovered < dist) {
                const isDash = patternPhase < dashLen; const lenToNextChange = isDash ? (dashLen - patternPhase) : (period - patternPhase); const segmentLen = Math.min(lenToNextChange, dist - distCovered);
                if(isDash) { g.beginPath(); g.moveTo(p1.x + dx * distCovered, p1.y + dy * distCovered); g.lineTo(p1.x + dx * (distCovered + segmentLen), p1.y + dy * (distCovered + segmentLen)); g.strokePath(); }
                distCovered += segmentLen; patternPhase = (patternPhase + segmentLen) % period;
            }
            currentDistInPath += dist;
        }
    }
    drawCrosshair(g, x, y, time) { }
}

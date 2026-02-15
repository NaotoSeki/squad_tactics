/** PHASER BRIDGE: Precise Click Handling & Aerial Support UI (Safety Check Added) */
let phaserGame = null;
window.HIGH_RES_SCALE = 2.0;

const FUSABLE_UNIT_TYPES = ['rifleman', 'scout', 'gunner', 'sniper', 'mortar_gunner', 'tank_pz4', 'tank_tiger'];

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

window.getCardTextureKey = function(scene, type) {
    const key = `card_texture_${type}`;
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
    ctx.fillText(template.name, 70, 22);
    ctx.fillStyle = "#000"; ctx.fillRect(20, 40, 100, 100);
    const seed = type.length * 999; const rnd = function(s) { return Math.abs(Math.sin(s * 12.9898) * 43758.5453) % 1; };
    const skinTones = ["#ffdbac", "#f1c27d", "#e0ac69"]; ctx.fillStyle = skinTones[Math.floor(rnd(seed) * skinTones.length)];
    ctx.beginPath(); ctx.arc(70, 90, 30, 0, Math.PI*2); ctx.fill(); 
    ctx.fillStyle = "#343"; ctx.beginPath(); ctx.arc(70, 80, 32, Math.PI, 0); ctx.lineTo(102, 80); ctx.lineTo(38, 80); ctx.fill(); 
    ctx.fillStyle = "#888"; ctx.font = "10px sans-serif"; 
    ctx.fillText(template.role ? template.role.toUpperCase() : "UNIT", 70, 155);
    let wpnName = template.main || "-"; if (typeof WPNS !== 'undefined' && WPNS[template.main]) { wpnName = WPNS[template.main].name; }
    ctx.fillStyle = "#ccc"; ctx.font = "11px monospace"; 
    ctx.fillText(`HP:${template.hp||100} AP:${template.ap||4}`, 70, 175);
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
    const w = size * 2; const h = size * Math.sqrt(3);
    g.fillStyle(0xffffff); g.beginPath();
    for (let i = 0; i < 6; i++) { const angle_deg = 60 * i; const angle_rad = Math.PI / 180 * angle_deg; const px = w/2 + size * Math.cos(angle_rad); const py = h/2 + size * Math.sin(angle_rad); if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); }
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

    init(canvasElement) {
        const config = { type: Phaser.AUTO, parent: 'game-view', width: document.getElementById('game-view').clientWidth, height: document.getElementById('game-view').clientHeight, backgroundColor: '#0b0e0a', pixelArt: false, scene: [MainScene, UIScene], fps: { target: 60 }, physics: { default: 'arcade', arcade: { debug: false } }, input: { activePointers: 1 } };
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
            if (main && main.updateSidebarViewport) main.updateSidebarViewport();
            if (window.phaserSidebar && window.phaserSidebar.onResize) window.phaserSidebar.onResize(w, h);
            if (window.gameLogic && window.gameLogic.updateSidebar) window.gameLogic.updateSidebar();
        };
        window.addEventListener('resize', () => this.resize());
        const startAudio = () => { if(window.Sfx && window.Sfx.ctx && window.Sfx.ctx.state === 'suspended') { window.Sfx.ctx.resume(); } };
        document.addEventListener('click', startAudio); document.addEventListener('keydown', startAudio);
    },
    resize() { if(this.game) this.game.scale.resize(document.getElementById('game-view').clientWidth, document.getElementById('game-view').clientHeight); },
    hexToPx(q, r) { return { x: HEX_SIZE * 3/2 * q, y: HEX_SIZE * Math.sqrt(3) * (r + q/2) }; },
    pxToHex(mx, my) { const main = phaserGame.scene.getScene('MainScene'); if(!main) return {q:0, r:0}; const w = main.cameras.main.getWorldPoint(mx, my); return this.roundHex((2/3*w.x)/HEX_SIZE, (-1/3*w.x+Math.sqrt(3)/3*w.y)/HEX_SIZE); },
    roundHex(q,r) { let rq=Math.round(q), rr=Math.round(r), rs=Math.round(-q-r); const dq=Math.abs(rq-q), dr=Math.abs(rr-r), ds=Math.abs(rs-(-q-r)); if(dq>dr&&dq>ds) rq=-rr-rs; else if(dr>ds) rr=-rq-rs; return {q:rq, r:rr}; },
    centerOn(q, r) { const main = this.game.scene.getScene('MainScene'); if (main && main.centerCamera) main.centerCamera(q, r); },
    centerMap() { const main = this.game.scene.getScene('MainScene'); if (main && main.centerMap) main.centerMap(); },
    dealCards(types) { let ui = this.game.scene.getScene('UIScene'); if(!ui || !ui.sys) ui = this.game.scene.scenes.find(s => s.scene.key === 'UIScene'); if(ui) ui.dealStart(types); },
    dealCard(typeOrData) { const ui = this.game.scene.getScene('UIScene'); if(ui) ui.addCardToHand(typeOrData); },
    getFusedCardsFromHand() {
        const ui = this.game ? this.game.scene.getScene('UIScene') : null;
        if (!ui || !ui.cards) return [];
        return ui.cards.filter(c => c.fusionData).map(c => ({ type: c.cardType, fusionData: c.fusionData }));
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
    playExplosion(x, y) { const main = this.game.scene.getScene('MainScene'); if (main) main.triggerExplosion(x, y); },
    generateFaceIcon(seed) { const c = document.createElement('canvas'); c.width = 64; c.height = 64; const ctx = c.getContext('2d'); const rnd = function() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }; ctx.fillStyle = "#334"; ctx.fillRect(0,0,64,64); const skinTones = ["#ffdbac", "#f1c27d", "#e0ac69", "#8d5524"]; ctx.fillStyle = skinTones[Math.floor(rnd() * skinTones.length)]; ctx.beginPath(); ctx.arc(32, 36, 18, 0, Math.PI*2); ctx.fill(); ctx.fillStyle = "#343"; ctx.beginPath(); ctx.arc(32, 28, 20, Math.PI, 0); ctx.lineTo(54, 30); ctx.lineTo(10, 30); ctx.fill(); ctx.strokeStyle = "#121"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(10,28); ctx.lineTo(54,28); ctx.stroke(); ctx.fillStyle = "#000"; const eyeY = 36; const eyeOff = 6 + rnd()*2; ctx.fillRect(32-eyeOff-2, eyeY, 4, 2); ctx.fillRect(32+eyeOff-2, eyeY, 4, 2); ctx.strokeStyle = "#a76"; ctx.lineWidth = 1; ctx.beginPath(); const mouthW = 4 + rnd()*6; ctx.moveTo(32-mouthW/2, 48); ctx.lineTo(32+mouthW/2, 48); ctx.stroke(); if (rnd() < 0.5) { ctx.fillStyle = "rgba(0,0,0,0.2)"; ctx.fillRect(20 + rnd()*20, 30 + rnd()*20, 4, 2); } return c.toDataURL(); }
};

class Card extends Phaser.GameObjects.Container {
    constructor(scene, x, y, typeOrData) {
        super(scene, x, y);
        const isObj = typeof typeOrData === 'object' && typeOrData !== null;
        this.cardType = isObj ? typeOrData.type : typeOrData;
        this.fusionData = isObj && typeOrData.fusionData ? typeOrData.fusionData : null;
        this.scene = scene; this.setSize(140, 200);
        const texKey = window.getCardTextureKey(scene, this.cardType);
        this.frameImage = scene.add.image(0, 0, texKey).setDisplaySize(140, 200);
        this.frameImage.setInteractive({ useHandCursor: true, draggable: true });
        const shadow = scene.add.rectangle(6, 6, 130, 190, 0x000000, 0.5); this.add(shadow); this.add(this.frameImage);
        this.rainbowGraphics = scene.add.graphics().setDepth(1);
        this.fusionCandidateGraphics = scene.add.graphics().setDepth(2);
        this.add(this.rainbowGraphics); this.add(this.fusionCandidateGraphics);
        this.setScrollFactor(0); this.baseX = x; this.baseY = y; this.physX = x; this.physY = y; this.velocityX = 0; this.velocityY = 0; this.velocityAngle = 0; this.targetX = x; this.targetY = y; this.dragOffsetX = 0; this.dragOffsetY = 0;
        this.frameImage.on('pointerover', this.onHover, this); this.frameImage.on('pointerout', this.onHoverOut, this); this.frameImage.on('dragstart', this.onDragStart, this); this.frameImage.on('drag', this.onDrag, this); this.frameImage.on('dragend', this.onDragEnd, this);
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
            if (this.fusionData) {
            this.rainbowGraphics.clear();
            const t = (this.scene.time || { now: 0 }).now * 0.001;
            const w = 70; const h = 100; const pad = 2; const segs = 96;
            const colors = [0xff0000, 0xff4400, 0xff8800, 0xffcc00, 0xffff00, 0xaaff00, 0x00ff00, 0x00ff88, 0x0088ff, 0x4400ff, 0x8800ff];
            for (let i = 0; i < segs; i++) {
                const u = (i / segs + t * 0.15) % 1;
                const ci = Math.floor(u * colors.length) % colors.length;
                const c0 = colors[ci]; const c1 = colors[(ci + 1) % colors.length];
                const mix = (u * colors.length) % 1;
                const r = ((c0 >> 16) & 0xff) * (1 - mix) + ((c1 >> 16) & 0xff) * mix;
                const g = ((c0 >> 8) & 0xff) * (1 - mix) + ((c1 >> 8) & 0xff) * mix;
                const b = (c0 & 0xff) * (1 - mix) + (c1 & 0xff) * mix;
                const blended = (r << 16) | (g << 8) | b;
                this.rainbowGraphics.lineStyle(2, blended, 0.88);
                const frac = i / segs; const nextFrac = (i + 1) / segs;
                const rad = (f) => { let u2 = f * 4; if (u2 >= 4) u2 = 3.9999; const side = Math.floor(u2) % 4; const v = u2 - Math.floor(u2); let x, y; if (side === 0) { x = -w - pad + v * 2 * (w + pad); y = -h - pad; } else if (side === 1) { x = w + pad; y = -h - pad + v * 2 * (h + pad); } else if (side === 2) { x = w + pad - v * 2 * (w + pad); y = h + pad; } else { x = -w - pad; y = h + pad - v * 2 * (h + pad); } return { x, y }; };
                const p1 = rad(frac); const p2 = rad(nextFrac);
                this.rainbowGraphics.beginPath(); this.rainbowGraphics.moveTo(p1.x, p1.y); this.rainbowGraphics.lineTo(p2.x, p2.y); this.rainbowGraphics.strokePath();
            }
            } else { this.rainbowGraphics.clear(); }
        }
        if (this.isDragging) { this.setAlpha(0.6); } else {
            const isWeapon = typeof WPNS !== 'undefined' && WPNS[this.cardType];
            const isDisabled = !isWeapon && (window.gameLogic && window.gameLogic.cardsUsed >= 2);
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
        const isWeapon = typeof WPNS !== 'undefined' && WPNS[this.cardType];
        if (!isWeapon && window.gameLogic && window.gameLogic.cardsUsed >= 2) return; 
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
        const isWeaponry = typeof WPNS !== 'undefined' && WPNS[this.cardType] && WPNS[this.cardType].attr === (typeof ATTR !== 'undefined' ? ATTR.WEAPON : 'Weaponry');
        if (!isWeaponry && this.targetY < dropZoneY && !overRightPanel) main.dragHighlightHex = Renderer.pxToHex(pointer.x, pointer.y);
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
        const dropZoneY = this.scene.scale.height * 0.88;
        const sw = this.scene.scale.width;
        const overRightPanel = pointer.x >= sw - (window.getSidebarWidth ? window.getSidebarWidth() : 340);
        const isWeaponry = typeof WPNS !== 'undefined' && WPNS[this.cardType] && WPNS[this.cardType].attr === (typeof ATTR !== 'undefined' ? ATTR.WEAPON : 'Weaponry');
        const cx = pointer.x + this.dragOffsetX; const cy = pointer.y + this.dragOffsetY;
        const targetCard = this.findOverlappingSameTypeCardAt(cx, cy);
        if (overRightPanel) {
            if (!isWeaponry) { this.returnToHand(); return; }
            const sidebar = window.phaserSidebar;
            if (sidebar && sidebar.hitTestSlots(pointer.x, pointer.y) && window.gameLogic && window.gameLogic.equipWeaponFromDeck) {
                window.gameLogic.equipWeaponFromDeck(this.cardType, sidebar.hitTestSlots(pointer.x, pointer.y));
                this.scene.removeCard(this); this.destroy(); return;
            }
            this.returnToHand(); return;
        }
        if (targetCard && FUSABLE_UNIT_TYPES.includes(this.cardType)) {
            this.scene.fuseCards(this, targetCard);
            return;
        }
        if (isWeaponry) { this.returnToHand(); return; }
        if (cy >= dropZoneY) { this.returnToHand(); return; }
        const hex = Renderer.pxToHex(pointer.x, pointer.y); 
        let canDeploy = false; 
        if (window.gameLogic && window.gameLogic.checkDeploy) { 
            if (this.cardType === 'aerial') {
                if (window.gameLogic.isValidHex(hex.q, hex.r)) canDeploy = true; 
                else if(window.gameLogic.log) window.gameLogic.log("配置不可: マップ範囲外です"); 
            } else { canDeploy = window.gameLogic.checkDeploy(hex); } 
        } 
        if (canDeploy) this.burnAndConsume(hex); else this.returnToHand(); 
    }
    burnAndConsume(hex) { 
        const type = this.cardType; const fusionData = this.fusionData;
        this.updatePhysics = () => {}; this.frameImage.setTint(0x552222); this.frameImage.disableInteractive(); 
        this.scene.tweens.add({ targets: this, alpha: 0, scale: 0.5, duration: 200, onComplete: () => { 
            this.scene.removeCard(this); this.destroy(); 
            try { 
                if (type === 'aerial') { if (window.gameLogic) window.gameLogic.triggerBombardment(hex); } 
                else if(window.gameLogic) { window.gameLogic.deployUnit(hex, type, fusionData); } 
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
            this.sidebar.updateDropHighlight(ptr.x, ptr.y);
            if (this.sidebar.dragGhost) this.sidebar.updateDragGhost(time, delta);
        }
        this.uiVfxGraphics.clear();
        const cardDragging = typeof Renderer !== 'undefined' && Renderer.isCardDragging;
        const slotDragging = this.sidebar && this.sidebar.dragGhost;
        const draggedType = (typeof Renderer !== 'undefined' && Renderer.draggedCardType) || null;
        const isWeaponryDrag = slotDragging || (cardDragging && typeof WPNS !== 'undefined' && draggedType && WPNS[draggedType] && WPNS[draggedType].attr === (typeof ATTR !== 'undefined' ? ATTR.WEAPON : 'Weaponry'));
        const deployableAttrs = typeof ATTR !== 'undefined' ? [ATTR.MILITARY, ATTR.SUPPORT, ATTR.RECOVERY] : [];
        const isMapCardDrag = cardDragging && !isWeaponryDrag && (draggedType === 'aerial' || (typeof UNIT_TEMPLATES !== 'undefined' && UNIT_TEMPLATES[draggedType] && deployableAttrs.indexOf(UNIT_TEMPLATES[draggedType].attr) >= 0));
        if (isWeaponryDrag) this.drawDropZoneGlow(time, true);
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
        const k = typeof cycleMult === 'number' ? cycleMult : 1;
        const phase = typeof phaseOffset === 'number' ? phaseOffset : 0;
        const wave = (i, s) => Math.sin((i / segments) * 4 * k * Math.PI + t * 2 + s + phase) * 6 + Math.sin((i / segments) * 2 * k * Math.PI + t * 1.2 + s * 0.7 + phase) * 4;
        for (let layer = 0; layer < 5; layer++) {
            const phase = layer * 0.4 + t * 0.5;
            const col = colors[layer % colors.length];
            const a = 0.12 * (0.6 + 0.4 * Math.sin(t * 2 + layer));
            g.lineStyle(3 + Math.sin(t + layer) * 1.5, col, Math.max(0.03, a));
            g.beginPath();
            for (let i = 0; i <= segments; i++) {
                const u = i / segments;
                const x = x1 + (x2 - x1) * u + (isVertical ? wave(i, phase) : 0);
                const y = y1 + (y2 - y1) * u + (isVertical ? 0 : wave(i, phase));
                if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
            }
            g.strokePath();
        }
        for (let o = -haloSpread; o <= haloSpread; o += 4) {
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
    addCardToHand(typeOrData) { const card = new Card(this, 0, 0, typeOrData); this.handContainer.add(card); this.cards.push(card); card.physX = 600; card.physY = 300; card.setPosition(card.physX, card.physY); this.arrangeHand(); }
    fuseCards(dragged, target) {
        const type = dragged.cardType;
        const fusionData = generateFusionData();
        this.removeCard(dragged); dragged.destroy();
        this.removeCard(target); target.destroy();
        const card = new Card(this, 0, 0, { type, fusionData });
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
    constructor() { super({ key: 'MainScene' }); this.hexGroup=null; this.decorGroup=null; this.unitGroup=null; this.treeGroup=null; this.hpGroup=null; this.vfxGraphics=null; this.overlayGraphics=null; this.mapGenerated=false; this.dragHighlightHex=null; this.crosshairGroup=null; this.unitView = null; }
    preload() { 
        if(window.EnvSystem) window.EnvSystem.preload(this);
        if (window.Sfx && window.Sfx.preload) { window.Sfx.preload(this); }
        this.load.spritesheet('us_soldier', 'asset/us-soldier-back-sheet.png', { frameWidth: 128, frameHeight: 128 });
        this.load.spritesheet('soldier_sheet', 'asset/soldier_sheet_1.png', { frameWidth: 128, frameHeight: 128 });
        this.load.spritesheet('tank_sheet', 'asset/tank_sheet_1.png', { frameWidth: 128, frameHeight: 128 });
        this.load.spritesheet('explosion_sheet', 'asset/explosion_sheet_1.png', { frameWidth: 64, frameHeight: 64 });
    }
    create() {
        window.createHexTexture(this); this.cameras.main.setBackgroundColor('#0b0e0a'); 
        this.updateSidebarViewport();
        this.scale.on('resize', () => this.updateSidebarViewport());
        this.hexGroup = this.add.layer(); this.hexGroup.setDepth(0);
        this.decorGroup = this.add.layer(); this.decorGroup.setDepth(0.5);
        this.unitGroup = this.add.layer(); this.unitGroup.setDepth(1);
        this.rubbleFrontGroup = this.add.layer(); this.rubbleFrontGroup.setDepth(1.5);
        this.treeGroup = this.add.layer(); this.treeGroup.setDepth(2);
        this.hpGroup = this.add.layer(); this.hpGroup.setDepth(10);
        this.crosshairGroup = this.add.graphics().setDepth(200);
        this.hitChanceText = this.add.text(0, 0, '', { fontSize: '14px', fontFamily: 'sans-serif', color: '#e8e8f0' }).setScrollFactor(0).setDepth(300).setVisible(false);
        this.vfxGraphics = this.add.graphics().setDepth(100); 
        this.overlayGraphics = this.add.graphics().setDepth(50); 
        if(window.EnvSystem) window.EnvSystem.clear();
        this.scene.launch('UIScene'); 
        this.unitView = new UnitView(this, this.unitGroup, this.hpGroup);
        this.input.on('wheel', (pointer, gameObjects, deltaX, deltaY, deltaZ) => { let newZoom = this.cameras.main.zoom; if (deltaY > 0) newZoom -= 0.5; else if (deltaY < 0) newZoom += 0.5; newZoom = Phaser.Math.Clamp(newZoom, 0.25, 4.0); this.tweens.add({ targets: this.cameras.main, zoom: newZoom, duration: 150, ease: 'Cubic.out' }); });
        
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
        this.input.on('pointerdown', (p) => { 
            if (Renderer.isCardDragging || Renderer.checkUIHover(p.x, p.y, p.event)) return; 
            if (Renderer.suppressMapClick) { Renderer.suppressMapClick = false; return; }
            const hex = Renderer.pxToHex(p.x, p.y);
            if(p.button === 0) { 
                Renderer.isMapDragging = true; 
                if(window.gameLogic && window.gameLogic.handleClick) window.gameLogic.handleClick(hex, p.x, p.y); 
            } else if(p.button === 2) { 
                if(window.gameLogic && window.gameLogic.handleRightClick) window.gameLogic.handleRightClick(p.x, p.y, hex); 
            } 
        });
        
        this.input.on('pointerup', () => { Renderer.isMapDragging = false; });
        this.input.on('pointermove', (p) => { 
            if (Renderer.isCardDragging) return; 
            if (p.isDown && Renderer.isMapDragging) { const zoom = this.cameras.main.zoom; this.cameras.main.scrollX -= (p.x - p.prevPosition.x) / zoom; this.cameras.main.scrollY -= (p.y - p.prevPosition.y) / zoom; } 
            if(!Renderer.isMapDragging && window.gameLogic && window.gameLogic.handleHover) window.gameLogic.handleHover(Renderer.pxToHex(p.x, p.y)); 
        }); 
        this.input.mouse.disableContextMenu();
        this.input.keyboard.on('keydown-ESC', () => { if(window.gameLogic && window.gameLogic.clearSelection) { window.gameLogic.clearSelection(); } });
    }
    updateSidebarViewport() {
        const app = document.getElementById('app');
        if (app && app.classList.contains('phaser-sidebar')) {
            const w = this.scale.width; const h = this.scale.height;
            const sidebarW = window.getSidebarWidth ? window.getSidebarWidth() : 340;
            this.cameras.main.setViewport(0, 0, Math.max(1, w - sidebarW), h);
        } else {
            this.cameras.main.setViewport(0, 0, this.scale.width, this.scale.height);
        }
    }
    triggerExplosion(x, y) { const explosion = this.add.sprite(x, y, 'explosion_sheet'); explosion.setDepth(100); explosion.setScale(1.5); explosion.play('explosion_anim'); explosion.once('animationcomplete', () => { explosion.destroy(); }); }
    centerCamera(q, r) { const p = Renderer.hexToPx(q, r); this.cameras.main.centerOn(p.x, p.y); }
    centerMap() { this.cameras.main.centerOn((MAP_W * HEX_SIZE * 1.5) / 2, (MAP_H * HEX_SIZE * 1.732) / 2); }
    createMap() { 
        if(!window.gameLogic || !window.gameLogic.map) return;
        const map = window.gameLogic.map; this.hexGroup.removeAll(true); this.decorGroup.removeAll(true); this.unitGroup.removeAll(true); if(this.rubbleFrontGroup) this.rubbleFrontGroup.removeAll(true); this.treeGroup.removeAll(true); this.hpGroup.removeAll(true); 
        if(this.unitView) this.unitView.clear();
        for(let q=0; q<MAP_W; q++) { 
            for(let r=0; r<MAP_H; r++) { 
                const t = map[q][r]; if(t.id===-1)continue; const pos = Renderer.hexToPx(q, r); 
                const hex = this.add.image(pos.x, pos.y, 'hex_base').setScale(1/window.HIGH_RES_SCALE); 
                let tint = 0x555555; if(t.id===0) tint=0x5a5245; else if(t.id===1) tint=0x335522; else if(t.id===2) tint=0x112211; else if(t.id===4) tint=0x504540; else if(t.id===5) { tint=0x303840; if(window.EnvSystem) window.EnvSystem.registerWater(hex, pos.y, q, r, this.decorGroup); }
                if(window.EnvSystem) { if(t.id === 1) window.EnvSystem.spawnGrass(this, this.decorGroup, pos.x, pos.y); if(t.id === 2) window.EnvSystem.spawnTrees(this, this.treeGroup, pos.x, pos.y); if(t.id === 4) window.EnvSystem.spawnRubble(this, pos.x, pos.y, this.decorGroup, this.rubbleFrontGroup); }
                hex.setTint(tint); this.hexGroup.add(hex); 
            } 
        } 
        this.centerMap(); 
    }
    update(time, delta) {
        // ★修正: gameLogicが準備できていない、またはマップデータが無い場合は何もしない
        if (!window.gameLogic || !window.gameLogic.map) return;
        
        if(window.VFX && window.VFX.shakeRequest > 0) { this.cameras.main.shake(100, window.VFX.shakeRequest * 0.001); window.VFX.shakeRequest = 0; }
        if(window.EnvSystem) window.EnvSystem.update(time);
        if(window.VFX) { window.VFX.update(); this.vfxGraphics.clear(); window.VFX.draw(this.vfxGraphics); }
        
        if (window.gameLogic.map.length > 0 && !this.mapGenerated) { this.createMap(); this.mapGenerated = true; }
        if(this.unitView) this.unitView.update(time, delta);
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
                    isValid = window.gameLogic.isValidHex(h.q, h.r) && window.gameLogic.map[h.q][h.r].id !== -1 && window.gameLogic.getUnitsInHex(h.q, h.r).length < 4;
                }
                const color = isValid ? 0x00ffff : 0xff0000;
                this.overlayGraphics.lineStyle(3, color, 0.8);
                this.drawHexOutline(this.overlayGraphics, h.q, h.r);
                if(isValid) { this.overlayGraphics.fillStyle(color, 0.2); this.overlayGraphics.fillPath(); }
            }
        }
        
        const selected = window.gameLogic.selectedUnit;
        if(selected) {
            if(window.gameLogic.reachableHexes && window.gameLogic.reachableHexes.length > 0) { 
                this.overlayGraphics.lineStyle(1, 0xffffff, 0.3); 
                window.gameLogic.reachableHexes.forEach(h => this.drawHexOutline(this.overlayGraphics, h.q, h.r)); 
            }
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
        const path = window.gameLogic.path;
        if(path && path.length > 0 && selected) { 
            this.overlayGraphics.lineStyle(3, 0xffffff, 0.5); this.overlayGraphics.beginPath(); const s = Renderer.hexToPx(selected.q, selected.r); this.overlayGraphics.moveTo(s.x, s.y); path.forEach(p => { const px = Renderer.hexToPx(p.q, p.r); this.overlayGraphics.lineTo(px.x, px.y); }); this.overlayGraphics.strokePath(); 
        }
        this.crosshairGroup.clear();
        if (window.gameLogic.aimTargetUnit) { const u = window.gameLogic.aimTargetUnit; const pos = Renderer.hexToPx(u.q, u.r); this.drawCrosshair(this.crosshairGroup, pos.x, pos.y, time); }
        const canvas = this.game && this.game.canvas;
        if (canvas) {
            if (overAimTarget) {
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
    drawHexOutline(g, q, r) { const c = Renderer.hexToPx(q, r); g.beginPath(); for(let i=0; i<6; i++) { const a = Math.PI/180*60*i; g.lineTo(c.x+HEX_SIZE*0.9*Math.cos(a), c.y+HEX_SIZE*0.9*Math.sin(a)); } g.closePath(); g.strokePath(); }
    drawDashedHexOutline(g, q, r, timeOffset = 0) {
        const c = Renderer.hexToPx(q, r); const pts = []; for(let i=0; i<6; i++) { const a = Math.PI/180*60*i; pts.push({ x: c.x+HEX_SIZE*0.9*Math.cos(a), y: c.y+HEX_SIZE*0.9*Math.sin(a) }); }
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

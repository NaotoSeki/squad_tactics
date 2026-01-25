/** PHASER BRIDGE: Visual Restoration (No Gaps, Full Nature) */
let phaserGame = null;
window.HIGH_RES_SCALE = 2.0; 

// ■カードアイコン生成
window.getCardTextureKey = function(scene, type) {
    const key = `card_icon_${type}`;
    if (scene.textures.exists(key)) return key;
    const g = scene.make.graphics({x: 0, y: 0, add: false});
    g.fillStyle(0x1a1a1a); g.fillRect(0, 0, 100, 100);
    g.lineStyle(4, 0xdd8844);
    if (type.includes('tank')) {
        g.fillStyle(0xdd8844); g.fillRect(20, 40, 60, 30);
        g.fillCircle(50, 40, 15);
        g.lineStyle(6, 0xdd8844); g.beginPath(); g.moveTo(65, 35); g.lineTo(95, 30); g.strokePath();
    } else if (type === 'heal') {
        g.fillStyle(0x44ff88); g.fillRect(40, 20, 20, 60); g.fillRect(20, 40, 60, 20);
    } else {
        g.fillStyle(0xdd8844); g.fillCircle(50, 30, 15);
        g.lineStyle(4, 0xdd8844);
        g.beginPath(); g.moveTo(50, 45); g.lineTo(50, 80); g.strokePath();
        g.beginPath(); g.moveTo(20, 55); g.lineTo(80, 55); g.strokePath();
        g.beginPath(); g.moveTo(50, 80); g.lineTo(30, 95); g.strokePath();
        g.beginPath(); g.moveTo(50, 80); g.lineTo(70, 95); g.strokePath();
    }
    g.generateTexture(key, 100, 100);
    return key;
};

// ■UI背景
window.createGradientTexture = function(scene) {
    const key = 'ui_gradient';
    if (scene.textures.exists(key)) return;
    const canvas = document.createElement('canvas');
    canvas.width = 100; canvas.height = 100;
    const ctx = canvas.getContext('2d');
    const grd = ctx.createLinearGradient(0, 0, 0, 100);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.9)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 100, 100);
    scene.textures.addCanvas(key, canvas);
};

// ■★重要修正: ヘックス画像生成 (隙間対策 & マットな質感)
window.createHexTexture = function(scene) {
    if (scene.textures.exists('hex_base')) return;
    const g = scene.make.graphics({x: 0, y: 0, add: false});
    
    // data.js の HEX_SIZE (54) を基準に、高解像度化(x2) し、さらに隙間埋め用に(x1.05)する
    const baseSize = (typeof HEX_SIZE !== 'undefined' ? HEX_SIZE : 54); 
    const size = baseSize * window.HIGH_RES_SCALE * 1.05; 
    
    const w = size * Math.sqrt(3);
    const h = size * 2;
    
    // 純白で塗りつぶし (Tintが綺麗に乗るように)
    g.fillStyle(0xffffff);
    g.beginPath();
    for (let i = 0; i < 6; i++) {
        const angle_deg = 60 * i - 30;
        const angle_rad = Math.PI / 180 * angle_deg;
        const px = w/2 + size * Math.cos(angle_rad); // 半径いっぱいまで使う
        const py = h/2 + size * Math.sin(angle_rad);
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
    g.fillPath();
    
    // 枠線は描かない（地形のつながりを重視）
    
    g.generateTexture('hex_base', w, h);
};

const Renderer = {
    game: null, 
    isMapDragging: false, 
    isCardDragging: false,

    init(canvasElement) {
        const config = { 
            type: Phaser.AUTO, 
            parent: 'game-view', 
            width: document.getElementById('game-view').clientWidth, 
            height: document.getElementById('game-view').clientHeight, 
            backgroundColor: '#0b0e0a', 
            pixelArt: false, 
            scene: [MainScene, UIScene], 
            fps: { target: 60 }, 
            physics: { default: 'arcade', arcade: { debug: false } }, 
            input: { activePointers: 1 } 
        };
        this.game = new Phaser.Game(config);
        phaserGame = this.game;
        window.addEventListener('resize', () => this.resize());
        const startAudio = () => { if(window.Sfx && window.Sfx.ctx && window.Sfx.ctx.state === 'suspended') { window.Sfx.ctx.resume(); } };
        document.addEventListener('click', startAudio);
        document.addEventListener('keydown', startAudio);
    },
    resize() { if(this.game) this.game.scale.resize(document.getElementById('game-view').clientWidth, document.getElementById('game-view').clientHeight); },
    hexToPx(q, r) { return { x: HEX_SIZE * 3/2 * q, y: HEX_SIZE * Math.sqrt(3) * (r + q/2) }; },
    pxToHex(mx, my) { 
        const main = phaserGame.scene.getScene('MainScene'); if(!main) return {q:0, r:0}; 
        const w = main.cameras.main.getWorldPoint(mx, my); 
        return this.roundHex((2/3*w.x)/HEX_SIZE, (-1/3*w.x+Math.sqrt(3)/3*w.y)/HEX_SIZE); 
    },
    roundHex(q,r) { 
        let rq=Math.round(q), rr=Math.round(r), rs=Math.round(-q-r); 
        const dq=Math.abs(rq-q), dr=Math.abs(rr-r), ds=Math.abs(rs-(-q-r)); 
        if(dq>dr&&dq>ds) rq=-rr-rs; else if(dr>ds) rr=-rq-rs; 
        return {q:rq, r:rr}; 
    },
    centerOn(q, r) { const main = this.game.scene.getScene('MainScene'); if (main && main.centerCamera) main.centerCamera(q, r); },
    dealCards(types) { let ui = this.game.scene.getScene('UIScene'); if(!ui || !ui.sys) ui = this.game.scene.scenes.find(s => s.scene.key === 'UIScene'); if(ui) ui.dealStart(types); },
    dealCard(type) { const ui = this.game.scene.getScene('UIScene'); if(ui) ui.addCardToHand(type); },
    checkUIHover(x, y) { 
        if (this.isCardDragging) return true; 
        const ui = this.game.scene.getScene('UIScene'); if (!ui) return false; 
        for (let card of ui.cards) { const dx = Math.abs(x - card.x); const dy = Math.abs(y - card.y); if (dx < 70 && dy < 100) return true; } 
        return false; 
    },
    playAttackAnim(attacker, target) {
        const main = this.game.scene.getScene('MainScene');
        if (main && main.unitView) main.unitView.triggerAttack(attacker, target);
    },
    playExplosion(x, y) {
        const main = this.game.scene.getScene('MainScene');
        if (main) main.triggerExplosion(x, y);
    },
    generateFaceIcon(seed) {
        const c = document.createElement('canvas'); c.width = 64; c.height = 64; const ctx = c.getContext('2d');
        const rnd = function() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
        ctx.fillStyle = "#334"; ctx.fillRect(0,0,64,64);
        const skinTones = ["#ffdbac", "#f1c27d", "#e0ac69", "#8d5524"]; ctx.fillStyle = skinTones[Math.floor(rnd() * skinTones.length)];
        ctx.beginPath(); ctx.arc(32, 36, 18, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = "#343"; ctx.beginPath(); ctx.arc(32, 28, 20, Math.PI, 0); ctx.lineTo(54, 30); ctx.lineTo(10, 30); ctx.fill();
        ctx.strokeStyle = "#121"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(10,28); ctx.lineTo(54,28); ctx.stroke();
        ctx.fillStyle = "#000"; const eyeY = 36; const eyeOff = 6 + rnd()*2; ctx.fillRect(32-eyeOff-2, eyeY, 4, 2); ctx.fillRect(32+eyeOff-2, eyeY, 4, 2);
        ctx.strokeStyle = "#a76"; ctx.lineWidth = 1; ctx.beginPath(); const mouthW = 4 + rnd()*6; ctx.moveTo(32-mouthW/2, 48); ctx.lineTo(32+mouthW/2, 48); ctx.stroke();
        if (rnd() < 0.5) { ctx.fillStyle = "rgba(0,0,0,0.2)"; ctx.fillRect(20 + rnd()*20, 30 + rnd()*20, 4, 2); }
        return c.toDataURL();
    }
};

class Card extends Phaser.GameObjects.Container {
    constructor(scene, x, y, type) {
        super(scene, x, y); this.scene = scene; this.cardType = type; this.setSize(140, 200);
        this.visuals = scene.add.container(0, 0);
        const shadow = scene.add.rectangle(6, 6, 130, 190, 0x000000, 0.6);
        const contentBg = scene.add.rectangle(0, 0, 130, 190, 0x1a1a1a);
        let frame;
        if(scene.textures.exists('card_frame')) { frame = scene.add.image(0, 0, 'card_frame').setDisplaySize(140, 200); } 
        else { frame = scene.add.rectangle(0,0,140,200,0x333).setStrokeStyle(2,0x888); }
        frame.setInteractive({ useHandCursor: true, draggable: true }); this.frameImage = frame;
        const iconKey = window.getCardTextureKey(scene, type);
        const icon = scene.add.image(0, 10, iconKey).setScale(1/window.HIGH_RES_SCALE);
        if(type === 'aerial') icon.setDisplaySize(120, 80);
        const text = scene.add.text(0, -80, type.toUpperCase(), { fontSize: '16px', color: '#d84', fontStyle: 'bold' }).setOrigin(0.5);
        const desc = scene.add.text(0, 70, "DRAG TO DEPLOY", { fontSize: '10px', color: '#888' }).setOrigin(0.5);
        this.visuals.add([shadow, contentBg, icon, text, desc, frame]); this.add(this.visuals); 
        this.setScrollFactor(0); this.baseX = x; this.baseY = y; this.physX = x; this.physY = y; this.velocityX = 0; this.velocityY = 0; this.velocityAngle = 0; this.targetX = x; this.targetY = y; this.dragOffsetX = 0; this.dragOffsetY = 0;
        frame.on('pointerover', this.onHover, this); frame.on('pointerout', this.onHoverOut, this); frame.on('dragstart', this.onDragStart, this); frame.on('drag', this.onDrag, this); frame.on('dragend', this.onDragEnd, this);
        scene.add.existing(this);
    }
    updatePhysics() { 
        if (!this.scene || !this.frameImage) return; 
        const isDisabled = (window.gameLogic && window.gameLogic.cardsUsed >= 2);
        if (isDisabled) { this.frameImage.setTint(0x555555); this.setAlpha(0.6); } else { this.frameImage.clearTint(); this.setAlpha(1.0); }
        if (!this.isDragging && !this.scene.isReturning) { 
            this.targetX = this.baseX; 
            if (this.scene.isHandDocked) { this.targetY = this.isHovering ? -120 : 60; } else { this.targetY = this.baseY - (this.isHovering ? 30 : 0); }
        } 
        const stiffness = this.isDragging ? 0.2 : 0.08; const damping = 0.65; 
        const ax = (this.targetX - this.physX) * stiffness; const ay = (this.targetY - this.physY) * stiffness; 
        this.velocityX += ax; this.velocityY += ay; this.velocityX *= damping; this.velocityY *= damping; 
        this.physX += this.velocityX; this.physY += this.velocityY; this.setPosition(this.physX, this.physY); 
        let staticAngle = 0; if (this.isDragging) staticAngle = -this.dragOffsetX * 0.4; 
        const targetDynamicAngle = -this.velocityX * 1.5; const totalTargetAngle = staticAngle + targetDynamicAngle; 
        const angleForce = (totalTargetAngle - this.angle) * 0.12; this.velocityAngle += angleForce; this.velocityAngle *= 0.85; 
        this.angle += this.velocityAngle; this.angle = Phaser.Math.Clamp(this.angle, -50, 50); 
    }
    onHover() { if(Renderer.isMapDragging || Renderer.isCardDragging) return; this.isHovering = true; this.parentContainer.bringToTop(this); }
    onHoverOut() { this.isHovering = false; }
    onDragStart(pointer) { 
        if(Renderer.isMapDragging) return; 
        if(window.gameLogic && window.gameLogic.cardsUsed >= 2) return;
        this.isDragging = true; Renderer.isCardDragging = true; this.setAlpha(0.9); this.setScale(1.1); const hand = this.parentContainer; const worldPos = hand.getLocalTransformMatrix().transformPoint(this.x, this.y); hand.remove(this); this.scene.add.existing(this); this.physX = worldPos.x; this.physY = worldPos.y; this.targetX = this.physX; this.targetY = this.physY; this.setDepth(9999); this.dragOffsetX = this.physX - pointer.x; this.dragOffsetY = this.physY - pointer.y; 
    }
    onDrag(pointer) { if(!this.isDragging) return; this.targetX = pointer.x + this.dragOffsetX; this.targetY = pointer.y + this.dragOffsetY; const main = this.scene.game.scene.getScene('MainScene'); if (this.y < this.scene.scale.height * 0.65) main.dragHighlightHex = Renderer.pxToHex(pointer.x, pointer.y); else main.dragHighlightHex = null; }
    onDragEnd(pointer) { 
        if(!this.isDragging) return;
        this.isDragging = false; Renderer.isCardDragging = false; this.setAlpha(1.0); this.setScale(1.0); const main = this.scene.game.scene.getScene('MainScene'); main.dragHighlightHex = null; const dropZoneY = this.scene.scale.height * 0.65; 
        if (this.y < dropZoneY) { const hex = Renderer.pxToHex(pointer.x, pointer.y); let canDeploy = false; if (window.gameLogic) { if (this.cardType === 'aerial') { if (window.gameLogic.isValidHex(hex.q, hex.r)) canDeploy = true; else window.gameLogic.log("配置不可: マップ範囲外です"); } else { canDeploy = window.gameLogic.checkDeploy(hex); } } if (canDeploy) this.burnAndConsume(hex); else this.returnToHand(); } else { this.returnToHand(); } 
    }
    burnAndConsume(hex) {
        this.updatePhysics = () => {}; this.frameImage.setTint(0x552222);
        const maskShape = this.scene.make.graphics(); maskShape.fillStyle(0xffffff); maskShape.fillRect(-70, -100, 140, 200); 
        this.visuals.setMask(maskShape.createGeometryMask());
        const burnProgress = { val: 0 }; 
        this.scene.tweens.add({ targets: burnProgress, val: 1, duration: 200, ease: 'Linear', onUpdate: () => { if(!this.scene || !maskShape.scene) return; maskShape.clear(); maskShape.fillStyle(0xffffff); maskShape.fillRect(-70, -100, 140, 200 * (1 - burnProgress.val)); maskShape.x = this.x; maskShape.y = this.y + (200 * burnProgress.val); const rad = Phaser.Math.DegToRad(this.angle); const cos = Math.cos(rad); const sin = Math.sin(rad); for(let i=0; i<8; i++) { const randX = (Math.random() - 0.5) * 140; const wx = this.x + (randX * cos - sin); const wy = this.y + (randX * sin + cos); if(window.UIVFX) { window.UIVFX.addFire(wx, wy); if(Math.random()<0.3) window.UIVFX.addSmoke(wx, wy); } } this.x += (Math.random()-0.5) * 4; this.y += (Math.random()-0.5) * 4; }, onComplete: () => { if (this.visuals) this.visuals.clearMask(true); if (maskShape) maskShape.destroy(); this.scene.removeCard(this); const type = this.cardType; this.destroy(); try { if (type === 'aerial') { const main = phaserGame.scene.getScene('MainScene'); if (main) main.triggerBombardment(hex); } else if(window.gameLogic) { window.gameLogic.deployUnit(hex, type); } } catch(e) { console.error("Logic Error:", e); } } });
    }
    returnToHand() { const hand = this.scene.handContainer; this.scene.children.remove(this); hand.add(this); this.setDepth(0); this.physX = this.x; this.physY = this.y; this.targetX = this.baseX; this.targetY = this.baseY; }
}

class UIScene extends Phaser.Scene {
    constructor() { super({ key: 'UIScene', active: false }); this.cards=[]; this.handContainer=null; this.gradientBg=null; this.uiVfxGraphics=null; this.isHandDocked = false; }
    create() {
        const w = this.scale.width; const h = this.scale.height;
        if(window.createGradientTexture) window.createGradientTexture(this);
        if (this.textures.exists('ui_gradient')) { this.gradientBg = this.add.image(w/2, h, 'ui_gradient').setOrigin(0.5, 1).setDepth(0).setDisplaySize(w, h*0.25); } 
        else { this.gradientBg = this.add.rectangle(w/2, h, w, h*0.25, 0x000000, 0.8).setOrigin(0.5, 1); }
        this.handContainer = this.add.container(w/2, h);
        this.uiVfxGraphics = this.add.graphics().setDepth(10000);
        this.scale.on('resize', this.onResize, this);
    }
    onResize(gameSize) { const w = gameSize.width; const h = gameSize.height; if (this.gradientBg) { this.gradientBg.setPosition(w / 2, h); this.gradientBg.setDisplaySize(w, h * 0.25); } if (this.handContainer) { this.handContainer.setPosition(w / 2, h); } }
    update() { this.cards.forEach(card => { if (card.active) card.updatePhysics(); }); if(window.UIVFX) { window.UIVFX.update(); this.uiVfxGraphics.clear(); window.UIVFX.draw(this.uiVfxGraphics); } }
    dealStart(types) { this.isHandDocked = false; types.forEach((type, i) => { this.time.delayedCall(i * 150, () => { this.addCardToHand(type); }); }); this.time.delayedCall(150 * types.length + 1000, () => { this.isHandDocked = true; }); }
    addCardToHand(type) { if (this.cards.length >= 5) return; const card = new Card(this, 0, 0, type); this.handContainer.add(card); this.cards.push(card); card.physX = 600; card.physY = 300; card.setPosition(card.physX, card.physY); this.arrangeHand(); }
    removeCard(cardToRemove) { this.cards = this.cards.filter(c => c !== cardToRemove); this.arrangeHand(); }
    arrangeHand() { const total = this.cards.length; const centerIdx = (total - 1) / 2; const spacing = 160; this.cards.forEach((card, i) => { const offset = i - centerIdx; card.baseX = offset * spacing; card.baseY = -120; }); }
}

// --- MAIN SCENE ---
class MainScene extends Phaser.Scene {
    constructor() { 
        super({ key: 'MainScene' }); 
        this.hexGroup=null; this.decorGroup=null; this.unitGroup=null; this.treeGroup=null; this.hpGroup=null;   
        this.vfxGraphics=null; this.overlayGraphics=null; 
        this.mapGenerated=false; this.dragHighlightHex=null;
        this.crosshairGroup=null;
        this.unitView = null;
    }
    
    preload() { 
        if(window.EnvSystem) window.EnvSystem.preload(this);
        this.load.spritesheet('us_soldier', 'asset/us-soldier-back-sheet.png', { frameWidth: 128, frameHeight: 128 });
        this.load.spritesheet('soldier_sheet', 'asset/soldier_sheet_1.png', { frameWidth: 128, frameHeight: 128 });
        this.load.spritesheet('tank_sheet', 'asset/tank_sheet_1.png', { frameWidth: 128, frameHeight: 128 });
        this.load.spritesheet('explosion_sheet', 'asset/explosion-sheet.png', { frameWidth: 128, frameHeight: 128 });
        this.load.image('card_frame', 'asset/card_frame.png');
    }

    create() {
        // ★重要: ここでテクスチャを生成
        window.createHexTexture(this);

        this.cameras.main.setBackgroundColor('#0b0e0a'); 
        
        this.hexGroup = this.add.layer(); this.hexGroup.setDepth(0);
        this.decorGroup = this.add.layer(); this.decorGroup.setDepth(0.5);
        this.unitGroup = this.add.layer(); this.unitGroup.setDepth(1);
        this.treeGroup = this.add.layer(); this.treeGroup.setDepth(2);
        this.hpGroup = this.add.layer(); this.hpGroup.setDepth(10);

        this.crosshairGroup = this.add.graphics().setDepth(200);
        this.vfxGraphics = this.add.graphics().setDepth(100); 
        this.overlayGraphics = this.add.graphics().setDepth(50); 
        
        if(window.EnvSystem) window.EnvSystem.clear();
        this.scene.launch('UIScene'); 

        this.unitView = new UnitView(this, this.unitGroup, this.hpGroup);

        this.input.on('wheel', (pointer, gameObjects, deltaX, deltaY, deltaZ) => { let newZoom = this.cameras.main.zoom; if (deltaY > 0) newZoom -= 0.5; else if (deltaY < 0) newZoom += 0.5; newZoom = Phaser.Math.Clamp(newZoom, 0.25, 4.0); this.tweens.add({ targets: this.cameras.main, zoom: newZoom, duration: 150, ease: 'Cubic.out' }); });
        this.input.on('pointerdown', (p) => { if (Renderer.isCardDragging || Renderer.checkUIHover(p.x, p.y)) return; if(p.button === 0) { Renderer.isMapDragging = true; if(window.gameLogic) window.gameLogic.handleClick(Renderer.pxToHex(p.x, p.y)); } else if(p.button === 2) { if(window.gameLogic) window.gameLogic.showContext(p.x, p.y); } });
        this.input.on('pointerup', () => { Renderer.isMapDragging = false; });
        this.input.on('pointermove', (p) => { if (Renderer.isCardDragging) return; if (p.isDown && Renderer.isMapDragging) { const zoom = this.cameras.main.zoom; this.cameras.main.scrollX -= (p.x - p.prevPosition.x) / zoom; this.cameras.main.scrollY -= (p.y - p.prevPosition.y) / zoom; } if(!Renderer.isMapDragging && window.gameLogic) window.gameLogic.handleHover(Renderer.pxToHex(p.x, p.y)); }); 
        this.input.mouse.disableContextMenu();
        this.input.keyboard.on('keydown-ESC', () => { if(window.gameLogic && window.gameLogic.clearSelection) { window.gameLogic.clearSelection(); } });
    }

    triggerExplosion(x, y) {
        const explosion = this.add.sprite(x, y, 'explosion_sheet');
        explosion.setDepth(100); explosion.setScale(1.5); 
        explosion.play('explosion_anim');
        explosion.once('animationcomplete', () => { explosion.destroy(); });
    }

    centerCamera(q, r) { const p = Renderer.hexToPx(q, r); this.cameras.main.centerOn(p.x, p.y); }
    centerMap() { this.cameras.main.centerOn((MAP_W * HEX_SIZE * 1.5) / 2, (MAP_H * HEX_SIZE * 1.732) / 2); }
    
    // ★復活: 地形IDに応じた着色ロジック & EnvSystem呼び出し
    createMap() { 
        const map = window.gameLogic.map; 
        this.hexGroup.removeAll(true); this.decorGroup.removeAll(true); this.unitGroup.removeAll(true); this.treeGroup.removeAll(true); this.hpGroup.removeAll(true);
        if(this.unitView) this.unitView.visuals.clear();

        for(let q=0; q<MAP_W; q++) { 
            for(let r=0; r<MAP_H; r++) { 
                const t = map[q][r]; if(t.id===-1)continue; const pos = Renderer.hexToPx(q, r); 
                const hex = this.add.image(pos.x, pos.y, 'hex_base').setScale(1/window.HIGH_RES_SCALE); 
                
                let tint = 0x555555; 
                if(t.id===0) tint=0x5a5245; // Dirt
                else if(t.id===1) tint=0x425030; // Grass
                else if(t.id===2) tint=0x222e1b; // Forest
                else if(t.id===4) tint=0x504540; // Town
                else if(t.id===5) { 
                    tint=0x303840; // Water
                    if(window.EnvSystem) window.EnvSystem.registerWater(hex, pos.y, q, r, this.decorGroup); 
                }
                
                if(window.EnvSystem) { 
                    if(t.id === 1) window.EnvSystem.spawnGrass(this, this.decorGroup, pos.x, pos.y); 
                    if(t.id === 2) window.EnvSystem.spawnTrees(this, this.treeGroup, pos.x, pos.y); 
                }
                
                hex.setTint(tint); this.hexGroup.add(hex); 
            } 
        } 
        this.centerMap(); 
    }
    
    update(time, delta) {
        if (!window.gameLogic) return;
        if(window.VFX && window.VFX.shakeRequest > 0) { this.cameras.main.shake(100, window.VFX.shakeRequest * 0.001); window.VFX.shakeRequest = 0; }
        if(window.EnvSystem) window.EnvSystem.update(time);
        if(window.VFX) { window.VFX.update(); this.vfxGraphics.clear(); window.VFX.draw(this.vfxGraphics); }
        if (window.gameLogic.map.length > 0 && !this.mapGenerated) { this.createMap(); this.mapGenerated = true; }
        
        if(this.unitView) this.unitView.update(time, delta);
        
        this.overlayGraphics.clear();
        // ★修正: 選択カーソルもHEX_SIZEに合わせて描画
        if (this.dragHighlightHex) { this.overlayGraphics.lineStyle(4, 0xffffff, 1.0); this.drawHexOutline(this.overlayGraphics, this.dragHighlightHex.q, this.dragHighlightHex.r); }
        const selected = window.gameLogic.selectedUnit;
        if(selected && window.gameLogic.reachableHexes.length > 0) { this.overlayGraphics.lineStyle(2, 0xffffff, 0.4); window.gameLogic.reachableHexes.forEach(h => this.drawHexOutline(this.overlayGraphics, h.q, h.r)); }
        if(selected && window.gameLogic.attackLine && window.gameLogic.attackLine.length > 0) {
            this.overlayGraphics.lineStyle(3, 0xff2222, 0.8);
            const targetUnit = window.gameLogic.aimTargetUnit;
            window.gameLogic.attackLine.forEach(h => { let offset = (targetUnit && targetUnit.q === h.q && targetUnit.r === h.r) ? time * 0.05 : 0; this.drawDashedHexOutline(this.overlayGraphics, h.q, h.r, offset); });
        }
        const hover = window.gameLogic.hoverHex;
        if(selected && hover && window.gameLogic.reachableHexes.some(h => h.q === hover.q && h.r === hover.r)) { this.overlayGraphics.lineStyle(4, 0xffffff, 1.0); this.drawHexOutline(this.overlayGraphics, hover.q, hover.r); }
        const path = window.gameLogic.path;
        if(path.length > 0 && selected) { 
            this.overlayGraphics.lineStyle(3, 0xffffff, 0.5); this.overlayGraphics.beginPath(); const s = Renderer.hexToPx(selected.q, selected.r); this.overlayGraphics.moveTo(s.x, s.y); path.forEach(p => { const px = Renderer.hexToPx(p.q, p.r); this.overlayGraphics.lineTo(px.x, px.y); }); this.overlayGraphics.strokePath(); 
        }
        this.crosshairGroup.clear();
        if (window.gameLogic.aimTargetUnit) {
            const u = window.gameLogic.aimTargetUnit;
            const pos = Renderer.hexToPx(u.q, u.r);
            this.drawCrosshair(this.crosshairGroup, pos.x, pos.y, time);
        }
    }
    
    // ★修正: カーソルもHEX_SIZEを基準に描画
    drawHexOutline(g, q, r) { 
        const c = Renderer.hexToPx(q, r); 
        // 54(HEX_SIZE) * 1.0 (サイズ調整)
        const size = HEX_SIZE * 1.0; 
        g.beginPath(); 
        for(let i=0; i<6; i++) { 
            const a = Math.PI/180 * (60*i - 30); // Pointy Top補正
            g.lineTo(c.x + size * Math.cos(a), c.y + size * Math.sin(a)); 
        } 
        g.closePath(); 
        g.strokePath(); 
    }
    
    drawDashedHexOutline(g, q, r, timeOffset = 0) {
        const c = Renderer.hexToPx(q, r); 
        const size = HEX_SIZE * 1.0;
        const pts = []; 
        for(let i=0; i<6; i++) { 
            const a = Math.PI/180 * (60*i - 30);
            pts.push({ x: c.x + size * Math.cos(a), y: c.y + size * Math.sin(a) }); 
        }
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

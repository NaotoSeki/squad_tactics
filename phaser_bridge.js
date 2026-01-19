/** * PHASER BRIDGE (Direct Texture Injection, Safe Deployment, Optimized) */
let phaserGame = null;

// ---------------------------------------------------------
//  Renderer
// ---------------------------------------------------------
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
            pixelArt: true, // ドット絵設定
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
    }
};

// ---------------------------------------------------------
//  Card Class
// ---------------------------------------------------------
class Card extends Phaser.GameObjects.Container {
    constructor(scene, x, y, type) {
        super(scene, x, y); 
        this.scene = scene; 
        this.cardType = type; 
        this.setSize(140, 200);

        this.visuals = scene.add.container(0, 0);
        const shadow = scene.add.rectangle(6, 6, 130, 190, 0x000000, 0.6);
        const contentBg = scene.add.rectangle(0, 0, 130, 190, 0x1a1a1a);
        const frame = scene.add.image(0, 0, 'card_frame').setDisplaySize(140, 200);
        frame.setInteractive({ useHandCursor: true, draggable: true });
        
        const iconKey = window.getCardTextureKey(scene, type);
        const icon = scene.add.image(0, -40, iconKey).setScale(1/window.HIGH_RES_SCALE);
        if(type === 'aerial' && scene.textures.exists('card_img_bomb')) icon.setDisplaySize(120, 80);
        const text = scene.add.text(0, 40, type.toUpperCase(), { fontSize: '16px', color: '#d84', fontStyle: 'bold' }).setOrigin(0.5);
        const desc = scene.add.text(0, 70, "DRAG TO DEPLOY", { fontSize: '10px', color: '#888' }).setOrigin(0.5);
        
        this.visuals.add([shadow, contentBg, icon, text, desc, frame]);
        this.add(this.visuals); 
        this.frameImage = frame;
        
        this.setScrollFactor(0); 
        this.baseX = x; this.baseY = y; 
        this.physX = x; this.physY = y; 
        this.velocityX = 0; this.velocityY = 0; 
        this.velocityAngle = 0; 
        this.targetX = x; this.targetY = y; 
        this.dragOffsetX = 0; this.dragOffsetY = 0;
        
        frame.on('pointerover', this.onHover, this); 
        frame.on('pointerout', this.onHoverOut, this); 
        frame.on('dragstart', this.onDragStart, this); 
        frame.on('drag', this.onDrag, this); 
        frame.on('dragend', this.onDragEnd, this);
        
        scene.add.existing(this);
    }

    updatePhysics() { 
        if (!this.scene || !this.frameImage) return; 
        if (!this.isDragging && !this.scene.isReturning) { 
            this.targetX = this.baseX; 
            this.targetY = this.baseY - (this.isHovering ? 30 : 0); 
        } 
        const stiffness = this.isDragging ? 0.2 : 0.08; 
        const damping = 0.65; 
        const ax = (this.targetX - this.physX) * stiffness; 
        const ay = (this.targetY - this.physY) * stiffness; 
        this.velocityX += ax; this.velocityY += ay; 
        this.velocityX *= damping; this.velocityY *= damping; 
        this.physX += this.velocityX; this.physY += this.velocityY; 
        this.setPosition(this.physX, this.physY); 

        let staticAngle = 0; 
        if (this.isDragging) staticAngle = -this.dragOffsetX * 0.4; 
        const targetDynamicAngle = -this.velocityX * 1.5; 
        const totalTargetAngle = staticAngle + targetDynamicAngle; 
        const angleForce = (totalTargetAngle - this.angle) * 0.12; 
        this.velocityAngle += angleForce; 
        this.velocityAngle *= 0.85; 
        this.angle += this.velocityAngle; 
        this.angle = Phaser.Math.Clamp(this.angle, -50, 50); 
    }

    onHover() { if(Renderer.isMapDragging || Renderer.isCardDragging) return; this.isHovering = true; this.parentContainer.bringToTop(this); }
    onHoverOut() { this.isHovering = false; }
    onDragStart(pointer) { if(Renderer.isMapDragging) return; this.isDragging = true; Renderer.isCardDragging = true; this.setAlpha(0.9); this.setScale(1.1); const hand = this.parentContainer; const worldPos = hand.getLocalTransformMatrix().transformPoint(this.x, this.y); hand.remove(this); this.scene.add.existing(this); this.physX = worldPos.x; this.physY = worldPos.y; this.targetX = this.physX; this.targetY = this.physY; this.setDepth(9999); this.dragOffsetX = this.physX - pointer.x; this.dragOffsetY = this.physY - pointer.y; }
    onDrag(pointer) { this.targetX = pointer.x + this.dragOffsetX; this.targetY = pointer.y + this.dragOffsetY; const main = this.scene.game.scene.getScene('MainScene'); if (this.y < this.scene.scale.height * 0.65) main.dragHighlightHex = Renderer.pxToHex(pointer.x, pointer.y); else main.dragHighlightHex = null; }
    
    onDragEnd(pointer) { 
        this.isDragging = false; 
        Renderer.isCardDragging = false; 
        this.setAlpha(1.0); 
        this.setScale(1.0); 
        const main = this.scene.game.scene.getScene('MainScene'); 
        main.dragHighlightHex = null; 
        const dropZoneY = this.scene.scale.height * 0.65; 
        
        if (this.y < dropZoneY) {
            const hex = Renderer.pxToHex(pointer.x, pointer.y);
            let canDeploy = false;
            if (window.gameLogic) {
                if (this.cardType === 'aerial') {
                    if (window.gameLogic.isValidHex(hex.q, hex.r)) canDeploy = true;
                    else window.gameLogic.log("配置不可: マップ範囲外です");
                } else {
                    canDeploy = window.gameLogic.checkDeploy(hex);
                }
            }
            if (canDeploy) this.burnAndConsume(hex); else this.returnToHand();
        } else {
            this.returnToHand(); 
        }
    }
    
    burnAndConsume(hex) {
        this.updatePhysics = () => {}; 
        this.frameImage.setTint(0x552222);
        const maskShape = this.scene.make.graphics(); maskShape.fillStyle(0xffffff); maskShape.fillRect(-70, -100, 140, 200); 
        this.visuals.setMask(maskShape.createGeometryMask());
        const burnProgress = { val: 0 }; 
        this.scene.tweens.add({
            targets: burnProgress, val: 1, duration: 200, ease: 'Linear',
            onUpdate: () => {
                if(!this.scene || !maskShape.scene) return;
                maskShape.clear(); maskShape.fillStyle(0xffffff); maskShape.fillRect(-70, -100, 140, 200 * (1 - burnProgress.val)); 
                maskShape.x = this.x; maskShape.y = this.y + (200 * burnProgress.val);
                const rad = Phaser.Math.DegToRad(this.angle); const cos = Math.cos(rad); const sin = Math.sin(rad); 
                for(let i=0; i<8; i++) { 
                    const randX = (Math.random() - 0.5) * 140; 
                    const wx = this.x + (randX * cos - sin); 
                    const wy = this.y + (randX * sin + cos); 
                    if(window.UIVFX) { window.UIVFX.addFire(wx, wy); if(Math.random()<0.3) window.UIVFX.addSmoke(wx, wy); }
                }
                this.x += (Math.random()-0.5) * 4; this.y += (Math.random()-0.5) * 4;
            },
            onComplete: () => {
                if (this.visuals) this.visuals.clearMask(true); if (maskShape) maskShape.destroy();
                this.scene.removeCard(this); const type = this.cardType; this.destroy();
                try { 
                    if (type === 'aerial') { const main = phaserGame.scene.getScene('MainScene'); if (main) main.triggerBombardment(hex); } 
                    else if(window.gameLogic) { window.gameLogic.deployUnit(hex, type); }
                } catch(e) { console.error("Logic Error:", e); }
            }
        });
    }
    returnToHand() { const hand = this.scene.handContainer; this.scene.children.remove(this); hand.add(this); this.setDepth(0); this.physX = this.x; this.physY = this.y; this.targetX = this.baseX; this.targetY = this.baseY; }
}

// ---------------------------------------------------------
//  UI SCENE
// ---------------------------------------------------------
class UIScene extends Phaser.Scene {
    constructor() { super({ key: 'UIScene', active: false }); this.cards=[]; this.handContainer=null; this.gradientBg=null; this.uiVfxGraphics=null; }
    create() {
        const w = this.scale.width; const h = this.scale.height;
        window.createGradientTexture(this);
        this.gradientBg = this.add.image(w/2, h, 'ui_gradient').setOrigin(0.5, 1).setDepth(0).setDisplaySize(w, h*0.25);
        this.handContainer = this.add.container(w/2, h);
        this.uiVfxGraphics = this.add.graphics().setDepth(10000);
        this.scale.on('resize', this.onResize, this);
    }
    onResize(gameSize) {
        const w = gameSize.width; const h = gameSize.height;
        if (this.gradientBg) { this.gradientBg.setPosition(w / 2, h); this.gradientBg.setDisplaySize(w, h * 0.25); }
        if (this.handContainer) { this.handContainer.setPosition(w / 2, h); }
    }
    update() { 
        this.cards.forEach(card => { if (card.active) card.updatePhysics(); }); 
        if(window.UIVFX) { window.UIVFX.update(); this.uiVfxGraphics.clear(); window.UIVFX.draw(this.uiVfxGraphics); }
    }
    dealStart(types) { types.forEach((type, i) => { this.time.delayedCall(i * 150, () => { this.addCardToHand(type); }); }); }
    addCardToHand(type) { if (this.cards.length >= 5) { console.log("Hand full"); return; } const card = new Card(this, 0, 0, type); this.handContainer.add(card); this.cards.push(card); card.physX = 600; card.physY = 300; card.setPosition(card.physX, card.physY); this.arrangeHand(); }
    removeCard(cardToRemove) { this.cards = this.cards.filter(c => c !== cardToRemove); this.arrangeHand(); }
    arrangeHand() { const total = this.cards.length; const centerIdx = (total - 1) / 2; const spacing = 160; this.cards.forEach((card, i) => { const offset = i - centerIdx; card.baseX = offset * spacing; card.baseY = -120; }); }
}

// ---------------------------------------------------------
//  MAIN SCENE (Direct Texture Injection)
// ---------------------------------------------------------
class MainScene extends Phaser.Scene {
    constructor() { 
        super({ key: 'MainScene' }); 
        this.hexGroup=null; this.unitGroup=null; this.vfxGraphics=null; this.overlayGraphics=null; 
        this.mapGenerated=false; this.dragHighlightHex=null;
        this.unitVisuals = new Map();
        this.crosshairGroup = null;
    }
    
    preload() { 
        if(window.EnvSystem) window.EnvSystem.preload(this);
        // ★重要: エラーが出るので preload での load.image は行わない！
    }

    // ★重要: 自力で画像を読み込んでセットアップする
    create() {
        const explosionBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAUAAAABABAMAAAB30k+FAAAAMFBMVEUAAAD///8UFBQoKCgwMDA8PDxERERMTExUVFRkZGR0dHSLi4uUlJSkpKS0tLTc3NwKGsidAAAAAXRSTlMAQObYZgAAAXpJREFUeNrt3D1uwzAMBeA4d+gEOUCOkCP4/qfIBXKCHiAH8AEMGbp061/R75El2qYF8uFBfEiF858B2gN7gD3Af5X31+0aYF+g1wNMBdoCrALdC7QLtD/QrUBrgW4GugfoNqA1QLcDrQY6G2g10FlA64DOAVoLdAq4DWAj0HWAW0EugpQCuBngP0HGAF0FKgXwE9B2gp0G9A5wAtBfoF0FqgpUAvgFYCPQVoJdBToH8B7QK0FugHQL8APQNoJ8A/A1oI9C3Q14B+A/QQoJ8APQZoHdA7gN4C9BqgnYD0FqDVA7wFaAnQa6C3AP0OaCegdUC/APoY0I+APgD0CKD3Ab0E6BNAbwP6FNB7gF4C9DGgTwG9A+glQG8D+hTQe4B2Ld8B+pbvAH3Nd4D/o+8A3+g7wDf7DvBf6B/gX97z7X1WpAAAAAElFTkSuQmCC';
        const soldierBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAPFBMVEUAAAAAAAB2AgB/BgCDEgCHGQCJJQCNLQCROACVQQCaSQCeUgCiWgCmYwCqaACubwCydwC2fQC6hgC+jQBj2x5AAAAAAXRSTlMAQObYZgAAAMFJREFUWIXt1sEKAjEMRNF+2tKq///RjQVxUwmCmJk78y4J5C04940x5p7760yA7i/gQ4D+Aj4E6C/gQ4D+Aj4E6C/gQ4D+Aj4E6C/gQ4D+Aj4E6C/gQ4D+Aj4E6C/gQ4D+Aj4E6C/gQ4D+Aj4E6C/gQ4D+Aj4E6C/gQ4D+Aj4E6C/gQ4D+Aj4E6C/gQ4D+Aj4E6C/gQ4D+Aj4E6C/gQ4D+Aj4E6C/gQ4D+Aj4E6C/gQ4D+An4P8A2D3w1hV8+V8AAAAABJRU5ErkJggg==';
        const tankBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAATlBMVEUAAAAAAAB2AgB/BgCDEgCHGQCJJQCNLQCROACVQQCaSQCeUgCiWgCmYwCqaACubwCydwC2fQC6hgC+jQDCkwDGlQDJlwDMmQDPmgDSnAD89/71AAAAAXRSTlMAQObYZgAAAPxJREFUWIXt1sEKwjAQRdFfaVq1//+jFQuCoykI4syc230sA3kTzr1ijLnl/joToPsL+BCgv4APAfoL+BCgv4APAfoL+BCgv4APAfoL+BCgv4APAfoL+BCgv4APAfoL+BCgv4APAfoL+BCgv4APAfoL+BCgv4APAfoL+BCgv4APAfoL+BCgv4APAfoL+BCgv4APAfoL+BCgv4APAfoL+BCgv4APAfoL+BCgv4APAfoL+BCgv4APAfoL+BCgv4APAfoL+BCgv4APAfoL+BCgv4APAfoL+BCgv4APAfoL+BCgv4APAfoL+BCgv4APAfoL+BCgv4APAfoL+BCgv4APAfoL+D3ANwx+N4Q9veQLE/7w1HAAAAAASUVORK5CYII=';

        const assets = {
            'explosion_sheet': { src: explosionBase64, isSprite: true, w:64, h:64 },
            'soldier_img': { src: soldierBase64, isSprite: false },
            'tank_img': { src: tankBase64, isSprite: false }
        };

        let loadedCount = 0;
        const total = Object.keys(assets).length;

        // すべての画像を読み込んでからゲームを開始する処理
        Object.keys(assets).forEach(key => {
            const img = new Image();
            img.onload = () => {
                // Phaserのテクスチャマネージャに直接追加
                if (assets[key].isSprite) {
                    this.textures.addSpriteSheet(key, img, { frameWidth: assets[key].w, frameHeight: assets[key].h });
                } else {
                    this.textures.addImage(key, img);
                }
                loadedCount++;
                if (loadedCount >= total) {
                    this.setupGame(); // 全て読み終わったら開始
                }
            };
            img.src = assets[key].src;
        });
    }

    // ★本来の create の中身をここに移動
    setupGame() {
        this.cameras.main.setBackgroundColor('#0b0e0a'); 
        this.hexGroup = this.add.group(); this.unitGroup = this.add.group(); 
        
        // 照準用グループ
        this.crosshairGroup = this.add.graphics().setDepth(200);
        this.vfxGraphics = this.add.graphics().setDepth(100); this.overlayGraphics = this.add.graphics().setDepth(50); 
        if(window.EnvSystem) window.EnvSystem.clear();
        this.scene.launch('UIScene'); 
        
        // 爆発アニメ定義
        this.anims.create({
            key: 'boom_anim',
            frames: this.anims.generateFrameNumbers('explosion_sheet', { start: 0, end: 4 }),
            frameRate: 15,
            repeat: 0,
            hideOnComplete: true
        });

        if (window.VFX) {
            window.VFX.addExplosion = (x, y, color, count) => {
                this.playExplosion(x, y);
                if(window.VFX.add) { for(let i=0; i<5; i++) window.VFX.add({x:x,y:y,vx:(Math.random()-0.5)*8,vy:(Math.random()-0.5)*8,life:10,maxLife:10,color:color||"#fa0",size:3,type:'spark'}); }
            };
        }

        this.input.on('wheel', (pointer, gameObjects, deltaX, deltaY, deltaZ) => { let newZoom = this.cameras.main.zoom; if (deltaY > 0) newZoom -= 0.5; else if (deltaY < 0) newZoom += 0.5; newZoom = Phaser.Math.Clamp(newZoom, 0.25, 4.0); this.tweens.add({ targets: this.cameras.main, zoom: newZoom, duration: 150, ease: 'Cubic.out' }); });
        this.input.on('pointerdown', (p) => { if (Renderer.isCardDragging || Renderer.checkUIHover(p.x, p.y)) return; if(p.button === 0) { Renderer.isMapDragging = true; if(window.gameLogic) window.gameLogic.handleClick(Renderer.pxToHex(p.x, p.y)); } else if(p.button === 2) { if(window.gameLogic) window.gameLogic.showContext(p.x, p.y); } });
        this.input.on('pointerup', () => { Renderer.isMapDragging = false; });
        this.input.on('pointermove', (p) => { if (Renderer.isCardDragging) return; if (p.isDown && Renderer.isMapDragging) { const zoom = this.cameras.main.zoom; this.cameras.main.scrollX -= (p.x - p.prevPosition.x) / zoom; this.cameras.main.scrollY -= (p.y - p.prevPosition.y) / zoom; } if(!Renderer.isMapDragging && window.gameLogic) window.gameLogic.handleHover(Renderer.pxToHex(p.x, p.y)); }); 
        this.input.mouse.disableContextMenu();
    }

    playExplosion(x, y) {
        const explosion = this.add.sprite(x, y, 'explosion_sheet');
        explosion.setDepth(200); explosion.setScale(2.0); explosion.play('boom_anim');
        if(window.VFX) window.VFX.shake(500); 
    }

    triggerBombardment(hex) { this.time.delayedCall(500, () => { const targetPos = Renderer.hexToPx(hex.q, hex.r); if(window.VFX) window.VFX.addBombardment(this, targetPos.x, targetPos.y, hex); }); }
    centerCamera(q, r) { const p = Renderer.hexToPx(q, r); this.cameras.main.centerOn(p.x, p.y); }
    centerMap() { this.cameras.main.centerOn((MAP_W * HEX_SIZE * 1.5) / 2, (MAP_H * HEX_SIZE * 1.732) / 2); }
    createMap() { 
        const map = window.gameLogic.map; 
        this.unitGroup.clear(true, true); this.unitVisuals.clear();
        for(let q=0; q<MAP_W; q++) { 
            for(let r=0; r<MAP_H; r++) { 
                const t = map[q][r]; if(t.id===-1)continue; 
                const pos = Renderer.hexToPx(q, r); 
                const hex = this.add.image(pos.x, pos.y, 'hex_base').setScale(1/window.HIGH_RES_SCALE); 
                let tint = 0x555555; if(t.id===0)tint=0x5a5245; else if(t.id===1)tint=0x425030; else if(t.id===2)tint=0x222e1b; else if(t.id===4)tint=0x504540; 
                else if(t.id===5) { tint=0x303840; if(window.EnvSystem) window.EnvSystem.registerWater(hex, pos.y, q, r, this.hexGroup); }
                if(window.EnvSystem) { if(t.id === 1) window.EnvSystem.spawnGrass(this, this.hexGroup, pos.x, pos.y); if(t.id === 2) window.EnvSystem.spawnTrees(this, this.hexGroup, pos.x, pos.y); }
                hex.setTint(tint); this.hexGroup.add(hex); 
            } 
        } 
        this.centerMap(); 
    }
    
    // ★重要: ユニットを画像スプライトとして作成
    createUnitVisual(u) {
        const container = this.add.container(0, 0);
        let key = 'soldier_img'; 
        if (u.def.isTank) key = 'tank_img';

        const sprite = this.add.sprite(0, 0, key).setScale(2.0); 
        if(u.team === 'player') sprite.setTint(0xaaccff); else sprite.setTint(0xffaaaa);

        const hpBg = this.add.rectangle(0, -30, 20, 4, 0x000000); 
        const hpBar = this.add.rectangle(-10, -30, 20, 4, 0x00ff00);
        const cursor = this.add.image(0, 0, 'cursor').setScale(1/window.HIGH_RES_SCALE).setAlpha(0).setVisible(false);
        this.tweens.add({ targets: cursor, scale: { from: 1/window.HIGH_RES_SCALE, to: 1.1/window.HIGH_RES_SCALE }, alpha: { from: 1, to: 0.5 }, yoyo: true, repeat: -1, duration: 800 });
        
        container.add([sprite, hpBg, hpBar, cursor]);
        container.sprite = sprite; container.hpBar = hpBar; container.cursor = cursor;
        container.walkTween = null;
        return container;
    }

    updateUnitVisual(container, u) {
        const targetPos = Renderer.hexToPx(u.q, u.r);
        const currentX = container.x; const currentY = container.y;
        container.setPosition(targetPos.x, targetPos.y);
        
        // 歩行アニメ
        const dist = Phaser.Math.Distance.Between(currentX, currentY, targetPos.x, targetPos.y);
        if (dist > 1) {
            if (!container.walkTween) {
                container.walkTween = this.tweens.add({ targets: container.sprite, angle: { from: -10, to: 10 }, y: "-=5", duration: 150, yoyo: true, repeat: -1 });
            }
        } else {
            if (container.walkTween) { container.walkTween.stop(); container.sprite.setAngle(0); container.sprite.y = 0; container.walkTween = null; }
        }

        const hpPct = u.hp / u.maxHp; container.hpBar.width = 20 * hpPct; container.hpBar.x = -10 + (10 * hpPct); container.hpBar.fillColor = hpPct > 0.5 ? 0x00ff00 : 0xff0000;
        if(window.gameLogic.selectedUnit === u) { container.cursor.setVisible(true); container.cursor.setAlpha(1); } else { container.cursor.setVisible(false); }
    }

    update(time, delta) {
        if (!window.gameLogic) return;
        if(window.VFX && window.VFX.shakeRequest > 0) { this.cameras.main.shake(100, window.VFX.shakeRequest * 0.001); window.VFX.shakeRequest = 0; }
        if(window.EnvSystem) window.EnvSystem.update(time);
        if(window.VFX) { window.VFX.update(); this.vfxGraphics.clear(); window.VFX.draw(this.vfxGraphics); }
        if (window.gameLogic.map.length > 0 && !this.mapGenerated) { this.createMap(); this.mapGenerated = true; }
        const activeIds = new Set();
        window.gameLogic.units.forEach(u => {
            if(u.hp <= 0) return; activeIds.add(u.id); 
            let visual = this.unitVisuals.get(u.id);
            if (!visual) { visual = this.createUnitVisual(u); this.unitVisuals.set(u.id, visual); this.unitGroup.add(visual); }
            this.updateUnitVisual(visual, u);
        });
        for (const [id, visual] of this.unitVisuals) { if (!activeIds.has(id)) { visual.destroy(); this.unitVisuals.delete(id); } }
        this.overlayGraphics.clear();
        if (this.dragHighlightHex) { this.overlayGraphics.lineStyle(4, 0xffffff, 1.0); this.drawHexOutline(this.overlayGraphics, this.dragHighlightHex.q, this.dragHighlightHex.r); }
        const selected = window.gameLogic.selectedUnit;
        if(selected && window.gameLogic.reachableHexes.length > 0) { this.overlayGraphics.lineStyle(2, 0xffffff, 0.4); window.gameLogic.reachableHexes.forEach(h => this.drawHexOutline(this.overlayGraphics, h.q, h.r)); }
        
        if(selected && window.gameLogic.attackLine && window.gameLogic.attackLine.length > 0) {
            this.overlayGraphics.lineStyle(3, 0xff2222, 0.8);
            const targetUnit = window.gameLogic.aimTargetUnit;
            window.gameLogic.attackLine.forEach(h => {
                let offset = 0;
                if (targetUnit && targetUnit.q === h.q && targetUnit.r === h.r) { offset = time * 0.05; }
                this.drawDashedHexOutline(this.overlayGraphics, h.q, h.r, offset);
            });
        }
        
        const hover = window.gameLogic.hoverHex;
        if(selected && hover && window.gameLogic.reachableHexes.some(h => h.q === hover.q && h.r === hover.r)) { this.overlayGraphics.lineStyle(4, 0xffffff, 1.0); this.drawHexOutline(this.overlayGraphics, hover.q, hover.r); }
        const path = window.gameLogic.path;
        if(path.length > 0 && selected) { 
            this.overlayGraphics.lineStyle(3, 0xffffff, 0.5); this.overlayGraphics.beginPath(); 
            const s = Renderer.hexToPx(selected.q, selected.r); this.overlayGraphics.moveTo(s.x, s.y); 
            path.forEach(p => { const px = Renderer.hexToPx(p.q, p.r); this.overlayGraphics.lineTo(px.x, px.y); }); 
            this.overlayGraphics.strokePath(); 
        }

        this.crosshairGroup.clear();
        if (window.gameLogic.aimTargetUnit) {
            const u = window.gameLogic.aimTargetUnit;
            const pos = Renderer.hexToPx(u.q, u.r);
            this.drawCrosshair(this.crosshairGroup, pos.x, pos.y, time);
        }
    }
    
    drawHexOutline(g, q, r) { const c = Renderer.hexToPx(q, r); g.beginPath(); for(let i=0; i<6; i++) { const a = Math.PI/180*60*i; g.lineTo(c.x+HEX_SIZE*0.9*Math.cos(a), c.y+HEX_SIZE*0.9*Math.sin(a)); } g.closePath(); g.lineWidth=0.1; g.strokePath(); }

    drawDashedHexOutline(g, q, r, timeOffset = 0) {
        const c = Renderer.hexToPx(q, r);
        const pts = [];
        for(let i=0; i<6; i++) {
            const a = Math.PI/180*60*i;
            pts.push({ x: c.x+HEX_SIZE*0.9*Math.cos(a), y: c.y+HEX_SIZE*0.9*Math.sin(a) });
        }
        const dashLen = 6; const gapLen = 4; const period = dashLen + gapLen;
        let currentDistInPath = -timeOffset; 
        for(let i=0; i<6; i++) {
            const p1 = pts[i]; const p2 = pts[(i+1)%6];
            const dist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
            const dx = (p2.x - p1.x) / dist; const dy = (p2.y - p1.y) / dist;
            let patternPhase = currentDistInPath % period;
            if(patternPhase < 0) patternPhase += period;
            let distCovered = 0;
            while(distCovered < dist) {
                const isDash = patternPhase < dashLen;
                const lenToNextChange = isDash ? (dashLen - patternPhase) : (period - patternPhase);
                const segmentLen = Math.min(lenToNextChange, dist - distCovered);
                if(isDash) {
                    const sx = p1.x + dx * distCovered; const sy = p1.y + dy * distCovered;
                    const ex = p1.x + dx * (distCovered + segmentLen); const ey = p1.y + dy * (distCovered + segmentLen);
                    g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex, ey); g.strokePath();
                }
                distCovered += segmentLen; patternPhase = (patternPhase + segmentLen) % period;
            }
            currentDistInPath += dist;
        }
    }

    drawCrosshair(g, x, y, time) {
        // 回転ヘックスが機能しているので空でOK
    }
}

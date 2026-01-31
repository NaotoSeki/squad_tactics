/** PHASER BRIDGE: Strict Hover Check & Fix Right-Click Passing */

const Renderer = {
    game: null, isMapDragging: false, isCardDragging: false,
    init(canvasElement) {
        const config = { type: Phaser.AUTO, parent: 'game-view', width: document.getElementById('game-view').clientWidth, height: document.getElementById('game-view').clientHeight, backgroundColor: '#0b0e0a', pixelArt: false, scene: [MainScene, UIScene], fps: { target: 60 } };
        this.game = new Phaser.Game(config); 
    },
    resize() { if(this.game) this.game.scale.resize(document.getElementById('game-view').clientWidth, document.getElementById('game-view').clientHeight); },
    hexToPx(q, r) { return { x: HEX_SIZE * 3/2 * q, y: HEX_SIZE * Math.sqrt(3) * (r + q/2) }; },
    pxToHex(mx, my) { 
        const main = this.game.scene.getScene('MainScene'); 
        if(!main) return {q:0, r:0}; 
        const w = main.cameras.main.getWorldPoint(mx, my); 
        const q = (2/3*w.x)/HEX_SIZE; const r = (-1/3*w.x+Math.sqrt(3)/3*w.y)/HEX_SIZE;
        let rq=Math.round(q), rr=Math.round(r), rs=Math.round(-q-r);
        const dq=Math.abs(rq-q), dr=Math.abs(rr-r), ds=Math.abs(rs-(-q-r));
        if(dq>dr&&dq>ds) rq=-rr-rs; else if(dr>ds) rr=-rq-rs; return {q:rq, r:rr};
    },
    centerMap() { const main = this.game.scene.getScene('MainScene'); if (main) main.cameras.main.centerOn((MAP_W*HEX_SIZE*1.5)/2, (MAP_H*HEX_SIZE*1.732)/2); },
    dealCards(types) { const ui = this.game.scene.getScene('UIScene'); if(ui) ui.dealStart(types); },
    checkUIHover(x, y, pointerEvent) { 
        if (this.isCardDragging) return true;
        const checkX = (pointerEvent && pointerEvent.clientX !== undefined) ? pointerEvent.clientX : x;
        const checkY = (pointerEvent && pointerEvent.clientY !== undefined) ? pointerEvent.clientY : y;
        const menus = ['context-menu', 'command-menu', 'setup-screen', 'reward-screen'];
        for (let id of menus) { const el = document.getElementById(id); if (el && el.offsetParent !== null) { const rect = el.getBoundingClientRect(); if (checkX >= rect.left && checkX <= rect.right && checkY >= rect.top && checkY <= rect.bottom) return true; } }
        return false; 
    },
    playAttackAnim(attacker, target) { const main = this.game.scene.getScene('MainScene'); if (main && main.unitView) main.unitView.triggerAttack(attacker, target); },
    playExplosion(x, y) { const main = this.game.scene.getScene('MainScene'); if (main) { const ex = main.add.sprite(x, y, 'explosion_sheet'); ex.play('explosion_anim'); ex.once('animationcomplete', () => ex.destroy()); } },
    generateFaceIcon(seed) { const c = document.createElement('canvas'); c.width = 64; c.height = 64; const ctx = c.getContext('2d'); const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }; ctx.fillStyle = "#334"; ctx.fillRect(0,0,64,64); ctx.fillStyle = "#f1c27d"; ctx.beginPath(); ctx.arc(32, 36, 18, 0, Math.PI*2); ctx.fill(); ctx.fillStyle = "#343"; ctx.beginPath(); ctx.arc(32, 28, 20, Math.PI, 0); ctx.lineTo(54, 30); ctx.lineTo(10, 30); ctx.fill(); return c.toDataURL(); }
};

// --- (UIScene & Card Classes) ---
class UIScene extends Phaser.Scene {
    constructor() { super({ key: 'UIScene' }); this.cards=[]; }
    create() { this.handContainer = this.add.container(this.scale.width/2, this.scale.height); }
    dealStart(types) { types.forEach((t, i) => this.time.delayedCall(i*150, () => this.addCardToHand(t))); }
    addCardToHand(type) { const card = new Card(this, 0, 0, type); this.handContainer.add(card); this.cards.push(card); this.arrangeHand(); }
    arrangeHand() { const total = this.cards.length; const spacing = 160; this.cards.forEach((c, i) => { c.baseX = (i - (total-1)/2) * spacing; c.baseY = -120; }); }
}

class Card extends Phaser.GameObjects.Container {
    constructor(scene, x, y, type) {
        super(scene, x, y); this.scene = scene; this.cardType = type; this.setSize(140, 200);
        const rect = scene.add.rectangle(0, 0, 140, 200, 0x1a1a1a).setStrokeStyle(2, 0x555); this.add(rect);
        const txt = scene.add.text(0, 20, type.toUpperCase(), { fontSize: '14px', color: '#d84' }).setOrigin(0.5); this.add(txt);
        rect.setInteractive({ draggable: true });
        rect.on('dragstart', (p) => { this.isDragging = true; Renderer.isCardDragging = true; this.setDepth(999); });
        rect.on('drag', (p) => { this.setPosition(p.x - this.scene.scale.width/2, p.y - this.scene.scale.height); });
        rect.on('dragend', (p) => { 
            this.isDragging = false; Renderer.isCardDragging = false;
            if (p.y < this.scene.scale.height * 0.7) {
                const hex = Renderer.pxToHex(p.x, p.y);
                if (window.gameLogic && window.gameLogic.deployUnit(hex, this.cardType)) { this.destroy(); return; }
            }
            this.setPosition(this.baseX, this.baseY);
        });
    }
}

// --- (MainScene Class) ---
class MainScene extends Phaser.Scene {
    constructor() { super({ key: 'MainScene' }); this.mapGenerated=false; }
    preload() { 
        if(window.EnvSystem) window.EnvSystem.preload(this);
        this.load.spritesheet('us_soldier', 'asset/us-soldier-back-sheet.png', { frameWidth: 128, frameHeight: 128 });
        this.load.spritesheet('tank_sheet', 'asset/tank_sheet_1.png', { frameWidth: 128, frameHeight: 128 });
        this.load.spritesheet('explosion_sheet', 'asset/explosion_sheet_1.png', { frameWidth: 64, frameHeight: 64 });
    }
    create() {
        if(window.createHexTexture) window.createHexTexture(this);
        this.hexGroup = this.add.layer(); this.decorGroup = this.add.layer(); this.unitGroup = this.add.layer(); this.hpGroup = this.add.layer();
        this.unitView = new UnitView(this, this.unitGroup, this.hpGroup);
        this.scene.launch('UIScene'); this.input.mouse.disableContextMenu();
        this.input.on('pointerdown', (p) => { 
            if (Renderer.isCardDragging || Renderer.checkUIHover(p.x, p.y, p.event)) return; 
            const hex = Renderer.pxToHex(p.x, p.y);
            if(p.button === 0) { Renderer.isMapDragging = true; if(window.gameLogic) window.gameLogic.handleClick(hex); } 
            else if(p.button === 2) { if(window.gameLogic) window.gameLogic.handleRightClick(p.x, p.y, hex); } 
        });
        this.input.on('pointerup', () => Renderer.isMapDragging = false);
        this.input.on('pointermove', (p) => { 
            if (p.isDown && Renderer.isMapDragging) { this.cameras.main.scrollX -= (p.x - p.prevPosition.x)/this.cameras.main.zoom; this.cameras.main.scrollY -= (p.y - p.prevPosition.y)/this.cameras.main.zoom; }
            if(!Renderer.isMapDragging && window.gameLogic) window.gameLogic.handleHover(Renderer.pxToHex(p.x, p.y));
        });
    }
    update(time, delta) {
        if (!window.gameLogic) return;
        if (!this.mapGenerated && window.gameLogic.map.length > 0) { this.createMap(); this.mapGenerated = true; }
        if(this.unitView) this.unitView.update(time, delta);
        if(window.EnvSystem) window.EnvSystem.update(time);
    }
    createMap() {
        const map = window.gameLogic.map;
        for(let q=0; q<MAP_W; q++) { 
            for(let r=0; r<MAP_H; r++) { 
                const t = map[q][r]; if(t.id===-1)continue; const pos = Renderer.hexToPx(q, r); 
                const hex = this.add.image(pos.x, pos.y, 'hex_base').setScale(1/2).setTint(t.id===5?0x303840:0x5a5245);
                this.hexGroup.add(hex);
                if(window.EnvSystem) { if(t.id===1) window.EnvSystem.spawnGrass(this, this.decorGroup, pos.x, pos.y); if(t.id===2) window.EnvSystem.spawnTrees(this, this.decorGroup, pos.x, pos.y); }
            } 
        } 
        Renderer.centerMap();
    }
}

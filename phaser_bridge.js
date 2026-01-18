/** * PHASER BRIDGE (Card Drag & Drop Polish) */
let phaserScene = null;

// カード画像生成
window.createCardIcon = function(type) {
    const c=document.createElement('canvas');c.width=100;c.height=60;const x=c.getContext('2d');x.translate(50,30);x.scale(2,2);
    if(type==='infantry'){x.fillStyle="#444";x.fillRect(-15,0,30,4);x.fillStyle="#642";x.fillRect(-15,0,10,4);}
    else if(type==='tank'){x.fillStyle="#444";x.fillRect(-12,-6,24,12);x.fillStyle="#222";x.fillRect(0,-2,16,4);}
    else if(type==='heal'){x.fillStyle="#eee";x.fillRect(-10,-8,20,16);x.fillStyle="#d00";x.fillRect(-3,-6,6,12);x.fillRect(-8,-1,16,2);}
    else if(type==='tiger'){x.fillStyle="#554";x.fillRect(-14,-8,28,16);x.fillStyle="#111";x.fillRect(2,-2,20,4);}
    else {x.fillStyle="#333";x.fillRect(-10,-5,20,10);} return c.toDataURL();
};

const Renderer = {
    game: null,
    init(canvasElement) {
        const config = { type: Phaser.AUTO, parent: 'game-view', width: document.getElementById('game-view').clientWidth, height: document.getElementById('game-view').clientHeight, backgroundColor: '#0b0e0a', scene: MainScene, fps: { target: 60 }, physics: { default: 'arcade', arcade: { debug: false } } };
        this.game = new Phaser.Game(config);
        window.addEventListener('resize', () => this.resize());
    },
    resize() { if(this.game) this.game.scale.resize(document.getElementById('game-view').clientWidth, document.getElementById('game-view').clientHeight); },
    centerOn(q, r) { if(phaserScene) phaserScene.centerCamera(q, r); },
    dealCard(type) { if(phaserScene) phaserScene.addCardToHand(type); }, // 外部呼び出し用
    hexToPx(q, r) { return { x: HEX_SIZE * 3/2 * q, y: HEX_SIZE * Math.sqrt(3) * (r + q/2) }; },
    pxToHex(mx, my) { if(!phaserScene) return {q:0, r:0}; const w = phaserScene.cameras.main.getWorldPoint(mx, my); return this.roundHex((2/3*w.x)/HEX_SIZE, (-1/3*w.x+Math.sqrt(3)/3*w.y)/HEX_SIZE); },
    roundHex(q,r) { let rq=Math.round(q), rr=Math.round(r), rs=Math.round(-q-r); const dq=Math.abs(rq-q), dr=Math.abs(rr-r), ds=Math.abs(rs-(-q-r)); if(dq>dr&&dq>ds) rq=-rr-rs; else if(dr>ds) rr=-rq-rs; return {q:rq, r:rr}; },
    frame: 0, draw() {}
};

/**
 * リッチなカードUIクラス
 */
class Card extends Phaser.GameObjects.Container {
    constructor(scene, x, y, type) {
        super(scene, x, y);
        this.scene = scene;
        this.cardType = type;
        this.setSize(140, 200);

        // ビジュアル
        const bg = scene.add.rectangle(0, 0, 140, 200, 0x222222).setStrokeStyle(2, 0x555555);
        const iconKey = `card_icon_${type}`;
        if(!scene.textures.exists(iconKey)) scene.textures.addBase64(iconKey, window.createCardIcon(type));
        const icon = scene.add.image(0, -40, iconKey);
        const text = scene.add.text(0, 40, type.toUpperCase(), { fontSize: '16px', color: '#d84', fontStyle: 'bold' }).setOrigin(0.5);
        const desc = scene.add.text(0, 70, "DRAG TO DEPLOY", { fontSize: '10px', color: '#888' }).setOrigin(0.5);
        this.add([bg, icon, text, desc]);

        this.setInteractive({ draggable: true });
        
        // ローカル座標の基準点
        this.baseX = x; this.baseY = y; this.baseAngle = 0;
        this.prevX = x;

        this.on('pointerover', this.onHover, this);
        this.on('pointerout', this.onHoverOut, this);
        this.on('dragstart', this.onDragStart, this);
        this.on('drag', this.onDrag, this);
        this.on('dragend', this.onDragEnd, this);
        scene.add.existing(this);
    }

    onHover() {
        if(this.isDragging) return;
        this.parentContainer.bringToTop(this);
        this.scene.tweens.add({ targets: this, y: this.baseY - 60, scale: 1.2, angle: 0, duration: 150, ease: 'Back.out' });
    }

    onHoverOut() {
        if(this.isDragging) return;
        this.scene.tweens.add({ targets: this, y: this.baseY, x: this.baseX, scale: 1.0, angle: this.baseAngle, duration: 200, ease: 'Power2' });
    }

    onDragStart(pointer, dragX, dragY) {
        this.isDragging = true;
        this.setAlpha(0.6); // ★半透明化

        // コンテナから脱出してWorld座標へ移動 (手札コンテナの座標を加算)
        const hand = this.parentContainer;
        const worldX = hand.x + this.x;
        const worldY = hand.y + this.y;
        
        hand.remove(this); // コンテナから外す
        this.scene.add.existing(this); // シーン直下に置く
        this.setPosition(worldX, worldY);
        this.setDepth(1000); // 最前面へ
        this.setScale(1.1);
    }

    onDrag(pointer, dragX, dragY) {
        this.x = dragX;
        this.y = dragY;

        // 慣性
        const dx = this.x - this.prevX;
        const targetAngle = Phaser.Math.Clamp(dx * 2, -30, 30);
        this.angle += (targetAngle - this.angle) * 0.2;
        this.prevX = this.x;

        // ★ドロップ候補のハイライト
        const dropZoneY = this.scene.scale.height * 0.66;
        if (this.y < dropZoneY) {
             const hex = Renderer.pxToHex(this.x, this.y);
             this.scene.dragHighlightHex = hex; // Sceneに伝える
        } else {
             this.scene.dragHighlightHex = null;
        }
    }

    onDragEnd(pointer) {
        this.isDragging = false;
        this.setAlpha(1.0); // 不透明に戻す
        this.scene.dragHighlightHex = null;

        const dropZoneY = this.scene.scale.height * 0.66;
        if (this.y < dropZoneY && window.gameLogic) {
             const hex = Renderer.pxToHex(this.x, this.y);
             console.log(`Card dropped at: ${hex.q}, ${hex.r}`);
             // TODO: ここで gameLogic.deployUnit(hex, this.cardType) を呼ぶ
             this.returnToHand(); // 仮：手札に戻す
        } else {
             this.returnToHand();
        }
    }

    returnToHand() {
        const hand = this.scene.handContainer;
        // World座標での戻り先を計算
        const targetX = hand.x + this.baseX;
        const targetY = hand.y + this.baseY;
        
        this.scene.tweens.add({
            targets: this,
            x: targetX, y: targetY, angle: this.baseAngle, scale: 1.0,
            duration: 300, ease: 'Back.out',
            onComplete: () => {
                // コンテナに戻す
                this.scene.children.remove(this);
                hand.add(this);
                this.setPosition(this.baseX, this.baseY); // ローカル座標に戻す
            }
        });
    }
}

class MainScene extends Phaser.Scene {
    constructor() { super({ key: 'MainScene' }); this.hexGroup=null; this.unitGroup=null; this.vfxGraphics=null; this.overlayGraphics=null; this.mapGenerated=false; this.handContainer=null; this.cards=[]; this.dragHighlightHex=null; }

    preload() {
        const g = this.make.graphics({x:0, y:0, add:false});
        // Assets
        g.lineStyle(2, 0x888888, 1); g.fillStyle(0xffffff, 1); g.beginPath();
        for(let i=0; i<6; i++) { const a = Math.PI/180 * 60 * i; g.lineTo(HEX_SIZE+HEX_SIZE*Math.cos(a), HEX_SIZE+HEX_SIZE*Math.sin(a)); }
        g.closePath(); g.fillPath(); g.strokePath(); g.generateTexture('hex_base', HEX_SIZE*2, HEX_SIZE*2);
        g.clear(); g.fillStyle(0x00ff00, 1); g.fillCircle(16, 16, 10); g.generateTexture('unit_player', 32, 32);
        g.clear(); g.fillStyle(0xff0000, 1); g.fillRect(4, 4, 24, 24); g.generateTexture('unit_enemy', 32, 32);
        g.clear(); g.lineStyle(3, 0x00ff00, 1); g.strokeCircle(32, 32, 28); g.generateTexture('cursor', 64, 64);
    }

    create() {
        phaserScene = this; this.cameras.main.setBackgroundColor('#0b0e0a');
        this.hexGroup = this.add.group(); this.unitGroup = this.add.group();
        this.vfxGraphics = this.add.graphics().setDepth(100);
        this.overlayGraphics = this.add.graphics().setDepth(50);

        const h = this.scale.height;
        const w = this.scale.width;
        
        // UI Layer (Hand Area)
        this.add.rectangle(w/2, h, w, h*0.35, 0x000000, 0.8).setOrigin(0.5, 1).setDepth(200);
        this.handContainer = this.add.container(w/2, h).setDepth(201); // 画面最下部中央に配置
        
        this.input.on('pointerdown', (p) => {
            if(p.y > h * 0.66) return; // UIエリアは無視
            if(p.button===0) { if(window.gameLogic) window.gameLogic.handleClick(Renderer.pxToHex(p.x, p.y)); }
            else if(p.button===2) { if(window.gameLogic) window.gameLogic.showContext(p.x, p.y); }
        });
        this.input.on('pointermove', (p) => {
            if (p.isDown && !this.input.activePointer.curr.length && p.y < h * 0.66) { 
                this.cameras.main.scrollX -= (p.x - p.prevPosition.x); this.cameras.main.scrollY -= (p.y - p.prevPosition.y); 
            }
            if(window.gameLogic) window.gameLogic.handleHover(Renderer.pxToHex(p.x, p.y));
        });
        this.input.mouse.disableContextMenu();
        
        // テスト配布
        this.time.delayedCall(500, ()=>{ ['infantry','tank','heal','infantry','tiger'].forEach(t => this.addCardToHand(t)); });
    }

    addCardToHand(type) {
        const card = new Card(this, 0, 200, type); // 初期位置
        this.handContainer.add(card);
        this.cards.push(card);
        this.arrangeHand();
    }

    arrangeHand() {
        const total = this.cards.length;
        const centerIdx = (total - 1) / 2;
        const spacing = 100;

        this.cards.forEach((card, i) => {
            const offset = i - centerIdx;
            const targetX = offset * spacing;
            // 扇状配置: 中央ほど高く(-150), 端ほど低い(-120)
            const targetY = -150 + Math.abs(offset) * 20; 
            const targetAngle = offset * 5;

            card.baseX = targetX; card.baseY = targetY; card.baseAngle = targetAngle;

            this.tweens.add({ targets: card, x: targetX, y: targetY, angle: targetAngle, duration: 400, ease: 'Back.out' });
        });
    }

    update(time, delta) {
        if (!window.gameLogic) return;
        VFX.update(); this.vfxGraphics.clear(); VFX.draw(this.vfxGraphics);
        if (window.gameLogic.map.length > 0 && !this.mapGenerated) { this.createMap(); this.mapGenerated = true; }
        
        this.unitGroup.clear(true, true);
        window.gameLogic.units.forEach(u => {
            if(u.hp <= 0) return;
            const pos = Renderer.hexToPx(u.q, u.r);
            const container = this.add.container(pos.x, pos.y);
            const sprite = this.add.sprite(0, 0, u.team==='player'?'unit_player':'unit_enemy');
            if(u.def.isTank) sprite.setTint(0x888888); if(u.team==='player') sprite.setTint(0x6688aa); else sprite.setTint(0xcc6655);
            container.add(sprite);
            const hpPct = u.hp / u.maxHp;
            container.add([this.add.rectangle(0, -20, 20, 4, 0x000000), this.add.rectangle(-10+(10*hpPct), -20, 20*hpPct, 4, hpPct>0.5?0x00ff00:0xff0000)]);
            if(window.gameLogic.selectedUnit === u) {
                const c = this.add.image(0, 0, 'cursor');
                this.tweens.add({ targets: c, scale: { from: 1, to: 1.1 }, alpha: { from: 1, to: 0.5 }, yoyo: true, repeat: -1, duration: 800 });
                container.add(c);
            }
            this.unitGroup.add(container);
        });

        // Overlay Drawing
        this.overlayGraphics.clear();
        
        // 1. Drag Highlight (White Hex)
        if (this.dragHighlightHex) {
            this.overlayGraphics.lineStyle(4, 0xffffff, 1.0);
            this.drawHexOutline(this.overlayGraphics, this.dragHighlightHex.q, this.dragHighlightHex.r);
        }

        const selected = window.gameLogic.selectedUnit;
        if(selected && window.gameLogic.reachableHexes.length > 0) {
            this.overlayGraphics.lineStyle(2, 0xffffff, 0.4); 
            window.gameLogic.reachableHexes.forEach(h => this.drawHexOutline(this.overlayGraphics, h.q, h.r));
        }
        const hover = window.gameLogic.hoverHex;
        if(selected && hover && window.gameLogic.reachableHexes.some(h => h.q === hover.q && h.r === hover.r)) {
            this.overlayGraphics.lineStyle(4, 0xffffff, 1.0); this.drawHexOutline(this.overlayGraphics, hover.q, hover.r);
        }
        const path = window.gameLogic.path;
        if(path.length > 0 && selected) {
            this.overlayGraphics.lineStyle(3, 0xffffff, 0.5); this.overlayGraphics.beginPath(); const s = Renderer.hexToPx(selected.q, selected.r); this.overlayGraphics.moveTo(s.x, s.y);
            path.forEach(p => { const px = Renderer.hexToPx(p.q, p.r); this.overlayGraphics.lineTo(px.x, px.y); }); this.overlayGraphics.strokePath();
        }
    }

    drawHexOutline(g, q, r) {
        const c = Renderer.hexToPx(q, r); g.beginPath();
        for(let i=0; i<6; i++) { const a = Math.PI/180*60*i; g.lineTo(c.x+HEX_SIZE*0.9*Math.cos(a), c.y+HEX_SIZE*0.9*Math.sin(a)); }
        g.closePath(); g.strokePath();
    }
    createMap() { /* (前回と同じ) */ const map = window.gameLogic.map; for(let q=0; q<MAP_W; q++) { for(let r=0; r<MAP_H; r++) { const t = map[q][r]; if(t.id===-1)continue; const pos = Renderer.hexToPx(q, r); const hex = this.add.image(pos.x, pos.y, 'hex_base'); let tint = 0x555555; if(t.id===0)tint=0x5a5245; else if(t.id===1)tint=0x425030; else if(t.id===2)tint=0x222e1b; else if(t.id===4)tint=0x504540; else if(t.id===5)tint=0x303840; hex.setTint(tint); if(t.id===2) { const tr=this.add.circle(pos.x, pos.y, HEX_SIZE*0.6, 0x112211, 0.5); this.hexGroup.add(tr); } this.hexGroup.add(hex); } } }
    centerCamera(q, r) { const p = Renderer.hexToPx(q, r); this.cameras.main.centerOn(p.x, p.y); }
}

const Sfx = { play(id){} };
const VFX = { /* (前回と同じVFXコード) */
    particles:[], projectiles:[], 
    add(p){this.particles.push(p);}, addProj(p){this.projectiles.push(p);},
    addExplosion(x,y,c,n){for(let i=0;i<n;i++){const a=Math.random()*6.28,s=Math.random()*5+1;this.add({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:30+Math.random()*20,maxLife:50,color:c,size:2,type:'s'});}},
    addUnitDebris(x,y){}, update(){ this.particles.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.life--;}); this.projectiles.forEach(p=>{if(p.type.includes('shell')||p.type==='rocket'){p.progress+=p.speed;if(p.progress>=1){p.dead=true;p.onHit();return;}const lx=p.sx+(p.ex-p.sx)*p.progress,ly=p.sy+(p.ey-p.sy)*p.progress,a=Math.sin(p.progress*Math.PI)*p.arcHeight;p.x=lx;p.y=ly-a;}else{p.x+=p.vx;p.y+=p.vy;p.life--;if(p.life<=0){p.dead=true;p.onHit();}}}); this.particles=this.particles.filter(p=>p.life>0); this.projectiles=this.projectiles.filter(p=>!p.dead); }, draw(g){ this.projectiles.forEach(p=>{g.fillStyle(0xffff00,1); g.fillCircle(p.x,p.y,3);}); this.particles.forEach(p=>{g.fillStyle(p.color==='#fa0'?0xffaa00:0xffffff, p.life/p.maxLife); g.fillCircle(p.x,p.y,p.size);}); }
};

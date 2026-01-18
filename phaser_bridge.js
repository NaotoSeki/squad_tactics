/** * PHASER BRIDGE (Solid Interaction & Drag Fix) */
let phaserGame = null;

// カード画像生成
window.createCardIcon = function(type) {
    const c=document.createElement('canvas');c.width=100;c.height=60;const x=c.getContext('2d');x.translate(50,30);x.scale(2,2);
    if(type==='infantry'){x.fillStyle="#444";x.fillRect(-15,0,30,4);x.fillStyle="#642";x.fillRect(-15,0,10,4);}
    else if(type==='tank'){x.fillStyle="#444";x.fillRect(-12,-6,24,12);x.fillStyle="#222";x.fillRect(0,-2,16,4);}
    else if(type==='heal'){x.fillStyle="#eee";x.fillRect(-10,-8,20,16);x.fillStyle="#d00";x.fillRect(-3,-6,6,12);x.fillRect(-8,-1,16,2);}
    else if(type==='tiger'){x.fillStyle="#554";x.fillRect(-14,-8,28,16);x.fillStyle="#111";x.fillRect(2,-2,20,4);}
    else {x.fillStyle="#333";x.fillRect(-10,-5,20,10);} return c;
};

window.createGradientTexture = function(scene) {
    const w = scene.scale.width;
    const h = scene.scale.height * 0.45;
    const c = document.createElement('canvas'); c.width=w; c.height=h; const x = c.getContext('2d');
    const grd = x.createLinearGradient(0, h, 0, 0);
    grd.addColorStop(0, "rgba(0,0,0,1)");
    grd.addColorStop(0.3, "rgba(0,0,0,0.9)");
    grd.addColorStop(0.7, "rgba(0,0,0,0.3)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = grd; x.fillRect(0, 0, w, h);
    if(scene.textures.exists('ui_gradient')) scene.textures.remove('ui_gradient');
    scene.textures.addCanvas('ui_gradient', c);
};

// ★状態管理ハブ
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
            scene: [MainScene, UIScene], 
            fps: { target: 60 }, 
            physics: { default: 'arcade', arcade: { debug: false } },
            input: { activePointers: 1 } // マルチタッチ誤爆防止
        };
        this.game = new Phaser.Game(config);
        phaserGame = this.game;
        window.addEventListener('resize', () => this.resize());
    },
    resize() { if(this.game) this.game.scale.resize(document.getElementById('game-view').clientWidth, document.getElementById('game-view').clientHeight); },
    centerOn(q, r) { const main = this.game.scene.getScene('MainScene'); if(main) main.centerCamera(q, r); },
    dealCard(type) { const ui = this.game.scene.getScene('UIScene'); if(ui && ui.scene.settings.active) ui.addCardToHand(type); },
    hexToPx(q, r) { return { x: HEX_SIZE * 3/2 * q, y: HEX_SIZE * Math.sqrt(3) * (r + q/2) }; },
    pxToHex(mx, my) { 
        const main = phaserGame.scene.getScene('MainScene'); if(!main) return {q:0, r:0}; 
        const w = main.cameras.main.getWorldPoint(mx, my); 
        return this.roundHex((2/3*w.x)/HEX_SIZE, (-1/3*w.x+Math.sqrt(3)/3*w.y)/HEX_SIZE); 
    },
    roundHex(q,r) { let rq=Math.round(q), rr=Math.round(r), rs=Math.round(-q-r); const dq=Math.abs(rq-q), dr=Math.abs(rr-r), ds=Math.abs(rs-(-q-r)); if(dq>dr&&dq>ds) rq=-rr-rs; else if(dr>ds) rr=-rq-rs; return {q:rq, r:rr}; },
    frame: 0, draw() {}
};

// ==========================================
//  CARD CLASS
// ==========================================
class Card extends Phaser.GameObjects.Container {
    constructor(scene, x, y, type) {
        super(scene, x, y);
        this.scene = scene; 
        this.cardType = type;
        
        const W = 140; const H = 200;
        this.setSize(W, H);

        // ★修正: 背景(bg)自体をインタラクティブにする
        // これで「見た目」と「判定」が完全に一致します。
        const bg = scene.add.rectangle(0, 0, W, H, 0x222222).setStrokeStyle(2, 0x555555);
        bg.setInteractive({ useHandCursor: true, draggable: true });
        
        const iconKey = `card_icon_${type}`;
        if(!scene.textures.exists(iconKey)) scene.textures.addCanvas(iconKey, window.createCardIcon(type));
        const icon = scene.add.image(0, -40, iconKey);
        const text = scene.add.text(0, 40, type.toUpperCase(), { fontSize: '16px', color: '#d84', fontStyle: 'bold' }).setOrigin(0.5);
        const desc = scene.add.text(0, 70, "DRAG TO DEPLOY", { fontSize: '10px', color: '#888' }).setOrigin(0.5);
        
        // アイコンやテキストは判定を邪魔しないようにする
        icon.disableInteractive();
        
        this.add([bg, icon, text, desc]);
        
        this.baseX = x; this.baseY = y;
        this.prevX = x;
        this.dragOffsetX = 0; this.dragOffsetY = 0;
        
        // ★重要: イベントリスナーは bg (背景) に対して設定する
        bg.on('pointerover', this.onHover, this);
        bg.on('pointerout', this.onHoverOut, this);
        bg.on('pointerdown', this.onPointerDown, this); // クリック検知用
        
        // ドラッグイベント
        bg.on('dragstart', this.onDragStart, this);
        bg.on('drag', this.onDrag, this);
        bg.on('dragend', this.onDragEnd, this);
        
        scene.add.existing(this);
    }

    onPointerDown(pointer) {
        // カードをクリックした瞬間、ログを出す（デバッグ用）
        console.log("Card Clicked:", this.cardType);
    }

    onHover() {
        // マップドラッグ中、または他のカードをドラッグ中は反応させない（カクつき防止）
        if(Renderer.isMapDragging || Renderer.isCardDragging) return;
        
        this.parentContainer.bringToTop(this);
        // this.y を動かすと判定も動くが、bgで判定しているので追従するはず。
        // ピクつき防止のため、少し控えめに動かす
        this.scene.tweens.add({ targets: this, y: this.baseY - 20, scale: 1.05, duration: 100, ease: 'Back.out' });
    }

    onHoverOut() {
        if(Renderer.isCardDragging && this.isDragging) return;
        this.scene.tweens.add({ targets: this, y: this.baseY, x: this.baseX, scale: 1.0, duration: 200, ease: 'Power2' });
    }

    onDragStart(pointer, dragX, dragY) {
        if(Renderer.isMapDragging) return; // マップ移動中は掴めない

        this.isDragging = true;
        Renderer.isCardDragging = true; // 全体に通知
        
        this.setAlpha(0.8);
        this.setScale(1.1);

        // Handコンテナから出して、UIScene直下に置く（最前面表示のため）
        const hand = this.parentContainer;
        const worldPos = hand.getLocalTransformMatrix().transformPoint(this.x, this.y);
        hand.remove(this);
        this.scene.add.existing(this);
        this.setPosition(worldPos.x, worldPos.y);
        this.setDepth(9999);

        // 掴んだ位置のオフセット計算
        this.dragOffsetX = this.x - pointer.x;
        this.dragOffsetY = this.y - pointer.y;
    }

    onDrag(pointer, dragX, dragY) {
        // bgのドラッグイベントだが、動かすのは Container (this)
        this.x = pointer.x + this.dragOffsetX;
        this.y = pointer.y + this.dragOffsetY;

        // 慣性（揺れ）
        const dx = this.x - this.prevX;
        const targetAngle = Phaser.Math.Clamp(dx * 1.5, -20, 20);
        this.angle += (targetAngle - this.angle) * 0.2;
        this.prevX = this.x;

        // ドロップ候補ハイライト (MainSceneへ通知)
        const main = this.scene.game.scene.getScene('MainScene');
        if (this.y < this.scene.scale.height * 0.65) {
             const hex = Renderer.pxToHex(pointer.x, pointer.y);
             main.dragHighlightHex = hex;
        } else {
             main.dragHighlightHex = null;
        }
    }

    onDragEnd(pointer) {
        this.isDragging = false;
        Renderer.isCardDragging = false; // ドラッグ終了
        this.setAlpha(1.0);
        this.angle = 0;
        
        const main = this.scene.game.scene.getScene('MainScene');
        if(main) main.dragHighlightHex = null;

        // ドロップ判定
        if (this.y < this.scene.scale.height * 0.65 && window.gameLogic) {
             const hex = Renderer.pxToHex(pointer.x, pointer.y);
             console.log(`Card dropped at: ${hex.q}, ${hex.r}`);
             // TODO: 配置ロジック
             this.returnToHand(); 
        } else {
             this.returnToHand();
        }
    }

    returnToHand() {
        const hand = this.scene.handContainer;
        const targetX = hand.x + this.baseX;
        const targetY = hand.y + this.baseY;
        
        this.scene.tweens.add({
            targets: this,
            x: targetX, y: targetY, angle: 0, scale: 1.0,
            duration: 300, ease: 'Back.out',
            onComplete: () => {
                this.scene.children.remove(this);
                hand.add(this); // 元の場所へ
                this.setPosition(this.baseX, this.baseY);
                this.setDepth(0);
            }
        });
    }
}

// ==========================================
//  UI SCENE
// ==========================================
class UIScene extends Phaser.Scene {
    constructor() { super({ key: 'UIScene', active: false }); this.cards=[]; this.handContainer=null; }
    
    create() {
        const w = this.scale.width;
        const h = this.scale.height;

        window.createGradientTexture(this);
        this.add.image(w/2, h, 'ui_gradient').setOrigin(0.5, 1).setDepth(0).setDisplaySize(w, h*0.45);

        this.handContainer = this.add.container(w/2, h);
        
        // カード配るテスト
        this.time.delayedCall(500, ()=>{ ['infantry','tank','heal','infantry','tiger'].forEach(t => this.addCardToHand(t)); });
    }

    addCardToHand(type) {
        const card = new Card(this, 0, 200, type); 
        this.handContainer.add(card);
        this.cards.push(card);
        this.arrangeHand();
    }

    arrangeHand() {
        const total = this.cards.length;
        const centerIdx = (total - 1) / 2;
        const spacing = 160; 

        this.cards.forEach((card, i) => {
            const offset = i - centerIdx;
            const targetX = offset * spacing;
            const targetY = -120;
            
            card.baseX = targetX; card.baseY = targetY;
            this.tweens.add({ targets: card, x: targetX, y: targetY, angle: 0, duration: 400, ease: 'Back.out' });
        });
    }
}

// ==========================================
//  MAIN SCENE
// ==========================================
class MainScene extends Phaser.Scene {
    constructor() { super({ key: 'MainScene' }); this.hexGroup=null; this.unitGroup=null; this.vfxGraphics=null; this.overlayGraphics=null; this.mapGenerated=false; this.dragHighlightHex=null; }

    preload() {
        const g = this.make.graphics({x:0, y:0, add:false});
        g.lineStyle(2, 0x888888, 1); g.fillStyle(0xffffff, 1); g.beginPath();
        for(let i=0; i<6; i++) { const a = Math.PI/180 * 60 * i; g.lineTo(HEX_SIZE+HEX_SIZE*Math.cos(a), HEX_SIZE+HEX_SIZE*Math.sin(a)); }
        g.closePath(); g.fillPath(); g.strokePath(); g.generateTexture('hex_base', HEX_SIZE*2, HEX_SIZE*2);
        g.clear(); g.fillStyle(0x00ff00, 1); g.fillCircle(16, 16, 10); g.generateTexture('unit_player', 32, 32);
        g.clear(); g.fillStyle(0xff0000, 1); g.fillRect(4, 4, 24, 24); g.generateTexture('unit_enemy', 32, 32);
        g.clear(); g.lineStyle(3, 0x00ff00, 1); g.strokeCircle(32, 32, 28); g.generateTexture('cursor', 64, 64);
    }

    create() {
        this.cameras.main.setBackgroundColor('#0b0e0a');
        this.hexGroup = this.add.group(); this.unitGroup = this.add.group();
        this.vfxGraphics = this.add.graphics().setDepth(100);
        this.overlayGraphics = this.add.graphics().setDepth(50);
        
        this.scene.launch('UIScene'); 

        // --- マップ操作ハンドリング ---
        this.input.on('pointerdown', (p) => {
            // カードドラッグ中は無視
            if (Renderer.isCardDragging) return;

            // ★重要: カードの上をクリックしたかどうかを判定
            // UIScene側のポインタ位置にあるオブジェクトを取得し、あればマップ操作をキャンセル
            const uiScene = this.scene.get('UIScene');
            // UISceneのカメラで、現在のマウス位置にあるオブジェクトを探す
            // (注: UISceneはスクロールしないので p.x, p.y そのままでOK)
            const objectsUnderPointer = uiScene.input.hitTestPointer(p);

            if (objectsUnderPointer.length > 0) {
                // カードの上なのでマップ操作はしない
                return;
            }

            // カード以外ならマップ操作
            if(p.button === 0) {
                Renderer.isMapDragging = true;
                if(window.gameLogic) window.gameLogic.handleClick(Renderer.pxToHex(p.x, p.y));
            }
            else if(p.button === 2) {
                if(window.gameLogic) window.gameLogic.showContext(p.x, p.y);
            }
        });

        this.input.on('pointerup', () => {
            Renderer.isMapDragging = false;
        });
        
        this.input.on('pointermove', (p) => {
            if (Renderer.isCardDragging) return;

            // マップドラッグ中
            if (p.isDown && Renderer.isMapDragging) {
                this.cameras.main.scrollX -= (p.x - p.prevPosition.x); 
                this.cameras.main.scrollY -= (p.y - p.prevPosition.y);
            }
            
            // マップドラッグ中でなければホバー処理
            if(!Renderer.isMapDragging && window.gameLogic) {
                window.gameLogic.handleHover(Renderer.pxToHex(p.x, p.y));
            }
        });
        this.input.mouse.disableContextMenu();
    }

    centerCamera(q, r) { const p = Renderer.hexToPx(q, r); this.cameras.main.centerOn(p.x, p.y); }

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

        this.overlayGraphics.clear();
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
}

const Sfx = { play(id){} };
const VFX = { /* (前回と同じ) */
    particles:[], projectiles:[], 
    add(p){this.particles.push(p);}, addProj(p){this.projectiles.push(p);},
    addExplosion(x,y,c,n){for(let i=0;i<n;i++){const a=Math.random()*6.28,s=Math.random()*5+1;this.add({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:30+Math.random()*20,maxLife:50,color:c,size:2,type:'s'});}},
    addUnitDebris(x,y){}, update(){ this.particles.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.life--;}); this.projectiles.forEach(p=>{if(p.type.includes('shell')||p.type==='rocket'){p.progress+=p.speed;if(p.progress>=1){p.dead=true;p.onHit();return;}const lx=p.sx+(p.ex-p.sx)*p.progress,ly=p.sy+(p.ey-p.sy)*p.progress,a=Math.sin(p.progress*Math.PI)*p.arcHeight;p.x=lx;p.y=ly-a;}else{p.x+=p.vx;p.y+=p.vy;p.life--;if(p.life<=0){p.dead=true;p.onHit();}}}); this.particles=this.particles.filter(p=>p.life>0); this.projectiles=this.projectiles.filter(p=>!p.dead); }, draw(g){ this.projectiles.forEach(p=>{g.fillStyle(0xffff00,1); g.fillCircle(p.x,p.y,3);}); this.particles.forEach(p=>{g.fillStyle(p.color==='#fa0'?0xffaa00:0xffffff, p.life/p.maxLife); g.fillCircle(p.x,p.y,p.size);}); }
};

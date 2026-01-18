/** * PHASER BRIDGE (Multi-Scene UI Architecture) */
let phaserGame = null; // ゲームインスタンス

// カード画像生成
window.createCardIcon = function(type) {
    const c=document.createElement('canvas');c.width=100;c.height=60;const x=c.getContext('2d');x.translate(50,30);x.scale(2,2);
    if(type==='infantry'){x.fillStyle="#444";x.fillRect(-15,0,30,4);x.fillStyle="#642";x.fillRect(-15,0,10,4);}
    else if(type==='tank'){x.fillStyle="#444";x.fillRect(-12,-6,24,12);x.fillStyle="#222";x.fillRect(0,-2,16,4);}
    else if(type==='heal'){x.fillStyle="#eee";x.fillRect(-10,-8,20,16);x.fillStyle="#d00";x.fillRect(-3,-6,6,12);x.fillRect(-8,-1,16,2);}
    else if(type==='tiger'){x.fillStyle="#554";x.fillRect(-14,-8,28,16);x.fillStyle="#111";x.fillRect(2,-2,20,4);}
    else {x.fillStyle="#333";x.fillRect(-10,-5,20,10);} return c;
};

// グラデーションテクスチャ生成
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

const Renderer = {
    game: null,
    init(canvasElement) {
        const config = { 
            type: Phaser.AUTO, 
            parent: 'game-view', 
            width: document.getElementById('game-view').clientWidth, 
            height: document.getElementById('game-view').clientHeight, 
            backgroundColor: '#0b0e0a', 
            // ★重要: メインシーンとUIシーンの2枚重ね
            scene: [MainScene, UIScene], 
            fps: { target: 60 }, 
            physics: { default: 'arcade', arcade: { debug: false } } 
        };
        this.game = new Phaser.Game(config);
        phaserGame = this.game;
        window.addEventListener('resize', () => this.resize());
    },
    resize() { if(this.game) this.game.scale.resize(document.getElementById('game-view').clientWidth, document.getElementById('game-view').clientHeight); },
    centerOn(q, r) { 
        const main = this.game.scene.getScene('MainScene');
        if(main) main.centerCamera(q, r); 
    },
    // UIシーンに対してカードを配る
    dealCard(type) { 
        const ui = this.game.scene.getScene('UIScene');
        if(ui && ui.scene.settings.active) ui.addCardToHand(type); 
    },
    hexToPx(q, r) { return { x: HEX_SIZE * 3/2 * q, y: HEX_SIZE * Math.sqrt(3) * (r + q/2) }; },
    
    // 画面座標(mx, my)をメインシーンのカメラでワールド座標に変換して計算
    pxToHex(mx, my) { 
        const main = phaserGame.scene.getScene('MainScene');
        if(!main) return {q:0, r:0}; 
        const w = main.cameras.main.getWorldPoint(mx, my); 
        return this.roundHex((2/3*w.x)/HEX_SIZE, (-1/3*w.x+Math.sqrt(3)/3*w.y)/HEX_SIZE); 
    },
    roundHex(q,r) { let rq=Math.round(q), rr=Math.round(r), rs=Math.round(-q-r); const dq=Math.abs(rq-q), dr=Math.abs(rr-r), ds=Math.abs(rs-(-q-r)); if(dq>dr&&dq>ds) rq=-rr-rs; else if(dr>ds) rr=-rq-rs; return {q:rq, r:rr}; },
    frame: 0, draw() {}
};

// ==========================================
//  CARD CLASS (UI Scene専用)
// ==========================================
class Card extends Phaser.GameObjects.Container {
    constructor(scene, x, y, type) {
        super(scene, x, y);
        this.scene = scene; // これはUIScene
        this.cardType = type;
        
        const W = 140; const H = 200;
        this.setSize(W, H);

        // 背景
        const bg = scene.add.rectangle(0, 0, W, H, 0x222222).setStrokeStyle(2, 0x555555);
        // ★修正: HitAreaを正確に設定。Container自身にセットする
        this.setInteractive(new Phaser.Geom.Rectangle(-W/2, -H/2, W, H), Phaser.Geom.Rectangle.Contains, { draggable: true });

        const iconKey = `card_icon_${type}`;
        if(!scene.textures.exists(iconKey)) scene.textures.addCanvas(iconKey, window.createCardIcon(type));
        const icon = scene.add.image(0, -40, iconKey);
        const text = scene.add.text(0, 40, type.toUpperCase(), { fontSize: '16px', color: '#d84', fontStyle: 'bold' }).setOrigin(0.5);
        const desc = scene.add.text(0, 70, "DRAG TO DEPLOY", { fontSize: '10px', color: '#888' }).setOrigin(0.5);
        
        this.add([bg, icon, text, desc]);
        
        this.baseX = x; this.baseY = y;
        this.prevX = x;
        this.dragOffsetX = 0;
        this.dragOffsetY = 0;

        this.on('pointerover', this.onHover, this);
        this.on('pointerout', this.onHoverOut, this);
        this.on('dragstart', this.onDragStart, this);
        this.on('drag', this.onDrag, this);
        this.on('dragend', this.onDragEnd, this);
        
        scene.add.existing(this);
    }

    onHover() {
        // ドラッグ中や、他のカードをドラッグ中は反応させない
        if(this.isDragging || this.scene.isDraggingAnyCard) return;
        this.parentContainer.bringToTop(this); // 手札内で最前面へ
        this.scene.tweens.add({ targets: this, y: this.baseY - 30, scale: 1.1, duration: 150, ease: 'Back.out' });
    }

    onHoverOut() {
        if(this.isDragging || this.scene.isDraggingAnyCard) return;
        this.scene.tweens.add({ targets: this, y: this.baseY, x: this.baseX, scale: 1.0, duration: 200, ease: 'Power2' });
    }

    onDragStart(pointer) {
        this.isDragging = true;
        this.scene.isDraggingAnyCard = true; // シーン全体でドラッグ中フラグを立てる
        this.setAlpha(0.8);
        this.setScale(1.1);
        
        // コンテナから一時的に出して、UIScene直下に置く（座標変換して位置を維持）
        // ※これをしないと、HandContainerの並び順の影響を受けてしまう
        const hand = this.parentContainer;
        const worldPos = hand.getLocalTransformMatrix().transformPoint(this.x, this.y);
        
        hand.remove(this);
        this.scene.add.existing(this);
        this.setPosition(worldPos.x, worldPos.y);
        this.setDepth(9999); // 最前面

        // 掴んだ位置のオフセット計算
        this.dragOffsetX = this.x - pointer.x;
        this.dragOffsetY = this.y - pointer.y;
    }

    onDrag(pointer) {
        // オフセット込みで追従（吊り下げ挙動）
        this.x = pointer.x + this.dragOffsetX;
        this.y = pointer.y + this.dragOffsetY;

        // 慣性（揺れ）
        const dx = this.x - this.prevX;
        const targetAngle = Phaser.Math.Clamp(dx * 1.5, -20, 20);
        this.angle += (targetAngle - this.angle) * 0.2;
        this.prevX = this.x;

        // ドロップ候補ハイライト (MainSceneに通知)
        const main = this.scene.game.scene.getScene('MainScene');
        if (this.y < this.scene.scale.height * 0.65) {
             const hex = Renderer.pxToHex(pointer.x, pointer.y); // マウス位置からHex計算
             main.dragHighlightHex = hex;
        } else {
             main.dragHighlightHex = null;
        }
    }

    onDragEnd(pointer) {
        this.isDragging = false;
        this.scene.isDraggingAnyCard = false;
        this.setAlpha(1.0);
        this.angle = 0;
        
        const main = this.scene.game.scene.getScene('MainScene');
        main.dragHighlightHex = null;

        const dropZoneY = this.scene.scale.height * 0.65;
        // マップ領域でドロップ
        if (this.y < dropZoneY && window.gameLogic) {
             const hex = Renderer.pxToHex(pointer.x, pointer.y);
             console.log(`Card dropped at: ${hex.q}, ${hex.r}`);
             // ★TODO: ここで配置ロジックを呼ぶ
             this.returnToHand(); 
        } else {
             this.returnToHand();
        }
    }

    returnToHand() {
        // 元のHandContainer内の座標へ戻るアニメーション
        const hand = this.scene.handContainer;
        // HandContainerのワールド座標
        const targetX = hand.x + this.baseX;
        const targetY = hand.y + this.baseY;
        
        this.scene.tweens.add({
            targets: this,
            x: targetX, y: targetY, angle: 0, scale: 1.0,
            duration: 300, ease: 'Back.out',
            onComplete: () => {
                // コンテナに戻す
                this.scene.children.remove(this);
                hand.add(this);
                this.setPosition(this.baseX, this.baseY);
                this.setDepth(0); // 深度リセット
            }
        });
    }
}

// ==========================================
//  UI SCENE (動かない手札レイヤー)
// ==========================================
class UIScene extends Phaser.Scene {
    constructor() { super({ key: 'UIScene', active: false }); this.cards=[]; this.handContainer=null; this.isDraggingAnyCard=false; }
    
    create() {
        const w = this.scale.width;
        const h = this.scale.height;

        // グラデーション背景
        window.createGradientTexture(this);
        this.add.image(w/2, h, 'ui_gradient').setOrigin(0.5, 1).setDepth(0).setDisplaySize(w, h*0.45);

        // 手札コンテナ (画面下中央)
        this.handContainer = this.add.container(w/2, h);
        
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
        const spacing = 160; 

        this.cards.forEach((card, i) => {
            const offset = i - centerIdx;
            const targetX = offset * spacing;
            const targetY = -120; // 画面下からの高さ固定
            
            card.baseX = targetX; card.baseY = targetY;
            
            // アニメーション (コンテナ内のローカル座標移動)
            this.tweens.add({ targets: card, x: targetX, y: targetY, angle: 0, duration: 400, ease: 'Back.out' });
        });
    }
}

// ==========================================
//  MAIN SCENE (動くマップレイヤー)
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
        
        // ★重要: UIシーンを起動して重ねる
        this.scene.launch('UIScene');

        // --- 入力ハンドリング (マップ操作のみ) ---
        const uiScene = this.scene.get('UIScene'); // UIの状態を参照するため

        this.input.on('pointerdown', (p) => {
            // UI側でカードをドラッグ中、またはUIエリア(画面下部)をクリックした場合は反応しない
            // 簡易的に画面Y座標で判定 (UIシーンの背景があるエリア)
            if (uiScene.isDraggingAnyCard || p.y > this.scale.height * 0.6) return;

            if(p.button === 0) {
                if(window.gameLogic) window.gameLogic.handleClick(Renderer.pxToHex(p.x, p.y));
            }
            else if(p.button === 2) {
                if(window.gameLogic) window.gameLogic.showContext(p.x, p.y);
            }
        });
        
        this.input.on('pointermove', (p) => {
            // UIでカードドラッグ中はカメラを動かさない
            if (uiScene.isDraggingAnyCard) return;

            // マップ移動
            if (p.isDown) {
                // UIエリア(下部)からのドラッグ開始でなければ移動許可
                // startPointがない場合は今の位置で判定
                const startY = p.downY; 
                if (startY < this.scale.height * 0.6) {
                    this.cameras.main.scrollX -= (p.x - p.prevPosition.x); 
                    this.cameras.main.scrollY -= (p.y - p.prevPosition.y);
                }
            }
            
            if(window.gameLogic) window.gameLogic.handleHover(Renderer.pxToHex(p.x, p.y));
        });
        this.input.mouse.disableContextMenu();
    }

    centerCamera(q, r) { const p = Renderer.hexToPx(q, r); this.cameras.main.centerOn(p.x, p.y); }

    update(time, delta) {
        if (!window.gameLogic) return;
        VFX.update(); this.vfxGraphics.clear(); VFX.draw(this.vfxGraphics);
        if (window.gameLogic.map.length > 0 && !this.mapGenerated) { this.createMap(); this.mapGenerated = true; }
        
        // ユニット同期
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
        
        // ドロップ候補ハイライト (UIシーンからdragHighlightHexを受け取って描画)
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

/** * PHASER BRIDGE (Physics Spring Card & High-Res Map) */
let phaserGame = null;

// --- 定数設定 ---
const HIGH_RES_SCALE = 4; // テクスチャ生成倍率（4倍で描いて1/4で表示＝高精細）

// カード画像生成 (高解像度版)
window.createCardIcon = function(type) {
    const w = 100 * HIGH_RES_SCALE;
    const h = 60 * HIGH_RES_SCALE;
    const c = document.createElement('canvas'); c.width=w; c.height=h; 
    const x = c.getContext('2d');
    
    x.scale(HIGH_RES_SCALE, HIGH_RES_SCALE); // 描画コンテキストをスケール
    x.translate(50, 30); x.scale(2,2);
    
    if(type==='infantry'){x.fillStyle="#444";x.fillRect(-15,0,30,4);x.fillStyle="#642";x.fillRect(-15,0,10,4);}
    else if(type==='tank'){x.fillStyle="#444";x.fillRect(-12,-6,24,12);x.fillStyle="#222";x.fillRect(0,-2,16,4);}
    else if(type==='heal'){x.fillStyle="#eee";x.fillRect(-10,-8,20,16);x.fillStyle="#d00";x.fillRect(-3,-6,6,12);x.fillRect(-8,-1,16,2);}
    else if(type==='tiger'){x.fillStyle="#554";x.fillRect(-14,-8,28,16);x.fillStyle="#111";x.fillRect(2,-2,20,4);}
    else {x.fillStyle="#333";x.fillRect(-10,-5,20,10);} 
    return c;
};

// グラデーション生成
window.createGradientTexture = function(scene) {
    const w = scene.scale.width;
    const h = scene.scale.height * 0.45;
    const c = document.createElement('canvas'); c.width=w; c.height=h; const x = c.getContext('2d');
    const grd = x.createLinearGradient(0, h, 0, 0);
    grd.addColorStop(0, "rgba(0,0,0,1)");
    grd.addColorStop(0.4, "rgba(0,0,0,0.8)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = grd; x.fillRect(0, 0, w, h);
    if(scene.textures.exists('ui_gradient')) scene.textures.remove('ui_gradient');
    scene.textures.addCanvas('ui_gradient', c);
};

// ★状態管理
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
            input: { activePointers: 1 }
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
//  CARD CLASS (Physics Based)
// ==========================================
class Card extends Phaser.GameObjects.Container {
    constructor(scene, x, y, type) {
        super(scene, x, y);
        this.scene = scene; 
        this.cardType = type;
        
        const W = 140; const H = 200;
        this.setSize(W, H);

        // 背景
        const bg = scene.add.rectangle(0, 0, W, H, 0x222222).setStrokeStyle(2, 0x555555);
        bg.setInteractive({ useHandCursor: true, draggable: true });
        
        // アイコン (高解像度版を縮小表示)
        const iconKey = `card_icon_${type}`;
        if(!scene.textures.exists(iconKey)) scene.textures.addCanvas(iconKey, window.createCardIcon(type));
        const icon = scene.add.image(0, -40, iconKey).setScale(1/HIGH_RES_SCALE); // 1/4に縮小
        
        const text = scene.add.text(0, 40, type.toUpperCase(), { fontSize: '16px', color: '#d84', fontStyle: 'bold' }).setOrigin(0.5);
        const desc = scene.add.text(0, 70, "DRAG TO DEPLOY", { fontSize: '10px', color: '#888' }).setOrigin(0.5);
        
        icon.disableInteractive();
        this.add([bg, icon, text, desc]);
        
        this.setScrollFactor(0);
        
        // --- 物理演算用パラメータ ---
        this.baseX = x; this.baseY = y; // 手札内での定位置
        
        // 現在の物理的な位置（慣性計算用）
        this.physX = x; this.physY = y;
        this.velocityX = 0; this.velocityY = 0;
        this.velocityAngle = 0;
        
        // ドラッグ目標地点
        this.targetX = x; this.targetY = y;
        this.dragOffsetX = 0; this.dragOffsetY = 0;
        
        // イベント
        bg.on('pointerover', this.onHover, this);
        bg.on('pointerout', this.onHoverOut, this);
        bg.on('dragstart', this.onDragStart, this);
        bg.on('drag', this.onDrag, this);
        bg.on('dragend', this.onDragEnd, this);
        
        scene.add.existing(this);
    }

    // ★心臓部: 物理シミュレーション (毎フレーム実行)
    updatePhysics() {
        if (!this.isDragging && !this.scene.isReturning) {
            // ドラッグしていない時: 定位置(baseX, baseY)に戻ろうとする
            this.targetX = this.baseX;
            this.targetY = this.baseY - (this.isHovering ? 40 : 0); // ホバー時は少し上
        }

        // 1. 位置のバネ挙動 (Spring)
        const stiffness = this.isDragging ? 0.2 : 0.15; // ドラッグ中は追従性を高く、離したらゆるく
        const damping = 0.75; // 減衰率

        const ax = (this.targetX - this.physX) * stiffness;
        const ay = (this.targetY - this.physY) * stiffness;

        this.velocityX += ax;
        this.velocityY += ay;
        this.velocityX *= damping;
        this.velocityY *= damping;

        this.physX += this.velocityX;
        this.physY += this.velocityY;

        // 実際に表示位置を更新
        this.setPosition(this.physX, this.physY);

        // 2. 角度の振り子挙動 (Pendulum)
        // 横移動の加速度に応じて傾く
        const targetAngle = -this.velocityX * 1.5; // 逆方向に傾く
        
        // 角度を戻そうとする力 + 揺れ
        const angleForce = (targetAngle - this.angle) * 0.1;
        this.velocityAngle += angleForce;
        this.velocityAngle *= 0.85; // 減衰

        this.angle += this.velocityAngle;
        this.angle = Phaser.Math.Clamp(this.angle, -35, 35); // 角度制限
    }

    onHover() {
        if(Renderer.isMapDragging || Renderer.isCardDragging) return;
        this.isHovering = true;
        this.parentContainer.bringToTop(this);
    }

    onHoverOut() {
        this.isHovering = false;
    }

    onDragStart(pointer) {
        if(Renderer.isMapDragging) return;

        this.isDragging = true;
        Renderer.isCardDragging = true;
        this.setAlpha(0.8);
        this.setScale(1.1);

        // コンテナから出してUIScene直下に置く
        const hand = this.parentContainer;
        const worldPos = hand.getLocalTransformMatrix().transformPoint(this.x, this.y);
        hand.remove(this);
        this.scene.add.existing(this);
        
        // 物理座標を引き継ぐ
        this.physX = worldPos.x;
        this.physY = worldPos.y;
        this.targetX = this.physX;
        this.targetY = this.physY;
        this.setDepth(9999);

        // 掴んだ場所のオフセット
        this.dragOffsetX = this.physX - pointer.x;
        this.dragOffsetY = this.physY - pointer.y;
    }

    onDrag(pointer) {
        // マウスの位置を「目標地点」にする（直接代入しない！）
        this.targetX = pointer.x + this.dragOffsetX;
        this.targetY = pointer.y + this.dragOffsetY;

        // ドロップハイライト
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
        Renderer.isCardDragging = false;
        this.setAlpha(1.0);
        this.setScale(1.0);
        
        const main = this.scene.game.scene.getScene('MainScene');
        if(main) main.dragHighlightHex = null;

        const dropZoneY = this.scene.scale.height * 0.65;
        if (this.y < dropZoneY && window.gameLogic) {
             const hex = Renderer.pxToHex(pointer.x, pointer.y);
             console.log(`Card dropped at: ${hex.q}, ${hex.r}`);
             this.returnToHand(); 
        } else {
             this.returnToHand();
        }
    }

    returnToHand() {
        // コンテナに戻す
        const hand = this.scene.handContainer;
        this.scene.children.remove(this);
        hand.add(this); 
        this.setDepth(0);
        
        // 物理座標をコンテナ内のローカル座標に変換して維持する
        // これで「吹っ飛び」がなくなる
        this.physX = this.x; 
        this.physY = this.y;
        
        // 目標地点を定位置に戻す（あとは物理演算が勝手にアニメーションしてくれる）
        this.targetX = this.baseX;
        this.targetY = this.baseY;
        
        // 戻る瞬間に少し跳ねさせる演出
        this.velocityY = 15; 
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
        
        this.time.delayedCall(500, ()=>{ ['infantry','tank','heal','infantry','tiger'].forEach(t => this.addCardToHand(t)); });
    }

    update(time, delta) {
        // 全カードの物理更新
        this.cards.forEach(card => card.updatePhysics());
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
            // 定位置(baseX)を更新するだけで、あとは物理演算がそこへ移動してくれる
            card.baseX = offset * spacing;
            card.baseY = -120;
        });
    }
}

// ==========================================
//  MAIN SCENE (High-Res Map)
// ==========================================
class MainScene extends Phaser.Scene {
    constructor() { super({ key: 'MainScene' }); this.hexGroup=null; this.unitGroup=null; this.vfxGraphics=null; this.overlayGraphics=null; this.mapGenerated=false; this.dragHighlightHex=null; }

    preload() {
        const g = this.make.graphics({x:0, y:0, add:false});
        
        // ★高解像度テクスチャ生成 (4倍サイズで描画)
        const S = HEX_SIZE * HIGH_RES_SCALE; 
        
        // 1. Hexagon
        g.lineStyle(2 * HIGH_RES_SCALE, 0x888888, 1); 
        g.fillStyle(0xffffff, 1); 
        g.beginPath();
        for(let i=0; i<6; i++) { 
            const a = Math.PI/180 * 60 * i; 
            g.lineTo(S + S * Math.cos(a), S + S * Math.sin(a)); 
        }
        g.closePath(); g.fillPath(); g.strokePath(); 
        g.generateTexture('hex_base', S*2, S*2);
        
        // 2. Unit & Cursor
        g.clear(); g.fillStyle(0x00ff00, 1); g.fillCircle(16*HIGH_RES_SCALE, 16*HIGH_RES_SCALE, 12*HIGH_RES_SCALE); g.generateTexture('unit_player', 32*HIGH_RES_SCALE, 32*HIGH_RES_SCALE);
        g.clear(); g.fillStyle(0xff0000, 1); g.fillRect(4*HIGH_RES_SCALE, 4*HIGH_RES_SCALE, 24*HIGH_RES_SCALE, 24*HIGH_RES_SCALE); g.generateTexture('unit_enemy', 32*HIGH_RES_SCALE, 32*HIGH_RES_SCALE);
        g.clear(); g.lineStyle(3*HIGH_RES_SCALE, 0x00ff00, 1); g.strokeCircle(32*HIGH_RES_SCALE, 32*HIGH_RES_SCALE, 28*HIGH_RES_SCALE); g.generateTexture('cursor', 64*HIGH_RES_SCALE, 64*HIGH_RES_SCALE);
    }

    create() {
        this.cameras.main.setBackgroundColor('#0b0e0a');
        this.hexGroup = this.add.group(); this.unitGroup = this.add.group();
        this.vfxGraphics = this.add.graphics().setDepth(100);
        this.overlayGraphics = this.add.graphics().setDepth(50);
        
        this.scene.launch('UIScene'); 

        // --- マウスホイール: ズーム (感度アップ) ---
        this.input.on('wheel', (pointer, gameObjects, deltaX, deltaY, deltaZ) => {
            let newZoom = this.cameras.main.zoom;
            // ★感度調整: 0.1 -> 0.3 にアップ
            if (deltaY > 0) newZoom -= 0.3;
            else if (deltaY < 0) newZoom += 0.3;
            newZoom = Phaser.Math.Clamp(newZoom, 0.25, 4.0);
            
            this.tweens.add({ targets: this.cameras.main, zoom: newZoom, duration: 150, ease: 'Cubic.out' });
        });

        // --- マップ操作 ---
        this.input.on('pointerdown', (p) => {
            if (Renderer.isCardDragging) return;
            const uiScene = this.scene.get('UIScene');
            const objectsUnderPointer = uiScene.input.hitTestPointer(p);
            if (objectsUnderPointer.length > 0) return;

            if(p.button === 0) {
                Renderer.isMapDragging = true;
                if(window.gameLogic) window.gameLogic.handleClick(Renderer.pxToHex(p.x, p.y));
            }
            else if(p.button === 2) {
                if(window.gameLogic) window.gameLogic.showContext(p.x, p.y);
            }
        });

        this.input.on('pointerup', () => { Renderer.isMapDragging = false; });
        
        this.input.on('pointermove', (p) => {
            if (Renderer.isCardDragging) return;
            if (p.isDown && Renderer.isMapDragging) {
                const zoom = this.cameras.main.zoom;
                this.cameras.main.scrollX -= (p.x - p.prevPosition.x) / zoom;
                this.cameras.main.scrollY -= (p.y - p.prevPosition.y) / zoom;
            }
            if(!Renderer.isMapDragging && window.gameLogic) {
                window.gameLogic.handleHover(Renderer.pxToHex(p.x, p.y));
            }
        });
        this.input.mouse.disableContextMenu();
    }

    centerCamera(q, r) { const p = Renderer.hexToPx(q, r); this.cameras.main.centerOn(p.x, p.y); }

    // ★Map生成時に高解像度テクスチャを縮小表示
    createMap() { 
        const map = window.gameLogic.map; 
        for(let q=0; q<MAP_W; q++) { 
            for(let r=0; r<MAP_H; r++) { 
                const t = map[q][r]; if(t.id===-1)continue; 
                const pos = Renderer.hexToPx(q, r); 
                
                // 1/4サイズで表示＝見た目は同じだが密度4倍
                const hex = this.add.image(pos.x, pos.y, 'hex_base').setScale(1/HIGH_RES_SCALE); 
                
                let tint = 0x555555; 
                if(t.id===0)tint=0x5a5245; else if(t.id===1)tint=0x425030; else if(t.id===2)tint=0x222e1b; else if(t.id===4)tint=0x504540; else if(t.id===5)tint=0x303840; 
                hex.setTint(tint); 
                if(t.id===2) { const tr=this.add.circle(pos.x, pos.y, HEX_SIZE*0.6, 0x112211, 0.5); this.hexGroup.add(tr); } 
                this.hexGroup.add(hex); 
            } 
        } 
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
            // ユニット画像も高解像度版を縮小
            const sprite = this.add.sprite(0, 0, u.team==='player'?'unit_player':'unit_enemy').setScale(1/HIGH_RES_SCALE);
            if(u.def.isTank) sprite.setTint(0x888888); if(u.team==='player') sprite.setTint(0x6688aa); else sprite.setTint(0xcc6655);
            container.add(sprite);
            const hpPct = u.hp / u.maxHp;
            container.add([this.add.rectangle(0, -20, 20, 4, 0x000000), this.add.rectangle(-10+(10*hpPct), -20, 20*hpPct, 4, hpPct>0.5?0x00ff00:0xff0000)]);
            if(window.gameLogic.selectedUnit === u) {
                const c = this.add.image(0, 0, 'cursor').setScale(1/HIGH_RES_SCALE);
                this.tweens.add({ targets: c, scale: { from: 1/HIGH_RES_SCALE, to: 1.1/HIGH_RES_SCALE }, alpha: { from: 1, to: 0.5 }, yoyo: true, repeat: -1, duration: 800 });
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
}

const Sfx = { play(id){} };
const VFX = { /* (前回と同じ) */
    particles:[], projectiles:[], 
    add(p){this.particles.push(p);}, addProj(p){this.projectiles.push(p);},
    addExplosion(x,y,c,n){for(let i=0;i<n;i++){const a=Math.random()*6.28,s=Math.random()*5+1;this.add({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:30+Math.random()*20,maxLife:50,color:c,size:2,type:'s'});}},
    addUnitDebris(x,y){}, update(){ this.particles.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.life--;}); this.projectiles.forEach(p=>{if(p.type.includes('shell')||p.type==='rocket'){p.progress+=p.speed;if(p.progress>=1){p.dead=true;p.onHit();return;}const lx=p.sx+(p.ex-p.sx)*p.progress,ly=p.sy+(p.ey-p.sy)*p.progress,a=Math.sin(p.progress*Math.PI)*p.arcHeight;p.x=lx;p.y=ly-a;}else{p.x+=p.vx;p.y+=p.vy;p.life--;if(p.life<=0){p.dead=true;p.onHit();}}}); this.particles=this.particles.filter(p=>p.life>0); this.projectiles=this.projectiles.filter(p=>!p.dead); }, draw(g){ this.projectiles.forEach(p=>{g.fillStyle(0xffff00,1); g.fillCircle(p.x,p.y,3);}); this.particles.forEach(p=>{g.fillStyle(p.color==='#fa0'?0xffaa00:0xffffff, p.life/p.maxLife); g.fillCircle(p.x,p.y,p.size);}); }
};

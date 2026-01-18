/** * PHASER BRIDGE (Burning Mask VFX & Physics) */
let phaserGame = null;

const HIGH_RES_SCALE = 4; 

// --- ユーティリティ ---
window.createCardIcon = function(type) {
    const w = 100 * HIGH_RES_SCALE; const h = 60 * HIGH_RES_SCALE;
    const c = document.createElement('canvas'); c.width=w; c.height=h; const x = c.getContext('2d');
    x.scale(HIGH_RES_SCALE, HIGH_RES_SCALE); x.translate(50, 30); x.scale(2,2);
    if(type==='infantry'){x.fillStyle="#444";x.fillRect(-15,0,30,4);x.fillStyle="#642";x.fillRect(-15,0,10,4);}
    else if(type==='tank'){x.fillStyle="#444";x.fillRect(-12,-6,24,12);x.fillStyle="#222";x.fillRect(0,-2,16,4);}
    else if(type==='heal'){x.fillStyle="#eee";x.fillRect(-10,-8,20,16);x.fillStyle="#d00";x.fillRect(-3,-6,6,12);x.fillRect(-8,-1,16,2);}
    else if(type==='tiger'){x.fillStyle="#554";x.fillRect(-14,-8,28,16);x.fillStyle="#111";x.fillRect(2,-2,20,4);}
    else {x.fillStyle="#333";x.fillRect(-10,-5,20,10);} return c;
};

window.createGradientTexture = function(scene) {
    const w = scene.scale.width; const h = scene.scale.height * 0.45;
    const c = document.createElement('canvas'); c.width=w; c.height=h; const x = c.getContext('2d');
    const grd = x.createLinearGradient(0, h, 0, 0);
    grd.addColorStop(0, "rgba(0,0,0,1)"); grd.addColorStop(0.4, "rgba(0,0,0,0.8)"); grd.addColorStop(1, "rgba(0,0,0,0)");
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
            type: Phaser.AUTO, parent: 'game-view', 
            width: document.getElementById('game-view').clientWidth, height: document.getElementById('game-view').clientHeight, 
            backgroundColor: '#0b0e0a', scene: [MainScene, UIScene], 
            fps: { target: 60 }, physics: { default: 'arcade', arcade: { debug: false } },
            input: { activePointers: 1 }
        };
        this.game = new Phaser.Game(config);
        phaserGame = this.game;
        window.addEventListener('resize', () => this.resize());
    },
    resize() { if(this.game) this.game.scale.resize(document.getElementById('game-view').clientWidth, document.getElementById('game-view').clientHeight); },
    hexToPx(q, r) { return { x: HEX_SIZE * 3/2 * q, y: HEX_SIZE * Math.sqrt(3) * (r + q/2) }; },
    pxToHex(mx, my) { 
        const main = phaserGame.scene.getScene('MainScene'); if(!main) return {q:0, r:0}; 
        const w = main.cameras.main.getWorldPoint(mx, my); 
        return this.roundHex((2/3*w.x)/HEX_SIZE, (-1/3*w.x+Math.sqrt(3)/3*w.y)/HEX_SIZE); 
    },
    roundHex(q,r) { let rq=Math.round(q), rr=Math.round(r), rs=Math.round(-q-r); const dq=Math.abs(rq-q), dr=Math.abs(rr-r), ds=Math.abs(rs-(-q-r)); if(dq>dr&&dq>ds) rq=-rr-rs; else if(dr>ds) rr=-rq-rs; return {q:rq, r:rr}; },
    
    dealCards(types) {
        const ui = this.game.scene.getScene('UIScene');
        if(ui && ui.scene.settings.active) ui.dealStart(types);
    }
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

        // ★ビジュアルをグループ化（マスク適用のため）
        this.visuals = scene.add.container(0, 0);

        // 背景
        const bg = scene.add.rectangle(0, 0, W, H, 0x222222).setStrokeStyle(2, 0x555555);
        // 背景自体をインタラクティブに
        bg.setInteractive({ useHandCursor: true, draggable: true });
        
        // アイコン
        const iconKey = `card_icon_${type}`;
        if(!scene.textures.exists(iconKey)) scene.textures.addCanvas(iconKey, window.createCardIcon(type));
        const icon = scene.add.image(0, -40, iconKey).setScale(1/HIGH_RES_SCALE);
        const text = scene.add.text(0, 40, type.toUpperCase(), { fontSize: '16px', color: '#d84', fontStyle: 'bold' }).setOrigin(0.5);
        const desc = scene.add.text(0, 70, "DRAG TO DEPLOY", { fontSize: '10px', color: '#888' }).setOrigin(0.5);
        
        icon.disableInteractive();
        
        // visualsにまとめて追加
        this.visuals.add([bg, icon, text, desc]);
        this.add(this.visuals);
        
        this.bgRect = bg; 
        
        this.setScrollFactor(0);
        
        // 物理パラメータ
        this.baseX = x; this.baseY = y;
        this.physX = x; this.physY = y;
        this.velocityX = 0; this.velocityY = 0;
        this.velocityAngle = 0;
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

    updatePhysics() {
        if (!this.isDragging && !this.scene.isReturning) {
            this.targetX = this.baseX;
            this.targetY = this.baseY - (this.isHovering ? 30 : 0);
        }
        // 位置バネ
        const stiffness = this.isDragging ? 0.2 : 0.08; 
        const damping = 0.65; 
        const ax = (this.targetX - this.physX) * stiffness;
        const ay = (this.targetY - this.physY) * stiffness;
        this.velocityX += ax; this.velocityY += ay;
        this.velocityX *= damping; this.velocityY *= damping;
        this.physX += this.velocityX; this.physY += this.velocityY;
        this.setPosition(this.physX, this.physY);

        // 角度振り子
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

    onHover() {
        if(Renderer.isMapDragging || Renderer.isCardDragging) return;
        this.isHovering = true;
        this.parentContainer.bringToTop(this);
    }
    onHoverOut() { this.isHovering = false; }

    onDragStart(pointer) {
        if(Renderer.isMapDragging) return;
        this.isDragging = true;
        Renderer.isCardDragging = true;
        this.setAlpha(0.9);
        this.setScale(1.1);

        const hand = this.parentContainer;
        const worldPos = hand.getLocalTransformMatrix().transformPoint(this.x, this.y);
        hand.remove(this);
        this.scene.add.existing(this);
        
        this.physX = worldPos.x; this.physY = worldPos.y;
        this.targetX = this.physX; this.targetY = this.physY;
        this.setDepth(9999);

        this.dragOffsetX = this.physX - pointer.x;
        this.dragOffsetY = this.physY - pointer.y;
    }

    onDrag(pointer) {
        this.targetX = pointer.x + this.dragOffsetX;
        this.targetY = pointer.y + this.dragOffsetY;

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
        main.dragHighlightHex = null;

        const dropZoneY = this.scene.scale.height * 0.65;
        if (this.y < dropZoneY) {
             const hex = Renderer.pxToHex(pointer.x, pointer.y);
             this.burnAndConsume(hex);
        } else {
             this.returnToHand();
        }
    }

    // ★燃え尽きるエフェクト (Mask + Particles)
    burnAndConsume(hex) {
        console.log(`Deploying ${this.cardType} at ${hex.q},${hex.r}`);
        this.updatePhysics = () => {}; // 物理停止
        
        // 1. 赤黒く変化
        this.bgRect.setFillStyle(0x220000);
        this.bgRect.setStrokeStyle(2, 0xff4400);
        
        // 2. マスク作成 (下から上へ消す)
        // カードのローカル座標系におけるマスク用Graphics
        const maskShape = this.scene.make.graphics();
        maskShape.fillStyle(0xffffff);
        // 初期状態: カード全体を覆う矩形
        maskShape.fillRect(-70, -100, 140, 200); 
        
        // マスクはワールド座標で管理する必要があるため少し特殊
        // ここではシンプルに、GeometryMaskを使用
        const mask = maskShape.createGeometryMask();
        this.visuals.setMask(mask);
        
        // マスク用のダミーオブジェクトを作ってTweenし、onUpdateでGraphicsを再描画する方式が確実
        const burnProgress = { val: 0 }; // 0(下) -> 1(上)
        
        this.scene.tweens.add({
            targets: burnProgress,
            val: 1,
            duration: 800,
            ease: 'Linear',
            onUpdate: () => {
                // マスク更新: 下から削る
                maskShape.clear();
                maskShape.fillStyle(0xffffff);
                const currentY = -100 + (200 * burnProgress.val);
                // 上半分だけ残す矩形を描画 (Maskは「描画された部分」が見える)
                maskShape.fillRect(-70, -100, 140, 200 * (1 - burnProgress.val)); // 上から縮めるのではなく、矩形の高さを変える
                
                // 位置合わせ（コンテナが動いてもマスクが追従するように）
                maskShape.x = this.x;
                maskShape.y = this.y + (200 * burnProgress.val); // マスク自体を下げる、あるいは描画領域を変える
                // ※GeometryMaskの座標合わせは難しいので、ここでは「矩形の高さを縮める」アプローチで上部を残す
                
                // 3. 燃焼ラインからパーティクル
                // カードの回転(this.angle)も考慮して火の粉を散らすと最高にかっこいい
                const rad = Phaser.Math.DegToRad(this.angle);
                const cos = Math.cos(rad);
                const sin = Math.sin(rad);
                
                // 燃焼ラインのY座標 (ローカル)
                const burnLineY = 100 - (200 * burnProgress.val); 
                
                // 横幅いっぱいにランダム生成
                for(let i=0; i<3; i++) {
                    const randX = (Math.random() - 0.5) * 140;
                    // 回転行列でワールド座標へ
                    const wx = this.x + (randX * cos - burnLineY * sin);
                    const wy = this.y + (randX * sin + burnLineY * cos);
                    
                    VFX.addFire(wx, wy);
                    if(Math.random()<0.3) VFX.addSmoke(wx, wy);
                }

                // 4. 断末魔の振動
                this.x += (Math.random()-0.5) * 4;
                this.y += (Math.random()-0.5) * 4;
            },
            onComplete: () => {
                maskShape.destroy();
                this.scene.removeCard(this);
                this.destroy();
                // if(window.gameLogic) window.gameLogic.deployUnit(hex, this.cardType); 
            }
        });
    }

    returnToHand() {
        const hand = this.scene.handContainer;
        this.scene.children.remove(this);
        hand.add(this); 
        this.setDepth(0);
        this.physX = this.x; this.physY = this.y;
        this.targetX = this.baseX; this.targetY = this.baseY;
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
        
        // 初期配付
        this.time.delayedCall(800, ()=>{ 
            this.dealStart(['infantry','tank','heal','infantry','tiger']); 
        });
    }

    update() { this.cards.forEach(card => card.updatePhysics()); }

    dealStart(types) {
        types.forEach((type, i) => {
            this.time.delayedCall(i * 100, () => { 
                this.addCardToHand(type);
            });
        });
    }

    addCardToHand(type) {
        const card = new Card(this, 0, 0, type);
        this.handContainer.add(card);
        this.cards.push(card);
        
        // 配布演出: 画面右下外から
        card.physX = this.scale.width/2 + 300; 
        card.physY = 300; 
        card.setPosition(card.physX, card.physY);
        
        this.arrangeHand();
    }

    removeCard(cardToRemove) {
        this.cards = this.cards.filter(c => c !== cardToRemove);
        this.arrangeHand(); 
    }

    arrangeHand() {
        const total = this.cards.length;
        const centerIdx = (total - 1) / 2;
        const spacing = 160; 
        this.cards.forEach((card, i) => {
            const offset = i - centerIdx;
            card.baseX = offset * spacing;
            card.baseY = -120;
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
        const S = HEX_SIZE * HIGH_RES_SCALE; 
        g.lineStyle(2 * HIGH_RES_SCALE, 0x888888, 1); g.fillStyle(0xffffff, 1); g.beginPath();
        for(let i=0; i<6; i++) { const a = Math.PI/180 * 60 * i; g.lineTo(S + S * Math.cos(a), S + S * Math.sin(a)); }
        g.closePath(); g.fillPath(); g.strokePath(); g.generateTexture('hex_base', S*2, S*2);
        
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

        this.input.on('wheel', (pointer, gameObjects, deltaX, deltaY, deltaZ) => {
            let newZoom = this.cameras.main.zoom;
            if (deltaY > 0) newZoom -= 0.3; else if (deltaY < 0) newZoom += 0.3;
            newZoom = Phaser.Math.Clamp(newZoom, 0.25, 4.0);
            this.tweens.add({ targets: this.cameras.main, zoom: newZoom, duration: 150, ease: 'Cubic.out' });
        });

        this.input.on('pointerdown', (p) => {
            if (Renderer.isCardDragging) return;
            const uiScene = this.scene.get('UIScene');
            if (uiScene.input.hitTestPointer(p).length > 0) return;

            if(p.button === 0) {
                Renderer.isMapDragging = true;
                if(window.gameLogic) window.gameLogic.handleClick(Renderer.pxToHex(p.x, p.y));
            }
            else if(p.button === 2) { if(window.gameLogic) window.gameLogic.showContext(p.x, p.y); }
        });

        this.input.on('pointerup', () => { Renderer.isMapDragging = false; });
        
        this.input.on('pointermove', (p) => {
            if (Renderer.isCardDragging) return;
            if (p.isDown && Renderer.isMapDragging) {
                const zoom = this.cameras.main.zoom;
                this.cameras.main.scrollX -= (p.x - p.prevPosition.x) / zoom;
                this.cameras.main.scrollY -= (p.y - p.prevPosition.y) / zoom;
            }
            if(!Renderer.isMapDragging && window.gameLogic) window.gameLogic.handleHover(Renderer.pxToHex(p.x, p.y));
        });
        this.input.mouse.disableContextMenu();
    }

    centerCamera(q, r) { const p = Renderer.hexToPx(q, r); this.cameras.main.centerOn(p.x, p.y); }

    createMap() { 
        const map = window.gameLogic.map; 
        for(let q=0; q<MAP_W; q++) { 
            for(let r=0; r<MAP_H; r++) { 
                const t = map[q][r]; if(t.id===-1)continue; 
                const pos = Renderer.hexToPx(q, r); 
                const hex = this.add.image(pos.x, pos.y, 'hex_base').setScale(1/HIGH_RES_SCALE); 
                let tint = 0x555555; if(t.id===0)tint=0x5a5245; else if(t.id===1)tint=0x425030; else if(t.id===2)tint=0x222e1b; else if(t.id===4)tint=0x504540; else if(t.id===5)tint=0x303840; 
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
const VFX = { 
    particles:[], projectiles:[], 
    add(p){this.particles.push(p);}, 
    addFire(x,y){this.add({x,y,vx:(Math.random()-0.5)*2,vy:-Math.random()*4-1,life:20+Math.random()*20,maxLife:40,color:'#fa0',size:6,type:'f'});},
    addSmoke(x,y){this.add({x,y,vx:(Math.random()-0.5)*1,vy:-1,life:40+Math.random()*20,maxLife:60,color:'#444',size:5,type:'s'});},
    addProj(p){this.projectiles.push(p);},
    addExplosion(x,y,c,n){for(let i=0;i<n;i++){const a=Math.random()*6.28,s=Math.random()*5+1;this.add({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:30+Math.random()*20,maxLife:50,color:c,size:2,type:'s'});}},
    addUnitDebris(x,y){}, 
    update(){ 
        this.particles.forEach(p=>{
            p.x+=p.vx;p.y+=p.vy;p.life--;
            if(p.type==='f') { p.size*=0.9; p.color=Math.random()>0.4?'#ff4':(Math.random()>0.5?'#f40':'#620'); } 
            else if(p.type==='s') { p.size*=1.02; p.y-=0.5; p.alpha = p.life/p.maxLife; }
        }); 
        this.projectiles.forEach(p=>{if(p.type.includes('shell')||p.type==='rocket'){p.progress+=p.speed;if(p.progress>=1){p.dead=true;p.onHit();return;}const lx=p.sx+(p.ex-p.sx)*p.progress,ly=p.sy+(p.ey-p.sy)*p.progress,a=Math.sin(p.progress*Math.PI)*p.arcHeight;p.x=lx;p.y=ly-a;}else{p.x+=p.vx;p.y+=p.vy;p.life--;if(p.life<=0){p.dead=true;p.onHit();}}}); 
        this.particles=this.particles.filter(p=>p.life>0); this.projectiles=this.projectiles.filter(p=>!p.dead); 
    }, 
    draw(g){ 
        this.projectiles.forEach(p=>{g.fillStyle(0xffff00,1); g.fillCircle(p.x,p.y,3);}); 
        this.particles.forEach(p=>{
            const c = p.color==='#fa0'?0xffaa00:(p.color==='#f40'?0xff4400:(p.color==='#ff4'?0xffff44:(p.color==='#620'?0x662200:0x444444)));
            g.fillStyle(c, p.alpha!==undefined?p.alpha:(p.life/p.maxLife)); 
            g.fillCircle(p.x,p.y,p.size);
        }); 
    }
};

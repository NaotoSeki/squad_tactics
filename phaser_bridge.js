/** * PHASER BRIDGE (Updated) */
let phaserScene = null;

// カード画像生成 (変更なし)
window.createCardIcon = function(type) { /* ...前回と同じ... */ 
    const c=document.createElement('canvas');c.width=100;c.height=60;const x=c.getContext('2d');x.translate(50,30);x.scale(2,2);
    if(type==='infantry'){x.fillStyle="#444";x.fillRect(-15,0,30,4);x.fillStyle="#642";x.fillRect(-15,0,10,4);}
    else if(type==='tank'){x.fillStyle="#444";x.fillRect(-12,-6,24,12);x.fillStyle="#222";x.fillRect(0,-2,16,4);}
    else if(type==='heal'){x.fillStyle="#eee";x.fillRect(-10,-8,20,16);x.fillStyle="#d00";x.fillRect(-3,-6,6,12);x.fillRect(-8,-1,16,2);}
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
    hexToPx(q, r) { return { x: HEX_SIZE * 3/2 * q, y: HEX_SIZE * Math.sqrt(3) * (r + q/2) }; },
    pxToHex(mx, my) { if(!phaserScene) return {q:0, r:0}; const w = phaserScene.cameras.main.getWorldPoint(mx, my); return this.roundHex((2/3*w.x)/HEX_SIZE, (-1/3*w.x+Math.sqrt(3)/3*w.y)/HEX_SIZE); },
    roundHex(q,r) { let rq=Math.round(q), rr=Math.round(r), rs=Math.round(-q-r); const dq=Math.abs(rq-q), dr=Math.abs(rr-r), ds=Math.abs(rs-(-q-r)); if(dq>dr&&dq>ds) rq=-rr-rs; else if(dr>ds) rr=-rq-rs; return {q:rq, r:rr}; },
    frame: 0, draw() {}
};

class MainScene extends Phaser.Scene {
    constructor() { super({ key: 'MainScene' }); this.hexGroup=null; this.unitGroup=null; this.vfxGraphics=null; this.overlayGraphics=null; this.mapGenerated=false; }

    preload() {
        const g = this.make.graphics({x:0, y:0, add:false});
        // 1. Hexagon
        g.lineStyle(2, 0x888888, 1); g.fillStyle(0xffffff, 1); g.beginPath();
        for(let i=0; i<6; i++) { const a = Math.PI/180 * 60 * i; g.lineTo(HEX_SIZE+HEX_SIZE*Math.cos(a), HEX_SIZE+HEX_SIZE*Math.sin(a)); }
        g.closePath(); g.fillPath(); g.strokePath(); g.generateTexture('hex_base', HEX_SIZE*2, HEX_SIZE*2);
        
        // 2. Units
        g.clear(); g.fillStyle(0x00ff00, 1); g.fillCircle(16, 16, 10); g.generateTexture('unit_player', 32, 32);
        g.clear(); g.fillStyle(0xff0000, 1); g.fillRect(4, 4, 24, 24); g.generateTexture('unit_enemy', 32, 32);
        
        // 3. Cursor
        g.clear(); g.lineStyle(3, 0x00ff00, 1); g.strokeCircle(32, 32, 28); g.generateTexture('cursor', 64, 64);
    }

    create() {
        phaserScene = this; this.cameras.main.setBackgroundColor('#0b0e0a');
        this.hexGroup = this.add.group(); this.unitGroup = this.add.group();
        this.vfxGraphics = this.add.graphics(); this.vfxGraphics.setDepth(100);
        this.overlayGraphics = this.add.graphics(); this.overlayGraphics.setDepth(50); // 移動範囲用

        this.input.on('pointerdown', (p) => {
            if(p.button===0) { if(window.gameLogic) window.gameLogic.handleClick(Renderer.pxToHex(p.x, p.y)); }
            else if(p.button===2) { if(window.gameLogic) window.gameLogic.showContext(p.x, p.y); }
        });

        // ★追加: マウス移動時にLogicのhandleHoverを呼ぶ
        this.input.on('pointermove', (p) => {
            if (p.isDown) { this.cameras.main.scrollX -= (p.x - p.prevPosition.x); this.cameras.main.scrollY -= (p.y - p.prevPosition.y); }
            if(window.gameLogic) window.gameLogic.handleHover(Renderer.pxToHex(p.x, p.y));
        });

        this.input.mouse.disableContextMenu();
    }

    update(time, delta) {
        if (!window.gameLogic) return;
        
        // VFX
        VFX.update(); this.vfxGraphics.clear(); VFX.draw(this.vfxGraphics);

        // Map & Units
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

        // ★変更: 移動可能範囲(reachableHexes)を白枠で描画
        this.overlayGraphics.clear();
        const selected = window.gameLogic.selectedUnit;
        
        // 1. 移動可能範囲のハイライト
        if(selected && window.gameLogic.reachableHexes.length > 0) {
            this.overlayGraphics.lineStyle(2, 0xffffff, 0.4); // 少し透明な白線
            window.gameLogic.reachableHexes.forEach(h => {
                this.drawHexOutline(this.overlayGraphics, h.q, h.r);
            });
        }

        // 2. ホバーしているヘックスが移動可能なら太く表示
        const hover = window.gameLogic.hoverHex;
        if(selected && hover && window.gameLogic.reachableHexes.some(h => h.q === hover.q && h.r === hover.r)) {
            this.overlayGraphics.lineStyle(4, 0xffffff, 1.0); // 太い白線
            this.drawHexOutline(this.overlayGraphics, hover.q, hover.r);
        }

        // 3. 移動パス表示 (点線など)
        const path = window.gameLogic.path;
        if(path.length > 0 && selected) {
            this.overlayGraphics.lineStyle(3, 0xffffff, 0.5);
            this.overlayGraphics.beginPath();
            const start = Renderer.hexToPx(selected.q, selected.r);
            this.overlayGraphics.moveTo(start.x, start.y);
            path.forEach(p => { const pos = Renderer.hexToPx(p.q, p.r); this.overlayGraphics.lineTo(pos.x, pos.y); });
            this.overlayGraphics.strokePath();
        }
    }

    drawHexOutline(g, q, r) {
        const center = Renderer.hexToPx(q, r);
        g.beginPath();
        for(let i=0; i<6; i++) {
            const angle_deg = 60 * i;
            const angle_rad = Math.PI / 180 * angle_deg;
            // ヘックスサイズより少し小さく描くと枠が重ならず綺麗に見える
            const size = HEX_SIZE * 0.9; 
            g.lineTo(center.x + size * Math.cos(angle_rad), center.y + size * Math.sin(angle_rad));
        }
        g.closePath();
        g.strokePath();
    }

    createMap() {
        const map = window.gameLogic.map;
        for(let q=0; q<MAP_W; q++) {
            for(let r=0; r<MAP_H; r++) {
                const t = map[q][r]; if(t.id===-1)continue;
                const pos = Renderer.hexToPx(q, r);
                const hex = this.add.image(pos.x, pos.y, 'hex_base');
                let tint = 0x555555;
                if(t.id===0)tint=0x5a5245; else if(t.id===1)tint=0x425030; else if(t.id===2)tint=0x222e1b; else if(t.id===4)tint=0x504540; else if(t.id===5)tint=0x303840;
                hex.setTint(tint);
                if(t.id===2) { const tr=this.add.circle(pos.x, pos.y, HEX_SIZE*0.6, 0x112211, 0.5); this.hexGroup.add(tr); }
                this.hexGroup.add(hex);
            }
        }
    }
    centerCamera(q, r) { const p = Renderer.hexToPx(q, r); this.cameras.main.centerOn(p.x, p.y); }
}

const Sfx = { play(id){} };
const VFX = {
    particles:[], projectiles:[], 
    add(p){this.particles.push(p);}, addProj(p){this.projectiles.push(p);},
    addExplosion(x,y,c,n){for(let i=0;i<n;i++){const a=Math.random()*6.28,s=Math.random()*5+1;this.add({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:30+Math.random()*20,maxLife:50,color:c,size:2,type:'s'});}},
    addUnitDebris(x,y){/*...*/},
    update(){
        this.particles.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.life--;});
        this.projectiles.forEach(p=>{if(p.type.includes('shell')||p.type==='rocket'){p.progress+=p.speed;if(p.progress>=1){p.dead=true;p.onHit();return;}const lx=p.sx+(p.ex-p.sx)*p.progress,ly=p.sy+(p.ey-p.sy)*p.progress,a=Math.sin(p.progress*Math.PI)*p.arcHeight;p.x=lx;p.y=ly-a;}else{p.x+=p.vx;p.y+=p.vy;p.life--;if(p.life<=0){p.dead=true;p.onHit();}}});
        this.particles=this.particles.filter(p=>p.life>0); this.projectiles=this.projectiles.filter(p=>!p.dead);
    },
    draw(g){
        this.projectiles.forEach(p=>{g.fillStyle(0xffff00,1); g.fillCircle(p.x,p.y,3);});
        this.particles.forEach(p=>{g.fillStyle(p.color==='#fa0'?0xffaa00:0xffffff, p.life/p.maxLife); g.fillCircle(p.x,p.y,p.size);});
    }
};

/** * PHASER BRIDGE
 * logic.js からの命令を受け取り、Phaser 3で描画を行うアダプタークラス
 */

let phaserScene = null; // 外部アクセス用

// カード画像生成（前回修正済み）
window.createCardIcon = function(type) {
    const c = document.createElement('canvas'); c.width=100; c.height=60; const ctx = c.getContext('2d');
    ctx.translate(50, 30); ctx.scale(2,2);
    if(type==='infantry') { ctx.fillStyle="#444"; ctx.fillRect(-15,0,30,4); ctx.fillStyle="#642"; ctx.fillRect(-15,0,10,4); }
    else if(type==='heavy') { ctx.fillStyle="#111"; ctx.fillRect(-10,-2,20,4); ctx.fillRect(-5,2,2,6); ctx.fillRect(5,2,2,6); }
    else if(type==='sniper') { ctx.fillStyle="#222"; ctx.fillRect(-18,0,36,3); ctx.fillRect(-5,-4,10,4); }
    else if(type==='tank') { ctx.fillStyle="#444"; ctx.fillRect(-12,-6,24,12); ctx.fillStyle="#222"; ctx.fillRect(0,-2,16,4); }
    else if(type==='mortar') { ctx.fillStyle="#333"; ctx.fillRect(-14,-8,28,16); ctx.fillStyle="#111"; ctx.beginPath(); ctx.arc(0,-2, 6, 0, Math.PI*2); ctx.fill(); ctx.fillStyle="#522"; ctx.fillRect(-12,-6,4,12); }
    else if(type==='tiger') { ctx.fillStyle="#554"; ctx.fillRect(-14,-8,28,16); ctx.fillStyle="#111"; ctx.fillRect(2,-2,20,4); }
    else if(type==='heal') { ctx.fillStyle="#eee"; ctx.fillRect(-10,-8,20,16); ctx.fillStyle="#d00"; ctx.fillRect(-3,-6,6,12); ctx.fillRect(-8,-1,16,2); }
    return c.toDataURL();
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
            scene: MainScene,
            fps: { target: 60 },
            physics: { default: 'arcade', arcade: { debug: false } }
        };
        this.game = new Phaser.Game(config);
        window.addEventListener('resize', () => this.resize());
    },

    resize() {
        if(this.game) {
            const w = document.getElementById('game-view').clientWidth;
            const h = document.getElementById('game-view').clientHeight;
            this.game.scale.resize(w, h);
        }
    },

    centerOn(q, r) { if(phaserScene) phaserScene.centerCamera(q, r); },

    hexToPx(q, r) { return { x: HEX_SIZE * 3/2 * q, y: HEX_SIZE * Math.sqrt(3) * (r + q/2) }; },
    
    pxToHex(mx, my) {
        if(!phaserScene) return {q:0, r:0};
        const worldPoint = phaserScene.cameras.main.getWorldPoint(mx, my);
        const q = (2/3 * worldPoint.x) / HEX_SIZE;
        const r = (-1/3 * worldPoint.x + Math.sqrt(3)/3 * worldPoint.y) / HEX_SIZE;
        return this.roundHex(q, r);
    },

    roundHex(q,r) { 
        let rq=Math.round(q), rr=Math.round(r), rs=Math.round(-q-r); 
        const dq=Math.abs(rq-q), dr=Math.abs(rr-r), ds=Math.abs(rs-(-q-r)); 
        if(dq>dr&&dq>ds) rq=-rr-rs; else if(dr>ds) rr=-rq-rs; 
        return {q:rq, r:rr}; 
    },

    frame: 0,
    draw() { /* No-op */ }
};

/**
 * Phaser Main Scene
 */
class MainScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MainScene' });
        this.hexGroup = null;
        this.unitGroup = null;
        this.vfxGraphics = null; // VFX描画用
        this.overlayGraphics = null;
        this.mapGenerated = false;
        this.hexSprites = new Map();
    }

    preload() {
        const g = this.make.graphics({x:0, y:0, add:false});
        
        // --- 1. Hexagon Texture (修正版) ---
        // 原点を中心にずらしてから描画することで見切れを防ぐ
        g.lineStyle(2, 0x888888, 1);
        g.fillStyle(0xffffff, 1);
        g.beginPath();
        // 平面的なヘックス（Flat-topped）を描画
        for(let i=0; i<6; i++) {
            // 中心 (HEX_SIZE, HEX_SIZE) を基準に描画
            const angle_deg = 60 * i;
            const angle_rad = Math.PI / 180 * angle_deg;
            g.lineTo(
                HEX_SIZE + HEX_SIZE * Math.cos(angle_rad), 
                HEX_SIZE + HEX_SIZE * Math.sin(angle_rad)
            );
        }
        g.closePath();
        g.fillPath();
        g.strokePath();
        g.generateTexture('hex_base', HEX_SIZE*2, HEX_SIZE*2);

        // --- 2. Unit Textures ---
        g.clear();
        g.fillStyle(0x00ff00, 1); g.fillCircle(16, 16, 10);
        g.generateTexture('unit_player', 32, 32);
        
        g.clear();
        g.fillStyle(0xff0000, 1); g.fillRect(4, 4, 24, 24);
        g.generateTexture('unit_enemy', 32, 32);

        // --- 3. Cursor ---
        g.clear();
        g.lineStyle(3, 0x00ff00, 1); g.strokeCircle(32, 32, 28);
        g.generateTexture('cursor', 64, 64);
    }

    create() {
        phaserScene = this;
        this.cameras.main.setBackgroundColor('#0b0e0a');
        
        this.hexGroup = this.add.group();
        this.unitGroup = this.add.group();
        
        // VFX用のGraphics（最前面）
        this.vfxGraphics = this.add.graphics();
        this.vfxGraphics.setDepth(100);

        this.overlayGraphics = this.add.graphics();
        this.overlayGraphics.setDepth(50);

        this.input.on('pointerdown', (pointer) => {
            if(pointer.button === 0) {
                const hex = Renderer.pxToHex(pointer.x, pointer.y);
                if(window.gameLogic) window.gameLogic.handleClick(hex);
            }
            else if(pointer.button === 2) {
                if(window.gameLogic) window.gameLogic.showContext(pointer.x, pointer.y);
            }
        });

        this.input.on('pointermove', (pointer) => {
            if (pointer.isDown) {
                this.cameras.main.scrollX -= (pointer.x - pointer.prevPosition.x);
                this.cameras.main.scrollY -= (pointer.y - pointer.prevPosition.y);
            }
        });

        this.input.mouse.disableContextMenu();
    }

    update(time, delta) {
        if (!window.gameLogic) return;

        // VFX更新＆描画
        VFX.update();
        this.vfxGraphics.clear();
        VFX.draw(this.vfxGraphics);

        // マップ生成
        if (window.gameLogic.map.length > 0 && !this.mapGenerated) {
            this.createMap();
            this.mapGenerated = true;
        }

        // ユニット同期
        this.unitGroup.clear(true, true);
        window.gameLogic.units.forEach(u => {
            if(u.hp <= 0) return;
            const pos = Renderer.hexToPx(u.q, u.r);
            const texture = u.team === 'player' ? 'unit_player' : 'unit_enemy';
            
            const container = this.add.container(pos.x, pos.y);
            const sprite = this.add.sprite(0, 0, texture);
            
            if(u.def.isTank) sprite.setTint(0x888888);
            if(u.team === 'player') sprite.setTint(0x6688aa);
            else sprite.setTint(0xcc6655);

            container.add(sprite);

            const hpPct = u.hp / u.maxHp;
            const bar = this.add.rectangle(0, -20, 20, 4, 0x000000);
            const barFill = this.add.rectangle(-10 + (10*hpPct), -20, 20*hpPct, 4, hpPct > 0.5 ? 0x00ff00 : 0xff0000);
            container.add([bar, barFill]);

            if(window.gameLogic.selectedUnit === u) {
                const cursor = this.add.image(0, 0, 'cursor');
                this.tweens.add({
                    targets: cursor, scale: { from: 1, to: 1.1 }, alpha: { from: 1, to: 0.5 },
                    yoyo: true, repeat: -1, duration: 800
                });
                container.add(cursor);
            }
            this.unitGroup.add(container);
        });

        // オーバーレイ（射程など）
        this.overlayGraphics.clear();
        const selected = window.gameLogic.selectedUnit;
        if(selected && selected.ap >= 2) {
            const wpn = WPNS[selected.curWpn];
            const q = selected.q, r = selected.r;
            const center = Renderer.hexToPx(q, r);
            this.overlayGraphics.lineStyle(2, 0xff0000, 0.3);
            this.overlayGraphics.strokeCircle(center.x, center.y, wpn.rng * HEX_SIZE * 1.5);
        }

        const path = window.gameLogic.path;
        if(path.length > 0 && selected) {
            this.overlayGraphics.lineStyle(3, 0xffffff, 0.5);
            this.overlayGraphics.beginPath();
            const start = Renderer.hexToPx(selected.q, selected.r);
            this.overlayGraphics.moveTo(start.x, start.y);
            path.forEach(p => {
                const pos = Renderer.hexToPx(p.q, p.r);
                this.overlayGraphics.lineTo(pos.x, pos.y);
            });
            this.overlayGraphics.strokePath();
        }
    }

    createMap() {
        const map = window.gameLogic.map;
        for(let q=0; q<MAP_W; q++) {
            for(let r=0; r<MAP_H; r++) {
                const t = map[q][r];
                if(t.id === -1) continue;

                const pos = Renderer.hexToPx(q, r);
                const hex = this.add.image(pos.x, pos.y, 'hex_base');
                
                let tint = 0x555555;
                if(t.id === 0) tint = 0x5a5245; 
                else if(t.id === 1) tint = 0x425030; 
                else if(t.id === 2) tint = 0x222e1b; 
                else if(t.id === 4) tint = 0x504540; 
                else if(t.id === 5) tint = 0x303840; 
                
                hex.setTint(tint);
                if(t.id === 2) {
                    const tree = this.add.circle(pos.x, pos.y, HEX_SIZE*0.6, 0x112211, 0.5);
                    this.hexGroup.add(tree);
                }
                this.hexGroup.add(hex);
                this.hexSprites.set(`${q},${r}`, hex);
            }
        }
    }

    centerCamera(q, r) {
        const pos = Renderer.hexToPx(q, r);
        this.cameras.main.centerOn(pos.x, pos.y);
    }
}

const Sfx = { play(id) { /* sound placeholder */ } };

// ★VFXの復活（Phaser Graphics版）
const VFX = {
    particles: [], projectiles: [], debris: [],
    
    // logic.jsから呼ばれる追加関数
    add(p) { this.particles.push(p); },
    addProj(p) { this.projectiles.push(p); },
    addExplosion(x, y, color="#fa0", count=20) {
        for(let i=0; i<count; i++) {
            const a = Math.random() * Math.PI * 2; const speed = Math.random() * 5 + 1;
            this.add({x, y, vx:Math.cos(a)*speed, vy:Math.sin(a)*speed, life:30+Math.random()*20, maxLife:50, color, size:1+Math.random()*2, type:'spark'});
        }
    },
    addUnitDebris(x, y) {
        for(let i=0; i<15; i++) {
            this.add({x, y, vx:(Math.random()-0.5)*8, vy:-Math.random()*8, life:100, maxLife:100, color:Math.random()>0.5?"#888":"#a33", size:Math.random()*3+1, type:'debris'});
        }
    },
    addStaticDebris(q, r, type) {}, // 静的デブリは今回は省略（Mapに描画するならSprite化推奨）

    // 更新処理 (logic.jsの物理計算をそのまま再現)
    update() {
        this.particles.forEach(p=>{ 
            p.x+=p.vx; p.y+=p.vy; if(p.type==='debris' || p.type==='spark') p.vy+=0.2; p.life--; 
            if(p.type==='debris' && p.vy>0 && Math.random()<0.1) { p.vy *= -0.5; p.vx *= 0.8; }
        });
        
        this.projectiles.forEach(p=>{
            if(p.type.includes('shell') || p.type === 'rocket') {
                p.progress+=p.speed; if(p.progress>=1) { p.dead=true; p.onHit(); return; }
                const lx = p.sx + (p.ex-p.sx)*p.progress;
                const ly = p.sy + (p.ey-p.sy)*p.progress;
                const arc = Math.sin(p.progress*Math.PI) * p.arcHeight;
                p.x=lx; p.y=ly-arc;
            } else { 
                p.x+=p.vx; p.y+=p.vy; p.life--; 
                if(p.life<=0){ p.dead=true; p.onHit(); } 
            }
        });
        
        this.particles=this.particles.filter(p=>p.life>0); 
        this.projectiles=this.projectiles.filter(p=>!p.dead);
    },

    // 描画処理 (Phaser Graphicsを使用)
    draw(g) {
        // Projectiles
        this.projectiles.forEach(p=>{
            g.fillStyle(0xffff00, 1); // 黄色
            if(p.type.includes('shell')) g.fillCircle(p.x, p.y, 3);
            else if(p.type === 'rocket') { g.fillStyle(0xff8800, 1); g.fillCircle(p.x, p.y, 5); }
            else { 
                // 弾丸の軌跡線
                g.lineStyle(2, 0xffff00, 1);
                g.beginPath(); g.moveTo(p.x-p.vx, p.y-p.vy); g.lineTo(p.x, p.y); g.strokePath();
            }
        });

        // Particles
        this.particles.forEach(p=>{
            // 文字列の色指定("#fa0")をPhaserの0x数値に変換するのは面倒なので、簡易的にSwitch
            let color = 0xffffff;
            if(p.color === "#fa0" || p.color === "#f55") color = 0xffaa00; // オレンジ・赤系
            else if(p.color === "#888") color = 0x888888; // グレー
            else if(p.color === "#a33") color = 0xaa3333; // 血飛沫

            const alpha = p.life / p.maxLife;
            g.fillStyle(color, alpha);
            g.fillCircle(p.x, p.y, p.size);
        });
    }
};

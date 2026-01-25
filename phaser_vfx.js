/** PHASER VFX & ENV: High-Res Vector Nature & VISIBLE STRONG WIND WAVES */

class VFXSystem {
    constructor() {
        this.particles = [];
        this.windTimer = 0;
    }

    update() {
        // --- Wind Gust System (Visual Particles) ---
        this.windTimer++;
        if (this.windTimer > 180 + Math.random() * 120) {
            this.triggerWindGust();
            this.windTimer = 0;
        }

        // --- Particles Physics ---
        for (let i = this.particles.length - 1; i >= 0; i--) {
            let p = this.particles[i];
            if (p.delay > 0) { p.delay--; continue; }
            
            p.life--;
            p.x += p.vx;
            p.y += p.vy;
            
            if (p.type === 'wind') {
                p.alpha = Math.sin((p.life / p.maxLife) * Math.PI) * 0.3; 
            } else if (p.type === 'proj') {
                p.progress += p.speed;
                let t = p.progress;
                if (t >= 1) t = 1;
                
                const dx = p.ex - p.sx;
                const dy = p.ey - p.sy;
                p.x = p.sx + dx * t;
                p.y = p.sy + dy * t;
                
                if (p.arcHeight > 0) p.y -= Math.sin(t * Math.PI) * p.arcHeight;

                if (t >= 1) {
                    if (typeof p.onHit === 'function') p.onHit();
                    p.life = 0; 
                }
            } else {
                p.vy += 0.2; 
            }

            if (p.life <= 0) this.particles.splice(i, 1);
        }
    }

    triggerWindGust() {
        for (let i = 0; i < 20; i++) {
            this.add({
                x: -300 - Math.random() * 500,
                y: Math.random() * 3000,
                vx: 25 + Math.random() * 10,
                vy: 2 + Math.random() * 2,
                life: 180,
                color: "#eeffff",
                size: 2, 
                type: 'wind'
            });
        }
        if(window.EnvSystem) window.EnvSystem.onGust();
    }

    draw(graphics) {
        graphics.clear();
        this.particles.forEach(p => {
            if (p.delay > 0) return;
            
            if (p.type === 'wind') {
                graphics.lineStyle(2, 0xffffff, p.alpha);
                graphics.beginPath();
                graphics.moveTo(p.x, p.y);
                graphics.lineTo(p.x - p.vx * 15, p.y - p.vy * 15); 
                graphics.strokePath();
            } 
            else {
                const alpha = p.life / p.maxLife;
                graphics.fillStyle(this.hexToInt(p.color), alpha);
                if (p.type === 'proj') graphics.fillCircle(p.x, p.y, 3);
                else if(p.type === 'smoke') graphics.fillCircle(p.x, p.y, p.size * (2-alpha));
                else graphics.fillRect(p.x, p.y, p.size, p.size);
            }
        });
    }

    add(p) {
        p.life = p.life || 60; p.maxLife = p.life;
        p.vx = p.vx || 0; p.vy = p.vy || 0;
        p.delay = p.delay || 0;
        if (!p.color) p.color = "#ffffff";
        this.particles.push(p);
    }

    addExplosion(x, y, color, count) {
        this.shakeRequest = 5;
        for(let i=0; i<count; i++) {
            const angle = Math.random() * Math.PI * 2; const speed = Math.random() * 3 + 1;
            this.add({ x:x, y:y, vx:Math.cos(angle)*speed, vy:Math.sin(angle)*speed-2, color:color, size:Math.random()*4+2, life:30+Math.random()*20, type:'spark' });
        }
        for(let i=0; i<count/2; i++) {
            this.add({ x:x, y:y, vx:(Math.random()-0.5), vy:-Math.random()*2, color:"#555", size:5, life:60, type:'smoke' });
        }
    }
    addSmoke(x, y) { this.add({ x:x, y:y, vx:(Math.random()-0.5)*0.5, vy:-0.5-Math.random()*0.5, color:"#888", size:4, life:80, type:'smoke' }); }
    addFire(x, y) { this.add({ x:x, y:y, vx:(Math.random()-0.5), vy:-1-Math.random(), color:"#fa0", size:3, life:40, type:'spark' }); }
    addProj(params) { params.type = 'proj'; params.life = 999; if(!params.color) params.color="#ffffaa"; this.add(params); }
    addUnitDebris(x, y) { for(let i=0; i<8; i++) { this.add({ x:x, y:y, vx:(Math.random()-0.5)*4, vy:-Math.random()*5, color:"#422", size:3, life:100, type:'spark' }); } }

    hexToInt(hex) {
        if (hex === undefined || hex === null) return 0xffffff;
        if (typeof hex === 'number') return hex;
        if (typeof hex !== 'string') return 0xffffff;
        return parseInt(hex.replace('#', '0x'), 16);
    }
}

// ★環境演出システム: 強力な風の表現
class EnvSystem {
    constructor() {
        this.grassElements = [];
        this.treeElements = [];
        this.gustPower = 0;
    }

    preload(scene) {
        const TEXTURE_SCALE = 4.0; 

        // 1. 草 (Vector Grass Tuft)
        if (!scene.textures.exists('hd_grass')) {
            const size = 64 * TEXTURE_SCALE;
            const g = scene.make.graphics({x:0, y:0, add:false});
            const palettes = [0x2d4c1e, 0x3b5e28, 0x4a7534, 0x55803a];
            g.fillStyle(0x1a2b12, 0.8); g.fillEllipse(size/2, size, size/3, size/8); // 土台

            for(let i=0; i<32; i++) {
                const col = palettes[Math.floor(Math.random() * palettes.length)];
                g.lineStyle(2 * TEXTURE_SCALE, col, 1.0);
                g.fillStyle(col);
                const startX = size/2 + (Math.random()-0.5) * (size * 0.4);
                const startY = size;
                const height = (size * 0.4) + Math.random() * (size * 0.5);
                const lean = (Math.random() - 0.5) * (size * 0.6);
                const endX = startX + lean; const endY = startY - height;
                const ctrlX = startX + lean * 0.3; const ctrlY = startY - height * 0.6;
                const curve = new Phaser.Curves.QuadraticBezier(new Phaser.Math.Vector2(startX, startY), new Phaser.Math.Vector2(ctrlX, ctrlY), new Phaser.Math.Vector2(endX, endY));
                curve.draw(g);
            }
            g.generateTexture('hd_grass', size, size);
        }

        // 2. 針葉樹 (Sharp Vector Conifer)
        if (!scene.textures.exists('hd_tree')) {
            const w = 80 * TEXTURE_SCALE; const h = 140 * TEXTURE_SCALE;
            const g = scene.make.graphics({x:0, y:0, add:false});
            g.fillStyle(0x221105); g.fillRect(w/2 - (w*0.08), h*0.8, w*0.16, h*0.2); // 幹
            const layers = 5; const leafDark = 0x0f2610; const leafLight = 0x1e3d1f;
            for(let i=0; i<layers; i++) {
                const progress = i / layers; const lw = w * (0.8 - progress * 0.6); const lh = h * 0.25; const ly = h * 0.8 - (h * 0.7 * progress) - lh; const cx = w/2; const cy = ly + lh;
                g.fillStyle(leafDark); g.beginPath(); g.moveTo(cx, ly); g.lineTo(cx + lw/2, cy); g.lineTo(cx, cy); g.fill();
                g.fillStyle(leafLight); g.beginPath(); g.moveTo(cx, ly); g.lineTo(cx - lw/2, cy); g.lineTo(cx, cy); g.fill();
            }
            g.generateTexture('hd_tree', w, h);
        }
    }

    clear() {
        this.grassElements = [];
        this.treeElements = [];
    }

    // --- 草の生成 ---
    spawnGrass(scene, group, x, y) {
        const count = 12;
        const scaleFactor = 0.25; 

        for(let i=0; i<count; i++) {
            const r = Math.random() * (HEX_SIZE * 0.95);
            const angle = Math.random() * Math.PI * 2;
            const ox = Math.cos(angle) * r;
            const oy = Math.sin(angle) * r * 0.866;

            const grass = scene.add.image(x+ox, y+oy, 'hd_grass');
            grass.setOrigin(0.5, 1.0); 
            grass.setScale((0.8 + Math.random() * 0.6) * scaleFactor); 
            grass.setDepth(y+oy); 
            
            grass.baseSkew = (Math.random()-0.5) * 0.2;
            grass.origX = x + ox; 
            grass.origY = y + oy;
            
            const tintVar = Math.floor(Math.random() * 40);
            grass.setTint(Phaser.Display.Color.GetColor(200 + tintVar, 255, 200 + tintVar));

            group.add(grass);
            this.grassElements.push(grass);
        }
    }

    // --- 木の生成 (修正: 小さく、多く) ---
    spawnTrees(scene, group, x, y) {
        // ★修正: 数を増やし、サイズを小さく
        const count = 6 + Math.floor(Math.random() * 4); // 増量
        const scaleFactor = 0.18; // 大幅に縮小 (以前は0.35)

        for(let i=0; i<count; i++) {
            const r = Math.random() * (HEX_SIZE * 0.8);
            const angle = Math.random() * Math.PI * 2;
            const ox = Math.cos(angle) * r;
            const oy = Math.sin(angle) * r * 0.866;
            
            const localScale = 0.7 + Math.random() * 0.6;
            const finalScale = localScale * scaleFactor;

            const shadow = scene.add.ellipse(x+ox, y+oy+5, 40*finalScale, 15*finalScale, 0x000000, 0.5);
            group.add(shadow);

            const tree = scene.add.image(x+ox, y+oy, 'hd_tree');
            tree.setOrigin(0.5, 0.95); 
            tree.setScale(finalScale);
            tree.setDepth(y+oy + 20); 
            
            tree.baseSkew = 0;
            tree.origX = x + ox;
            
            group.add(tree);
            this.treeElements.push(tree);
        }
    }

    registerWater(image, y, q, r, group) {
        // ★修正: 水面は一切動かさない (Tween削除)
    }

    onGust() {
        this.gustPower = 1.0; 
    }

    // ★風の波及処理: 計算式を超強化し、確実に動かす
    update(time) {
        const t = time * 0.001; // 時間経過
        
        this.gustPower *= 0.98; // 突風の減衰
        if(this.gustPower < 0.01) this.gustPower = 0;

        // 1. 草の処理 (Grass Wave)
        this.grassElements = this.grassElements.filter(g => g.scene);
        for (let i = 0; i < this.grassElements.length; i++) {
            const g = this.grassElements[i];
            
            // 波の伝播 (左から右へ) - X座標を引き算することで右への進行波になる
            const wavePhase = t * 1.5 - g.origX * 0.004;
            
            // メインの大きなうねり (0.0 〜 1.0)
            const bigWave = (Math.sin(wavePhase) + 1.0) * 0.5;
            
            // 細かい「わさわさ」した揺れ (高周波ノイズ)
            const rustle = Math.sin(t * 12.0 + g.origY * 0.1 + g.origX * 0.05) * 0.08;

            // ベースの風圧 (常に少し右に傾く)
            const baseLoad = 0.2;

            // 突風効果
            const gustEffect = this.gustPower * 0.8;

            // 合計傾き量 (係数を劇的に大きく設定)
            // BigWaveが強いときほど、右に大きく傾く
            const totalLean = (bigWave * 0.9) + baseLoad + rustle + gustEffect;
            
            // Skewに適用 (右方向への傾きを強調)
            g.skewX = g.baseSkew + Math.max(0, totalLean);
        }

        // 2. 木の処理 (Tree Sway)
        this.treeElements = this.treeElements.filter(tr => tr.scene);
        for (let i = 0; i < this.treeElements.length; i++) {
            const tr = this.treeElements[i];
            
            // 木は重いので、草より遅れて、小さく揺れる
            const wavePhase = t * 1.5 - tr.origX * 0.004; // 草と同じ波に乗る
            const sway = Math.sin(wavePhase) * 0.15; // 振幅は草より小さいが、明確に動くレベル
            
            const gustEffect = this.gustPower * 0.3;

            // 木は幹がしなる表現なので、中心から左右に振れる
            tr.skewX = tr.baseSkew + sway + gustEffect;
        }
    }
}

window.VFX = new VFXSystem();
window.EnvSystem = new EnvSystem();

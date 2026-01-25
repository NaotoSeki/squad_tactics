/** PHASER VFX & ENV: High-Res Grass & Wind Wave Simulation */

class VFXSystem {
    constructor() {
        this.emitters = [];
        this.particles = [];
        this.scene = null;
        this.shakeRequest = 0;
        this.windTimer = 0;
    }

    update() {
        // --- Wind Gust Particles (Visual cues only) ---
        this.windTimer++;
        if (this.windTimer > 200 + Math.random() * 200) {
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
                p.alpha = Math.min(1, p.life / 40) * 0.12; 
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
                p.vy += 0.2; // Gravity
            }

            if (p.life <= 0) this.particles.splice(i, 1);
        }
    }

    triggerWindGust() {
        // 風の粒子（環境システムとは別に、視覚的な風の流れを作る）
        for (let i = 0; i < 30; i++) {
            this.add({
                x: -200 - Math.random() * 400,
                y: Math.random() * 2500,
                vx: 18 + Math.random() * 5, // 高速
                vy: 1 + Math.random() * 1,
                life: 300,
                color: "#ccffff",
                size: 1, 
                type: 'wind'
            });
        }
    }

    draw(graphics) {
        graphics.clear();
        this.particles.forEach(p => {
            if (p.delay > 0) return;
            
            if (p.type === 'wind') {
                graphics.lineStyle(1, 0xffffff, p.alpha);
                graphics.beginPath();
                graphics.moveTo(p.x, p.y);
                graphics.lineTo(p.x - p.vx * 8, p.y - p.vy * 8); // 長いストリーク
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

// ★環境演出システム: "Wind Wave" Simulation
class EnvSystem {
    constructor() {
        this.grassElements = [];
        this.treeElements = [];
        this.globalTime = 0;
    }

    preload(scene) {
        // 1. 高解像度リアル草 (High-Res Grass Tuft)
        if (!scene.textures.exists('real_grass_blade')) {
            const g = scene.make.graphics({x:0, y:0, add:false});
            
            // 複数の色を使い分ける
            const palettes = [0x447733, 0x558844, 0x336622, 0x669955];
            
            // 1つのテクスチャに20本程度の葉を描き込む
            for(let i=0; i<24; i++) {
                const col = palettes[Math.floor(Math.random() * palettes.length)];
                g.lineStyle(1.2, col, 1.0);
                
                // 根元 (少しバラつかせる)
                const startX = 16 + (Math.random()-0.5)*10;
                const startY = 32;
                
                // 葉の長さとカーブ
                const len = 12 + Math.random() * 14;
                const lean = (Math.random() - 0.5) * 16; // 左右への広がり
                
                // PhaserのCurveを使って滑らかな葉を描く
                const endX = startX + lean;
                const endY = startY - len;
                const ctrlX = startX + lean * 0.2; // 根元近くは直立気味
                const ctrlY = startY - len * 0.5;

                const curve = new Phaser.Curves.QuadraticBezier(
                    new Phaser.Math.Vector2(startX, startY),
                    new Phaser.Math.Vector2(ctrlX, ctrlY),
                    new Phaser.Math.Vector2(endX, endY)
                );
                
                curve.draw(g);
            }
            g.generateTexture('real_grass_blade', 32, 32);
        }

        // 2. 針葉樹 (Dense Conifer)
        if (!scene.textures.exists('conifer_tree')) {
            const g = scene.make.graphics({x:0, y:0, add:false});
            g.fillStyle(0x2b1d14); g.fillRect(13, 45, 4, 10); // 幹
            
            const leafColor = 0x1a3311; 
            const highlight = 0x2b441f;
            
            const drawLayer = (y, w, h) => {
                // 影のある右側
                g.fillStyle(leafColor); 
                g.fillTriangle(15, y-h, 15-w/2, y, 15+w/2, y);
                // 光の当たる左側 (少し明るく)
                g.fillStyle(highlight); 
                g.beginPath(); g.moveTo(15, y-h); g.lineTo(15-w/2, y); g.lineTo(15, y); g.fill();
            };

            // 葉を多段に重ねて密度を出す
            drawLayer(45, 32, 20);
            drawLayer(35, 28, 18);
            drawLayer(25, 24, 16);
            drawLayer(15, 18, 14);

            g.generateTexture('conifer_tree', 30, 55);
        }
    }

    clear() {
        this.grassElements = [];
        this.treeElements = [];
    }

    spawnGrass(scene, group, x, y) {
        // ★大量配置: 1ヘックスに20株以上
        const count = 18 + Math.floor(Math.random() * 8);
        for(let i=0; i<count; i++) {
            const r = Math.random() * (HEX_SIZE * 0.95);
            const angle = Math.random() * Math.PI * 2;
            const ox = Math.cos(angle) * r;
            const oy = Math.sin(angle) * r * 0.866;

            const grass = scene.add.image(x+ox, y+oy, 'real_grass_blade');
            grass.setOrigin(0.5, 1.0); 
            grass.setScale(0.7 + Math.random() * 0.4);
            grass.setDepth(y+oy); 
            
            // ベースの傾き（個体差）
            grass.baseSkew = (Math.random()-0.5) * 0.15;
            // 本来の位置を保存（風計算用）
            grass.origX = x + ox;
            
            group.add(grass);
            this.grassElements.push(grass);
        }
    }

    spawnTrees(scene, group, x, y) {
        // ★針葉樹林
        const count = 5 + Math.floor(Math.random() * 3);
        for(let i=0; i<count; i++) {
            const r = Math.random() * (HEX_SIZE * 0.85);
            const angle = Math.random() * Math.PI * 2;
            const ox = Math.cos(angle) * r;
            const oy = Math.sin(angle) * r * 0.866;
            
            const scale = 0.8 + Math.random() * 0.6;

            const shadow = scene.add.ellipse(x+ox, y+oy+2, 18*scale, 8*scale, 0x000000, 0.4);
            group.add(shadow);

            const tree = scene.add.image(x+ox, y+oy, 'conifer_tree');
            tree.setOrigin(0.5, 0.95); 
            tree.setScale(scale);
            tree.setDepth(y+oy + 20); 
            
            tree.baseSkew = 0;
            tree.origX = x + ox;
            
            group.add(tree);
            this.treeElements.push(tree);
        }
    }

    registerWater(image, y, q, r, group) {
        if (!image.scene) return;
        // 水面はTweenで単純なゆらぎ（波とは別）
        image.scene.tweens.add({
            targets: image,
            alpha: { from: 0.85, to: 1.0 },
            y: '+=2',
            duration: 1500 + Math.random() * 1000,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
    }

    // ★風の波及処理 (毎フレーム呼ばれる)
    update(time) {
        // 時間をスケーリング
        const t = time * 0.0015;
        
        // -----------------------
        // 1. 草の処理 (Grass Wave)
        // -----------------------
        // 波の計算: sin(x * freq + time)
        // 複数の波を合成して複雑な揺れを作る
        
        for (let i = 0; i < this.grassElements.length; i++) {
            const g = this.grassElements[i];
            
            // 画面外のカリング（簡易）
            if (!g.scene) continue;

            // X座標ベースの波 (左から右へ)
            // 大きなうねり + 小さな揺れ
            const wave1 = Math.sin(g.origX * 0.005 - t * 2.0); // 大きな波
            const wave2 = Math.sin(g.origX * 0.02 + g.y * 0.01 - t * 5.0); // 細かい波
            
            // 風の強さ (0〜1)
            // 波の頂点付近だけ強く傾くようにする
            const windForce = (wave1 * 0.6 + wave2 * 0.4);
            
            // ベースの傾き + 風の影響 (右方向に傾く)
            // windForceが正のときだけ大きく傾ける（風は一方通行）
            const lean = Math.max(0, windForce) * 0.6;
            
            g.skewX = g.baseSkew + lean;
        }

        // -----------------------
        // 2. 木の処理 (Tree Sway)
        // -----------------------
        // 木は草より重いので、動きはゆっくり、遅れて反応する
        for (let i = 0; i < this.treeElements.length; i++) {
            const tr = this.treeElements[i];
            if (!tr.scene) continue;

            const wave = Math.sin(tr.origX * 0.003 - t * 1.5);
            // 木は少しだけしなる
            const lean = Math.max(0, wave) * 0.15;
            
            tr.skewX = tr.baseSkew + lean;
        }
    }
}

window.VFX = new VFXSystem();
window.EnvSystem = new EnvSystem();

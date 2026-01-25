/** PHASER VFX & ENV: High-Res Vector Nature & Visible Wind Waves */

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
                // 風の粒子は長く残し、透明度変化で表現
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
        // 画面を横切る白い風のライン
        for (let i = 0; i < 20; i++) {
            this.add({
                x: -300 - Math.random() * 500,
                y: Math.random() * 3000,
                vx: 25 + Math.random() * 10, // 高速
                vy: 2 + Math.random() * 2,
                life: 180,
                color: "#eeffff",
                size: 2, 
                type: 'wind'
            });
        }
        // 環境システムに風イベント通知
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
                graphics.lineTo(p.x - p.vx * 15, p.y - p.vy * 15); // 非常に長い軌跡
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

// ★環境演出システム: Vector-Quality & Heavy Wind Wave
class EnvSystem {
    constructor() {
        this.grassElements = [];
        this.treeElements = [];
        this.gustPower = 0; // 突風の強さ
    }

    preload(scene) {
        // ★重要: 解像度倍率。大きくするほど高精細になる
        const TEXTURE_SCALE = 4.0; 

        // 1. 高精細な草 (Vector Grass Tuft)
        if (!scene.textures.exists('hd_grass')) {
            const size = 64 * TEXTURE_SCALE;
            const g = scene.make.graphics({x:0, y:0, add:false});
            
            // 色のバリエーション (深く、リアルな緑)
            const palettes = [0x2d4c1e, 0x3b5e28, 0x4a7534, 0x55803a];
            
            // 根元の土台 (浮遊感防止)
            g.fillStyle(0x1a2b12, 0.8);
            g.fillEllipse(size/2, size, size/3, size/8);

            // 30本以上の葉を描き込む
            for(let i=0; i<32; i++) {
                const col = palettes[Math.floor(Math.random() * palettes.length)];
                g.lineStyle(2 * TEXTURE_SCALE, col, 1.0); // 太く描いて縮小する
                g.fillStyle(col);

                const startX = size/2 + (Math.random()-0.5) * (size * 0.4);
                const startY = size;
                
                const height = (size * 0.4) + Math.random() * (size * 0.5);
                const lean = (Math.random() - 0.5) * (size * 0.6); // 左右の広がり
                
                const endX = startX + lean;
                const endY = startY - height;
                
                // 制御点
                const ctrlX = startX + lean * 0.3;
                const ctrlY = startY - height * 0.6;

                // 葉の形状（根元が太く、先が細い）
                const curve = new Phaser.Curves.QuadraticBezier(
                    new Phaser.Math.Vector2(startX, startY),
                    new Phaser.Math.Vector2(ctrlX, ctrlY),
                    new Phaser.Math.Vector2(endX, endY)
                );
                curve.draw(g);
            }
            g.generateTexture('hd_grass', size, size);
        }

        // 2. 高精細な針葉樹 (Sharp Vector Conifer)
        if (!scene.textures.exists('hd_tree')) {
            const w = 80 * TEXTURE_SCALE;
            const h = 140 * TEXTURE_SCALE;
            const g = scene.make.graphics({x:0, y:0, add:false});
            
            // 幹
            g.fillStyle(0x221105);
            g.fillRect(w/2 - (w*0.08), h*0.8, w*0.16, h*0.2);

            // 葉（多層レイヤー構造）
            const layers = 5;
            const leafDark = 0x0f2610; // 影側
            const leafLight = 0x1e3d1f; // 光側

            for(let i=0; i<layers; i++) {
                const progress = i / layers;
                const lw = w * (0.8 - progress * 0.6); // 上に行くほど細く
                const lh = h * 0.25;
                const ly = h * 0.8 - (h * 0.7 * progress) - lh;

                const cx = w/2;
                const cy = ly + lh; // 底辺Y

                // 右半分（影）
                g.fillStyle(leafDark);
                g.beginPath();
                g.moveTo(cx, ly);
                g.lineTo(cx + lw/2, cy);
                g.lineTo(cx, cy);
                g.fill();

                // 左半分（光）
                g.fillStyle(leafLight);
                g.beginPath();
                g.moveTo(cx, ly);
                g.lineTo(cx - lw/2, cy);
                g.lineTo(cx, cy);
                g.fill();
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
        // 密度: 1ヘックスに8株 (1株が大きくリッチなので数は控えめでOK)
        // 拡大縮小で密度感を出す
        const count = 12;
        const scaleFactor = 0.25; // 4倍で作って0.25倍で表示 = 高精細

        for(let i=0; i<count; i++) {
            // ランダム配置
            const r = Math.random() * (HEX_SIZE * 0.95);
            const angle = Math.random() * Math.PI * 2;
            const ox = Math.cos(angle) * r;
            const oy = Math.sin(angle) * r * 0.866;

            const grass = scene.add.image(x+ox, y+oy, 'hd_grass');
            grass.setOrigin(0.5, 1.0); 
            // サイズにばらつきを持たせる
            grass.setScale((0.8 + Math.random() * 0.6) * scaleFactor); 
            grass.setDepth(y+oy); 
            
            // 初期設定
            grass.baseSkew = (Math.random()-0.5) * 0.2; // 生え方のクセ
            grass.origX = x + ox; // 波の計算用
            grass.origY = y + oy;
            
            // 色味を少しランダムに変えて単調さを防ぐ
            const tintVar = Math.floor(Math.random() * 40);
            const rVal = 200 + tintVar;
            const gVal = 255;
            const bVal = 200 + tintVar;
            grass.setTint(Phaser.Display.Color.GetColor(rVal, gVal, bVal));

            group.add(grass);
            this.grassElements.push(grass);
        }
    }

    // --- 木の生成 ---
    spawnTrees(scene, group, x, y) {
        const count = 3 + Math.floor(Math.random() * 2);
        const scaleFactor = 0.35; // 高解像度縮小

        for(let i=0; i<count; i++) {
            const r = Math.random() * (HEX_SIZE * 0.7);
            const angle = Math.random() * Math.PI * 2;
            const ox = Math.cos(angle) * r;
            const oy = Math.sin(angle) * r * 0.866;
            
            const localScale = 0.8 + Math.random() * 0.5;
            const finalScale = localScale * scaleFactor;

            // 落ち影
            const shadow = scene.add.ellipse(x+ox, y+oy+5, 40*finalScale, 15*finalScale, 0x000000, 0.5);
            group.add(shadow);

            const tree = scene.add.image(x+ox, y+oy, 'hd_tree');
            tree.setOrigin(0.5, 0.95); 
            tree.setScale(finalScale);
            tree.setDepth(y+oy + 20); // 草より手前
            
            tree.baseSkew = 0;
            tree.origX = x + ox;
            
            group.add(tree);
            this.treeElements.push(tree);
        }
    }

    registerWater(image, y, q, r, group) {
        if (!image.scene) return;
        image.scene.tweens.add({
            targets: image,
            alpha: { from: 0.8, to: 1.0 },
            y: '+=3',
            duration: 1200 + Math.random() * 1000,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
    }

    onGust() {
        // 突風発生フラグ
        this.gustPower = 1.0; 
    }

    // ★風の波及処理: 本気のWave計算
    update(time) {
        const t = time * 0.002; // 時間
        
        // 突風の減衰
        this.gustPower *= 0.98;
        if(this.gustPower < 0.01) this.gustPower = 0;

        // 1. 草の処理 (Grass Wave)
        // 破棄されたオブジェクトのクリーンアップ
        this.grassElements = this.grassElements.filter(g => g.scene);
        
        for (let i = 0; i < this.grassElements.length; i++) {
            const g = this.grassElements[i];
            
            // X座標による位相ズレ（これが波に見える正体）
            // freq: 周波数 (波の細かさ), speed: 速度
            const xPhase = g.origX * 0.008; 
            
            // 基本のそよぎ (常に動いている)
            const baseSway = Math.sin(t + xPhase) * 0.15; 
            
            // 風のうねり (大きくゆっくりした波)
            const hugeWave = Math.sin(t * 0.5 + g.origX * 0.002) * 0.1;

            // 突風の影響 (Gust)
            // 突風は右方向へ一気に傾ける
            const gustEffect = this.gustPower * 0.8;

            // ノイズ的な揺らぎ
            const jitter = Math.sin(t * 5 + g.origY) * 0.05;

            // 合成: 基本傾き + そよぎ + うねり + 突風
            // 風は基本的に右(プラス方向)に吹くものとする
            const totalSkew = g.baseSkew + Math.abs(baseSway + hugeWave) + gustEffect + jitter;
            
            g.skewX = totalSkew;
        }

        // 2. 木の処理 (Tree Sway)
        this.treeElements = this.treeElements.filter(tr => tr.scene);
        
        for (let i = 0; i < this.treeElements.length; i++) {
            const tr = this.treeElements[i];
            
            // 木は硬いので動きは小さいが、遅れて動く
            const xPhase = tr.origX * 0.005;
            const sway = Math.sin(t * 0.8 + xPhase) * 0.05;
            
            // 突風には遅れて反応する
            const gustEffect = this.gustPower * 0.15;

            tr.skewX = tr.baseSkew + sway + gustEffect;
        }
    }
}

window.VFX = new VFXSystem();
window.EnvSystem = new EnvSystem();

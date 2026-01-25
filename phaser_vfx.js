/** PHASER VFX & ENV: ULTIMATE NATURE (Inertia Physics & High Density) */

class VFXSystem {
    constructor() {
        this.particles = [];
        this.windTimer = 0;
    }

    update() {
        // --- Wind Gust Particles (Visual Only) ---
        this.windTimer++;
        if (this.windTimer > 120 + Math.random() * 120) {
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
                // 風の粒子: 高速で透明度変化
                p.alpha = Math.sin((p.life / p.maxLife) * Math.PI) * 0.15; 
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
        // 画面を横切る疾走感のある風
        for (let i = 0; i < 25; i++) {
            this.add({
                x: -300 - Math.random() * 500,
                y: Math.random() * 3000,
                vx: 25 + Math.random() * 15,
                vy: 2 + Math.random() * 2,
                life: 120,
                color: "#ddffff",
                size: 1.5, 
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
                graphics.lineStyle(1.5, 0xffffff, p.alpha);
                graphics.beginPath();
                graphics.moveTo(p.x, p.y);
                graphics.lineTo(p.x - p.vx * 12, p.y - p.vy * 12); 
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

// ★環境演出システム: 物理挙動風シミュレーション
class EnvSystem {
    constructor() {
        this.grassElements = [];
        this.treeElements = [];
        this.gustPower = 0;
        this.waveTime = 0;
    }

    preload(scene) {
        const TEXTURE_SCALE = 4.0; // 高解像度生成

        // 1. 究極の草 (High-Density Blade Bundle)
        if (!scene.textures.exists('ultra_grass')) {
            const size = 64 * TEXTURE_SCALE;
            const g = scene.make.graphics({x:0, y:0, add:false});
            const palettes = [0x224411, 0x335522, 0x446633, 0x1a330a]; // 渋い緑
            
            // 根本の影
            g.fillStyle(0x112205, 0.9);
            g.fillEllipse(size/2, size, size/4, size/10);

            // 50本の葉を描き込む（処理負荷上等！）
            for(let i=0; i<50; i++) {
                const col = palettes[Math.floor(Math.random() * palettes.length)];
                // 根本は太く、先は細く
                g.lineStyle(1.5 * TEXTURE_SCALE, col, 1.0);
                
                // 根元: 中心に一点集中させて「束感」を出す
                const startX = size/2 + (Math.random()-0.5) * (size * 0.1); // ばらつき小
                const startY = size;
                
                const len = (size * 0.5) + Math.random() * (size * 0.5);
                const lean = (Math.random() - 0.5) * (size * 0.8); // 上部は広がる
                
                const endX = startX + lean;
                const endY = startY - len;
                
                // 制御点: 根元付近は直立させることで「株」っぽくする
                const ctrlX = startX + lean * 0.1; 
                const ctrlY = startY - len * 0.4;

                const curve = new Phaser.Curves.QuadraticBezier(
                    new Phaser.Math.Vector2(startX, startY),
                    new Phaser.Math.Vector2(ctrlX, ctrlY),
                    new Phaser.Math.Vector2(endX, endY)
                );
                curve.draw(g);
            }
            g.generateTexture('ultra_grass', size, size);
        }

        // 2. 針葉樹
        if (!scene.textures.exists('hd_tree')) {
            const w = 80 * TEXTURE_SCALE; const h = 140 * TEXTURE_SCALE;
            const g = scene.make.graphics({x:0, y:0, add:false});
            g.fillStyle(0x221105); g.fillRect(w/2 - (w*0.08), h*0.8, w*0.16, h*0.2);
            const layers = 6; // レイヤー増量
            const leafDark = 0x0f2610; const leafLight = 0x1e3d1f;
            for(let i=0; i<layers; i++) {
                const progress = i / layers; const lw = w * (0.8 - progress * 0.6); const lh = h * 0.22; const ly = h * 0.8 - (h * 0.75 * progress) - lh; const cx = w/2; const cy = ly + lh;
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

    // --- 草の生成: 小さく、大量に ---
    spawnGrass(scene, group, x, y) {
        // ★超大量配置: 1ヘックスに60株 (地面を埋める)
        const count = 60;
        const scaleFactor = 0.12; // 非常に小さく (緻密に見せる)

        for(let i=0; i<count; i++) {
            const r = Math.random() * (HEX_SIZE * 1.0); // ヘックスからはみ出るくらい広げる
            const angle = Math.random() * Math.PI * 2;
            const ox = Math.cos(angle) * r;
            const oy = Math.sin(angle) * r * 0.866;

            const grass = scene.add.image(x+ox, y+oy, 'ultra_grass');
            grass.setOrigin(0.5, 1.0); 
            grass.setScale((0.8 + Math.random() * 0.4) * scaleFactor); 
            grass.setDepth(y+oy); 
            
            // 現在の物理状態 (慣性用)
            grass.currentSkew = (Math.random()-0.5) * 0.1;
            grass.targetSkew = 0;
            grass.baseSkew = grass.currentSkew; // デフォルトの姿勢
            
            grass.origX = x + ox;
            grass.origY = y + oy;
            
            // 色むら
            const tintVar = Math.floor(Math.random() * 30);
            grass.setTint(Phaser.Display.Color.GetColor(180 + tintVar, 220 + tintVar, 180 + tintVar));

            group.add(grass);
            this.grassElements.push(grass);
        }
    }

    spawnTrees(scene, group, x, y) {
        // 本数倍増
        const count = 10 + Math.floor(Math.random() * 5);
        const scaleFactor = 0.18; // 小さく

        for(let i=0; i<count; i++) {
            const r = Math.random() * (HEX_SIZE * 0.9);
            const angle = Math.random() * Math.PI * 2;
            const ox = Math.cos(angle) * r;
            const oy = Math.sin(angle) * r * 0.866;
            
            const scale = (0.7 + Math.random() * 0.6) * scaleFactor;

            const shadow = scene.add.ellipse(x+ox, y+oy+3, 40*scale, 15*scale, 0x000000, 0.5);
            group.add(shadow);

            const tree = scene.add.image(x+ox, y+oy, 'hd_tree');
            tree.setOrigin(0.5, 0.95); 
            tree.setScale(scale);
            tree.setDepth(y+oy + 20); 
            
            tree.currentSkew = 0;
            tree.baseSkew = 0;
            tree.origX = x + ox;
            
            group.add(tree);
            this.treeElements.push(tree);
        }
    }

    // ★復活: 海のアニメーション
    registerWater(image, y, q, r, group) {
        if (!image.scene) return;
        image.scene.tweens.add({
            targets: image,
            alpha: { from: 0.85, to: 1.0 },
            y: '+=3',
            scaleX: { from: 1.0/window.HIGH_RES_SCALE, to: 1.02/window.HIGH_RES_SCALE },
            duration: 1500 + Math.random() * 1000,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
    }

    onGust() {
        this.gustPower = 1.0; 
    }

    // ★重要: 慣性(Inertia)を用いたスムーズかつダイナミックな風計算
    update(time) {
        // 自前タイマー進行
        this.waveTime += 0.04; 
        const t = this.waveTime;
        
        // 突風の減衰 (ゆっくり)
        this.gustPower *= 0.96;
        if(this.gustPower < 0.01) this.gustPower = 0;

        // 1. 草の処理 (High-Density Inertia Grass)
        // 画面外も含む全草を計算（ウェーブの連続性のため）
        // ※重い場合はここを間引くが、今回はクオリティ優先
        
        const windDir = 1.0; // 風は右へ

        this.grassElements = this.grassElements.filter(g => g.scene);
        for (let i = 0; i < this.grassElements.length; i++) {
            const g = this.grassElements[i];
            
            // ① 風の波を計算
            // 大きな波 + 速いさざ波 + 突風
            const bigWave = Math.sin(g.origX * 0.005 - t * 0.8); // ゆっくり大きな波
            const ripple = Math.sin(g.origX * 0.02 + g.origY * 0.02 - t * 2.5); // 速い波
            
            // 風力 (0.0〜1.0 に正規化せず、波の強弱をそのまま使う)
            // 基本風速(0.2) + 波の影響
            let windForce = 0.2 + (bigWave * 0.4) + (ripple * 0.2);
            
            // 突風加算
            windForce += this.gustPower * 1.5;

            // ② 目標角度を決定 (右へ傾く)
            // 風が強いほど大きく傾く。マイナス（逆風）はクリップして0（直立）にする
            const targetSkew = Math.max(0, windForce) * 0.8; 

            // ③ 慣性処理 (Lerp)
            // 現在の値を目標値に少しずつ近づける
            // これにより「カクっ」とせず、弾力のある動きになる
            const stiffness = 0.1; // 草の硬さ（小さいほどゆっくり追従＝柔らかい）
            g.currentSkew += (targetSkew - g.currentSkew) * stiffness;
            
            // 適用
            g.skewX = g.baseSkew + g.currentSkew;
            
            // 「しなり」表現: 傾くと少し背が低くなる（押しつぶされる）
            g.scaleY = (1.0 - Math.abs(g.currentSkew) * 0.3) * g.scaleX; // scaleXを基準にアスペクト比維持しつつ潰す
        }

        // 2. 木の処理 (Heavy Tree Sway)
        this.treeElements = this.treeElements.filter(tr => tr.scene);
        for (let i = 0; i < this.treeElements.length; i++) {
            const tr = this.treeElements[i];
            
            // 木はよりゆっくり、大きな波にのみ反応
            const wave = Math.sin(tr.origX * 0.003 - t * 0.5);
            const gust = this.gustPower * 0.5;
            
            const targetSkew = Math.max(0, wave * 0.3 + 0.1) * 0.4 + gust;
            
            // 木は硬いので追従係数(stiffness)を小さく
            tr.currentSkew += (targetSkew - tr.currentSkew) * 0.03;
            
            tr.skewX = tr.baseSkew + tr.currentSkew;
        }
    }
}

window.VFX = new VFXSystem();
window.EnvSystem = new EnvSystem();

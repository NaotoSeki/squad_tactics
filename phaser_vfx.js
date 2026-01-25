/** PHASER VFX & ENV: Coniferous Forests, Bushy Grass, and Wind */

class VFXSystem {
    constructor() {
        this.particles = [];
        this.windTimer = 0; // 風の発生用タイマー
    }

    update() {
        // --- Global Wind System ---
        this.windTimer++;
        if (this.windTimer > 400 + Math.random() * 200) {
            this.triggerWindGust();
            this.windTimer = 0;
        }

        // --- Particles Update ---
        for (let i = this.particles.length - 1; i >= 0; i--) {
            let p = this.particles[i];
            if (p.delay > 0) { p.delay--; continue; }
            
            p.life--;
            p.x += p.vx;
            p.y += p.vy;
            
            if (p.type === 'wind') {
                p.alpha = Math.min(1, p.life / 20) * 0.3; // フェードイン・アウト
            } 
            else if (p.type === 'proj') {
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
        // 画面全体を左から右へ流れる風のパーティクル
        for (let i = 0; i < 40; i++) {
            this.add({
                x: -50 - Math.random() * 200,
                y: Math.random() * 2000, // 画面縦幅適当にカバー
                vx: 10 + Math.random() * 5,
                vy: 2 + Math.random() * 2,
                life: 150,
                color: "#ffffff",
                size: 1 + Math.random() * 2, // 線状に描画するためサイズは細く
                type: 'wind'
            });
        }
        
        // 草木を一斉になびかせるイベント発火 (EnvSystem側で処理)
        if (window.EnvSystem) window.EnvSystem.applyWind();
    }

    draw(graphics) {
        graphics.clear();
        this.particles.forEach(p => {
            if (p.delay > 0) return;
            
            if (p.type === 'wind') {
                // 風は線で描画
                graphics.lineStyle(1, 0xffffff, p.alpha);
                graphics.beginPath();
                graphics.moveTo(p.x, p.y);
                graphics.lineTo(p.x - p.vx * 3, p.y - p.vy * 3); // 軌跡
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

// ★環境演出システム (針葉樹 & 藪)
class EnvSystem {
    constructor() {
        this.grassElements = []; // 風の影響を受けるオブジェクトリスト
        this.treeElements = [];
    }

    preload(scene) {
        // 1. 藪のような草 (根元から生える)
        if (!scene.textures.exists('bushy_grass')) {
            const g = scene.make.graphics({x:0, y:0, add:false});
            const colors = [0x558833, 0x669944, 0x447722];
            
            // 下から上へ広がる草の束を描く
            for(let i=0; i<8; i++) {
                g.lineStyle(2, colors[i%3], 1.0);
                g.beginPath();
                g.moveTo(10, 20); // 根元は中心下
                // 放射状に広げる
                const spread = (Math.random() - 0.5) * 16;
                const height = 12 + Math.random() * 8;
                g.lineTo(10 + spread, 20 - height);
                g.strokePath();
            }
            g.generateTexture('bushy_grass', 20, 20);
        }

        // 2. 針葉樹 (Conifer)
        if (!scene.textures.exists('conifer_tree')) {
            const g = scene.make.graphics({x:0, y:0, add:false});
            
            // 幹
            g.fillStyle(0x332211);
            g.fillRect(12, 40, 6, 10); // 下部のみ

            // 葉（三角形を3段重ねる）
            const leafColor = 0x1a3311; // 濃い緑
            const highlight = 0x2b441f;
            
            // 下段
            g.fillStyle(leafColor);
            g.fillTriangle(0, 45, 30, 45, 15, 20);
            g.fillStyle(highlight); // 左側ハイライト
            g.beginPath(); g.moveTo(15, 20); g.lineTo(0, 45); g.lineTo(15, 45); g.fill();

            // 中段
            g.fillStyle(leafColor);
            g.fillTriangle(2, 30, 28, 30, 15, 10);
            
            // 上段
            g.fillStyle(leafColor);
            g.fillTriangle(5, 15, 25, 15, 15, 0);

            g.generateTexture('conifer_tree', 30, 50);
        }
    }

    clear() {
        this.grassElements = [];
        this.treeElements = [];
    }

    spawnGrass(scene, group, x, y) {
        // 1ヘックスに藪を点在させる
        const count = 6 + Math.floor(Math.random() * 4);
        for(let i=0; i<count; i++) {
            const r = Math.random() * (HEX_SIZE * 0.8);
            const angle = Math.random() * Math.PI * 2;
            const ox = Math.cos(angle) * r;
            const oy = Math.sin(angle) * r * 0.866;

            const grass = scene.add.image(x+ox, y+oy, 'bushy_grass');
            grass.setOrigin(0.5, 1.0); // 根元を基準に
            grass.setScale(0.8 + Math.random() * 0.4);
            grass.setDepth(y+oy); // 手前の草が奥の草を隠す
            
            // 地面の色に少し馴染ませる
            grass.setTint(0xddffdd);
            
            group.add(grass);
            this.grassElements.push(grass);
        }
    }

    spawnTrees(scene, group, x, y) {
        // 針葉樹を複数本、密集させる
        const count = 3 + Math.floor(Math.random() * 3);
        
        // 密集感を出すため、少し中心寄りに集める
        for(let i=0; i<count; i++) {
            const r = Math.random() * (HEX_SIZE * 0.6);
            const angle = Math.random() * Math.PI * 2;
            const ox = Math.cos(angle) * r;
            const oy = Math.sin(angle) * r * 0.866;
            
            const scale = 0.8 + Math.random() * 0.5;

            // 影（地面に落ちる丸い影）
            const shadow = scene.add.ellipse(x+ox, y+oy+3, 20*scale, 10*scale, 0x000000, 0.4);
            group.add(shadow);

            const tree = scene.add.image(x+ox, y+oy, 'conifer_tree');
            tree.setOrigin(0.5, 0.9); // 根元付近を基準点に
            tree.setScale(scale);
            tree.setDepth(y+oy + 10); // 木は草より手前に来やすい
            
            group.add(tree);
            this.treeElements.push(tree);
        }
    }

    registerWater(image, y, q, r, group) {
        if (!image.scene) return;
        image.scene.tweens.add({
            targets: image,
            alpha: { from: 0.8, to: 1.0 },
            y: '+=2',
            duration: 1500 + Math.random() * 1000,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
    }

    applyWind() {
        // 突風が吹いたときの揺れアニメーション
        
        // 草: 大きく倒れる
        this.grassElements.forEach(g => {
            if(!g.scene) return;
            g.scene.tweens.add({
                targets: g,
                angle: { from: 0, to: 15 }, // 右に傾く
                scaleX: { from: g.scaleX, to: g.scaleX * 0.9 }, // 少し潰れる
                duration: 300,
                yoyo: true,
                ease: 'Cubic.out'
            });
        });

        // 木: 幹ごとしなるのではなく、少し揺れる
        this.treeElements.forEach(t => {
            if(!t.scene) return;
            t.scene.tweens.add({
                targets: t,
                angle: { from: 0, to: 5 },
                duration: 500,
                yoyo: true,
                ease: 'Sine.out',
                delay: Math.random() * 100 // ずらす
            });
        });
    }

    update(time) {}
}

window.VFX = new VFXSystem();
window.EnvSystem = new EnvSystem();

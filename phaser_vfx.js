/** PHASER VFX & ENV: Realistic Sway, Density, and Gusts (Fixed Skew) */

class VFXSystem {
    constructor() {
        this.emitters = [];
        this.particles = [];
        this.scene = null;
        this.shakeRequest = 0;
        this.windTimer = 0;
    }

    update() {
        // --- Wind Gust System ---
        this.windTimer++;
        if (this.windTimer > 300 + Math.random() * 300) { // 頻度調整
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
                p.alpha = Math.min(1, p.life / 30) * 0.15; // 淡く
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
        // 画面全体を流れる淡い風の線
        for (let i = 0; i < 50; i++) {
            this.add({
                x: -100 - Math.random() * 300,
                y: Math.random() * 2000,
                vx: 15 + Math.random() * 10, // 速い
                vy: 2 + Math.random() * 2,
                life: 200,
                color: "#ccffff",
                size: 1, // 細い線
                type: 'wind'
            });
        }
        // 環境オブジェクトへの影響
        if (window.EnvSystem) window.EnvSystem.applyWind();
    }

    draw(graphics) {
        graphics.clear();
        this.particles.forEach(p => {
            if (p.delay > 0) return;
            
            if (p.type === 'wind') {
                graphics.lineStyle(1, 0xffffff, p.alpha);
                graphics.beginPath();
                graphics.moveTo(p.x, p.y);
                graphics.lineTo(p.x - p.vx * 4, p.y - p.vy * 4); // 長い軌跡
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

// ★環境演出システム: 密度の高い草木 & しなる風
class EnvSystem {
    constructor() {
        this.grassElements = [];
        this.treeElements = [];
    }

    preload(scene) {
        // 1. 藪のような草 (深い緑)
        if (!scene.textures.exists('bushy_grass')) {
            const g = scene.make.graphics({x:0, y:0, add:false});
            const colors = [0x335522, 0x446633, 0x224411]; 
            
            for(let i=0; i<12; i++) {
                g.lineStyle(1.5, colors[Math.floor(Math.random() * colors.length)], 0.9);
                
                const rootX = 10 + (Math.random()-0.5)*4;
                const rootY = 20;
                const tipX = rootX + (Math.random()-0.5) * 12;
                const tipY = 20 - (8 + Math.random() * 8);
                
                // 制御点 (少し曲げる)
                const midX = (rootX + tipX)/2 + (Math.random()-0.5)*4;
                const midY = (rootY + tipY)/2;

                // Phaser.Curves.QuadraticBezier を使用して描画
                const curve = new Phaser.Curves.QuadraticBezier(
                    new Phaser.Math.Vector2(rootX, rootY),
                    new Phaser.Math.Vector2(midX, midY),
                    new Phaser.Math.Vector2(tipX, tipY)
                );
                const points = curve.getPoints(4);
                g.strokePoints(points);
            }
            g.generateTexture('bushy_grass', 20, 20);
        }

        // 2. 針葉樹 (Conifer)
        if (!scene.textures.exists('conifer_tree')) {
            const g = scene.make.graphics({x:0, y:0, add:false});
            g.fillStyle(0x332211); g.fillRect(13, 45, 4, 10);
            const leafColor = 0x113311; const highlight = 0x224422;
            const drawLayer = (y, w, h) => {
                g.fillStyle(leafColor); g.fillTriangle(15, y-h, 15-w/2, y, 15+w/2, y);
                g.fillStyle(highlight); g.beginPath(); g.moveTo(15, y-h); g.lineTo(15-w/2, y); g.lineTo(15, y); g.fill();
            };
            drawLayer(45, 30, 20); drawLayer(30, 24, 18); drawLayer(18, 18, 15);
            g.generateTexture('conifer_tree', 30, 55);
        }
    }

    clear() {
        this.grassElements = [];
        this.treeElements = [];
    }

    spawnGrass(scene, group, x, y) {
        // ★倍増: 1ヘックスに大量の藪
        const count = 12 + Math.floor(Math.random() * 8);
        for(let i=0; i<count; i++) {
            const r = Math.random() * (HEX_SIZE * 0.9);
            const angle = Math.random() * Math.PI * 2;
            const ox = Math.cos(angle) * r;
            const oy = Math.sin(angle) * r * 0.866;

            const grass = scene.add.image(x+ox, y+oy, 'bushy_grass');
            grass.setOrigin(0.5, 1.0); 
            grass.setScale(0.8 + Math.random() * 0.5);
            grass.setDepth(y+oy); 
            grass.baseSkew = (Math.random()-0.5) * 0.1; // 個体差
            
            // ★修正: setSkewX ではなくプロパティに代入
            grass.skewX = grass.baseSkew;
            
            // 地面色に馴染ませる
            grass.setTint(0xaaddaa);
            
            group.add(grass);
            this.grassElements.push(grass);

            // 独立したそよぎ
            scene.tweens.add({
                targets: grass,
                skewX: { from: grass.baseSkew - 0.15, to: grass.baseSkew + 0.15 },
                duration: 1500 + Math.random() * 2000,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut',
                delay: Math.random() * 3000
            });
        }
    }

    spawnTrees(scene, group, x, y) {
        // ★倍増: 針葉樹の森
        const count = 5 + Math.floor(Math.random() * 4);
        
        for(let i=0; i<count; i++) {
            const r = Math.random() * (HEX_SIZE * 0.8);
            const angle = Math.random() * Math.PI * 2;
            const ox = Math.cos(angle) * r;
            const oy = Math.sin(angle) * r * 0.866;
            
            const scale = 0.7 + Math.random() * 0.6;

            // 影
            const shadow = scene.add.ellipse(x+ox, y+oy, 20*scale, 10*scale, 0x000000, 0.4);
            group.add(shadow);

            const tree = scene.add.image(x+ox, y+oy, 'conifer_tree');
            tree.setOrigin(0.5, 0.95); 
            tree.setScale(scale);
            tree.setDepth(y+oy + 20); 
            tree.baseSkew = 0;
            
            group.add(tree);
            this.treeElements.push(tree);

            // 木のそよぎ (Skewを使って幹をしならせる)
            scene.tweens.add({
                targets: tree,
                skewX: { from: -0.02, to: 0.02 },
                duration: 2500 + Math.random() * 1500,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut',
                delay: Math.random() * 2000
            });
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

    // ★風発生時の反応 (しなる)
    applyWind() {
        // 草: 大きく傾く
        this.grassElements.forEach(g => {
            if(!g.scene) return;
            g.scene.tweens.add({
                targets: g,
                skewX: 0.5, // 右に大きく歪む
                angle: 10,
                duration: 400,
                yoyo: true,
                ease: 'Cubic.out'
            });
        });

        // 木: 重くしなる
        this.treeElements.forEach(t => {
            if(!t.scene) return;
            // 遠くの木から順に揺れるような遅延を入れるとベストだが、ここではランダム
            t.scene.tweens.add({
                targets: t,
                skewX: 0.15, 
                duration: 800,
                yoyo: true,
                ease: 'Sine.out',
                delay: Math.random() * 200
            });
        });
    }

    update(time) {}
}

window.VFX = new VFXSystem();
window.EnvSystem = new EnvSystem();

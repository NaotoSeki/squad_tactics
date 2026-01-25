/** PHASER VFX & ENV: Realistic Nature & Safe Colors */

class VFXSystem {
    constructor() {
        this.emitters = [];
        this.particles = [];
        this.scene = null;
        this.shakeRequest = 0;
    }

    update() {
        // Particles Update
        for (let i = this.particles.length - 1; i >= 0; i--) {
            let p = this.particles[i];
            if (p.delay > 0) { p.delay--; continue; }
            
            p.life--;
            p.x += p.vx;
            p.y += p.vy;
            
            if (p.type === 'proj') {
                // Projectile logic
                p.progress += p.speed;
                let t = p.progress;
                if (t >= 1) t = 1;
                
                const dx = p.ex - p.sx;
                const dy = p.ey - p.sy;
                
                p.x = p.sx + dx * t;
                p.y = p.sy + dy * t;
                
                // Arc
                if (p.arcHeight > 0) {
                    p.y -= Math.sin(t * Math.PI) * p.arcHeight;
                }

                if (t >= 1) {
                    if (typeof p.onHit === 'function') {
                        p.onHit();
                    }
                    p.life = 0; 
                }
            } else {
                // Normal particle physics
                p.vy += 0.2; // Gravity
            }

            if (p.life <= 0) {
                this.particles.splice(i, 1);
            }
        }
    }

    draw(graphics) {
        graphics.clear();
        this.particles.forEach(p => {
            if (p.delay > 0) return;
            const alpha = p.life / p.maxLife;
            
            graphics.fillStyle(this.hexToInt(p.color), alpha);
            
            if (p.type === 'proj') {
                graphics.fillCircle(p.x, p.y, 3);
            } else if(p.type === 'smoke') {
                graphics.fillCircle(p.x, p.y, p.size * (2-alpha));
            } else if(p.type === 'spark') {
                graphics.fillRect(p.x, p.y, p.size, p.size);
            } else {
                graphics.fillCircle(p.x, p.y, p.size);
            }
        });
    }

    add(p) {
        p.life = p.life || 60;
        p.maxLife = p.life;
        p.vx = p.vx || 0;
        p.vy = p.vy || 0;
        p.delay = p.delay || 0;
        if (!p.color) p.color = "#ffffff";
        this.particles.push(p);
    }

    addExplosion(x, y, color, count) {
        this.shakeRequest = 5;
        for(let i=0; i<count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 3 + 1;
            this.add({
                x: x, y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 2,
                color: color,
                size: Math.random() * 4 + 2,
                life: 30 + Math.random() * 20,
                type: 'spark'
            });
        }
        for(let i=0; i<count/2; i++) {
            this.add({
                x: x, y: y,
                vx: (Math.random()-0.5),
                vy: -Math.random()*2,
                color: "#555",
                size: 5,
                life: 60,
                type: 'smoke'
            });
        }
    }

    addSmoke(x, y) {
        this.add({
            x: x, y: y,
            vx: (Math.random()-0.5)*0.5,
            vy: -0.5 - Math.random()*0.5,
            color: "#888",
            size: 4,
            life: 80,
            type: 'smoke'
        });
    }

    addFire(x, y) {
        this.add({
            x: x, y: y,
            vx: (Math.random()-0.5),
            vy: -1 - Math.random(),
            color: "#fa0",
            size: 3,
            life: 40,
            type: 'spark'
        });
    }

    addProj(params) {
        params.type = 'proj';
        params.life = 999;
        if (!params.color) params.color = "#ffffaa"; 
        this.add(params);
    }

    addUnitDebris(x, y) {
        for(let i=0; i<8; i++) {
            this.add({
                x: x, y: y,
                vx: (Math.random()-0.5)*4,
                vy: -Math.random()*5,
                color: "#422",
                size: 3,
                life: 100,
                type: 'spark'
            });
        }
    }

    hexToInt(hex) {
        if (hex === undefined || hex === null) return 0xffffff;
        if (typeof hex === 'number') return hex;
        if (typeof hex !== 'string') return 0xffffff;
        return parseInt(hex.replace('#', '0x'), 16);
    }
}

// ★リアルな環境演出システム (EnvSystem)
class EnvSystem {
    constructor() {
        this.elements = [];
    }

    preload(scene) {
        // ★リアルな草のテクスチャ生成
        if (!scene.textures.exists('grass_tuft')) {
            const g = scene.make.graphics({x:0, y:0, add:false});
            // 複数の色の細い線を描いて「ふさふさ感」を出す
            const colors = [0x66aa44, 0x77bb55, 0x559933, 0x88cc66];
            for(let i=0; i<12; i++) {
                g.lineStyle(1 + Math.random(), colors[Math.floor(Math.random() * colors.length)], 0.8);
                const h = 10 + Math.random() * 8;
                const bend = (Math.random() - 0.5) * 5;
                g.beginPath();
                g.moveTo((Math.random()-0.5)*4, 0);
                g.quadraticBezierTo(bend, -h/2, (Math.random()-0.5)*6, -h);
                g.strokePath();
            }
            g.generateTexture('grass_tuft', 20, 20);
        }
        
        // ★リアルな木のテクスチャ生成 (幹と樹冠)
        if (!scene.textures.exists('tree_trunk')) {
            const g = scene.make.graphics({x:0, y:0, add:false});
            g.fillStyle(0x554433); g.fillRect(0, 0, 8, 16);
            g.fillStyle(0x443322); g.fillRect(1, 1, 6, 14); // 影
            g.generateTexture('tree_trunk', 8, 16);
        }
        if (!scene.textures.exists('real_tree_crown')) {
            const g = scene.make.graphics({x:0, y:0, add:false});
            // 複数の円を重ねてモコモコ感を出す
            const colors = [0x225511, 0x336622, 0x1a440a];
            for(let i=0; i<5; i++) {
                g.fillStyle(colors[i%colors.length], 0.8);
                const r = 15 + Math.random() * 10;
                g.fillCircle(32 + (Math.random()-0.5)*20, 32 + (Math.random()-0.5)*15, r);
            }
            // ハイライト
            g.fillStyle(0x448833, 0.3);
            g.fillCircle(32 - 10, 32 - 10, 12);
            
            g.generateTexture('real_tree_crown', 64, 64);
        }
    }

    clear() {
        this.elements = [];
    }

    spawnGrass(scene, group, x, y) {
        // ★1ヘックスに大量の草を生やす
        const count = 12 + Math.floor(Math.random() * 6);
        for(let i=0; i<count; i++) {
            // ヘックス内にランダム配置 (簡易的な円形分布)
            const r = Math.random() * HEX_SIZE * 0.8;
            const angle = Math.random() * Math.PI * 2;
            const ox = Math.cos(angle) * r;
            const oy = Math.sin(angle) * r * 0.866; // 縦をつぶす

            const grass = scene.add.image(x+ox, y+oy, 'grass_tuft');
            grass.setOrigin(0.5, 1.0);
            grass.setScale(0.8 + Math.random() * 0.4);
            grass.setAlpha(0.9);
            grass.setDepth(y + oy); // 奥行きソート
            group.add(grass);
            
            // 自然な風の揺らぎ
            scene.tweens.add({
                targets: grass,
                angle: { from: -3 - Math.random()*2, to: 3 + Math.random()*2 },
                duration: 1500 + Math.random() * 1500,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut',
                delay: Math.random() * 2000
            });
        }
    }

    spawnTrees(scene, group, x, y) {
        // ★1ヘックスに複数の木を鬱蒼と生やす
        const count = 2 + Math.floor(Math.random() * 3);
        for(let i=0; i<count; i++) {
            const r = Math.random() * HEX_SIZE * 0.6;
            const angle = Math.random() * Math.PI * 2;
            const ox = Math.cos(angle) * r;
            const oy = Math.sin(angle) * r * 0.866;
            const scale = 0.8 + Math.random() * 0.5;

            const trunk = scene.add.image(x+ox, y+oy+8*scale, 'tree_trunk').setOrigin(0.5, 1.0).setScale(scale);
            trunk.setDepth(y+oy);
            group.add(trunk);
            
            const crown = scene.add.image(x+ox, y+oy-10*scale, 'real_tree_crown').setOrigin(0.5, 0.6).setScale(scale);
            crown.setDepth(y+oy+1); // 幹より手前
            group.add(crown);

            // 樹冠のゆったりした揺れ
            scene.tweens.add({
                targets: crown,
                angle: { from: -1, to: 1 },
                scaleX: { from: scale, to: scale*1.02 },
                duration: 2500 + Math.random() * 1000,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut',
                delay: Math.random() * 1000
            });
        }
    }

    registerWater(image, y, q, r, group) {
        if (!image.scene) return;
        // 水面のゆらぎ (スケールと透明度)
        image.scene.tweens.add({
            targets: image,
            alpha: { from: 0.85, to: 1.0 },
            scaleX: { from: 1.0/window.HIGH_RES_SCALE, to: 1.02/window.HIGH_RES_SCALE },
            scaleY: { from: 1.0/window.HIGH_RES_SCALE, to: 0.98/window.HIGH_RES_SCALE },
            duration: 2000 + Math.random() * 1000,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
    }

    update(time) { }
}

window.VFX = new VFXSystem();
window.EnvSystem = new EnvSystem();

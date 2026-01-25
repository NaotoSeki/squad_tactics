/** PHASER VFX & ENV: Fixed Projectile Color Crash */

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
            
            // ★修正: 色変換を安全に行う
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
        // デフォルト色がない場合は白
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
        // ★修正: 弾丸のデフォルト色を設定 (黄色っぽい色)
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

    // ★修正: 安全な色変換 (undefined対策)
    hexToInt(hex) {
        if (hex === undefined || hex === null) return 0xffffff; // デフォルト白
        if (typeof hex === 'number') return hex;
        // 文字列でない場合のエラー回避
        if (typeof hex !== 'string') return 0xffffff;
        return parseInt(hex.replace('#', '0x'), 16);
    }
}

// 環境演出システム (EnvSystem)
class EnvSystem {
    constructor() {
        this.elements = [];
    }

    preload(scene) {
        // 環境用テクスチャ生成
        if (!scene.textures.exists('grass_blade')) {
            const g = scene.make.graphics({x:0, y:0, add:false});
            g.fillStyle(0x66aa44);
            g.beginPath();
            g.moveTo(0, 10); g.lineTo(2, 0); g.lineTo(4, 10);
            g.fillPath();
            g.generateTexture('grass_blade', 4, 10);
        }
        if (!scene.textures.exists('tree_crown')) {
            const g = scene.make.graphics({x:0, y:0, add:false});
            g.fillStyle(0x336622);
            g.fillCircle(15, 15, 15);
            g.generateTexture('tree_crown', 30, 30);
        }
    }

    clear() {
        this.elements = [];
    }

    spawnGrass(scene, group, x, y) {
        // 草を数本生やす
        for(let i=0; i<3; i++) {
            const ox = (Math.random()-0.5)*30;
            const oy = (Math.random()-0.5)*30;
            const grass = scene.add.image(x+ox, y+oy, 'grass_blade');
            grass.setOrigin(0.5, 1.0);
            grass.setAlpha(0.8);
            group.add(grass);
            
            // 揺れアニメーション
            scene.tweens.add({
                targets: grass,
                angle: { from: -5, to: 5 },
                duration: 1000 + Math.random() * 1000,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut',
                delay: Math.random() * 1000
            });
        }
    }

    spawnTrees(scene, group, x, y) {
        // 木を生やす
        const trunk = scene.add.rectangle(x, y+5, 6, 12, 0x443322);
        group.add(trunk);
        
        const crown = scene.add.image(x, y-5, 'tree_crown');
        crown.setAlpha(0.9);
        group.add(crown);

        // 木の揺れ
        scene.tweens.add({
            targets: crown,
            scaleX: { from: 1.0, to: 1.05 },
            scaleY: { from: 1.0, to: 0.95 },
            duration: 2000 + Math.random() * 500,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
    }

    registerWater(image, y, q, r, group) {
        // 水面のキラキラ
        if (!image.scene) return;
        image.scene.tweens.add({
            targets: image,
            alpha: { from: 0.8, to: 1.0 },
            duration: 1500 + Math.random() * 1000,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
    }

    update(time) {
        // 風などのグローバル影響があればここで計算
    }
}

window.VFX = new VFXSystem();
window.EnvSystem = new EnvSystem();

class VFXSystem {
    constructor() {
        this.emitters = [];
        this.particles = [];
        this.scene = null;
        this.shakeRequest = 0;
    }

    update() {
        // Particles
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
                    // ★修正: 関数が存在するかチェックしてから実行
                    if (typeof p.onHit === 'function') {
                        p.onHit();
                    }
                    p.life = 0; // Kill
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
        // Defaults
        p.life = p.life || 60;
        p.maxLife = p.life;
        p.vx = p.vx || 0;
        p.vy = p.vy || 0;
        p.delay = p.delay || 0;
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
        // Smoke
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
        // params: sx, sy, ex, ey, type, speed, arcHeight, onHit
        params.type = 'proj';
        params.life = 999; 
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

    addBombardment(scene, x, y, hex) {
        // Aerial bombardment effect (multiple explosions)
        scene.time.delayedCall(0, () => this.addExplosion(x, y, "#f80", 15));
        scene.time.delayedCall(150, () => this.addExplosion(x+10, y+10, "#f40", 10));
        scene.time.delayedCall(300, () => this.addExplosion(x-10, y-5, "#fa0", 12));
        
        // Logic callback to deal damage? Ideally passed from logic, but here purely visual.
        // Logic handles damage separately.
    }

    hexToInt(hex) {
        if(typeof hex === 'number') return hex;
        return parseInt(hex.replace('#', '0x'), 16);
    }
}

window.VFX = new VFXSystem();

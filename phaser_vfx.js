/** PHASER VFX & ENV: Earthy Tone Grass (60FPS Smooth) & Gentle Breeze */

class VFXSystem {
    constructor() {
        this.particles = [];
        this.windTimer = 0;
    }

    update() {
        this.windTimer++;
        if (this.windTimer > 200 + Math.random() * 200) {
            this.triggerWindGust();
            this.windTimer = 0;
        }

        for (let i = this.particles.length - 1; i >= 0; i--) {
            let p = this.particles[i];
            if (p.delay > 0) { p.delay--; continue; }
            p.life--;
            p.x += p.vx; p.y += p.vy;
            
            if (p.type === 'wind') {
                p.alpha = Math.sin((p.life / p.maxLife) * Math.PI) * 0.03; 
            } else if (p.type === 'proj') {
                p.progress += p.speed; let t = p.progress; if (t >= 1) t = 1;
                const dx = p.ex - p.sx; const dy = p.ey - p.sy;
                p.x = p.sx + dx * t; p.y = p.sy + dy * t;
                if (p.arcHeight > 0) p.y -= Math.sin(t * Math.PI) * p.arcHeight;
                if (t >= 1) { if (typeof p.onHit === 'function') p.onHit(); p.life = 0; }
            } else {
                p.vy += 0.2; 
            }
            if (p.life <= 0) this.particles.splice(i, 1);
        }
    }

    triggerWindGust() {
        for (let i = 0; i < 10; i++) {
            this.add({
                x: -300 - Math.random() * 500,
                y: Math.random() * 3000,
                vx: 12 + Math.random() * 5, 
                vy: 1 + Math.random() * 1,
                life: 250,
                color: "#ffffff", 
                size: 1, 
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
                graphics.lineStyle(1, 0xffffff, p.alpha);
                graphics.beginPath();
                graphics.moveTo(p.x, p.y);
                graphics.lineTo(p.x - p.vx * 15, p.y - p.vy * 15); 
                graphics.strokePath();
            } else {
                const alpha = p.life / p.maxLife;
                graphics.fillStyle(this.hexToInt(p.color), alpha);
                if (p.type === 'proj') graphics.fillCircle(p.x, p.y, 3);
                else if(p.type === 'smoke') graphics.fillCircle(p.x, p.y, p.size * (2-alpha));
                else graphics.fillRect(p.x, p.y, p.size, p.size);
            }
        });
    }
    
    add(p) { p.life = p.life || 60; p.maxLife = p.life; p.vx = p.vx || 0; p.vy = p.vy || 0; p.delay = p.delay || 0; if (!p.color) p.color = "#ffffff"; this.particles.push(p); }
    addExplosion(x, y, color, count) { this.shakeRequest = 5; for(let i=0; i<count; i++) { const angle = Math.random() * Math.PI * 2; const speed = Math.random() * 3 + 1; this.add({ x:x, y:y, vx:Math.cos(angle)*speed, vy:Math.sin(angle)*speed-2, color:color, size:Math.random()*4+2, life:30+Math.random()*20, type:'spark' }); } for(let i=0; i<count/2; i++) { this.add({ x:x, y:y, vx:(Math.random()-0.5), vy:-Math.random()*2, color:"#555", size:5, life:60, type:'smoke' }); } }
    addSmoke(x, y) { this.add({ x:x, y:y, vx:(Math.random()-0.5)*0.5, vy:-0.5-Math.random()*0.5, color:"#888", size:4, life:80, type:'smoke' }); }
    addFire(x, y) { this.add({ x:x, y:y, vx:(Math.random()-0.5), vy:-1-Math.random(), color:"#fa0", size:3, life:40, type:'spark' }); }
    addProj(params) { params.type = 'proj'; params.life = 999; if(!params.color) params.color="#ffffaa"; this.add(params); }
    addUnitDebris(x, y) { for(let i=0; i<8; i++) { this.add({ x:x, y:y, vx:(Math.random()-0.5)*4, vy:-Math.random()*5, color:"#422", size:3, life:100, type:'spark' }); } }
    hexToInt(hex) { if (hex === undefined || hex === null) return 0xffffff; if (typeof hex === 'number') return hex; if (typeof hex !== 'string') return 0xffffff; return parseInt(hex.replace('#', '0x'), 16); }
}

class EnvSystem {
    constructor() {
        this.grassElements = [];
        this.treeElements = [];
        this.gustPower = 0;
        this.waveTime = 0;
        this.TOTAL_GRASS_FRAMES = 60; 
    }

    preload(scene) {
        const TEXTURE_SCALE = 4.0; 

        if (!scene.textures.exists('hd_grass_0')) {
            const size = 64 * TEXTURE_SCALE;
            const canvasW = size * 1.8; 
            const canvasH = size;
            // ★修正: パレットを土っぽい渋い色に変更 (紫要素を排除)
            const palettes = [0x4a5d23, 0x5b6e34, 0x3a4d13, 0x6c7a44, 0x554e33];
            
            const bladeDefs = [];
            for(let i=0; i<45; i++) {
                bladeDefs.push({
                    col: palettes[Math.floor(Math.random() * palettes.length)],
                    startX: canvasW/2 + (Math.random()-0.5) * (size * 0.15),
                    len: (size * 0.5) + Math.random() * (size * 0.5),
                    lean: (Math.random() - 0.5) * (size * 0.9),
                    ctrlOff: (Math.random() - 0.5) * (size * 0.2)
                });
            }

            for (let frame = 0; frame < this.TOTAL_GRASS_FRAMES; frame++) {
                const g = scene.make.graphics({x:0, y:0, add:false});
                // 土台も暗く、土っぽく
                g.fillStyle(0x2a331a, 0.8); g.fillEllipse(canvasW/2, canvasH, size/4, size/10);

                const bendFactor = frame / (this.TOTAL_GRASS_FRAMES - 1.0); 

                for(let b of bladeDefs) {
                    g.lineStyle(1.5 * TEXTURE_SCALE, b.col, 1.0);
                    const startX = b.startX; const startY = canvasH;
                    const windX = bendFactor * (size * 0.7); const windY = Math.abs(windX) * 0.2; 
                    const endX = startX + b.lean + windX; const endY = startY - b.len + windY;
                    const ctrlX = startX + (b.lean * 0.1) + (windX * 0.5) + b.ctrlOff; const ctrlY = startY - (b.len * 0.5);
                    const curve = new Phaser.Curves.QuadraticBezier(new Phaser.Math.Vector2(startX, startY), new Phaser.Math.Vector2(ctrlX, ctrlY), new Phaser.Math.Vector2(endX, endY));
                    curve.draw(g);
                }
                g.generateTexture(`hd_grass_${frame}`, canvasW, canvasH);
            }
        }

        if (!scene.textures.exists('hd_tree')) {
            const w = 80 * TEXTURE_SCALE; const h = 140 * TEXTURE_SCALE;
            const g = scene.make.graphics({x:0, y:0, add:false});
            g.fillStyle(0x221105); g.fillRect(w/2 - (w*0.08), h*0.8, w*0.16, h*0.2);
            const layers = 6; const leafDark = 0x0f2610; const leafLight = 0x1e3d1f;
            for(let i=0; i<layers; i++) {
                const progress = i / layers; const lw = w * (0.8 - progress * 0.6); const lh = h * 0.22; const ly = h * 0.8 - (h * 0.75 * progress) - lh; const cx = w/2; const cy = ly + lh;
                g.fillStyle(leafDark); g.beginPath(); g.moveTo(cx, ly); g.lineTo(cx + lw/2, cy); g.lineTo(cx, cy); g.fill();
                g.fillStyle(leafLight); g.beginPath(); g.moveTo(cx, ly); g.lineTo(cx - lw/2, cy); g.lineTo(cx, cy); g.fill();
            }
            g.generateTexture('hd_tree', w, h);
        }
    }

    clear() { this.grassElements = []; this.treeElements = []; }

    spawnGrass(scene, group, x, y) {
        const count = 60; 
        const scaleFactor = 0.07; 
        for(let i=0; i<count; i++) {
            const r = Math.random() * (HEX_SIZE * 1.0); const angle = Math.random() * Math.PI * 2;
            const ox = Math.cos(angle) * r; const oy = Math.sin(angle) * r * 0.866;
            
            const grass = scene.add.sprite(x+ox, y+oy, 'hd_grass_0');
            grass.setOrigin(0.5, 1.0); 
            grass.setScale((0.8 + Math.random() * 0.4) * scaleFactor); 
            grass.setDepth(y+oy);
            
            grass.currentWindValue = 0; 
            grass.origX = x + ox; grass.origY = y + oy;
            
            // ★修正: Tintを落ち着いた彩度の低いトーンに変更 (青成分を下げて黄色寄りに)
            const tintVar = Math.floor(Math.random() * 40); 
            grass.setTint(Phaser.Display.Color.GetColor(160 + tintVar, 170 + tintVar, 130 + tintVar));
            
            group.add(grass); 
            this.grassElements.push(grass);
        }
    }

    spawnTrees(scene, group, x, y) {
        const count = 10 + Math.floor(Math.random() * 5); const scaleFactor = 0.18;
        for(let i=0; i<count; i++) {
            const r = Math.random() * (HEX_SIZE * 0.9); const angle = Math.random() * Math.PI * 2;
            const ox = Math.cos(angle) * r; const oy = Math.sin(angle) * r * 0.866;
            const scale = (0.7 + Math.random() * 0.6) * scaleFactor;
            const shadow = scene.add.ellipse(x+ox, y+oy+3, 40*scale, 15*scale, 0x000000, 0.5); group.add(shadow);
            const tree = scene.add.image(x+ox, y+oy, 'hd_tree');
            tree.setOrigin(0.5, 0.95); tree.setScale(scale); tree.setDepth(y+oy + 20);
            tree.currentSkew = 0; tree.baseSkew = 0; tree.origX = x + ox;
            group.add(tree); this.treeElements.push(tree);
        }
    }

    registerWater(image, y, q, r, group) {
        if (!image.scene) return;
        image.scene.tweens.add({ targets: image, alpha: { from: 0.85, to: 1.0 }, y: '+=3', scaleX: { from: 1.0/window.HIGH_RES_SCALE, to: 1.02/window.HIGH_RES_SCALE }, duration: 1500 + Math.random() * 1000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    onGust() { this.gustPower = 1.0; }

    update(time) {
        this.waveTime += 0.02; 
        const t = this.waveTime;
        this.gustPower *= 0.98;
        if(this.gustPower < 0.01) this.gustPower = 0;

        // 1. 草
        this.grassElements = this.grassElements.filter(g => g.scene);
        for (let i = 0; i < this.grassElements.length; i++) {
            const g = this.grassElements[i];
            const wavePhase = t * 1.0 - g.origX * 0.015; 
            const bigWave = (Math.sin(wavePhase) + 1.0) * 0.5; 
            const ripple = Math.sin(t * 2.5 + g.origY * 0.1) * 0.05;
            const gust = this.gustPower * 0.6; 
            let targetWindValue = (bigWave * 0.4) + 0.1 + ripple + gust; 
            targetWindValue = Math.max(0, Math.min(1.0, targetWindValue));
            const stiffness = 0.08; 
            g.currentWindValue += (targetWindValue - g.currentWindValue) * stiffness;
            const maxFrames = this.TOTAL_GRASS_FRAMES - 1;
            const floatFrame = g.currentWindValue * maxFrames;
            const frameIdx = Math.floor(floatFrame);
            const remainder = floatFrame - frameIdx;
            g.setTexture(`hd_grass_${frameIdx}`);
            g.skewX = remainder * 0.05; 
        }

        // 2. 木
        this.treeElements = this.treeElements.filter(tr => tr.scene);
        for (let i = 0; i < this.treeElements.length; i++) {
            const tr = this.treeElements[i];
            const wavePhase = t * 1.0 - tr.origX * 0.015 - 0.5; 
            const sway = Math.sin(wavePhase) * 0.05;
            const gust = this.gustPower * 0.15;
            const baseLean = 0.02;
            const targetSkew = sway + baseLean + gust;
            tr.currentSkew += (targetSkew - tr.currentSkew) * 0.03; 
            tr.skewX = tr.baseSkew + tr.currentSkew;
            tr.angle = tr.currentSkew * 3;
        }
    }
}

window.VFX = new VFXSystem();
window.EnvSystem = new EnvSystem();

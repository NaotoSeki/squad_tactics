/** PHASER VFX & ENV: Spark Only (No Debris/Rects) */

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
            
            p.prevX = p.x; p.prevY = p.y;
            p.life--;
            p.x += p.vx; p.y += p.vy;
            
            if (p.type === 'wind') {
                p.alpha = Math.sin((p.life / p.maxLife) * Math.PI) * 0.03; 
            } else if (p.type === 'proj') {
                p.progress += p.speed; let t = p.progress; if (t >= 1) t = 1;
                const dx = p.ex - p.sx; const dy = p.ey - p.sy;
                p.x = p.sx + dx * t; p.y = p.sy + dy * t;
                if (p.arcHeight > 0) p.y -= Math.sin(t * Math.PI) * p.arcHeight;
                if(t < 1) {
                    p.prevX = p.sx + dx * (t - p.speed*0.5);
                    p.prevY = p.sy + dy * (t - p.speed*0.5);
                    if (p.arcHeight > 0) p.prevY -= Math.sin((t-p.speed*0.5) * Math.PI) * p.arcHeight;
                }
                if (t >= 1) { if (typeof p.onHit === 'function') p.onHit(); p.life = 0; }
            } else if (p.type === 'smoke') {
                p.vx *= 0.95; p.vy *= 0.95; 
                p.y -= 0.2; 
            } else if (p.type === 'spark') {
                p.vy += 0.1;
            }

            if (p.life <= 0) this.particles.splice(i, 1);
        }
    }

    triggerWindGust() {
        for (let i = 0; i < 10; i++) {
            this.add({
                x: -300 - Math.random() * 500, y: Math.random() * 3000,
                vx: 12 + Math.random() * 5, vy: 1 + Math.random() * 1,
                life: 250, color: "#ffffff", size: 1, type: 'wind'
            });
        }
        if(window.EnvSystem) window.EnvSystem.onGust();
    }

    draw(graphics) {
        graphics.clear();
        this.particles.forEach(p => {
            if (p.delay > 0) return;
            
            // 弾丸 (Line Tracer)
            if (p.type === 'proj') {
                if(p.isTracer) {
                    const alpha = Math.min(1.0, p.life * 0.2);
                    const color = (p.type === 'shell_fast') ? 0xffaa55 : 0xffffcc;
                    graphics.lineStyle(2, color, alpha);
                    graphics.beginPath(); graphics.moveTo(p.prevX, p.prevY); graphics.lineTo(p.x, p.y); graphics.strokePath();
                    graphics.lineStyle(1, 0xffffff, alpha + 0.3);
                    graphics.beginPath(); graphics.moveTo(p.prevX + (p.x-p.prevX)*0.6, p.prevY + (p.y-p.prevY)*0.6); graphics.lineTo(p.x, p.y); graphics.strokePath();
                }
            }
            // 風
            else if (p.type === 'wind') {
                graphics.lineStyle(1, 0xffffff, p.alpha);
                graphics.beginPath(); graphics.moveTo(p.x, p.y); graphics.lineTo(p.x - p.vx * 20, p.y - p.vy * 20); graphics.strokePath();
            }
            // Spark (火花) - 線として描画
            else if (p.type === 'spark') {
                const alpha = (p.alpha !== undefined) ? p.alpha : (p.life / p.maxLife);
                const len = Math.max(p.size, Math.sqrt(p.vx*p.vx + p.vy*p.vy) * 1.5);
                const angle = Math.atan2(p.vy, p.vx);
                const tailX = p.x - Math.cos(angle) * len;
                const tailY = p.y - Math.sin(angle) * len;

                graphics.lineStyle(Math.max(1, p.size), this.hexToInt(p.color), alpha);
                graphics.beginPath();
                graphics.moveTo(p.x, p.y);
                graphics.lineTo(tailX, tailY);
                graphics.strokePath();
            }
            // 煙など (単純なRectで描画、回転なし)
            else {
                const alpha = (p.alpha !== undefined) ? p.alpha : (p.life / p.maxLife);
                graphics.fillStyle(this.hexToInt(p.color), alpha);
                graphics.fillRect(p.x - p.size/2, p.y - p.size/2, p.size, p.size);
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
    
    // ★変更: Debris(破片)を削除し、Sparkのみ発生させる
    addExplosion(x, y, color, count) { 
        this.shakeRequest = 4; 
        for(let i=0; i<count*2; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 8 + 4;
            this.add({
                x:x, y:y-5,
                vx:Math.cos(angle)*speed,
                vy:Math.sin(angle)*speed,
                color: (Math.random()>0.5) ? "#ffaa00" : "#ffffff", 
                size: 2,
                life: 10+Math.random()*15,
                type:'spark'
            });
        }
    }
    
    addSmoke(x, y) { 
        this.add({ 
            x:x, y:y, 
            vx:(Math.random()-0.5)*0.8, 
            vy:-0.5-Math.random()*1.0, 
            color: (Math.random()>0.5) ? "#666666" : "#444444", 
            size: 6 + Math.random()*4, 
            life: 60+Math.random()*30, 
            type:'smoke'
        }); 
    }
    
    addFire(x, y) { 
        this.add({ 
            x:x, y:y, 
            vx:(Math.random()-0.5)*1.5, 
            vy:-2-Math.random()*3, 
            color: (Math.random()>0.3) ? "#ff4400" : "#ffff00", 
            size: 4 + Math.random()*3, 
            life: 30+Math.random()*20, 
            type:'smoke'
        }); 
    }
    
    addProj(params) { 
        params.type = 'proj'; 
        params.life = 999; 
        if(!params.color) params.color="#ffffaa"; 
        this.add(params); 
    }
    
    addUnitDebris(x, y) { }
    hexToInt(hex) { if (hex === undefined || hex === null) return 0xffffff; if (typeof hex === 'number') return hex; if (typeof hex !== 'string') return 0xffffff; return parseInt(hex.replace('#', '0x'), 16); }
}

class EnvSystem {
    constructor() { this.grassElements = []; this.treeElements = []; this.gustPower = 0; this.treeGust = 0; this.waveTime = 0; this.TOTAL_GRASS_FRAMES = 24; }
    preload(scene) {
        const TEXTURE_SCALE = 4.0; const canvasW = 64 * TEXTURE_SCALE * 1.8; const canvasH = 64 * TEXTURE_SCALE;
        const palettes = [0x4a5d23, 0x5b6e34, 0x3a4d13, 0x6c7a44, 0x554e33];
        if (!scene.textures.exists('hd_grass_0')) { const bladeDefsA = []; for(let i=0; i<45; i++) { bladeDefsA.push({ col: palettes[Math.floor(Math.random() * palettes.length)], startX: canvasW/2 + (Math.random()-0.5) * (canvasH * 0.15), len: (canvasH * 0.5) + Math.random() * (canvasH * 0.5), lean: (Math.random() - 0.5) * (canvasH * 0.9), ctrlOff: (Math.random() - 0.5) * (canvasH * 0.2) }); } this.generateGrassFrames(scene, 'hd_grass', bladeDefsA, canvasW, canvasH, TEXTURE_SCALE, 0.7); }
        if (!scene.textures.exists('hd_grass_b_0')) { const bladeDefsB = []; for(let i=0; i<55; i++) { bladeDefsB.push({ col: palettes[Math.floor(Math.random() * palettes.length)], startX: canvasW/2 + (Math.random()-0.5) * (canvasH * 0.6), len: (canvasH * 0.3) + Math.random() * (canvasH * 0.3), lean: (Math.random() - 0.5) * (canvasH * 1.5), ctrlOff: (Math.random() - 0.5) * (canvasH * 0.5) }); } this.generateGrassFrames(scene, 'hd_grass_b', bladeDefsB, canvasW, canvasH, TEXTURE_SCALE, 0.4); }
        const treeW = 100 * TEXTURE_SCALE; const treeH = 170 * TEXTURE_SCALE;
        if (!scene.textures.exists('hd_tree_trunk')) { const g = scene.make.graphics({x:0, y:0, add:false}); g.fillStyle(0x332211); g.beginPath(); const bW = treeW * 0.12; const tW = treeW * 0.02; const cx = treeW/2; g.moveTo(cx - bW/2, treeH * 0.95); g.lineTo(cx + bW/2, treeH * 0.95); g.lineTo(cx + tW/2, treeH * 0.1); g.lineTo(cx - tW/2, treeH * 0.1); g.closePath(); g.fill(); g.generateTexture('hd_tree_trunk', treeW, treeH); }
        const layers = 3; const baseColors = [ { r: 10, g: 31, b: 11 }, { r: 22, g: 51, b: 24 }, { r: 34, g: 68, b: 34 } ];
        if (!scene.textures.exists('rubble_chunk_0')) {
            const RSC = 3.2; // 瓦礫1つ1つの大きさを約20%縮小
            const rubbleColors = [0x9a958c, 0x8c877e, 0xa29d94, 0x7e796e, 0xb0aaa0];
            const rubbleDark = 0x6a6558;
            [0,1,2,3,4].forEach((idx) => {
                const g = scene.make.graphics({x:0,y:0,add:false});
                const w = (72 + idx * 16) * RSC;
                const h = (56 + idx * 14) * RSC;
                const cx = w * 0.5; const cy = h * 0.5;
                g.fillStyle(rubbleColors[idx % rubbleColors.length], 0.97);
                g.lineStyle(Math.max(2, RSC * 0.8), rubbleDark, 0.75);
                if (idx === 0 || idx === 1) {
                    const n = 6 + idx; const pts = [];
                    for (let i = 0; i < n; i++) {
                        const a = (i / n) * Math.PI * 2 + idx * 0.4;
                        const r = (0.35 + Math.random() * 0.35) * Math.min(w, h);
                        pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
                    }
                    g.beginPath(); g.moveTo(pts[0].x, pts[0].y);
                    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
                    g.closePath(); g.fillPath(); g.strokePath();
                    g.lineStyle(Math.max(1, RSC * 0.4), rubbleDark, 0.4);
                    g.beginPath(); g.moveTo(pts[0].x, pts[0].y); g.lineTo((pts[0].x + pts[Math.floor(n/2)].x)*0.5, (pts[0].y + pts[Math.floor(n/2)].y)*0.5); g.strokePath();
                } else if (idx === 2) {
                    const bw = w * 0.88; const bh = h * 0.48;
                    g.beginPath();
                    g.moveTo(cx - bw/2, cy + bh/2);
                    g.lineTo(cx + bw/2 - w*0.08, cy + bh/2);
                    g.lineTo(cx + bw/2, cy + bh/2 - bh*0.35);
                    g.lineTo(cx + bw/2, cy - bh/2);
                    g.lineTo(cx - bw/2 + w*0.06, cy - bh/2);
                    g.lineTo(cx - bw/2, cy - bh/2 + bh*0.2);
                    g.closePath();
                    g.fillPath(); g.strokePath();
                } else if (idx === 3) {
                    const bw = w * 0.7; const bh = h * 0.55;
                    const notch = bw * 0.25;
                    g.beginPath();
                    g.moveTo(cx - bw/2, cy - bh/2);
                    g.lineTo(cx + bw/2 - notch, cy - bh/2);
                    g.lineTo(cx + bw/2, cy - bh/2 + bh*0.2);
                    g.lineTo(cx + bw/2, cy + bh/2);
                    g.lineTo(cx - bw/2 + notch*0.5, cy + bh/2);
                    g.lineTo(cx - bw/2, cy + bh/2 - bh*0.15);
                    g.closePath();
                    g.fillPath(); g.strokePath();
                } else {
                    const n = 8;
                    const pts = [];
                    for (let i = 0; i < n; i++) {
                        const a = (i / n) * Math.PI * 2 + 0.2;
                        const r = (0.38 + (i % 2) * 0.12 + Math.random() * 0.1) * Math.min(w, h);
                        pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
                    }
                    g.beginPath(); g.moveTo(pts[0].x, pts[0].y);
                    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
                    g.closePath(); g.fillPath(); g.strokePath();
                }
                g.generateTexture(`rubble_chunk_${idx}`, w + 8, h + 8);
            });
        }
        for(let l=0; l<layers; l++) { const key = `hd_tree_leaves_${l}`; if (scene.textures.exists(key)) continue; const g = scene.make.graphics({x:0, y:0, add:false}); const startH = 0.9 - (l * 0.25); const endH = startH - 0.4; const branches = 80 + l * 30; const baseCol = baseColors[l]; for(let i=0; i<branches; i++) { const progress = i / branches; const rndH = startH - (startH - endH) * Math.random(); const layerY = treeH * rndH; const widthRatio = (rndH - 0.1) / 0.8; const layerWidth = treeW * 0.95 * widthRatio; const rVar = Math.floor((Math.random() - 0.5) * 20); const gVar = Math.floor((Math.random() - 0.5) * 30); const bVar = Math.floor((Math.random() - 0.5) * 20); const highlight = (Math.random() < (0.1 + l * 0.2)) ? 20 : 0; const r = Phaser.Math.Clamp(baseCol.r + rVar + highlight, 0, 255); const gVal = Phaser.Math.Clamp(baseCol.g + gVar + highlight, 0, 255); const b = Phaser.Math.Clamp(baseCol.b + bVar + highlight, 0, 255); const color = Phaser.Display.Color.GetColor(r, gVal, b); g.lineStyle((2.0 + Math.random()) * TEXTURE_SCALE, color, 0.9); const cx = treeW/2; const side = Math.random() > 0.5 ? 1 : -1; const length = layerWidth * 0.5 * (0.5 + Math.random()*0.6); const startX = cx + (Math.random()-0.5) * (treeW*0.08); const startY = layerY + (Math.random()-0.5) * (treeH*0.02); const endX = startX + (side * length); const droop = (length * 0.3) + Math.random() * (treeH * 0.08); const endY = startY + droop; const ctrlX = startX + (side * length * 0.3) + (Math.random()-0.5)*10; const ctrlY = startY - (length * 0.15) + (Math.random()-0.5)*10; const curve = new Phaser.Curves.QuadraticBezier( new Phaser.Math.Vector2(startX, startY), new Phaser.Math.Vector2(ctrlX, ctrlY), new Phaser.Math.Vector2(endX, endY) ); curve.draw(g); if (Math.random() < 0.3) { g.lineStyle(1.0 * TEXTURE_SCALE, Phaser.Display.Color.GetColor(r+20, gVal+20, b+10), 0.6); curve.draw(g); } } g.generateTexture(key, treeW, treeH); }
    }
    generateGrassFrames(scene, keyPrefix, bladeDefs, w, h, scale, windSens) { for (let frame = 0; frame < this.TOTAL_GRASS_FRAMES; frame++) { const g = scene.make.graphics({x:0, y:0, add:false}); g.fillStyle(0x2a331a, 0.8); g.fillEllipse(w/2, h, h/4, h/10); const bendFactor = frame / (this.TOTAL_GRASS_FRAMES - 1.0); for(let b of bladeDefs) { g.lineStyle(1.5 * scale, b.col, 1.0); const startX = b.startX; const startY = h; const windX = bendFactor * (h * windSens); const windY = Math.abs(windX) * 0.2; const endX = startX + b.lean + windX; const endY = startY - b.len + windY; const ctrlX = startX + (b.lean * 0.1) + (windX * 0.5) + b.ctrlOff; const ctrlY = startY - (b.len * 0.5); const curve = new Phaser.Curves.QuadraticBezier(new Phaser.Math.Vector2(startX, startY), new Phaser.Math.Vector2(ctrlX, ctrlY), new Phaser.Math.Vector2(endX, endY)); curve.draw(g); } g.generateTexture(`${keyPrefix}_${frame}`, w, h); } }
    clear() { this.grassElements = []; this.treeElements = []; }
    spawnGrass(scene, group, x, y) { const count = 60; const scaleFactor = 0.07; for(let i=0; i<count; i++) { const r = Math.random() * (HEX_SIZE * 1.0); const angle = Math.random() * Math.PI * 2; const ox = Math.cos(angle) * r; const oy = Math.sin(angle) * r * 0.866; const type = Math.random() > 0.5 ? 'A' : 'B'; const textureKey = type === 'A' ? 'hd_grass_0' : 'hd_grass_b_0'; const grass = scene.add.sprite(x+ox, y+oy, textureKey); grass.setOrigin(0.5, 1.0); const typeScale = type === 'A' ? 1.0 : 0.85; grass.setScale((0.8 + Math.random() * 0.4) * scaleFactor * typeScale); grass.setDepth(y+oy); grass.grassType = type; grass.currentWindValue = 0; grass.origX = x + ox; grass.origY = y + oy; grass.amp = 0.82 + Math.random() * 0.36; const tintVar = Math.floor(Math.random() * 40); grass.setTint(Phaser.Display.Color.GetColor(160 + tintVar, 170 + tintVar, 130 + tintVar)); group.add(grass); this.grassElements.push(grass); } }
    spawnTrees(scene, group, x, y) { const count = 5 + Math.floor(Math.random() * 3); const scaleFactor = 0.18; for(let i=0; i<count; i++) { const r = Math.random() * (HEX_SIZE * 0.85); const angle = Math.random() * Math.PI * 2; const ox = Math.cos(angle) * r; const oy = Math.sin(angle) * r * 0.866; const scale = (0.7 + Math.random() * 0.6) * scaleFactor; const shadow = scene.add.ellipse(x+ox, y+oy+3, 40*scale, 15*scale, 0x000000, 0.5); group.add(shadow); const treeContainer = scene.add.container(x+ox, y+oy); treeContainer.setDepth(y+oy + 20); treeContainer.setScale(scale); const trunk = scene.add.image(0, 0, 'hd_tree_trunk').setOrigin(0.5, 0.95); treeContainer.add(trunk); const leaves = []; for(let l=0; l<3; l++) { const leaf = scene.add.image(0, 0, `hd_tree_leaves_${l}`).setOrigin(0.5, 0.95); treeContainer.add(leaf); leaves.push(leaf); } treeContainer.trunk = trunk; treeContainer.leaves = leaves; treeContainer.currentSkew = 0; treeContainer.baseSkew = 0; treeContainer.origX = x + ox; treeContainer.origY = y + oy; treeContainer.swayOffset = (Math.random() - 0.5) * Math.PI * 0.6; treeContainer.amp = 0.88 + Math.random() * 0.24; group.add(treeContainer); this.treeElements.push(treeContainer); } }
    spawnRubble(scene, x, y, decorGroup, rubbleFrontGroup) {
        const countBack = 6 + Math.floor(Math.random() * 4);
        const countFront = 6 + Math.floor(Math.random() * 4);
        const scaleMin = 0.1; const scaleRange = 0.14;
        const rubbleScale = 0.8;
        for (let i = 0; i < countBack; i++) {
            const r = Math.random() * (HEX_SIZE * 0.9); const angle = Math.random() * Math.PI * 2;
            const ox = Math.cos(angle) * r; const oy = Math.sin(angle) * r * 0.866;
            const key = `rubble_chunk_${i % 5}`;
            const chunk = scene.add.image(x + ox, y + oy, key).setOrigin(0.5, 0.5);
            chunk.setScale((scaleMin + Math.random() * scaleRange) * rubbleScale); chunk.setAngle((Math.random() - 0.5) * 55);
            chunk.setDepth(0.5 + (y + oy) * 0.0001 + i * 0.0001);
            chunk.setTint(Phaser.Display.Color.GetColor(130 + Math.floor(Math.random() * 45), 125 + Math.floor(Math.random() * 40), 110 + Math.floor(Math.random() * 35)));
            decorGroup.add(chunk);
        }
        for (let i = 0; i < countFront; i++) {
            const r = Math.random() * (HEX_SIZE * 0.9); const angle = Math.random() * Math.PI * 2;
            const ox = Math.cos(angle) * r; const oy = Math.sin(angle) * r * 0.866;
            const key = `rubble_chunk_${i % 5}`;
            const chunk = scene.add.image(x + ox, y + oy, key).setOrigin(0.5, 0.5);
            chunk.setScale((scaleMin + Math.random() * scaleRange) * rubbleScale); chunk.setAngle((Math.random() - 0.5) * 60);
            chunk.setDepth(1.5 + (y + oy) * 0.0001 + i * 0.0001);
            chunk.setTint(Phaser.Display.Color.GetColor(125 + Math.floor(Math.random() * 50), 120 + Math.floor(Math.random() * 45), 105 + Math.floor(Math.random() * 40)));
            rubbleFrontGroup.add(chunk);
        }
    }
    registerWater(image, y, q, r, group) { if (!image.scene) return; image.scene.tweens.add({ targets: image, alpha: { from: 0.85, to: 1.0 }, y: '+=3', scaleX: { from: 1.0/window.HIGH_RES_SCALE, to: 1.02/window.HIGH_RES_SCALE }, duration: 1500 + Math.random() * 1000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }); }
    onGust() { this.gustPower = 1.0; }
    update(time) {
        // 風向き統一: wavePhase の sin が正のとき「風が右向き」= 草は右に曲がり・樹木は右に傾く（同一方向）
        this.waveTime += 0.018;
        const t = this.waveTime;
        this.gustPower *= 0.98;
        if (this.gustPower < 0.01) this.gustPower = 0;
        this.treeGust += (this.gustPower - this.treeGust) * 0.045;
        const mainScene = this.grassElements[0]?.scene;
        let bounds = null;
        if (mainScene) {
            const cam = mainScene.cameras.main;
            bounds = new Phaser.Geom.Rectangle(cam.worldView.x - 100, cam.worldView.y - 100, cam.worldView.width + 200, cam.worldView.height + 200);
        }
        const windBase = t * 1.0;
        const windSpreadX = 0.012;
        const windSpreadY = 0.006;

        this.grassElements = this.grassElements.filter(g => g.scene);
        for (let i = 0; i < this.grassElements.length; i++) {
            const g = this.grassElements[i];
            if (bounds && !bounds.contains(g.origX, g.origY)) { g.visible = false; continue; }
            g.visible = true;
            const wavePhase = windBase - g.origX * windSpreadX - g.origY * windSpreadY;
            const bigWave = (Math.sin(wavePhase) + 1.0) * 0.5;
            const ripple = Math.sin(wavePhase * 2.5) * 0.05;
            const gust = this.gustPower * 0.6;
            let targetWindValue = ((bigWave * 0.4) + 0.1 + ripple + gust) * (g.amp !== undefined ? g.amp : 1);
            targetWindValue = Math.max(0, Math.min(1.0, targetWindValue));
            const stiffness = 0.06;
            g.currentWindValue += (targetWindValue - g.currentWindValue) * stiffness;
            const maxFrames = this.TOTAL_GRASS_FRAMES - 1;
            const floatFrame = g.currentWindValue * maxFrames;
            const frameIdx = Math.floor(floatFrame);
            const prefix = (g.grassType === 'B') ? 'hd_grass_b_' : 'hd_grass_';
            const safeFrame = Phaser.Math.Clamp(frameIdx, 0, maxFrames);
            g.setTexture(`${prefix}${safeFrame}`);
            const remainder = floatFrame - frameIdx;
            g.skewX = remainder * 0.05;
        }

        this.treeElements = this.treeElements.filter(tr => tr.scene);
        for (let i = 0; i < this.treeElements.length; i++) {
            const tr = this.treeElements[i];
            if (bounds && !bounds.contains(tr.origX, tr.origY)) { tr.visible = false; continue; }
            tr.visible = true;
            const wavePhase = windBase - tr.origX * windSpreadX - tr.origY * windSpreadY + tr.swayOffset;
            const amp = (tr.amp !== undefined ? tr.amp : 1);
            const mainSway = Math.sin(wavePhase) * 0.028 * amp;
            const subSway = Math.sin(wavePhase * 1.6 + 1.2) * 0.01 * amp;
            const gust = this.treeGust * 0.1 * amp;
            const targetSkew = mainSway + subSway + gust;
            const stiffness = 0.018;
            tr.currentSkew += (targetSkew - tr.currentSkew) * stiffness;
            const s = tr.currentSkew;
            tr.trunk.skewX = s * 0.38;
            tr.trunk.angle = s * 1.4;
            if (tr.leaves) {
                const phase1 = wavePhase - 0.25;
                const phase2 = wavePhase - 0.5;
                const s1 = (Math.sin(phase1) * 0.022 + Math.sin(phase1 * 1.5) * 0.008 + gust * 0.5);
                const s2 = (Math.sin(phase2) * 0.02 + Math.sin(phase2 * 1.4) * 0.006 + gust * 0.7);
                tr.leaves[0].skewX = tr.leaves[0].skewX * 0.94 + s1 * 0.7;
                tr.leaves[0].x = tr.leaves[0].x * 0.94 + s1 * 4;
                tr.leaves[1].skewX = tr.leaves[1].skewX * 0.92 + s1 * 1.0;
                tr.leaves[1].x = tr.leaves[1].x * 0.92 + s1 * 12;
                tr.leaves[2].skewX = tr.leaves[2].skewX * 0.90 + s2 * 1.2;
                tr.leaves[2].x = tr.leaves[2].x * 0.90 + s2 * 20;
            }
        }
    }
}

window.VFX = new VFXSystem();
window.EnvSystem = new EnvSystem();

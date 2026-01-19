/** * PHASER VFX SPECIALIST (Stable Geometric Rollback) */
window.HIGH_RES_SCALE = 4;

// ---------------------------------------------------------
//  0. Global Helpers
// ---------------------------------------------------------
window.drawCardToCanvas = function(type) {
    const w = 100 * window.HIGH_RES_SCALE; const h = 60 * window.HIGH_RES_SCALE;
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
    x.scale(window.HIGH_RES_SCALE, window.HIGH_RES_SCALE); x.translate(50, 30); x.scale(2, 2);
    if(type==='infantry'){x.fillStyle="#444";x.fillRect(-15,0,30,4);x.fillStyle="#642";x.fillRect(-15,0,10,4);}
    else if(type==='tank'){x.fillStyle="#444";x.fillRect(-12,-6,24,12);x.fillStyle="#222";x.fillRect(0,-2,16,4);}
    else if(type==='heal'){x.fillStyle="#eee";x.fillRect(-10,-8,20,16);x.fillStyle="#d00";x.fillRect(-3,-6,6,12);x.fillRect(-8,-1,16,2);}
    else if(type==='tiger'){x.fillStyle="#554";x.fillRect(-14,-8,28,16);x.fillStyle="#111";x.fillRect(2,-2,20,4);}
    else if(type==='aerial'){ x.fillStyle="#343"; x.beginPath(); x.ellipse(0, 0, 15, 6, 0, 0, Math.PI*2); x.fill(); x.fillStyle="#222"; x.fillRect(-5, -2, 10, 4); }
    else {x.fillStyle="#333";x.fillRect(-10,-5,20,10);} 
    return c;
};

window.createCardIcon = function(type) { return window.drawCardToCanvas(type).toDataURL(); };

window.getCardTextureKey = function(scene, type) {
    const key = `card_icon_${type}`; 
    if (!scene.textures.exists(key)) scene.textures.addCanvas(key, window.drawCardToCanvas(type)); 
    return key;
};

window.createGradientTexture = function(scene) {
    if(scene.textures.exists('ui_gradient')) return;
    const w = scene.scale.width; const h = scene.scale.height * 0.25; 
    const c = document.createElement('canvas'); c.width=w; c.height=h; const x = c.getContext('2d');
    const grd = x.createLinearGradient(0, h, 0, 0); 
    grd.addColorStop(0, "rgba(0,0,0,1)"); 
    grd.addColorStop(0.5, "rgba(0,0,0,0.8)"); 
    grd.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = grd; x.fillRect(0, 0, w, h);
    scene.textures.addCanvas('ui_gradient', c);
};

// ---------------------------------------------------------
//  1. 環境システム (素材生成)
// ---------------------------------------------------------
window.EnvSystem = {
    waterHexes: [], forestTrees: [], grassBlades: [],
    
    preload(scene) {
        // ★重要: ここでユニットの形（丸と四角）を作る
        const g = scene.make.graphics({x:0, y:0, add:false}); const S = HEX_SIZE * window.HIGH_RES_SCALE; 
        
        // ヘックス
        g.lineStyle(0.1 * window.HIGH_RES_SCALE, 0x000000, 0.2); g.fillStyle(0xffffff, 1); 
        g.beginPath(); for(let i=0; i<6; i++) { const a = Math.PI/180 * 60 * i; g.lineTo(S + S * Math.cos(a), S + S * Math.sin(a)); } g.closePath(); 
        g.fillPath(); g.strokePath(); g.generateTexture('hex_base', S*2, S*2);
        
        // 環境パーツ
        g.clear(); g.fillStyle(0xffffff, 0.4); g.fillEllipse(15, 5, 12, 2); g.generateTexture('wave_line', 30, 10);
        g.clear(); g.fillStyle(0x1a1a10, 1); g.fillRect(38, 70, 4, 20); g.fillStyle(0x1e3a1e, 1); g.fillTriangle(40, 20, 25, 80, 55, 80); g.fillStyle(0x2a4d2a, 1); g.fillTriangle(40, 5, 30, 50, 50, 50); g.generateTexture('tree', 80, 100);
        g.clear(); g.fillStyle(0x668855, 1); g.fillRect(0, 0, 1, 14); g.generateTexture('grass_blade', 2, 14);
        
        // ★ユニット (Player: 丸, Enemy: 四角)
        g.clear(); g.fillStyle(0xffffff, 1); g.fillCircle(16*window.HIGH_RES_SCALE, 16*window.HIGH_RES_SCALE, 12*window.HIGH_RES_SCALE); 
        g.generateTexture('unit_player', 32*window.HIGH_RES_SCALE, 32*window.HIGH_RES_SCALE);
        
        g.clear(); g.fillStyle(0xffffff, 1); g.fillRect(4*window.HIGH_RES_SCALE, 4*window.HIGH_RES_SCALE, 24*window.HIGH_RES_SCALE, 24*window.HIGH_RES_SCALE); 
        g.generateTexture('unit_enemy', 32*window.HIGH_RES_SCALE, 32*window.HIGH_RES_SCALE);
        
        // カーソルなど
        g.clear(); g.lineStyle(3*window.HIGH_RES_SCALE, 0x00ff00, 1); g.strokeCircle(32*window.HIGH_RES_SCALE, 32*window.HIGH_RES_SCALE, 28*window.HIGH_RES_SCALE); g.generateTexture('cursor', 64*window.HIGH_RES_SCALE, 64*window.HIGH_RES_SCALE);
        g.clear(); g.fillStyle(0x223322, 1); g.fillEllipse(15, 30, 10, 25); g.generateTexture('bomb_body', 30, 60);
    },
    
    clear() { 
        this.waterHexes.forEach(w => { if(w.waves) w.waves.forEach(wave => wave.destroy()); }); this.waterHexes = [];
        this.forestTrees.forEach(t => { if(t.sprite) t.sprite.destroy(); }); this.forestTrees = [];
        this.grassBlades.forEach(g => { if(g.sprite) g.sprite.destroy(); }); this.grassBlades = []; 
    },
    // ... (registerWater, spawnGrass, spawnTrees, update は以前と同じ) ...
    registerWater(hexSprite, baseY, q, r, hexGroup) {
        const scene = hexSprite.scene;
        const w1 = scene.add.image(hexSprite.x + (Math.random()-0.5)*20, hexSprite.y + (Math.random()-0.5)*15, 'wave_line').setScale(0.8);
        const w2 = scene.add.image(hexSprite.x + (Math.random()-0.5)*20, hexSprite.y + (Math.random()-0.5)*15, 'wave_line').setScale(0.6);
        if(hexGroup) { hexGroup.add(w1); hexGroup.add(w2); }
        this.waterHexes.push({ sprite: hexSprite, waves: [w1, w2], baseY: baseY, q: q, r: r, offset: Math.random() * 6.28 });
    },
    spawnGrass(scene, hexGroup, px, py) {
        const count = 15 + Math.floor(Math.random() * 6);
        for(let i=0; i<count; i++) {
            const rad = Math.random() * HEX_SIZE * 0.8; const ang = Math.random() * Math.PI * 2;
            const tx = px + rad * Math.cos(ang); const ty = py + rad * Math.sin(ang) * 0.8;
            const blade = scene.add.image(tx, ty, 'grass_blade').setOrigin(0.5, 1.0).setScale(0.5 + Math.random() * 0.5); 
            const shade = 100 + Math.floor(Math.random()*80);
            blade.setTint(Phaser.Display.Color.GetColor(shade, shade+40, shade));
            if(hexGroup) hexGroup.add(blade);
            this.grassBlades.push({ sprite: blade, px: tx, py: ty });
        }
    },
    spawnTrees(scene, hexGroup, px, py) {
        const count = 8 + Math.floor(Math.random() * 5);
        for(let i=0; i<count; i++) {
            const rad = Math.random() * HEX_SIZE * 0.7; const ang = Math.random() * Math.PI * 2;
            const tx = px + rad * Math.cos(ang); const ty = py + rad * Math.sin(ang) * 0.8;
            const tree = scene.add.image(tx, ty, 'tree').setOrigin(0.5, 1.0).setScale(0.25 + Math.random()*0.35);
            const shade = 100 + Math.floor(Math.random() * 80); 
            tree.setTint(Phaser.Display.Color.GetColor(shade, shade+20, shade+30));
            if(hexGroup) hexGroup.add(tree);
            this.forestTrees.push({ sprite: tree, px: tx, py: ty, sway: 0.04 + Math.random()*0.04 });
        }
    },
    update(time) {
        const timeSec = time * 0.001; const waveSpeed = timeSec;
        const createWind = (px, py, speedOffset) => Math.pow(Math.sin((px - py) * 0.002 + timeSec * 0.8 + speedOffset), 6);
        this.waterHexes.forEach(w => {
            if(!w.sprite.scene) return; 
            const wave = Math.sin(waveSpeed + w.q * 0.3 + w.r * 0.3 + w.offset);
            w.sprite.y = w.baseY + wave * 3; w.sprite.setScale((1/window.HIGH_RES_SCALE) + (wave * 0.01));
            w.waves.forEach((ws, i) => {
                if(!ws.scene) return;
                ws.y = w.sprite.y + (i === 0 ? -5 : 5); ws.x = w.sprite.x + Math.sin(waveSpeed * 0.5 + w.offset + i) * 8; 
                ws.setAlpha((Math.sin(waveSpeed * 1.5 + w.offset + i * 2) + 1) * 0.2 + 0.1);
            });
        });
        this.grassBlades.forEach(g => {
            if(!g.sprite.scene) return;
            const wind = createWind(g.px, g.py, 0); const flutter = Math.sin(timeSec * 15 + g.px) * 0.1; 
            g.sprite.rotation = (wind * 0.4) + (wind > 0.1 ? flutter : 0);
        });
        this.forestTrees.forEach(t => {
            if(!t.sprite.scene) return;
            const wind = createWind(t.px, t.py, -0.5); t.sprite.rotation = wind * t.sway * 1.5; 
        });
    }
};

window.VFX = { 
    particles:[], projectiles:[], shockwaves:[], shakeRequest: 0,
    add(p){this.particles.push(p);}, 
    requestShake(intensity) { this.shakeRequest = Math.max(this.shakeRequest, intensity); },
    smokeColors: [0x4d463e, 0x3d3834, 0x2a2520, 0x555048],
    addBombardment(scene, tx, ty, hex) {
        const startY = ty - 800; const bomb = scene.add.sprite(tx, startY, 'bomb_body').setDepth(2000).setScale(1.5);
        scene.tweens.add({ targets: bomb, y: ty, duration: 400, ease: 'Quad.In', onComplete: () => { if(window.Sfx) window.Sfx.play('boom'); bomb.destroy(); this.requestShake(15); this.addExplosion(tx, ty, "#fa0", 30); if(window.gameLogic && window.gameLogic.applyBombardment) window.gameLogic.applyBombardment(hex); } });
    },
    // ★パーティクル爆発のみにする
    addExplosion(x, y, c, n) { 
        this.requestShake(3); 
        for(let i=0; i<n; i++) { 
            const cInt = (typeof c==='string'&&c.startsWith('#')) ? parseInt(c.replace('#','0x')) : c; 
            this.add({ x, y, vx: Math.cos(Math.random()*6.28)*Math.random()*6, vy: Math.sin(Math.random()*6.28)*Math.random()*6, life: 20+Math.random()*20, maxLife:40, color:cInt, size:2+Math.random()*3, type: 'debris_rect', gravity: 0.4, angle: Math.random()*6, angVel: (Math.random()-0.5)*0.5 }); 
        }
        for(let i=0; i<8; i++) { 
            const color = this.smokeColors[Math.floor(Math.random() * this.smokeColors.length)]; 
            this.add({ x, y, vx:(Math.random()-0.5)*3, vy:-2-Math.random()*2, life:40+Math.random()*20, maxLife:60, color: color, size: 8+Math.random()*8, type: 'smoke_heavy', angle: Math.random()*6, angVel: (Math.random()-0.5)*0.1 }); 
        }
        this.shockwaves.push({x, y, radius:10, maxRadius:100, alpha:1.0});
    },
    addProj(p){ if(p.type === 'bullet' || p.type.includes('shell')) { p.speed *= 10.0; } p.isTracer = Math.random() < 0.3; p.trailX = p.x; p.trailY = p.y; this.projectiles.push(p); this.add({x:p.x, y:p.y, life:3, maxLife:3, size:20, color:0xffaa00, type:'flash'}); this.requestShake(2); },
    addUnitDebris(x,y){ this.addExplosion(x,y, 0x888888, 15); }, 
    update() { 
        this.particles.forEach(p=>{ p.x+=p.vx; p.y+=p.vy; p.life--; if(p.gravity) p.vy += p.gravity; if(p.angVel) p.angle += p.angVel; if(p.type==='debris_rect') { p.vx *= 0.95; p.vy *= 0.95; } if(p.type==='smoke_heavy'){ p.size *= 1.02; p.vx *= 0.85; p.vy *= 0.85; p.alpha = p.life/p.maxLife * 0.7; } if(p.type==='flash'){ p.size*=0.8; } }); 
        this.projectiles.forEach(p=>{ p.trailX = p.x; p.trailY = p.y; if(p.type.includes('shell')||p.type==='rocket'){ p.progress+=p.speed; if(p.progress>=1){p.dead=true;p.onHit();return;} const lx=p.sx+(p.ex-p.sx)*p.progress,ly=p.sy+(p.ey-p.sy)*p.progress,a=Math.sin(p.progress*Math.PI)*p.arcHeight; p.x=lx;p.y=ly-a; }else{ p.x+=p.vx;p.y+=p.vy;p.life--; if(p.life<=0){p.dead=true;p.onHit();} } }); 
        this.shockwaves.forEach(s=>{s.radius+=8;s.alpha-=0.08;}); this.shockwaves=this.shockwaves.filter(s=>s.alpha>0); this.particles=this.particles.filter(p=>p.life>0); this.projectiles=this.projectiles.filter(p=>!p.dead); 
    }, 
    draw(g) { 
        this.shockwaves.forEach(s=>{g.lineStyle(4,0xffffff,s.alpha);g.strokeCircle(s.x,s.y,s.radius);}); 
        this.projectiles.forEach(p=>{ if(p.type === 'rocket') { g.fillStyle(0xffaa00, 1); g.fillCircle(p.x, p.y, 4); if(Math.random()<0.5) this.add({x:p.x, y:p.y, vx:0, vy:0, life:20, maxLife:20, size:5, color:0x888888, type:'smoke_heavy'}); } else { if(p.isTracer) { g.lineStyle(0.8, 0xffffaa, 0.6); g.beginPath(); g.moveTo(p.trailX, p.trailY); g.lineTo(p.x, p.y); g.strokePath(); } } }); 
        this.particles.forEach(p=>{ const alpha = p.alpha !== undefined ? p.alpha : (p.life/p.maxLife); g.fillStyle(p.color, alpha); if (p.type === 'debris_rect') { const s = p.size; g.fillRect(p.x - s/2, p.y - s/2, s, s); } else if (p.type === 'smoke_heavy') { const s = p.size; g.fillEllipse(p.x, p.y, s, s*0.8); } else { g.fillCircle(p.x, p.y, p.size); } }); 
    }
};

window.UIVFX = { 
    particles: [], 
    add(p){this.particles.push(p);}, 
    addFire(x,y){this.add({x,y,vx:(Math.random()-0.5)*1.5,vy:-Math.random()*2-1,life:10+Math.random()*15,maxLife:25,size:2+Math.random(),colorType:'fire'});}, 
    addSmoke(x,y){this.add({x,y,vx:(Math.random()-0.5)*1,vy:-1,life:20+Math.random()*20,maxLife:40,size:3+Math.random()*2,colorType:'smoke'});}, 
    update(){this.particles.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.life--;p.size*=0.94;});this.particles=this.particles.filter(p=>p.life>0);}, 
    draw(g){this.particles.forEach(p=>{let c=0xffffff;let a=p.life/p.maxLife;if(p.colorType==='fire'){if(a>0.7)c=0xffff00;else if(a>0.3)c=0xff4400;else c=0x330000;}else{c=0x555555;a*=0.5;}g.fillStyle(c,a);g.fillCircle(p.x,p.y,p.size);});} 
};

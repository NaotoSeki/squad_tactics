/** * PHASER VFX SPECIALIST (Environment, Particles, Textures) */
const HIGH_RES_SCALE = 4; // 高解像度スケール

// ---------------------------------------------------------
//  1. テクスチャ生成 & 共通描画ヘルパー
// ---------------------------------------------------------
// グローバルにしてBridgeからも呼べるようにする
window.drawCardToCanvas = function(type) {
    const w = 100 * HIGH_RES_SCALE; 
    const h = 60 * HIGH_RES_SCALE;
    const c = document.createElement('canvas'); 
    c.width = w; c.height = h; 
    const x = c.getContext('2d');
    
    x.scale(HIGH_RES_SCALE, HIGH_RES_SCALE); 
    x.translate(50, 30); 
    x.scale(2, 2);
    
    if(type==='infantry'){x.fillStyle="#444";x.fillRect(-15,0,30,4);x.fillStyle="#642";x.fillRect(-15,0,10,4);}
    else if(type==='tank'){x.fillStyle="#444";x.fillRect(-12,-6,24,12);x.fillStyle="#222";x.fillRect(0,-2,16,4);}
    else if(type==='heal'){x.fillStyle="#eee";x.fillRect(-10,-8,20,16);x.fillStyle="#d00";x.fillRect(-3,-6,6,12);x.fillRect(-8,-1,16,2);}
    else if(type==='tiger'){x.fillStyle="#554";x.fillRect(-14,-8,28,16);x.fillStyle="#111";x.fillRect(2,-2,20,4);}
    else if(type==='aerial'){ 
        x.fillStyle="#343"; x.beginPath(); x.ellipse(0, 0, 15, 6, 0, 0, Math.PI*2); x.fill();
        x.fillStyle="#222"; x.fillRect(-5, -2, 10, 4);
    }
    else {x.fillStyle="#333";x.fillRect(-10,-5,20,10);} 
    
    return c;
};

// HTML UI用 (Deployment Phase)
window.createCardIcon = function(type) {
    return window.drawCardToCanvas(type).toDataURL(); 
};

// Phaser用テクスチャキー取得
window.getCardTextureKey = function(scene, type) {
    if (type === 'aerial' && scene.textures.exists('card_img_bomb')) {
        return 'card_img_bomb'; 
    }
    const key = `card_icon_${type}`;
    if (!scene.textures.exists(key)) {
        scene.textures.addCanvas(key, window.drawCardToCanvas(type));
    }
    return key;
};

// UIグラデーション生成
window.createGradientTexture = function(scene) {
    const w = scene.scale.width; const h = scene.scale.height * 0.25; // 1/4サイズ
    const c = document.createElement('canvas'); c.width=w; c.height=h; const x = c.getContext('2d');
    const grd = x.createLinearGradient(0, h, 0, 0);
    grd.addColorStop(0, "rgba(0,0,0,1)"); grd.addColorStop(0.5, "rgba(0,0,0,0.8)"); grd.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = grd; x.fillRect(0, 0, w, h);
    if(scene.textures.exists('ui_gradient')) scene.textures.remove('ui_gradient');
    scene.textures.addCanvas('ui_gradient', c);
};

// ---------------------------------------------------------
//  2. 環境システム (風、森、草、波)
// ---------------------------------------------------------
window.EnvSystem = {
    waterHexes: [],
    forestTrees: [],
    grassBlades: [],

    preload(scene) {
        // 画像読み込み
        scene.load.image('card_img_bomb', 'image_6e3646.jpg'); 
        
        // --- プロシージャルテクスチャ生成 ---
        const g = scene.make.graphics({x:0, y:0, add:false}); 
        const S = HEX_SIZE * HIGH_RES_SCALE; 

        // ヘックスベース
        g.lineStyle(2 * HIGH_RES_SCALE, 0x888888, 1); g.fillStyle(0xffffff, 1); 
        g.beginPath(); for(let i=0; i<6; i++) { const a = Math.PI/180 * 60 * i; g.lineTo(S + S * Math.cos(a), S + S * Math.sin(a)); } g.closePath(); 
        g.fillPath(); g.strokePath(); g.generateTexture('hex_base', S*2, S*2);
        
        // さざ波 (Wave Line)
        g.clear(); g.fillStyle(0xffffff, 0.4); g.fillEllipse(15, 5, 12, 2); g.generateTexture('wave_line', 30, 10);

        // 木 (Deep Forest Tree: 暗く細い)
        g.clear(); 
        g.fillStyle(0x1a1a10, 1); g.fillRect(38, 70, 4, 20); 
        g.fillStyle(0x1e3a1e, 1); g.fillTriangle(40, 20, 25, 80, 55, 80); 
        g.fillStyle(0x2a4d2a, 1); g.fillTriangle(40, 5, 30, 50, 50, 50); 
        g.generateTexture('tree', 80, 100);

        // 草 (Hairgrass: 極細 1px)
        g.clear();
        g.fillStyle(0x668855, 1);
        g.fillRect(0, 0, 1, 14); 
        g.generateTexture('grass_blade', 2, 14);

        // ユニット、カーソル、爆弾など
        g.clear(); g.fillStyle(0x00ff00, 1); g.fillCircle(16*HIGH_RES_SCALE, 16*HIGH_RES_SCALE, 12*HIGH_RES_SCALE); g.generateTexture('unit_player', 32*HIGH_RES_SCALE, 32*HIGH_RES_SCALE);
        g.clear(); g.fillStyle(0xff0000, 1); g.fillRect(4*HIGH_RES_SCALE, 4*HIGH_RES_SCALE, 24*HIGH_RES_SCALE, 24*HIGH_RES_SCALE); g.generateTexture('unit_enemy', 32*HIGH_RES_SCALE, 32*HIGH_RES_SCALE);
        g.clear(); g.lineStyle(3*HIGH_RES_SCALE, 0x00ff00, 1); g.strokeCircle(32*HIGH_RES_SCALE, 32*HIGH_RES_SCALE, 28*HIGH_RES_SCALE); g.generateTexture('cursor', 64*HIGH_RES_SCALE, 64*HIGH_RES_SCALE);
        g.clear(); g.fillStyle(0x223322, 1); g.fillEllipse(15, 30, 10, 25); g.generateTexture('bomb_body', 30, 60);
    },

    clear() {
        this.waterHexes = [];
        this.forestTrees = [];
        this.grassBlades = [];
    },

    // マップ上の特定ヘックスに環境オブジェクト（木や草）を生成して配置する
    decorate(scene, hexGroup, q, r, terrainId, px, py) {
        // 水域 (id:5)
        if(terrainId === 5) { 
            // ヘックス自体はBridge側で生成済みだが、波エフェクトを追加するために情報を保存
            // ※ここではヘックスのスプライトそのものを管理リストに追加する必要があるため、
            // Bridge側で生成したhexスプライトを渡してもらうか、ここでエフェクトだけ追加するか。
            // 設計上、Bridgeで生成したhexスプライトを後から登録するのが綺麗。
            // → updateメソッドで bridge側のhexGroupにアクセスするよりも、
            //    BridgeのcreateMapで、生成したhexスプライトをこのdecorate関数に渡す設計にします。
        }
    },
    
    // Bridgeから呼ばれる登録用関数
    registerWater(hexSprite, baseY, q, r) {
        const scene = hexSprite.scene;
        const w1 = scene.add.image(hexSprite.x + (Math.random()-0.5)*20, hexSprite.y + (Math.random()-0.5)*15, 'wave_line').setScale(0.8);
        const w2 = scene.add.image(hexSprite.x + (Math.random()-0.5)*20, hexSprite.y + (Math.random()-0.5)*15, 'wave_line').setScale(0.6);
        this.waterHexes.push({ sprite: hexSprite, waves: [w1, w2], baseY: baseY, q: q, r: r, offset: Math.random() * 6.28 });
    },

    spawnGrass(scene, hexGroup, px, py) {
        const count = 15 + Math.floor(Math.random() * 6);
        for(let i=0; i<count; i++) {
            const rad = Math.random() * HEX_SIZE * 0.8;
            const ang = Math.random() * Math.PI * 2;
            const tx = px + rad * Math.cos(ang);
            const ty = py + rad * Math.sin(ang) * 0.8;
            
            const blade = scene.add.image(tx, ty, 'grass_blade').setOrigin(0.5, 1.0);
            blade.setScale(0.5 + Math.random() * 0.5); 
            const shade = 100 + Math.floor(Math.random()*80);
            blade.setTint(Phaser.Display.Color.GetColor(shade, shade+40, shade));
            
            this.grassBlades.push({ sprite: blade, px: tx, py: ty });
        }
    },

    spawnTrees(scene, hexGroup, px, py) {
        const count = 8 + Math.floor(Math.random() * 5);
        for(let i=0; i<count; i++) {
            const rad = Math.random() * HEX_SIZE * 0.7;
            const ang = Math.random() * Math.PI * 2;
            const tx = px + rad * Math.cos(ang);
            const ty = py + rad * Math.sin(ang) * 0.8;
            
            const scale = (0.25 + Math.random()*0.35); 
            const tree = scene.add.image(tx, ty, 'tree').setOrigin(0.5, 1.0).setScale(scale);
            const shade = 100 + Math.floor(Math.random() * 80); 
            tree.setTint(Phaser.Display.Color.GetColor(shade, shade+20, shade+30));
            
            hexGroup.add(tree);
            this.forestTrees.push({ sprite: tree, px: tx, py: ty, sway: 0.04 + Math.random()*0.04 });
        }
    },

    // ★風のアニメーション更新 (The Perfect Wind Logic)
    update(time) {
        const timeSec = time * 0.001;
        const waveSpeed = timeSec;

        // 風の方程式
        const createWind = (px, py, speedOffset) => {
            const flow = (px - py) * 0.002 + timeSec * 0.8 + speedOffset;
            const gust = Math.pow(Math.sin(flow), 6); 
            return gust; 
        };
        const globalWind = Math.sin(timeSec * 0.5) * 0.2 + (Math.sin(timeSec * 0.2) > 0.5 ? Math.sin(timeSec * 2) * 0.5 : 0);

        // 水面
        this.waterHexes.forEach(w => {
            const wave = Math.sin(waveSpeed + w.q * 0.3 + w.r * 0.3 + w.offset);
            w.sprite.y = w.baseY + wave * 3;
            w.sprite.setScale((1/HIGH_RES_SCALE) + (wave * 0.01));
            w.waves.forEach((ws, i) => {
                ws.y = w.sprite.y + (i === 0 ? -5 : 5); 
                ws.x = w.sprite.x + Math.sin(waveSpeed * 0.5 + w.offset + i) * 8; 
                ws.setAlpha((Math.sin(waveSpeed * 1.5 + w.offset + i * 2) + 1) * 0.2 + 0.1);
            });
        });

        // 草 (風と呼応)
        this.grassBlades.forEach(g => {
            const wind = createWind(g.px, g.py, 0);
            const flutter = Math.sin(timeSec * 15 + g.px) * 0.1; 
            g.sprite.rotation = (wind * 0.4) + (wind > 0.1 ? flutter : 0);
        });

        // 森 (遅れて重く揺れる)
        this.forestTrees.forEach(t => {
            const wind = createWind(t.px, t.py, -0.5); 
            t.sprite.rotation = wind * t.sway * 1.5; 
        });
    }
};

// ---------------------------------------------------------
//  3. パーティクルエフェクト (VFX / UIVFX)
// ---------------------------------------------------------
window.VFX = { 
    particles:[], projectiles:[], shockwaves:[], 
    add(p){this.particles.push(p);}, 
    
    addBombardment(scene, tx, ty, hex) {
        const startY = ty - 800; const bomb = scene.add.sprite(tx, startY, 'bomb_body').setDepth(2000).setScale(1.5);
        scene.tweens.add({
            targets: bomb, y: ty, duration: 400, ease: 'Quad.In',
            onComplete: () => {
                if(window.Sfx) window.Sfx.play('boom'); 
                bomb.destroy(); scene.cameras.main.shake(300, 0.03); 
                this.addRealExplosion(tx, ty); 
                if(window.gameLogic && window.gameLogic.applyBombardment) window.gameLogic.applyBombardment(hex);
            }
        });
    },
    addRealExplosion(x, y) {
        this.add({x, y, vx:0, vy:0, life:3, maxLife:3, size:150, color:'#fff', type:'flash'});
        this.shockwaves.push({x, y, radius:10, maxRadius:150, alpha:1.0});
        for(let i=0; i<30; i++) this.add({ x, y, vx: Math.cos(Math.random()*6.28)*Math.random()*8, vy: Math.sin(Math.random()*6.28)*Math.random()*8-5, life: 30+Math.random()*20, maxLife:50, color: '#fa0', size: 10+Math.random()*15, type:'fire_core' });
        for(let i=0; i<40; i++) this.add({ x: x+(Math.random()-0.5)*30, y: y+(Math.random()-0.5)*30, vx: Math.cos(Math.random()*6.28)*Math.random()*4, vy: Math.sin(Math.random()*6.28)*Math.random()*4-1, life: 60+Math.random()*40, maxLife:100, color: '#222', size: 8+Math.random()*12, type:'smoke_dark' });
        for(let i=0; i<20; i++) this.add({ x, y, vx: Math.cos(Math.random()*6.28)*(5+Math.random()*10), vy: Math.sin(Math.random()*6.28)*(5+Math.random()*10)-8, life: 40+Math.random()*20, maxLife:60, color: '#444', size: 3, type:'debris', gravity: 0.5 });
    },
    addExplosion(x, y, c, n) { // 通常のヒットエフェクト
        for(let i=0; i<n; i++) this.add({x, y, vx:Math.cos(Math.random()*6.28)*Math.random()*5+1, vy:Math.sin(Math.random()*6.28)*Math.random()*5+1, life:30+Math.random()*20, maxLife:50, color:c, size:2, type:'s'});
    },
    addProj(p){this.projectiles.push(p);},
    addUnitDebris(x,y){}, // (Placeholder)
    
    update() { 
        this.particles.forEach(p=>{ p.x+=p.vx; p.y+=p.vy; p.life--; if(p.type==='debris') p.vy+=p.gravity||0; if(p.type==='fire_core'){p.size*=0.95;p.color=Math.random()>0.3?'#f40':'#300';} if(p.type==='smoke_dark'){p.size*=1.02;p.vx*=0.95;p.vy*=0.95;p.alpha=p.life/p.maxLife*0.8;} if(p.type==='f'){p.size*=0.9;p.color=Math.random()>0.4?'#ff4':(Math.random()>0.5?'#f40':'#620');} else if(p.type==='s'){p.size*=1.02;p.y-=0.5;p.alpha=p.life/p.maxLife;} }); 
        this.projectiles.forEach(p=>{if(p.type.includes('shell')||p.type==='rocket'){p.progress+=p.speed;if(p.progress>=1){p.dead=true;p.onHit();return;}const lx=p.sx+(p.ex-p.sx)*p.progress,ly=p.sy+(p.ey-p.sy)*p.progress,a=Math.sin(p.progress*Math.PI)*p.arcHeight;p.x=lx;p.y=ly-a;}else{p.x+=p.vx;p.y+=p.vy;p.life--;if(p.life<=0){p.dead=true;p.onHit();}}}); 
        this.shockwaves.forEach(s=>{s.radius+=8;s.alpha-=0.08;}); this.shockwaves=this.shockwaves.filter(s=>s.alpha>0); this.particles=this.particles.filter(p=>p.life>0); this.projectiles=this.projectiles.filter(p=>!p.dead); 
    }, 
    draw(g) { 
        this.shockwaves.forEach(s=>{g.lineStyle(4,0xffffff,s.alpha);g.strokeCircle(s.x,s.y,s.radius);}); this.projectiles.forEach(p=>{g.fillStyle(0xffff00,1);g.fillCircle(p.x,p.y,3);}); 
        this.particles.forEach(p=>{ const c=(typeof p.color==='string'&&p.color.startsWith('#'))?parseInt(p.color.replace('#','0x')):p.color; let ci=0xffffff; if(p.color==='#fa0')ci=0xffaa00; else if(p.color==='#f40')ci=0xff4400; else if(p.color==='#ff4')ci=0xffff44; else if(p.color==='#620')ci=0x662200; else if(p.color==='#222')ci=0x222222; else if(p.color==='#444')ci=0x444444; else if(p.color==='#fff')ci=0xffffff; else ci=p.color; g.fillStyle(ci,p.alpha!==undefined?p.alpha:(p.life/p.maxLife)); g.fillCircle(p.x,p.y,p.size); }); 
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

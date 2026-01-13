/** AUDIO ENGINE */
const Sfx = {
    ctx: null,
    init() { if(!this.ctx) this.ctx = new (window.AudioContext||window.webkitAudioContext)(); if(this.ctx.state==='suspended') this.ctx.resume(); },
    noise(dur, freq, type='lowpass', vol=0.2) {
        if(!this.ctx) return; const t=this.ctx.currentTime, b=this.ctx.createBuffer(1,this.ctx.sampleRate*dur,this.ctx.sampleRate), d=b.getChannelData(0);
        for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*Math.exp(-i/(d.length*0.3));
        const s=this.ctx.createBufferSource();s.buffer=b;const f=this.ctx.createBiquadFilter();f.type=type;f.frequency.value=freq;
        const g=this.ctx.createGain();g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(0.01,t+dur);
        s.connect(f);f.connect(g);g.connect(this.ctx.destination);s.start(t);
    },
    play(id) {
        this.init();
        if(id==='click') this.noise(0.05, 3000, 'highpass', 0.1);
        else if(id==='move') this.noise(0.1, 400, 'lowpass', 0.1);
        else if(id==='swap') this.noise(0.2, 800, 'highpass', 0.2);
        else if(id==='shot') this.noise(0.2, 1200);
        else if(id==='mg') this.noise(0.1, 1500, 'bandpass');
        else if(id==='cannon') { this.noise(0.8, 100, 'lowpass', 0.5); this.noise(0.4, 500, 'lowpass', 0.3); }
        else if(id==='boom') { this.noise(1.0, 60, 'lowpass', 0.8); this.noise(0.5, 200, 'lowpass', 0.5); }
        else if(id==='rocket') { this.noise(1.5, 100, 'lowpass', 0.7); }
        else if(id==='ricochet') { this.noise(0.15, 4500, 'bandpass', 0.3); this.noise(0.1, 2000, 'highpass', 0.1); }
        else if(id==='death') { this.noise(0.4, 200, 'lowpass', 0.6); this.noise(0.2, 1000, 'highpass', 0.3); }
        else if(id==='win') {
            const t = this.ctx.currentTime; [440, 554, 659, 880].forEach((f, i) => {
                const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
                o.type = 'square'; o.frequency.value = f; o.connect(g); g.connect(this.ctx.destination);
                g.gain.setValueAtTime(0.1, t + i*0.15); g.gain.linearRampToValueAtTime(0, t + i*0.15 + 0.4);
                o.start(t + i*0.15); o.stop(t + i*0.15 + 0.4);
            });
        }
    }
};

/** HELPER */
function createCardIcon(type) {
    const c = document.createElement('canvas'); c.width=100; c.height=60; const ctx = c.getContext('2d');
    ctx.translate(50, 30); ctx.scale(2,2);
    if(type==='infantry') { ctx.fillStyle="#444"; ctx.fillRect(-15,0,30,4); ctx.fillStyle="#642"; ctx.fillRect(-15,0,10,4); }
    else if(type==='heavy') { ctx.fillStyle="#111"; ctx.fillRect(-10,-2,20,4); ctx.fillRect(-5,2,2,6); ctx.fillRect(5,2,2,6); }
    else if(type==='sniper') { ctx.fillStyle="#222"; ctx.fillRect(-18,0,36,3); ctx.fillRect(-5,-4,10,4); }
    else if(type==='tank') { ctx.fillStyle="#444"; ctx.fillRect(-12,-6,24,12); ctx.fillStyle="#222"; ctx.fillRect(0,-2,16,4); }
    else if(type==='mortar') { ctx.fillStyle="#333"; ctx.fillRect(-14,-8,28,16); ctx.fillStyle="#111"; ctx.beginPath(); ctx.arc(0,-2, 6, 0, Math.PI*2); ctx.fill(); ctx.fillStyle="#522"; ctx.fillRect(-12,-6,4,12); }
    else if(type==='heal') { ctx.fillStyle="#eee"; ctx.fillRect(-10,-8,20,16); ctx.fillStyle="#d00"; ctx.fillRect(-3,-6,6,12); ctx.fillRect(-8,-1,16,2); }
    return c.toDataURL();
}

/** VFX */
const VFX = {
    particles: [], projectiles: [], debris: [], shake: 0,
    add(p) { this.particles.push(p); },
    addProj(p) { this.projectiles.push(p); },
    addStaticDebris(q, r, type) { this.debris.push({q, r, type}); },
    addExplosion(x, y, color="#fa0", count=20) {
        for(let i=0; i<count; i++) {
            const a = Math.random() * Math.PI * 2; const speed = Math.random() * 5 + 1;
            this.add({x, y, vx:Math.cos(a)*speed, vy:Math.sin(a)*speed, life:30+Math.random()*20, maxLife:50, color, size:1+Math.random()*2, type:'spark'});
        }
        for(let i=0; i<10; i++) {
            this.add({x, y, vx:(Math.random()-0.5)*3, vy:(Math.random()-0.5)*3, life:60, maxLife:60, color:"rgba(100,100,100,0.5)", size:4+Math.random()*4, type:'smoke'});
        }
        this.shake = count > 30 ? 20 : 8;
    },
    addUnitDebris(x, y) {
        for(let i=0; i<15; i++) {
            this.add({x, y, vx:(Math.random()-0.5)*8, vy:-Math.random()*8, life:100, maxLife:100, color:Math.random()>0.5?"#888":"#a33", size:Math.random()*3+1, type:'debris'});
        }
    },
    update() {
        if(this.shake>0) this.shake*=0.9; if(this.shake<0.5) this.shake=0;
        this.particles.forEach(p=>{ 
            p.x+=p.vx; p.y+=p.vy; if(p.type==='debris' || p.type==='spark') p.vy+=0.2; p.life--; if(p.type==='debris' && p.vy>0 && Math.random()<0.1) { p.vy *= -0.5; p.vx *= 0.8; }
        });
        this.projectiles.forEach(p=>{
            if(p.type.includes('shell') || p.type === 'rocket') {
                p.progress+=p.speed; if(p.progress>=1) { p.dead=true; p.onHit(); return; }
                const lx = p.sx + (p.ex-p.sx)*p.progress;
                const ly = p.sy + (p.ey-p.sy)*p.progress;
                const arc = Math.sin(p.progress*Math.PI) * p.arcHeight;
                p.x=lx; p.y=ly-arc;
                if(p.type === 'rocket' && Math.random() < 0.5) { VFX.add({x:p.x, y:p.y, vx:(Math.random()-0.5), vy:(Math.random()-0.5), life:20, maxLife:20, color:"#888", size:3, type:'smoke'}); }
            } else { p.x+=p.vx; p.y+=p.vy; p.life--; if(p.life<=0){ p.dead=true; p.onHit(); } }
        });
        this.particles=this.particles.filter(p=>p.life>0); this.projectiles=this.projectiles.filter(p=>!p.dead);
    },
    draw(ctx) {
        ctx.save();
        this.projectiles.forEach(p=>{
            if(p.type.includes('shell')) { ctx.fillStyle="#fff"; ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI*2); ctx.fill(); }
            else if(p.type === 'rocket') { ctx.fillStyle="#f80"; ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI*2); ctx.fill(); }
            else { ctx.strokeStyle="#ffeb3b"; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(p.x-p.vx, p.y-p.vy); ctx.lineTo(p.x, p.y); ctx.stroke(); }
        });
        this.particles.forEach(p=>{
            ctx.fillStyle=p.color; ctx.globalAlpha=p.life/p.maxLife; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI*2); ctx.fill();
        });
        ctx.restore();
    }
};

/** RENDERER */
const Renderer = {
    // ... (init, resize, hexToPx等は変更なし)
    // 既存の関数はそのまま維持し、drawRangeとdrawHexだけ更新・確認してください

    // ... (前略)
    
    drawHex(q,r,t,hlCount) {
        const p=this.hexToPx(q,r);
        if(p.x<-60||p.y<-60||p.x>this.canvas.width+60||p.y>this.canvas.height+60) return;
        const ctx=this.ctx;
        ctx.beginPath(); for(let i=0;i<6;i++) ctx.lineTo(p.x+HEX_SIZE*Math.cos(Math.PI/3*i), p.y+HEX_SIZE*Math.sin(Math.PI/3*i)); ctx.closePath();
        
        // ★水域の描画を少しリッチに（波のような演出）
        if (t.id === 5) {
            ctx.fillStyle = "#303840"; ctx.fill();
            if (Math.random() < 0.01) { 
                ctx.fillStyle = "rgba(255,255,255,0.1)"; 
                ctx.fillRect(p.x - 5, p.y - 2, 10, 4); // 波キラキラ
            }
        } else {
            ctx.fillStyle=t.color; ctx.fill();
        }
        
        if(hlCount > 0) {
            const speed = 0.1 + (hlCount * 0.05);
            const pulse = 0.5 + Math.sin(this.frame * speed) * 0.5;
            ctx.strokeStyle=`rgba(255, 200, 50, ${pulse})`; ctx.lineWidth=2 + hlCount*0.5; ctx.stroke();
        } else {
            ctx.strokeStyle="rgba(0,0,0,0.2)"; ctx.lineWidth=1; ctx.stroke();
        }

        ctx.fillStyle="rgba(0,0,0,0.15)";
        if(t.id===2) { ctx.beginPath(); ctx.arc(p.x, p.y, HEX_SIZE*0.6, 0, Math.PI*2); ctx.fill(); } // FOREST
        else if(t.id===4) ctx.fillRect(p.x-8, p.y-8, 16, 16); // TOWN
    },

    // ★改修: 射程範囲を「枠線」＆「命中率に応じた色」で表示
    drawRange(u) {
        if(!u) return;
        const wpn=WPNS[u.curWpn];
        const ctx=this.ctx;
        const q_min = u.q - wpn.rng, q_max = u.q + wpn.rng;
        
        ctx.lineWidth = 2;

        for(let q=q_min; q<=q_max; q++) {
            for(let r=u.r-wpn.rng; r<=u.r+wpn.rng; r++) {
                // 距離判定
                const dist = (Math.abs(q-u.q)+Math.abs(q+r-u.q-u.r)+Math.abs(r-u.r))/2;
                if(dist <= wpn.rng && dist > 0) { // 自分自身は除外
                    // 簡易的な距離による命中率低下の表現
                    // 距離が近い＝白(RGB 255,255,255), 遠い＝赤(RGB 255,50,50)
                    const ratio = dist / wpn.rng; 
                    const g = Math.floor(255 * (1 - ratio * 0.8)); // 遠いと緑成分が減る
                    const b = Math.floor(255 * (1 - ratio * 0.8)); // 遠いと青成分が減る
                    
                    const p=this.hexToPx(q,r);
                    ctx.strokeStyle = `rgba(255, ${g}, ${b}, 0.6)`; // 半透明の枠線
                    
                    ctx.beginPath(); 
                    // 枠線を少し内側に描く（0.85倍）
                    for(let i=0;i<6;i++) ctx.lineTo(p.x+HEX_SIZE*0.85*Math.cos(Math.PI/3*i), p.y+HEX_SIZE*0.85*Math.sin(Math.PI/3*i)); 
                    ctx.closePath();
                    ctx.stroke();
                }
            }
        }
    },

    // ... (drawStaticDebris, drawUnit は変更なし)
    // 既存のコードをそのまま使ってください
    drawStaticDebris(q, r, type) {
        const p=this.hexToPx(q, r); const ctx=this.ctx;
        if(type==='crater') { ctx.fillStyle="rgba(0,0,0,0.4)"; ctx.beginPath(); ctx.arc(p.x, p.y, 12, 0, Math.PI*2); ctx.fill(); }
        else if(type==='wreck') { ctx.fillStyle="#222"; ctx.fillRect(p.x-10, p.y-10, 20, 15); ctx.fillStyle="#333"; ctx.fillRect(p.x-5, p.y-15, 10, 5); }
    },
    drawUnit(u, sel) {
        const p=this.hexToPx(u.q, u.r); const ctx=this.ctx; ctx.save(); ctx.translate(p.x, p.y);
        if(sel) { ctx.beginPath(); ctx.arc(0,0,22,0,Math.PI*2); ctx.strokeStyle="#0f0"; ctx.lineWidth=2; ctx.stroke(); }
        if(u.ap > 0 && u.team === 'player') {
            const ang = this.frame * 0.05; const yOff = -38 + Math.sin(this.frame*0.1)*3;
            ctx.save(); ctx.translate(0, yOff); ctx.rotate(ang); ctx.fillStyle = "#fd0";
            ctx.beginPath(); ctx.moveTo(0,-4); ctx.lineTo(4,0); ctx.lineTo(0,4); ctx.lineTo(-4,0); ctx.fill(); ctx.restore();
        }
        const col = u.team==='player'?'#68a':'#c65';
        if(u.def.isTank) {
            ctx.fillStyle="#222"; ctx.fillRect(-10,-12,4,24); ctx.fillRect(6,-12,4,24);
            ctx.fillStyle=col; ctx.fillRect(-6,-10,12,20);
            ctx.fillStyle="#333"; ctx.beginPath(); ctx.arc(0,0,6,0,Math.PI*2); ctx.fill(); 
            if(u.def.name.includes("Mortar")) ctx.fillRect(0,-4,12,8); else ctx.fillRect(0,-2,20,4);
        } else {
            let h = u.stance === 'prone' ? 3 : (u.stance === 'crouch' ? 5 : 8);
            const pts=[[-6,-6],[6,-6],[0,6]];
            pts.forEach(pt=>{
                ctx.fillStyle="rgba(0,0,0,0.5)"; ctx.beginPath(); ctx.arc(pt[0], pt[1]+2, 4, 0, Math.PI*2); ctx.fill();
                ctx.fillStyle=col; if(u.stance==='prone') ctx.fillRect(pt[0]-5, pt[1]-3, 10, 4); else ctx.fillRect(pt[0]-3, pt[1]-h, 6, h+2);
                ctx.fillStyle="#dcb"; ctx.fillRect(pt[0]-2, pt[1]-h-3, 4, 3);
            });
        }
        ctx.fillStyle="#000"; ctx.fillRect(-10,-22,20,3); ctx.fillStyle=u.hp>u.maxHp/2?"#0f0":"#f00"; ctx.fillRect(-10,-22,20*(u.hp/u.maxHp),3);
        if(u.rank > 0) { ctx.fillStyle="#fd0"; ctx.font="9px monospace"; ctx.fillText(RANKS[Math.min(u.rank,5)] + (u.skills.includes('Hero')?'★':''), -12, -25); }
        ctx.restore();
    }
};

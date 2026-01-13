/** LOGIC */
class Game {
    constructor() {
        this.units=[]; this.map=[]; this.setupSlots=[]; this.state='SETUP'; this.path=[]; this.animQueue=[]; this.debris=[]; this.confetti=[]; this.isAuto=false;
        this.isProcessingTurn = false; 
        this.sector = 1; this.initDOM(); this.initSetup();
        const loop=()=>{ Renderer.frame++; VFX.update(); this.updateConfetti(); this.draw(); if(this.isAuto) this.runAuto(); requestAnimationFrame(loop); }; 
        requestAnimationFrame(loop);
    }

    initDOM() {
        Renderer.init(document.getElementById('cvs'));
        const cvs=document.getElementById('cvs');
        let isDrag=false, lx, ly;
        cvs.addEventListener('mousedown', e=>{
            if(this.state!=='PLAY' || this.isAuto) return;
            if(e.button===2) { this.showContext(e.clientX, e.clientY); return; } // 右クリック
            isDrag=true; lx=e.clientX; ly=e.clientY; this.handleClick(Renderer.pxToHex(e.clientX, e.clientY));
        });
        window.addEventListener('mousemove', e=>{
            if(isDrag) { Renderer.cam.x+=e.clientX-lx; Renderer.cam.y+=e.clientY-ly; lx=e.clientX; ly=e.clientY; }
            else if(this.state==='PLAY') {
                const p=Renderer.pxToHex(e.clientX, e.clientY); this.hoverHex=p;
                if(this.selectedUnit && this.isValidHex(p.q, p.r) && !this.getUnit(p.q, p.r)) this.path=this.findPath(this.selectedUnit, p.q, p.r);
                else this.path=[];
            }
        });
        window.addEventListener('mouseup', ()=>isDrag=false);
        window.addEventListener('contextmenu', e=>e.preventDefault());
        window.addEventListener('click', (e)=>{
            if(!e.target.closest('#context-menu')) document.getElementById('context-menu').style.display='none';
        });
    }

    initSetup() {
        const box=document.getElementById('setup-cards');
        ['infantry','heavy','sniper','tank'].forEach(k=>{
            const u=UNITS[k]; const d=document.createElement('div'); d.className='card';
            d.innerHTML=`<div class="card-badge">x0</div><div class="card-img-box"><img src="${createCardIcon(k)}"></div><div class="card-body"><h3>${u.name}</h3><p>${u.desc}</p></div>`;
            d.onclick=()=>{
                if(this.setupSlots.length<3) {
                    this.setupSlots.push(k);
                    const count = this.setupSlots.filter(s => s === k).length;
                    const badge = d.querySelector('.card-badge');
                    badge.style.display = 'block'; badge.innerText = "x" + count;
                    this.log(`> 選択: ${u.name}`);
                    document.getElementById('slots-left').innerText=3-this.setupSlots.length;
                    if(this.setupSlots.length===3) document.getElementById('btn-start').style.display='block';
                }
            }; box.appendChild(d);
        });
    }

    startCampaign() {
        document.getElementById('setup-screen').style.display='none'; Renderer.resize();
        this.generateMap();
        if(this.units.length === 0) { this.setupSlots.forEach(k=>this.spawnAtSafeGround('player',k)); }
        else { this.units.filter(u=>u.team==='player').forEach(u=>{ u.q=null; this.spawnAtSafeGround('player',null,u); }); }
        this.spawnEnemies();
        this.state='PLAY'; 
        this.log(`MISSION START - SECTOR ${this.sector}`);
        document.getElementById('sector-counter').innerText = `SECTOR: ${this.sector.toString().padStart(2, '0')}`;
        this.confetti=[]; VFX.debris=[];
        if(this.units.length>0) Renderer.centerOn(this.units[0].q, this.units[0].r);
    }

    // Map生成: 円形島 & 川
    generateMap() {
        this.map=[]; 
        const cx = Math.floor(MAP_W/2);
        const cy = Math.floor(MAP_H/2);
        const maxRadius = Math.min(MAP_W, MAP_H) / 2 - 2; 

        for(let q=0; q<MAP_W; q++) {
            this.map[q]=[];
            for(let r=0; r<MAP_H; r++) {
                const dist = (Math.abs(q-cx) + Math.abs(q+r-cx-cy) + Math.abs(r-cy)) / 2;
                if(dist > maxRadius) {
                    this.map[q][r] = TERRAIN.VOID;
                } else if(dist > maxRadius - 1.5) {
                    this.map[q][r] = TERRAIN.WATER;
                } else {
                    const noise = Math.sin(q*0.5) + Math.cos(r*0.5) + Math.random()*0.3;
                    let t = TERRAIN.GRASS;
                    if(noise > 1.2) t = TERRAIN.FOREST;
                    else if(noise < -0.8) t = TERRAIN.DIRT;
                    if(t !== TERRAIN.WATER && Math.random()<0.06) t = TERRAIN.TOWN;
                    this.map[q][r] = t;
                }
            }
        }

        // 川の生成
        let riverQ = cx, riverR = cy;
        const steps = 30;
        for(let i=0; i<steps; i++) {
            if(this.isValidHex(riverQ, riverR)) {
                if(this.map[riverQ][riverR].id === 5 || this.map[riverQ][riverR].id === -1) break;
                this.map[riverQ][riverR] = TERRAIN.WATER;
                const dirs=[[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
                const d = dirs[Math.floor(Math.random()*6)];
                riverQ += d[0];
                riverR += d[1];
            }
        }
    }

    spawnEnemies() {
        const count = 4 + Math.floor(this.sector * 0.7);
        const tankChance = Math.min(0.8, 0.1 + (this.sector * 0.1));
        for(let i=0; i<count; i++) {
            let k = 'infantry'; const rnd = Math.random();
            if (rnd < tankChance) k = 'tank'; else if (rnd < tankChance + 0.3) k = 'heavy'; else if (rnd < tankChance + 0.5) k = 'sniper';
            const enemy = this.spawnAtSafeGround('enemy', k);
            if(enemy) { 
                enemy.rank = Math.floor(Math.random() * Math.min(5, this.sector/2)); enemy.maxHp+=enemy.rank*30; enemy.hp=enemy.maxHp; 
                if(this.sector > 2 && Math.random() < 0.4) {
                    const sk = Object.keys(SKILLS);
                    enemy.skills = [sk[Math.floor(Math.random()*sk.length)]];
                }
            }
        }
    }

    spawnAtSafeGround(team, key, existingUnit=null) {
        let q, r, tries=0;
        const cx = Math.floor(MAP_W/2);
        const cy = Math.floor(MAP_H/2);

        do { 
            q = Math.floor(Math.random()*MAP_W);
            r = Math.floor(Math.random()*MAP_H);
            tries++; 
            if(team==='player' && r < cy) continue;
            if(team==='enemy' && r > cy) continue;
        } 
        while((!this.isValidHex(q,r) || this.map[q][r].id === 5 || this.map[q][r].id === -1 || this.map[q][r].cost>=99 || this.getUnit(q,r)) && tries<1000);

        if(tries<1000) {
            if(existingUnit) { existingUnit.q=q; existingUnit.r=r; return existingUnit; }
            else return this.spawnUnit(team, key, q, r);
        } return null;
    }

    spawnUnit(team, k, q, r) {
        const def=UNITS[k];
        const apMod = def.ap;
        this.units.push({
            id:Math.random(), team, q, r, def, 
            hp:def.hp, maxHp:def.hp, ap:apMod, maxAp:apMod, 
            stance:'stand', curWpn:def.wpn, rank:0, deadProcessed:false,
            skills: [], sectorsSurvived: 0
        });
    }

    toggleAuto() {
        this.isAuto = !this.isAuto;
        document.getElementById('auto-toggle').classList.toggle('active');
        this.log(`AUTO PILOT: ${this.isAuto ? "ON" : "OFF"}`);
        this.selectedUnit = null; this.path = [];
        if(this.isAuto) this.runAuto();
    }

    autoTimer = 0;
    runAuto() {
        if(this.state !== 'PLAY' || this.autoTimer > 0) { if(this.autoTimer>0) this.autoTimer--; return; }
        const active = this.units.filter(u => u.team==='player' && u.hp>0 && u.ap>0);
        if(active.length === 0) { this.endTurn(); return; }
        const u = active[0];
        const enemies = this.units.filter(e => e.team==='enemy' && e.hp>0);
        if(enemies.length===0) return;
        let target = enemies[0], score = -9999;
        enemies.forEach(e => { const d = this.hexDist(u, e); let val = (100 - e.hp) * 2 - (d * 10); if(val > score) { score=val; target=e; } });
        const wpn = WPNS[u.curWpn]; const dist = this.hexDist(u, target);
        if(dist <= wpn.rng && u.ap >= 2) { this.actionAttack(u, target); this.autoTimer = 80; } 
        else {
            const path = this.findPath(u, target.q, target.r);
            if(path.length > 0 && path[0].q && this.map[path[0].q][path[0].r].cost <= u.ap) {
                u.q = path[0].q; u.r = path[0].r; u.ap -= this.map[u.q][u.r].cost; Sfx.play('move'); this.autoTimer = 20; this.checkReactionFire(u);
            } else u.ap = 0;
        }
    }

    handleClick(p) {
        if(!this.isValidHex(p.q, p.r)) return;
        const u=this.getUnit(p.q, p.r);
        if(u && u.team==='player') { this.selectedUnit=u; Sfx.play('click'); this.updateSidebar(); }
        else if(this.selectedUnit) {
            if(u && u.team==='enemy') this.actionAttack(this.selectedUnit, u);
            else if(!u && this.path.length>0) this.actionMove(this.selectedUnit, this.path);
        }
    }

    async actionMove(u, path) {
        this.state='ANIM'; this.selectedUnit=null; this.path=[];
        for(let s of path) {
            u.ap-=this.map[s.q][s.r].cost; u.q=s.q; u.r=s.r;
            Sfx.play('move'); await new Promise(r=>setTimeout(r,180));
        }
        this.checkReactionFire(u);
        this.state='PLAY'; if(u.ap>0) this.selectedUnit=u; this.updateSidebar(); this.checkPhaseEnd();
    }

    checkReactionFire(u) {
        const enemies = this.units.filter(e => e.team !== u.team && e.hp > 0 && e.def.isTank && this.hexDist(u, e) <= 2);
        enemies.forEach(tank => {
            this.log(`!! 近接防御射撃: ${tank.def.name} -> ${u.def.name}`);
            u.hp -= 15; VFX.addExplosion(Renderer.hexTo

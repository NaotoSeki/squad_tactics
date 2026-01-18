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
            if(e.button===2) { this.showContext(e.clientX, e.clientY); return; }
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
        window.addEventListener('click', ()=>document.getElementById('context-menu').style.display='none');
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

    generateMap() {
        this.map=[]; const cx=MAP_W/2, cy=MAP_H/2;
        for(let q=0; q<MAP_W; q++) {
            this.map[q]=[];
            for(let r=0; r<MAP_H; r++) {
                const dx=q-cx, dy=r-cy; const dist=Math.sqrt(dx*dx + dy*dy);
                const noise=Math.sin(q*0.4)+Math.cos(r*0.4)+Math.random()*0.4;
                let t=TERRAIN.VOID;
                if(dist<7+noise) { t=TERRAIN.GRASS; if(noise>1) t=TERRAIN.FOREST; else if(noise<-0.8) t=TERRAIN.DIRT; if(dist>6+noise) t=TERRAIN.DIRT; }
                else t=TERRAIN.WATER;
                if(t!==TERRAIN.WATER && Math.random()<0.04) t=TERRAIN.TOWN;
                this.map[q][r]=t;
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
        do { 
            q=Math.floor(Math.random()*MAP_W); r=Math.floor(Math.random()*MAP_H); tries++; 
            if(team==='player' && r < MAP_H/2) continue;
            if(team==='enemy' && r > MAP_H/2) continue;
        } 
        while((!this.isValidHex(q,r) || this.map[q][r].cost>=99 || this.getUnit(q,r)) && tries<500);

        if(tries<500) {
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
            u.hp -= 15; VFX.addExplosion(Renderer.hexToPx(u.q,u.r).x, Renderer.hexToPx(u.q,u.r).y, "#ffaa00", 5); Sfx.play('mg');
            if(u.hp<=0 && !u.deadProcessed) { u.deadProcessed=true; this.log(`${u.def.name} 撃破`); Sfx.play('death'); }
        });
    }

    swapWeapon() {
        if(this.selectedUnit && this.selectedUnit.ap >= 1) {
            const u = this.selectedUnit; u.ap--;
            u.curWpn = (u.curWpn === u.def.wpn) ? u.def.alt : u.def.wpn;
            Sfx.play('swap'); this.log(`${u.def.name} 武装変更: ${WPNS[u.curWpn].name}`);
            this.updateSidebar();
        }
    }

    async actionAttack(atk, def) {
        if(atk.ap<2) { this.log("AP不足!"); return; }
        const wpn=WPNS[atk.curWpn];
        if(this.hexDist(atk, def) > wpn.rng) { this.log("射程外です"); return; }
        
        atk.ap-=2; this.state='ANIM';
        
        const getSkillCount = (unit, key) => unit.skills.filter(s => s === key).length;

        let bonus = this.getNeighbors(atk.q, atk.r).filter(n => this.getUnit(n.q, n.r)?.team === atk.team).length * 10;
        if(atk.skills.includes("Radio")) bonus += (15 * getSkillCount(atk, "Radio"));
        
        let accMod = (atk.rank || 0) * 8 + (getSkillCount(atk, "Precision") * 15); 
        let dmgMod = 1.0 + (getSkillCount(atk, "HighPower") * 0.2);

        this.log(`${atk.def.name} 攻撃(支援+${bonus}%)`);
        
        let burst = wpn.burst || 1;
        burst += (getSkillCount(atk, "AmmoBox") * (wpn.name === 'MG42' ? 3 : 1));

        const pType = wpn.type; const isShell = pType.includes('shell');
        const isRocket = pType === 'rocket'; 

        for(let i=0; i<burst; i++) {
            if(def.hp <= 0 && !isRocket) break;
            Sfx.play(isRocket ? 'rocket' : (isShell?'cannon':(burst>1?'mg':'shot')));
            const s=Renderer.hexToPx(atk.q, atk.r), e=Renderer.hexToPx(def.q, def.r);
            const ex=e.x+(Math.random()-0.5)*10, ey=e.y+(Math.random()-0.5)*10;
            const proj = { 
                x:s.x, y:s.y, sx:s.x, sy:s.y, ex:ex, ey:ey, type:pType, progress:0, 
                speed: isRocket ? 0.02 : (pType==='shell_fast'? 0.1 : 0.05),
                arcHeight: isRocket ? 250 : (isShell?(pType==='shell_fast'?40:120):0),
                onHit: () => {
                    if (isRocket) {
                        VFX.addExplosion(ex, ey, "#fa0", 50); Sfx.play('boom');
                        [{q:def.q, r:def.r}, ...this.getNeighbors(def.q, def.r)].forEach(loc => {
                            const v = this.getUnit(loc.q, loc.r);
                            if(v) {
                                let dmg = wpn.dmg * dmgMod; 
                                v.hp -= dmg;
                                this.log(`>> 爆風: ${v.def.name} (-${Math.floor(dmg)})`);
                                if(v.hp<=0 && !v.deadProcessed) { v.deadProcessed = true; this.log(`${v.def.name} 爆散`); VFX.addUnitDebris(Renderer.hexToPx(v.q,v.r).x, Renderer.hexToPx(v.q,v.r).y); VFX.addStaticDebris(v.q, v.r, v.def.isTank ? 'wreck' : 'crater'); }
                            }
                        });
                    } else {
                        if(def.hp <= 0) return;
                        let hit = wpn.acc - this.map[def.q][def.r].cover + accMod;
                        if(def.stance==='prone') hit-=25;
                        if(def.skills && def.skills.includes("Ambush")) hit-= (getSkillCount(def, "Ambush") * 15);

                        if(Math.random()*100 < hit) {
                            let dmg = Math.floor(wpn.dmg * (1+bonus/100) * (0.8+Math.random()*0.4) * dmgMod);
                            if(def.stance==='prone') dmg=Math.floor(dmg*0.6);

                            const armorLevel = getSkillCount(def, "Armor");
                            if(armorLevel > 0) {
                                const reduction = armorLevel * 10;
                                dmg = Math.max(1, dmg - reduction);
                                if(i === 0) this.log(`>> 装甲が衝撃を吸収 (-${reduction})`);
                            }

                            def.hp-=dmg; 
                            VFX.addExplosion(ex, ey, "#f55", 5); Sfx.play(isShell?'boom':'shot');
                            if(wpn.area || Math.random() < 0.2) {
                                this.getNeighbors(def.q, def.r).forEach(n=>{
                                    const v = this.getUnit(n.q, n.r);
                                    if(v && Math.random()<0.4){ v.hp-=10; if(v.hp<=0 && !v.deadProcessed) { v.deadProcessed=true; this.log(`${v.def.name} 爆散`); VFX.addUnitDebris(Renderer.hexToPx(v.q,v.r).x, Renderer.hexToPx(v.q,v.r).y); } }
                                });
                            }
                        } else { Sfx.play('ricochet'); VFX.add({x:ex,y:ey,vx:(Math.random()-0.5)*5,vy:-5,life:5,maxLife:5,color:"#fff",size:2,type:'spark'}); }
                    }
                }
            };
            if(!isShell && !isRocket) { 
                const dx=ex-s.x, dy=ey-s.y, ang=Math.atan2(dy,dx); 
                proj.vx=Math.cos(ang)*25; proj.vy=Math.sin(ang)*25; proj.life=Math.sqrt(dx*dx+dy*dy)/25; 
            }
            VFX.addProj(proj);
            await new Promise(r=>setTimeout(r, isRocket ? 800 : (isShell?200:40)));
        }
        
        setTimeout(() => { 
            const dead = this.units.filter(u=>u.hp<=0);
            dead.forEach(d => {
                if(!d.deadProcessed) {
                    d.deadProcessed = true; if(d === def) { this.log(`${d.def.name} 撃破`); Sfx.play('death'); }
                    VFX.addUnitDebris(Renderer.hexToPx(d.q,d.r).x, Renderer.hexToPx(d.q,d.r).y);
                    VFX.addStaticDebris(d.q, d.r, d.def.isTank ? 'wreck' : 'crater');
                }
            });
            if (this.checkWin()) return; this.checkLose();
            this.state='PLAY'; this.updateSidebar(); this.checkPhaseEnd();
        }, isRocket ? 1200 : 500);
    }

    checkPhaseEnd() { if(this.units.filter(u=>u.team==='player'&&u.hp>0&&u.ap>0).length===0 && this.state==='PLAY') this.endTurn(); }
    setStance(s) { if(this.selectedUnit && this.selectedUnit.ap>=1 && !this.selectedUnit.def.isTank) { this.selectedUnit.ap--; this.selectedUnit.stance=s; this.updateSidebar(); this.checkPhaseEnd(); } }

    endTurn() {
        if(this.isProcessingTurn) return;
        this.isProcessingTurn = true; 

        this.selectedUnit=null; this.state='ANIM'; document.getElementById('eyecatch').style.opacity=1;
        
        this.units.filter(u=>u.team==='player'&&u.hp>0&&u.skills.includes("Mechanic")).forEach(u=>{
            const count = u.skills.filter(s => s === "Mechanic").length;
            if(u.hp < u.maxHp) { u.hp = Math.min(u.maxHp, u.hp + (count * 20)); this.log(`${u.def.name} 自己修復`); }
        });

        setTimeout(async () => {
            document.getElementById('eyecatch').style.opacity=0;
            const enemies=this.units.filter(u=>u.team==='enemy'&&u.hp>0);
            for(let e of enemies) {
                const players=this.units.filter(u=>u.team==='player'&&u.hp>0); if(players.length===0) { this.checkLose(); break; }
                e.ap=e.maxAp; let target=players[0], minDist=999;
                players.forEach(p=>{ const d=this.hexDist(e,p); if(d<minDist){minDist=d; target=p;} });
                if(minDist <= 6) {
                    if(minDist<=4 && e.ap>=1 && !e.def.isTank) e.stance='crouch';
                    await this.actionAttack(e, target);
                } else { 
                    const nq=e.q+(target.q>e.q?1:-1); if(!this.getUnit(nq,e.r)&&this.isValidHex(nq,e.r)&&this.map[nq][e.r].cost<99){ e.q=nq; e.ap--; await new Promise(r=>setTimeout(r,200)); } 
                }
            }
            this.units.forEach(u=>{if(u.team==='player') u.ap=u.maxAp;}); this.log("-- PLAYER PHASE --"); this.state='PLAY';
            this.isProcessingTurn = false;
        }, 1200);
    }

    healSurvivors() {
        this.units.filter(u=>u.team==='player'&&u.hp>0).forEach(u=>{ 
            const target=Math.floor(u.maxHp*0.8); if(u.hp<target)u.hp=target; 
        });
        this.log("生存部隊 治療完了 (MAX 80%)");
    }
    promoteSurvivors() {
        const skKeys = Object.keys(SKILLS).filter(k => k !== "Hero");
        this.units.filter(u=>u.team==='player'&&u.hp>0).forEach(u=>{ 
            u.sectorsSurvived++;
            if(u.sectorsSurvived === 5) {
                u.skills.push("Hero");
                u.maxAp += 1;
                this.log(`${u.def.name} 【英雄】昇格 (AP+1)`);
            }
            
            u.rank=Math.min(5, (u.rank||0)+1); u.maxHp+=30; u.hp+=30; 
            
            if(u.skills.length < 8 && Math.random() < 0.7) {
                const newSkill = skKeys[Math.floor(Math.random()*skKeys.length)];
                u.skills.push(newSkill);
                this.log(`${u.def.name} 強化: ${SKILLS[newSkill].name}習得`);
            }
            this.log(`${u.def.name} 昇進 -> ${RANKS[u.rank]}`); 
        });
    }

    checkWin() {
        if(this.units.filter(u=>u.team==='enemy'&&u.hp>0).length===0) {
            Sfx.play('win'); this.createConfetti(); document.getElementById('reward-screen').style.display='flex';
            this.promoteSurvivors(); 
            const box=document.getElementById('reward-cards'); box.innerHTML='';
            const options = [{k:'infantry',t:'新兵'},{k:'tank',t:'戦車'},{k:'heal',t:'医療支援'}];
            if(Math.random()<0.3) options.push({k:'mortar',t:'突撃臼砲'});
            options.forEach(opt=>{
                const d=document.createElement('div'); d.className='card';
                const img = opt.k==='heal' ? createCardIcon('heal') : createCardIcon(opt.k);
                d.innerHTML=`<div class="card-img-box"><img src="${img}"></div><div class="card-body"><h3>${opt.t}</h3><p>補給実行</p></div>`;
                d.onclick=()=>{ 
                    if(opt.k==='heal') this.healSurvivors(); else this.spawnAtSafeGround('player', opt.k);
                    this.sector++; document.getElementById('reward-screen').style.display='none'; this.startCampaign();
                }; box.appendChild(d);
            });
            return true;
        }
        return false;
    }
    
    checkLose() { if(this.units.filter(u=>u.team==='player'&&u.hp>0).length===0) document.getElementById('gameover-screen').style.display='flex'; }

    createConfetti() { for(let i=0; i<100; i++) this.confetti.push({x:Math.random()*Renderer.canvas.width, y:-Math.random()*500, c:`hsl(${Math.random()*360},80%,50%)`, s:Math.random()*3+2, v:Math.random()*3+3}); }
    updateConfetti() { this.confetti.forEach(p=>{ p.y+=p.v; p.x+=Math.sin(p.y*0.05); if(p.y>Renderer.canvas.height) p.y=-10; Renderer.ctx.fillStyle=p.c; Renderer.ctx.fillRect(p.x,p.y,p.s,p.s); }); }
    getUnit(q,r){return this.units.find(u=>u.q===q&&u.r===r&&u.hp>0);}
    isValidHex(q,r){return q>=0&&q<MAP_W&&r>=0&&r<MAP_H;}
    hexDist(a,b){return (Math.abs(a.q-b.q)+Math.abs(a.q+a.r-b.q-b.r)+Math.abs(a.r-b.r))/2;}
    getNeighbors(q,r){ const dirs=[[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]]; return dirs.map(d=>({q:q+d[0],r:r+d[1]})).filter(h=>this.isValidHex(h.q,h.r)); }
    findPath(u,tq,tr){
        let frontier=[{q:u.q,r:u.r}], cameFrom={}, costSoFar={}; cameFrom[`${u.q},${u.r}`]=null; costSoFar[`${u.q},${u.r}`]=0;
        while(frontier.length>0){
            let cur=frontier.shift(); if(cur.q===tq&&cur.r===tr) break;
            this.getNeighbors(cur.q,cur.r).forEach(n=>{
                if(this.getUnit(n.q,n.r)&&(n.q!==tq||n.r!==tr)) return;
                let c=this.map[n.q][n.r].cost; if(c>=99) return;
                let nc=costSoFar[`${cur.q},${cur.r}`]+c;
                if(nc<=u.ap){ let k=`${n.q},${n.r}`; if(!(k in costSoFar)||nc<costSoFar[k]){ costSoFar[k]=nc; frontier.push(n); cameFrom[k]=cur; } }
            });
        }
        let p=[], c={q:tq,r:tr}; if(!cameFrom[`${tq},${tr}`]) return [];
        while(c){ if(c.q===u.q&&c.r===u.r) break; p.push(c); c=cameFrom[`${c.q},${c.r}`]; } return p.reverse();
    }
    log(m){ const c=document.getElementById('log-container'); const d=document.createElement('div'); d.className='log-entry'; d.innerText=`> ${m}`; c.appendChild(d); c.scrollTop=c.scrollHeight; }
    showContext(mx,my) {
        const p=Renderer.pxToHex(mx,my), m=document.getElementById('context-menu'), u=this.getUnit(p.q,p.r), t=this.isValidHex(p.q,p.r)?this.map[p.q][p.r]:null;
        if(u) m.innerHTML=`<div style="color:#0af;font-weight:bold">${u.def.name}</div>HP: ${u.hp}/${u.maxHp}<br>AP: ${u.ap}<br>Wpn: ${WPNS[u.curWpn].name}`;
        else if(t && t.id!==-1) m.innerHTML=`<div style="color:#0af;font-weight:bold">${t.name}</div>コスト: ${t.cost}<br>防御: ${t.cover}%`;
        else return;
        m.style.display='block'; m.style.left=mx+'px'; m.style.top=my+'px';
    }
    getStatus(u) { if(u.hp<=0)return "DEAD"; const r=u.hp/u.maxHp; if(r>0.8)return "NORMAL"; if(r>0.5)return u.def.isTank?"TRACK DMG":"LIGHT W."; if(r>0.2)return u.def.isTank?"GUN DMG":"HEAVY W."; return "CRITICAL"; }
    updateSidebar() {
        const ui=document.getElementById('unit-info'), u=this.selectedUnit;
        if(u) {
            const wpn = WPNS[u.curWpn], st=this.getStatus(u), rank=RANKS[u.rank||0];
            const skillCounts = u.skills.reduce((acc, s) => { acc[s] = (acc[s] || 0) + 1; return acc; }, {});
            const skillBadges = Object.keys(skillCounts).map(s => {
                const count = skillCounts[s];
                const cls = s==="Hero" ? "skill-badge hero-badge" : "skill-badge";
                return `<span class="${cls}">${SKILLS[s].name}${count > 1 ? ' x'+count : ''}</span>`;
            }).join('');
            
            const btnState = (this.state !== 'PLAY') ? 'disabled' : '';

            ui.innerHTML=`<h2 style="color:#d84; margin:0 0 5px 0;">${u.def.name}</h2>
                <div style="font-size:10px;color:#888;margin-bottom:5px;">RANK: <span style="color:#fd0">${rank}</span> | STATUS: <span style="color:${u.hp/u.maxHp<0.3?'#f55':'#5f5'}">${st}</span></div>
                <div class="skill-list">${skillBadges}</div>
                HP: ${u.hp}/${u.maxHp} AP: ${u.ap}/${u.maxAp}<br>
                <div id="btn-weapon" onclick="game.swapWeapon()"><div><small>Main:</small> ${wpn.name}</div><div class="ap-cost">SWAP(1)</div></div>
                <div>射程: ${wpn.rng} / 威力: ${wpn.dmg}</div>
                <div style="margin-top:15px;"><button class="btn-stance ${u.stance==='stand'?'active-stance':''}" onclick="game.setStance('stand')">立</button>
                <button class="btn-stance ${u.stance==='crouch'?'active-stance':''}" onclick="game.setStance('crouch')">屈</button>
                <button class="btn-stance ${u.stance==='prone'?'active-stance':''}" onclick="game.setStance('prone')">伏</button></div>
                <button onclick="game.endTurn()" class="${btnState}" style="background:#522; border-color:#d44; margin-top:20px;">TURN END</button>`;
            if(u.def.isTank) document.querySelectorAll('.btn-stance').forEach(b=>b.classList.add('disabled'));
        } else ui.innerHTML=`<div style="text-align:center; color:#555; margin-top:80px;">// NO SIGNAL //</div>`;
    }
    draw() {
        const ctx=Renderer.ctx; 
        if(Renderer.shake > 0) { ctx.save(); ctx.translate((Math.random()-0.5)*Renderer.shake, (Math.random()-0.5)*Renderer.shake); }
        ctx.fillStyle="#0b0e0a"; ctx.fillRect(0,0,Renderer.canvas.width,Renderer.canvas.height);
        
        if(this.map.length>0) {
            let neighborCounts = new Map();
            const players = this.units.filter(u => u.team === 'player' && u.hp > 0);
            players.forEach(u => {
                let count = this.getNeighbors(u.q, u.r).filter(n => this.getUnit(n.q, n.r)?.team === 'player').length;
                if (count > 0) neighborCounts.set(`${u.q},${u.r}`, count);
            });

            for(let q=0; q<MAP_W; q++) for(let r=0; r<MAP_H; r++) { 
                if(this.map[q][r].id!==-1) {
                    const count = neighborCounts.get(`${q},${r}`) || 0;
                    Renderer.drawHex(q, r, this.map[q][r], count); 
                    VFX.debris.filter(d=>d.q===q&&d.r===r).forEach(d=>Renderer.drawStaticDebris(d.q,d.r,d.type));
                }
            }
        }
        
        if(this.selectedUnit && this.state==='PLAY') Renderer.drawRange(this.selectedUnit);
        
        if(this.path.length>0) { ctx.strokeStyle="rgba(255,255,255,0.4)"; ctx.lineWidth=2; ctx.setLineDash([5,5]); ctx.beginPath(); 
            const s=Renderer.hexToPx(this.selectedUnit.q,this.selectedUnit.r); ctx.moveTo(s.x,s.y); this.path.forEach(p=>{const px=Renderer.hexToPx(p.q,p.r); ctx.lineTo(px.x,px.y);}); ctx.stroke(); ctx.setLineDash([]); }
        
        this.units.sort((a,b)=>a.r-b.r); this.units.forEach(u=>{ if(u.hp>0) Renderer.drawUnit(u, u===this.selectedUnit); });
        
        VFX.draw(ctx); if(Renderer.shake > 0) ctx.restore();
        if(this.selectedUnit && this.hoverHex) { const t=this.getUnit(this.hoverHex.q,this.hoverHex.r); if(t && t.team==='enemy') { 
            const s=Renderer.hexToPx(this.selectedUnit.q,this.selectedUnit.r), e=Renderer.hexToPx(t.q,t.r);
            ctx.strokeStyle="rgba(255,50,50,0.5)"; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(s.x,s.y); ctx.lineTo(e.x,e.y); ctx.stroke(); } }
    }
}

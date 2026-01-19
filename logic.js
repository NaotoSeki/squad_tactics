/** LOGIC (Organic Map Gen & Separate Files Ready) */
class Game {
    constructor() {
        this.units=[]; this.map=[]; this.setupSlots=[]; this.state='SETUP'; 
        this.path=[]; this.reachableHexes=[]; 
        this.hoverHex=null;
        this.isAuto=false; this.isProcessingTurn = false; 
        this.sector = 1;
        
        this.initDOM(); 
        this.initSetup();
    }

    initDOM() {
        Renderer.init(document.getElementById('game-view'));
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
        document.getElementById('setup-screen').style.display='none'; 
        Renderer.resize();
        this.generateMap(); // ★新しいマップ生成
        
        // 味方配置 (陸地がある場所を探す)
        if(this.units.length === 0) { 
            this.setupSlots.forEach(k=>this.spawnAtSafeGround('player',k)); 
        } else { 
            this.units.filter(u=>u.team==='player').forEach(u=>{ 
                u.q=null; this.spawnAtSafeGround('player',null,u); 
            }); 
        }
        
        this.spawnEnemies();
        this.state='PLAY'; 
        this.log(`MISSION START - SECTOR ${this.sector}`);
        document.getElementById('sector-counter').innerText = `SECTOR: ${this.sector.toString().padStart(2, '0')}`;
        
        if(this.units.length>0) Renderer.centerOn(this.units[0].q, this.units[0].r);

        setTimeout(() => {
            if (Renderer.dealCards) {
                Renderer.dealCards(['infantry', 'tank', 'aerial', 'infantry', 'tiger']);
            }
        }, 500);
    }

    // 航空爆撃処理
    applyBombardment(targetHex) {
        this.log(`[支援] 爆撃着弾地点: ${targetHex.q},${targetHex.r}`);
        const u = this.getUnit(targetHex.q, targetHex.r);
        if (u) {
            if (Math.random() < 0.75) {
                const dmg = 500; u.hp -= dmg;
                this.log(`>> 直撃！ ${u.def.name} に ${dmg} ダメージ`);
                if (u.hp <= 0) {
                    u.hp = 0;
                    if (!u.deadProcessed) {
                        u.deadProcessed = true;
                        this.log(`*** ${u.def.name} は消滅した ***`);
                        if(window.Sfx) window.Sfx.play('death');
                        if (window.VFX) {
                            const p = Renderer.hexToPx(u.q, u.r);
                            VFX.addUnitDebris(p.x, p.y);
                        }
                    }
                }
                this.updateSidebar();
            } else { this.log(">> 爆撃は外れた！(MISS)"); }
        } else { this.log(">> 目標地点にユニットなし"); }
        if(this.checkWin()) return;
        this.checkLose();
    }

    deployUnit(targetHex, cardType) {
        // VOID(虚空)には置けない
        if(!this.isValidHex(targetHex.q, targetHex.r) || this.map[targetHex.q][targetHex.r].id === -1) {
            this.log("配置不可: 進入不可能な地形です"); return;
        }
        const existing = this.units.find(u => u.q === targetHex.q && u.r === targetHex.r && u.hp > 0);
        if (existing) { this.log("配置不可: ユニットが既に存在します"); return; }
        
        this.spawnUnit('player', cardType, targetHex.q, targetHex.r);
        this.log(`増援到着: ${UNITS[cardType].name}`);
        if(window.VFX) { 
            const pos = Renderer.hexToPx(targetHex.q, targetHex.r); 
            window.VFX.addSmoke(pos.x, pos.y); 
        }
        this.updateSidebar();
    }

    calcReachableHexes(u) {
        this.reachableHexes = [];
        if(!u) return;
        let frontier = [{q:u.q, r:u.r, cost:0}];
        let costSoFar = new Map();
        costSoFar.set(`${u.q},${u.r}`, 0);
        while(frontier.length > 0) {
            let current = frontier.shift();
            this.getNeighbors(current.q, current.r).forEach(n => {
                if(this.getUnit(n.q, n.r) || this.map[n.q][n.r].cost >= 99) return;
                let newCost = current.cost + this.map[n.q][n.r].cost;
                if(newCost <= u.ap) {
                    let key = `${n.q},${n.r}`;
                    if(!costSoFar.has(key) || newCost < costSoFar.get(key)) {
                        costSoFar.set(key, newCost);
                        frontier.push({q:n.q, r:n.r, cost:newCost});
                        this.reachableHexes.push({q:n.q, r:n.r});
                    }
                }
            });
        }
    }

    handleHover(p) {
        if(this.state !== 'PLAY') return;
        this.hoverHex = p;
        if(this.selectedUnit && this.isValidHex(p.q, p.r)) {
            const isReachable = this.reachableHexes.some(h => h.q === p.q && h.r === p.r);
            const enemy = this.getUnit(p.q, p.r);
            if(isReachable && !enemy) this.path = this.findPath(this.selectedUnit, p.q, p.r);
            else this.path = [];
        }
    }

    handleClick(p) {
        const isValid = this.isValidHex(p.q, p.r) && this.map[p.q][p.r].id !== -1; // VOID除外
        const u = isValid ? this.getUnit(p.q, p.r) : null;
        if(u && u.team==='player') { 
            this.selectedUnit=u; this.calcReachableHexes(u); this.path = []; if(window.Sfx)Sfx.play('click'); this.updateSidebar(); 
        } else if(this.selectedUnit) {
            if(u && u.team==='enemy') this.actionAttack(this.selectedUnit, u);
            else if(!u && isValid && this.path.length > 0) this.actionMove(this.selectedUnit, this.path);
            else { this.selectedUnit = null; this.reachableHexes = []; this.path = []; this.updateSidebar(); }
        }
    }

    // ★新マップ生成ロジック: 不定形な広がり（ゴルフ場・アメーバ型）
    generateMap() { 
        this.map = [];
        // 1. 全てVOID(虚空)で初期化
        for(let q=0; q<MAP_W; q++){ 
            this.map[q] = []; 
            for(let r=0; r<MAP_H; r++){ 
                this.map[q][r] = TERRAIN.VOID; 
            }
        }

        // 2. ランダムウォーカーによる整地
        const cx = Math.floor(MAP_W/2);
        const cy = Math.floor(MAP_H/2);
        let walkers = [{q:cx, r:cy}]; // スタート地点
        const maxSteps = 300; // 土地の広さ
        
        for(let i=0; i<maxSteps; i++) {
            // ランダムにウォーカーを選ぶ
            const wIdx = Math.floor(Math.random() * walkers.length);
            const w = walkers[wIdx];
            
            // 現在地を仮のGRASSにする（はみ出しチェック）
            if(this.isValidHex(w.q, w.r)) {
                this.map[w.q][w.r] = TERRAIN.GRASS;
            }

            // 次の移動先をランダムに決定
            const neighbors = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
            const dir = neighbors[Math.floor(Math.random() * 6)];
            const next = { q: w.q + dir[0], r: w.r + dir[1] };
            
            // 確率で分裂（枝分かれ）
            if(Math.random() < 0.05 && walkers.length < 6) {
                walkers.push(next);
            } else {
                walkers[wIdx] = next;
            }
        }

        // 3. 陸地になった部分に地形ノイズを適用（森や荒地）
        for(let q=0; q<MAP_W; q++){ 
            for(let r=0; r<MAP_H; r++){
                if(this.map[q][r].id !== -1) { // VOIDでなければ
                    const n = Math.sin(q*0.5) + Math.cos(r*0.5) + Math.random()*0.3; 
                    let t = TERRAIN.GRASS; 
                    if(n > 1.2) t = TERRAIN.FOREST;
                    else if(n < -0.8) t = TERRAIN.DIRT; 
                    
                    if(t !== TERRAIN.WATER && Math.random() < 0.06) t = TERRAIN.TOWN; 
                    
                    this.map[q][r] = t;
                }
            }
        }

        // 4. 川を作る (陸地の中だけを流れるように)
        let rq=cx, rr=cy; 
        for(let i=0;i<20;i++){ 
            if(this.isValidHex(rq,rr) && this.map[rq][rr].id !== -1){ 
                this.map[rq][rr] = TERRAIN.WATER; 
                const d=[[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]][Math.floor(Math.random()*6)]; 
                rq+=d[0]; rr+=d[1]; 
            } else break; 
        }
    }

    spawnEnemies(){ const c=4+Math.floor(this.sector*0.7), tc=Math.min(0.8,0.1+this.sector*0.1); for(let i=0;i<c;i++){ let k='infantry'; const r=Math.random(); if(r<tc)k='tank';else if(r<tc+0.3)k='heavy';else if(r<tc+0.5)k='sniper'; const e=this.spawnAtSafeGround('enemy',k); if(e){e.rank=Math.floor(Math.random()*Math.min(5,this.sector/2)); e.maxHp+=e.rank*30; e.hp=e.maxHp; if(this.sector>2&&Math.random()<0.4)e.skills=[Object.keys(SKILLS)[Math.floor(Math.random()*8)]];}}}
    // 安全地帯検索（VOID以外を探すように修正）
    spawnAtSafeGround(t,k,ex=null){ 
        let q,r,tr=0; const cy=Math.floor(MAP_H/2); 
        do{ 
            q=Math.floor(Math.random()*MAP_W); r=Math.floor(Math.random()*MAP_H); tr++; 
            if(t==='player'&&r<cy)continue; if(t==='enemy'&&r>cy)continue; 
        } while(
            (!this.isValidHex(q,r) || this.map[q][r].id===-1 || this.map[q][r].id===5 || this.map[q][r].cost>=99 || this.getUnit(q,r)) 
            && tr<1000
        ); 
        if(tr<1000){if(ex){ex.q=q;ex.r=r;return ex;}else return this.spawnUnit(t,k,q,r);} return null;
    }
    spawnUnit(t,k,q,r){ const d=UNITS[k], a=d.ap; this.units.push({id:Math.random(),team:t,q,r,def:d,hp:d.hp,maxHp:d.hp,ap:a,maxAp:a,stance:'stand',curWpn:d.wpn,rank:0,deadProcessed:false,skills:[],sectorsSurvived:0}); }
    toggleAuto(){ this.isAuto=!this.isAuto; document.getElementById('auto-toggle').classList.toggle('active'); this.log(`AUTO: ${this.isAuto?"ON":"OFF"}`); this.selectedUnit=null; this.path=[]; if(this.isAuto)this.runAuto(); }
    runAuto(){ if(this.state!=='PLAY'||this.autoTimer>0){if(this.autoTimer>0)this.autoTimer--;return;} const ac=this.units.filter(u=>u.team==='player'&&u.hp>0&&u.ap>0); if(ac.length===0){this.endTurn();return;} const u=ac[0], en=this.units.filter(e=>e.team==='enemy'&&e.hp>0); if(en.length===0)return; let tg=en[0], sc=-9999; en.forEach(e=>{const d=this.hexDist(u,e), v=(100-e.hp)*2-(d*10); if(v>sc){sc=v;tg=e;}}); const w=WPNS[u.curWpn], d=this.hexDist(u,tg); if(d<=w.rng&&u.ap>=2){this.actionAttack(u,tg);this.autoTimer=80;}else{const p=this.findPath(u,tg.q,tg.r); if(p.length>0&&this.map[p[0].q][p[0].r].cost<=u.ap){u.q=p[0].q;u.r=p[0].r;u.ap-=this.map[u.q][u.r].cost;if(window.Sfx)Sfx.play('move');this.autoTimer=20;this.checkReactionFire(u);}else u.ap=0;} }
    async actionMove(u,p){ this.state='ANIM'; this.selectedUnit=null; this.path=[]; this.reachableHexes=[]; for(let s of p){ u.ap-=this.map[s.q][s.r].cost; u.q=s.q; u.r=s.r; if(window.Sfx)Sfx.play('move'); await new Promise(r=>setTimeout(r,180)); } this.checkReactionFire(u); this.state='PLAY'; if(u.ap>0){this.selectedUnit=u; this.calcReachableHexes(u);} this.updateSidebar(); this.checkPhaseEnd(); }
    checkReactionFire(u){ this.units.filter(e=>e.team!==u.team&&e.hp>0&&e.def.isTank&&this.hexDist(u,e)<=2).forEach(t=>{ this.log(`!! 防御射撃: ${t.def.name}->${u.def.name}`); u.hp-=15; if(window.VFX)VFX.addExplosion(Renderer.hexToPx(u.q,u.r).x,Renderer.hexToPx(u.q,u.r).y,"#fa0",5); if(window.Sfx)Sfx.play('mg'); if(u.hp<=0&&!u.deadProcessed){u.deadProcessed=true;this.log(`${u.def.name} 撃破`);if(window.Sfx)Sfx.play('death');} }); }
    swapWeapon(){ if(this.selectedUnit&&this.selectedUnit.ap>=1){ const u=this.selectedUnit; u.ap--; u.curWpn=(u.curWpn===u.def.wpn)?u.def.alt:u.def.wpn; if(window.Sfx)Sfx.play('swap'); this.log(`武装変更: ${WPNS[u.curWpn].name}`); this.updateSidebar(); } }
    async actionAttack(a,d){ if(a.ap<2){this.log("AP不足");return;} const w=WPNS[a.curWpn]; if(this.hexDist(a,d)>w.rng){this.log("射程外");return;} a.ap-=2; this.state='ANIM'; 
        const gsc=(u,k)=>u.skills.filter(s=>s===k).length; let b=this.getNeighbors(a.q,a.r).filter(n=>this.getUnit(n.q,n.r)?.team===a.team).length*10; if(a.skills.includes("Radio"))b+=15*gsc(a,"Radio");
        let ac=(a.rank||0)*8+gsc(a,"Precision")*15, dm=1.0+gsc(a,"HighPower")*0.2; this.log(`${a.def.name} 攻撃`);
        let bu=w.burst||1; bu+=gsc(a,"AmmoBox")*(w.name==='MG42'?3:1); const pt=w.type, isR=pt==='rocket', isS=pt.includes('shell');
        for(let i=0;i<bu;i++){ if(d.hp<=0&&!isR)break; if(window.Sfx)Sfx.play(isR?'rocket':(isS?'cannon':(bu>1?'mg':'shot')));
            const s=Renderer.hexToPx(a.q,a.r), e=Renderer.hexToPx(d.q,d.r), ex=e.x+(Math.random()-0.5)*10, ey=e.y+(Math.random()-0.5)*10;
            const pr={x:s.x,y:s.y,sx:s.x,sy:s.y,ex:ex,ey:ey,type:pt,progress:0,speed:isR?0.02:(pt==='shell_fast'?0.1:0.05),arcHeight:isR?250:(isS?(pt==='shell_fast'?40:120):0),onHit:()=>{
                if(isR){ if(window.VFX)VFX.addExplosion(ex,ey,"#fa0",50); if(window.Sfx)Sfx.play('boom'); [{q:d.q,r:d.r},...this.getNeighbors(d.q,d.r)].forEach(l=>{const v=this.getUnit(l.q,l.r);if(v){const dg=w.dmg*dm;v.hp-=dg;this.log(`>>爆風:${v.def.name}(-${Math.floor(dg)})`);if(v.hp<=0&&!v.deadProcessed){v.deadProcessed=true;this.log(`${v.def.name} 爆散`);if(window.VFX)VFX.addUnitDebris(Renderer.hexToPx(v.q,v.r).x,Renderer.hexToPx(v.q,v.r).y);}}}); }
                else{ if(d.hp<=0)return; let h=w.acc-this.map[d.q][d.r].cover+ac; if(d.stance==='prone')h-=25; if(d.skills?.includes("Ambush"))h-=gsc(d,"Ambush")*15;
                    if(Math.random()*100<h){ let dg=Math.floor(w.dmg*(1+b/100)*(0.8+Math.random()*0.4)*dm); if(d.stance==='prone')dg=Math.floor(dg*0.6); const al=gsc(d,"Armor"); if(al>0){const rd=al*10; dg=Math.max(1,dg-rd); if(i===0)this.log(`>>装甲防御(-${rd})`);} d.hp-=dg; if(window.VFX)VFX.addExplosion(ex,ey,"#f55",5); if(window.Sfx)Sfx.play(isS?'boom':'shot'); }
                    else{ if(window.Sfx)Sfx.play('ricochet'); if(window.VFX)VFX.add({x:ex,y:ey,vx:(Math.random()-0.5)*5,vy:-5,life:5,maxLife:5,color:"#fff",size:2,type:'spark'}); }
                }
            }}; if(!isS&&!isR){const dx=ex-s.x,dy=ey-s.y,ag=Math.atan2(dy,dx); pr.vx=Math.cos(ag)*25; pr.vy=Math.sin(ag)*25; pr.life=Math.sqrt(dx*dx+dy*dy)/25;} if(window.VFX)VFX.addProj(pr); await new Promise(r=>setTimeout(r,isR?800:(isS?200:40)));
        }
        setTimeout(()=>{const dd=this.units.filter(u=>u.hp<=0); dd.forEach(k=>{if(!k.deadProcessed){k.deadProcessed=true; if(k===d){this.log(`${k.def.name} 撃破`);if(window.Sfx)Sfx.play('death');} if(window.VFX)VFX.addUnitDebris(Renderer.hexToPx(k.q,k.r).x,Renderer.hexToPx(k.q,k.r).y);}}); if(this.checkWin())return; this.checkLose(); this.state='PLAY'; this.updateSidebar(); this.checkPhaseEnd();}, isR?1200:500);
    }
    checkPhaseEnd(){if(this.units.filter(u=>u.team==='player'&&u.hp>0&&u.ap>0).length===0&&this.state==='PLAY')this.endTurn();}
    setStance(s){if(this.selectedUnit&&this.selectedUnit.ap>=1&&!this.selectedUnit.def.isTank){this.selectedUnit.ap--;this.selectedUnit.stance=s;this.updateSidebar();this.checkPhaseEnd();}}
    endTurn(){if(this.isProcessingTurn)return; this.isProcessingTurn=true; this.selectedUnit=null; this.reachableHexes=[]; this.path=[]; this.state='ANIM'; document.getElementById('eyecatch').style.opacity=1;
        this.units.filter(u=>u.team==='player'&&u.hp>0&&u.skills.includes("Mechanic")).forEach(u=>{const c=u.skills.filter(s=>s==="Mechanic").length; if(u.hp<u.maxHp){u.hp=Math.min(u.maxHp,u.hp+c*20);this.log(`${u.def.name} 修理`);}});
        setTimeout(async()=>{document.getElementById('eyecatch').style.opacity=0; const es=this.units.filter(u=>u.team==='enemy'&&u.hp>0); for(let e of es){const ps=this.units.filter(u=>u.team==='player'&&u.hp>0); if(ps.length===0){this.checkLose();break;} e.ap=e.maxAp; let t=ps[0],md=999; ps.forEach(p=>{const d=this.hexDist(e,p);if(d<md){md=d;t=p;}}); if(md<=6){if(md<=4&&e.ap>=1&&!e.def.isTank)e.stance='crouch';await this.actionAttack(e,t);}else{const nq=e.q+(t.q>e.q?1:-1);if(!this.getUnit(nq,e.r)&&this.isValidHex(nq,e.r)&&this.map[nq][e.r].cost<99){e.q=nq;e.ap--;await new Promise(r=>setTimeout(r,200));}}} this.units.forEach(u=>{if(u.team==='player')u.ap=u.maxAp;}); this.log("-- PLAYER PHASE --"); this.state='PLAY'; this.isProcessingTurn=false;},1200);
    }
    healSurvivors(){this.units.filter(u=>u.team==='player'&&u.hp>0).forEach(u=>{const t=Math.floor(u.maxHp*0.8);if(u.hp<t)u.hp=t;});this.log("治療完了");}
    promoteSurvivors(){this.units.filter(u=>u.team==='player'&&u.hp>0).forEach(u=>{u.sectorsSurvived++; if(u.sectorsSurvived===5){u.skills.push("Hero");u.maxAp++;this.log("英雄昇格");} u.rank=Math.min(5,(u.rank||0)+1); u.maxHp+=30; u.hp+=30; if(u.skills.length<8&&Math.random()<0.7){const k=Object.keys(SKILLS).filter(z=>z!=="Hero"); u.skills.push(k[Math.floor(Math.random()*k.length)]); this.log("スキル習得");} });}
    checkWin(){if(this.units.filter(u=>u.team==='enemy'&&u.hp>0).length===0){if(window.Sfx)Sfx.play('win'); document.getElementById('reward-screen').style.display='flex'; this.promoteSurvivors(); const b=document.getElementById('reward-cards'); b.innerHTML=''; [{k:'infantry',t:'新兵'},{k:'tank',t:'戦車'},{k:'heal',t:'医療'}].forEach(o=>{const d=document.createElement('div');d.className='card';d.innerHTML=`<div class="card-img-box"><img src="${createCardIcon(o.k)}"></div><div class="card-body"><h3>${o.t}</h3><p>補給</p></div>`;d.onclick=()=>{if(o.k==='heal')this.healSurvivors();else this.spawnAtSafeGround('player',o.k);this.sector++;document.getElementById('reward-screen').style.display='none';this.startCampaign();};b.appendChild(d);}); return true;} return false;}
    checkLose(){if(this.units.filter(u=>u.team==='player'&&u.hp>0).length===0)document.getElementById('gameover-screen').style.display='flex';}
    getUnit(q,r){return this.units.find(u=>u.q===q&&u.r===r&&u.hp>0);}
    isValidHex(q,r){return q>=0&&q<MAP_W&&r>=0&&r<MAP_H;}
    hexDist(a,b){return (Math.abs(a.q-b.q)+Math.abs(a.q+a.r-b.q-b.r)+Math.abs(a.r-b.r))/2;}
    getNeighbors(q,r){return [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]].map(d=>({q:q+d[0],r:r+d[1]})).filter(h=>this.isValidHex(h.q,h.r));}
    findPath(u,tq,tr){let f=[{q:u.q,r:u.r}],cf={},cs={}; cf[`${u.q},${u.r}`]=null; cs[`${u.q},${u.r}`]=0; while(f.length>0){let c=f.shift();if(c.q===tq&&c.r===tr)break; this.getNeighbors(c.q,c.r).forEach(n=>{if(this.getUnit(n.q,n.r)&&(n.q!==tq||n.r!==tr))return; const cost=this.map[n.q][n.r].cost; if(cost>=99)return; const nc=cs[`${c.q},${c.r}`]+cost; if(nc<=u.ap){const k=`${n.q},${n.r}`;if(!(k in cs)||nc<cs[k]){cs[k]=nc;f.push(n);cf[k]=c;}}});} let p=[],c={q:tq,r:tr}; if(!cf[`${tq},${tr}`])return[]; while(c){if(c.q===u.q&&c.r===u.r)break;p.push(c);c=cf[`${c.q},${c.r}`];} return p.reverse();}
    log(m){const c=document.getElementById('log-container'),d=document.createElement('div');d.className='log-entry';d.innerText=`> ${m}`;c.appendChild(d);c.scrollTop=c.scrollHeight;}
    showContext(mx,my){const p=Renderer.pxToHex(mx,my),m=document.getElementById('context-menu'),u=this.getUnit(p.q,p.r),t=this.isValidHex(p.q,p.r)?this.map[p.q][p.r]:null; let h=""; if(u)h+=`<div style="color:#0af;font-weight:bold">${u.def.name}</div>HP:${u.hp}<br>AP:${u.ap}`;else if(t)h+=`${t.name}<br>C:${t.cost} D:${t.cover}%`; m.style.pointerEvents='auto'; h+=`<button onclick="gameLogic.endTurn();document.getElementById('context-menu').style.display='none';" style="margin-top:10px;border-color:#d44;background:#311;">TURN END</button>`; m.innerHTML=h; m.style.display='block'; m.style.left=(mx+5)+'px'; m.style.top=(my+5)+'px';}
    getStatus(u){if(u.hp<=0)return "DEAD";const r=u.hp/u.maxHp;if(r>0.8)return "NORMAL";if(r>0.5)return "DAMAGED";return "CRITICAL";}
    updateSidebar(){const ui=document.getElementById('unit-info'),u=this.selectedUnit;if(u){const w=WPNS[u.curWpn],s=this.getStatus(u); ui.innerHTML=`<h2 style="color:#d84;margin:0 0 5px 0;">${u.def.name}</h2><div style="font-size:10px;color:#888;">STATUS:<span style="color:${u.hp/u.maxHp<0.3?'#f55':'#5f5'}">${s}</span></div>HP:${u.hp}/${u.maxHp} AP:${u.ap}/${u.maxAp}<br><div id="btn-weapon" onclick="gameLogic.swapWeapon()"><div><small>Main:</small> ${w.name}</div><div class="ap-cost">SWAP(1)</div></div><div>Rng:${w.rng} Dmg:${w.dmg}</div><div style="margin-top:15px;"><button class="btn-stance ${u.stance==='stand'?'active-stance':''}" onclick="gameLogic.setStance('stand')">立</button><button class="btn-stance ${u.stance==='crouch'?'active-stance':''}" onclick="gameLogic.setStance('crouch')">屈</button><button class="btn-stance ${u.stance==='prone'?'active-stance':''}" onclick="gameLogic.setStance('prone')">伏</button></div><button onclick="gameLogic.endTurn()" class="${this.state!=='PLAY'?'disabled':''}" style="background:#522;border-color:#d44;margin-top:20px;">TURN END</button>`; if(u.def.isTank)document.querySelectorAll('.btn-stance').forEach(b=>b.classList.add('disabled'));}else ui.innerHTML=`<div style="text-align:center;color:#555;margin-top:80px;">// NO SIGNAL //</div>`;}
}
window.gameLogic = new Game();

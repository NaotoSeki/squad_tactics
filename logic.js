/** LOGIC: JIT Auto-Reload & Instant Win Check */

function createCardIcon(type) {
    const c = document.createElement('canvas'); c.width = 1; c.height = 1; return c.toDataURL();
}

class Game {
    constructor() {
        this.units = [];
        this.map = [];
        this.setupSlots = [];
        this.state = 'SETUP';
        this.path = [];
        this.reachableHexes = [];
        this.attackLine = [];
        this.aimTargetUnit = null;
        this.hoverHex = null;
        this.isAuto = false;
        this.isProcessingTurn = false;
        this.sector = 1;
        this.enemyAI = 'AGGRESSIVE';
        this.cardsUsed = 0;
        this.interactionMode = 'SELECT';
        this.selectedUnit = null;
        this.menuSafeLock = false;
        this.tankAutoReload = true; 
        this.initDOM();
        this.initSetup();
    }

    initDOM() {
        Renderer.init(document.getElementById('game-view'));
        window.addEventListener('click', (e) => {
            if (this.menuSafeLock) return;
            if (!e.target.closest('#context-menu')) document.getElementById('context-menu').style.display = 'none';
            if (!e.target.closest('#command-menu') && !e.target.closest('canvas')) { this.hideActionMenu(); }
        });
        const resizer = document.getElementById('resizer'); const sidebar = document.getElementById('sidebar');
        let isResizing = false;
        if (resizer) {
            resizer.addEventListener('mousedown', (e) => { isResizing = true; document.body.style.cursor = 'col-resize'; resizer.classList.add('active'); });
            window.addEventListener('mousemove', (e) => {
                if (!isResizing) return;
                const newWidth = document.body.clientWidth - e.clientX;
                if (newWidth > 200 && newWidth < 800) { sidebar.style.width = newWidth + 'px'; if (sidebar.classList.contains('collapsed')) this.toggleSidebar(); Renderer.resize(); }
            });
            window.addEventListener('mouseup', () => { if (isResizing) { isResizing = false; document.body.style.cursor = ''; resizer.classList.remove('active'); Renderer.resize(); } });
        }
    }

    toggleSidebar() {
        const sb = document.getElementById('sidebar'); const tg = document.getElementById('sidebar-toggle');
        sb.classList.toggle('collapsed');
        if (sb.classList.contains('collapsed')) { sb.style.width = ''; tg.innerText = '◀'; } else { tg.innerText = '▶'; }
        setTimeout(() => Renderer.resize(), 350); 
    }

    toggleTankAutoReload() {
        this.tankAutoReload = !this.tankAutoReload;
        this.updateSidebar();
    }

    initSetup() {
        const box = document.getElementById('setup-cards'); box.innerHTML = ''; this.setupSlots = [];
        ['rifleman', 'scout', 'gunner', 'sniper'].forEach(k => {
            const t = UNIT_TEMPLATES[k]; const d = document.createElement('div'); d.className = 'card';
            let specs = `<div style="text-align:left; font-size:10px; line-height:1.4; color:#aaa; margin-top:5px;">HP:<span style="color:#fff">${t.hp||100}</span> AP:<span style="color:#fff">${t.ap||4}</span><br>`;
            const mainWpn = WPNS[t.main]; if (mainWpn) { specs += `<span style="color:#d84">${mainWpn.name}</span>`; } specs += `</div>`;
            const faceSeed = Math.floor(Math.random() * 99999); const faceUrl = Renderer.generateFaceIcon ? Renderer.generateFaceIcon(faceSeed) : "";
            d.innerHTML = `<div class="card-badge" style="display:none;">✔</div><div class="card-img-box" style="background:#111;"><img src="${faceUrl}" style="width:64px; height:64px; object-fit:cover;"></div><div class="card-body"><h3 style="color:#d84; font-size:14px; margin:5px 0;">${t.name}</h3><p style="font-size:10px; color:#888;">${t.role.toUpperCase()}</p>${specs}</div>`;
            d.onclick = () => {
                const idx = this.setupSlots.indexOf(k);
                if (idx >= 0) { this.setupSlots.splice(idx, 1); d.classList.remove('selected'); d.querySelector('.card-badge').style.display = 'none'; d.style.borderColor = "#555"; } 
                else { if (this.setupSlots.length < 3) { this.setupSlots.push(k); d.classList.add('selected'); d.querySelector('.card-badge').style.display = 'flex'; d.style.borderColor = "#d84"; } }
                const btn = document.getElementById('btn-start'); if (this.setupSlots.length === 3) { btn.style.display = 'inline-block'; } else { btn.style.display = 'none'; }
            };
            box.appendChild(d);
        });
    }

    createSoldier(templateKey, team, q, r) {
        const t = UNIT_TEMPLATES[templateKey]; if (!t) return null;
        const isPlayer = (team === 'player'); const stats = { ...t.stats };
        if (isPlayer && !t.isTank) { ['str', 'aim', 'mob', 'mor'].forEach(k => stats[k] = (stats[k] || 0) + Math.floor(Math.random() * 3) - 1); }
        let name = t.name; let rank = 0; let faceSeed = Math.floor(Math.random() * 99999);
        if (isPlayer && !t.isTank) { const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]; const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]; name = `${last} ${first}`; }
        
        const createItem = (key, isMainWpn = false) => {
            if (!key || !WPNS[key]) return null; let base = WPNS[key]; let item = { ...base, code: key, id: Math.random(), isBroken: false };
            if (base.type === 'bullet' || base.type === 'shell_fast') {
                if (isMainWpn && typeof MAG_VARIANTS !== 'undefined' && MAG_VARIANTS[key]) { const vars = MAG_VARIANTS[key]; const choice = vars[Math.floor(Math.random() * vars.length)]; item.cap = choice.cap; item.jam = choice.jam; item.magName = choice.name; }
                item.current = item.cap;
            } else if (base.type === 'shell' || base.area) { item.current = 1; item.isConsumable = true; }
            
            if (t.isTank && isMainWpn) {
                item.current = 1; 
                item.cap = 1;     
                item.reserve = 12; 
            }
            
            return item;
        };
        
        let hands = null; let bag = [];
        if (t.main) hands = createItem(t.main, true); if (t.sub) bag.push(createItem(t.sub));
        if (t.opt) { const optBase = WPNS[t.opt]; const count = optBase.mag || 1; for (let i = 0; i < count; i++) bag.push(createItem(t.opt)); }
        
        if (hands && hands.mag && !hands.isConsumable && !t.isTank) { 
            for (let i = 0; i < hands.mag; i++) { 
                if (bag.length >= 4) break; 
                bag.push({ type: 'ammo', name: (hands.magName || 'Clip'), ammoFor: hands.code, cap: hands.cap, jam: hands.jam, code: 'mag' }); 
            } 
        }
        if (!isPlayer) { if (hands) hands.current = 999; bag = []; }
        return { id: Math.random(), team: team, q: q, r: r, def: t, name: name, rank: rank, faceSeed: faceSeed, stats: stats, hp: t.hp || (80 + (stats.str || 0) * 5), maxHp: t.hp || (80 + (stats.str || 0) * 5), ap: t.ap || Math.floor((stats.mob || 0) / 2) + 3, maxAp: t.ap || Math.floor((stats.mob || 0) / 2) + 3, hands: hands, bag: bag, stance: 'stand', skills: [], sectorsSurvived: 0, deadProcessed: false, curWpn: hands ? hands.code : 'unarmed' };
    }

    getUnitsInHex(q, r) { return this.units.filter(u => u.q === q && u.r === r && u.hp > 0); }
    getUnitInHex(q, r) { return this.units.find(u => u.q === q && u.r === r && u.hp > 0); }
    getUnit(q, r) { return this.getUnitInHex(q, r); }

    startCampaign() {
        document.getElementById('setup-screen').style.display = 'none';
        if (typeof Renderer !== 'undefined' && Renderer.game) { const mainScene = Renderer.game.scene.getScene('MainScene'); if (mainScene) { mainScene.mapGenerated = false; if (mainScene.hexGroup && typeof mainScene.hexGroup.removeAll === 'function') mainScene.hexGroup.removeAll(); if (window.EnvSystem) window.EnvSystem.clear(); } }
        Renderer.resize(); this.selectedUnit = null; this.reachableHexes = []; this.attackLine = []; this.aimTargetUnit = null; this.path = []; this.cardsUsed = 0;
        this.units = this.units.filter(u => u.team === 'player' && u.hp > 0); this.units.forEach(u => { u.q = -999; u.r = -999; });
        this.generateMap();
        if (this.units.length === 0) { this.setupSlots.forEach(k => { const p = this.getSafeSpawnPos('player'); const u = this.createSoldier(k, 'player', p.q, p.r); this.units.push(u); }); } else { this.units.forEach(u => { const p = this.getSafeSpawnPos('player'); u.q = p.q; u.r = p.r; }); }
        this.spawnEnemies(); this.state = 'PLAY'; this.log(`SECTOR ${this.sector} START`);
        document.getElementById('sector-counter').innerText = `SECTOR: ${this.sector.toString().padStart(2, '0')}`;
        const leader = this.units.find(u => u.team === 'player'); if (leader && leader.q !== -999) Renderer.centerOn(leader.q, leader.r);
        setTimeout(() => { if (Renderer.dealCards) Renderer.dealCards(['rifleman', 'tank_pz4', 'gunner', 'scout', 'tank_tiger']); }, 500);
    }

    getSafeSpawnPos(team) {
        const cy = Math.floor(MAP_H / 2);
        for (let i = 0; i < 100; i++) { const q = Math.floor(Math.random() * MAP_W); const r = Math.floor(Math.random() * MAP_H); if (team === 'player' && r < cy) continue; if (team === 'enemy' && r >= cy) continue; if (this.isValidHex(q, r) && this.getUnitsInHex(q, r).length < 4 && this.map[q][r].id !== -1 && this.map[q][r].id !== 5) { return { q, r }; } }
        return { q: 0, r: 0 };
    }

    checkDeploy(targetHex) {
        if(!this.isValidHex(targetHex.q, targetHex.r) || this.map[targetHex.q][targetHex.r].id === -1) { this.log("配置不可: 進入不可能な地形です"); return false; }
        if(this.map[targetHex.q][targetHex.r].id === 5) { this.log("配置不可: 水上には配置できません"); return false; }
        if (this.getUnitsInHex(targetHex.q, targetHex.r).length >= 4) { this.log("配置不可: 混雑しています"); return false; }
        if (this.cardsUsed >= 2) { this.log("配置不可: 指揮コスト上限(2/2)に達しています"); return false; }
        return true;
    }
    deployUnit(targetHex, cardType) {
        if(!this.checkDeploy(targetHex)) return;
        const u = this.createSoldier(cardType, 'player', targetHex.q, targetHex.r);
        if(u) { this.units.push(u); this.cardsUsed++; this.log(`増援到着: ${u.name} (残コスト:${2-this.cardsUsed})`); if(window.VFX) { const pos = Renderer.hexToPx(targetHex.q, targetHex.r); window.VFX.addSmoke(pos.x, pos.y); } this.updateSidebar(); }
    }

    onUnitClick(u) {
        if (this.state !== 'PLAY') return;
        if (this.interactionMode === 'MOVE') { this.handleClick({ q: u.q, r: u.r }); return; }
        if (u.team !== 'player') {
            if (this.interactionMode === 'ATTACK' && this.selectedUnit) { this.actionAttack(this.selectedUnit, u); this.setMode('SELECT'); return; }
            if (this.interactionMode === 'MELEE' && this.selectedUnit) { this.actionMelee(this.selectedUnit, u); this.setMode('SELECT'); return; }
            return;
        }
        this.selectedUnit = u; this.refreshUnitState(u); this.showActionMenu(u); if (window.Sfx) Sfx.play('click');
    }

    showActionMenu(u) {
        const menu = document.getElementById('command-menu'); if (!menu) return;
        this.menuSafeLock = true; setTimeout(() => { this.menuSafeLock = false; }, 300);
        const btnMove = document.getElementById('btn-move'); const btnAttack = document.getElementById('btn-attack');
        const btnRepair = document.getElementById('btn-repair'); const btnMelee = document.getElementById('btn-melee'); const btnHeal = document.getElementById('btn-heal');
        if (u.ap <= 0) { btnMove.classList.add('disabled'); btnAttack.classList.add('disabled'); } else { btnMove.classList.remove('disabled'); btnAttack.classList.remove('disabled'); }
        if (u.hands && u.hands.isBroken) btnRepair.classList.remove('disabled'); else btnRepair.classList.add('disabled');
        const neighbors = this.getUnitsInHex(u.q, u.r);
        const hasEnemy = neighbors.some(n => n.team !== u.team);
        if (hasEnemy) btnMelee.classList.remove('disabled'); else btnMelee.classList.add('disabled');
        const hasWounded = neighbors.some(n => n.team === u.team && n.hp < n.maxHp);
        if (hasWounded) btnHeal.classList.remove('disabled'); else btnHeal.classList.add('disabled');
        if (Renderer.game) { const pointer = Renderer.game.input.activePointer; menu.style.left = (pointer.x + 20) + 'px'; menu.style.top = (pointer.y - 50) + 'px'; }
        menu.style.display = 'block';
    }

    hideActionMenu() { const menu = document.getElementById('command-menu'); if (menu) menu.style.display = 'none'; }

    setMode(mode) {
        this.interactionMode = mode; this.hideActionMenu(); const indicator = document.getElementById('mode-label');
        if (mode === 'SELECT') { indicator.style.display = 'none'; this.path = []; this.attackLine = []; } else { indicator.style.display = 'block'; indicator.innerText = mode + " MODE"; if (mode === 'MOVE') { this.calcReachableHexes(this.selectedUnit); } else if (mode === 'ATTACK') { this.reachableHexes = []; } }
    }

    calcReachableHexes(u) {
        this.reachableHexes = []; if (!u) return;
        let frontier = [{ q: u.q, r: u.r, cost: 0 }], costSoFar = new Map(); costSoFar.set(`${u.q},${u.r}`, 0);
        while (frontier.length > 0) {
            let current = frontier.shift();
            this.getNeighbors(current.q, current.r).forEach(n => {
                if (this.getUnitsInHex(n.q, n.r).length >= 4) return; const cost = this.map[n.q][n.r].cost; if (cost >= 99) return;
                const newCost = costSoFar.get(`${current.q},${current.r}`) + cost;
                if (newCost <= u.ap) { const key = `${n.q},${n.r}`; if (!costSoFar.has(key) || newCost < costSoFar.get(key)) { costSoFar.set(key, newCost); frontier.push({ q: n.q, r: n.r }); this.reachableHexes.push({ q: n.q, r: n.r }); } }
            });
        }
    }

    handleClick(p) {
        if (this.interactionMode === 'SELECT') { const u = this.getUnitInHex(p.q, p.r); if (!u) this.clearSelection(); } 
        else if (this.interactionMode === 'MOVE') { if (this.isValidHex(p.q, p.r) && this.path.length > 0) { const last = this.path[this.path.length - 1]; if (last.q === p.q && last.r === p.r) { this.actionMove(this.selectedUnit, this.path); this.setMode('SELECT'); } } else { this.setMode('SELECT'); } } 
        else if (this.interactionMode === 'ATTACK' || this.interactionMode === 'MELEE') { const u = this.getUnitInHex(p.q, p.r); if (!u) this.setMode('SELECT'); }
    }

    handleHover(p) {
        if (this.state !== 'PLAY') return; this.hoverHex = p; const u = this.selectedUnit;
        if (u) { if (this.interactionMode === 'MOVE') { const isReachable = this.reachableHexes.some(h => h.q === p.q && h.r === p.r); const targetUnits = this.getUnitsInHex(p.q, p.r); if (isReachable && targetUnits.length < 4) { this.path = this.findPath(u, p.q, p.r); } else { this.path = []; } } else if (this.interactionMode === 'ATTACK') { this.calcAttackLine(u, p.q, p.r); } }
    }

    refreshUnitState(u) { if (!u || u.hp <= 0) { this.selectedUnit = null; this.reachableHexes = []; this.attackLine = []; this.aimTargetUnit = null; } this.updateSidebar(); }
    clearSelection() { this.selectedUnit = null; this.reachableHexes = []; this.attackLine = []; this.aimTargetUnit = null; this.path = []; this.setMode('SELECT'); this.hideActionMenu(); this.updateSidebar(); }

    setStance(s) {
        const u = this.selectedUnit; if (!u || u.def.isTank) return; if (u.stance === s) return;
        let cost = 0; if (u.stance === 'prone' && (s === 'stand' || s === 'crouch')) { cost = 1; }
        if (u.ap < cost) { this.log(`AP不足 (必要:${cost})`); return; }
        u.ap -= cost; u.stance = s; this.refreshUnitState(u); this.hideActionMenu(); if (window.Sfx) Sfx.play('click');
    }
    toggleStance() { const u = this.selectedUnit; if (!u) return; let next = 'stand'; if (u.stance === 'stand') next = 'crouch'; else if (u.stance === 'crouch') next = 'prone'; this.setStance(next); }

    reloadWeapon(isManual = false) {
        const u = this.selectedUnit; if (!u) return; const w = u.hands;
        if (!w || w.isConsumable) { this.log("リロード不可"); return; }
        if (w.current >= w.cap) { this.log("装填済み"); return; }
        
        if (u.def.isTank) {
            if (u.ap < 1) { this.log("AP不足 (必要:1)"); return; }
            if (w.reserve <= 0) { this.log("予備弾薬なし"); return; }
            u.ap -= 1;
            w.current = 1; 
            w.reserve -= 1;
            this.log(`${u.name} 次弾装填完了 (残:${w.reserve})`);
            if (window.Sfx) Sfx.play('reload');
            this.refreshUnitState(u);
            if (isManual) this.hideActionMenu();
            return;
        }

        const cost = w.rld || 1;
        if (u.ap < cost) { this.log(`AP不足 (必要:${cost})`); return; }
        const magIndex = u.bag.findIndex(i => i && i.type === 'ammo' && i.ammoFor === w.code);
        if (magIndex === -1) { this.log("予備弾薬なし"); return; }
        u.bag[magIndex] = null; u.ap -= cost; w.current = w.cap;
        this.log(`${u.name} リロード完了`); if (window.Sfx) Sfx.play('reload');
        this.refreshUnitState(u); this.hideActionMenu();
    }

    actionRepair() {
        const u = this.selectedUnit; if (!u || u.ap < 2) { this.log("AP不足 (必要:2)"); return; }
        if (!u.hands || !u.hands.isBroken) { this.log("修理不要"); return; }
        u.ap -= 2; u.hands.isBroken = false; this.log(`${u.name} 武器修理完了`); if (window.Sfx) Sfx.play('reload'); this.refreshUnitState(u); this.hideActionMenu();
    }

    actionHeal() {
        const u = this.selectedUnit; if (!u || u.ap < 2) { this.log("AP不足 (必要:2)"); return; }
        const targets = this.getUnitsInHex(u.q, u.r).filter(t => t.team === u.team && t.hp < t.maxHp);
        if (targets.length === 0) { this.log("治療対象なし"); return; }
        targets.sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp)); const target = targets[0]; u.ap -= 2; const healAmount = 30;
        target.hp = Math.min(target.maxHp, target.hp + healAmount); this.log(`${u.name} が ${target.name} を治療 (+${healAmount})`);
        if (window.VFX) { const p = Renderer.hexToPx(u.q, u.r); window.VFX.add({ x: p.x, y: p.y - 20, vx: 0, vy: -1, life: 30, maxLife: 30, color: "#0f0", size: 4, type: 'spark' }); }
        this.refreshUnitState(u); this.hideActionMenu();
    }

    actionMeleeSetup() { this.setMode('MELEE'); }

    async actionMelee(a, d) {
        if (!a || a.ap < 2) { this.log("AP不足"); return; }
        if (a.q !== d.q || a.r !== d.r) { this.log("射程外"); return; }
        a.ap -= 2;
        let bestWeapon = null; let bestDmg = 0;
        if (a.hands && a.hands.type === 'melee') { bestWeapon = a.hands; bestDmg = a.hands.dmg; }
        a.bag.forEach(item => { if (item && item.type === 'melee' && item.dmg > bestDmg) { bestWeapon = item; bestDmg = item.dmg; } });
        const wpnName = bestWeapon ? bestWeapon.name : "銃床";
        this.log(`${a.name} 白兵攻撃(${wpnName}) vs ${d.name}`);
        if (Renderer.playAttackAnim) Renderer.playAttackAnim(a, d);
        await new Promise(r => setTimeout(r, 300));
        let totalDmg = 10 + (a.stats.str * 3);
        if (bestWeapon) totalDmg += bestWeapon.dmg;
        if (d.skills.includes('CQC')) { this.log(`>> ${d.name} カウンター！`); a.hp -= 15; }
        d.hp -= totalDmg;
        if (window.Sfx) Sfx.play('hit');
        if (d.hp <= 0 && !d.deadProcessed) { 
            d.deadProcessed = true; 
            this.log(`>> ${d.name} を撃破！`); 
            if (window.Sfx) Sfx.play('death'); 
            if(this.checkWin()) return;
        }
        this.refreshUnitState(a); this.checkPhaseEnd();
    }

    async actionAttack(a, d) {
        const w = a.hands; if (!w) return;
        if (w.isBroken) { this.log("武器故障中！修理が必要"); return; }
        if (w.isConsumable && w.current <= 0) { this.log("使用済みです"); return; }
        
        // ★修正: 戦車用 JIT(Just-In-Time)オートリロード
        if (a.def.isTank && w.current <= 0 && this.tankAutoReload) {
            if (w.reserve > 0) {
                // 攻撃コスト(w.ap) + 装填コスト(1) が必要
                const totalCost = w.ap + 1;
                if (a.ap >= totalCost) {
                    a.ap -= 1;
                    w.reserve--;
                    w.current = 1;
                    this.log(`${a.name} 自動装填完了`);
                    if (window.Sfx) Sfx.play('reload');
                    this.refreshUnitState(a);
                } else {
                    this.log(`AP不足で自動装填不可 (必要:${totalCost})`);
                    return;
                }
            } else {
                this.log("予備弾薬切れ！");
                return;
            }
        }

        if (w.current <= 0) { this.log("弾切れ！装填が必要だ！"); return; }
        if (a.ap < w.ap) { this.log("AP不足"); return; }
        
        const dist = this.hexDist(a, d); if (dist > w.rng) { this.log("射程外"); return; }
        a.ap -= w.ap; this.state = 'ANIM';
        if (Renderer.playAttackAnim) Renderer.playAttackAnim(a, d);
        let hitChance = (a.stats?.aim || 0) * 2 + w.acc - (dist * 5) - this.map[d.q][d.r].cover;
        if (d.stance === 'prone') hitChance -= 20; if (d.stance === 'crouch') hitChance -= 10;
        let dmgMod = 1.0 + (a.stats?.str || 0) * 0.05;
        const shots = w.isConsumable ? 1 : Math.min(w.burst || 1, w.current);
        this.log(`${a.name} 攻撃開始 (${w.name})`);
        for (let i = 0; i < shots; i++) {
            if (d.hp <= 0) break;
            if (!w.isConsumable && w.jam && Math.random() < w.jam) { this.log(`⚠ JAM!! ${w.name}が故障！`); w.isBroken = true; if (window.Sfx) Sfx.play('ricochet'); break; }
            w.current--;
            const sPos = Renderer.hexToPx(a.q, a.r); const ePos = Renderer.hexToPx(d.q, d.r);
            const spread = (100 - w.acc) * 0.5; const tx = ePos.x + (Math.random() - 0.5) * spread; const ty = ePos.y + (Math.random() - 0.5) * spread;
            if (window.Sfx) Sfx.play(w.type === 'shell' || w.type === 'shell_fast' ? 'cannon' : 'shot');
            const flightTime = w.type.includes('shell') ? dist * 100 : dist * 50;
            if (window.VFX) VFX.addProj({ x: sPos.x, y: sPos.y, sx: sPos.x, sy: sPos.y, ex: tx, ey: ty, type: w.type, speed: 0.1, progress: 0, arcHeight: (w.type.includes('shell') ? 100 : 0), onHit: () => { } });
            setTimeout(() => {
                if (d.hp <= 0) return;
                const isHit = (Math.random() * 100) < hitChance;
                if (isHit) {
                    let dmg = Math.floor(w.dmg * dmgMod * (0.8 + Math.random() * 0.4));
                    if (d.def.isTank && w.type === 'bullet') dmg = 0;
                    if (dmg > 0) {
                        d.hp -= dmg;
                        if (typeof Renderer !== 'undefined' && Renderer.playExplosion && w.type.includes('shell')) Renderer.playExplosion(tx, ty);
                        else if (window.VFX) VFX.addExplosion(tx, ty, "#f55", 5);
                        if (window.Sfx) Sfx.play('ricochet');
                    } else {
                        if (window.VFX) VFX.add({ x: tx, y: ty, vx: 0, vy: -5, life: 10, maxLife: 10, color: "#fff", size: 2, type: 'spark' });
                        if (i === 0) this.log(">> 装甲により無効化！");
                    }
                } else { if (window.VFX) VFX.add({ x: tx, y: ty, vx: 0, vy: 0, life: 10, maxLife: 10, color: "#aaa", size: 2, type: 'smoke' }); }
            }, flightTime);
            await new Promise(r => setTimeout(r, 100));
        }
        if (w.isConsumable && w.current <= 0) { a.hands = null; this.log(`${w.name} を消費しました`); }
        setTimeout(() => {
            if (d.hp <= 0 && !d.deadProcessed) { 
                d.deadProcessed = true; 
                this.log(`>> ${d.name} を撃破！`); 
                if (window.Sfx) Sfx.play('death'); 
                if (window.VFX) VFX.addUnitDebris(Renderer.hexToPx(d.q, d.r).x, Renderer.hexToPx(d.q, d.r).y); 
                if(this.checkWin()) return;
            }
            this.state = 'PLAY'; 
            
            // ★追加: 戦車オートリロード判定 (攻撃後の補充)
            if(a.def.isTank && w.current === 0 && w.reserve > 0) {
                if (this.tankAutoReload && a.ap >= 1) {
                    this.reloadWeapon(); 
                }
            }

            this.refreshUnitState(a); 
            this.checkPhaseEnd();
        }, 800);
    }
}
window.gameLogic = new Game();

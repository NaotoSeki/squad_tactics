/** LOGIC: Restored checkDeploy & deployUnit & Card Icons */

// アイコン生成ヘルパー
function createCardIcon(type) {
    const c = document.createElement('canvas');
    c.width = 100; c.height = 100;
    const ctx = c.getContext('2d');
    ctx.fillStyle = "#1a1a1a"; ctx.fillRect(0,0,100,100);
    ctx.lineWidth = 4; ctx.strokeStyle = "#d84"; ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (type === 'infantry') {
        ctx.fillStyle = "#d84"; ctx.beginPath(); ctx.arc(50, 30, 15, 0, Math.PI*2); ctx.fill(); 
        ctx.beginPath(); ctx.moveTo(50, 45); ctx.lineTo(50, 80); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(20, 55); ctx.lineTo(80, 55); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(50, 80); ctx.lineTo(30, 95); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(50, 80); ctx.lineTo(70, 95); ctx.stroke();
    } else if (type === 'tank') {
        ctx.fillStyle = "#d84"; ctx.fillRect(20, 40, 60, 30);
        ctx.beginPath(); ctx.arc(50, 40, 15, Math.PI, 0); ctx.fill();
        ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(65, 35); ctx.lineTo(95, 30); ctx.stroke();
        ctx.lineWidth = 4; ctx.strokeRect(15, 65, 70, 15); 
    } else if (type === 'heal') {
        ctx.fillStyle = "#4f8"; ctx.fillRect(40, 20, 20, 60); ctx.fillRect(20, 40, 60, 20);
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.strokeRect(40, 20, 20, 60); ctx.strokeRect(20, 40, 60, 20);
    }
    return c.toDataURL();
}

class Game {
    constructor() {
        this.units = []; this.map = []; this.setupSlots = []; this.state = 'SETUP';
        this.path = []; this.reachableHexes = []; this.attackLine = [];
        this.aimTargetUnit = null; this.hoverHex = null;
        this.isAuto = false; this.isProcessingTurn = false; this.sector = 1;
        this.enemyAI = 'AGGRESSIVE'; this.cardsUsed = 0;
        this.interactionMode = 'SELECT'; this.selectedUnit = null;
        this.initDOM(); this.initSetup();
    }

    initDOM() {
        Renderer.init(document.getElementById('game-view'));
        window.addEventListener('click', (e) => {
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
        sb.classList.toggle('collapsed'); tg.innerText = sb.classList.contains('collapsed') ? '◀' : '▶';
        if (sb.classList.contains('collapsed')) { sb.style.width = ''; }
        setTimeout(() => Renderer.resize(), 150);
    }

    initSetup() {
        const box = document.getElementById('setup-cards');
        ['rifleman', 'scout', 'gunner', 'sniper'].forEach(k => {
            const t = UNIT_TEMPLATES[k]; const d = document.createElement('div'); d.className = 'card';
            d.innerHTML = `<div class="card-badge">0</div><div class="card-img-box"><img src="${createCardIcon('infantry')}"></div><div class="card-body"><h3 style="color:#d84">${t.name}</h3><p style="font-size:10px">${t.role}</p></div>`;
            d.onclick = () => {
                if (this.setupSlots.length < 3) {
                    this.setupSlots.push(k);
                    d.querySelector('.card-badge').innerText = this.setupSlots.filter(s => s === k).length;
                    d.querySelector('.card-badge').style.display = 'flex';
                    this.log(`> 採用: ${t.name}`);
                    if (this.setupSlots.length === 3) document.getElementById('btn-start').style.display = 'inline-block';
                }
            };
            box.appendChild(d);
        });
    }

    createSoldier(templateKey, team, q, r) {
        const t = UNIT_TEMPLATES[templateKey]; if (!t) return null;
        const isPlayer = (team === 'player'); const stats = { ...t.stats };
        if (isPlayer && !t.isTank) { ['str', 'aim', 'mob', 'mor'].forEach(k => stats[k] = (stats[k] || 0) + Math.floor(Math.random() * 3) - 1); }
        let name = t.name; let rank = 0; let faceSeed = Math.floor(Math.random() * 99999);
        if (isPlayer && !t.isTank) {
            const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
            const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
            name = `${last} ${first}`;
        }
        const createItem = (key, isMainWpn = false) => {
            if (!key || !WPNS[key]) return null;
            let base = WPNS[key]; let item = { ...base, code: key, id: Math.random(), isBroken: false };
            if (base.type === 'bullet' || base.type === 'shell_fast') {
                if (isMainWpn && typeof MAG_VARIANTS !== 'undefined' && MAG_VARIANTS[key]) {
                    const vars = MAG_VARIANTS[key]; const choice = vars[Math.floor(Math.random() * vars.length)];
                    item.cap = choice.cap; item.jam = choice.jam; item.magName = choice.name;
                }
                item.current = item.cap;
            } else if (base.type === 'shell' || base.area) { item.current = 1; item.isConsumable = true; }
            return item;
        };
        let hands = null; let bag = [];
        if (t.main) hands = createItem(t.main, true);
        if (t.sub) bag.push(createItem(t.sub));
        if (t.opt) { const optBase = WPNS[t.opt]; const count = optBase.mag || 1; for (let i = 0; i < count; i++) bag.push(createItem(t.opt)); }
        if (hands && hands.mag && !hands.isConsumable) {
            for (let i = 0; i < hands.mag; i++) { if (bag.length >= 4) break; bag.push({ type: 'ammo', name: (hands.magName || 'Clip'), ammoFor: hands.code, cap: hands.cap, jam: hands.jam, code: 'mag' }); }
        }
        if (!isPlayer) { if (hands) hands.current = 999; bag = []; }
        return {
            id: Math.random(), team: team, q: q, r: r, def: t, name: name, rank: rank, faceSeed: faceSeed, stats: stats,
            hp: t.hp || (80 + (stats.str || 0) * 5), maxHp: t.hp || (80 + (stats.str || 0) * 5),
            ap: t.ap || Math.floor((stats.mob || 0) / 2) + 3, maxAp: t.ap || Math.floor((stats.mob || 0) / 2) + 3,
            hands: hands, bag: bag, stance: 'stand', skills: [], sectorsSurvived: 0, deadProcessed: false, curWpn: hands ? hands.code : 'unarmed'
        };
    }

    getUnitsInHex(q, r) { return this.units.filter(u => u.q === q && u.r === r && u.hp > 0); }
    getUnitInHex(q, r) { return this.units.find(u => u.q === q && u.r === r && u.hp > 0); }
    getUnit(q, r) { return this.getUnitInHex(q, r); }

    startCampaign() {
        document.getElementById('setup-screen').style.display = 'none';
        if (typeof Renderer !== 'undefined' && Renderer.game) {
            const mainScene = Renderer.game.scene.getScene('MainScene');
            if (mainScene) {
                mainScene.mapGenerated = false;
                if (mainScene.hexGroup && typeof mainScene.hexGroup.removeAll === 'function') mainScene.hexGroup.removeAll();
                if (window.EnvSystem) window.EnvSystem.clear();
            }
        }
        Renderer.resize();
        this.selectedUnit = null; this.reachableHexes = []; this.attackLine = []; this.aimTargetUnit = null; this.path = [];
        this.cardsUsed = 0;
        this.units = this.units.filter(u => u.team === 'player' && u.hp > 0);
        this.units.forEach(u => { u.q = -999; u.r = -999; });
        this.generateMap();
        if (this.units.length === 0) {
            this.setupSlots.forEach(k => { const p = this.getSafeSpawnPos('player'); const u = this.createSoldier(k, 'player', p.q, p.r); this.units.push(u); });
        } else {
            this.units.forEach(u => { const p = this.getSafeSpawnPos('player'); u.q = p.q; u.r = p.r; });
        }
        this.spawnEnemies();
        this.state = 'PLAY';
        this.log(`SECTOR ${this.sector} START`);
        document.getElementById('sector-counter').innerText = `SECTOR: ${this.sector.toString().padStart(2, '0')}`;
        const leader = this.units.find(u => u.team === 'player');
        if (leader && leader.q !== -999) Renderer.centerOn(leader.q, leader.r);
        setTimeout(() => { if (Renderer.dealCards) Renderer.dealCards(['rifleman', 'tank_pz4', 'gunner', 'scout', 'tank_tiger']); }, 500);
    }

    getSafeSpawnPos(team) {
        const cy = Math.floor(MAP_H / 2);
        for (let i = 0; i < 100; i++) {
            const q = Math.floor(Math.random() * MAP_W); const r = Math.floor(Math.random() * MAP_H);
            if (team === 'player' && r < cy) continue; if (team === 'enemy' && r >= cy) continue;
            if (this.isValidHex(q, r) && this.getUnitsInHex(q, r).length < 4 && this.map[q][r].id !== -1 && this.map[q][r].id !== 5) { return { q, r }; }
        }
        return { q: 0, r: 0 };
    }

    // ★重要: 復活した checkDeploy と deployUnit
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
        if(u) {
            this.units.push(u); this.cardsUsed++; 
            this.log(`増援到着: ${u.name} (残コスト:${2-this.cardsUsed})`);
            if(window.VFX) { const pos = Renderer.hexToPx(targetHex.q, targetHex.r); window.VFX.addSmoke(pos.x, pos.y); }
            this.updateSidebar();
        }
    }

    // --- インタラクション ---
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
        this.interactionMode = mode; this.hideActionMenu();
        const indicator = document.getElementById('mode-label');
        if (mode === 'SELECT') { indicator.style.display = 'none'; this.path = []; this.attackLine = []; } else {
            indicator.style.display = 'block'; indicator.innerText = mode + " MODE";
            if (mode === 'MOVE') { this.calcReachableHexes(this.selectedUnit); } else if (mode === 'ATTACK') { this.reachableHexes = []; }
        }
    }

    calcReachableHexes(u) {
        this.reachableHexes = []; if (!u) return;
        let frontier = [{ q: u.q, r: u.r, cost: 0 }], costSoFar = new Map(); costSoFar.set(`${u.q},${u.r}`, 0);
        while (frontier.length > 0) {
            let current = frontier.shift();
            this.getNeighbors(current.q, current.r).forEach(n => {
                if (this.getUnitsInHex(n.q, n.r).length >= 4) return;
                const cost = this.map[n.q][n.r].cost; if (cost >= 99) return;
                const newCost = costSoFar.get(`${current.q},${current.r}`) + cost;
                if (newCost <= u.ap) {
                    const key = `${n.q},${n.r}`;
                    if (!costSoFar.has(key) || newCost < costSoFar.get(key)) { costSoFar.set(key, newCost); frontier.push({ q: n.q, r: n.r }); this.reachableHexes.push({ q: n.q, r: n.r }); }
                }
            });
        }
    }

    handleClick(p) {
        if (this.interactionMode === 'SELECT') { const u = this.getUnitInHex(p.q, p.r); if (!u) this.clearSelection(); } 
        else if (this.interactionMode === 'MOVE') {
            if (this.isValidHex(p.q, p.r) && this.path.length > 0) {
                const last = this.path[this.path.length - 1];
                if (last.q === p.q && last.r === p.r) { this.actionMove(this.selectedUnit, this.path); this.setMode('SELECT'); }
            } else { this.setMode('SELECT'); }
        } else if (this.interactionMode === 'ATTACK' || this.interactionMode === 'MELEE') { const u = this.getUnitInHex(p.q, p.r); if (!u) this.setMode('SELECT'); }
    }

    handleHover(p) {
        if (this.state !== 'PLAY') return; this.hoverHex = p; const u = this.selectedUnit;
        if (u) {
            if (this.interactionMode === 'MOVE') {
                const isReachable = this.reachableHexes.some(h => h.q === p.q && h.r === p.r);
                const targetUnits = this.getUnitsInHex(p.q, p.r);
                if (isReachable && targetUnits.length < 4) { this.path = this.findPath(u, p.q, p.r); } else { this.path = []; }
            } else if (this.interactionMode === 'ATTACK') { this.calcAttackLine(u, p.q, p.r); }
        }
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
        if (d.hp <= 0 && !d.deadProcessed) { d.deadProcessed = true; this.log(`>> ${d.name} を撃破！`); if (window.Sfx) Sfx.play('death'); }
        this.refreshUnitState(a); this.checkPhaseEnd();
    }

    async actionAttack(a, d) {
        const w = a.hands; if (!w) return;
        if (w.isBroken) { this.log("武器故障中！修理が必要"); return; }
        if (w.isConsumable && w.current <= 0) { this.log("使用済みです"); return; }
        if (w.current <= 0) { this.log("弾切れ！リロードが必要だ！"); return; }
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
            if (d.hp <= 0 && !d.deadProcessed) { d.deadProcessed = true; this.log(`>> ${d.name} を撃破！`); if (window.Sfx) Sfx.play('death'); if (window.VFX) VFX.addUnitDebris(Renderer.hexToPx(d.q, d.r).x, Renderer.hexToPx(d.q, d.r).y); }
            this.state = 'PLAY'; this.refreshUnitState(a); this.checkPhaseEnd();
        }, 800);
    }

    calcAttackLine(u, targetQ, targetR) {
        this.attackLine = []; this.aimTargetUnit = null; if (!u || u.ap < 2) return; const w = u.hands; if (!w) return;
        const range = w.rng; const dist = this.hexDist(u, { q: targetQ, r: targetR }); if (dist === 0) return;
        const drawLen = Math.min(dist, range); const start = this.axialToCube(u.q, u.r); const end = this.axialToCube(targetQ, targetR);
        for (let i = 1; i <= drawLen; i++) {
            const t = i / dist;
            const lerpCube = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t, z: start.z + (end.z - start.z) * t };
            const roundCube = this.cubeRound(lerpCube); const hex = this.cubeToAxial(roundCube);
            if (this.isValidHex(hex.q, hex.r)) { this.attackLine.push({ q: hex.q, r: hex.r }); } else { break; }
        }
        if (this.attackLine.length > 0) {
            const lastHex = this.attackLine[this.attackLine.length - 1];
            if (lastHex.q === targetQ && lastHex.r === targetR) { const target = this.getUnitInHex(lastHex.q, lastHex.r); if (target && target.team !== u.team) { this.aimTargetUnit = target; } }
        }
    }

    generateMap() {
        this.map = []; for (let q = 0; q < MAP_W; q++) { this.map[q] = []; for (let r = 0; r < MAP_H; r++) { this.map[q][r] = TERRAIN.VOID; } }
        const cx = Math.floor(MAP_W / 2), cy = Math.floor(MAP_H / 2); let walkers = [{ q: cx, r: cy }];
        const paintBrush = (cq, cr) => { const brush = [{ q: cq, r: cr }, ...this.getNeighbors(cq, cr)]; brush.forEach(h => { if (this.isValidHex(h.q, h.r)) this.map[h.q][h.r] = TERRAIN.GRASS; }); };
        for (let i = 0; i < 140; i++) {
            const wIdx = Math.floor(Math.random() * walkers.length); const w = walkers[wIdx]; paintBrush(w.q, w.r);
            const neighbors = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]; const dir = neighbors[Math.floor(Math.random() * 6)];
            const next = { q: w.q + dir[0], r: w.r + dir[1] };
            if (Math.random() < 0.05 && walkers.length < 5) walkers.push(next); else walkers[wIdx] = next;
        }
        for (let i = 0; i < 3; i++) { for (let q = 1; q < MAP_W - 1; q++) { for (let r = 1; r < MAP_H - 1; r++) { if (this.map[q][r].id === -1) { const ln = this.getNeighbors(q, r).filter(n => this.map[n.q][n.r].id !== -1).length; if (ln >= 4) this.map[q][r] = TERRAIN.GRASS; } } } }
        for (let loop = 0; loop < 2; loop++) { const wC = []; for (let q = 0; q < MAP_W; q++) { for (let r = 0; r < MAP_H; r++) { if (this.map[q][r].id === -1) { const hn = this.getNeighbors(q, r).some(n => this.map[n.q][n.r].id !== -1); if (hn) wC.push({ q, r }); } } } wC.forEach(w => { this.map[w.q][w.r] = TERRAIN.WATER; }); }
        for (let q = 0; q < MAP_W; q++) { for (let r = 0; r < MAP_H; r++) { const tId = this.map[q][r].id; if (tId !== -1 && tId !== 5) { const n = Math.sin(q * 0.4) + Math.cos(r * 0.4) + Math.random() * 0.4; let t = TERRAIN.GRASS; if (n > 1.1) t = TERRAIN.FOREST; else if (n < -0.9) t = TERRAIN.DIRT; if (t !== TERRAIN.WATER && Math.random() < 0.05) t = TERRAIN.TOWN; this.map[q][r] = t; } } }
    }
    spawnEnemies() {
        const c = 4 + Math.floor(this.sector * 0.7);
        for (let i = 0; i < c; i++) {
            let k = 'rifleman'; const r = Math.random(); if (r < 0.1 + this.sector * 0.1) k = 'tank_pz4'; else if (r < 0.4) k = 'gunner'; else if (r < 0.6) k = 'sniper';
            const e = this.createSoldier(k, 'enemy', 0, 0); if (e) { const p = this.getSafeSpawnPos('enemy'); e.q = p.q; e.r = p.r; this.units.push(e); }
        }
    }
    toggleAuto() { this.isAuto = !this.isAuto; document.getElementById('auto-toggle').classList.toggle('active'); this.log(`AUTO: ${this.isAuto ? "ON" : "OFF"}`); }
    runAuto() { }
    async actionMove(u, p) {
        this.state = 'ANIM'; this.path = []; this.reachableHexes = []; this.attackLine = []; this.aimTargetUnit = null;
        for (let s of p) { u.ap -= this.map[s.q][s.r].cost; u.q = s.q; u.r = s.r; if (window.Sfx) Sfx.play('move'); await new Promise(r => setTimeout(r, 180)); }
        this.checkReactionFire(u); this.state = 'PLAY'; this.refreshUnitState(u); this.checkPhaseEnd();
    }
    checkReactionFire(u) {
        this.units.filter(e => e.team !== u.team && e.hp > 0 && e.def.isTank && this.hexDist(u, e) <= 1).forEach(t => {
            this.log(`!! 防御射撃: ${t.name}->${u.name}`); u.hp -= 15; if (window.VFX) VFX.addExplosion(Renderer.hexToPx(u.q, u.r).x, Renderer.hexToPx(u.q, u.r).y, "#fa0", 5);
            if (window.Sfx) Sfx.play('mg'); if (u.hp <= 0 && !u.deadProcessed) { u.deadProcessed = true; this.log(`${u.name} 撃破`); if (window.Sfx) Sfx.play('death'); }
        });
    }
    swapWeapon() { }
    checkPhaseEnd() { if (this.units.filter(u => u.team === 'player' && u.hp > 0 && u.ap > 0).length === 0 && this.state === 'PLAY') this.endTurn(); }
    endTurn() {
        if (this.isProcessingTurn) return; this.isProcessingTurn = true;
        this.selectedUnit = null; this.reachableHexes = []; this.attackLine = []; this.aimTargetUnit = null; this.path = []; this.hideActionMenu();
        this.state = 'ANIM'; const eyecatch = document.getElementById('eyecatch'); if (eyecatch) eyecatch.style.opacity = 1;
        this.units.filter(u => u.team === 'player' && u.hp > 0 && u.skills.includes("Mechanic")).forEach(u => { const c = u.skills.filter(s => s === "Mechanic").length; if (u.hp < u.maxHp) { u.hp = Math.min(u.maxHp, u.hp + c * 20); this.log(`${u.name} 修理`); } });
        setTimeout(async () => {
            if (eyecatch) eyecatch.style.opacity = 0; const es = this.units.filter(u => u.team === 'enemy' && u.hp > 0);
            for (let e of es) {
                const ps = this.units.filter(u => u.team === 'player' && u.hp > 0); if (ps.length === 0) { this.checkLose(); break; }
                let target = ps[0]; let minDist = 999; ps.forEach(p => { const d = this.hexDist(e, p); if (d < minDist) { minDist = d; target = p; } });
                e.ap = e.maxAp; const w = e.hands; if (!w) continue; const distToTarget = this.hexDist(e, target);
                if (distToTarget <= w.rng && e.ap >= w.ap) { await this.actionAttack(e, target); } else {
                    const p = this.findPath(e, target.q, target.r);
                    if (p.length > 0) {
                        const next = p[0]; if (this.map[next.q][next.r].cost <= e.ap) { e.q = next.q; e.r = next.r; e.ap -= this.map[next.q][next.r].cost; await new Promise(r => setTimeout(r, 200)); if (this.hexDist(e, target) <= w.rng && e.ap >= w.ap) { await this.actionAttack(e, target); } }
                    }
                }
            }
            this.units.forEach(u => { if (u.team === 'player') u.ap = u.maxAp; }); this.log("-- PLAYER PHASE --"); this.state = 'PLAY'; this.isProcessingTurn = false;
        }, 1200);
    }
    healSurvivors() { this.units.filter(u => u.team === 'player' && u.hp > 0).forEach(u => { const t = Math.floor(u.maxHp * 0.8); if (u.hp < t) u.hp = t; }); this.log("治療完了"); }
    promoteSurvivors() { this.units.filter(u => u.team === 'player' && u.hp > 0).forEach(u => { u.sectorsSurvived++; if (u.sectorsSurvived === 5) { u.skills.push("Hero"); u.maxAp++; this.log("英雄昇格"); } u.rank = Math.min(5, (u.rank || 0) + 1); u.maxHp += 30; u.hp += 30; if (u.skills.length < 8 && Math.random() < 0.7) { const k = Object.keys(SKILLS).filter(z => z !== "Hero"); u.skills.push(k[Math.floor(Math.random() * k.length)]); this.log("スキル習得"); } }); }
    checkWin() { if (this.units.filter(u => u.team === 'enemy' && u.hp > 0).length === 0) { if (window.Sfx) Sfx.play('win'); document.getElementById('reward-screen').style.display = 'flex'; this.promoteSurvivors(); const b = document.getElementById('reward-cards'); b.innerHTML = ''; [{ k: 'rifleman', t: '新兵' }, { k: 'tank_pz4', t: '戦車' }, { k: 'heal', t: '医療' }].forEach(o => { const d = document.createElement('div'); d.className = 'card'; d.innerHTML = `<div class="card-img-box"><img src="${createCardIcon(o.k === 'heal' ? 'heal' : 'infantry')}"></div><div class="card-body"><h3>${o.t}</h3><p>補給</p></div>`; d.onclick = () => { if (o.k === 'heal') this.healSurvivors(); else this.spawnAtSafeGround('player', o.k); this.sector++; document.getElementById('reward-screen').style.display = 'none'; this.startCampaign(); }; b.appendChild(d); }); return true; } return false; }
    checkLose() { if (this.units.filter(u => u.team === 'player' && u.hp > 0).length === 0) document.getElementById('gameover-screen').style.display = 'flex'; }
    isValidHex(q, r) { return q >= 0 && q < MAP_W && r >= 0 && r < MAP_H; }
    hexDist(a, b) { return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2; }
    getNeighbors(q, r) { return [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]].map(d => ({ q: q + d[0], r: r + d[1] })).filter(h => this.isValidHex(h.q, h.r)); }
    findPath(u, tq, tr) { let f = [{ q: u.q, r: u.r }], cf = {}, cs = {}; cf[`${u.q},${u.r}`] = null; cs[`${u.q},${u.r}`] = 0; while (f.length > 0) { let c = f.shift(); if (c.q === tq && c.r === tr) break; this.getNeighbors(c.q, c.r).forEach(n => { if (this.getUnitsInHex(n.q, n.r).length >= 4 && (n.q !== tq || n.r !== tr)) return; const cost = this.map[n.q][n.r].cost; if (cost >= 99) return; const nc = cs[`${c.q},${c.r}`] + cost; if (nc <= u.ap) { const k = `${n.q},${n.r}`; if (!(k in cs) || nc < cs[k]) { cs[k] = nc; f.push(n); cf[k] = c; } } }); } let p = [], c = { q: tq, r: tr }; if (!cf[`${tq},${tr}`]) return []; while (c) { if (c.q === u.q && c.r === u.r) break; p.push(c); c = cf[`${c.q},${c.r}`]; } return p.reverse(); }
    log(m) { const c = document.getElementById('log-container'); if (c) { const d = document.createElement('div'); d.className = 'log-entry'; d.innerText = `> ${m}`; c.appendChild(d); c.scrollTop = c.scrollHeight; } }
    showContext(mx, my) { const p = Renderer.pxToHex(mx, my); const m = document.getElementById('context-menu'); if (!m) return; const u = this.getUnitInHex(p.q, p.r); const t = this.isValidHex(p.q, p.r) ? this.map[p.q][p.r] : null; let h = ""; if (u) { h += `<div style="color:#0af;font-weight:bold">${u.name}</div>`; h += `<div style="font-size:10px">${u.def.name} (${RANKS[u.rank]})</div>`; h += `HP:${u.hp}/${u.maxHp} AP:${u.ap}/${u.maxAp}<br>`; h += `Stance: ${u.stance}`; } else if (t) { h += `<div style="color:#da4;font-weight:bold">${t.name}</div>`; h += `Cost:${t.cost} Cover:${t.cover}%`; } h += `<hr style="border:0;border-top:1px solid #444;margin:5px 0;">`; h += `<button onclick="gameLogic.endTurn();document.getElementById('context-menu').style.display='none';" style="width:100%;cursor:pointer;background:#522;color:#fcc;border:1px solid #d44;padding:3px;">TURN END</button>`; if (h !== "") { m.innerHTML = h; m.style.display = 'block'; m.style.left = (mx + 10) + 'px'; m.style.top = (my + 10) + 'px'; } }
    getStatus(u) { if (u.hp <= 0) return "DEAD"; const r = u.hp / u.maxHp; if (r > 0.8) return "NORMAL"; if (r > 0.5) return "DAMAGED"; return "CRITICAL"; }
    axialToCube(q, r) { return { x: q, y: r, z: -q - r }; }
    cubeToAxial(c) { return { q: c.x, r: c.y }; }
    cubeRound(c) { let rx = Math.round(c.x), ry = Math.round(c.y), rz = Math.round(c.z); const x_diff = Math.abs(rx - c.x), y_diff = Math.abs(ry - c.y), z_diff = Math.abs(rz - c.z); if (x_diff > y_diff && x_diff > z_diff) rx = -ry - rz; else if (y_diff > z_diff) ry = -rx - rz; else rz = -rx - ry; return { x: rx, y: ry, z: rz }; }

    updateSidebar() {
        const ui = document.getElementById('unit-info'), u = this.selectedUnit;
        if (u) {
            const w = u.hands; const s = this.getStatus(u); const skillCounts = {}; u.skills.forEach(sk => { skillCounts[sk] = (skillCounts[sk] || 0) + 1; });
            let skillHtml = ""; for (const [sk, count] of Object.entries(skillCounts)) { if (window.SKILL_STYLES && window.SKILL_STYLES[sk]) { const st = window.SKILL_STYLES[sk]; skillHtml += `<div style="display:inline-block; background:${st.col}; color:#000; font-weight:bold; font-size:10px; padding:2px 5px; margin:2px; border-radius:3px;">${st.icon} ${st.name} x${count}</div>`; } }
            const faceUrl = (Renderer.generateFaceIcon) ? Renderer.generateFaceIcon(u.faceSeed) : "";
            const makeSlot = (item, type, index) => { if (!item) return `<div class="slot empty" ondragover="onSlotDragOver(event)" ondragleave="onSlotDragLeave(event)" ondrop="onSlotDrop(event, '${type}', ${index})"><div style="font-size:10px; color:#555;">[EMPTY]</div></div>`; const isMain = (type === 'main'); const isAmmo = (item.type === 'ammo'); const width = (item.cap > 0) ? (item.current / item.cap) * 100 : 0; return `<div class="slot ${isMain?'main-weapon':'bag-item'}" draggable="true" ondragstart="onSlotDragStart(event, '${type}', ${index})" ondragend="onSlotDragEnd(event)" ondragover="onSlotDragOver(event)" ondragleave="onSlotDragLeave(event)" ondrop="onSlotDrop(event, '${type}', ${index})"><div class="slot-name">${isMain?'🔫':''} ${item.name}</div>${!isAmmo ? `<div class="slot-meta"><span>RNG:${item.rng} DMG:${item.dmg}</span> <span class="ammo-text">${item.current}/${item.cap}</span></div>` : `<div class="slot-meta" style="color:#d84">AMMO for ${item.ammoFor}</div>`}${!isAmmo && item.cap > 0 ? `<div class="ammo-bar"><div class="ammo-fill" style="width:${width}%"></div></div>` : ''}</div>`; };
            const mainSlot = makeSlot(u.hands, 'main', 0); let subSlots = ""; for (let i = 0; i < 4; i++) { subSlots += makeSlot(u.bag[i], 'bag', i); }
            let canReload = false; if (w && w.current < w.cap && u.bag.some(i => i && i.type === 'ammo' && i.ammoFor === w.code)) canReload = true;
            let reloadBtn = canReload ? `<button onclick="gameLogic.reloadWeapon()" style="width:100%; background:#442; color:#dd4; border:1px solid #884; cursor:pointer; margin-top:5px;">🔃 RELOAD (${w.rld||1} AP)</button>` : "";
            ui.innerHTML = `<div class="soldier-header"><div class="face-box"><img src="${faceUrl}" width="64" height="64"></div><div><div class="soldier-name">${u.name}</div><div class="soldier-rank">${RANKS[u.rank] || 'Pvt'}</div></div></div><div class="stat-grid"><div class="stat-row"><span class="stat-label">HP</span> <span class="stat-val">${u.hp}/${u.maxHp}</span></div><div class="stat-row"><span class="stat-label">AP</span> <span class="stat-val">${u.ap}/${u.maxAp}</span></div><div class="stat-row"><span class="stat-label">AIM</span> <span class="stat-val">${u.stats?.aim||'-'}</span></div><div class="stat-row"><span class="stat-label">STR</span> <span class="stat-val">${u.stats?.str||'-'}</span></div></div><div class="inv-header" style="padding:0 10px; margin-top:10px;">LOADOUT (Drag to Swap)</div><div class="loadout-container"><div class="main-slot-area">${mainSlot}</div><div class="sub-slot-area">${subSlots}</div></div><div style="padding:0 10px;">${reloadBtn}</div><div style="margin:5px 0; padding:0 10px;">${skillHtml}</div><div style="padding:10px;"><div style="font-size:10px; color:#666;">TACTICS</div><button class="btn-stance ${u.stance==='stand'?'active-stance':''}" onclick="gameLogic.toggleStance()">STANCE</button><button onclick="gameLogic.endTurn()" class="${this.state!=='PLAY'?'disabled':''}" style="width:100%; background:#522; border-color:#d44; margin-top:15px; padding:5px; color:#fcc;">End Turn</button></div>`;
            if (u.def.isTank) document.querySelectorAll('.btn-stance').forEach(b => b.classList.add('disabled'));
        } else { ui.innerHTML = `<div style="text-align:center;color:#555;margin-top:80px;">// NO SIGNAL //</div>`; }
    }
}
window.gameLogic = new Game();

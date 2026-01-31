/** LOGIC GAME: High-Quality Map Gen & Interaction Fix */

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

        this.ui = new UIManager(this);
        this.ai = new EnemyAI(this);

        this.initDOM();
        this.initSetup();
    }

    initDOM() { if(typeof Renderer !== 'undefined') Renderer.init(document.getElementById('game-view')); }
    toggleSidebar() { this.ui.toggleSidebar(); }
    toggleTankAutoReload() { this.tankAutoReload = !this.tankAutoReload; this.updateSidebar(); }
    log(m) { this.ui.log(m); }

    initSetup() {
        this.setupSlots = [];
        this.ui.renderSetupCards(this.setupSlots, (k, domEl) => {
            const idx = this.setupSlots.indexOf(k);
            if (idx >= 0) { this.setupSlots.splice(idx, 1); domEl.classList.remove('selected'); domEl.querySelector('.card-badge').style.display = 'none'; domEl.style.borderColor = "#555"; }
            else { if (this.setupSlots.length < 3) { this.setupSlots.push(k); domEl.classList.add('selected'); domEl.querySelector('.card-badge').style.display = 'flex'; domEl.style.borderColor = "#d84"; } }
            const btn = document.getElementById('btn-start'); if (this.setupSlots.length === 3) { btn.style.display = 'inline-block'; } else { btn.style.display = 'none'; }
        });
    }

    handleRightClick(mx, my, hex) {
        const warnModal = document.getElementById('warning-modal');
        if (warnModal && warnModal.style.display === 'block') {
            const cancelBtn = document.getElementById('warn-cancel');
            if (cancelBtn) cancelBtn.click();
            return;
        }
        if (this.interactionMode !== 'SELECT') {
            this.setMode('SELECT'); 
            if (this.selectedUnit && this.selectedUnit.team === 'player') {
                this.ui.showActionMenu(this.selectedUnit, mx, my);
                if(window.Sfx) Sfx.play('click');
            }
        } else if (hex) {
            this.showContext(mx, my, hex);
        }
    }

    swapEquipment(src, tgt) {
        const u = this.selectedUnit; if(!u || u.team !== 'player') return;
        const getItem = (loc) => { if(loc.type === 'main') return u.hands; if(loc.type === 'bag') return u.bag[loc.index]; return null; };
        const setItem = (loc, item) => { if(loc.type === 'main') u.hands = item; if(loc.type === 'bag') u.bag[loc.index] = item; };
        const item1 = getItem(src); const item2 = getItem(tgt);
        setItem(src, item2); setItem(tgt, item1);
        this.updateSidebar(); if(window.Sfx) Sfx.play('click'); this.log(`${u.name} 装備変更`);
    }

    toggleFireMode() {
        const u = this.selectedUnit; if (!u || !u.hands || !u.hands.modes) return;
        const modes = u.hands.modes; const currentBurst = u.hands.burst;
        let nextIndex = modes.indexOf(currentBurst) + 1; if (nextIndex >= modes.length) nextIndex = 0;
        u.hands.burst = modes[nextIndex];
        if (window.Sfx) Sfx.play('click'); this.updateSidebar();
    }

    createSoldier(templateKey, team, q, r) {
        const t = UNIT_TEMPLATES[templateKey]; if (!t) return null;
        const isPlayer = (team === 'player'); 
        const stats = t.stats ? { ...t.stats } : { str:0, aim:0, mob:0, mor:0 };
        if (isPlayer && !t.isTank) { ['str', 'aim', 'mob', 'mor'].forEach(k => stats[k] = (stats[k] || 0) + Math.floor(Math.random() * 3) - 1); }
        let name = t.name; let rank = 0; let faceSeed = Math.floor(Math.random() * 99999);
        if (isPlayer && !t.isTank) { const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]; const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]; name = `${last} ${first}`; }
        const createItem = (key, isMainWpn = false) => {
            if (!key || !WPNS[key]) return null; let base = WPNS[key]; let item = { ...base, code: key, id: Math.random(), isBroken: false };
            if (base.type === 'bullet' || base.type === 'shell_fast') {
                if (isMainWpn && typeof MAG_VARIANTS !== 'undefined' && MAG_VARIANTS[key]) { const vars = MAG_VARIANTS[key]; const choice = vars[Math.floor(Math.random() * vars.length)]; item.cap = choice.cap; item.jam = choice.jam; item.magName = choice.name; }
                item.current = item.cap;
            } else if (base.type === 'shell' || base.area) { item.current = 1; item.isConsumable = true; }
            if (t.isTank && isMainWpn) { item.current = 1; item.cap = 1; item.reserve = 12; }
            return item;
        };
        let hands = null; let bag = [];
        if (t.main) hands = createItem(t.main, true); if (t.sub) bag.push(createItem(t.sub));
        if (t.opt) { const optBase = WPNS[t.opt]; const count = optBase.mag || 1; for (let i = 0; i < count; i++) bag.push(createItem(t.opt)); }
        if (hands && hands.mag && !hands.isConsumable && !t.isTank) { for (let i = 0; i < hands.mag; i++) { if (bag.length >= 4) break; bag.push({ type: 'ammo', name: (hands.magName || 'Clip'), ammoFor: hands.code, cap: hands.cap, jam: hands.jam, code: 'mag' }); } }
        if (!isPlayer) { if (hands) hands.current = 999; bag = []; }
        return { id: Math.random(), team: team, q: q, r: r, def: t, name: name, rank: rank, faceSeed: faceSeed, stats: stats, hp: t.hp || (80 + (stats.str || 0) * 5), maxHp: t.hp || (80 + (stats.str || 0) * 5), ap: t.ap || Math.floor((stats.mob || 0) / 2) + 3, maxAp: t.ap || Math.floor((stats.mob || 0) / 2) + 3, hands: hands, bag: bag, stance: 'stand', skills: [], sectorsSurvived: 0, deadProcessed: false, curWpn: hands ? hands.code : 'unarmed' };
    }

    getUnitsInHex(q, r) { return this.units.filter(u => u.q === q && u.r === r && u.hp > 0); }
    getUnitInHex(q, r) { return this.units.find(u => u.q === q && u.r === r && u.hp > 0); }
    getUnit(q, r) { return this.getUnitInHex(q, r); }

    startCampaign() {
        document.getElementById('setup-screen').style.display = 'none';
        if (typeof Renderer !== 'undefined' && Renderer.game) { const mainScene = Renderer.game.scene.getScene('MainScene'); if (mainScene) { mainScene.mapGenerated = false; if (mainScene.hexGroup && typeof mainScene.hexGroup.removeAll === 'function') mainScene.hexGroup.removeAll(); if (window.EnvSystem) window.EnvSystem.clear(); } }
        if(typeof Renderer !== 'undefined') Renderer.resize(); 
        this.selectedUnit = null; this.reachableHexes = []; this.attackLine = []; this.aimTargetUnit = null; this.path = []; this.cardsUsed = 0;
        this.units = this.units.filter(u => u.team === 'player' && u.hp > 0); this.units.forEach(u => { u.q = -999; u.r = -999; });
        this.generateMap();
        if (this.units.length === 0) { this.setupSlots.forEach(k => { const p = this.getSafeSpawnPos('player'); const u = this.createSoldier(k, 'player', p.q, p.r); this.units.push(u); }); } else { this.units.forEach(u => { const p = this.getSafeSpawnPos('player'); u.q = p.q; u.r = p.r; }); }
        this.spawnEnemies(); 
        this.state = 'PLAY'; this.log(`SECTOR ${this.sector} START`);
        document.getElementById('sector-counter').innerText = `SECTOR: ${this.sector.toString().padStart(2, '0')}`;
        if (typeof Renderer !== 'undefined') Renderer.centerMap();
        setTimeout(() => { if (typeof Renderer !== 'undefined' && Renderer.dealCards) Renderer.dealCards(['rifleman', 'tank_pz4', 'gunner', 'scout', 'tank_tiger']); }, 500);
    }

    getSafeSpawnPos(team) {
        const cy = Math.floor(MAP_H / 2);
        for (let i = 0; i < 100; i++) { const q = Math.floor(Math.random() * MAP_W); const r = Math.floor(MAP_H / 2 + (team==='player'?2:-2) + Math.floor(Math.random()*4-2)); if (this.isValidHex(q, r) && this.getUnitsInHex(q, r).length < 4 && this.map[q][r].id !== -1 && this.map[q][r].id !== 5) { return { q, r }; } }
        return { q: Math.floor(MAP_W/2), r: Math.floor(MAP_H/2) };
    }

    spawnAtSafeGround(team, type) { const p = this.getSafeSpawnPos(team); const u = this.createSoldier(type, team, p.q, p.r); if (u) { this.units.push(u); this.log(`増援合流: ${u.name}`); } }

    checkDeploy(targetHex) {
        if(!this.isValidHex(targetHex.q, targetHex.r) || this.map[targetHex.q][targetHex.r].id === -1) { this.log("配置不可: マップ外です"); return false; }
        if(this.map[targetHex.q][targetHex.r].id === 5) { this.log("配置不可: 水上です"); return false; }
        if (this.getUnitsInHex(targetHex.q, targetHex.r).length >= 4) { this.log("配置不可: 混雑しています"); return false; }
        if (this.cardsUsed >= 2) { this.log("配置不可: コスト上限です"); return false; }
        return true;
    }
    deployUnit(targetHex, cardType) {
        if(!this.checkDeploy(targetHex)) return;
        const u = this.createSoldier(cardType, 'player', targetHex.q, targetHex.r);
        if(u) { this.units.push(u); this.cardsUsed++; this.log(`増援到着: ${u.name}`); if(window.VFX) { const pos = Renderer.hexToPx(targetHex.q, targetHex.r); window.VFX.addSmoke(pos.x, pos.y); } this.updateSidebar(); }
    }

    onUnitClick(u) {
        if (this.state !== 'PLAY') return;
        if (u.team === 'player') {
            if (this.interactionMode !== 'SELECT') this.setMode('SELECT');
            this.selectedUnit = u; this.refreshUnitState(u); 
            if (typeof Renderer !== 'undefined' && Renderer.game) { const pointer = Renderer.game.input.activePointer; this.ui.showActionMenu(u, pointer.x, pointer.y); }
            if (window.Sfx) Sfx.play('click');
        } else {
            // 敵をクリックした場合は情報のみ表示（操作メニューは出さない）
            if (this.interactionMode === 'ATTACK' && this.selectedUnit && this.selectedUnit.team === 'player') { this.actionAttack(this.selectedUnit, u); return; }
            if (this.interactionMode === 'MELEE' && this.selectedUnit && this.selectedUnit.team === 'player') { this.actionMelee(this.selectedUnit, u); this.setMode('SELECT'); return; }
            this.selectedUnit = u; this.refreshUnitState(u); this.hideActionMenu();
        }
    }

    showActionMenu(u) { }
    hideActionMenu() { this.ui.hideActionMenu(); }

    setMode(mode) {
        this.interactionMode = mode; this.hideActionMenu(); const indicator = document.getElementById('mode-label');
        if (mode === 'SELECT') { indicator.style.display = 'none'; this.path = []; this.attackLine = []; } 
        else { indicator.style.display = 'block'; indicator.innerText = mode + " MODE"; if (mode === 'MOVE') { this.calcReachableHexes(this.selectedUnit); } }
    }

    calcReachableHexes(u) {
        this.reachableHexes = []; if (!u || u.team !== 'player') return;
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
        if (this.state !== 'PLAY') return; 
        const u = this.getUnitInHex(p.q, p.r);
        if (this.interactionMode === 'SELECT') { if (!u) this.clearSelection(); } 
        else if (this.interactionMode === 'MOVE') { 
            if (this.selectedUnit && this.isValidHex(p.q, p.r) && this.path.length > 0) { 
                const last = this.path[this.path.length - 1]; if (last.q === p.q && last.r === p.r) { this.actionMove(this.selectedUnit, this.path); this.setMode('SELECT'); } 
            } else { this.setMode('SELECT'); } 
        } 
        else if (this.interactionMode === 'ATTACK' || this.interactionMode === 'MELEE') { 
            if (!u) { this.setMode('SELECT'); } 
            else if (u.team === this.selectedUnit.team) { this.onUnitClick(u); } 
            else { 
                if (this.interactionMode === 'ATTACK') this.actionAttack(this.selectedUnit, u);
                else { this.actionMelee(this.selectedUnit, u); this.setMode('SELECT'); }
            }
        }
    }

    handleHover(p) { if (this.state !== 'PLAY') return; this.hoverHex = p; const u = this.selectedUnit; if (u && u.team === 'player') { if (this.interactionMode === 'MOVE') { const isReachable = this.reachableHexes.some(h => h.q === p.q && h.r === p.r); if (isReachable) { this.path = this.findPath(u, p.q, p.r); } else { this.path = []; } } else if (this.interactionMode === 'ATTACK') { this.calcAttackLine(u, p.q, p.r); } } }
    refreshUnitState(u) { if (!u || u.hp <= 0) { this.selectedUnit = null; this.reachableHexes = []; this.attackLine = []; this.aimTargetUnit = null; } this.updateSidebar(); }
    clearSelection() { this.selectedUnit = null; this.reachableHexes = []; this.attackLine = []; this.aimTargetUnit = null; this.path = []; this.setMode('SELECT'); this.hideActionMenu(); this.updateSidebar(); }

    setStance(s) {
        const u = this.selectedUnit; if (!u || u.team !== 'player' || u.def.isTank) return; if (u.stance === s) return;
        let cost = (u.stance === 'prone' && (s === 'stand' || s === 'crouch')) ? 1 : 0;
        if (u.ap < cost) { this.log(`AP不足`); return; }
        u.ap -= cost; u.stance = s; this.refreshUnitState(u); this.hideActionMenu(); if (window.Sfx) Sfx.play('click');
    }
    toggleStance() { const u = this.selectedUnit; if (!u || u.team !== 'player') return; let next = 'stand'; if (u.stance === 'stand') next = 'crouch'; else if (u.stance === 'crouch') next = 'prone'; this.setStance(next); }

    reloadWeapon(isManual = false) {
        const u = this.selectedUnit; if (!u || u.team !== 'player') return; const w = u.hands; if (!w || w.isConsumable) return;
        if (u.def.isTank) {
            if (u.ap < 1 || w.reserve <= 0) return;
            u.ap -= 1; w.current = 1; w.reserve -= 1;
            if (window.Sfx) Sfx.play('reload'); this.refreshUnitState(u); if (isManual) this.hideActionMenu();
        } else {
            const cost = w.rld || 1; const magIdx = u.bag.findIndex(i => i && i.type === 'ammo' && i.ammoFor === w.code);
            if (u.ap < cost || magIdx === -1) return;
            u.bag[magIdx] = null; u.ap -= cost; w.current = w.cap; if (window.Sfx) Sfx.play('reload'); this.refreshUnitState(u); this.hideActionMenu();
        }
    }

    actionRepair() { const u = this.selectedUnit; if (!u || u.team !== 'player' || u.ap < 2 || !u.hands || !u.hands.isBroken) return; u.ap -= 2; u.hands.isBroken = false; if (window.Sfx) Sfx.play('reload'); this.refreshUnitState(u); this.hideActionMenu(); }
    actionHeal() { const u = this.selectedUnit; if (!u || u.team !== 'player' || u.ap < 2) return; const target = this.getUnitsInHex(u.q, u.r).filter(t => t.team === u.team && t.hp < t.maxHp).sort((a,b) => (a.hp/a.maxHp)-(b.hp/b.maxHp))[0]; if (!target) return; u.ap -= 2; target.hp = Math.min(target.maxHp, target.hp + 30); if (window.VFX) { const p = Renderer.hexToPx(u.q, u.r); window.VFX.add({ x: p.x, y: p.y - 20, vx: 0, vy: -1, life: 30, color: "#0f0", size: 4, type: 'spark' }); } this.refreshUnitState(u); this.hideActionMenu(); }

    async actionMelee(a, d) {
        if (!a || a.ap < 2) return; let bonusDmg = 0; if (a.def.isTank) { const subWpn = a.bag.find(i => i && i.type === 'bullet'); if (subWpn && subWpn.current > 0) { subWpn.current -= Math.min(subWpn.current, 5); bonusDmg = 35; } else bonusDmg = 15; }
        else { let best = (a.hands && a.hands.type === 'melee') ? a.hands : null; a.bag.forEach(item => { if (item && item.type === 'melee' && (!best || item.dmg > best.dmg)) best = item; }); if (best) bonusDmg = best.dmg; }
        a.ap -= 2; if (typeof Renderer !== 'undefined' && Renderer.playAttackAnim) Renderer.playAttackAnim(a, d);
        await new Promise(r => setTimeout(r, 300));
        d.hp -= (10 + (a.stats?.str || 0) * 3 + bonusDmg); if (window.Sfx) Sfx.play('hit');
        if (d.hp <= 0 && !d.deadProcessed) { d.deadProcessed = true; if (window.Sfx) Sfx.play('death'); if (window.VFX) { const p = Renderer.hexToPx(d.q, d.r); VFX.addUnitDebris(p.x, p.y); } if(this.checkWin()) return; }
        this.refreshUnitState(a); this.checkPhaseEnd();
    }

    async actionAttack(a, d) {
        if (!a || (a.team === 'player' && this.state !== 'PLAY')) return; const w = a.hands; if (!w || w.isBroken || (w.isConsumable && w.current <= 0)) return;
        if (!a.def.isTank && w.current <= 0) { const magIdx = a.bag.findIndex(i => i && i.type === 'ammo' && i.ammoFor === w.code); if (magIdx !== -1 && a.ap >= (w.rld || 1)) { a.ap -= (w.rld || 1); a.bag[magIdx] = null; w.current = w.cap; if (window.Sfx) Sfx.play('reload'); this.refreshUnitState(a); await new Promise(r => setTimeout(r, 600)); } else return; }
        if (a.def.isTank && w.current <= 0 && this.tankAutoReload) { if (w.reserve > 0 && a.ap >= 1) { a.ap -= 1; w.reserve--; w.current = 1; if (window.Sfx) Sfx.play('reload'); this.refreshUnitState(a); } else return; }
        if (w.current <= 0 || a.ap < w.ap || this.hexDist(a, d) > w.rng) return;
        a.ap -= w.ap; this.state = 'ANIM'; if (typeof Renderer !== 'undefined' && Renderer.playAttackAnim) Renderer.playAttackAnim(a, d);
        const shots = w.isConsumable ? 1 : Math.min(w.burst || 1, w.current);
        for (let i = 0; i < shots; i++) {
            if (d.hp <= 0) break; w.current--; this.updateSidebar();
            const sPos = Renderer.hexToPx(a.q, a.r); const ePos = Renderer.hexToPx(d.q, d.r); const isShell = w.type.includes('shell');
            if (window.Sfx) Sfx.play(isShell ? 'cannon' : 'shot');
            if (window.VFX) VFX.addProj({ x: sPos.x, y: sPos.y, sx: sPos.x, sy: sPos.y, ex: ePos.x, ey: ePos.y, type: w.type, speed: isShell ? 0.9 : 0.6, progress: 0, arcHeight: isShell ? 10 : 0, isTracer: true, onHit: () => { } });
            setTimeout(() => {
                if (d.hp <= 0) return; const hitChance = (a.stats?.aim || 0) * 2 + w.acc - (this.hexDist(a,d) * (w.acc_drop||5)) - this.map[d.q][d.r].cover;
                if (Math.random() * 100 < hitChance) { d.hp -= Math.floor(w.dmg * (1 + (a.stats?.str||0)*0.05) * (0.8 + Math.random()*0.4)); if (isShell && typeof Renderer !== 'undefined') Renderer.playExplosion(ePos.x, ePos.y); if (window.Sfx) Sfx.play('ricochet'); }
            }, isShell ? 100 : this.hexDist(a,d)*30);
            await new Promise(r => setTimeout(r, isShell ? 200 : 60));
        }
        if (w.isConsumable && w.current <= 0) a.hands = null;
        setTimeout(() => { if (d.hp <= 0 && !d.deadProcessed) { d.deadProcessed = true; if (window.Sfx) Sfx.play('death'); if (window.VFX) { const p = Renderer.hexToPx(d.q, d.r); VFX.addUnitDebris(p.x, p.y); } if(this.checkWin()) return; }
            this.state = 'PLAY'; if(a.def.isTank && w && w.current === 0 && w.reserve > 0 && this.tankAutoReload && a.ap >= 1) this.reloadWeapon();
            this.refreshUnitState(a); if (!(a.ap >= (w?w.ap:0))) { this.setMode('SELECT'); this.checkPhaseEnd(); }
        }, 800);
    }

    calcAttackLine(u, targetQ, targetR) {
        this.attackLine = []; this.aimTargetUnit = null; if (!u || !u.hands) return;
        const range = u.hands.rng; const dist = this.hexDist(u, { q: targetQ, r: targetR }); if (dist === 0) return;
        const start = this.axialToCube(u.q, u.r); const end = this.axialToCube(targetQ, targetR);
        for (let i = 1; i <= Math.min(dist, range); i++) {
            const t = i / dist; const lerp = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t, z: start.z + (end.z - start.z) * t };
            const hex = this.cubeToAxial(this.cubeRound(lerp)); if (this.isValidHex(hex.q, hex.r)) this.attackLine.push(hex);
        }
        if (this.attackLine.length > 0) { const last = this.attackLine[this.attackLine.length - 1]; if (last.q === targetQ && last.r === targetR) this.aimTargetUnit = this.getUnitInHex(last.q, last.r); }
    }

    // ★以前の高品質なアルゴリズムを復旧
    generateMap() {
        this.map = []; for (let q = 0; q < MAP_W; q++) { this.map[q] = []; for (let r = 0; r < MAP_H; r++) { this.map[q][r] = TERRAIN.VOID; } }
        const cx = Math.floor(MAP_W / 2), cy = Math.floor(MAP_H / 2);
        let walkers = [{ q: cx, r: cy }];
        const paintBrush = (cq, cr) => { [{ q: cq, r: cr }, ...this.getNeighbors(cq, cr)].forEach(h => { if (this.isValidHex(h.q, h.r)) this.map[h.q][h.r] = TERRAIN.GRASS; }); };
        for (let i = 0; i < 140; i++) {
            const wIdx = Math.floor(Math.random() * walkers.length); const w = walkers[wIdx]; paintBrush(w.q, w.r);
            const dir = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]][Math.floor(Math.random() * 6)];
            const next = { q: w.q + dir[0], r: w.r + dir[1] };
            if (Math.random() < 0.05 && walkers.length < 5) walkers.push(next); else walkers[wIdx] = next;
        }
        // スムージング（穴埋め）
        for (let i = 0; i < 3; i++) { for (let q = 1; q < MAP_W - 1; q++) { for (let r = 1; r < MAP_H - 1; r++) { if (this.map[q][r].id === -1) { if (this.getNeighbors(q, r).filter(n => this.map[n.q][n.r].id !== -1).length >= 4) this.map[q][r] = TERRAIN.GRASS; } } } }
        // 水域生成
        for (let loop = 0; loop < 2; loop++) { const wC = []; for (let q = 0; q < MAP_W; q++) { for (let r = 0; r < MAP_H; r++) { if (this.map[q][r].id === -1 && this.getNeighbors(q, r).some(n => this.map[n.q][n.r].id !== -1)) wC.push({ q, r }); } } wC.forEach(w => { this.map[w.q][w.r] = TERRAIN.WATER; }); }
        // バイオーム適用
        for (let q = 0; q < MAP_W; q++) { for (let r = 0; r < MAP_H; r++) { if (this.map[q][r].id !== -1 && this.map[q][r].id !== 5) { const n = Math.sin(q * 0.4) + Math.cos(r * 0.4) + Math.random() * 0.4; if (n > 1.1) this.map[q][r] = TERRAIN.FOREST; else if (n < -0.9) this.map[q][r] = TERRAIN.DIRT; if (Math.random() < 0.05) this.map[q][r] = TERRAIN.TOWN; } } }
    }

    spawnEnemies() { for (let i = 0; i < 4 + Math.floor(this.sector * 0.7); i++) { let k = 'rifleman'; const r = Math.random(); if (r < 0.1 + this.sector * 0.1) k = 'tank_pz4'; else if (r < 0.4) k = 'gunner'; const p = this.getSafeSpawnPos('enemy'); const e = this.createSoldier(k, 'enemy', p.q, p.r); if (e) this.units.push(e); } }
    toggleAuto() { this.isAuto = !this.isAuto; document.getElementById('auto-toggle').classList.toggle('active'); }
    async actionMove(u, p) { this.state = 'ANIM'; for (let s of p) { u.ap -= this.map[s.q][s.r].cost; u.q = s.q; u.r = s.r; if (window.Sfx) Sfx.play('move'); await new Promise(r => setTimeout(r, 180)); } this.checkReactionFire(u); this.state = 'PLAY'; this.refreshUnitState(u); this.checkPhaseEnd(); }
    checkReactionFire(u) { this.units.filter(e => e.team !== u.team && e.hp > 0 && e.def.isTank && this.hexDist(u, e) <= 1).forEach(t => { u.hp -= 15; if (window.Sfx) Sfx.play('mg'); if (u.hp <= 0 && !u.deadProcessed) { u.deadProcessed = true; if (window.Sfx) Sfx.play('death'); } }); }
    checkPhaseEnd() { if (this.units.filter(u => u.team === 'player' && u.hp > 0 && u.ap > 0).length === 0 && this.state === 'PLAY') this.endTurn(); }
    endTurn() { if (this.isProcessingTurn) return; this.isProcessingTurn = true; this.setMode('SELECT'); this.hideActionMenu(); this.state = 'ANIM'; document.getElementById('eyecatch').style.opacity = 1; setTimeout(async () => { document.getElementById('eyecatch').style.opacity = 0; await this.ai.executeTurn(this.units); this.units.forEach(u => { if (u.team === 'player') u.ap = u.maxAp; }); this.log("-- PLAYER PHASE --"); this.state = 'PLAY'; this.isProcessingTurn = false; }, 1200); }
    promoteSurvivors() { this.units.filter(u => u.team === 'player' && u.hp > 0).forEach(u => { u.rank = Math.min(6, (u.rank||0)+1); u.maxHp += 30; u.hp += 30; }); }
    checkWin() { if (this.units.filter(u => u.team === 'enemy' && u.hp > 0).length === 0) { if (window.Sfx) Sfx.play('win'); document.getElementById('reward-screen').style.display = 'flex'; this.promoteSurvivors(); const b = document.getElementById('reward-cards'); b.innerHTML = ''; [{ k: 'rifleman', t: '新兵' }, { k: 'tank_pz4', t: '戦車' }].forEach(o => { const d = document.createElement('div'); d.className = 'card'; d.innerHTML = `<div class="card-body"><h3>${o.t}</h3></div>`; d.onclick = () => { this.spawnAtSafeGround('player', o.k); this.sector++; document.getElementById('reward-screen').style.display = 'none'; this.startCampaign(); }; b.appendChild(d); }); return true; } return false; }
    isValidHex(q, r) { return q >= 0 && q < MAP_W && r >= 0 && r < MAP_H; }
    hexDist(a, b) { return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2; }
    getNeighbors(q, r) { return [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]].map(d => ({ q: q + d[0], r: r + d[1] })).filter(h => this.isValidHex(h.q, h.r)); }
    findPath(u, tq, tr) { let f = [{ q: u.q, r: u.r }], cf = {}, cs = {}; cf[`${u.q},${u.r}`] = null; cs[`${u.q},${u.r}`] = 0; while (f.length > 0) { let c = f.shift(); if (c.q === tq && c.r === tr) break; this.getNeighbors(c.q, c.r).forEach(n => { const cost = this.map[n.q][n.r].cost; if (cost >= 99) return; const nc = cs[`${c.q},${c.r}`] + cost; if (nc <= u.ap) { const k = `${n.q},${n.r}`; if (!(k in cs) || nc < cs[k]) { cs[k] = nc; f.push(n); cf[k] = c; } } }); } let p = [], c = { q: tq, r: tr }; if (!cf[`${tq},${tr}`]) return []; while (c) { if (c.q === u.q && c.r === u.r) break; p.push(c); c = cf[`${c.q},${c.r}`]; } return p.reverse(); }
    showContext(mx, my, hex) { this.ui.showContext(mx, my, hex); }
    updateSidebar() { this.ui.updateSidebar(this.selectedUnit, this.state, this.tankAutoReload); }
    axialToCube(q, r) { return { x: q, y: r, z: -q - r }; }
    cubeToAxial(c) { return { q: c.x, r: c.y }; }
    cubeRound(c) { let rx = Math.round(c.x), ry = Math.round(c.y), rz = Math.round(c.z); const x_diff = Math.abs(rx - c.x), y_diff = Math.abs(ry - c.y), z_diff = Math.abs(rz - c.z); if (x_diff > y_diff && x_diff > z_diff) rx = -ry - rz; else if (y_diff > z_diff) ry = -rx - rz; else rz = -rx - ry; return { x: rx, y: ry, z: rz }; }
}
window.gameLogic = new Game();

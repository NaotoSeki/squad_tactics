/** LOGIC GAME: Auto Mode Logic Implemented */

const AVAILABLE_CARDS = ['rifleman', 'tank_pz4', 'aerial', 'scout', 'tank_tiger', 'gunner', 'sniper'];

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
        if (typeof MapSystem !== 'undefined') {
            this.mapSystem = new MapSystem(this);
        } else {
            console.error("MapSystem not found! Make sure logic_map.js is loaded.");
        }
        this.ai = new EnemyAI(this);

        this.initDOM();
        this.initSetup();
    }

    initDOM() {
        if (typeof Renderer !== 'undefined') {
            Renderer.init(document.getElementById('game-view'));
        }
    }

    toggleSidebar() { this.ui.toggleSidebar(); }
    toggleTankAutoReload() { 
        this.tankAutoReload = !this.tankAutoReload; 
        this.updateSidebar(); 
    }
    log(m) { this.ui.log(m); }

    // --- DELEGATED MAP METHODS (Wrapper) ---
    generateMap() { if(this.mapSystem) this.mapSystem.generate(); }
    isValidHex(q, r) { return this.mapSystem ? this.mapSystem.isValidHex(q, r) : false; }
    hexDist(a, b) { return this.mapSystem ? this.mapSystem.hexDist(a, b) : 0; }
    getNeighbors(q, r) { return this.mapSystem ? this.mapSystem.getNeighbors(q, r) : []; }
    findPath(u, tq, tr) { return this.mapSystem ? this.mapSystem.findPath(u, tq, tr) : []; }
    calcAttackLine(u, tq, tr) {
        if (!this.mapSystem) return;
        this.attackLine = this.mapSystem.calcAttackLine(u, tq, tr);
        if (this.attackLine.length > 0) { 
            const last = this.attackLine[this.attackLine.length - 1]; 
            if (last.q === tq && last.r === tr) { 
                const target = this.getUnitInHex(last.q, last.r); 
                if (target && target.team !== u.team) { this.aimTargetUnit = target; } 
                else { this.aimTargetUnit = null; }
            } else { this.aimTargetUnit = null; }
        } else { this.aimTargetUnit = null; }
    }
    // ---------------------------------------

    applyDamage(target, damage, sourceName = "攻撃") {
        if (!target || target.hp <= 0) return;
        target.hp -= damage;
        
        if (target.hp <= 0 && !target.deadProcessed) {
            target.deadProcessed = true;
            this.log(`>> ${target.name} を撃破！`);
            if (window.Sfx) { Sfx.play('death'); }
            if (window.VFX) { const p = Renderer.hexToPx(target.q, target.r); VFX.addUnitDebris(p.x, p.y); }
            
            if (target.team === 'enemy') {
                this.checkWin();
            } else {
                this.checkLose();
            }
        }
    }

    initSetup() {
        this.setupSlots = [];
        this.ui.renderSetupCards(this.setupSlots, (k, domEl) => {
            const idx = this.setupSlots.indexOf(k);
            if (idx >= 0) { 
                this.setupSlots.splice(idx, 1); 
                domEl.classList.remove('selected'); 
                domEl.querySelector('.card-badge').style.display = 'none'; 
                domEl.style.borderColor = "#555"; 
            } else { 
                if (this.setupSlots.length < 3) { 
                    this.setupSlots.push(k); 
                    domEl.classList.add('selected'); 
                    domEl.querySelector('.card-badge').style.display = 'flex'; 
                    domEl.style.borderColor = "#d84"; 
                } 
            }
            const btn = document.getElementById('btn-start'); 
            if (this.setupSlots.length === 3) { 
                btn.style.display = 'inline-block'; 
            } else { 
                btn.style.display = 'none'; 
            }
        });
    }

    handleRightClick(mx, my, hex) {
        if (!hex && typeof Renderer !== 'undefined') {
            hex = Renderer.pxToHex(mx, my);
        }
        if (this.interactionMode !== 'SELECT') {
            this.setMode('SELECT'); 
            if (this.selectedUnit && this.selectedUnit.team === 'player') {
                this.ui.showActionMenu(this.selectedUnit, mx, my);
                if (window.Sfx) { Sfx.play('click'); }
            }
            return;
        }
        if (this.selectedUnit) {
            this.clearSelection();
            if (window.Sfx) { Sfx.play('click'); }
        } else {
            if (hex) { this.showContext(mx, my, hex); }
        }
    }

    swapEquipment(src, tgt) {
        const u = this.selectedUnit;
        if (!u || u.team !== 'player') { return; }
        const getItem = (loc) => { if (loc.type === 'main') return u.hands; if (loc.type === 'bag') return u.bag[loc.index]; return null; };
        const setItem = (loc, item) => { if (loc.type === 'main') u.hands = item; if (loc.type === 'bag') u.bag[loc.index] = item; };
        const item1 = getItem(src); const item2 = getItem(tgt);
        setItem(src, item2); setItem(tgt, item1);
        this.updateSidebar();
        if (window.Sfx) { Sfx.play('click'); }
        this.log(`${u.name} 装備変更`);
    }

    toggleFireMode() {
        const u = this.selectedUnit;
        if (!u || !u.hands || !u.hands.modes) { return; }
        const modes = u.hands.modes; 
        const currentBurst = u.hands.burst;
        let nextIndex = modes.indexOf(currentBurst) + 1;
        if (nextIndex >= modes.length) { nextIndex = 0; }
        u.hands.burst = modes[nextIndex];
        if (window.Sfx) { Sfx.play('click'); }
        this.updateSidebar();
    }

    createSoldier(templateKey, team, q, r) {
        const t = UNIT_TEMPLATES[templateKey]; if (!t) { return null; }
        const isPlayer = (team === 'player'); 
        const stats = t.stats ? { ...t.stats } : { str:0, aim:0, mob:0, mor:0 };
        if (isPlayer && !t.isTank) { 
            ['str', 'aim', 'mob', 'mor'].forEach(k => {
                stats[k] = (stats[k] || 0) + Math.floor(Math.random() * 3) - 1;
            });
        }
        let name = t.name; 
        let rank = 0; 
        let faceSeed = Math.floor(Math.random() * 99999);
        if (isPlayer && !t.isTank) { 
            const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]; 
            const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]; 
            name = `${last} ${first}`; 
        }
        const createItem = (key, isMainWpn = false) => {
            if (!key || !WPNS[key]) { return null; }
            let base = WPNS[key]; 
            let item = { ...base, code: key, id: Math.random(), isBroken: false };
            if (base.type === 'bullet' || base.type === 'shell_fast') {
                if (isMainWpn && typeof MAG_VARIANTS !== 'undefined' && MAG_VARIANTS[key]) { 
                    const vars = MAG_VARIANTS[key]; 
                    const choice = vars[Math.floor(Math.random() * vars.length)]; 
                    item.cap = choice.cap; item.jam = choice.jam; item.magName = choice.name; 
                }
                item.current = item.cap;
            } else if (base.type === 'shell' || base.area) { 
                item.current = 1; item.isConsumable = true; 
            }
            if (t.isTank && isMainWpn) { item.current = 1; item.cap = 1; item.reserve = 12; }
            return item;
        };
        let hands = null; let bag = [];
        if (t.main) { hands = createItem(t.main, true); }
        if (t.sub) { bag.push(createItem(t.sub)); }
        if (t.opt) { 
            const optBase = WPNS[t.opt]; const count = optBase.mag || 1; 
            for (let i = 0; i < count; i++) { bag.push(createItem(t.opt)); }
        }
        if (hands && hands.mag && !hands.isConsumable && !t.isTank) { 
            for (let i = 0; i < hands.mag; i++) { 
                if (bag.length >= 4) { break; }
                bag.push({ type: 'ammo', name: (hands.magName || 'Clip'), ammoFor: hands.code, cap: hands.cap, jam: hands.jam, code: 'mag' }); 
            } 
        }
        if (!isPlayer) { if (hands) { hands.current = 999; } bag = []; }
        return { id: Math.random(), team: team, q: q, r: r, def: t, name: name, rank: rank, faceSeed: faceSeed, stats: stats, hp: t.hp || (80 + (stats.str || 0) * 5), maxHp: t.hp || (80 + (stats.str || 0) * 5), ap: t.ap || Math.floor((stats.mob || 0) / 2) + 3, maxAp: t.ap || Math.floor((stats.mob || 0) / 2) + 3, hands: hands, bag: bag, stance: 'stand', skills: [], sectorsSurvived: 0, deadProcessed: false, curWpn: hands ? hands.code : 'unarmed' };
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
                if (mainScene.hexGroup && typeof mainScene.hexGroup.removeAll === 'function') { mainScene.hexGroup.removeAll(); }
                if (window.EnvSystem) { window.EnvSystem.clear(); }
            } 
        }
        if(typeof Renderer !== 'undefined') { Renderer.resize(); }
        this.selectedUnit = null; this.reachableHexes = []; this.attackLine = []; this.aimTargetUnit = null; this.path = []; this.cardsUsed = 0;
        this.units = this.units.filter(u => u.team === 'player' && u.hp > 0); 
        this.units.forEach(u => { u.q = -999; u.r = -999; });
        
        this.generateMap(); 
        
        if (this.units.length === 0) { 
            this.setupSlots.forEach(k => { 
                const p = this.getSafeSpawnPos('player'); 
                const u = this.createSoldier(k, 'player', p.q, p.r); 
                this.units.push(u); 
            }); 
        } else { 
            this.units.forEach(u => { 
                const p = this.getSafeSpawnPos('player'); 
                u.q = p.q; u.r = p.r; 
            }); 
        }
        this.spawnEnemies(); 
        this.state = 'PLAY'; this.log(`SECTOR ${this.sector} START`);
        document.getElementById('sector-counter').innerText = `SECTOR: ${this.sector.toString().padStart(2, '0')}`;
        
        if (typeof Renderer !== 'undefined') { Renderer.centerMap(); }
        
        setTimeout(() => { 
            if (typeof Renderer !== 'undefined' && Renderer.dealCards) { 
                const deck = [];
                for(let i=0; i<5; i++) {
                    const randType = AVAILABLE_CARDS[Math.floor(Math.random() * AVAILABLE_CARDS.length)];
                    deck.push(randType);
                }
                Renderer.dealCards(deck); 
            }
            // ★AutoモードがONなら初回ターンも自動開始
            if (this.isAuto) this.runAuto();
        }, 500);
    }

    getSafeSpawnPos(team) {
        const cy = Math.floor(MAP_H / 2);
        for (let i = 0; i < 100; i++) { 
            const q = Math.floor(Math.random() * MAP_W); 
            const r = Math.floor(Math.random() * MAP_H); 
            if (team === 'player' && r < cy) { continue; }
            if (team === 'enemy' && r >= cy) { continue; }
            if (this.isValidHex(q, r) && this.getUnitsInHex(q, r).length < 4 && this.map[q][r].id !== -1 && this.map[q][r].id !== 5) { return { q, r }; } 
        }
        return { q: 0, r: 0 };
    }

    spawnAtSafeGround(team, type) {
        const p = this.getSafeSpawnPos(team);
        const u = this.createSoldier(type, team, p.q, p.r);
        if (u) {
            u.q = p.q; u.r = p.r;
            this.units.push(u);
            this.log(`増援合流: ${u.name}`);
        }
    }

    async triggerBombardment(centerHex) {
        if (!this.isValidHex(centerHex.q, centerHex.r)) { return; }
        this.log(`>> 航空支援要請: 座標 ${centerHex.q},${centerHex.r} への爆撃を開始します`);
        const neighbors = this.getNeighbors(centerHex.q, centerHex.r);
        const targets = [centerHex, ...neighbors];
        const validTargets = targets.filter(h => this.isValidHex(h.q, h.r));
        const hits = []; const pool = [...validTargets];
        for (let i = 0; i < 3; i++) { if (pool.length === 0) break; const idx = Math.floor(Math.random() * pool.length); hits.push(pool[idx]); pool.splice(idx, 1); }
        for (const hex of hits) {
            const pos = Renderer.hexToPx(hex.q, hex.r);
            const delay = Math.random() * 800;
            setTimeout(() => {
                if (window.Sfx) { Sfx.play('cannon'); }
                if (typeof Renderer !== 'undefined') { Renderer.playExplosion(pos.x, pos.y); }
                const units = this.getUnitsInHex(hex.q, hex.r);
                units.forEach(u => {
                    this.log(`>> 爆撃命中: ${u.name} に 350 ダメージ`);
                    this.applyDamage(u, 350, "爆撃");
                });
                this.updateSidebar();
                if (window.VFX) { VFX.addSmoke(pos.x, pos.y); }
            }, delay);
        }
    }

    checkDeploy(targetHex) {
        if(!this.isValidHex(targetHex.q, targetHex.r) || this.map[targetHex.q][targetHex.r].id === -1) { this.log("配置不可: 進入不可能な地形です"); return false; }
        if(this.map[targetHex.q][targetHex.r].id === 5) { this.log("配置不可: 水上には配置できません"); return false; }
        if (this.getUnitsInHex(targetHex.q, targetHex.r).length >= 4) { this.log("配置不可: 混雑しています"); return false; }
        if (this.cardsUsed >= 2) { this.log("配置不可: 指揮コスト上限(2/2)に達しています"); return false; }
        return true;
    }
    deployUnit(targetHex, cardType) {
        if(!this.checkDeploy(targetHex)) { return; }
        const u = this.createSoldier(cardType, 'player', targetHex.q, targetHex.r);
        if(u) { 
            this.units.push(u); this.cardsUsed++; 
            this.log(`増援到着: ${u.name} (残コスト:${2-this.cardsUsed})`); 
            if(window.VFX) { const pos = Renderer.hexToPx(targetHex.q, targetHex.r); window.VFX.addSmoke(pos.x, pos.y); } 
            this.updateSidebar(); 
        }
    }

    onUnitClick(u) {
        if (this.state !== 'PLAY') { return; }
        if (u.team === 'player') {
            if (this.interactionMode !== 'SELECT') { this.setMode('SELECT'); }
            this.selectedUnit = u; this.refreshUnitState(u); 
            if (typeof Renderer !== 'undefined' && Renderer.game) { 
                const pointer = Renderer.game.input.activePointer; 
                this.ui.showActionMenu(u, pointer.x, pointer.y);
            }
            if (window.Sfx) { Sfx.play('click'); }
            return;
        }
        if (this.interactionMode === 'ATTACK' && this.selectedUnit && this.selectedUnit.team === 'player') { 
            this.actionAttack(this.selectedUnit, u); return; 
        }
        if (this.interactionMode === 'MELEE' && this.selectedUnit && this.selectedUnit.team === 'player') { 
            this.actionMelee(this.selectedUnit, u); this.setMode('SELECT'); return; 
        }
        this.selectedUnit = u; this.refreshUnitState(u); this.hideActionMenu();
    }

    showActionMenu(u) { }
    hideActionMenu() { this.ui.hideActionMenu(); }

    setMode(mode) {
        this.interactionMode = mode; this.hideActionMenu(); 
        const indicator = document.getElementById('mode-label');
        if (mode === 'SELECT') { indicator.style.display = 'none'; this.path = []; this.attackLine = []; } 
        else { 
            indicator.style.display = 'block'; indicator.innerText = mode + " MODE"; 
            if (mode === 'MOVE') { this.calcReachableHexes(this.selectedUnit); } 
            else if (mode === 'ATTACK') { this.reachableHexes = []; } 
        }
    }

    calcReachableHexes(u) {
        this.reachableHexes = []; if (!u) { return; }
        let frontier = [{ q: u.q, r: u.r, cost: 0 }], costSoFar = new Map(); costSoFar.set(`${u.q},${u.r}`, 0);
        while (frontier.length > 0) {
            let current = frontier.shift();
            this.getNeighbors(current.q, current.r).forEach(n => {
                if (this.getUnitsInHex(n.q, n.r).length >= 4) { return; }
                const cost = this.map[n.q][n.r].cost; if (cost >= 99) { return; }
                const nc = costSoFar.get(`${current.q},${current.r}`) + cost;
                if (nc <= u.ap) { 
                    const key = `${n.q},${n.r}`; 
                    if (!costSoFar.has(key) || nc < costSoFar.get(key)) { costSoFar.set(key, nc); frontier.push({ q: n.q, r: n.r }); this.reachableHexes.push({ q: n.q, r: n.r }); } 
                }
            });
        }
    }

    handleClick(p) {
        if (this.state !== 'PLAY') { return; } 
        if (this.interactionMode === 'SELECT') { this.clearSelection(); } 
        else if (this.interactionMode === 'MOVE') { 
            if (this.selectedUnit && this.isValidHex(p.q, p.r) && this.path.length > 0) { 
                const last = this.path[this.path.length - 1]; 
                if (last.q === p.q && last.r === p.r) { this.actionMove(this.selectedUnit, this.path); this.setMode('SELECT'); } 
            } else { this.setMode('SELECT'); } 
        } 
        else if (this.interactionMode === 'ATTACK' || this.interactionMode === 'MELEE') { this.setMode('SELECT'); }
    }

    handleHover(p) {
        if (this.state !== 'PLAY') { return; } 
        this.hoverHex = p; const u = this.selectedUnit;
        if (u && u.team === 'player') { 
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
        const u = this.selectedUnit; if (!u || u.def.isTank) { return; } 
        if (u.stance === s) { return; }
        let cost = 0; if (u.stance === 'prone' && (s === 'stand' || s === 'crouch')) { cost = 1; }
        if (u.ap < cost) { this.log(`AP不足`); return; }
        u.ap -= cost; u.stance = s; this.refreshUnitState(u); this.hideActionMenu(); if (window.Sfx) { Sfx.play('click'); }
    }
    toggleStance() { const u = this.selectedUnit; if (!u) { return; } let next = 'stand'; if (u.stance === 'stand') { next = 'crouch'; } else if (u.stance === 'crouch') { next = 'prone'; } this.setStance(next); }

    reloadWeapon(isManual = false) {
        const u = this.selectedUnit; if (!u) { return; } const w = u.hands;
        if (!w || w.isConsumable) { this.log("リロード不可"); return; }
        if (w.current >= w.cap) { this.log("装填済み"); return; }
        
        if (u.def.isTank) {
            if (u.ap < 1) { this.log("AP不足 (必要:1)"); return; }
            if (w.reserve <= 0) { this.log("予備弾薬なし"); return; }
            u.ap -= 1; w.current = 1; w.reserve -= 1;
            this.log(`${u.name} 次弾装填完了 (残:${w.reserve})`);
            if (window.Sfx) { Sfx.play('tank_reload'); } 
            this.refreshUnitState(u); if (isManual) { this.hideActionMenu(); } return;
        }
        const cost = w.rld || 1;
        if (u.ap < cost) { this.log(`AP不足 (必要:${cost})`); return; }
        const magIndex = u.bag.findIndex(i => i && i.type === 'ammo' && i.ammoFor === w.code);
        if (magIndex === -1) { this.log("予備弾薬なし"); return; }
        u.bag[magIndex] = null; u.ap -= cost; w.current = w.cap;
        this.log(`${u.name} リロード完了`); 
        if (window.Sfx) { Sfx.play('reload'); }
        this.refreshUnitState(u); this.hideActionMenu();
    }

    actionRepair() {
        const u = this.selectedUnit; if (!u || u.ap < 2) { this.log("AP不足 (必要:2)"); return; }
        if (!u.hands || !u.hands.isBroken) { this.log("修理不要"); return; }
        u.ap -= 2; u.hands.isBroken = false; this.log(`${u.name} 武器修理完了`); if (window.Sfx) { Sfx.play('reload'); } this.refreshUnitState(u); this.hideActionMenu();
    }

    actionHeal() {
        const u = this.selectedUnit; if (!u || u.ap < 2) { this.log("AP不足 (必要:2)"); return; }
        const targets = this.getUnitsInHex(u.q, u.r).filter(t => t.team === u.team && t.hp < t.maxHp);
        if (targets.length === 0) { this.log("治療対象なし"); return; }
        targets.sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp)); const target = targets[0]; 
        u.ap -= 2; const healAmount = 30; target.hp = Math.min(target.maxHp, target.hp + healAmount); 
        this.log(`${u.name} が ${target.name} を治療 (+${healAmount})`);
        if (window.VFX) { const p = Renderer.hexToPx(u.q, u.r); window.VFX.add({ x: p.x, y: p.y - 20, vx: 0, vy: -1, life: 30, maxLife: 30, color: "#0f0", size: 4, type: 'spark' }); }
        this.refreshUnitState(u); this.hideActionMenu();
    }

    actionMeleeSetup() { this.setMode('MELEE'); }

    async actionMelee(a, d) {
        if (!a || a.ap < 2) { this.log("AP不足"); return; }
        if (a.q !== d.q || a.r !== d.r) { this.log("射程外"); return; }
        let wpnName = "銃床"; let bonusDmg = 0;
        if (a.def.isTank) {
            wpnName = "同軸機銃"; const subWpn = a.bag.find(i => i && i.type === 'bullet'); 
            if (subWpn) {
                if (subWpn.current > 0) { const consume = Math.min(subWpn.current, 5); subWpn.current -= consume; bonusDmg = 35; this.log(`${a.name} 機銃掃射 (弾消費:${consume})`); this.updateSidebar(); } 
                else { wpnName = "轢き逃げ"; bonusDmg = 10; this.log(`${a.name} 弾切れ！履帯で攻撃`); }
            } else { wpnName = "体当たり"; bonusDmg = 15; }
        } else {
            let bestWeapon = null; if (a.hands && a.hands.type === 'melee') { bestWeapon = a.hands; }
            a.bag.forEach(item => { if (item && item.type === 'melee') { if (!bestWeapon || item.dmg > bestWeapon.dmg) { bestWeapon = item; } } });
            if (bestWeapon) { wpnName = bestWeapon.name; bonusDmg = bestWeapon.dmg; }
        }
        a.ap -= 2;
        this.log(`${a.name} 白兵攻撃(${wpnName}) vs ${d.name}`);
        if (typeof Renderer !== 'undefined' && Renderer.playAttackAnim) { Renderer.playAttackAnim(a, d); }
        await new Promise(r => setTimeout(r, 300));
        let strVal = (a.stats && a.stats.str) ? a.stats.str : 0; let totalDmg = 10 + (strVal * 3) + bonusDmg;
        if (d.skills.includes('CQC')) { this.log(`>> ${d.name} カウンター！`); this.applyDamage(a, 15, "カウンター"); }
        if (window.Sfx) { Sfx.play('hit'); }
        this.applyDamage(d, totalDmg, "白兵");
        this.refreshUnitState(a); this.checkPhaseEnd();
    }

    async actionAttack(a, d) {
        if (!a) { return; }
        if (a.team === 'player' && this.state !== 'PLAY') { return; }
        const w = a.hands; if (!w) { return; }
        if (w.isBroken) { this.log("武器故障中！修理が必要"); return; }
        if (w.isConsumable && w.current <= 0) { this.log("使用済みです"); return; }
        
        if (!a.def.isTank && w.current <= 0) {
            const magIndex = a.bag.findIndex(i => i && i.type === 'ammo' && i.ammoFor === w.code);
            if (magIndex !== -1) {
                const reloadCost = w.rld || 1;
                if (a.ap >= reloadCost) {
                    this.log(`${a.name} 自動リロード`); if (window.Sfx) { Sfx.play('reload'); }
                    a.bag[magIndex] = null; a.ap -= reloadCost; w.current = w.cap; this.refreshUnitState(a);
                    await new Promise(r => setTimeout(r, 600)); 
                    if(a.ap < w.ap) { this.log("AP不足により攻撃中止"); return; }
                } else { this.log(`AP不足でリロード不可 (必要:${reloadCost})`); return; }
            } else { this.log("弾切れ！予備弾薬なし"); return; }
        }
        
        let reloadedBeforeAttack = false; 
        if (a.def.isTank && w.current <= 0 && this.tankAutoReload) {
            if (w.reserve > 0) {
                const reloadCost = 1; 
                if (a.ap >= reloadCost) {
                    a.ap -= reloadCost; w.reserve--; w.current = 1;
                    this.log(`${a.name} 自動装填完了`); if (window.Sfx) { Sfx.play('tank_reload'); } 
                    this.refreshUnitState(a); reloadedBeforeAttack = true; 
                    if(a.ap < w.ap) { this.log("AP不足により攻撃中止"); return; }
                } else { this.log(`AP不足で自動装填不可 (必要:${reloadCost})`); return; }
            } else { this.log("予備弾薬切れ！"); return; }
        }

        if (w.current <= 0) { this.log("弾切れ！装填が必要だ！"); return; }
        if (a.ap < w.ap) { this.log("AP不足"); return; }
        
        const dist = this.hexDist(a, d); if (dist > w.rng) { this.log("射程外"); return; }
        a.ap -= w.ap; this.state = 'ANIM';
        if (typeof Renderer !== 'undefined' && Renderer.playAttackAnim) { Renderer.playAttackAnim(a, d); }
        
        const drop = w.acc_drop || 5; 
        let hitChance = (a.stats?.aim || 0) * 2 + w.acc - (dist * drop) - this.map[d.q][d.r].cover;
        if (d.stance === 'prone') { hitChance -= 20; }
        if (d.stance === 'crouch') { hitChance -= 10; }
        let dmgMod = 1.0 + (a.stats?.str || 0) * 0.05;
        
        const shots = w.isConsumable ? 1 : Math.min(w.burst || 1, w.current);
        this.log(`${a.name} 攻撃開始 (${w.name})`);
        
        for (let i = 0; i < shots; i++) {
            if (d.hp <= 0) { break; }
            if (!w.isConsumable && w.jam && Math.random() < w.jam) { this.log(`⚠ JAM!! ${w.name}が故障！`); w.isBroken = true; if (window.Sfx) { Sfx.play('ricochet'); } break; }
            w.current--;
            this.updateSidebar();
            
            const sPos = Renderer.hexToPx(a.q, a.r); const ePos = Renderer.hexToPx(d.q, d.r);
            const spread = (100 - w.acc) * 0.5; const tx = ePos.x + (Math.random() - 0.5) * spread; const ty = ePos.y + (Math.random() - 0.5) * spread;
            
            if (window.Sfx) { Sfx.play(w.code, w.type.includes('shell') ? 'cannon' : 'shot'); }
            const isShell = w.type.includes('shell'); const flightTime = isShell ? 100 : dist * 30; const isTracer = isShell || (i === 0 || i % 3 === 0);
            if (window.VFX) { VFX.addProj({ x: sPos.x, y: sPos.y, sx: sPos.x, sy: sPos.y, ex: tx, ey: ty, type: w.type, speed: isShell ? 0.9 : 0.6, progress: 0, arcHeight: isShell ? 10 : 0, isTracer: isTracer, onHit: () => { } }); }
            
            setTimeout(() => {
                if (d.hp <= 0) { return; }
                const isHit = (Math.random() * 100) < hitChance;
                if (isHit) {
                    let dmg = Math.floor(w.dmg * dmgMod * (0.8 + Math.random() * 0.4));
                    if (d.def.isTank && w.type === 'bullet') { dmg = 0; }
                    if (dmg > 0) {
                        if (typeof Renderer !== 'undefined' && Renderer.playExplosion && w.type.includes('shell')) { Renderer.playExplosion(tx, ty); }
                        else if (window.VFX) { VFX.addExplosion(tx, ty, "#f55", 5); }
                        if (window.Sfx) { Sfx.play('ricochet'); }
                        this.applyDamage(d, dmg, w.name);
                    } else {
                        if (window.VFX) { VFX.add({ x: tx, y: ty, vx: 0, vy: -5, life: 10, maxLife: 10, color: "#fff", size: 2, type: 'spark' }); }
                        if (i === 0) { this.log(">> 装甲により無効化！"); }
                    }
                } else { if (window.VFX) { VFX.add({ x: tx, y: ty, vx: 0, vy: 0, life: 10, maxLife: 10, color: "#aaa", size: 2, type: 'smoke' }); } }
            }, flightTime);
            await new Promise(r => setTimeout(r, isShell ? 200 : 60));
        }
        
        if (w.isConsumable && w.current <= 0) { a.hands = null; this.log(`${w.name} を消費しました`); }
        
        setTimeout(() => {
            this.state = 'PLAY'; 
            if(!reloadedBeforeAttack && a.def.isTank && w.current === 0 && w.reserve > 0 && this.tankAutoReload && a.ap >= 1) { this.reloadWeapon(); }
            this.refreshUnitState(a); 
            const cost = w ? w.ap : 0;
            const canShootAgain = (a.ap >= cost) && (w.current > 0 || (a.def.isTank && w.reserve > 0 && this.tankAutoReload && a.ap >= cost + 1));
            if (canShootAgain) { this.log("射撃可能: 目標選択中..."); } else { this.setMode('SELECT'); this.checkPhaseEnd(); }
        }, 800);
    }

    // ★追加: 敵生成 (ロジック内)
    spawnEnemies() {
        const c = 4 + Math.floor(this.sector * 0.7);
        for (let i = 0; i < c; i++) {
            let k = 'rifleman'; const r = Math.random(); 
            if (r < 0.1 + this.sector * 0.1) { k = 'tank_pz4'; } 
            else if (r < 0.4) { k = 'gunner'; } 
            else if (r < 0.6) { k = 'sniper'; }
            const e = this.createSoldier(k, 'enemy', 0, 0); 
            if (e) { const p = this.getSafeSpawnPos('enemy'); e.q = p.q; e.r = p.r; this.units.push(e); }
        }
    }

    // ★追加: オートモード切替
    toggleAuto() { 
        this.isAuto = !this.isAuto; 
        const btn = document.getElementById('auto-toggle');
        if(btn) btn.classList.toggle('active'); 
        this.log(`AUTO: ${this.isAuto ? "ON" : "OFF"}`); 
        // プレイヤーフェーズなら即時実行
        if (this.isAuto && this.state === 'PLAY') {
            this.runAuto();
        }
    }

    // ★追加: オート実行
    async runAuto() {
        if (this.state !== 'PLAY') return;
        this.ui.log(":: Auto Command ::");
        this.clearSelection();
        
        // プレイヤーAI実行
        await this.ai.execute(this.units, 'player');
        
        // AI終了後、AutoがまだONならターン終了
        if (this.isAuto && this.state === 'PLAY') {
             this.endTurn();
        }
    }

    async actionMove(u, p) {
        this.state = 'ANIM'; this.path = []; this.reachableHexes = []; this.attackLine = []; this.aimTargetUnit = null;
        for (let s of p) { 
            u.ap -= this.map[s.q][s.r].cost; u.q = s.q; u.r = s.r; 
            if (window.Sfx) { Sfx.play('move'); } 
            await new Promise(r => setTimeout(r, 180)); 
        }
        this.checkReactionFire(u); this.state = 'PLAY'; this.refreshUnitState(u); this.checkPhaseEnd();
    }

    checkReactionFire(u) {
        this.units.filter(e => e.team !== u.team && e.hp > 0 && e.def.isTank && this.hexDist(u, e) <= 1).forEach(t => {
            this.log(`!! 防御射撃: ${t.name}->${u.name}`); 
            this.applyDamage(u, 15, "防御射撃");
            if (window.VFX) { VFX.addExplosion(Renderer.hexToPx(u.q, u.r).x, Renderer.hexToPx(u.q, u.r).y, "#fa0", 5); }
            if (window.Sfx) { Sfx.play('mg'); } 
        });
    }
    swapWeapon() { }
    checkPhaseEnd() { if (this.units.filter(u => u.team === 'player' && u.hp > 0 && u.ap > 0).length === 0 && this.state === 'PLAY') { this.endTurn(); } }
    endTurn() {
        if (this.isProcessingTurn) { return; } 
        this.isProcessingTurn = true;
        this.setMode('SELECT'); this.selectedUnit = null; this.reachableHexes = []; this.attackLine = []; this.aimTargetUnit = null; this.path = []; this.hideActionMenu();
        this.state = 'ANIM'; const eyecatch = document.getElementById('eyecatch'); if (eyecatch) { eyecatch.style.opacity = 1; }
        this.units.filter(u => u.team === 'player' && u.hp > 0 && u.skills.includes("Mechanic")).forEach(u => { 
            const c = u.skills.filter(s => s === "Mechanic").length; 
            if (u.hp < u.maxHp) { u.hp = Math.min(u.maxHp, u.hp + c * 20); this.log(`${u.name} 修理`); } 
        });
        setTimeout(async () => {
            if (eyecatch) { eyecatch.style.opacity = 0; }
            await this.ai.executeTurn(this.units); // 敵AI実行
            this.units.forEach(u => { if (u.team === 'player') { u.ap = u.maxAp; } }); 
            this.checkWin();
            this.log("-- PLAYER PHASE --"); 
            this.state = 'PLAY'; 
            this.isProcessingTurn = false;
            
            // ★ターン開始時にAutoモードなら実行
            if (this.isAuto) {
                this.runAuto();
            }
        }, 1200);
    }
}

window.gameLogic = new Game();

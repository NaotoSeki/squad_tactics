/** LOGIC GAME: Final Repair (Cleaned & De-Duplicated) */

const AVAILABLE_CARDS = ['rifleman', 'scout', 'gunner', 'sniper', 'mortar_gunner', 'aerial'];

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
        this.aimTargetHex = null;
        this.hoverHex = null;
        this.isAuto = false;
        this.isAutoProcessing = false;
        this.isExecutingAttack = false;
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
            console.error("MapSystem not found!");
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

    // --- CORE METHODS ---
    toggleSidebar() { this.ui.toggleSidebar(); }
    toggleTankAutoReload() { this.tankAutoReload = !this.tankAutoReload; this.updateSidebar(); }
    log(m) { this.ui.log(m); }
    updateSidebar() { this.ui.updateSidebar(this.selectedUnit, this.state, this.tankAutoReload); }
    showContext(mx, my, hex) { this.ui.showContext(mx, my, hex); }
    hideActionMenu() { this.ui.hideActionMenu(); }

    // --- MAP DELEGATION ---
    generateMap() { if(this.mapSystem) this.mapSystem.generate(); }
    isValidHex(q, r) { return this.mapSystem ? this.mapSystem.isValidHex(q, r) : false; }
    hexDist(a, b) { return this.mapSystem ? this.mapSystem.hexDist(a, b) : 0; }
    getNeighbors(q, r) { return this.mapSystem ? this.mapSystem.getNeighbors(q, r) : []; }
    findPath(u, tq, tr) { return this.mapSystem ? this.mapSystem.findPath(u, tq, tr) : []; }
    
    calcAttackLine(u, tq, tr) {
        if (!this.mapSystem) return;
        this.attackLine = this.mapSystem.calcAttackLine(u, tq, tr);
        
        const w = this.getVirtualWeapon(u);
        if (w && w.indirect && this.attackLine.length === 0) {
            const dist = this.hexDist(u, {q:tq, r:tr});
            if (dist <= w.rng && dist >= (w.minRng || 0)) {
                this.attackLine = [{q: u.q, r: u.r}, {q: tq, r: tr}];
            }
        }

        if (this.attackLine.length > 0) { 
            const last = this.attackLine[this.attackLine.length - 1]; 
            if (last.q === tq && last.r === tr) { 
                const target = this.getUnitInHex(last.q, last.r); 
                if (target && target.team !== u.team) { this.aimTargetUnit = target; } 
                else { this.aimTargetUnit = null; }
            } else { this.aimTargetUnit = null; }
        } else { this.aimTargetUnit = null; }
    }

    // --- UNIT HELPERS ---
    getUnitsInHex(q, r) { return this.units.filter(u => u.q === q && u.r === r && u.hp > 0); }
    getUnitInHex(q, r) { return this.units.find(u => u.q === q && u.r === r && u.hp > 0); }
    getUnit(q, r) { return this.getUnitInHex(q, r); }

    // --- INTERACTION MODE HANDLING ---
    setMode(mode) {
        this.interactionMode = mode; 
        this.hideActionMenu(); 
        const indicator = document.getElementById('mode-label');
        if (mode === 'SELECT') { 
            if(indicator) indicator.style.display = 'none'; 
            this.path = []; 
            this.attackLine = []; 
        } else { 
            if(indicator) { 
                indicator.style.display = 'block'; 
                indicator.innerText = mode + " MODE"; 
            }
            if (mode === 'MOVE') { this.calcReachableHexes(this.selectedUnit); } 
            else if (mode === 'ATTACK') { this.reachableHexes = []; } 
        }
    }

    onUnitClick(u) {
        if (this.state !== 'PLAY') return;
        
        if (u.team === 'player') {
            if (this.interactionMode !== 'SELECT') { this.setMode('SELECT'); }
            this.selectedUnit = u; 
            this.refreshUnitState(u); 
            
            if (typeof Renderer !== 'undefined' && Renderer.game) { 
                const pointer = Renderer.game.input.activePointer; 
                this.ui.showActionMenu(u, pointer.x, pointer.y);
            }
            if (window.Sfx) { Sfx.play('click'); }
            return;
        }
        
        if (this.interactionMode === 'ATTACK' && this.selectedUnit && this.selectedUnit.team === 'player') { 
            this.actionAttack(this.selectedUnit, u); 
            return; 
        }
        
        if (this.interactionMode === 'MELEE' && this.selectedUnit && this.selectedUnit.team === 'player') { 
            this.actionMelee(this.selectedUnit, u); 
            this.setMode('SELECT'); 
            return; 
        }
        
        this.selectedUnit = u; 
        this.refreshUnitState(u); 
        this.hideActionMenu();
    }

    handleClick(p) {
        if (this.state !== 'PLAY') return; 
        
        if (this.interactionMode === 'SELECT') { 
            this.clearSelection(); 
        } 
        else if (this.interactionMode === 'MOVE') { 
            if (this.selectedUnit && this.isValidHex(p.q, p.r) && this.path.length > 0) { 
                const last = this.path[this.path.length - 1]; 
                if (last.q === p.q && last.r === p.r) { 
                    this.actionMove(this.selectedUnit, this.path); 
                    this.setMode('SELECT'); 
                } 
            } else { 
                this.setMode('SELECT'); 
            } 
        } 
        else if (this.interactionMode === 'ATTACK') {
            if (this.selectedUnit) {
                const targetUnit = this.getUnitInHex(p.q, p.r);
                if (targetUnit && targetUnit.team !== this.selectedUnit.team) {
                    this.actionAttack(this.selectedUnit, targetUnit); 
                } else {
                    this.actionAttack(this.selectedUnit, p); // Ground Attack
                }
            } else {
                this.setMode('SELECT');
            }
        }
        else if (this.interactionMode === 'MELEE') { 
            this.setMode('SELECT'); 
        }
    }

    handleHover(p) {
        if (this.state !== 'PLAY') return; 
        this.hoverHex = p; 
        const u = this.selectedUnit;
        if (u && u.team === 'player') { 
            if (this.interactionMode === 'MOVE') { 
                const isReachable = this.reachableHexes.some(h => h.q === p.q && h.r === p.r); 
                const targetUnits = this.getUnitsInHex(p.q, p.r); 
                if (isReachable && targetUnits.length < 4) { 
                    this.path = this.findPath(u, p.q, p.r); 
                } else { 
                    this.path = []; 
                } 
            } else if (this.interactionMode === 'ATTACK') { 
                this.calcAttackLine(u, p.q, p.r); 
            } 
        }
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

    clearSelection() {
        this.selectedUnit = null; 
        this.reachableHexes = []; 
        this.attackLine = []; 
        this.aimTargetUnit = null; 
        this.path = []; 
        this.setMode('SELECT'); 
        this.hideActionMenu(); 
        this.updateSidebar(); 
    }

    refreshUnitState(u) { 
        if (!u || u.hp <= 0) { 
            this.selectedUnit = null; 
            this.reachableHexes = []; 
            this.attackLine = []; 
            this.aimTargetUnit = null; 
        } 
        this.updateSidebar(); 
    }

    // --- ACTIONS & LOGIC ---
    calcReachableHexes(u) {
        this.reachableHexes = []; if (!u) return;
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

    setStance(s) {
        const u = this.selectedUnit; if (!u || u.def.isTank) return;
        if (u.stance === s) return;
        let cost = 0; if (u.stance === 'prone' && (s === 'stand' || s === 'crouch')) { cost = 1; }
        if (u.ap < cost) { this.log(`AP不足`); return; }
        u.ap -= cost; u.stance = s; this.refreshUnitState(u); this.hideActionMenu(); if (window.Sfx) { Sfx.play('click'); }
    }
    
    toggleStance() { const u = this.selectedUnit; if (!u) return; let next = 'stand'; if (u.stance === 'stand') { next = 'crouch'; } else if (u.stance === 'crouch') { next = 'prone'; } this.setStance(next); }

    swapEquipment(src, tgt) {
        const u = this.selectedUnit;
        if (!u || u.team !== 'player') return;
        let item1, item2;
        if (src.type === 'main') item1 = u.hands[src.index]; else item1 = u.bag[src.index];
        if (tgt.type === 'main') item2 = u.hands[tgt.index]; else item2 = u.bag[tgt.index];
        
        if (src.type === 'main') u.hands[src.index] = item2; else u.bag[src.index] = item2;
        if (tgt.type === 'main') u.hands[tgt.index] = item1; else u.bag[tgt.index] = item1;

        this.updateSidebar();
        if (window.Sfx) { Sfx.play('click'); }
        this.log(`${u.name} 装備変更`);
    }

    toggleFireMode() {
        const u = this.selectedUnit;
        if (!u || !u.hands || !u.hands.modes) return;
        if (u.hands[0] && u.hands[0].modes) {
            const modes = u.hands[0].modes; 
            const currentBurst = u.hands[0].burst;
            let nextIndex = modes.indexOf(currentBurst) + 1;
            if (nextIndex >= modes.length) nextIndex = 0;
            u.hands[0].burst = modes[nextIndex];
            if (window.Sfx) { Sfx.play('click'); }
            this.updateSidebar();
        }
    }

    getVirtualWeapon(u) {
        if (!u || !u.hands) return null;
        if (!Array.isArray(u.hands)) return u.hands;
        if (u.hands[0] && u.hands[0].attr === 'Weaponry' && u.hands[0].type !== 'part') return u.hands[0];

        const parts = u.hands.map(i => i ? i.code : null);
        if (parts.includes('mortar_barrel') && parts.includes('mortar_bipod') && parts.includes('mortar_plate')) {
            const base = WPNS['m2_mortar'];
            let totalAmmo = 0;
            u.bag.forEach(item => { if (item && item.code === 'mortar_shell_box') totalAmmo += item.current; });
            return { ...base, code: 'm2_mortar', current: totalAmmo > 0 ? 1 : 0, cap: 1, isVirtual: true };
        }
        return null;
    }

    consumeAmmo(u, weaponCode) {
        if (weaponCode === 'm2_mortar') {
            const ammoBox = u.bag.find(i => i && i.code === 'mortar_shell_box' && i.current > 0);
            if (ammoBox) { ammoBox.current--; return true; }
            return false;
        } else {
            const w = this.getVirtualWeapon(u);
            if (w && u.hands[0] && u.hands[0].code === w.code) { u.hands[0].current--; }
            return true;
        }
    }

    reloadWeapon(manual=false) {
        const u = this.selectedUnit; if (!u) return;
        const w = this.getVirtualWeapon(u); if (!w) return;
        
        if (u.def.isTank) {
            if (u.ap < 1) { this.log("AP不足"); return; }
            if (w.reserve <= 0) { this.log("予備弾なし"); return; }
            u.ap -= 1; w.current = 1; w.reserve -= 1;
            this.log("装填完了");
            if (window.Sfx) Sfx.play('tank_reload');
            this.refreshUnitState(u);
            if (manual) this.hideActionMenu();
            return;
        }
        
        const cost = w.rld || 1;
        if (u.ap < cost) { this.log("AP不足"); return; }
        const magIndex = u.bag.findIndex(i => i && i.type === 'ammo' && i.ammoFor === w.code);
        if (magIndex === -1) { this.log("予備弾なし"); return; }
        
        u.bag[magIndex] = null;
        u.ap -= cost;
        w.current = w.cap;
        this.log("リロード完了");
        if (window.Sfx) Sfx.play('reload');
        this.refreshUnitState(u);
        this.hideActionMenu();
    }

    // --- GAME ACTIONS ---
    async actionAttack(a, d) {
        if (this.isExecutingAttack) return;
        if (!a) return;
        
        const w = this.getVirtualWeapon(a);
        if (!w) return;
        if (w.isBroken) { this.log("武器故障中！修理が必要"); return; }
        
        // ターゲット判定
        let targetUnit = null;
        let targetHex = null;
        if (d.hp !== undefined) { targetUnit = d; targetHex = {q: d.q, r: d.r}; } 
        else { targetHex = d; targetUnit = this.getUnitInHex(d.q, d.r); }

        if (!w.indirect && !targetUnit) { this.setMode('SELECT'); return; }

        if (w.code === 'm2_mortar') {
             if (w.current <= 0) { this.log("弾切れ！弾薬箱が空です"); return; }
        } else {
             if (w.isConsumable && w.current <= 0) { this.log("使用済みです"); return; }
             if (w.current <= 0) { this.reloadWeapon(false); if (w.current <= 0) return; }
        }

        if (a.ap < w.ap) { this.log("AP不足"); return; }
        const dist = this.hexDist(a, targetHex); 
        if (w.minRng && dist < w.minRng) { this.log("目標が近すぎます！"); return; }
        if (dist > w.rng) { this.log("射程外"); return; }
        
        this.isExecutingAttack = true;
        a.ap -= w.ap; 
        this.state = 'ANIM';
        
        const animTarget = targetUnit || { q: targetHex.q, r: targetHex.r, hp: 100 };
        if (typeof Renderer !== 'undefined' && Renderer.playAttackAnim) Renderer.playAttackAnim(a, animTarget); 
        
        let hitChance = (a.stats?.aim || 0) * 2 + w.acc - (dist * (w.acc_drop||5)) - this.map[targetHex.q][targetHex.r].cover;
        if (targetUnit) {
            if (targetUnit.stance === 'prone') hitChance -= 20;
            if (targetUnit.stance === 'crouch') hitChance -= 10;
        }
        
        let shots = w.isConsumable ? 1 : Math.min(w.burst || 1, w.current);
        if (a.def.isTank || w.code === 'm2_mortar') shots = 1;

        this.log(`${a.name} 攻撃開始`);
        
        await new Promise(async (resolve) => {
            for (let i = 0; i < shots; i++) {
                if (targetUnit && targetUnit.hp <= 0) break;
                this.consumeAmmo(a, w.code);
                this.updateSidebar();
                
                const sPos = Renderer.hexToPx(a.q, a.r); 
                const ePos = Renderer.hexToPx(targetHex.q, targetHex.r);
                const isMortar = (w.code === 'm2_mortar');
                const isShell = w.type.includes('shell');
                const spread = (100 - w.acc) * 0.3;
                const tx = ePos.x + (Math.random() - 0.5) * spread;
                const ty = ePos.y + (Math.random() - 0.5) * spread;

                if (window.Sfx) Sfx.play(w.code, isShell ? 'cannon' : 'shot');
                
                const arc = isMortar ? 250 : (isShell ? 30 : 0);
                const flightTime = isMortar ? 1000 : (isShell ? 600 : dist * 30); 
                const fireRate = (w.type === 'bullet') ? 80 : 300;

                if (window.VFX) { 
                    VFX.addProj({ 
                        x: sPos.x, y: sPos.y, sx: sPos.x, sy: sPos.y, ex: tx, ey: ty, 
                        type: w.type, speed: isMortar ? 0.5 : 0.9, progress: 0, 
                        arcHeight: arc, isTracer: true, onHit: () => { } 
                    }); 
                }
                
                setTimeout(() => {
                    if (isMortar || isShell) {
                        if (window.VFX) VFX.addExplosion(tx, ty, "#f55", 5); 
                        if (window.Sfx) Sfx.play('death'); 
                    }

                    if (isMortar) {
                        const victims = this.getUnitsInHex(targetHex.q, targetHex.r);
                        const neighbors = this.getNeighbors(targetHex.q, targetHex.r);
                        const areaVictims = [];
                        neighbors.forEach(n => { areaVictims.push(...this.getUnitsInHex(n.q, n.r)); });

                        victims.forEach(v => {
                            if ((Math.random() * 100) < hitChance + 20) { this.applyDamage(v, w.dmg, "迫撃砲"); } 
                            else { this.log(">> 至近弾！"); this.applyDamage(v, Math.floor(w.dmg / 3), "爆風"); }
                        });
                        areaVictims.forEach(v => { this.applyDamage(v, Math.floor(w.dmg / 4), "爆風"); });

                    } else if (targetUnit) {
                        if (targetUnit.hp <= 0) return;
                        if ((Math.random() * 100) < hitChance) {
                            let dmg = Math.floor(w.dmg * (0.8 + Math.random() * 0.4));
                            if (targetUnit.def.isTank && w.type === 'bullet') dmg = 0;
                            if (dmg > 0) {
                                if (!isShell && window.VFX) VFX.add({ x: tx, y: ty, vx: 0, vy: -5, life: 10, maxLife: 10, color: "#fff", size: 2, type: 'spark' });
                                this.applyDamage(targetUnit, dmg, w.name);
                            } else { if (i === 0) this.log(">> 装甲により無効化！"); }
                        } else { 
                            if (window.VFX) VFX.add({ x: tx, y: ty, vx: 0, vy: 0, life: 10, maxLife: 10, color: "#aaa", size: 2, type: 'smoke' }); 
                        }
                    }
                }, flightTime);
                
                await new Promise(r => setTimeout(r, fireRate));
            }
            
            setTimeout(() => {
                this.state = 'PLAY'; 
                if (a.def.isTank && w.current === 0 && w.reserve > 0 && this.tankAutoReload && a.ap >= 1) { 
                    this.reloadWeapon(); 
                }
                this.refreshUnitState(a); 
                this.isExecutingAttack = false; 
                this.setMode('SELECT'); 
                this.checkPhaseEnd();
                resolve(); 
            }, 800);
        });
    }

    actionRepair() {
        const u = this.selectedUnit; if (!u || u.ap < 2) return;
        if (!u.hands[0] || !u.hands[0].isBroken) return;
        u.ap -= 2; u.hands[0].isBroken = false; this.log(`${u.name} 武器修理完了`); if (window.Sfx) Sfx.play('reload'); this.refreshUnitState(u); this.hideActionMenu();
    }

    actionHeal() {
        const u = this.selectedUnit; if (!u || u.ap < 2) return;
        const targets = this.getUnitsInHex(u.q, u.r).filter(t => t.team === u.team && t.hp < t.maxHp);
        if (targets.length === 0) return;
        targets.sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp)); const target = targets[0]; 
        u.ap -= 2; const healAmount = 30; target.hp = Math.min(target.maxHp, target.hp + healAmount); 
        this.log(`${u.name} が ${target.name} を治療`);
        if (window.VFX) { const p = Renderer.hexToPx(u.q, u.r); window.VFX.add({ x: p.x, y: p.y - 20, vx: 0, vy: -1, life: 30, maxLife: 30, color: "#0f0", size: 4, type: 'spark' }); }
        this.refreshUnitState(u); this.hideActionMenu();
    }

    async actionMelee(a, d) {
        if (!a || a.ap < 2) return;
        if (a.q !== d.q || a.r !== d.r) return;
        let wpnName = "銃床"; let bonusDmg = 0;
        if (a.def.isTank) { wpnName = "体当たり"; bonusDmg = 15; } 
        else {
            let bestWeapon = null; if (a.hands[0] && a.hands[0].type === 'melee') { bestWeapon = a.hands[0]; }
            a.bag.forEach(item => { if (item && item.type === 'melee') { if (!bestWeapon || item.dmg > bestWeapon.dmg) { bestWeapon = item; } } });
            if (bestWeapon) { wpnName = bestWeapon.name; bonusDmg = bestWeapon.dmg; }
        }
        a.ap -= 2;
        this.log(`${a.name} 白兵攻撃`);
        if (typeof Renderer !== 'undefined' && Renderer.playAttackAnim) { Renderer.playAttackAnim(a, d); }
        await new Promise(r => setTimeout(r, 300));
        let strVal = (a.stats && a.stats.str) ? a.stats.str : 0; let totalDmg = 10 + (strVal * 3) + bonusDmg;
        if (d.skills.includes('CQC')) { this.log(`>> カウンター！`); this.applyDamage(a, 15, "カウンター"); }
        if (window.Sfx) { Sfx.play('hit'); }
        this.applyDamage(d, totalDmg, "白兵");
        this.refreshUnitState(a); this.checkPhaseEnd();
    }

    // --- GAME LOOP & SPAWN ---
    spawnEnemies() {
        const c = 4 + Math.floor(this.sector * 0.7);
        for (let i = 0; i < c; i++) {
            let k = 'rifleman'; const r = Math.random(); 
            if (r < 0.1 + this.sector * 0.1) k = 'tank_pz4'; else if (r < 0.4) k = 'gunner'; else if (r < 0.6) k = 'sniper';
            const e = this.createSoldier(k, 'enemy', 0, 0); 
            if (e) { const p = this.getSafeSpawnPos('enemy'); if (p) { e.q = p.q; e.r = p.r; this.units.push(e); } }
        }
    }

    toggleAuto() { this.isAuto = !this.isAuto; const b = document.getElementById('auto-toggle'); if(b) b.classList.toggle('active'); if(this.isAuto && this.state==='PLAY') this.runAuto(); }
    async runAuto() { if(this.state!=='PLAY') return; this.ui.log(":: Auto ::"); this.clearSelection(); this.isAutoProcessing = true; await this.ai.execute(this.units, 'player'); this.isAutoProcessing = false; if(this.state==='WIN') return; if(this.isAuto && this.state==='PLAY') this.endTurn(); }
    
    async actionMove(u, p) { 
        this.state = 'ANIM'; 
        for(let s of p){
            u.ap -= this.map[s.q][s.r].cost; u.q = s.q; u.r = s.r; 
            if(window.Sfx) Sfx.play('move'); 
            await new Promise(r => setTimeout(r, 180)); 
        } 
        this.checkReactionFire(u); 
        this.state = 'PLAY'; 
        this.refreshUnitState(u); 
        this.checkPhaseEnd(); 
    }

    checkReactionFire(u) { this.units.filter(e => e.team !== u.team && e.hp > 0 && e.def.isTank && this.hexDist(u, e) <= 1).forEach(t => { this.log("防御射撃"); this.applyDamage(u, 15, "防御"); if(window.VFX) VFX.addExplosion(Renderer.hexToPx(u.q, u.r).x, Renderer.hexToPx(u.q, u.r).y, "#fa0", 5); }); }
    checkPhaseEnd() { if (this.units.filter(u => u.team === 'player' && u.hp > 0 && u.ap > 0).length === 0 && this.state === 'PLAY') { this.endTurn(); } }
    endTurn() { if (this.isProcessingTurn) return; this.isProcessingTurn = true; this.setMode('SELECT'); this.selectedUnit = null; this.reachableHexes = []; this.attackLine = []; this.hideActionMenu(); this.state = 'ANIM'; const e = document.getElementById('eyecatch'); if (e) e.style.opacity = 1; this.units.filter(u => u.team === 'player' && u.hp > 0 && u.skills.includes("Mechanic")).forEach(u => { if (u.hp < u.maxHp) { u.hp = Math.min(u.maxHp, u.hp + 20); this.log("修理"); } }); setTimeout(async () => { if (e) e.style.opacity = 0; await this.ai.executeTurn(this.units); if (this.checkWin()) return; this.units.forEach(u => { if (u.team === 'player') u.ap = u.maxAp; }); this.log("-- PLAYER --"); this.state = 'PLAY'; this.isProcessingTurn = false; if (this.isAuto) this.runAuto(); }, 1200); }
    promoteSurvivors() { this.units.filter(u => u.team === 'player' && u.hp > 0).forEach(u => { u.sectorsSurvived++; if (u.sectorsSurvived === 5) { u.skills.push("Hero"); u.maxAp++; this.log("英雄昇格"); } u.rank = Math.min(5, u.rank + 1); u.maxHp += 30; u.hp += 30; if (u.skills.length < 8 && Math.random() < 0.7) { const k = Object.keys(SKILLS).filter(z => z !== "Hero"); u.skills.push(k[Math.floor(Math.random() * k.length)]); } }); }
    checkWin() { if (this.state === 'WIN') return true; if (this.units.filter(u => u.team === 'enemy' && u.hp > 0).length === 0) { this.state = 'WIN'; if (window.Sfx) Sfx.play('win'); document.getElementById('reward-screen').style.display = 'flex'; this.promoteSurvivors(); const b = document.getElementById('reward-cards'); b.innerHTML = ''; [{ k: 'rifleman', t: '新兵' }, { k: 'mortar_gunner', t: '迫撃砲兵' }, { k: 'supply', t: '補給' }].forEach(o => { const d = document.createElement('div'); d.className = 'card'; const iconType = o.k === 'supply' ? 'heal' : 'infantry'; d.innerHTML = `<div class="card-img-box"><img src="${createCardIcon(iconType)}"></div><div class="card-body"><p>${o.t}</p></div>`; d.onclick = () => { if (o.k === 'supply') this.resupplySurvivors(); else this.spawnAtSafeGround('player', o.k); this.sector++; document.getElementById('reward-screen').style.display = 'none'; this.startCampaign(); }; b.appendChild(d); }); return true; } return false; }
    checkLose() { if (this.units.filter(u => u.team === 'player' && u.hp > 0).length === 0) { document.getElementById('gameover-screen').style.display = 'flex'; } }
    resupplySurvivors() { this.units.filter(u => u.team === 'player' && u.hp > 0).forEach(u => { if (u.hp < u.maxHp) u.hp = Math.floor(u.maxHp * 0.8); const w = this.getVirtualWeapon(u); if (w) { if (w.code === 'm2_mortar') { u.bag.forEach(i => { if (i && i.code === 'mortar_shell_box') i.current = i.cap; }); } else if (w.type.includes('bullet')) { w.current = w.cap; } else if (u.def.isTank) { w.reserve = 12; } } }); this.log("補給完了"); }
    
    // --- HELPER FOR BOOTSTRAP ---
    checkDeploy(targetHex) {
        if(!this.isValidHex(targetHex.q, targetHex.r) || this.map[targetHex.q][targetHex.r].id === -1) return false; 
        if(this.map[targetHex.q][targetHex.r].id === 5) return false; 
        if (this.getUnitsInHex(targetHex.q, targetHex.r).length >= 4) return false; 
        if (this.cardsUsed >= 2) return false; 
        return true;
    }

    deployUnit(targetHex, cardType) {
        if(!this.checkDeploy(targetHex)) { return; }
        const u = this.createSoldier(cardType, 'player', targetHex.q, targetHex.r);
        if(u) { 
            this.units.push(u); this.cardsUsed++; 
            this.log(`増援到着: ${u.name}`); 
            if(window.VFX) { const pos = Renderer.hexToPx(targetHex.q, targetHex.r); window.VFX.addSmoke(pos.x, pos.y); } 
            this.updateSidebar(); 
        }
    }

    async triggerBombardment(centerHex) {
        if (!this.isValidHex(centerHex.q, centerHex.r)) return;
        this.log(`>> 航空支援要請`);
        const neighbors = this.getNeighbors(centerHex.q, centerHex.r);
        const targets = [centerHex, ...neighbors];
        const validTargets = targets.filter(h => this.isValidHex(h.q, h.r));
        const hits = []; const pool = [...validTargets];
        for (let i = 0; i < 3; i++) { if (pool.length === 0) break; const idx = Math.floor(Math.random() * pool.length); hits.push(pool[idx]); pool.splice(idx, 1); }
        for (const hex of hits) {
            const pos = Renderer.hexToPx(hex.q, hex.r);
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
            }, Math.random() * 800);
        }
    }
}

window.gameLogic = new Game();

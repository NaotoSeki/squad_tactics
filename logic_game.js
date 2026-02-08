/** LOGIC GAME: Fixed Attack Visuals, Mortar Firing, and Map Interaction */

const AVAILABLE_CARDS = ['rifleman', 'tank_pz4', 'aerial', 'scout', 'tank_tiger', 'gunner', 'sniper', 'mortar_gunner'];

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

    toggleSidebar() { this.ui.toggleSidebar(); }
    toggleTankAutoReload() { 
        this.tankAutoReload = !this.tankAutoReload; 
        this.updateSidebar(); 
    }
    log(m) { this.ui.log(m); }

    // --- DELEGATED MAP METHODS ---
    generateMap() { if(this.mapSystem) this.mapSystem.generate(); }
    isValidHex(q, r) { return this.mapSystem ? this.mapSystem.isValidHex(q, r) : false; }
    hexDist(a, b) { return this.mapSystem ? this.mapSystem.hexDist(a, b) : 0; }
    getNeighbors(q, r) { return this.mapSystem ? this.mapSystem.getNeighbors(q, r) : []; }
    findPath(u, tq, tr) { return this.mapSystem ? this.mapSystem.findPath(u, tq, tr) : []; }
    
    // ★修正: 攻撃ライン計算
    calcAttackLine(u, tq, tr) {
        if (!this.mapSystem) return;
        
        // 武器情報を取得して、MapSystemに渡すか、あるいはここで簡易計算する
        const w = this.getVirtualWeapon(u);
        
        // 迫撃砲(Indirect)の場合は、射線が通らなくてもOKとする特別処理が必要かもしれないが
        // 現状のMapSystemの実装次第。とりあえず標準の計算を呼ぶ。
        this.attackLine = this.mapSystem.calcAttackLine(u, tq, tr);
        
        // 迫撃砲の場合、Lineが空（射線通らず）でも、射程内ならラインを引く特別措置
        if (w && w.indirect && this.attackLine.length === 0) {
            const dist = this.hexDist(u, {q:tq, r:tr});
            if (dist <= w.rng && dist >= (w.minRng || 0)) {
                // 直線的に引く（簡易）
                this.attackLine = [{q: u.q, r: u.r}, {q: tq, r: tr}];
            }
        }

        if (this.attackLine.length > 0) { 
            const last = this.attackLine[this.attackLine.length - 1]; 
            // ターゲット判定
            if (last.q === tq && last.r === tr) { 
                const target = this.getUnitInHex(last.q, last.r); 
                if (target && target.team !== u.team) { this.aimTargetUnit = target; } 
                else { this.aimTargetUnit = null; }
            } else { this.aimTargetUnit = null; }
        } else { this.aimTargetUnit = null; }
    }

    // --- UNIT CREATION & INVENTORY ---
    
    getVirtualWeapon(u) {
        if (!u || !u.hands) return null;
        if (!Array.isArray(u.hands)) return u.hands;

        if (u.hands[0] && u.hands[0].attr === 'Weaponry' && u.hands[0].type !== 'part') {
            return u.hands[0];
        }

        const parts = u.hands.map(i => i ? i.code : null);
        const hasBarrel = parts.includes('mortar_barrel');
        const hasBipod = parts.includes('mortar_bipod');
        const hasPlate = parts.includes('mortar_plate');

        if (hasBarrel && hasBipod && hasPlate) {
            const base = WPNS['m2_mortar'];
            let totalAmmo = 0;
            u.bag.forEach(item => {
                if (item && item.code === 'mortar_shell_box') {
                    totalAmmo += item.current;
                }
            });
            return {
                ...base,
                code: 'm2_mortar',
                current: totalAmmo > 0 ? 1 : 0, 
                cap: 1,
                isVirtual: true
            };
        }
        return null;
    }

    consumeAmmo(u, weaponCode) {
        if (weaponCode === 'm2_mortar') {
            const ammoBox = u.bag.find(i => i && i.code === 'mortar_shell_box' && i.current > 0);
            if (ammoBox) {
                ammoBox.current--;
                return true;
            }
            return false;
        } else {
            const w = this.getVirtualWeapon(u);
            if (w) w.current--;
            return true;
        }
    }

    createSoldier(templateKey, team, q, r) {
        const t = UNIT_TEMPLATES[templateKey]; if (!t) return null;
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
        
        const createItem = (key) => {
            if (!key || !WPNS[key]) { return null; }
            let base = WPNS[key]; 
            let item = { ...base, code: key, id: Math.random(), isBroken: false };
            if (base.type === 'bullet' || base.type === 'shell_fast') {
                item.current = item.cap;
            } else if (base.type === 'shell' || base.area) { 
                item.current = 1; 
                item.isConsumable = true; 
            } else if (base.type === 'ammo') {
                item.current = base.current || base.cap;
            }
            if (t.isTank && !base.type.includes('part') && !base.type.includes('ammo')) { 
                item.current = 1; item.cap = 1; item.reserve = 12; 
            }
            return item;
        };
        
        let hands = [null, null, null];
        if (Array.isArray(t.hands)) {
            t.hands.forEach((k, i) => { if (i < 3) hands[i] = createItem(k); });
        } else if (t.main) {
            hands[0] = createItem(t.main);
        }

        let bag = [];
        if (t.sub) { bag.push(createItem(t.sub)); }
        if (t.opt) { 
            const optBase = WPNS[t.opt]; const count = optBase.mag || 1; 
            for (let i = 0; i < count; i++) { bag.push(createItem(t.opt)); }
        }
        
        if (hands[0] && hands[0].type === 'bullet' && !t.isTank) { 
            for (let i = 0; i < hands[0].mag; i++) { 
                if (bag.length >= 4) { break; }
                bag.push({ type: 'ammo', name: (hands[0].magName || 'Clip'), ammoFor: hands[0].code, cap: hands[0].cap, jam: hands[0].jam, code: 'mag' }); 
            } 
        }
        
        if (!isPlayer) { 
            if (hands[0] && !hands[0].partType) { hands[0].current = 999; }
            bag = []; 
        }

        return { 
            id: Math.random(), team: team, q: q, r: r, def: t, name: name, rank: rank, faceSeed: faceSeed, stats: stats, 
            hp: t.hp || 80, maxHp: t.hp || 80, 
            ap: t.ap || 4, maxAp: t.ap || 4, 
            hands: hands, 
            bag: bag, 
            stance: 'stand', skills: [], sectorsSurvived: 0, deadProcessed: false 
        };
    }

    applyDamage(target, damage, sourceName = "攻撃") {
        if (!target || target.hp <= 0) return;
        target.hp -= damage;
        if (target.hp <= 0 && !target.deadProcessed) {
            target.deadProcessed = true;
            this.log(`>> ${target.name} を撃破！`);
            if (window.Sfx) { Sfx.play('death'); }
            if (window.VFX) { const p = Renderer.hexToPx(target.q, target.r); VFX.addUnitDebris(p.x, p.y); }
            if (target.team === 'enemy') { this.checkWin(); } else { this.checkLose(); }
        }
    }

    async actionAttack(a, d) {
        if (this.isExecutingAttack) return;
        if (!a) return;
        if (a.team === 'player' && this.state !== 'PLAY' && !this.isAutoProcessing) return;
        
        const w = this.getVirtualWeapon(a);
        if (!w) return;

        if (w.isBroken) { this.log("武器故障中！修理が必要"); return; }
        
        // 迫撃砲のチェック
        if (w.code === 'm2_mortar') {
             // 弾薬箱チェック
             if (w.current <= 0) { this.log("弾切れ！弾薬箱が空です"); return; }
        } else {
             if (w.isConsumable && w.current <= 0) { this.log("使用済みです"); return; }
             if (w.current <= 0) {
                 if ((a.def.isTank && this.tankAutoReload) || (!a.def.isTank)) {
                     this.reloadWeapon(false);
                     if (w.current <= 0) return;
                 } else {
                     this.log("弾切れ！装填が必要だ！"); return;
                 }
             }
        }

        if (a.ap < w.ap) { this.log("AP不足"); return; }
        
        const dist = this.hexDist(a, d); 
        if (w.minRng && dist < w.minRng) { this.log("目標が近すぎます！"); return; }
        if (dist > w.rng) { this.log("射程外"); return; }
        
        this.isExecutingAttack = true;
        a.ap -= w.ap; 
        this.state = 'ANIM';
        
        if (typeof Renderer !== 'undefined' && Renderer.playAttackAnim) { Renderer.playAttackAnim(a, d); }
        
        let hitChance = (a.stats?.aim || 0) * 2 + w.acc - (dist * (w.acc_drop||5)) - this.map[d.q][d.r].cover;
        if (d.stance === 'prone') { hitChance -= 20; }
        
        let shots = w.isConsumable ? 1 : Math.min(w.burst || 1, w.current);
        if (a.def.isTank || w.code === 'm2_mortar') shots = 1;

        this.log(`${a.name} 攻撃開始 (${w.name})`);
        
        let reloadedInThisAction = false; 

        await new Promise(async (resolve) => {
            for (let i = 0; i < shots; i++) {
                if (d.hp <= 0) break;
                
                // ★弾消費
                this.consumeAmmo(a, w.code);
                this.updateSidebar();
                
                const sPos = Renderer.hexToPx(a.q, a.r); const ePos = Renderer.hexToPx(d.q, d.r);
                const spread = (100 - w.acc) * 0.5; const tx = ePos.x + (Math.random() - 0.5) * spread; const ty = ePos.y + (Math.random() - 0.5) * spread;
                
                if (window.Sfx) { Sfx.play(w.code, w.type.includes('shell') ? 'cannon' : 'shot'); }
                
                const isShell = w.type.includes('shell');
                // 迫撃砲は弾道を高く
                const arc = w.code === 'm2_mortar' ? 150 : (isShell ? 10 : 0);
                const flightTime = isShell ? 600 : dist * 30; 
                
                if (window.VFX) { VFX.addProj({ x: sPos.x, y: sPos.y, sx: sPos.x, sy: sPos.y, ex: tx, ey: ty, type: w.type, speed: isShell ? 0.9 : 0.6, progress: 0, arcHeight: arc, isTracer: true, onHit: () => { } }); }
                
                setTimeout(() => {
                    if (d.hp <= 0) return;
                    const isHit = (Math.random() * 100) < hitChance;
                    if (isHit) {
                        let dmg = w.dmg;
                        if (d.def.isTank && w.type === 'bullet') dmg = 0;
                        if (dmg > 0) {
                            if (window.VFX) { VFX.addExplosion(tx, ty, "#f55", 5); }
                            this.applyDamage(d, dmg, w.name);
                        } else {
                            if (i === 0) { this.log(">> 装甲により無効化！"); }
                        }
                    } else { 
                        if (window.VFX) { VFX.add({ x: tx, y: ty, vx: 0, vy: 0, life: 10, maxLife: 10, color: "#aaa", size: 2, type: 'smoke' }); } 
                    }
                }, flightTime);
                
                await new Promise(r => setTimeout(r, flightTime + 100));
            }
            
            setTimeout(() => {
                this.state = 'PLAY'; 
                
                // 次弾装填
                if(!reloadedInThisAction && a.def.isTank && w.current === 0 && w.reserve > 0 && this.tankAutoReload && a.ap >= 1) { 
                    this.reloadWeapon(); 
                }
                
                this.refreshUnitState(a); 
                const cost = w ? w.ap : 0;
                
                // 迫撃砲やタンクの再攻撃判定
                const hasAmmoInBag = !a.def.isTank && a.bag.some(i => i && i.type === 'ammo' && i.ammoFor === w.code);
                // 迫撃砲は ammoBox があれば撃てる
                let isMortarReady = false;
                if (w.code === 'm2_mortar') {
                    // getVirtualWeaponを再取得して現在の弾数確認でも良いが、簡易的にbagを見る
                    isMortarReady = a.bag.some(i => i && i.code === 'mortar_shell_box' && i.current > 0);
                }

                const canShootAgain = (a.ap >= cost) && (w.current > 0 || (a.def.isTank && w.reserve > 0 && this.tankAutoReload && a.ap >= cost + 1) || hasAmmoInBag || isMortarReady);
                
                if (canShootAgain) { this.log("射撃可能: 目標選択中..."); } else { this.setMode('SELECT'); this.checkPhaseEnd(); }
                
                this.isExecutingAttack = false; 
                resolve(); 
            }, 200);
        });
    }

    spawnEnemies() {
        const c = 4 + Math.floor(this.sector * 0.7);
        for (let i = 0; i < c; i++) {
            let k = 'rifleman'; const r = Math.random(); 
            if (r < 0.1 + this.sector * 0.1) { k = 'tank_pz4'; } 
            else if (r < 0.4) { k = 'gunner'; } 
            else if (r < 0.6) { k = 'sniper'; }
            const e = this.createSoldier(k, 'enemy', 0, 0); 
            if (e) { 
                const p = this.getSafeSpawnPos('enemy'); 
                if (p) { 
                    e.q = p.q; e.r = p.r; 
                    this.units.push(e); 
                }
            }
        }
    }

    toggleAuto() { 
        this.isAuto = !this.isAuto; 
        const btn = document.getElementById('auto-toggle');
        if(btn) btn.classList.toggle('active'); 
        this.log(`AUTO: ${this.isAuto ? "ON" : "OFF"}`); 
        if (this.isAuto && this.state === 'PLAY') {
            this.runAuto();
        }
    }

    async runAuto() {
        if (this.state !== 'PLAY') return;
        this.ui.log(":: Auto Command ::");
        this.clearSelection();
        this.isAutoProcessing = true; 
        await this.ai.execute(this.units, 'player');
        this.isAutoProcessing = false; 
        if (this.state === 'WIN') return;
        if (this.isAuto && this.state === 'PLAY') { this.endTurn(); }
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
            await this.ai.executeTurn(this.units); 
            if (this.checkWin()) return;
            this.units.forEach(u => { if (u.team === 'player') { u.ap = u.maxAp; } }); 
            this.log("-- PLAYER PHASE --"); 
            this.state = 'PLAY'; 
            this.isProcessingTurn = false;
            if (this.isAuto) { this.runAuto(); }
        }, 1200);
    }

    promoteSurvivors() { 
        this.units.filter(u => u.team === 'player' && u.hp > 0).forEach(u => { 
            u.sectorsSurvived++; 
            if (u.sectorsSurvived === 5) { u.skills.push("Hero"); u.maxAp++; this.log("英雄昇格"); } 
            u.rank = Math.min(5, (u.rank || 0) + 1); u.maxHp += 30; u.hp += 30; 
            if (u.skills.length < 8 && Math.random() < 0.7) { 
                const k = Object.keys(SKILLS).filter(z => z !== "Hero"); 
                u.skills.push(k[Math.floor(Math.random() * k.length)]); this.log("スキル習得"); 
            } 
        }); 
    }

    showContext(mx, my, hex) { this.ui.showContext(mx, my, hex); }
    updateSidebar() { this.ui.updateSidebar(this.selectedUnit, this.state, this.tankAutoReload); }
    getStatus(u) { if (u.hp <= 0) return "DEAD"; const r = u.hp / u.maxHp; if (r > 0.8) return "NORMAL"; if (r > 0.5) return "DAMAGED"; return "CRITICAL"; }
    
    checkWin() { 
        if (this.state === 'WIN') return true; 
        if (this.units.filter(u => u.team === 'enemy' && u.hp > 0).length === 0) { 
            this.state = 'WIN'; 
            if (window.Sfx) { Sfx.play('win'); }
            document.getElementById('reward-screen').style.display = 'flex'; 
            this.promoteSurvivors(); 
            const b = document.getElementById('reward-cards'); b.innerHTML = ''; 
            [{ k: 'rifleman', t: '新兵' }, { k: 'tank_pz4', t: '戦車' }, { k: 'supply', t: '補給物資' }].forEach(o => { 
                const d = document.createElement('div'); d.className = 'card'; 
                const iconType = o.k === 'supply' ? 'heal' : 'infantry'; 
                d.innerHTML = `<div style="background:#222; width:100%; text-align:center; padding:2px 0; border-bottom:1px solid #444; margin-bottom:5px;"><h3 style="color:#da4; font-size:14px; margin:0;">${o.t}</h3></div><div class="card-img-box"><img src="${createCardIcon(iconType)}"></div><div class="card-body"><p>${o.k === 'supply' ? 'HP/弾薬/装備' : '増援'}</p></div>`; 
                d.onclick = () => { 
                    if (o.k === 'supply') { this.resupplySurvivors(); } 
                    else { this.spawnAtSafeGround('player', o.k); } 
                    this.sector++; 
                    document.getElementById('reward-screen').style.display = 'none'; 
                    this.startCampaign(); 
                }; 
                b.appendChild(d); 
            }); 
            return true; 
        } 
        return false; 
    }
    
    checkLose() { 
        if (this.units.filter(u => u.team === 'player' && u.hp > 0).length === 0) { 
            document.getElementById('gameover-screen').style.display = 'flex'; 
        } 
    }

    resupplySurvivors() { 
        this.units.filter(u => u.team === 'player' && u.hp > 0).forEach(u => { 
            if (u.hp < u.maxHp) u.hp = Math.floor(u.maxHp * 0.8); 
            const w = this.getVirtualWeapon(u);
            if (w) {
                if (w.code === 'm2_mortar') {
                    u.bag.forEach(i => { if (i && i.code === 'mortar_shell_box') i.current = i.cap; });
                } else if (w.type.includes('bullet')) {
                    w.current = w.cap;
                } else if (u.def.isTank) {
                    w.reserve = 12;
                }
            }
        }); 
        this.log("補給完了"); 
    }
}

window.gameLogic = new Game();

/** LOGIC: Inventory System & Drag-Drop Swap */
class Game {
    constructor() {
        this.units=[]; this.map=[]; this.setupSlots=[]; this.state='SETUP'; 
        this.path=[]; this.reachableHexes=[]; 
        this.attackLine=[]; 
        this.aimTargetUnit = null; 
        this.hoverHex=null;
        this.isAuto=false; this.isProcessingTurn = false; this.sector = 1;
        this.enemyAI = 'AGGRESSIVE'; 
        this.cardsUsed = 0; 
        this.initDOM(); this.initSetup();
    }
    
    initDOM() {
        Renderer.init(document.getElementById('game-view'));
        window.addEventListener('click', (e)=>{if(!e.target.closest('#context-menu')) document.getElementById('context-menu').style.display='none';});
        const resizer = document.getElementById('resizer'); const sidebar = document.getElementById('sidebar');
        let isResizing = false;
        if(resizer) {
            resizer.addEventListener('mousedown', (e) => { isResizing = true; document.body.style.cursor = 'col-resize'; resizer.classList.add('active'); });
            window.addEventListener('mousemove', (e) => {
                if (!isResizing) return;
                const newWidth = document.body.clientWidth - e.clientX;
                if (newWidth > 200 && newWidth < 800) { sidebar.style.width = newWidth + 'px'; if(sidebar.classList.contains('collapsed')) this.toggleSidebar(); Renderer.resize(); }
            });
            window.addEventListener('mouseup', () => { if (isResizing) { isResizing = false; document.body.style.cursor = ''; resizer.classList.remove('active'); Renderer.resize(); } });
        }
    }
    toggleSidebar() {
        const sb = document.getElementById('sidebar'); const tg = document.getElementById('sidebar-toggle');
        sb.classList.toggle('collapsed'); tg.innerText = sb.classList.contains('collapsed') ? '◀' : '▶';
        setTimeout(() => Renderer.resize(), 150); 
    }

    initSetup() {
        const box=document.getElementById('setup-cards');
        ['rifleman','scout','gunner','sniper'].forEach(k=>{
            const t=UNIT_TEMPLATES[k]; 
            const d=document.createElement('div'); d.className='card';
            d.innerHTML=`<div class="card-badge">0</div><div class="card-img-box"><img src="${createCardIcon('infantry')}"></div><div class="card-body"><h3 style="color:#d84">${t.name}</h3><p style="font-size:10px">${t.role}</p></div>`;
            d.onclick=()=>{
                if(this.setupSlots.length<3) {
                    this.setupSlots.push(k);
                    d.querySelector('.card-badge').innerText = this.setupSlots.filter(s=>s===k).length;
                    d.querySelector('.card-badge').style.display = 'block';
                    this.log(`> 採用: ${t.name}`);
                    if(this.setupSlots.length===3) document.getElementById('btn-start').style.display='inline-block';
                }
            }; box.appendChild(d);
        });
    }

    // ★重要: インベントリ構築ロジック (Hands + Bag)
    createSoldier(templateKey, team, q, r) {
        const t = UNIT_TEMPLATES[templateKey];
        if(!t) return null;

        const isPlayer = (team === 'player');
        
        // ステータス個体差
        const stats = { ...t.stats };
        if (isPlayer && !t.isTank) {
            ['str','aim','mob','mor'].forEach(k => stats[k] = (stats[k]||0) + Math.floor(Math.random()*3)-1);
        }

        // 名前
        let name = t.name;
        let rank = 0;
        let faceSeed = Math.floor(Math.random() * 99999);
        if (isPlayer && !t.isTank) {
            const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
            const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
            name = `${last} ${first}`; 
        }

        // 武器・アイテム生成ヘルパー
        const createItem = (key, isMainWpn = false) => {
            if(!key || !WPNS[key]) return null;
            let base = WPNS[key];
            let item = { ...base, code: key, id: Math.random() };
            
            // 銃の場合、マガジンタイプ決定と初期弾薬装填
            if (base.type === 'bullet' || base.type === 'shell_fast') {
                if (isMainWpn && MAG_VARIANTS && MAG_VARIANTS[key]) {
                    const vars = MAG_VARIANTS[key];
                    const choice = vars[Math.floor(Math.random() * vars.length)];
                    item.cap = choice.cap; 
                    item.jam = choice.jam; 
                    item.magName = choice.name;
                }
                item.current = item.cap;
            } else if (base.type === 'shell' || base.area) {
                // 手榴弾等は使い切り
                item.current = 1; 
                item.isConsumable = true;
            }
            return item;
        };

        // 装備構築
        let hands = null;
        let bag = [];

        // メイン武器 -> Hands
        if (t.main) hands = createItem(t.main, true);

        // サブ武器 -> Bag
        if (t.sub) bag.push(createItem(t.sub));

        // オプション -> Bag
        if (t.opt) {
            const optBase = WPNS[t.opt];
            const count = optBase.mag || 1; // オプションのmag値 = 所持個数として扱う
            for(let i=0; i<count; i++) bag.push(createItem(t.opt));
        }

        // 予備マガジン (メイン武器用) -> Bag
        if (hands && hands.mag && !hands.isConsumable) {
            for(let i=0; i<hands.mag; i++) {
                if (bag.length >= 4) break; // 4つまで
                bag.push({
                    type: 'ammo',
                    name: (hands.magName || 'Clip'),
                    ammoFor: hands.code, // どの武器用か
                    cap: hands.cap,
                    jam: hands.jam,
                    code: 'mag'
                });
            }
        }
        
        // 敵の場合はバッグを持たせず、無限マガジン扱いなどの簡易処理にする
        if (!isPlayer) {
            // 敵はリロードしない（簡易化）
            if(hands) hands.current = 999;
            bag = [];
        }

        return {
            id: Math.random(),
            team: team, q: q, r: r,
            def: t, name: name, rank: rank, faceSeed: faceSeed, stats: stats, 
            hp: t.hp || (80 + (stats.str||0) * 5),
            maxHp: t.hp || (80 + (stats.str||0) * 5),
            ap: t.ap || Math.floor((stats.mob||0)/2) + 3,
            maxAp: t.ap || Math.floor((stats.mob||0)/2) + 3,
            
            hands: hands, // 装備中
            bag: bag,     // バックパック (Array)
            
            stance: 'stand',
            skills: [],
            sectorsSurvived: 0,
            deadProcessed: false,
            curWpn: hands ? hands.code : 'unarmed'
        };
    }

    startCampaign() {
        document.getElementById('setup-screen').style.display='none'; 
        if (typeof Renderer !== 'undefined' && Renderer.game) {
            const mainScene = Renderer.game.scene.getScene('MainScene');
            if (mainScene) { 
                mainScene.mapGenerated = false; 
                if(mainScene.hexGroup && typeof mainScene.hexGroup.removeAll === 'function') mainScene.hexGroup.removeAll();
                if(window.EnvSystem) window.EnvSystem.clear(); 
            }
        }
        Renderer.resize();
        
        this.selectedUnit = null; this.reachableHexes = []; this.attackLine = []; this.aimTargetUnit = null; this.path = [];
        this.cardsUsed = 0; 
        
        this.units = this.units.filter(u => u.team === 'player' && u.hp > 0);
        this.units.forEach(u => { u.q = -999; u.r = -999; });
        
        this.generateMap(); 
        
        if(this.units.length === 0) { 
            this.setupSlots.forEach(k => {
                const p = this.getSafeSpawnPos('player');
                const u = this.createSoldier(k, 'player', p.q, p.r);
                this.units.push(u);
            });
        } else { 
            this.units.forEach(u => { const p = this.getSafeSpawnPos('player'); u.q = p.q; u.r = p.r; });
        }
        this.spawnEnemies();
        this.state='PLAY'; 
        this.log(`SECTOR ${this.sector} START`);
        document.getElementById('sector-counter').innerText = `SECTOR: ${this.sector.toString().padStart(2, '0')}`;
        const leader = this.units.find(u => u.team === 'player');
        if(leader && leader.q !== -999) Renderer.centerOn(leader.q, leader.r);
        setTimeout(() => { if (Renderer.dealCards) Renderer.dealCards(['rifleman', 'tank_pz4', 'gunner', 'scout', 'tank_tiger']); }, 500);
    }

    getSafeSpawnPos(team) {
        const cy = Math.floor(MAP_H/2); 
        for(let i=0; i<100; i++) {
            const q = Math.floor(Math.random()*MAP_W);
            const r = Math.floor(Math.random()*MAP_H);
            if (team==='player' && r < cy) continue;
            if (team==='enemy' && r >= cy) continue;
            if (this.isValidHex(q,r) && !this.getUnit(q,r) && this.map[q][r].id !== -1 && this.map[q][r].id !== 5) {
                return {q, r};
            }
        }
        return {q:0, r:0};
    }

    refreshUnitState(u) {
        if (!u || u.hp <= 0) {
            this.selectedUnit = null; this.reachableHexes = []; this.attackLine = []; this.aimTargetUnit = null;
        } else {
            this.calcReachableHexes(u);
            if (this.hoverHex && this.isValidHex(this.hoverHex.q, this.hoverHex.r)) {
                this.calcAttackLine(u, this.hoverHex.q, this.hoverHex.r);
            } else {
                this.attackLine = []; this.aimTargetUnit = null;
            }
        }
        this.updateSidebar();
    }

    clearSelection() {
        if (this.selectedUnit) {
            this.selectedUnit = null; this.reachableHexes = []; this.attackLine = []; this.aimTargetUnit = null; this.path = [];
            this.updateSidebar();
            if(window.Sfx) Sfx.play('click'); 
        }
    }

    // --- 装備操作: ドラッグ＆ドロップ ---
    // src: {type:'main'|'bag', index:0}, tgt: {type:'main'|'bag', index:0}
    swapEquipment(src, tgt) {
        const u = this.selectedUnit;
        if (!u || u.ap < 1) { this.log("AP不足"); return; }
        if (src.type === tgt.type && src.index === tgt.index) return;

        // アイテム取得
        let srcItem = (src.type === 'main') ? u.hands : u.bag[src.index];
        let tgtItem = (tgt.type === 'main') ? u.hands : u.bag[tgt.index];

        if (!srcItem) return; // 空をつかんだ

        // ルール: Mainには武器(弾薬以外)しか置けない
        if (tgt.type === 'main' && srcItem.type === 'ammo') {
            this.log("弾薬は装備できません");
            return;
        }
        if (src.type === 'main' && tgtItem && tgtItem.type === 'ammo') {
            this.log("弾薬とは交換できません");
            return;
        }

        // 交換処理
        u.ap -= 1;
        
        // 1. 取り出し
        if (src.type === 'main') u.hands = null;
        else u.bag[src.index] = null;

        if (tgt.type === 'main') u.hands = null;
        else u.bag[tgt.index] = null;

        // 2. 配置
        if (tgt.type === 'main') u.hands = srcItem;
        else u.bag[tgt.index] = srcItem;

        if (src.type === 'main') u.hands = tgtItem;
        else u.bag[src.index] = tgtItem;

        // 詰め直し（バッグのnullを詰めるかどうかはお好みだが、スロット固定ならnullのままが自然）
        // u.bag = u.bag.filter(i => i !== null); // 今回は詰めない

        this.log(`${u.name} 装備変更`);
        if(window.Sfx) Sfx.play('swap');
        
        // 装備が変わったので射程など再計算
        if (u.hands) u.curWpn = u.hands.code;
        this.refreshUnitState(u);
    }

    reloadWeapon() {
        const u = this.selectedUnit;
        if (!u || u.ap < 1) return;
        const w = u.hands;
        if (!w || w.current === w.cap) return;

        // バッグから適合するマガジンを探す
        const magIndex = u.bag.findIndex(i => i && i.type === 'ammo' && i.ammoFor === w.code);
        
        if (magIndex === -1) {
            this.log("予備マガジンがありません");
            return;
        }

        const mag = u.bag[magIndex];
        u.ap -= (w.rld || 1);
        
        // リロード処理: マガジンの性能（装弾数・ジャム率）を武器に適用
        w.current = mag.cap;
        w.cap = mag.cap; // マガジンによって容量が変わる場合に対応
        w.jam = mag.jam;
        w.magName = mag.name;

        // マガジン消費（バッグから消す）
        u.bag.splice(magIndex, 1);

        this.log(`${u.name} リロード (${mag.name})`);
        if(window.Sfx) Sfx.play('swap');
        this.refreshUnitState(u);
    }

    // --- 戦闘 ---
    calcAttackLine(u, targetQ, targetR) {
        this.attackLine = []; this.aimTargetUnit = null;
        if (!u || u.ap < 2) return;
        const w = u.hands; // ★修正
        if(!w) return;
        const range = w.rng;
        const dist = this.hexDist(u, {q:targetQ, r:targetR});
        if (dist === 0) return;
        const drawLen = Math.min(dist, range);
        const start = this.axialToCube(u.q, u.r); const end = this.axialToCube(targetQ, targetR);
        for (let i = 1; i <= drawLen; i++) {
            const t = i / dist;
            const lerpCube = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t, z: start.z + (end.z - start.z) * t };
            const roundCube = this.cubeRound(lerpCube); const hex = this.cubeToAxial(roundCube);
            if (this.isValidHex(hex.q, hex.r)) { this.attackLine.push({q: hex.q, r: hex.r}); } else { break; }
        }
        if (this.attackLine.length > 0) {
            const lastHex = this.attackLine[this.attackLine.length - 1];
            if (lastHex.q === targetQ && lastHex.r === targetR) {
                const target = this.getUnit(lastHex.q, lastHex.r);
                if (target && target.team !== u.team) { this.aimTargetUnit = target; }
            }
        }
    }
    // ... axialToCube, cubeToAxial, cubeRound ... (変更なし)
    axialToCube(q, r) { return { x: q, y: r, z: -q-r }; }
    cubeToAxial(c) { return { q: c.x, r: c.y }; }
    cubeRound(c) {
        let rx = Math.round(c.x), ry = Math.round(c.y), rz = Math.round(c.z);
        const x_diff = Math.abs(rx - c.x), y_diff = Math.abs(ry - c.y), z_diff = Math.abs(rz - c.z);
        if (x_diff > y_diff && x_diff > z_diff) rx = -ry - rz; else if (y_diff > z_diff) ry = -rx - rz; else rz = -rx - ry;
        return { x: rx, y: ry, z: rz };
    }

    handleHover(p) {
        if(this.state !== 'PLAY') return; this.hoverHex = p;
        if(this.selectedUnit && this.isValidHex(p.q, p.r)) {
            this.calcAttackLine(this.selectedUnit, p.q, p.r);
            const isReachable = this.reachableHexes.some(h => h.q === p.q && h.r === p.r);
            const enemy = this.getUnit(p.q, p.r);
            if(isReachable && !enemy) this.path = this.findPath(this.selectedUnit, p.q, p.r); else this.path = [];
        } else { this.attackLine = []; this.aimTargetUnit = null; }
    }
    handleClick(p) {
        const isValid = this.isValidHex(p.q, p.r) && this.map[p.q][p.r].id !== -1;
        const u = isValid ? this.getUnit(p.q, p.r) : null;
        if(u && u.team==='player') { 
            this.selectedUnit=u; this.refreshUnitState(u); this.path = []; if(window.Sfx)Sfx.play('click'); 
        } else if(this.selectedUnit) {
            if(u && u.team==='enemy') this.actionAttack(this.selectedUnit, u);
            else if(!u && isValid && this.path.length > 0) this.actionMove(this.selectedUnit, this.path);
            else { this.clearSelection(); } 
        }
    }

    async actionAttack(a, d) {
        const w = a.hands; // ★修正
        if (!w) return;
        
        // 使い捨て武器（グレネード等）の場合、射程と弾数チェック
        if (w.isConsumable && w.current <= 0) { 
            this.log("使用済みです"); return; 
        }
        
        if (w.current <= 0) { this.log("弾切れ！リロードが必要だ！"); return; }
        if (a.ap < w.ap) { this.log("AP不足"); return; }
        const dist = this.hexDist(a, d);
        if (dist > w.rng) { this.log("射程外"); return; }

        a.ap -= w.ap;
        this.state = 'ANIM';
        if (Renderer.playAttackAnim) Renderer.playAttackAnim(a, d);

        let hitChance = (a.stats?.aim || 0)*2 + w.acc - (dist * 5) - this.map[d.q][d.r].cover;
        if (d.stance === 'prone') hitChance -= 20;
        if (d.stance === 'crouch') hitChance -= 10;
        let dmgMod = 1.0 + (a.stats?.str || 0) * 0.05;

        // 消費アイテムなら1発、そうでなければバースト
        const shots = w.isConsumable ? 1 : Math.min(w.burst || 1, w.current);
        this.log(`${a.name} 攻撃開始 (${w.name})`);

        for(let i=0; i<shots; i++) {
            if (d.hp <= 0) break;
            
            // ジャム判定 (消費アイテム以外)
            if (!w.isConsumable && w.jam && Math.random() < w.jam) {
                this.log(`⚠ JAM!! ${w.name}が作動不良！`);
                if(window.Sfx) Sfx.play('ricochet'); 
                break; 
            }

            w.current--; 
            const sPos = Renderer.hexToPx(a.q, a.r);
            const ePos = Renderer.hexToPx(d.q, d.r);
            const spread = (100 - w.acc) * 0.5;
            const tx = ePos.x + (Math.random()-0.5) * spread;
            const ty = ePos.y + (Math.random()-0.5) * spread;

            if(window.Sfx) Sfx.play(w.type === 'shell' || w.type === 'shell_fast' ? 'cannon' : 'shot');

            const isHit = (Math.random() * 100) < hitChance;
            const onHit = () => {
                if (isHit) {
                    let dmg = Math.floor(w.dmg * dmgMod * (0.8 + Math.random()*0.4));
                    if (d.def.isTank && w.type === 'bullet') dmg = 0; 
                    
                    if (dmg > 0) {
                        d.hp -= dmg;
                        if(typeof Renderer!=='undefined'&&Renderer.playExplosion&&w.type.includes('shell')) Renderer.playExplosion(tx, ty);
                        else if(window.VFX) VFX.addExplosion(tx, ty, "#f55", 5);
                        if(window.Sfx) Sfx.play('ricochet');
                    } else {
                        if(window.VFX) VFX.add({x:tx, y:ty, vx:0, vy:-5, life:10, maxLife:10, color:"#fff", size:2, type:'spark'});
                        if(i===0) this.log(">> 装甲により無効化！");
                    }
                } else {
                    if(window.VFX) VFX.add({x:tx, y:ty, vx:0, vy:0, life:10, maxLife:10, color:"#aaa", size:2, type:'smoke'});
                }
            };

            if(window.VFX) VFX.addProj({
                x: sPos.x, y: sPos.y, 
                sx: sPos.x, sy: sPos.y, ex: tx, ey: ty,
                type: w.type, speed: 0.1, progress: 0, arcHeight: (w.type.includes('shell')?100:0),
                onHit: onHit
            });
            await new Promise(r => setTimeout(r, 100)); 
        }
        
        // 使い切ったら捨てる (消費アイテムの場合)
        if (w.isConsumable && w.current <= 0) {
            a.hands = null; // メイン装備から消滅
            this.log(`${w.name} を消費しました`);
        }

        setTimeout(() => {
            if (d.hp <= 0 && !d.deadProcessed) {
                d.deadProcessed = true;
                this.log(`>> ${d.name} を撃破！`);
                if(window.Sfx) Sfx.play('death');
                if(window.VFX) VFX.addUnitDebris(Renderer.hexToPx(d.q, d.r).x, Renderer.hexToPx(d.q, d.r).y);
            }
            this.state = 'PLAY';
            this.refreshUnitState(a); 
            this.checkPhaseEnd();
        }, 800);
    }

    // ... checkDeploy, deployUnit ...
    checkDeploy(targetHex) {
        if(!this.isValidHex(targetHex.q, targetHex.r) || this.map[targetHex.q][targetHex.r].id === -1) { this.log("配置不可: 進入不可能な地形です"); return false; }
        if(this.map[targetHex.q][targetHex.r].id === 5) { this.log("配置不可: 水上には配置できません"); return false; }
        const existing = this.units.find(u => u.q === targetHex.q && u.r === targetHex.r && u.hp > 0);
        if (existing) { this.log("配置不可: ユニットが既に存在します"); return false; }
        if (this.cardsUsed >= 2) { this.log("配置不可: 指揮コスト上限(2/2)に達しています"); return false; }
        return true;
    }
    deployUnit(targetHex, cardType) {
        if(!this.checkDeploy(targetHex)) return;
        const u = this.createSoldier(cardType, 'player', targetHex.q, targetHex.r);
        if(u) {
            this.units.push(u);
            this.cardsUsed++; 
            this.log(`増援到着: ${u.name} (残コスト:${2-this.cardsUsed})`);
            if(window.VFX) { const pos = Renderer.hexToPx(targetHex.q, targetHex.r); window.VFX.addSmoke(pos.x, pos.y); }
            this.updateSidebar();
        }
    }
    // ... calcReachableHexes, generateMap, spawnEnemies ...
    calcReachableHexes(u) {
        this.reachableHexes = []; if(!u) return;
        let frontier = [{q:u.q, r:u.r, cost:0}], costSoFar = new Map(); costSoFar.set(`${u.q},${u.r}`, 0);
        while(frontier.length > 0) {
            let current = frontier.shift();
            this.getNeighbors(current.q, current.r).forEach(n => {
                if(this.getUnit(n.q, n.r) || this.map[n.q][n.r].cost >= 99) return;
                let newCost = current.cost + this.map[n.q][n.r].cost;
                if(newCost <= u.ap) {
                    let key = `${n.q},${n.r}`;
                    if(!costSoFar.has(key) || newCost < costSoFar.get(key)) {
                        costSoFar.set(key, newCost); frontier.push({q:n.q, r:n.r, cost:newCost}); this.reachableHexes.push({q:n.q, r:n.r});
                    }
                }
            });
        }
    }
    generateMap() { 
        this.map = [];
        for(let q=0; q<MAP_W; q++){ this.map[q] = []; for(let r=0; r<MAP_H; r++){ this.map[q][r] = TERRAIN.VOID; } }
        const cx = Math.floor(MAP_W/2), cy = Math.floor(MAP_H/2);
        let walkers = [{q:cx, r:cy}]; 
        const paintBrush = (cq, cr) => {
            const brush = [{q:cq, r:cr}, ...this.getNeighbors(cq, cr)];
            brush.forEach(h => { if(this.isValidHex(h.q, h.r)) this.map[h.q][h.r] = TERRAIN.GRASS; });
        };
        for(let i=0; i<140; i++) {
            const wIdx = Math.floor(Math.random() * walkers.length); const w = walkers[wIdx]; paintBrush(w.q, w.r);
            const neighbors = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]]; const dir = neighbors[Math.floor(Math.random() * 6)];
            const next = { q: w.q + dir[0], r: w.r + dir[1] };
            if(Math.random() < 0.05 && walkers.length < 5) walkers.push(next); else walkers[wIdx] = next;
        }
        for(let i=0; i<3; i++) {
            for(let q=1; q<MAP_W-1; q++){ for(let r=1; r<MAP_H-1; r++){
                if(this.map[q][r].id === -1) { const ln = this.getNeighbors(q, r).filter(n => this.map[n.q][n.r].id !== -1).length; if(ln >= 4) this.map[q][r] = TERRAIN.GRASS; }
            }}
        }
        for(let loop=0; loop<2; loop++) {
            const wC = [];
            for(let q=0; q<MAP_W; q++){ for(let r=0; r<MAP_H; r++){ if(this.map[q][r].id === -1) { const hn = this.getNeighbors(q, r).some(n => this.map[n.q][n.r].id !== -1); if(hn) wC.push({q, r}); } }}
            wC.forEach(w => { this.map[w.q][w.r] = TERRAIN.WATER; });
        }
        for(let q=0; q<MAP_W; q++){ for(let r=0; r<MAP_H; r++){
            const tId = this.map[q][r].id;
            if(tId !== -1 && tId !== 5) {
                const n = Math.sin(q*0.4) + Math.cos(r*0.4) + Math.random()*0.4; 
                let t = TERRAIN.GRASS; if(n > 1.1) t = TERRAIN.FOREST; else if(n < -0.9) t = TERRAIN.DIRT; 
                if(t !== TERRAIN.WATER && Math.random() < 0.05) t = TERRAIN.TOWN; 
                this.map[q][r] = t;
            }
        }}
    }
    spawnEnemies(){ 
        const c=4+Math.floor(this.sector*0.7);
        for(let i=0;i<c;i++){ 
            let k='rifleman'; const r=Math.random(); 
            if(r<0.1 + this.sector*0.1) k='tank_pz4'; else if(r<0.4) k='gunner'; else if(r<0.6) k='sniper'; 
            const e=this.createSoldier(k, 'enemy', 0, 0); 
            if(e){
                const p = this.getSafeSpawnPos('enemy');
                e.q = p.q; e.r = p.r;
                this.units.push(e);
            }
        }
    }
    toggleAuto(){ this.isAuto=!this.isAuto; document.getElementById('auto-toggle').classList.toggle('active'); this.log(`AUTO: ${this.isAuto?"ON":"OFF"}`); }
    runAuto(){ /* 省略 */ }

    // ... actionMove, checkReactionFire, checkPhaseEnd, setStance, endTurn ...
    async actionMove(u,p){ 
        this.state='ANIM'; this.selectedUnit=null; this.path=[]; this.reachableHexes=[]; this.attackLine=[]; this.aimTargetUnit=null;
        for(let s of p){ u.ap-=this.map[s.q][s.r].cost; u.q=s.q; u.r=s.r; if(window.Sfx)Sfx.play('move'); await new Promise(r=>setTimeout(r,180)); } 
        this.checkReactionFire(u); 
        this.state='PLAY'; 
        if(u.ap>0){ this.selectedUnit=u; this.refreshUnitState(u); } else { this.updateSidebar(); }
        this.checkPhaseEnd(); 
    }
    checkReactionFire(u){ 
        this.units.filter(e=>e.team!==u.team && e.hp>0 && e.def.isTank && this.hexDist(u,e)<=2).forEach(t=>{ 
            this.log(`!! 防御射撃: ${t.name}->${u.name}`); u.hp-=15; 
            if(window.VFX)VFX.addExplosion(Renderer.hexToPx(u.q,u.r).x,Renderer.hexToPx(u.q,u.r).y,"#fa0",5); 
            if(window.Sfx)Sfx.play('mg'); 
            if(u.hp<=0&&!u.deadProcessed){u.deadProcessed=true;this.log(`${u.name} 撃破`);if(window.Sfx)Sfx.play('death');} 
        }); 
    }
    swapWeapon(){ /* 使用しない */ } 

    checkPhaseEnd(){if(this.units.filter(u=>u.team==='player'&&u.hp>0&&u.ap>0).length===0&&this.state==='PLAY')this.endTurn();}
    setStance(s){if(this.selectedUnit&&this.selectedUnit.ap>=1&&!this.selectedUnit.def.isTank){this.selectedUnit.ap--;this.selectedUnit.stance=s;this.refreshUnitState(this.selectedUnit);this.checkPhaseEnd();}}
    
    endTurn(){
        if(this.isProcessingTurn)return; this.isProcessingTurn=true; 
        this.selectedUnit=null; this.reachableHexes=[]; this.attackLine=[]; this.aimTargetUnit=null; this.path=[]; 
        this.state='ANIM'; 
        const eyecatch = document.getElementById('eyecatch');
        if(eyecatch) eyecatch.style.opacity=1;
        
        this.units.filter(u=>u.team==='player'&&u.hp>0&&u.skills.includes("Mechanic")).forEach(u=>{const c=u.skills.filter(s=>s==="Mechanic").length; if(u.hp<u.maxHp){u.hp=Math.min(u.maxHp,u.hp+c*20);this.log(`${u.name} 修理`);}});
        
        setTimeout(async()=>{
            if(eyecatch) eyecatch.style.opacity=0; 
            const es=this.units.filter(u=>u.team==='enemy'&&u.hp>0); 
            
            for(let e of es){
                const ps=this.units.filter(u=>u.team==='player'&&u.hp>0); 
                if(ps.length===0){this.checkLose();break;} 
                let target = ps[0]; let minDist = 999; 
                ps.forEach(p => { const d = this.hexDist(e, p); if(d < minDist){ minDist = d; target = p; } }); 
                e.ap = e.maxAp;
                const w = e.hands; 
                if(!w) continue;
                const distToTarget = this.hexDist(e, target); 
                if (distToTarget <= w.rng && e.ap >= w.ap) { 
                    await this.actionAttack(e, target); 
                } else { 
                    const p = this.findPath(e, target.q, target.r);
                    if(p.length > 0) {
                        const next = p[0]; 
                        if(this.map[next.q][next.r].cost <= e.ap) {
                            e.q = next.q; e.r = next.r; e.ap -= this.map[next.q][next.r].cost;
                            await new Promise(r=>setTimeout(r,200));
                            if(this.hexDist(e, target) <= w.rng && e.ap >= w.ap) {
                                await this.actionAttack(e, target);
                            }
                        }
                    }
                } 
            } 
            this.units.forEach(u=>{if(u.team==='player')u.ap=u.maxAp;}); 
            this.log("-- PLAYER PHASE --"); 
            this.state='PLAY'; this.isProcessingTurn=false;
        }, 1200);
    }
    
    // ... healSurvivors, promoteSurvivors, checkWin, checkLose, getUnit, isValidHex, hexDist, getNeighbors, findPath, log, showContext, getStatus ...
    healSurvivors(){this.units.filter(u=>u.team==='player'&&u.hp>0).forEach(u=>{const t=Math.floor(u.maxHp*0.8);if(u.hp<t)u.hp=t;});this.log("治療完了");}
    promoteSurvivors(){this.units.filter(u=>u.team==='player'&&u.hp>0).forEach(u=>{u.sectorsSurvived++; if(u.sectorsSurvived===5){u.skills.push("Hero");u.maxAp++;this.log("英雄昇格");} u.rank=Math.min(5,(u.rank||0)+1); u.maxHp+=30; u.hp+=30; if(u.skills.length<8&&Math.random()<0.7){const k=Object.keys(SKILLS).filter(z=>z!=="Hero"); u.skills.push(k[Math.floor(Math.random()*k.length)]); this.log("スキル習得");} });}
    checkWin(){if(this.units.filter(u=>u.team==='enemy'&&u.hp>0).length===0){if(window.Sfx)Sfx.play('win'); document.getElementById('reward-screen').style.display='flex'; this.promoteSurvivors(); const b=document.getElementById('reward-cards'); b.innerHTML=''; [{k:'rifleman',t:'新兵'},{k:'tank_pz4',t:'戦車'},{k:'heal',t:'医療'}].forEach(o=>{const d=document.createElement('div');d.className='card';d.innerHTML=`<div class="card-img-box"><img src="${createCardIcon(o.k==='heal'?'heal':'infantry')}"></div><div class="card-body"><h3>${o.t}</h3><p>補給</p></div>`;d.onclick=()=>{if(o.k==='heal')this.healSurvivors();else this.spawnAtSafeGround('player',o.k);this.sector++;document.getElementById('reward-screen').style.display='none';this.startCampaign();};b.appendChild(d);}); return true;} return false;}
    checkLose(){if(this.units.filter(u=>u.team==='player'&&u.hp>0).length===0)document.getElementById('gameover-screen').style.display='flex';}
    getUnit(q,r){return this.units.find(u=>u.q===q&&u.r===r&&u.hp>0);}
    isValidHex(q,r){return q>=0&&q<MAP_W&&r>=0&&r<MAP_H;}
    hexDist(a,b){return (Math.abs(a.q-b.q)+Math.abs(a.q+a.r-b.q-b.r)+Math.abs(a.r-b.r))/2;}
    getNeighbors(q,r){return [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]].map(d=>({q:q+d[0],r:r+d[1]})).filter(h=>this.isValidHex(h.q,h.r));}
    findPath(u,tq,tr){let f=[{q:u.q,r:u.r}],cf={},cs={}; cf[`${u.q},${u.r}`]=null; cs[`${u.q},${u.r}`]=0; while(f.length>0){let c=f.shift();if(c.q===tq&&c.r===tr)break; this.getNeighbors(c.q,c.r).forEach(n=>{if(this.getUnit(n.q,n.r)&&(n.q!==tq||n.r!==tr))return; const cost=this.map[n.q][n.r].cost; if(cost>=99)return; const nc=cs[`${c.q},${c.r}`]+cost; if(nc<=u.ap){const k=`${n.q},${n.r}`;if(!(k in cs)||nc<cs[k]){cs[k]=nc;f.push(n);cf[k]=c;}}});} let p=[],c={q:tq,r:tr}; if(!cf[`${tq},${tr}`])return[]; while(c){if(c.q===u.q&&c.r===u.r)break;p.push(c);c=cf[`${c.q},${c.r}`];} return p.reverse();}
    log(m){const c=document.getElementById('log-container'); if(c){ const d=document.createElement('div');d.className='log-entry';d.innerText=`> ${m}`;c.appendChild(d);c.scrollTop=c.scrollHeight; }}
    showContext(mx,my){}
    getStatus(u){if(u.hp<=0)return "DEAD";const r=u.hp/u.maxHp;if(r>0.8)return "NORMAL";if(r>0.5)return "DAMAGED";return "CRITICAL";}
    
    // ★UI更新: インベントリ構築とドラッグ＆ドロップ
    updateSidebar(){
        const ui=document.getElementById('unit-info'),u=this.selectedUnit;
        if(u){
            const w=u.hands;
            const s=this.getStatus(u);
            const skillCounts = {}; u.skills.forEach(sk => { skillCounts[sk] = (skillCounts[sk] || 0) + 1; });
            let skillHtml = "";
            for (const [sk, count] of Object.entries(skillCounts)) {
                if (window.SKILL_STYLES && window.SKILL_STYLES[sk]) {
                    const st = window.SKILL_STYLES[sk];
                    skillHtml += `<div style="display:inline-block; background:${st.col}; color:#000; font-weight:bold; font-size:10px; padding:2px 5px; margin:2px; border-radius:3px;">${st.icon} ${st.name} x${count}</div>`;
                }
            }
            const faceUrl = (Renderer.generateFaceIcon) ? Renderer.generateFaceIcon(u.faceSeed) : "";

            // スロットHTML生成
            const makeSlot = (item, type, index) => {
                if (!item) return `<div class="slot empty" ondragover="onSlotDragOver(event)" ondragleave="onSlotDragLeave(event)" ondrop="onSlotDrop(event, '${type}', ${index})"><div style="font-size:10px; color:#555;">[EMPTY]</div></div>`;
                
                const isMain = (type === 'main');
                const isAmmo = (item.type === 'ammo');
                const width = (item.cap > 0) ? (item.current / item.cap) * 100 : 0;
                
                return `
                <div class="slot ${isMain?'main-weapon':'bag-item'}" 
                     draggable="true" ondragstart="onSlotDragStart(event, '${type}', ${index})" ondragend="onSlotDragEnd(event)" ondragover="onSlotDragOver(event)" ondragleave="onSlotDragLeave(event)" ondrop="onSlotDrop(event, '${type}', ${index})">
                    <div class="slot-name">${isMain?'🔫':''} ${item.name}</div>
                    ${!isAmmo ? `<div class="slot-meta"><span>RNG:${item.rng} DMG:${item.dmg}</span> <span class="ammo-text">${item.current}/${item.cap}</span></div>` : `<div class="slot-meta" style="color:#d84">AMMO for ${item.ammoFor}</div>`}
                    ${!isAmmo && item.cap > 0 ? `<div class="ammo-bar"><div class="ammo-fill" style="width:${width}%"></div></div>` : ''}
                </div>`;
            };

            const mainSlot = makeSlot(u.hands, 'main', 0);
            let subSlots = "";
            for(let i=0; i<4; i++) {
                subSlots += makeSlot(u.bag[i], 'bag', i);
            }

            // 予備マガジンがあるかチェック
            let canReload = false;
            if (w && w.current < w.cap && u.bag.some(i => i && i.type==='ammo' && i.ammoFor===w.code)) canReload = true;
            
            let reloadBtn = canReload ? `<button onclick="gameLogic.reloadWeapon()" style="width:100%; background:#442; color:#dd4; border:1px solid #884; cursor:pointer; margin-top:5px;">🔃 RELOAD (${w.rld||1} AP)</button>` : "";

            ui.innerHTML=`
                <div class="soldier-header">
                    <div class="face-box"><img src="${faceUrl}" width="64" height="64"></div>
                    <div>
                        <div class="soldier-name">${u.name}</div>
                        <div class="soldier-rank">${RANKS[u.rank] || 'Pvt'}</div>
                    </div>
                </div>
                <div class="stat-grid">
                    <div class="stat-row"><span class="stat-label">HP</span> <span class="stat-val">${u.hp}/${u.maxHp}</span></div>
                    <div class="stat-row"><span class="stat-label">AP</span> <span class="stat-val">${u.ap}/${u.maxAp}</span></div>
                    <div class="stat-row"><span class="stat-label">AIM</span> <span class="stat-val">${u.stats?.aim||'-'}</span></div>
                    <div class="stat-row"><span class="stat-label">STR</span> <span class="stat-val">${u.stats?.str||'-'}</span></div>
                </div>
                
                <div class="inv-header" style="padding:0 10px; margin-top:10px;">LOADOUT (Drag to Swap)</div>
                <div class="loadout-container">
                    <div class="main-slot-area">${mainSlot}</div>
                    <div class="sub-slot-area">${subSlots}</div>
                </div>
                <div style="padding:0 10px;">${reloadBtn}</div>

                <div style="margin:5px 0; padding:0 10px;">${skillHtml}</div>
                <div style="padding:10px;">
                    <div style="font-size:10px; color:#666;">TACTICS</div>
                    <button class="btn-stance ${u.stance==='stand'?'active-stance':''}" onclick="gameLogic.setStance('stand')">STAND</button>
                    <button class="btn-stance ${u.stance==='crouch'?'active-stance':''}" onclick="gameLogic.setStance('crouch')">CROUCH</button>
                    <button class="btn-stance ${u.stance==='prone'?'active-stance':''}" onclick="gameLogic.setStance('prone')">PRONE</button>
                    <button onclick="gameLogic.endTurn()" class="${this.state!=='PLAY'?'disabled':''}" style="width:100%; background:#522; border-color:#d44; margin-top:15px; padding:5px; color:#fcc;">End Turn</button>
                </div>
            `;
            if(u.def.isTank) document.querySelectorAll('.btn-stance').forEach(b=>b.classList.add('disabled'));
        } else {
            ui.innerHTML=`<div style="text-align:center;color:#555;margin-top:80px;">// NO SIGNAL //</div>`;
        }
    }
}
window.gameLogic = new Game();

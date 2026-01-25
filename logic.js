/** LOGIC: 4-Stack Limit, Action Menu & New Commands */
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
        
        // ★インタラクションモード管理
        this.interactionMode = 'SELECT'; // SELECT, MOVE, ATTACK, REPAIR, HEAL, MELEE
        this.selectedUnit = null;
        
        this.initDOM(); this.initSetup();
    }
    
    initDOM() {
        Renderer.init(document.getElementById('game-view'));
        window.addEventListener('click', (e)=>{
            if(!e.target.closest('#context-menu')) document.getElementById('context-menu').style.display='none';
            // コマンドメニュー外をクリックしたら閉じる（ただしボタン自体は除く）
            if(!e.target.closest('#command-menu') && !e.target.closest('canvas')) {
                this.hideActionMenu();
            }
        });
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
                    d.querySelector('.card-badge').style.display = 'flex'; // block->flex
                    this.log(`> 採用: ${t.name}`);
                    if(this.setupSlots.length===3) document.getElementById('btn-start').style.display='inline-block';
                }
            }; box.appendChild(d);
        });
    }

    createSoldier(templateKey, team, q, r) {
        const t = UNIT_TEMPLATES[templateKey];
        if(!t) return null;
        const isPlayer = (team === 'player');
        const stats = { ...t.stats };
        if (isPlayer && !t.isTank) { ['str','aim','mob','mor'].forEach(k => stats[k] = (stats[k]||0) + Math.floor(Math.random()*3)-1); }
        let name = t.name; let rank = 0; let faceSeed = Math.floor(Math.random() * 99999);
        if (isPlayer && !t.isTank) {
            const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
            const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
            name = `${last} ${first}`; 
        }
        const createItem = (key, isMainWpn = false) => {
            if(!key || !WPNS[key]) return null;
            let base = WPNS[key];
            let item = { ...base, code: key, id: Math.random(), isBroken: false }; // isBroken追加
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
            return item;
        };
        let hands = null; let bag = [];
        if (t.main) hands = createItem(t.main, true);
        if (t.sub) bag.push(createItem(t.sub));
        if (t.opt) { const optBase = WPNS[t.opt]; const count = optBase.mag || 1; for(let i=0; i<count; i++) bag.push(createItem(t.opt)); }
        if (hands && hands.mag && !hands.isConsumable) {
            for(let i=0; i<hands.mag; i++) { if (bag.length >= 4) break; bag.push({ type: 'ammo', name: (hands.magName || 'Clip'), ammoFor: hands.code, cap: hands.cap, jam: hands.jam, code: 'mag' }); }
        }
        if (!isPlayer) { if(hands) hands.current = 999; bag = []; }
        return {
            id: Math.random(), team: team, q: q, r: r, def: t, name: name, rank: rank, faceSeed: faceSeed, stats: stats, 
            hp: t.hp || (80 + (stats.str||0) * 5), maxHp: t.hp || (80 + (stats.str||0) * 5),
            ap: t.ap || Math.floor((stats.mob||0)/2) + 3, maxAp: t.ap || Math.floor((stats.mob||0)/2) + 3,
            hands: hands, bag: bag, stance: 'stand', skills: [], sectorsSurvived: 0, deadProcessed: false, curWpn: hands ? hands.code : 'unarmed'
        };
    }

    // ★重要: 同一ヘックスのユニット取得
    getUnitsInHex(q, r) {
        return this.units.filter(u => u.q === q && u.r === r && u.hp > 0);
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
            this.setupSlots.forEach(k => { const p = this.getSafeSpawnPos('player'); const u = this.createSoldier(k, 'player', p.q, p.r); this.units.push(u); });
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
            // ★修正: 4体未満ならOK
            if (this.isValidHex(q,r) && this.getUnitsInHex(q,r).length < 4 && this.map[q][r].id !== -1 && this.map[q][r].id !== 5) {
                return {q, r};
            }
        }
        return {q:0, r:0};
    }

    // --- ★インタラクション & コマンドメニュー ---
    
    // ユニットクリック（Phaserから呼ばれる）
    onUnitClick(u) {
        if (this.state !== 'PLAY') return;
        if (u.team !== 'player') {
            // 敵をクリックした場合: 攻撃モードなら攻撃実行
            if (this.interactionMode === 'ATTACK' && this.selectedUnit) {
                this.actionAttack(this.selectedUnit, u);
                this.setMode('SELECT');
                return;
            }
            if (this.interactionMode === 'MELEE' && this.selectedUnit) {
                this.actionMelee(this.selectedUnit, u);
                this.setMode('SELECT');
                return;
            }
            // それ以外は無視（または敵情報表示？）
            return;
        }

        // 味方をクリック -> 選択
        this.selectedUnit = u;
        this.refreshUnitState(u);
        
        // メニュー表示
        const pxPos = Renderer.hexToPx(u.q, u.r);
        // スクリーン座標に変換（簡易計算。本来はCameraのMatrix計算が必要だが、HTML座標系で近似）
        // ※Phaserのイベントポインタ位置を使うのが確実だが、ここではユニット位置から出す
        // 一旦、画面中央付近に出すのではなく、クリックした場所に出したいが…
        // 面倒なので「最後にクリックした場所」をPhaser側で保持してもらうのがいいが、
        // ここでは「最後にクリックされたユニット」に対してメニューを出す。
        
        this.showActionMenu(u);
        if(window.Sfx) Sfx.play('click');
    }

    showActionMenu(u) {
        const menu = document.getElementById('command-menu');
        if (!menu) return;

        // 各ボタンの有効無効判定
        const btnRepair = document.getElementById('btn-repair');
        const btnMelee = document.getElementById('btn-melee');
        const btnHeal = document.getElementById('btn-heal');

        // 修理: 武器が壊れているか
        if (u.hands && u.hands.isBroken) btnRepair.classList.remove('disabled'); else btnRepair.classList.add('disabled');

        // 白兵: 同一ヘックスに敵がいるか
        const neighbors = this.getUnitsInHex(u.q, u.r);
        const hasEnemy = neighbors.some(n => n.team !== u.team);
        if (hasEnemy) btnMelee.classList.remove('disabled'); else btnMelee.classList.add('disabled');

        // 治療: 同一ヘックスに傷ついた味方がいるか (自分含む？含むことにする)
        const hasWounded = neighbors.some(n => n.team === u.team && n.hp < n.maxHp);
        if (hasWounded) btnHeal.classList.remove('disabled'); else btnHeal.classList.add('disabled');

        // 表示位置調整 (マウス位置が取れないので、Canvas上のユニット位置をDOM座標に変換…は手間なので、固定位置 or 前回のクリック位置)
        // 簡易的に画面中央に出す、あるいはCSSで制御するが、ここでは暫定的にマウスカーソル追従はできないため
        // メニューを「右サイドバーの横」あたりに出すか、前回クリック位置を保存しておく
        
        // ★PhaserのInputPluginからアクティブポインタを取得
        if (Renderer.game) {
            const pointer = Renderer.game.input.activePointer;
            menu.style.left = (pointer.x + 20) + 'px';
            menu.style.top = (pointer.y - 50) + 'px';
        }
        
        menu.style.display = 'block';
    }

    hideActionMenu() {
        const menu = document.getElementById('command-menu');
        if(menu) menu.style.display = 'none';
    }

    setMode(mode) {
        this.interactionMode = mode;
        this.hideActionMenu();
        const indicator = document.getElementById('mode-label');
        
        if (mode === 'SELECT') {
            indicator.style.display = 'none';
            this.path = []; this.attackLine = [];
        } else {
            indicator.style.display = 'block';
            indicator.innerText = mode + " MODE";
            // モードに応じたガイド表示
            if (mode === 'MOVE') {
                this.calcReachableHexes(this.selectedUnit);
            } else if (mode === 'ATTACK') {
                // 射程範囲表示などをしたいが、既存のhoverロジックで対応
                this.reachableHexes = []; // 移動範囲は消す
            }
        }
    }

    // ヘックスクリック（移動などの座標指定）
    handleClick(p) {
        if (this.interactionMode === 'SELECT') {
            // 何もしない（ユニットクリックはonUnitClickで処理済み）
            // 地面クリックで選択解除
            const u = this.getUnitInHex(p.q, p.r); // ヘックス内の誰か
            if (!u) this.clearSelection();
        } 
        else if (this.interactionMode === 'MOVE') {
            if (this.isValidHex(p.q, p.r) && this.path.length > 0) {
                // パスの終点がクリック地点か確認
                const last = this.path[this.path.length-1];
                if (last.q === p.q && last.r === p.r) {
                    this.actionMove(this.selectedUnit, this.path);
                    this.setMode('SELECT');
                }
            } else {
                // 移動キャンセル
                this.setMode('SELECT');
            }
        }
        else if (this.interactionMode === 'ATTACK' || this.interactionMode === 'MELEE') {
            // ターゲット選択待ち (onUnitClickで処理されるが、地面をクリックしたらキャンセル)
            const u = this.getUnitInHex(p.q, p.r);
            if (!u) this.setMode('SELECT');
        }
    }

    handleHover(p) {
        if(this.state !== 'PLAY') return; this.hoverHex = p;
        const u = this.selectedUnit;
        if (u) {
            if (this.interactionMode === 'MOVE') {
                // 移動パス計算
                const isReachable = this.reachableHexes.some(h => h.q === p.q && h.r === p.r);
                // ★修正: 4体制限チェック
                const targetUnits = this.getUnitsInHex(p.q, p.r);
                if (isReachable && targetUnits.length < 4) {
                    this.path = this.findPath(u, p.q, p.r);
                } else {
                    this.path = [];
                }
            } else if (this.interactionMode === 'ATTACK') {
                // 射線計算
                this.calcAttackLine(u, p.q, p.r);
            }
        }
    }

    // --- アクション実装 ---

    toggleStance() {
        const u = this.selectedUnit;
        if (!u || u.ap < 1 || u.def.isTank) return;
        u.ap -= 1;
        if (u.stance === 'stand') u.stance = 'crouch';
        else if (u.stance === 'crouch') u.stance = 'prone';
        else u.stance = 'stand';
        this.refreshUnitState(u);
        this.hideActionMenu();
        if(window.Sfx) Sfx.play('click');
    }

    actionRepair() {
        const u = this.selectedUnit;
        if (!u || u.ap < 2) { this.log("AP不足 (必要:2)"); return; }
        if (!u.hands || !u.hands.isBroken) { this.log("修理不要"); return; }
        
        u.ap -= 2;
        u.hands.isBroken = false;
        this.log(`${u.name} 武器修理完了`);
        if(window.Sfx) Sfx.play('reload'); // カチャカチャ音
        this.refreshUnitState(u);
        this.hideActionMenu();
    }

    actionHeal() {
        const u = this.selectedUnit;
        if (!u || u.ap < 2) { this.log("AP不足 (必要:2)"); return; }
        
        // 同ヘックスの傷ついた味方を探す
        const targets = this.getUnitsInHex(u.q, u.r).filter(t => t.team === u.team && t.hp < t.maxHp);
        if (targets.length === 0) { this.log("治療対象なし"); return; }
        
        // 最も傷ついている者を治療
        targets.sort((a,b) => (a.hp/a.maxHp) - (b.hp/b.maxHp));
        const target = targets[0];
        
        u.ap -= 2;
        const healAmount = 30;
        target.hp = Math.min(target.maxHp, target.hp + healAmount);
        
        this.log(`${u.name} が ${target.name} を治療 (+${healAmount})`);
        if(window.VFX) { const p = Renderer.hexToPx(u.q, u.r); window.VFX.add({x:p.x, y:p.y-20, vx:0, vy:-1, life:30, maxLife:30, color:"#0f0", size:4, type:'spark'}); }
        
        this.refreshUnitState(u);
        this.hideActionMenu();
    }

    async actionMelee(a, d) {
        if (!a || a.ap < 2) { this.log("AP不足"); return; }
        if (a.q !== d.q || a.r !== d.r) { this.log("射程外(同一ヘックスのみ)"); return; }
        
        a.ap -= 2;
        this.log(`${a.name} 白兵攻撃 vs ${d.name}`);
        
        // アニメーション
        if (Renderer.playAttackAnim) Renderer.playAttackAnim(a, d);
        await new Promise(r => setTimeout(r, 300));

        // 命中判定 (白兵は命中高い)
        // 武器があればそのダメージ、なければ素手(10)
        let dmg = 15 + (a.stats.str * 2);
        if (a.hands && a.hands.type === 'melee') dmg = a.hands.dmg; // ナイフ等
        
        // 反撃判定 (CQCスキルなど)
        if (d.skills.includes('CQC')) {
            this.log(`>> ${d.name} カウンター！`);
            a.hp -= 10;
        }

        d.hp -= dmg;
        if(window.Sfx) Sfx.play('hit');
        
        if (d.hp <= 0 && !d.deadProcessed) {
            d.deadProcessed = true;
            this.log(`>> ${d.name} を撃破！`);
            if(window.Sfx) Sfx.play('death');
        }
        
        this.refreshUnitState(a);
        this.checkPhaseEnd();
    }

    async actionAttack(a, d) {
        const w = a.hands; 
        if (!w) return;
        if (w.isBroken) { this.log("武器故障中！修理が必要"); return; } // ★チェック追加
        if (w.isConsumable && w.current <= 0) { this.log("使用済みです"); return; }
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

        const shots = w.isConsumable ? 1 : Math.min(w.burst || 1, w.current);
        this.log(`${a.name} 攻撃開始 (${w.name})`);

        for(let i=0; i<shots; i++) {
            if (d.hp <= 0) break;
            
            // ★ジャム判定 & 故障処理
            if (!w.isConsumable && w.jam && Math.random() < w.jam) {
                this.log(`⚠ JAM!! ${w.name}が故障！`);
                w.isBroken = true; // ★故障フラグ
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

            const flightTime = w.type.includes('shell') ? dist * 100 : dist * 50;
            if(window.VFX) VFX.addProj({ x: sPos.x, y: sPos.y, sx: sPos.x, sy: sPos.y, ex: tx, ey: ty, type: w.type, speed: 0.1, progress: 0, arcHeight: (w.type.includes('shell')?100:0), onHit: null });

            setTimeout(() => {
                if (d.hp <= 0) return; 
                const isHit = (Math.random() * 100) < hitChance;
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
            }, flightTime);
            await new Promise(r => setTimeout(r, 100)); 
        }
        
        if (w.isConsumable && w.current <= 0) {
            a.hands = null; 
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

    // ★修正: 4体制限
    checkDeploy(targetHex) {
        if(!this.isValidHex(targetHex.q, targetHex.r) || this.map[targetHex.q][targetHex.r].id === -1) { this.log("配置不可: 進入不可能な地形です"); return false; }
        if(this.map[targetHex.q][targetHex.r].id === 5) { this.log("配置不可: 水上には配置できません"); return false; }
        if (this.getUnitsInHex(targetHex.q, targetHex.r).length >= 4) { this.log("配置不可: 混雑しています"); return false; }
        if (this.cardsUsed >= 2) { this.log("配置不可: 指揮コスト上限(2/2)に達しています"); return false; }
        return true;
    }

    calcReachableHexes(u) {
        this.reachableHexes = []; if(!u) return;
        let frontier = [{q:u.q, r:u.r, cost:0}], costSoFar = new Map(); costSoFar.set(`${u.q},${u.r}`, 0);
        while(frontier.length > 0) {
            let current = frontier.shift();
            this.getNeighbors(current.q, current.r).forEach(n => {
                // ★修正: ユニットがいても4体未満なら通れる
                if(this.getUnitsInHex(n.q, n.r).length >= 4 || this.map[n.q][n.r].cost >= 99) return;
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

    // 既存ヘルパー (getUnitは代表1体を返す互換性のため残すが、getUnitsInHex推奨)
    getUnit(q,r){return this.units.find(u=>u.q===q&&u.r===r&&u.hp>0);}
    getUnitInHex(q,r){return this.getUnit(q,r);} // Alias
    
    // ... その他メソッド (generateMap, spawnEnemies, actionMove, endTurn, etc.) ...
    // これらは変更なしだが、moveUnit内のチェックなどは calcReachableHexes で担保されている前提
    
    // 省略部分は既存のまま (generateMap, spawnEnemies, toggleAuto, runAuto, checkReactionFire, swapWeapon, checkPhaseEnd, setStance, endTurn, healSurvivors, promoteSurvivors, checkWin, checkLose, isValidHex, hexDist, getNeighbors, findPath, log, updateSidebar, axialToCube, cubeToAxial, cubeRound)
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

    async actionMove(u,p){ 
        this.state='ANIM'; 
        // this.selectedUnit=null; // 移動後も選択解除しないほうが連続操作しやすいかも？一旦解除
        this.path=[]; this.reachableHexes=[]; this.attackLine=[]; this.aimTargetUnit=null;
        for(let s of p){ 
            // 敵がいたら止まる？ 今回は混在OKなので素通り
            u.ap-=this.map[s.q][s.r].cost; u.q=s.q; u.r=s.r; 
            if(window.Sfx)Sfx.play('move'); 
            await new Promise(r=>setTimeout(r,180)); 
        } 
        this.checkReactionFire(u); 
        this.state='PLAY'; 
        this.refreshUnitState(u); // 選択継続
        this.checkPhaseEnd(); 
    }
    checkReactionFire(u){ 
        this.units.filter(e=>e.team!==u.team && e.hp>0 && e.def.isTank && this.hexDist(u,e)<=1).forEach(t=>{ 
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
        this.hideActionMenu();
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
    
    healSurvivors(){this.units.filter(u=>u.team==='player'&&u.hp>0).forEach(u=>{const t=Math.floor(u.maxHp*0.8);if(u.hp<t)u.hp=t;});this.log("治療完了");}
    promoteSurvivors(){this.units.filter(u=>u.team==='player'&&u.hp>0).forEach(u=>{u.sectorsSurvived++; if(u.sectorsSurvived===5){u.skills.push("Hero");u.maxAp++;this.log("英雄昇格");} u.rank=Math.min(5,(u.rank||0)+1); u.maxHp+=30; u.hp+=30; if(u.skills.length<8&&Math.random()<0.7){const k=Object.keys(SKILLS).filter(z=>z!=="Hero"); u.skills.push(k[Math.floor(Math.random()*k.length)]); this.log("スキル習得");} });}
    checkWin(){if(this.units.filter(u=>u.team==='enemy'&&u.hp>0).length===0){if(window.Sfx)Sfx.play('win'); document.getElementById('reward-screen').style.display='flex'; this.promoteSurvivors(); const b=document.getElementById('reward-cards'); b.innerHTML=''; [{k:'rifleman',t:'新兵'},{k:'tank_pz4',t:'戦車'},{k:'heal',t:'医療'}].forEach(o=>{const d=document.createElement('div');d.className='card';d.innerHTML=`<div class="card-img-box"><img src="${createCardIcon(o.k==='heal'?'heal':'infantry')}"></div><div class="card-body"><h3>${o.t}</h3><p>補給</p></div>`;d.onclick=()=>{if(o.k==='heal')this.healSurvivors();else this.spawnAtSafeGround('player',o.k);this.sector++;document.getElementById('reward-screen').style.display='none';this.startCampaign();};b.appendChild(d);}); return true;} return false;}
    checkLose(){if(this.units.filter(u=>u.team==='player'&&u.hp>0).length===0)document.getElementById('gameover-screen').style.display='flex';}
    isValidHex(q,r){return q>=0&&q<MAP_W&&r>=0&&r<MAP_H;}
    hexDist(a,b){return (Math.abs(a.q-b.q)+Math.abs(a.q+a.r-b.q-b.r)+Math.abs(a.r-b.r))/2;}
    getNeighbors(q,r){return [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]].map(d=>({q:q+d[0],r:r+d[1]})).filter(h=>this.isValidHex(h.q,h.r));}
    findPath(u,tq,tr){let f=[{q:u.q,r:u.r}],cf={},cs={}; cf[`${u.q},${u.r}`]=null; cs[`${u.q},${u.r}`]=0; while(f.length>0){let c=f.shift();if(c.q===tq&&c.r===tr)break; this.getNeighbors(c.q,c.r).forEach(n=>{if(this.getUnitsInHex(n.q,n.r).length>=4 && (n.q!==tq||n.r!==tr))return; const cost=this.map[n.q][n.r].cost; if(cost>=99)return; const nc=cs[`${c.q},${c.r}`]+cost; if(nc<=u.ap){const k=`${n.q},${n.r}`;if(!(k in cs)||nc<cs[k]){cs[k]=nc;f.push(n);cf[k]=c;}}});} let p=[],c={q:tq,r:tr}; if(!cf[`${tq},${tr}`])return[]; while(c){if(c.q===u.q&&c.r===u.r)break;p.push(c);c=cf[`${c.q},${c.r}`];} return p.reverse();}
    log(m){const c=document.getElementById('log-container'); if(c){ const d=document.createElement('div');d.className='log-entry';d.innerText=`> ${m}`;c.appendChild(d);c.scrollTop=c.scrollHeight; }}
    
    // updateSidebar (変更なし)
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
                    <button class="btn-stance ${u.stance==='stand'?'active-stance':''}" onclick="gameLogic.toggleStance()">STANCE</button>
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

/** LOGIC UI: Full Features (Resize, D&D, Logging) */

class UIManager {
    constructor(game) {
        this.game = game;
        this.menuSafeLock = false;
        this.dragSrc = null; 
        
        // リサイズ管理用フラグ
        this.isResizing = false;

        this.bindEvents();
        this.initResizer(); // リサイザー初期化
        
        window.onSlotDragStart = (e, type, index) => this.handleDragStart(e, type, index);
        window.onSlotDragOver = (e) => this.handleDragOver(e);
        window.onSlotDrop = (e, type, index) => this.handleDrop(e, type, index);
    }

    bindEvents() {
        window.addEventListener('click', (e) => {
            if (this.menuSafeLock) return;
            if (!e.target.closest('#context-menu')) document.getElementById('context-menu').style.display = 'none';
            if (!e.target.closest('#command-menu') && !e.target.closest('canvas')) { this.hideActionMenu(); }
        });
        const stopPropagation = (e) => { e.stopPropagation(); };
        const menuIds = ['context-menu', 'command-menu', 'setup-screen', 'reward-screen', 'gameover-screen', 'battle-log-window', 'debug-window'];
        menuIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('mousedown', stopPropagation);
                el.addEventListener('pointerdown', stopPropagation);
                el.addEventListener('touchstart', stopPropagation, { passive: false });
                el.addEventListener('wheel', stopPropagation, { passive: false });
            }
        });
        
        const style = document.createElement('style');
        style.innerHTML = `
            .slot.synergy-active {
                box-shadow: 0 0 8px #4f4, inset 0 0 10px #4f4 !important;
                border-color: #8f8 !important;
                animation: synergy-pulse 1.5s infinite alternate;
            }
            @keyframes synergy-pulse {
                from { box-shadow: 0 0 5px #2d2; }
                to { box-shadow: 0 0 12px #6f6; }
            }
            .slot[draggable="true"] { cursor: grab; }
            .slot:active { cursor: grabbing; }

            /* 射撃ボタンの弾数撃ち分けUI */
            #command-menu .cmd-btn.burst-mode {
                position: relative;
                overflow: hidden;
            }
            #command-menu .cmd-btn.burst-mode .burst-container {
                position: absolute;
                inset: 0;
                display: flex;
                pointer-events: none;
            }
            #command-menu .cmd-btn.burst-mode .burst-option {
                flex: 1;
                font-size: 11px;
                text-align: center;
                line-height: 24px;
                background: rgba(16,16,16,0.92);
                border-left: 1px solid #333;
                color: #ffd;
                pointer-events: auto;
                cursor: pointer;
                user-select: none;
            }
            #command-menu .cmd-btn.burst-mode .burst-option:first-child {
                border-left: none;
            }
            #command-menu .cmd-btn.burst-mode .burst-option:hover {
                background: rgba(80,60,20,0.95);
                color: #fff7c0;
            }
            #command-menu .cmd-btn.burst-mode .burst-label {
                opacity: 0.4;
            }
        `;
        document.head.appendChild(style);
    }

    // --- Resizer Logic ---
    initResizer() {
        const resizer = document.getElementById('resizer');
        const sidebar = document.getElementById('sidebar');
        if (!resizer || !sidebar) return;

        resizer.addEventListener('mousedown', (e) => {
            const app = document.getElementById('app');
            if (app && app.classList.contains('phaser-sidebar')) return;
            e.preventDefault();
            this.isResizing = true;
            document.body.style.cursor = 'col-resize';
            // ドラッグ中はトランジションを無効化して追従性を良くする
            sidebar.style.transition = 'none';
            resizer.style.transition = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.isResizing) return;
            // 右端からの距離を計算
            const newWidth = window.innerWidth - e.clientX;
            
            // 最小・最大幅の制限 (例えば 200px ~ 800px)
            if (newWidth > 200 && newWidth < 800) {
                sidebar.style.width = `${newWidth}px`;
                resizer.style.right = `${newWidth}px`;
            }
        });

        document.addEventListener('mouseup', () => {
            if (this.isResizing) {
                this.isResizing = false;
                document.body.style.cursor = '';
                // トランジションを復元
                sidebar.style.transition = ''; 
                resizer.style.transition = '';
            }
        });
    }

    toggleSidebar() {
        const sb = document.getElementById('sidebar');
        const resizer = document.getElementById('resizer');
        if (!sb) return;

        sb.classList.toggle('collapsed');
        
        // リサイザーの位置も連動させる
        if (resizer) {
            if (sb.classList.contains('collapsed')) {
                resizer.style.right = '0px';
            } else {
                // 現在のスタイル幅、またはデフォルト幅(340px)に戻す
                resizer.style.right = sb.style.width || '340px';
            }
        }
    }
    setSidebarVisible(visible) {
        const sb = document.getElementById('sidebar');
        const resizer = document.getElementById('resizer');
        const toggleBtn = document.getElementById('sidebar-toggle'); // index.htmlのIDと一致させる

        const displayStyle = visible ? 'block' : 'none';

        if (sb) sb.style.display = displayStyle;
        if (resizer) resizer.style.display = displayStyle;
        if (toggleBtn) toggleBtn.style.display = displayStyle;
        
        // 非表示にする際は、マップ描画領域（#game-container）を全幅に広げるなどの調整が必要ならここで行う
        // 今回はオーバーレイ画面が出る前提なので、単に隠すだけでOK
    }
    handleDragStart(e, type, index) {
        this.dragSrc = { type, index };
        e.dataTransfer.effectAllowed = 'move';
    }

    handleDragOver(e) {
        e.preventDefault(); 
        e.dataTransfer.dropEffect = 'move';
    }

    handleDrop(e, type, index) {
        e.preventDefault();
        if (this.dragSrc) {
            // BattleLogicへの委譲（gameLogic経由）
            if(window.gameLogic && window.gameLogic.swapEquipment) {
                window.gameLogic.swapEquipment(this.dragSrc, { type, index });
            }
            this.dragSrc = null;
        }
    }

    log(m) {
        const logWin = document.getElementById('battle-log-window');
        const logBody = document.getElementById('battle-log-body');
        if (logWin && logBody) {
            logWin.style.display = 'flex';
            const d = document.createElement('div'); d.className = 'log-entry'; d.textContent = '> ' + m;
            logBody.appendChild(d); logBody.scrollTop = logBody.scrollHeight;
            return;
        }
        const c = document.getElementById('log-container');
        if (c) {
            const d = document.createElement('div'); d.className = 'log-entry'; d.innerText = `> ${m}`;
            c.appendChild(d); c.scrollTop = c.scrollHeight;
        }
    }

    showActionMenu(u, px, py) {
        const menu = document.getElementById('command-menu'); if (!menu) return;
        this.menuSafeLock = true; setTimeout(() => { this.menuSafeLock = false; }, 300);
        
        const btnMove = document.getElementById('btn-move'); 
        const btnAttack = document.getElementById('btn-attack');
        const btnRepair = document.getElementById('btn-repair'); 
        const btnMelee = document.getElementById('btn-melee'); 
        const btnHeal = document.getElementById('btn-heal');
        const grpStance = menu.querySelector('.cmd-group'); 

        const setEnabled = (btn, enabled) => { if(enabled) btn.classList.remove('disabled'); else btn.classList.add('disabled'); };
        
        const rtwp = window.RtwpBattle && window.RtwpBattle.active
            && window.RtwpBattle.instance;
        const rtSoldier = rtwp && rtwp.sim
            ? rtwp.sim.getSoldier(String(u.id)) : null;

        // RTwP does not consume the legacy turn AP. The old AP check made the
        // attack command unreachable even though actionAttack was adapted.
        const movementBudget = window.gameLogic && window.gameLogic.getMovementBudget
            ? window.gameLogic.getMovementBudget(u) : (u.ap >= 1 ? 1 : 0);
        setEnabled(btnMove, rtSoldier
            ? rtSoldier.hp > 0 && Number(rtSoldier.attrs && rtSoldier.attrs.speed) > 0
            : movementBudget > 0);
        
        // 射撃可能条件: ①AP足りる ②InHandsにWeaponry(or仮想迫撃砲) ③残弾あり（戦車は予備弾があれば可）
        const w = window.getCurrentWeapon(u);
        const weaponCost = w ? w.ap : 99;
        const hasAmmo = w && (
            (w.current || 0) > 0
            || (w.reserve !== undefined && (w.reserve || 0) > 0)
            || (u.def && u.def.isTank && (w.reserve || 0) > 0)
        );
        const rtHasAmmo = rtSoldier && rtSoldier.weapon
            && ((rtSoldier.magRemaining || 0) > 0 || (rtSoldier.magsLeft || 0) > 0);
        setEnabled(btnAttack, rtSoldier
            ? !!rtHasAmmo
            : (!!w && u.ap >= weaponCost && hasAmmo));

        const anyBroken = Array.isArray(u.hands) ? u.hands.some(h => h && h.isBroken) : (u.hands && u.hands.isBroken);
        setEnabled(btnRepair, anyBroken);
        
        const neighbors = (window.gameLogic && window.gameLogic.getUnitsInHex) ? window.gameLogic.getUnitsInHex(u.q, u.r) : [];
        setEnabled(btnMelee, neighbors.some(n => n.team !== u.team));
        setEnabled(btnHeal, neighbors.some(n => n.team === u.team && n.hp < n.maxHp));

        if (u.def.isTank) {
            if (grpStance) grpStance.style.display = 'none';
            if (btnHeal) btnHeal.style.display = 'none';
        } else {
            if (grpStance) grpStance.style.display = 'block';
            if (btnHeal) btnHeal.style.display = 'block';
        }

        // 射撃ボタンの弾数撃ち分けホバーUIをセットアップ
        if (btnAttack && window.gameLogic && window.gameLogic.getBurstSelectionConfigForWeapon) {
            this.setupAttackBurstHover(u);
        }

        // 画面端対策。寸法を測るため先に表示してから置く（実装は RtwpBattle.placeMenu 一本）
        menu.style.display = 'block';
        if (window.RtwpBattle && window.RtwpBattle.placeMenu) {
            window.RtwpBattle.placeMenu(menu, px, py);
        } else {
            menu.style.left = (px + 20) + 'px';
            menu.style.top = (py - 50) + 'px';
        }
    }

    hideActionMenu() { const menu = document.getElementById('command-menu'); if (menu) menu.style.display = 'none'; }

    /**
     * 射撃ボタンに対して、弾数撃ち分け用のホバーUIを設定する。
     * 対象武器（BAR / M1A1 SMG / M2 Mortar）を装備している場合にのみ有効。
     */
    setupAttackBurstHover(u) {
        const btnAttack = document.getElementById('btn-attack');
        if (!btnAttack || !window.gameLogic || !window.gameLogic.getVirtualWeapon) return;
        const w = window.gameLogic.getVirtualWeapon(u);
        const cfg = w && window.gameLogic.getBurstSelectionConfigForWeapon
            ? window.gameLogic.getBurstSelectionConfigForWeapon(w, u)
            : null;

        // 対象外武器 or 武器なし の場合は見た目を元に戻す
        if (!cfg || !w) {
            this.clearAttackBurstUI();
            return;
        }

        // 一度だけイベントをバインドする
        if (!btnAttack._burstHoverBound) {
            btnAttack.addEventListener('mouseenter', () => this.onAttackButtonHover());
            btnAttack.addEventListener('mouseleave', () => this.onAttackButtonHoverOut());
            btnAttack._burstHoverBound = true;
        }

        // 現在の武器コードを覚えておく（ホバー時に再判定用）
        btnAttack._burstWeaponCode = w.code;
    }

    clearAttackBurstUI() {
        const btnAttack = document.getElementById('btn-attack');
        if (!btnAttack) return;
        const container = btnAttack.querySelector('.burst-container');
        if (container) container.remove();
        btnAttack.classList.remove('burst-mode');
    }

    onAttackButtonHover() {
        const btnAttack = document.getElementById('btn-attack');
        if (!btnAttack || btnAttack.classList.contains('disabled')) return;
        if (!window.gameLogic || !window.gameLogic.selectedUnit || !window.gameLogic.getVirtualWeapon) return;

        const u = window.gameLogic.selectedUnit;
        const w = window.gameLogic.getVirtualWeapon(u);
        const cfg = w && window.gameLogic.getBurstSelectionConfigForWeapon
            ? window.gameLogic.getBurstSelectionConfigForWeapon(w, u)
            : null;
        if (!cfg || !Array.isArray(cfg.modes) || cfg.modes.length < 2) {
            this.clearAttackBurstUI();
            return;
        }

        // 既に表示中なら何もしない
        if (btnAttack.classList.contains('burst-mode')) return;

        btnAttack.classList.add('burst-mode');

        const container = document.createElement('div');
        container.className = 'burst-container';

        cfg.modes.forEach((shots) => {
            const opt = document.createElement('div');
            opt.className = 'burst-option';
            opt.textContent = String(shots);
            opt.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (window.gameLogic && window.gameLogic.setAttackModeWithBurst) {
                    window.gameLogic.setAttackModeWithBurst(shots);
                }
            });
            container.appendChild(opt);
        });

        btnAttack.appendChild(container);
    }

    onAttackButtonHoverOut() {
        this.clearAttackBurstUI();
    }

    /**
     * コマンドメニュー（射撃・移動等）のボタン状態のみを即時更新する。
     * 迫撃砲など3種揃いの武器で装備スワップ後に射撃をグレーアウトするため。
     * メニューが表示中の場合のみ更新。
     */
    refreshCommandMenuState(u) {
        const menu = document.getElementById('command-menu');
        if (!menu || !u || menu.style.display !== 'block') return;
        const btnMove = document.getElementById('btn-move');
        const btnAttack = document.getElementById('btn-attack');
        const btnRepair = document.getElementById('btn-repair');
        const btnMelee = document.getElementById('btn-melee');
        const btnHeal = document.getElementById('btn-heal');
        const grpStance = menu.querySelector('.cmd-group');
        const setEnabled = (btn, enabled) => { if (btn) { if (enabled) btn.classList.remove('disabled'); else btn.classList.add('disabled'); } };
        const movementBudget = window.gameLogic && window.gameLogic.getMovementBudget
            ? window.gameLogic.getMovementBudget(u) : (u.ap >= 1 ? 1 : 0);
        setEnabled(btnMove, movementBudget > 0);
        const w = window.getCurrentWeapon(u);
        const weaponCost = w ? w.ap : 99;
        const hasAmmo = w && (
            (w.current || 0) > 0
            || (w.reserve !== undefined && (w.reserve || 0) > 0)
            || (u.def && u.def.isTank && (w.reserve || 0) > 0)
        );
        setEnabled(btnAttack, !!w && u.ap >= weaponCost && hasAmmo);
        const anyBroken = Array.isArray(u.hands) ? u.hands.some(h => h && h.isBroken) : (u.hands && u.hands.isBroken);
        setEnabled(btnRepair, anyBroken);
        const neighbors = (window.gameLogic && window.gameLogic.getUnitsInHex) ? window.gameLogic.getUnitsInHex(u.q, u.r) : [];
        setEnabled(btnMelee, neighbors.some(n => n.team !== u.team));
        setEnabled(btnHeal, neighbors.some(n => n.team === u.team && n.hp < n.maxHp));
        if (u.def.isTank) {
            if (grpStance) grpStance.style.display = 'none';
            if (btnHeal) btnHeal.style.display = 'none';
        } else {
            if (grpStance) grpStance.style.display = 'block';
            if (btnHeal) btnHeal.style.display = 'block';
        }

        // 装備スワップ等で武器が変わった場合も、撃ち分けUIを更新
        if (btnAttack && window.gameLogic && window.gameLogic.getBurstSelectionConfigForWeapon) {
            this.setupAttackBurstHover(u);
        }
    }

    showContext(mx, my, hex) {
        const m = document.getElementById('context-menu'); if (!m) return;
        if (!hex || typeof hex.q === 'undefined') { m.style.display = 'none'; return; }

        if(!window.gameLogic || !window.gameLogic.getUnitInHex) return;

        const u = window.gameLogic.getUnitInHex(hex.q, hex.r);
        const t = window.gameLogic.isValidHex(hex.q, hex.r) ? window.gameLogic.map[hex.q][hex.r] : null;
        // RTwP では AP もターン終了も無い（ターン制へ戻したときだけ従来通り出す）
        const rtwp = !!(window.RtwpBattle && window.RtwpBattle.active)
            || !!(window.gameLogic && ['WIN', 'LOSS', 'REVIEW'].includes(window.gameLogic.state));
        let h = "";
        if (u) {
            const ap = rtwp ? '' : ` AP:${u.ap}/${u.maxAp}`;
            h += `<div style="color:#0af;font-weight:bold">${u.name}</div>HP:${u.hp}/${u.maxHp}${ap}<br>Stance: ${u.stance}`;
        } else if (t) {
            h += `<div style="color:#da4;font-weight:bold">${t.name}</div>Cost:${t.cost} Cover:${t.cover}%`;
        }
        if (!rtwp) {
            h += `<hr style="border:0;border-top:1px solid #444;margin:5px 0;"><button onclick="gameLogic.endTurn();document.getElementById('context-menu').style.display='none';" style="width:100%;cursor:pointer;background:#522;color:#fcc;border:1px solid #d44;padding:3px;">TURN END</button>`;
        }
        if (h !== "") {
            m.innerHTML = h; m.style.display = 'block';
            if (window.RtwpBattle && window.RtwpBattle.placeMenu) {
                window.RtwpBattle.placeMenu(m, mx, my, { dx: 10, dy: 10 });
            } else {
                m.style.left = (mx + 10) + 'px'; m.style.top = (my + 10) + 'px';
            }
        }
    }

    updateSidebar(u, state, tankAutoReload) {
        if (window.phaserSidebar && document.getElementById('app') && document.getElementById('app').classList.contains('phaser-sidebar')) {
            window.phaserSidebar.updateSidebar(u, state, tankAutoReload);
            if (window.gameLogic && window.gameLogic.selectedUnit) this.refreshCommandMenuState(window.gameLogic.selectedUnit);
            return;
        }
        const ui = document.getElementById('unit-info');
        if (!ui) return;
        if (!u || u.hp <= 0) { ui.innerHTML = `<div style="text-align:center;color:#555;margin-top:80px;">// NO SIGNAL //</div>`; return; }
        const faceUrl = (u.team === 'player' && !u.def.isTank && u.portraitIndex !== undefined)
            ? ('asset/portraits/inf_us_' + String((u.portraitIndex % (typeof PORTRAIT_AVAILABLE !== 'undefined' ? PORTRAIT_AVAILABLE : 7)) + 1).padStart(3, '0') + '.jpg')
            : ((Renderer.generateFaceIcon) ? Renderer.generateFaceIcon(u.faceSeed) : "");
        
        const virtualWpn = window.getCurrentWeapon(u);
        const isMortarActive = virtualWpn && virtualWpn.code === 'm2_mortar';

        const makeSlot = (item, type, index) => { 
            const dragAttrs = `draggable="true" ondragstart="onSlotDragStart(event, '${type}', ${index})" ondragover="onSlotDragOver(event)" ondrop="onSlotDrop(event, '${type}', ${index})"`;
            
            if (!item) return `<div class="slot empty" ${dragAttrs}><div style="font-size:10px; color:#555;">[EMPTY]</div></div>`; 
            
            const isMain = (type === 'main'); 
            const isAmmo = (item.type === 'ammo'); 
            let gaugeHtml = ""; 
            
            if (!isAmmo && !item.partType) { 
                gaugeHtml = `<div class="ammo-gauge">`; 
                if (typeof PlMgTripod !== 'undefined' && PlMgTripod.usesBeltReserve(item.code) && item.reserve !== undefined && isMain) {
                    const maxRounds = PlMgTripod.getDefaultBeltReserve(item.code);
                    const reserve = Math.min(maxRounds, item.reserve || 0);
                    gaugeHtml += `<div style="font-size:8px;color:#888;margin-bottom:2px;">${reserve}/${maxRounds}</div>`;
                    gaugeHtml += `<div style="display:grid;grid-template-columns:repeat(30,1fr);grid-template-rows:repeat(10,2px);gap:1px;width:100%;max-width:100%;box-sizing:border-box;">`;
                    for (let i = 0; i < 300; i++) {
                        gaugeHtml += `<div style="min-width:2px;height:2px;background:${i < reserve ? '#ddaa44' : '#333'};"></div>`;
                    }
                    gaugeHtml += `</div>`;
                } else if (item.cap > 0) {
                    const maxDisplay = 20; 
                    if (u.def.isTank && isMain) { 
                        for(let i=0; i<Math.min(maxDisplay, item.reserve || 0); i++) gaugeHtml += `<div class="shell"></div>`; 
                    } else { 
                        for(let i=0; i<item.current; i++) gaugeHtml += `<div class="bullet"></div>`; 
                        for(let i=item.current; i<item.cap; i++) gaugeHtml += `<div class="bullet" style="background:#333;box-shadow:none;"></div>`; 
                    }
                }
                gaugeHtml += `</div>`; 
            }
            if (isAmmo && item.code === 'mortar_shell_box') {
                gaugeHtml = `<div class="ammo-gauge">`; 
                for(let i=0; i<item.current; i++) gaugeHtml += `<div class="shell" style="width:3px;height:6px;background:#fa0;"></div>`;
                gaugeHtml += `</div>`;
            }

            let blinkClass = ""; 
            if (isMain && isMortarActive && item.type === 'part') {
                blinkClass = "synergy-active"; 
            }

            let partMeta = '';
            if (item.partType && item.code) {
                let mainCode = null;
                const tripMap = (typeof window !== 'undefined' && window.TRIPOD_CODE_FOR_MAIN) ? window.TRIPOD_CODE_FOR_MAIN : null;
                if (tripMap) {
                    mainCode = Object.keys(tripMap).find(k => tripMap[k] === item.code);
                }
                if (mainCode && typeof WPNS !== 'undefined' && WPNS[mainCode]) {
                    partMeta = `<div class="slot-meta" style="position:relative;z-index:1;color:#8ab;">架台（${getWeaponName(mainCode)}用・主装備+弾薬）</div>`;
                } else {
                    partMeta = `<div class="slot-meta" style="position:relative;z-index:1;color:#888;">補助装備</div>`;
                }
            }
            const mortarIconPath = window.M2Mortar
                ? ((isMain && isMortarActive)
                    ? M2Mortar.ASSEMBLED_SLICE_PATHS[index]
                    : M2Mortar.texturePathForItem(item.code))
                : '';
            const iconPath = mortarIconPath || ((typeof window.plItemHasWeaponIcon === 'function' && window.plItemHasWeaponIcon(item)
                && typeof window.plCbeWeaponIconPath === 'function')
                ? window.plCbeWeaponIconPath(item.cbeNameIndex) : '');
            const iconStyle = iconPath
                ? `background-image:url('${iconPath}');background-size:contain;background-position:center;background-repeat:no-repeat;`
                : '';
            const iconOnErr = iconPath ? ` onerror="this.style.backgroundImage='none'"` : '';
            const compatTip = (typeof getLoadoutCompatTooltipText === 'function')
                ? getLoadoutCompatTooltipText(item) : null;
            const tipAttr = compatTip && typeof loadoutCompatTooltipAttrEscape === 'function'
                ? ` data-loadout-tip="${loadoutCompatTooltipAttrEscape(compatTip)}"`
                + ' onmouseenter="showLoadoutCompatTooltipFromEl(this,event)"'
                + ' onmouseleave="hideLoadoutCompatTooltip()"'
                + ' onmousemove="moveLoadoutCompatTooltip(event)"'
                : '';
            return `<div class="slot ${isMain?'main-weapon':'bag-item'} ${blinkClass}" ${dragAttrs} style="${iconStyle}"${iconOnErr}${tipAttr}><div class="slot-name" style="position:relative;z-index:1;">${item.name}</div>${!isAmmo && !item.partType ? `<div class="slot-meta" style="position:relative;z-index:1;">RNG:${item.rng} DMG:${item.dmg}</div>` : ''}${partMeta}${gaugeHtml}</div>`; 
        };

        let mainSlotsHtml = "";
        for(let i=0; i<3; i++) {
            mainSlotsHtml += makeSlot(u.hands[i], 'main', i);
        }
        
        let subSlotsHtml = "";
        // 背嚢は8枠（Phaser版サイドバーの BAG_SLOTS と揃える）
        for (let i = 0; i < 8; i++) {
            subSlotsHtml += makeSlot(u.bag[i], 'bag', i);
        }
        
        let reloadBtn = "";
        if (virtualWpn && !u.def.isTank && !virtualWpn.partType && virtualWpn.code !== 'm2_mortar') {
             if (virtualWpn.current < virtualWpn.cap) reloadBtn = `<button onclick="gameLogic.reloadWeapon()" style="width:100%; background:#442; color:#dd4; border:1px solid #884; cursor:pointer; margin-top:5px;">🔃 RELOAD</button>`;
        }

        const skills = (u.skills && Array.isArray(u.skills)) ? [...new Set(u.skills)] : [];
        let skillListHtml = '';
        if (skills.length > 0 && typeof SKILLS !== 'undefined') {
            const skillParts = skills.map(sk => SKILLS[sk] ? `${SKILLS[sk].name}: ${SKILLS[sk].desc}` : sk);
            skillListHtml = `<div class="unit-skills" style="font-size:10px;color:#888;margin-top:4px;margin-bottom:6px;">${skillParts.join('  |  ')}</div>`;
        }

        // RTwP uses the tactical pause hotkey, never a turn boundary. Keep
        // the legacy control out of live combat and frozen/result review
        // views, while retaining it for any standalone legacy UI consumer.
        const rtwpPresentation = !!(window.RtwpBattle && window.RtwpBattle.active)
            || !!(window.gameLogic && ['WIN', 'LOSS', 'REVIEW'].includes(window.gameLogic.state));
        const endTurnControl = rtwpPresentation ? ''
            : `<div style="padding:10px;"><button onclick="gameLogic.endTurn()" style="width:100%; background:#522; border-color:#d44; margin-top:15px; padding:5px; color:#fcc;">End Turn</button></div>`;

        const onErr = (u.team === 'player' && u.portraitIndex !== undefined) ? ' onerror="this.style.display=\'none\'"' : '';
        ui.innerHTML = `<div class="soldier-header"><div class="face-box"><img src="${faceUrl}" width="96" height="96"${onErr}></div><div><div class="soldier-name">${u.name}</div><div class="soldier-rank">${u.def.role}</div>${skillListHtml}</div></div><div class="stat-grid"><div class="stat-row"><span>HP</span> <span>${u.hp}/${u.maxHp}</span></div><div class="stat-row"><span>AP</span> <span>${u.ap}/${u.maxAp}</span></div></div><div class="inv-header" style="padding:0 10px; margin-top:10px;">${(u.def && u.def.isTank) ? 'Main armament / Sub armament' : 'LOADOUT'}</div><div class="loadout-container" style="display:flex;flex-direction:column;">${mainSlotsHtml}</div><div class="inv-header" style="padding:0 10px; margin-top:10px;">BACKPACK</div><div class="loadout-container">${subSlotsHtml}</div><div style="padding:0 10px;">${reloadBtn}</div>${endTurnControl}`;
    }
}

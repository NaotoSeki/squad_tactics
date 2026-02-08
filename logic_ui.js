/** LOGIC UI: Fixed Resize Handle & D&D */

class UIManager {
    constructor(game) {
        this.game = game;
        this.menuSafeLock = false;
        this.bindEvents();
        this.dragSrc = null; 
        
        // グローバル公開 (HTML属性用)
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
        const menuIds = ['context-menu', 'command-menu', 'setup-screen', 'reward-screen', 'gameover-screen'];
        menuIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('mousedown', stopPropagation);
                el.addEventListener('pointerdown', stopPropagation);
                el.addEventListener('touchstart', stopPropagation, { passive: false });
                el.addEventListener('wheel', stopPropagation, { passive: false });
            }
        });
        
        // シナジー演出 & D&D用スタイル
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
        `;
        document.head.appendChild(style);
    }

    toggleSidebar() {
        const sb = document.getElementById('sidebar');
        sb.classList.toggle('collapsed');
        
        // ★リサイズバーの強制追従処理
        const handle = document.querySelector('.resize-handle');
        if(handle) {
            if(sb.classList.contains('collapsed')) {
                // 閉じたとき: 右端へ
                handle.style.right = '0px';
                handle.style.left = 'auto'; // 安全策
            } else {
                // 開いたとき: 260px位置へ
                handle.style.right = '260px';
                handle.style.left = 'auto';
            }
        }
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
            this.game.swapEquipment(this.dragSrc, { type, index });
            this.dragSrc = null;
        }
    }

    log(m) {
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
        
        setEnabled(btnMove, u.ap >= 1);
        
        const w = this.game.getVirtualWeapon(u);
        const weaponCost = w ? w.ap : 99;
        
        setEnabled(btnAttack, u.ap >= weaponCost);
        // Repair check: 3スロットのいずれかが壊れていればOK（簡易）
        const anyBroken = Array.isArray(u.hands) ? u.hands.some(h => h && h.isBroken) : (u.hands && u.hands.isBroken);
        setEnabled(btnRepair, anyBroken);
        
        const neighbors = this.game.getUnitsInHex(u.q, u.r);
        setEnabled(btnMelee, neighbors.some(n => n.team !== u.team));
        setEnabled(btnHeal, neighbors.some(n => n.team === u.team && n.hp < n.maxHp));

        if (u.def.isTank) {
            if (grpStance) grpStance.style.display = 'none';
            if (btnHeal) btnHeal.style.display = 'none';
        } else {
            if (grpStance) grpStance.style.display = 'block';
            if (btnHeal) btnHeal.style.display = 'block';
        }

        menu.style.left = (px + 20) + 'px'; 
        menu.style.top = (py - 50) + 'px';
        menu.style.display = 'block';
    }

    hideActionMenu() { const menu = document.getElementById('command-menu'); if (menu) menu.style.display = 'none'; }

    showContext(mx, my, hex) {
        const m = document.getElementById('context-menu'); if (!m) return;
        if (!hex || typeof hex.q === 'undefined') { m.style.display = 'none'; return; }

        const u = this.game.getUnitInHex(hex.q, hex.r);
        const t = this.game.isValidHex(hex.q, hex.r) ? this.game.map[hex.q][hex.r] : null;
        let h = "";
        if (u) {
            h += `<div style="color:#0af;font-weight:bold">${u.name}</div>HP:${u.hp}/${u.maxHp} AP:${u.ap}/${u.maxAp}<br>Stance: ${u.stance}`;
        } else if (t) {
            h += `<div style="color:#da4;font-weight:bold">${t.name}</div>Cost:${t.cost} Cover:${t.cover}%`;
        }
        h += `<hr style="border:0;border-top:1px solid #444;margin:5px 0;"><button onclick="gameLogic.endTurn();document.getElementById('context-menu').style.display='none';" style="width:100%;cursor:pointer;background:#522;color:#fcc;border:1px solid #d44;padding:3px;">TURN END</button>`;
        if (h !== "") { m.innerHTML = h; m.style.display = 'block'; m.style.left = (mx + 10) + 'px'; m.style.top = (my + 10) + 'px'; }
    }

    updateSidebar(u, state, tankAutoReload) {
        const ui = document.getElementById('unit-info');
        if (!u || u.hp <= 0) { ui.innerHTML = `<div style="text-align:center;color:#555;margin-top:80px;">// NO SIGNAL //</div>`; return; }
        const faceUrl = (Renderer.generateFaceIcon) ? Renderer.generateFaceIcon(u.faceSeed) : "";
        
        const virtualWpn = this.game.getVirtualWeapon(u);
        const isMortarActive = virtualWpn && virtualWpn.code === 'm2_mortar';

        const makeSlot = (item, type, index) => { 
            const dragAttrs = `draggable="true" ondragstart="onSlotDragStart(event, '${type}', ${index})" ondragover="onSlotDragOver(event)" ondrop="onSlotDrop(event, '${type}', ${index})"`;
            
            if (!item) return `<div class="slot empty" ${dragAttrs}><div style="font-size:10px; color:#555;">[EMPTY]</div></div>`; 
            
            const isMain = (type === 'main'); 
            const isAmmo = (item.type === 'ammo'); 
            let gaugeHtml = ""; 
            
            if (!isAmmo && item.cap > 0 && !item.partType) { 
                gaugeHtml = `<div class="ammo-gauge">`; 
                const maxDisplay = 20; 
                if (u.def.isTank && isMain) { 
                    for(let i=0; i<Math.min(maxDisplay, item.reserve); i++) gaugeHtml += `<div class="shell"></div>`; 
                } else { 
                    for(let i=0; i<item.current; i++) gaugeHtml += `<div class="bullet"></div>`; 
                    for(let i=item.current; i<item.cap; i++) gaugeHtml += `<div class="bullet" style="background:#333;box-shadow:none;"></div>`; 
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

            return `<div class="slot ${isMain?'main-weapon':'bag-item'} ${blinkClass}" ${dragAttrs}><div class="slot-name">${isMain?'🔫':''} ${item.name}</div>${!isAmmo && !item.partType ? `<div class="slot-meta">RNG:${item.rng} DMG:${item.dmg}</div>` : ''}${gaugeHtml}</div>`; 
        };

        let mainSlotsHtml = "";
        for(let i=0; i<3; i++) {
            mainSlotsHtml += makeSlot(u.hands[i], 'main', i);
        }
        
        let subSlotsHtml = ""; 
        for (let i = 0; i < 4; i++) { 
            subSlotsHtml += makeSlot(u.bag[i], 'bag', i); 
        }
        
        let reloadBtn = "";
        if (virtualWpn && !u.def.isTank && !virtualWpn.partType && virtualWpn.code !== 'm2_mortar') {
             if (virtualWpn.current < virtualWpn.cap) reloadBtn = `<button onclick="gameLogic.reloadWeapon()" style="width:100%; background:#442; color:#dd4; border:1px solid #884; cursor:pointer; margin-top:5px;">🔃 RELOAD</button>`;
        }

        ui.innerHTML = `<div class="soldier-header"><div class="face-box"><img src="${faceUrl}" width="64" height="64"></div><div><div class="soldier-name">${u.name}</div><div class="soldier-rank">${u.def.role}</div></div></div><div class="stat-grid"><div class="stat-row"><span>HP</span> <span>${u.hp}/${u.maxHp}</span></div><div class="stat-row"><span>AP</span> <span>${u.ap}/${u.maxAp}</span></div></div><div class="inv-header" style="padding:0 10px; margin-top:10px;">IN HANDS (3 Slots)</div><div class="loadout-container" style="display:flex;flex-direction:column;">${mainSlotsHtml}</div><div class="inv-header" style="padding:0 10px; margin-top:10px;">BACKPACK</div><div class="loadout-container">${subSlotsHtml}</div><div style="padding:0 10px;">${reloadBtn}</div><div style="padding:10px;"><button onclick="gameLogic.endTurn()" style="width:100%; background:#522; border-color:#d44; margin-top:15px; padding:5px; color:#fcc;">End Turn</button></div>`;
    }

    renderSetupCards(slots, onClick) {
        const box = document.getElementById('setup-cards'); box.innerHTML = '';
        ['rifleman', 'scout', 'gunner', 'mortar_gunner'].forEach(k => {
            const t = UNIT_TEMPLATES[k]; 
            const d = document.createElement('div'); d.className = 'card';
            const faceUrl = Renderer.generateFaceIcon ? Renderer.generateFaceIcon(Math.floor(Math.random() * 99999)) : "";
            d.innerHTML = `<div class="card-badge" style="display:none;">✔</div><div style="background:#222; width:100%; text-align:center; padding:2px 0; border-bottom:1px solid #444; margin-bottom:5px;"><h3 style="color:#d84; font-size:14px; margin:0;">${t.name}</h3></div><div class="card-img-box" style="background:#111;"><img src="${faceUrl}" style="width:64px; height:64px; object-fit:cover;"></div><div class="card-body" style="font-size:10px; color:#aaa;">AP:${t.ap}<br>${t.role}</div>`;
            d.onclick = () => { onClick(k, d); };
            box.appendChild(d);
        });
    }
}

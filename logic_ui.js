/** LOGIC UI: Robust Interface Management */

class UIManager {
    constructor(game) {
        this.game = game;
        this.menuSafeLock = false;
        this.bindEvents();
    }

    bindEvents() {
        window.addEventListener('click', (e) => {
            if (this.menuSafeLock) return;
            if (!e.target.closest('#context-menu')) document.getElementById('context-menu').style.display = 'none';
            if (!e.target.closest('#command-menu') && !e.target.closest('canvas')) { this.hideActionMenu(); }
        });
        const stopPropagation = (e) => { e.stopPropagation(); };
        ['context-menu', 'command-menu', 'setup-screen', 'reward-screen', 'gameover-screen'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.addEventListener('mousedown', stopPropagation); el.addEventListener('pointerdown', stopPropagation); }
        });
        const resizer = document.getElementById('resizer'); const sidebar = document.getElementById('sidebar');
        let isResizing = false;
        if (resizer) {
            resizer.addEventListener('mousedown', () => { isResizing = true; document.body.style.cursor = 'col-resize'; resizer.classList.add('active'); });
            window.addEventListener('mousemove', (e) => {
                if (!isResizing) return;
                const newWidth = document.body.clientWidth - e.clientX;
                if (newWidth > 200 && newWidth < 800) { sidebar.style.width = newWidth + 'px'; resizer.style.right = newWidth + 'px'; if (sidebar.classList.contains('collapsed')) this.toggleSidebar(); }
            });
            window.addEventListener('mouseup', () => { if (isResizing) { isResizing = false; document.body.style.cursor = ''; resizer.classList.remove('active'); } });
        }
    }

    toggleSidebar() {
        const sb = document.getElementById('sidebar'); const tg = document.getElementById('sidebar-toggle');
        sb.classList.toggle('collapsed');
        if (sb.classList.contains('collapsed')) { sb.style.width = ''; tg.innerText = '◀'; } else { tg.innerText = '▶'; }
    }

    log(m) { const c = document.getElementById('log-container'); if (c) { const d = document.createElement('div'); d.className = 'log-entry'; d.innerText = `> ${m}`; c.appendChild(d); c.scrollTop = c.scrollHeight; } }

    showActionMenu(u, px, py) {
        const menu = document.getElementById('command-menu'); if (!menu) return;
        this.menuSafeLock = true; setTimeout(() => { this.menuSafeLock = false; }, 300);
        const btnMove = document.getElementById('btn-move'); const btnAttack = document.getElementById('btn-attack');
        const btnRepair = document.getElementById('btn-repair'); const btnMelee = document.getElementById('btn-melee'); const btnHeal = document.getElementById('btn-heal');
        const setEnabled = (btn, enabled) => { if(enabled) btn.classList.remove('disabled'); else btn.classList.add('disabled'); };
        setEnabled(btnMove, u.ap >= 1); setEnabled(btnAttack, u.ap >= (u.hands ? u.hands.ap : 99));
        setEnabled(btnRepair, u.hands && u.hands.isBroken);
        const neighbors = this.game.getUnitsInHex(u.q, u.r);
        setEnabled(btnMelee, neighbors.some(n => n.team !== u.team));
        setEnabled(btnHeal, neighbors.some(n => n.team === u.team && n.hp < n.maxHp));
        menu.style.left = (px + 20) + 'px'; menu.style.top = (py - 50) + 'px'; menu.style.display = 'block';
    }

    hideActionMenu() { const menu = document.getElementById('command-menu'); if (menu) menu.style.display = 'none'; }

    showContext(mx, my, hex) {
        const m = document.getElementById('context-menu'); if (!m) return;
        if (!hex || typeof hex.q === 'undefined') { m.style.display = 'none'; return; }
        const u = this.game.getUnitInHex(hex.q, hex.r);
        const t = this.game.isValidHex(hex.q, hex.r) ? this.game.map[hex.q][hex.r] : null;
        let h = "";
        if (u) { h += `<div style="color:#0af;font-weight:bold">${u.name}</div><div style="font-size:10px">${u.def.name} (${RANKS[u.rank]})</div>HP:${u.hp}/${u.maxHp} AP:${u.ap}/${u.maxAp}<br>Stance: ${u.stance}`; }
        else if (t) { h += `<div style="color:#da4;font-weight:bold">${t.name}</div>Cost:${t.cost} Cover:${t.cover}%`; }
        h += `<hr style="border:0;border-top:1px solid #444;margin:5px 0;"><button onclick="gameLogic.endTurn();document.getElementById('context-menu').style.display='none';" style="width:100%;cursor:pointer;background:#522;color:#fcc;border:1px solid #d44;padding:3px;">TURN END</button>`;
        if (h !== "") { m.innerHTML = h; m.style.display = 'block'; m.style.left = (mx + 10) + 'px'; m.style.top = (my + 10) + 'px'; }
    }

    updateSidebar(u, state, tankAutoReload) {
        const ui = document.getElementById('unit-info');
        if (!u || u.hp <= 0) { ui.innerHTML = `<div style="text-align:center;color:#555;margin-top:80px;">// NO SIGNAL //</div>`; return; }
        const w = u.hands; const faceUrl = (Renderer.generateFaceIcon) ? Renderer.generateFaceIcon(u.faceSeed) : "";
        const makeSlot = (item, type, index) => { 
            if (!item) return `<div class="slot empty" ondragover="onSlotDragOver(event)" ondragleave="onSlotDragLeave(event)" ondrop="onSlotDrop(event, '${type}', ${index})"><div style="font-size:10px; color:#555;">[EMPTY]</div></div>`; 
            const isMain = (type === 'main'); const isAmmo = (item.type === 'ammo'); 
            let gaugeHtml = ""; if (!isAmmo && item.cap > 0) { gaugeHtml = `<div class="ammo-gauge">`; if (u.def.isTank && isMain) { for(let i=0; i<Math.min(20, item.reserve); i++) gaugeHtml += `<div class="shell"></div>`; } else { for(let i=0; i<item.current; i++) gaugeHtml += `<div class="bullet"></div>`; for(let i=item.current; i<item.cap; i++) gaugeHtml += `<div class="bullet" style="background:#333;"></div>`; } gaugeHtml += `</div>`; }
            let blinkClass = (u.def.isTank && isMain && item.current === 0 && item.reserve > 0 && !tankAutoReload) ? "blink-alert" : "";
            let clickAction = blinkClass ? `onclick="gameLogic.reloadWeapon(true)"` : "";
            return `<div class="slot ${isMain?'main-weapon':'bag-item'} ${blinkClass}" ${clickAction} draggable="true" ondragstart="onSlotDragStart(event, '${type}', ${index})"><div class="slot-name">${isMain?'🔫':''} ${item.name}</div>${!isAmmo ? `<div class="slot-meta"><span>RNG:${item.rng} DMG:${item.dmg}</span> <span class="ammo-text">${u.def.isTank&&isMain ? item.reserve : item.current}/${u.def.isTank&&isMain ? '∞' : item.cap}</span></div>` : `<div class="slot-meta" style="color:#d84">AMMO</div>`}${gaugeHtml}</div>`; 
        };
        const mainSlot = makeSlot(u.hands, 'main', 0); let subSlots = ""; for (let i = 0; i < 4; i++) { subSlots += makeSlot(u.bag[i], 'bag', i); }
        let reloadBtn = (w && !u.def.isTank && w.current < w.cap && u.bag.some(i => i && i.type === 'ammo' && i.ammoFor === w.code)) ? `<button onclick="gameLogic.reloadWeapon()" style="width:100%; background:#442; color:#dd4; margin-top:5px;">🔃 RELOAD</button>` : "";
        let tankCheck = u.def.isTank ? `<div class="ar-check" onclick="gameLogic.toggleTankAutoReload()"><input type="checkbox" ${tankAutoReload ? 'checked' : ''}> AUTO RELOAD</div>` : "";
        ui.innerHTML = `<div class="soldier-header"><div class="face-box"><img src="${faceUrl}" width="64" height="64"></div><div><div class="soldier-name">${u.name}</div><div class="soldier-rank">${RANKS[u.rank] || 'Pvt'}</div></div></div><div class="stat-grid"><div class="stat-row"><span>HP</span> <span>${u.hp}/${u.maxHp}</span></div><div class="stat-row"><span>AP</span> <span>${u.ap}/${u.maxAp}</span></div></div><div class="loadout-container"><div class="main-slot-area">${mainSlot}</div><div class="sub-slot-area">${subSlots}</div></div>${tankCheck}${reloadBtn}<button onclick="gameLogic.toggleStance()" style="width:100%; margin-top:10px;">STANCE: ${u.stance.toUpperCase()}</button><button onclick="gameLogic.endTurn()" style="width:100%; background:#522; color:#fcc; margin-top:10px;">End Turn</button>`;
    }

    renderSetupCards(slots, onClick) {
        const box = document.getElementById('setup-cards'); box.innerHTML = '';
        ['rifleman', 'scout', 'gunner', 'sniper'].forEach(k => {
            const t = UNIT_TEMPLATES[k]; const d = document.createElement('div'); d.className = 'card';
            const faceUrl = Renderer.generateFaceIcon ? Renderer.generateFaceIcon(Math.floor(Math.random() * 99999)) : "";
            d.innerHTML = `<div class="card-badge" style="display:none;">✔</div><div class="card-img-box"><img src="${faceUrl}" style="width:64px;"></div><div class="card-body"><h3>${t.name}</h3><p>${t.role.toUpperCase()}</p></div>`;
            d.onclick = () => { onClick(k, d); };
            box.appendChild(d);
        });
    }
}

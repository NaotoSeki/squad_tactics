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
        // 警告モーダルをリストから除外
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

        const resizer = document.getElementById('resizer');
        const sidebar = document.getElementById('sidebar');
        const app = document.getElementById('app');

        let isResizing = false;
        if (resizer) {
            resizer.addEventListener('mousedown', () => { isResizing = true; document.body.style.cursor = 'col-resize'; resizer.classList.add('active'); });
            window.addEventListener('mousemove', (e) => {
                if (!isResizing) return;
                const newWidth = document.body.clientWidth - e.clientX;
                if (newWidth > 200 && newWidth < 800) { 
                    sidebar.style.width = newWidth + 'px'; resizer.style.right = newWidth + 'px'; 
                    if (sidebar.classList.contains('collapsed')) this.toggleSidebar(); 
                }
            });
            window.addEventListener('mouseup', () => { if (isResizing) { isResizing = false; document.body.style.cursor = ''; resizer.classList.remove('active'); } });
        }
    }

    toggleSidebar() {
        const sb = document.getElementById('sidebar');
        const tg = document.getElementById('sidebar-toggle');
        const app = document.getElementById('app');
        sb.classList.toggle('collapsed');
        app.classList.toggle('sidebar-closed');
        if (sb.classList.contains('collapsed')) { sb.style.width = ''; tg.innerText = '◀'; } else { tg.innerText = '▶'; }
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

        const setEnabled = (btn, enabled) => { if(enabled) btn.classList.remove('disabled'); else btn.classList.add('disabled'); };
        
        setEnabled(btnMove, u.ap >= 1);
        const weaponCost = u.hands ? u.hands.ap : 99;
        setEnabled(btnAttack, u.ap >= weaponCost);
        setEnabled(btnRepair, u.hands && u.hands.isBroken);
        const neighbors = this.game.getUnitsInHex(u.q, u.r);
        setEnabled(btnMelee, neighbors.some(n => n.team !== u.team));
        setEnabled(btnHeal, neighbors.some(n => n.team === u.team && n.hp < n.maxHp));

        menu.style.left = (px + 20) + 'px'; 
        menu.style.top = (py - 50) + 'px';
        menu.style.display = 'block';
    }

    hideActionMenu() { const menu = document.getElementById('command-menu'); if (menu) menu.style.display = 'none'; }

    showContext(mx, my, hex) {
        const m = document.getElementById('context-menu'); if (!m) return;
        const u = this.game.getUnitInHex(hex.q, hex.r);
        const t = this.game.isValidHex(hex.q, hex.r) ? this.game.map[hex.q][hex.r] : null;
        let h = "";
        if (u) {
            h += `<div style="color:#0af;font-weight:bold">${u.name}</div><div style="font-size:10px">${u.def.name} (${RANKS[u.rank]})</div>HP:${u.hp}/${u.maxHp} AP:${u.ap}/${u.maxAp}<br>Stance: ${u.stance}`;
        } else if (t) {
            h += `<div style="color:#da4;font-weight:bold">${t.name}</div>Cost:${t.cost} Cover:${t.cover}%`;
        }
        h += `<hr style="border:0;border-top:1px solid #444;margin:5px 0;"><button onclick="gameLogic.endTurn();document.getElementById('context-menu').style.display='none';" style="width:100%;cursor:pointer;background:#522;color:#fcc;border:1px solid #d44;padding:3px;">TURN END</button>`;
        if (h !== "") { m.innerHTML = h; m.style.display = 'block'; m.style.left = (mx + 10) + 'px'; m.style.top = (my + 10) + 'px'; }
    }

    updateSidebar(u, state, tankAutoReload) {
        const ui = document.getElementById('unit-info');
        if (!u || u.hp <= 0) { ui.innerHTML = `<div style="text-align:center;color:#555;margin-top:80px;">// NO SIGNAL //</div>`; return; }
        const w = u.hands; const faceUrl = (Renderer.generateFaceIcon) ? Renderer.generateFaceIcon(u.faceSeed) : "";
        
        const skillCounts = {}; u.skills.forEach(sk => { skillCounts[sk] = (skillCounts[sk] || 0) + 1; });
        let skillHtml = ""; 
        if (typeof SKILL_STYLES !== 'undefined') {
            for (const [sk, count] of Object.entries(skillCounts)) { 
                if (SKILL_STYLES[sk]) { 
                    const st = SKILL_STYLES[sk]; 
                    skillHtml += `<div style="display:inline-block; background:${st.col}; color:#fff; font-weight:bold; font-size:10px; padding:3px 6px; margin:2px; border-radius:4px; box-shadow:0 1px 3px rgba(0,0,0,0.5); text-shadow:0 1px 1px rgba(0,0,0,0.8); border:1px solid rgba(255,255,255,0.2);">
                        ${st.icon} ${st.name}${count > 1 ? ' x'+count : ''}
                    </div>`; 
                } 
            }
        }

        const makeSlot = (item, type, index) => { 
            if (!item) return `<div class="slot empty" ondragover="onSlotDragOver(event)" ondragleave="onSlotDragLeave(event)" ondrop="onSlotDrop(event, '${type}', ${index})"><div style="font-size:10px; color:#555;">[EMPTY]</div></div>`; 
            const isMain = (type === 'main'); 
            const isAmmo = (item.type === 'ammo'); 
            let gaugeHtml = ""; if (!isAmmo && item.cap > 0) { gaugeHtml = `<div class="ammo-gauge">`; const maxDisplay = 20; if (u.def.isTank && isMain) { for(let i=0; i<Math.min(maxDisplay, item.reserve); i++) gaugeHtml += `<div class="shell"></div>`; if(item.reserve === 0) gaugeHtml += `<div class="shell empty"></div>`; } else { for(let i=0; i<item.current; i++) gaugeHtml += `<div class="bullet"></div>`; for(let i=item.current; i<item.cap; i++) gaugeHtml += `<div class="bullet" style="background:#333;box-shadow:none;"></div>`; } gaugeHtml += `</div>`; }
            let toggleBtn = "";
            if (isMain && item.modes && item.modes.length > 1) {
                toggleBtn = `<span class="mode-toggle" onclick="gameLogic.toggleFireMode()" style="cursor:pointer; background:#444; padding:1px 4px; border-radius:3px; margin-left:5px; font-size:10px; color:#fff; border:1px solid #888;">x${item.burst}</span>`;
            }
            let blinkClass = ""; let clickAction = ""; if (u.def.isTank && isMain && item.current === 0 && item.reserve > 0 && !tankAutoReload) { blinkClass = "blink-alert"; clickAction = `onclick="gameLogic.reloadWeapon(true)"`; }
            return `<div class="slot ${isMain?'main-weapon':'bag-item'} ${blinkClass}" ${clickAction} draggable="true" ondragstart="onSlotDragStart(event, '${type}', ${index})" ondragend="onSlotDragEnd(event)" ondragover="onSlotDragOver(event)" ondragleave="onSlotDragLeave(event)" ondrop="onSlotDrop(event, '${type}', ${index})"><div class="slot-name">${isMain?'🔫':''} ${item.name}${toggleBtn}</div>${!isAmmo ? `<div class="slot-meta"><span>RNG:${item.rng} DMG:${item.dmg}</span> <span class="ammo-text">${u.def.isTank&&isMain ? item.reserve : item.current}/${u.def.isTank&&isMain ? '∞' : item.cap}</span></div>` : `<div class="slot-meta" style="color:#d84">AMMO for ${item.ammoFor}</div>`}${gaugeHtml}</div>`; 
        };
        const mainSlot = makeSlot(u.hands, 'main', 0); let subSlots = ""; for (let i = 0; i < 4; i++) { subSlots += makeSlot(u.bag[i], 'bag', i); }
        let canReload = false; if (w && !u.def.isTank && w.current < w.cap && u.bag.some(i => i && i.type === 'ammo' && i.ammoFor === w.code)) canReload = true;
        let reloadBtn = canReload ? `<button onclick="gameLogic.reloadWeapon()" style="width:100%; background:#442; color:#dd4; border:1px solid #884; cursor:pointer; margin-top:5px;">🔃 RELOAD (${w.rld||1} AP)</button>` : "";
        let tankAutoReloadCheck = ""; if (u.def.isTank) { tankAutoReloadCheck = `<div class="ar-check" onclick="gameLogic.toggleTankAutoReload()"><input type="checkbox" ${tankAutoReload ? 'checked' : ''}> AUTO RELOAD (1AP)</div>`; reloadBtn = ""; }
        ui.innerHTML = `<div class="soldier-header"><div class="face-box"><img src="${faceUrl}" width="64" height="64"></div><div><div class="soldier-name">${u.name}</div><div class="soldier-rank">${RANKS[u.rank] || 'Pvt'}</div></div></div><div class="stat-grid"><div class="stat-row"><span class="stat-label">HP</span> <span class="stat-val">${u.hp}/${u.maxHp}</span></div><div class="stat-row"><span class="stat-label">AP</span> <span class="stat-val">${u.ap}/${u.maxAp}</span></div><div class="stat-row"><span class="stat-label">AIM</span> <span class="stat-val">${u.stats?.aim||'-'}</span></div><div class="stat-row"><span class="stat-label">STR</span> <span class="stat-val">${u.stats?.str||'-'}</span></div></div><div class="inv-header" style="padding:0 10px; margin-top:10px;">LOADOUT (Drag to Swap)</div><div class="loadout-container"><div class="main-slot-area">${mainSlot}</div><div class="sub-slot-area">${subSlots}</div></div><div style="padding:0 10px;">${tankAutoReloadCheck}${reloadBtn}</div><div style="margin:5px 0; padding:0 10px;">${skillHtml}</div><div style="padding:10px;"><div style="font-size:10px; color:#666;">TACTICS</div><button class="btn-stance ${u.stance==='stand'?'active-stance':''}" onclick="gameLogic.toggleStance()">STANCE</button><button onclick="gameLogic.endTurn()" class="${state!=='PLAY'?'disabled':''}" style="width:100%; background:#522; border-color:#d44; margin-top:15px; padding:5px; color:#fcc;">End Turn</button></div>`;
        if (u.def.isTank) document.querySelectorAll('.btn-stance').forEach(b => b.classList.add('disabled'));
    }

    renderSetupCards(slots, onClick) {
        const box = document.getElementById('setup-cards'); box.innerHTML = '';
        ['rifleman', 'scout', 'gunner', 'sniper'].forEach(k => {
            const t = UNIT_TEMPLATES[k]; const d = document.createElement('div'); d.className = 'card';
            let specs = `<div style="text-align:left; font-size:10px; line-height:1.4; color:#aaa; margin-top:5px;">HP:<span style="color:#fff">${t.hp||100}</span> AP:<span style="color:#fff">${t.ap||4}</span><br>`;
            const mainWpn = WPNS[t.main]; if (mainWpn) { specs += `<span style="color:#d84">${mainWpn.name}</span>`; } specs += `</div>`;
            const faceUrl = Renderer.generateFaceIcon ? Renderer.generateFaceIcon(Math.floor(Math.random() * 99999)) : "";
            d.innerHTML = `<div class="card-badge" style="display:none;">✔</div><div class="card-img-box" style="background:#111;"><img src="${faceUrl}" style="width:64px; height:64px; object-fit:cover;"></div><div class="card-body"><h3 style="color:#d84; font-size:14px; margin:5px 0;">${t.name}</h3><p style="font-size:10px; color:#888;">${t.role.toUpperCase()}</p>${specs}</div>`;
            d.onclick = () => { onClick(k, d); };
            box.appendChild(d);
        });
    }
}

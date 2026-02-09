/** LOGIC CAMPAIGN: Game Lifecycle, Data Persistence, and Unit Factory */

// 戦車を含む全カード定義
const AVAILABLE_CARDS = ['rifleman', 'scout', 'gunner', 'sniper', 'mortar_gunner', 'aerial', 'tank_pz4', 'tank_tiger'];

function createCardIcon(type) {
    const c = document.createElement('canvas'); c.width = 1; c.height = 1; return c.toDataURL();
}

class CampaignManager {
    constructor() {
        this.sector = 1;
        this.survivingUnits = []; // 前の戦いから生き残ったユニット
        this.setupSlots = [];
        this.isAutoMode = false;
        
        // UI初期化 (DOMが準備できるのを少し待つ)
        window.addEventListener('load', () => this.initSetupScreen());
    }

    // --- SETUP SCREEN LOGIC ---
    initSetupScreen() {
        // ★追加: 描画システムの初期化 (まだ起動していない場合)
        if (typeof Renderer !== 'undefined' && !Renderer.game) {
            const view = document.getElementById('game-view');
            if (view) Renderer.init(view);
        }

        const box = document.getElementById('setup-cards');
        if (!box) return; 
        
        box.innerHTML = '';
        this.setupSlots = [];

        // デッキ生成
        ['rifleman', 'scout', 'gunner', 'mortar_gunner'].forEach(k => {
            const t = UNIT_TEMPLATES[k]; 
            const d = document.createElement('div'); d.className = 'card';
            
            let faceUrl = "";
            try {
                if (window.Renderer && typeof window.Renderer.generateFaceIcon === 'function') {
                    faceUrl = window.Renderer.generateFaceIcon(Math.floor(Math.random() * 99999));
                }
            } catch(e) { console.warn("Renderer not ready"); }
            
            d.innerHTML = `
                <div class="card-badge" style="display:none;">✔</div>
                <div style="background:#222; width:100%; text-align:center; padding:2px 0; border-bottom:1px solid #444; margin-bottom:5px;">
                    <h3 style="color:#d84; font-size:14px; margin:0;">${t.name}</h3>
                </div>
                <div class="card-img-box" style="background:#111;">
                    <img src="${faceUrl}" style="width:64px; height:64px; object-fit:cover;" onerror="this.style.display='none'">
                </div>
                <div class="card-body" style="font-size:10px; color:#aaa;">
                    AP:${t.ap}<br>${t.role}
                </div>
            `;
            
            d.onclick = () => { 
                const idx = this.setupSlots.indexOf(k);
                if (idx >= 0) { 
                    this.setupSlots.splice(idx, 1); 
                    d.classList.remove('selected'); 
                    d.querySelector('.card-badge').style.display = 'none'; 
                    d.style.borderColor = "#555"; 
                } else { 
                    if (this.setupSlots.length < 3) { 
                        this.setupSlots.push(k); 
                        d.classList.add('selected'); 
                        d.querySelector('.card-badge').style.display = 'flex'; 
                        d.style.borderColor = "#d84"; 
                    } 
                }
                const btn = document.getElementById('btn-start'); 
                if (btn) btn.style.display = (this.setupSlots.length === 3) ? 'inline-block' : 'none';
            };
            box.appendChild(d);
        });
    }

    // --- DEPLOYMENT (Game Logicへの引き渡し) ---
    startMission() {
        document.getElementById('setup-screen').style.display = 'none';
        document.getElementById('reward-screen').style.display = 'none';
        
        // Phaserのリセット
        if (typeof Renderer !== 'undefined' && Renderer.game) { 
            const mainScene = Renderer.game.scene.getScene('MainScene'); 
            if (mainScene) { 
                mainScene.mapGenerated = false; 
                if (mainScene.hexGroup && typeof mainScene.hexGroup.removeAll === 'function') { mainScene.hexGroup.removeAll(); }
                if (window.EnvSystem) { window.EnvSystem.clear(); }
            } 
        }
        if(typeof Renderer !== 'undefined') { Renderer.resize(); }

        // プレイヤー部隊の構築
        let deployUnits = [];

        // 1. 生存者がいれば引き継ぎ
        if (this.survivingUnits.length > 0) {
            deployUnits = this.survivingUnits;
            // 位置リセット
            deployUnits.forEach(u => { u.q = -999; u.r = -999; });
        } 
        // 2. 初回プレイならスロットから生成
        else {
            this.setupSlots.forEach(k => {
                const u = this.createSoldier(k, 'player');
                if (u) deployUnits.push(u);
            });
        }

        // BattleLogic（logic_game.js）をインスタンス化
        if (window.BattleLogic) {
            window.gameLogic = new BattleLogic(this, deployUnits, this.sector);
            window.gameLogic.init(); 
        } else {
            console.error("BattleLogic not found! logic_game.js loaded?");
            alert("BattleLogic Error: Please check console.");
        }
    }

    // --- UNIT FACTORY ---
    createSoldier(templateKey, team) {
        const t = UNIT_TEMPLATES[templateKey]; 
        if (!t) { console.error("Template not found:", templateKey); return null; }
        
        const isPlayer = (team === 'player'); 
        
        const stats = t.stats ? { ...t.stats } : { str:0, aim:0, mob:0, mor:0 };
        if (isPlayer && !t.isTank) { 
            ['str', 'aim', 'mob', 'mor'].forEach(k => {
                stats[k] = (stats[k] || 0) + Math.floor(Math.random() * 3) - 1;
            });
        }
        
        let name = t.name; 
        let faceSeed = Math.floor(Math.random() * 99999);
        if (isPlayer && !t.isTank) { 
            const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]; 
            const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]; 
            name = `${last} ${first}`; 
        }

        const createItem = (key) => {
            if (!key || !WPNS[key]) return null;
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
        if (t.loadout) {
            t.loadout.forEach((k, i) => { if (i < 3) hands[i] = createItem(k); });
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
                if (bag.length >= 4) break;
                bag.push({ type: 'ammo', name: (hands[0].magName || 'Clip'), ammoFor: hands[0].code, cap: hands[0].cap, jam: hands[0].jam, code: 'mag' }); 
            } 
        }
        
        if (!isPlayer) { 
            if (hands[0] && !hands[0].partType) { hands[0].current = 999; }
            bag = []; 
        }

        return { 
            id: Math.random(), team: team, q: 0, r: 0, def: t, name: name, rank: 0, faceSeed: faceSeed, stats: stats, hp: t.hp || 80, maxHp: t.hp || 80, ap: t.ap || 4, maxAp: t.ap || 4, hands: hands, bag: bag, stance: 'stand', skills: [], sectorsSurvived: 0, deadProcessed: false 
        };
    }

    // --- MISSION END HANDLERS ---
    onSectorCleared(survivors) {
        this.survivingUnits = survivors;
        this.promoteSurvivors();
        
        document.getElementById('reward-screen').style.display = 'flex';
        const b = document.getElementById('reward-cards'); 
        b.innerHTML = ''; 
        
        [{k:'rifleman',t:'新兵'}, {k:'mortar_gunner',t:'迫撃砲兵'}, {k:'tank_pz4',t:'鹵獲戦車'}, {k:'supply',t:'補給'}].forEach(o => { 
            const d = document.createElement('div'); d.className = 'card'; 
            const iconType = o.k === 'supply' ? 'heal' : 'infantry'; 
            d.innerHTML = `<div class="card-img-box"><img src="${createCardIcon(iconType)}"></div><div class="card-body"><p>${o.t}</p></div>`;
            d.onclick = () => { 
                if (o.k === 'supply') { 
                    this.resupplySurvivors(); 
                } else { 
                    const newUnit = this.createSoldier(o.k, 'player');
                    if(window.gameLogic && window.gameLogic.addReinforcement) {
                        window.gameLogic.addReinforcement(newUnit);
                    }
                    this.survivingUnits.push(newUnit);
                }
                this.sector++; 
                this.startMission(); 
            }; 
            b.appendChild(d); 
        });
        if (window.Sfx) Sfx.play('win');
    }

    onGameOver() {
        document.getElementById('gameover-screen').style.display = 'flex';
    }

    promoteSurvivors() { 
        this.survivingUnits.forEach(u => { 
            u.sectorsSurvived++; 
            if (u.sectorsSurvived === 5) { u.skills.push("Hero"); u.maxAp++; } 
            u.rank = Math.min(5, (u.rank||0) + 1); 
            u.maxHp += 30; u.hp += 30; 
            if (u.skills.length < 8 && Math.random() < 0.7) { 
                const k = Object.keys(SKILLS).filter(z => z !== "Hero"); 
                u.skills.push(k[Math.floor(Math.random() * k.length)]); 
            } 
        }); 
    }

    resupplySurvivors() { 
        this.survivingUnits.forEach(u => { 
            if (u.hp < u.maxHp) u.hp = Math.floor(u.maxHp * 0.8); 
            const parts = u.hands.map(i => i ? i.code : null);
            const isMortar = parts.includes('mortar_barrel') && parts.includes('mortar_bipod') && parts.includes('mortar_plate');
            if (isMortar) { u.bag.forEach(i => { if (i && i.code === 'mortar_shell_box') i.current = i.cap; }); } 
            else if (u.hands[0] && u.hands[0].type && u.hands[0].type.includes('bullet')) { u.hands[0].current = u.hands[0].cap; } 
            else if (u.def.isTank && u.hands[0]) { u.hands[0].reserve = 12; } 
        }); 
    }
}

// キャンペーンマネージャーを起動
window.campaign = new CampaignManager();

// ★重要: 初期化段階での gameLogic のダミー (Phaser側のエラー回避用)
window.gameLogic = {
    startCampaign: () => window.campaign.startMission(),
    toggleSidebar: () => { 
        const sb = document.getElementById('sidebar');
        if(sb) sb.classList.toggle('collapsed');
    },
    toggleAuto: () => {},
    handleClick: () => {},
    // 以下、Phaser側が参照する可能性のあるプロパティのダミー
    map: [],
    selectedUnit: null,
    reachableHexes: [],
    attackLine: [],
    hoverHex: null,
    path: [],
    aimTargetUnit: null,
    isValidHex: () => false,
    getUnitsInHex: () => [],
    getNeighbors: () => [],
    checkDeploy: () => false
};

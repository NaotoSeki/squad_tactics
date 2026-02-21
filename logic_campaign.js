/** LOGIC CAMPAIGN: Game Lifecycle, Data Persistence, and Unit Factory */

const AVAILABLE_CARDS = ['rifleman', 'scout', 'gunner', 'sniper', 'mortar_gunner', 'aerial', 'tank_pz4', 'tank_tiger'];

function createCardIcon(type) {
    const c = document.createElement('canvas'); c.width = 1; c.height = 1; return c.toDataURL();
}


class CampaignManager {
    constructor() {
        this.sector = 1;
        this.survivingUnits = [];
        this.setupSlots = [];
        this.isAutoMode = false;
        this.carriedCards = [];
        this.nextPortraitIndex = 0;
        window.addEventListener('load', () => this.initSetupScreen());
    }

    // --- SETUP SCREEN LOGIC ---
    initSetupScreen() {
        // ★修正: 起動直後はUIManagerがまだ存在しないため、直接DOMを操作してサイドバー一式を隠す
        const idsToHide = ['sidebar', 'resizer', 'sidebar-toggle'];
        idsToHide.forEach(id => {
            const el = document.getElementById(id);
            if(el) el.style.display = 'none';
        });

        // ★追加: 描画システムの初期化 (まだ起動していない場合)
        if (typeof Renderer !== 'undefined' && !Renderer.game) {
            const view = document.getElementById('game-view');
            if (view) Renderer.init(view);
        }

        const box = document.getElementById('setup-cards');
        if (!box) return; 
        
        box.innerHTML = '';
        this.setupSlots = [];

        const btnStart = document.getElementById('btn-start');
        if (btnStart) {
            btnStart.style.display = 'inline-block';
            btnStart.disabled = true;
            btnStart.style.background = '#555';
            btnStart.style.color = '#888';
            btnStart.style.cursor = 'not-allowed';
            btnStart.style.opacity = '0.8';
        }

        const maxPortrait = typeof PORTRAIT_AVAILABLE !== 'undefined' ? PORTRAIT_AVAILABLE : 7;
        ['rifleman', 'scout', 'gunner', 'mortar_gunner'].forEach((k) => {
            const t = UNIT_TEMPLATES[k]; 
            const d = document.createElement('div'); d.className = 'card';
            const portraitIndex = Math.floor(Math.random() * maxPortrait);
            const firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
            const lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
            const soldierName = `${lastName} ${firstName}`;
            d.dataset.portraitIndex = String(portraitIndex);
            d.dataset.soldierName = soldierName;
            d.dataset.key = k;
            const portraitNum = String(portraitIndex + 1).padStart(3, '0');
            const faceUrl = 'asset/portraits/inf_us_' + portraitNum + '.jpg';
            
            d.innerHTML = `
                <div class="card-badge" style="display:none;">✔</div>
                <div style="background:#222; width:100%; text-align:center; padding:2px 0; border-bottom:1px solid #444; margin-bottom:5px;">
                    <h3 style="color:#d84; font-size:14px; margin:0;">${soldierName}</h3>
                </div>
                <div class="card-img-box" style="background:#111;">
                    <img src="${faceUrl}" style="width:96px; height:96px; object-fit:cover;" onerror="this.style.display='none'">
                </div>
                <div class="card-body" style="font-size:10px; color:#aaa;">
                    AP:${t.ap}<br>${t.role}
                </div>
            `;
            
            d.onclick = () => { 
                const slotIdx = this.setupSlots.findIndex(s => s.key === k);
                if (slotIdx >= 0) { 
                    this.setupSlots.splice(slotIdx, 1); 
                    d.classList.remove('selected'); 
                    d.querySelector('.card-badge').style.display = 'none'; 
                    d.style.borderColor = "#555"; 
                } else { 
                    if (this.setupSlots.length < 3) { 
                        this.setupSlots.push({ key: k, portraitIndex, name: soldierName }); 
                        d.classList.add('selected'); 
                        d.querySelector('.card-badge').style.display = 'flex'; 
                        d.style.borderColor = "#d84"; 
                    } 
                }
                const btn = document.getElementById('btn-start'); 
                if (btn) {
                    if (this.setupSlots.length === 3) {
                        btn.disabled = false;
                        btn.style.background = '#d84';
                        btn.style.color = '#000';
                        btn.style.cursor = 'pointer';
                        btn.style.opacity = '1';
                    } else {
                        btn.disabled = true;
                        btn.style.background = '#555';
                        btn.style.color = '#888';
                        btn.style.cursor = 'not-allowed';
                        btn.style.opacity = '0.8';
                    }
                }
            };
            box.appendChild(d);
        });
    }

    // --- DEPLOYMENT (Game Logicへの引き渡し) ---
    startMission() {
        document.getElementById('setup-screen').style.display = 'none';
        document.getElementById('reward-screen').style.display = 'none';
        
        // ★修正: ゲーム開始時にサイドバー一式を直接表示に戻す
        const sb = document.getElementById('sidebar');
        if(sb) sb.style.display = 'flex'; // CSSのflexレイアウトを維持
        
        const rs = document.getElementById('resizer');
        if(rs) rs.style.display = 'block';

        const tg = document.getElementById('sidebar-toggle');
        if(tg) tg.style.display = 'flex';

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
        // 2. 初回プレイならスロットから生成（選んだカードの顔・名前をそのまま兵士インスタンスに）
        else {
            this.setupSlots.forEach(slot => {
                const u = this.createSoldier(slot.key, 'player', null, slot.portraitIndex, slot.name);
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

    /** デッキから増援カード追加時に呼ぶ。ランダムなポートレート番号を返す（存在する画像のみで 404 防止）。 */
    getRandomPortraitIndex() {
        return Math.floor(Math.random() * (typeof PORTRAIT_AVAILABLE !== 'undefined' ? PORTRAIT_AVAILABLE : 7));
    }

    // --- UNIT FACTORY ---
    createSoldier(templateKey, team, fusionData, overridePortraitIndex, overrideName, fusionCount) {
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
        let portraitIndex = undefined;
        if (isPlayer && !t.isTank) { 
            if (overrideName) {
                name = overrideName;
            } else {
                const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]; 
                const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]; 
                name = `${last} ${first}`; 
            }
            if (overridePortraitIndex !== undefined) {
                portraitIndex = overridePortraitIndex;
            } else {
                portraitIndex = this.getRandomPortraitIndex();
            }
        }

        let baseHp = t.hp || 80;
        let baseAp = t.ap || 4;
        let skills = [];
        if (fusionData) {
            const count = Math.max(1, fusionCount || 1);
            const scale = Math.pow(2, count - 1);
            const hpBoost = (fusionData.hpBoost || 0) * scale;
            const apBonus = (fusionData.apBonus || 0) * scale;
            if (hpBoost) baseHp = Math.floor(baseHp * (1 + hpBoost));
            if (apBonus) baseAp = baseAp + Math.floor(apBonus);
            if (Array.isArray(fusionData.skills)) skills = [...fusionData.skills];
        }
        const isFusedTank = !!(t.isTank && fusionData);

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
                item.current = 1; item.cap = 1; item.reserve = (key === 'mg42' ? 300 : 12); 
            }
            return item;
        };

        let hands = [null, null, null];
        if (t.loadout) {
            t.loadout.forEach((k, i) => { if (i < 3) hands[i] = createItem(k); });
        } else if (t.main) {
            hands[0] = createItem(t.main);
            if (t.isTank && t.sub) {
                hands[1] = createItem(t.sub);
                if (isFusedTank) {
                    hands[2] = createItem(t.sub);
                    const r1 = (hands[1].reserve !== undefined) ? hands[1].reserve : 0;
                    const r2 = (hands[2].reserve !== undefined) ? hands[2].reserve : 0;
                    const total = r1 + r2;
                    if (total > 0) {
                        const half = Math.floor(total / 2);
                        if (hands[1].reserve !== undefined) hands[1].reserve = half;
                        if (hands[2].reserve !== undefined) hands[2].reserve = total - half;
                    }
                }
            }
        }

        let bag = [];
        if (t.sub && !t.isTank) { bag.push(createItem(t.sub)); }
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

        const hp = baseHp;
        const maxAp = baseAp;
        return { 
            id: Math.random(), team: team, q: 0, r: 0, def: t, name: name, rank: 0, faceSeed: faceSeed, portraitIndex: portraitIndex, stats: stats, hp: hp, maxHp: hp, ap: maxAp, maxAp: maxAp, hands: hands, bag: bag, stance: 'stand', skills: skills, sectorsSurvived: 0, deadProcessed: false 
        };
    }

    // --- MISSION END HANDLERS ---
    onSectorCleared(survivors) {
        this.survivingUnits = survivors;
        this.promoteSurvivors();
        if (typeof Renderer !== 'undefined' && Renderer.getFusedCardsFromHand) {
            this.carriedCards = Renderer.getFusedCardsFromHand();
        }
        
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
            u.sectorsSurvived = (u.sectorsSurvived || 0) + 1;
            if (!u.skills) u.skills = [];
            if (u.sectorsSurvived === 5) { u.skills.push("Hero"); u.maxAp = (u.maxAp || 4) + 1; }
            u.rank = Math.min(5, (u.rank||0) + 1);
            u.maxHp = (u.maxHp || 80) + 30; u.hp = (u.hp || u.maxHp) + 30;
            if (u.hp > u.maxHp) u.hp = u.maxHp;
            if (u.skills.length < 8 && Math.random() < 0.7) { 
                const k = Object.keys(typeof SKILLS !== 'undefined' ? SKILLS : {}).filter(z => z !== "Hero");
                if (k.length) u.skills.push(k[Math.floor(Math.random() * k.length)]);
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
            else if (u.def.isTank && u.hands) {
                u.hands.forEach(h => { if (h && h.code === 'mg42' && h.reserve !== undefined) h.reserve = 300; });
                if (u.hands[0] && u.hands[0].reserve !== undefined && u.hands[0].code !== 'mg42') u.hands[0].reserve = 12;
            } 
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
    units: [], // エラー回避用
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

/** LOGIC CAMPAIGN: Game Lifecycle, Data Persistence, and Unit Factory */

function isUnitTemplateAvailable(templateKey) {
    if (templateKey && typeof templateKey === 'object') templateKey = templateKey.type;
    const template = (typeof UNIT_TEMPLATES !== 'undefined') ? UNIT_TEMPLATES[templateKey] : null;
    if (!template) return false;
    if (template.isTank && (typeof FEATURE_TANK_UNITS === 'undefined' || !FEATURE_TANK_UNITS)) return false;
    return true;
}
if (typeof window !== 'undefined') window.isUnitTemplateAvailable = isUnitTemplateAvailable;

const AVAILABLE_CARDS = ['rifleman', 'scout', 'gunner', 'sniper', 'mortar_gunner', 'aerial', 'tank_pz4', 'tank_tiger']
    .filter(isUnitTemplateAvailable);

/** @deprecated 正本は data/pl_mg_tripod.js の PlMgTripod.TRIPOD_CODE_FOR_MAIN */
const TRIPOD_CODE_FOR_MAIN = (typeof PlMgTripod !== 'undefined')
    ? PlMgTripod.TRIPOD_CODE_FOR_MAIN
    : {};
if (typeof window !== 'undefined') window.TRIPOD_CODE_FOR_MAIN = TRIPOD_CODE_FOR_MAIN;

function createCardIcon(type) {
    const c = document.createElement('canvas'); c.width = 1; c.height = 1; return c.toDataURL();
}


class CampaignManager {
    constructor(options) {
        options = options || {};
        this.sector = 1;
        const search = (typeof location !== 'undefined' && location.search) || '';
        const replaySeed = typeof URLSearchParams !== 'undefined'
            ? new URLSearchParams(search).get('runSeed') : null;
        this.runSeed = String(options.runSeed || replaySeed || CampaignManager.createRunSeed());
        this.survivingUnits = [];
        this.setupSlots = [];
        this.isAutoMode = false;
        this.carriedCards = [];
        this.nextPortraitIndex = 0;
        this._startedMissionSector = null;
        this._autodeployScheduled = false;
        window.addEventListener('load', () => this.initSetupScreen());
    }

    static createRunSeed() {
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            const words = new Uint32Array(2);
            crypto.getRandomValues(words);
            return words[0].toString(16).padStart(8, '0') + words[1].toString(16).padStart(8, '0');
        }
        return Date.now().toString(36) + '-' + Math.floor(Math.random() * 0x100000000).toString(36);
    }

    getSectorSeed(sector) {
        const value = Number.isFinite(Number(sector)) ? Number(sector) : this.sector;
        return this.runSeed + ':sector:' + value;
    }

    /** 初期画面用: テンプレートから createSoldier と同じ ±1 ばらつきでプレビュー用 params を生成（毎回新シード）。 */
    getPreviewParams(t) {
        if (!t || !t.params || typeof PARAM_KEYS === 'undefined') return t.params || {};
        const baseParams = { ...t.params };
        const params = {};
        const isInfantry = !t.isTank;
        PARAM_KEYS.forEach(k => {
            let v = baseParams[k] != null ? baseParams[k] : 5;
            if (isInfantry) v = v + Math.floor(Math.random() * 3) - 1;
            params[k] = Math.max(1, Math.min(10, v));
        });
        return params;
    }

    /** 初期画面・カード用: canvas に能力値レーダーチャートを描画。getRadarPoints（data.js）で座標共通化。 */
    drawRadarCanvas(canvas, params) {
        if (!canvas || !params || typeof PARAM_KEYS === 'undefined' || typeof getRadarPoints !== 'function') return;
        const ctx = canvas.getContext('2d');
        const cw = canvas.width;
        const ch = canvas.height;
        const cx = cw / 2;
        const cy = ch / 2;
        const RADAR_MARGIN = 12;
        const r = Math.min(cx, cy) - RADAR_MARGIN;
        const keys = PARAM_KEYS;
        const labels = (typeof PARAM_LABELS !== 'undefined') ? PARAM_LABELS : keys.map(k => k.slice(0, 3));
        const { points, labelPositions, angles } = getRadarPoints(params, keys, r, 8);
        ctx.clearRect(0, 0, cw, ch);
        angles.forEach(angle => {
            ctx.strokeStyle = 'rgba(100,100,100,0.5)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
            ctx.stroke();
        });
        ctx.fillStyle = 'rgba(221,170,68,0.25)';
        ctx.beginPath();
        ctx.moveTo(cx + points[0].x, cy + points[0].y);
        for (let i = 1; i < points.length; i++) ctx.lineTo(cx + points[i].x, cy + points[i].y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(221,170,68,0.9)';
        ctx.lineWidth = 2;
        ctx.stroke();
        const fontPx = Math.max(8, Math.min(12, Math.floor(r / 5)));
        ctx.fillStyle = '#aaa';
        ctx.font = fontPx + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        labelPositions.forEach((lp, i) => { ctx.fillText(labels[i] || '', cx + lp.x, cy + lp.y); });
    }

    /** Queue the URL-driven setup once, even if multiple boot paths request it. */
    scheduleAutodeploy() {
        if (typeof location === 'undefined' || !new URLSearchParams(location.search).has('autodeploy')) return false;
        if (this._autodeployScheduled || this._startedMissionSector === this.sector) return false;
        this._autodeployScheduled = true;

        const run = () => {
            if (this._startedMissionSector === this.sector) {
                this._autodeployScheduled = false;
                return;
            }
            const box = document.getElementById('setup-cards');
            const cards = box ? box.querySelectorAll('.card') : [];
            if (cards.length < 3) {
                setTimeout(run, 60);
                return;
            }
            for (let i = 0; i < 3; i++) {
                if (!cards[i].classList.contains('selected')) cards[i].click();
            }
            const btn = document.getElementById('btn-start');
            if (btn && !btn.disabled && window.gameLogic && window.gameLogic.startCampaign) {
                const started = window.gameLogic.startCampaign();
                if (started !== false || this._startedMissionSector === this.sector) {
                    this._autodeployScheduled = false;
                    return;
                }
            }
            setTimeout(run, 80);
        };
        setTimeout(run, 200);
        return true;
    }

    // --- SETUP SCREEN LOGIC ---
    initSetupScreen() {
        // 募集画面へ戻る間はフローティングのログ/DEBUGを再び伏せる
        if (typeof document !== 'undefined' && document.body && document.body.classList) {
            document.body.classList.remove('mission-active');
        }
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
            const soldierName = (typeof generateSoldierName === 'function')
                ? generateSoldierName()
                : `${FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]} ${LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]}`;
            d.dataset.portraitIndex = String(portraitIndex);
            d.dataset.soldierName = soldierName;
            d.dataset.key = k;
            const portraitNum = String(portraitIndex + 1).padStart(3, '0');
            const faceUrl = 'asset/portraits/inf_us_' + portraitNum + '.jpg';
            
            const mainWeaponName = getTemplateMainWeaponName(k);
            d.innerHTML = `
                <div class="card-badge" style="display:none;">✔</div>
                <div style="background:#222; width:100%; text-align:center; padding:2px 0; border-bottom:1px solid #444; margin-bottom:5px;">
                    <h3 style="color:#d84; font-size:14px; margin:0;">${soldierName}</h3>
                    <div style="font-size:10px; color:#888; margin-top:2px;">${mainWeaponName}</div>
                </div>
                <div class="card-img-box" style="background:#111; text-align:center;">
                    <img src="${faceUrl}" style="width:96px; height:96px; object-fit:cover;" onerror="this.style.display='none'">
                </div>
                <div class="card-radar-box" style="background:#0d0d0d; padding:4px 0; text-align:center;">
                    <canvas class="unit-radar" width="128" height="128"></canvas>
                </div>
            `;
            const radarCanvas = d.querySelector('.unit-radar');
            if (radarCanvas && t.params && typeof PARAM_KEYS !== 'undefined') {
                const previewParams = this.getPreviewParams(t);
                this.drawRadarCanvas(radarCanvas, previewParams);
            }
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

        this.scheduleAutodeploy();
    }

    // --- DEPLOYMENT (Game Logicへの引き渡し) ---
    startMission() {
        const missionSector = this.sector;
        if (this._startedMissionSector === missionSector) return false;
        this._startedMissionSector = missionSector;
        try {
            const started = this._startMission();
            if (started === false && this._startedMissionSector === missionSector) {
                this._startedMissionSector = null;
            }
            return started;
        } catch (error) {
            if (this._startedMissionSector === missionSector) this._startedMissionSector = null;
            throw error;
        }
    }

    _startMission() {
        document.getElementById('setup-screen').style.display = 'none';
        document.getElementById('reward-screen').style.display = 'none';
        // フローティングのログ/DEBUGは旧ターン制でだけ解禁する。RTwPは右ペインが受け持つので、
        // ここで一瞬でも出すと左上に出て消える瞬きになる（出撃直後の1〜数フレーム）。
        const rtwp = window.RtwpBattle && window.RtwpBattle.isEnabled && window.RtwpBattle.isEnabled();
        if (!rtwp && document.body && document.body.classList) document.body.classList.add('mission-active');

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
        deployUnits.forEach(u => this.repairMortarGunnerLoadout(u, { ensureMissing: true }));

        if (typeof refreshAmmoItemLabel === 'function') {
            deployUnits.forEach(u => {
                const main = u.hands && u.hands[0];
                if (main && main.code && typeof WPNS !== 'undefined' && WPNS[main.code]) {
                    const master = WPNS[main.code];
                    if (master.acceptsAmmo) main.acceptsAmmo = master.acceptsAmmo.slice();
                    if (master.plCompat) main.plCompat = { ...master.plCompat };
                }
                const weapon = main || (main && main.code && WPNS[main.code]) || (u.def && u.def.main && WPNS[u.def.main]);
                if (weapon) (u.bag || []).forEach(item => refreshAmmoItemLabel(item, weapon));
            });
        }

        // BattleFacade（logic_game.js）をインスタンス化（RTwP-native の実行基盤）
        const Battle = window.BattleFacade || window.BattleLogic;
        if (Battle) {
            window.gameLogic = new Battle(this, deployUnits, this.sector);
            window.gameLogic.init();
            return true;
        }
        console.error("BattleFacade not found! logic_game.js loaded?");
        alert("BattleFacade Error: Please check console.");
        return false;
    }

    /** デッキから増援カード追加時に呼ぶ。ランダムなポートレート番号を返す（存在する画像のみで 404 防止）。 */
    getRandomPortraitIndex() {
        return Math.floor(Math.random() * (typeof PORTRAIT_AVAILABLE !== 'undefined' ? PORTRAIT_AVAILABLE : 7));
    }

    // --- UNIT FACTORY ---
    isMortarGunnerUnit(u) {
        if (!u || !u.hands) return false;
        const codes = u.hands.map(h => h && h.code);
        return codes.includes('mortar_barrel') && codes.includes('mortar_bipod') && codes.includes('mortar_plate');
    }

    /** 迫撃砲兵: 弾薬箱・拳銃の初期配置（ensureMissing 時のみ欠品を補う） */
    repairMortarGunnerLoadout(u, options) {
        if (!this.isMortarGunnerUnit(u)) return;
        const ensureMissing = !!(options && options.ensureMissing);
        const w = (code) => (typeof WPNS !== 'undefined' && WPNS[code]) ? WPNS[code] : null;
        const boxBase = w('mortar_shell_box');
        if (!boxBase) return;

        const bag = u.bag || (u.bag = []);
        const hands = u.hands || [];
        const allItems = () => bag.concat(hands).filter(Boolean);

        let box = allItems().find(i => i && i.code === 'mortar_shell_box');
        if (!box && ensureMissing) {
            box = {
                ...boxBase, code: 'mortar_shell_box', id: Math.random(),
                current: boxBase.current != null ? boxBase.current : boxBase.cap, cap: boxBase.cap
            };
            let bi = bag.findIndex(it => !it);
            if (bi < 0 && bag.length < 4) bag.push(box);
            else if (bi >= 0) bag[bi] = box;
        } else if (box && ensureMissing && (!box.current || box.current <= 0)) {
            box.current = boxBase.cap;
        }

        const sidearmCode = (u.def && u.def.opt) || 'm1911';
        const sideBase = w(sidearmCode);
        let sidearm = allItems().find(i => i && i.code === sidearmCode);
        if (!sidearm && ensureMissing && sideBase) {
            sidearm = {
                ...sideBase, code: sidearmCode, id: Math.random(),
                current: sideBase.cap, cap: sideBase.cap, isBroken: false
            };
            let si = bag.findIndex(it => !it);
            if (si < 0 && bag.length < 4) bag.push(sidearm);
            else if (si >= 0) bag[si] = sidearm;
        } else if (sidearm && sideBase && sidearm.current == null) {
            sidearm.current = sideBase.cap;
        }

        if (ensureMissing) {
            u.bag = [box || null, sidearm || null, bag[2] || null, bag[3] || null];
        }
    }

    createSoldier(templateKey, team, fusionData, overridePortraitIndex, overrideName, fusionCount) {
        const t = UNIT_TEMPLATES[templateKey]; 
        if (!t) { console.error("Template not found:", templateKey); return null; }
        if (!isUnitTemplateAvailable(templateKey)) return null;
        
        const isPlayer = (team === 'player'); 
        
        const baseParams = (t.params && typeof PARAM_KEYS !== 'undefined') ? { ...t.params } : { action:4, speed:4, str:5, morale:5, aim:5, throw:5, melee:5, recon:4 };
        const params = {};
        window.getParamKeys().forEach(k => {
            let v = baseParams[k] != null ? baseParams[k] : 5;
            if (isPlayer && !t.isTank) v = v + Math.floor(Math.random() * 3) - 1;
            params[k] = Math.max(1, Math.min(10, v));
        });
        
        let name = t.name; 
        let faceSeed = Math.floor(Math.random() * 99999);
        let portraitIndex = undefined;
        if (isPlayer && !t.isTank) { 
            if (overrideName) {
                name = overrideName;
            } else if (typeof generateSoldierName === 'function') {
                name = generateSoldierName();
            } else {
                const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]; 
                const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]; 
                name = `${first} ${last}`; 
            }
            if (overridePortraitIndex !== undefined) {
                portraitIndex = overridePortraitIndex;
            } else {
                portraitIndex = this.getRandomPortraitIndex();
            }
        }

        let baseHp = t.hp || 80;
        let baseAp = (t.ap != null ? t.ap : params.action);
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
            if (key.startsWith('pl_') && item.cbeNameIndex == null) {
                const n = parseInt(key.slice(3));
                if (!isNaN(n)) item.cbeNameIndex = n;
            }
            
            if (base.type === 'bullet' || base.type === 'shell_fast') {
                item.current = item.cap;
            } else if (base.type === 'shell' || base.area) { 
                item.current = 1; 
                item.isConsumable = true; 
            } else if (base.type === 'ammo') {
                item.current = base.current || base.cap;
            }
            if (t.isTank && !base.type.includes('part') && !base.type.includes('ammo')) {
                item.current = 1; item.cap = 1;
                item.reserve = (typeof PlMgTripod !== 'undefined' && PlMgTripod.usesBeltReserve(key))
                    ? PlMgTripod.getDefaultBeltReserve(key) : 12;
            } else if (typeof PlMgTripod !== 'undefined') {
                PlMgTripod.applyItemDefaults(item, key, false);
            }
            return item;
        };

        let hands = [null, null, null];
        if (t.loadout) {
            t.loadout.forEach((k, i) => { if (i < 3) hands[i] = createItem(k); });
        } else if (t.main) {
            let mainKey = t.main;
            if (isPlayer && !t.isTank && window.WPNS_PL_INFANTRY_MAIN_CODES && window.WPNS_PL_INFANTRY_MAIN_CODES.length) {
                const filterMain = window.isPlausibleInfantryMainWeapon || function () { return false; };
                const pool = window.WPNS_PL_INFANTRY_MAIN_CODES.filter(filterMain);
                if (pool.length) mainKey = pool[Math.floor(Math.random() * pool.length)];
            }
            hands[0] = createItem(mainKey);
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
        const isMortarTemplate = !!(t.loadout && t.sub === 'mortar_shell_box' && !t.isTank);
        if (isMortarTemplate) {
            bag.push(createItem('mortar_shell_box'));
            if (t.opt) bag.push(createItem(t.opt));
        } else {
            if (t.sub && !t.isTank) {
                let subKey = t.sub;
                const subDef = WPNS[subKey];
                const keepSubFixed = !!(t.loadout || (subDef && (subDef.type === 'ammo' || subDef.ammoFor)));
                if (isPlayer && !keepSubFixed && window.WPNS_PL_INFANTRY_SUB_CODES && window.WPNS_PL_INFANTRY_SUB_CODES.length) {
                    const subPool = window.WPNS_PL_INFANTRY_SUB_CODES.filter(k => WPNS[k] && (WPNS[k].plCategory === 'pistol' || WPNS[k].plCategory === 'melee'));
                    if (subPool.length) subKey = subPool[Math.floor(Math.random() * subPool.length)];
                }
                bag.push(createItem(subKey));
            }
            if (t.opt) {
                const optBase = WPNS[t.opt];
                const count = optBase.mag || 1;
                for (let i = 0; i < count; i++) { bag.push(createItem(t.opt)); }
            }
            // 銃擲弾。**今そいつが持っている小銃に適合するものだけ**を配る
            // （RIFLE_GRENADE_FOR_MAIN は PL 実データ由来）。適合品が無い銃なら
            // 何も持たない — 持てるはずのない装備を生やさないための分岐。
            const rgTable = (typeof RIFLE_GRENADE_FOR_MAIN !== 'undefined')
                ? RIFLE_GRENADE_FOR_MAIN : (window.RIFLE_GRENADE_FOR_MAIN || {});
            const mainCode = hands[0] && hands[0].code;
            const rgCodes = (t.rifleGrenade && mainCode) ? rgTable[mainCode] : null;
            if (rgCodes && rgCodes.length && WPNS[rgCodes[0]]) {
                const rgCode = rgCodes[0];
                const rgCount = WPNS[rgCode].mag || 1;
                for (let i = 0; i < rgCount; i++) { bag.push(createItem(rgCode)); }
            }
        }
        
        if (isPlayer && !t.isTank && hands[0] && hands[0].code) {
            const tripCode = TRIPOD_CODE_FOR_MAIN[hands[0].code];
            if (tripCode && WPNS[tripCode]) {
                const hasInLoadout = (typeof PlMgTripod !== 'undefined' && PlMgTripod.findTripodInLoadout)
                    ? PlMgTripod.findTripodInLoadout({ hands }, tripCode) >= 0
                    : hands.slice(1).some(it => it && it.code === tripCode);
                if (!hasInLoadout) {
                    const bi = bag.findIndex(it => it && it.code === tripCode);
                    const tripod = bi >= 0 ? bag.splice(bi, 1)[0] : createItem(tripCode);
                    let slot = (typeof PlMgTripod !== 'undefined' && PlMgTripod.findEmptyTripodLoadoutSlot)
                        ? PlMgTripod.findEmptyTripodLoadoutSlot({ hands })
                        : hands.findIndex((it, i) => i > 0 && !it);
                    if (slot < 1) slot = !hands[1] ? 1 : (!hands[2] ? 2 : -1);
                    if (slot >= 1 && slot <= 2) hands[slot] = tripod;
                }
            }
        }

        if (hands[0] && hands[0].type === 'bullet' && !t.isTank && hands[0].mag
            && hands[0].acceptsAmmo && hands[0].acceptsAmmo.length) {
            for (let i = 0; i < hands[0].mag; i++) {
                if (bag.length >= 4) break;
                if (typeof buildSpareAmmoItem === 'function') {
                    bag.push(buildSpareAmmoItem(hands[0]));
                } else {
                    bag.push({
                        type: 'ammo', name: hands[0].magName || 'Mag', ammoFor: hands[0].code,
                        cap: hands[0].cap, current: hands[0].cap, jam: hands[0].jam, code: 'mag'
                    });
                }
            }
        }

        if (!isPlayer) {
            if (typeof REALISM_PACK !== 'undefined' && REALISM_PACK.ENEMY_FINITE_AMMO) {
                // REALISM_PACK.ENEMY_FINITE_AMMO: 敵も有限弾（携行マガジン3本相当 = 本体満タン + 予備2本）
                if (t.isTank) {
                    if (hands[0] && !hands[0].partType) { hands[0].current = hands[0].cap || 1; }
                } else if (hands[0] && !hands[0].partType && hands[0].cap) {
                    hands[0].current = hands[0].cap;
                    if (typeof buildSpareAmmoItem === 'function') {
                        const spareN = (hands[0].plCategory === 'mg') ? 3 : 2;
                        for (let si = 0; si < spareN && bag.length < 4; si++) {
                            bag.push(buildSpareAmmoItem(hands[0]));
                        }
                    }
                } else if (hands[0] && !hands[0].partType) {
                    hands[0].current = 999;
                }
            } else {
                if (hands[0] && !hands[0].partType) { hands[0].current = 999; }
                bag = [];
            }
        }

        if (isPlayer && !t.isTank && fusionCount >= 2 && Math.random() < 0.45) {
            const allWeapons = [...hands, ...bag].filter(it => it && (it.dmg || it.dmg === 0));
            if (allWeapons.length > 0) {
                const pick = allWeapons[Math.floor(Math.random() * allWeapons.length)];
                pick.isRainbow = true;
                pick.rainbowDmgBonus = 6 + Math.floor(Math.random() * 18);
            }
        }


        const hp = baseHp;
        const maxAp = baseAp;
        const unitFusionCount = (isPlayer && fusionCount >= 2) ? fusionCount : undefined;
        const unit = {
            id: Math.random(), team: team, q: 0, r: 0, def: t, name: name, rank: 0, faceSeed: faceSeed, portraitIndex: portraitIndex,
            params: params, hp: hp, maxHp: hp, ap: maxAp, maxAp: maxAp, hands: hands, bag: bag,
            stance: t.isTank ? 'stand' : 'prone',
            skills: skills, sectorsSurvived: 0, kills: 0, deadProcessed: false, fusionCount: unitFusionCount
        };
        if (t.loadout) this.repairMortarGunnerLoadout(unit, { ensureMissing: true });
        if (typeof sanitizeUnitSpareAmmo === 'function') sanitizeUnitSpareAmmo(unit);
        else if (typeof sanitizeUnitBagAmmo === 'function') sanitizeUnitBagAmmo(unit);
        if (typeof LoadoutWeight !== 'undefined') LoadoutWeight.refreshUnitLoadout(unit);
        return unit;
    }

    // --- MISSION END HANDLERS ---
    onSectorCleared(survivors, transition) {
        transition = transition || {};
        const liveRoster = (typeof window !== 'undefined' && window.gameLogic
            && Array.isArray(window.gameLogic.units)) ? window.gameLogic.units : [];
        const snapshotRoster = this.endBattleSnapshot && Array.isArray(this.endBattleSnapshot.units)
            ? this.endBattleSnapshot.units : [];
        // The live facade normally retains defeated units, while the immutable
        // review snapshot is the fallback for adapters that only expose survivors.
        const activeRoster = liveRoster.concat(snapshotRoster);
        const playerRoster = [];
        const rosterIds = new Set();
        activeRoster.concat(this.survivingUnits || [], survivors || []).forEach(u => {
            if (!u || u.team !== 'player') return;
            const id = String(u.id);
            if (rosterIds.has(id)) return;
            rosterIds.add(id);
            playerRoster.push(u);
        });
        const survivorIds = new Set((survivors || []).map(u => String(u.id)));
        const casualties = playerRoster.filter(u => !survivorIds.has(String(u.id)) && Number(u.hp) <= 0);
        this.survivingUnits = survivors;
        const battleEnd = new Map(playerRoster.map(u => [String(u.id), {
            hp: u.hp, maxHp: u.maxHp,
            // RTwP writes HP/state back directly. Capture a display-ready
            // condition instead of relying only on the campaign flag.
            wounded: !!u.wounded || (u.hp > 0 && u.hp < u.maxHp * 0.25)
                || u.simState === 'incap',
            sectorKills: Math.max(0, Number(u._sectorKills) || 0),
            kills: Math.max(0, Number(u.kills) || 0), rank: Number(u.rank) || 0,
            skills: Array.isArray(u.skills) ? u.skills.slice() : []
        }]));
        const promotions = this.promoteSurvivors();
        // Ammunition is a transition service, not a reward selection. Preserve
        // wounds for the next sector so the report and campaign consequences match.
        this.resupplySurvivors({ heal: false });
        if (typeof Renderer !== 'undefined' && Renderer.getFusedCardsFromHand) {
            this.carriedCards = Renderer.getFusedCardsFromHand();
        }
        
        const screen = document.getElementById('reward-screen');
        if (!screen) return;
        // Rebuild the entrance animation for every sector; otherwise the
        // previous completed animation class can make the next reward pop.
        if (screen.classList && screen.classList.remove) {
            screen.classList.remove('sector-clear-animate');
            // Force a reflow when available so repeated transitions restart.
            void screen.offsetWidth;
        }
        screen.style.display = 'flex';
        if (typeof BattleReview !== 'undefined' && this.endBattleSnapshot) {
            BattleReview.addAction(screen, this.endBattleSnapshot);
        }
        const b = document.getElementById('reward-cards'); 
        b.innerHTML = ''; 
        this.renderVictoryReport(b, casualties, survivors, battleEnd, promotions);
        if (screen.classList && screen.classList.add) screen.classList.add('sector-clear-animate');
        if (!transition.jingleStarted && typeof window !== 'undefined'
            && window.Sfx && typeof window.Sfx.play === 'function') {
            window.Sfx.play('sector_clear');
        }
        return;
        
        const replacementHint = (typeof REALISM_PACK !== 'undefined' && REALISM_PACK.REPLACEMENT_PENALTY) ? '（経験不足）' : '';
        [{k:'rifleman',t:'新兵' + replacementHint}, {k:'mortar_gunner',t:'迫撃砲兵' + replacementHint}, {k:'tank_pz4',t:'鹵獲戦車'}, {k:'supply',t:'補給'}]
            .filter(o => o.k === 'supply' || isUnitTemplateAvailable(o.k))
            .forEach(o => {
            const d = document.createElement('div'); d.className = 'card';
            const iconType = o.k === 'supply' ? 'heal' : 'infantry';
            d.innerHTML = `<div class="card-img-box"><img src="${createCardIcon(iconType)}"></div><div class="card-body"><p>${o.t}</p></div>`;
            d.onclick = () => {
                if (o.k === 'supply') {
                    this.resupplySurvivors();
                } else {
                    const newUnit = this.createSoldier(o.k, 'player');
                    // REALISM_PACK.REPLACEMENT_PENALTY: 補充兵は経験不足で各能力値-1（下限1）
                    if (typeof REALISM_PACK !== 'undefined' && REALISM_PACK.REPLACEMENT_PENALTY
                        && newUnit && !newUnit.def?.isTank) {
                        newUnit.isReplacement = true;
                        if (newUnit.params) {
                            Object.keys(newUnit.params).forEach(pk => {
                                if (typeof newUnit.params[pk] === 'number') {
                                    newUnit.params[pk] = Math.max(1, newUnit.params[pk] - 1);
                                }
                            });
                        }
                        if (newUnit.name && newUnit.name.indexOf('(新)') === -1) {
                            newUnit.name = `${newUnit.name} (新)`;
                        }
                    }
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
        if (screen.classList && screen.classList.add) {
            screen.classList.add('sector-clear-animate');
        }
        // RTwP starts the jingle at the beginning of its resolve beat. Keep
        // this fallback for direct campaign callers and non-RTwP victories,
        // while avoiding a duplicate when RTwP already started it.
        if (!transition.jingleStarted && typeof window !== 'undefined'
            && window.Sfx && typeof window.Sfx.play === 'function') {
            window.Sfx.play('sector_clear');
        }
    }

    /**
     * 敗北画面。**負け方を取り違えて伝えない。**
     *
     * sim は「行動不能だけが残った＝戦闘継続不能」を rout として、全員戦死の
     * annihilation と区別している（sim_core._phaseCheckResult）。文言が
     * 「全滅しました」固定だったため、負傷兵が盤上に生きているのに全滅と
     * 表示されていた（2026-08-03 実プレイ報告）。命中モデルをPL正本へ替えて
     * 負傷で止まる兵が増え、rout 経路の頻度が上がって露見した。
     * 2026-08-04: 士気に回復を入れて敗走が一時的な状態になったため、決着理由の
     * 'rout' は廃止し 'incapacitated'（行動不能だけが残った）へ改名した。
     * 敗走中の兵は戦闘力ありとして数える。
     * @param {string=} reason sim_core の決着理由（'annihilation' | 'incapacitated' | 'mutual'）
     * @param {number=} survivors 生存している自軍兵数（戦闘不能を含む）
     */
    onGameOver(reason, survivors) {
        const screen = document.getElementById('gameover-screen');
        if (!screen) return;
        const title = screen.querySelector('h1');
        const body = screen.querySelector('p');
        const alive = Number(survivors) || 0;
        if (reason === 'incapacitated' || (reason !== 'annihilation' && alive > 0)) {
            if (title) title.textContent = 'COMBAT INEFFECTIVE';
            if (body) {
                body.textContent = alive > 0
                    ? `分隊は戦闘継続不能（生存 ${alive} 名 — 全員が行動不能）`
                    : '分隊は戦闘継続不能';
            }
        } else {
            if (title) title.textContent = 'M.I.A.';
            if (body) body.textContent = '全滅しました';
        }
        screen.style.display = 'flex';
        if (typeof BattleReview !== 'undefined' && this.endBattleSnapshot) {
            BattleReview.addAction(screen, this.endBattleSnapshot);
        }
        if (window.Sfx) Sfx.play('sector_fail');
    }

    /** Render a dense, independently scrollable casualty/survivor report. */
    renderVictoryReport(container, casualties, survivors, battleEnd, promotions) {
        container.className = 'sector-report';
        const promoById = new Map((promotions || []).map(p => [String(p.id), p]));
        const allReported = (casualties || []).concat(survivors || []);
        const totalKills = allReported.reduce((sum, u) => sum + ((battleEnd.get(String(u.id)) || {}).sectorKills || 0), 0);
        const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[ch]);
        const portraitFor = u => Number.isFinite(Number(u.portraitIndex))
            ? `asset/portraits/inf_us_${String(Number(u.portraitIndex) + 1).padStart(3, '0')}.jpg`
            : 'asset/portraits/inf_us_001.jpg';
        const roleFor = u => {
            const def = u.def || {};
            const name = def.name || def.role || 'SOLDIER';
            return def.role && def.role.toLowerCase() !== String(name).toLowerCase()
                ? `${name} / ${def.role}` : name;
        };
        const roleShortFor = u => {
            const role = roleFor(u);
            const common = {
                rifleman: 'RFL', scout: 'SCT', gunner: 'GNR', sniper: 'SNP',
                'mortar gunner': 'MTR', infantry: 'INF', tank: 'TNK'
            };
            return common[String((u.def && u.def.name) || role).toLowerCase()] || role;
        };
        const skillName = key => (typeof SKILLS !== 'undefined' && SKILLS[key] && SKILLS[key].name)
            ? SKILLS[key].name : key;
        const viewportHeight = (typeof window !== 'undefined' && Number(window.innerHeight)) || 720;
        const reportHeight = Math.min(880, Math.max(180, viewportHeight - 92));
        const reportPageSize = Math.max(1, Math.floor((reportHeight - 116) / 38));

        const summary = document.createElement('div');
        summary.className = 'sector-report-summary';
        summary.innerHTML = `<span title="Survivors"><b>${survivors.length}</b> SURV</span>`
            + `<span class="sector-report-summary-kia" title="Killed in action"><b>${casualties.length}</b> KIA</span>`
            + `<span title="Confirmed kills"><b>${totalKills}</b> Σ KILLS</span>`
            + '<span title="Ammunition restocked">AMMO +</span>';
        container.appendChild(summary);

        const columns = document.createElement('div');
        columns.className = 'sector-report-columns';
        const buildColumn = (title, subtitle, units, kind) => {
            const panel = document.createElement('section');
            panel.className = `sector-report-panel sector-report-panel-${kind}`;
            panel.innerHTML = `<header class="sector-report-panel-head"><span title="${escapeHtml(subtitle)}">${escapeHtml(title)}</span>`
                + `<small>◉ BTL/Σ · ♥ HP · ▲ RANK/SKILL</small><b>${units.length}</b></header>`;
            const list = document.createElement('div');
            list.className = 'sector-report-list';
            const sortedUnits = units.slice()
                .sort((a, z) => ((battleEnd.get(String(z.id)) || {}).sectorKills || 0)
                    - ((battleEnd.get(String(a.id)) || {}).sectorKills || 0));
            const pageCount = Math.max(1, Math.ceil(sortedUnits.length / reportPageSize));
            let pageIndex = 0;
            const pager = document.createElement('footer');
            pager.className = 'sector-report-pager';
            pager.innerHTML = '<button type="button" aria-label="Previous report page">‹</button>'
                + '<span aria-live="polite"></span><button type="button" aria-label="Next report page">›</button>';
            const pagerButtons = pager.querySelectorAll('button');
            const pagerStatus = pager.querySelector('span');
            const renderPage = () => {
                list.innerHTML = '';
                if (!sortedUnits.length) {
                    const empty = document.createElement('div');
                    empty.className = 'sector-report-empty';
                    empty.textContent = kind === 'kia' ? 'NO FRIENDLY LOSSES' : 'NO SURVIVORS';
                    list.appendChild(empty);
                }
                sortedUnits.slice(pageIndex * reportPageSize, (pageIndex + 1) * reportPageSize).forEach(u => {
                    const before = battleEnd.get(String(u.id)) || {};
                    const promotion = promoById.get(String(u.id)) || {};
                    const addedSkills = new Set(promotion.addedSkills || []);
                    const skills = (kind === 'kia' ? before.skills : u.skills) || [];
                    const condition = kind === 'kia' ? 'KIA' : (before.wounded ? 'WOUNDED' : 'FIT');
                    const skillSummary = skills.length
                        ? skills.map(sk => `${addedSkills.has(sk) ? '+' : ''}${skillName(sk)}`).join(' · ')
                        : 'NO SKILL';
                    const promotionLine = kind === 'kia'
                        ? `<strong>—</strong><small title="LOST: ${escapeHtml(skillSummary)}">${escapeHtml(skillSummary)}</small>`
                        : `<strong>▲ R${before.rank || 0}→R${u.rank || 0}</strong>`
                            + `<small title="MAX HP +${promotion.hpGain || 0} / ${escapeHtml(skillSummary)}">+${promotion.hpGain || 0}HP · ${escapeHtml(skillSummary)}</small>`;
                    const medal = kind === 'kia' && u.team === 'player' && Number(before.hp) <= 0
                        ? '<span class="sector-report-purple-heart" role="img" aria-label="Purple Heart" title="Purple Heart"><i></i><span>♥</span></span>'
                        : '';
                    const row = document.createElement('div');
                    row.className = `sector-report-row ${kind}${before.wounded && kind !== 'kia' ? ' wounded' : ''}`;
                    row.innerHTML = `<img class="sector-report-portrait" src="${portraitFor(u)}" alt="">`
                        + `<div class="sector-report-identity" title="${escapeHtml(roleFor(u))}"><span><b>${escapeHtml(u.name)}</b><small>${escapeHtml(roleShortFor(u))}</small></span>${medal}</div>`
                        + `<div class="sector-report-cell" title="This battle / career kills"><label>◉</label><strong>${before.sectorKills || 0}<i>/Σ${before.kills || 0}</i></strong></div>`
                        + `<div class="sector-report-cell" title="Final HP / status"><label>♥</label><strong class="condition-${condition.toLowerCase()}">${Math.max(0, Number(before.hp) || 0)}/${before.maxHp || 0}<i>${condition}</i></strong></div>`
                        + `<div class="sector-report-cell sector-report-promotion">${promotionLine}</div>`;
                    list.appendChild(row);
                });
                pager.hidden = pageCount <= 1;
                pagerStatus.textContent = `${pageIndex + 1} / ${pageCount}`;
                pagerButtons[0].disabled = pageIndex === 0;
                pagerButtons[1].disabled = pageIndex >= pageCount - 1;
            };
            pagerButtons[0].onclick = () => { if (pageIndex > 0) { pageIndex--; renderPage(); } };
            pagerButtons[1].onclick = () => { if (pageIndex < pageCount - 1) { pageIndex++; renderPage(); } };
            renderPage();
            panel.appendChild(list);
            panel.appendChild(pager);
            return panel;
        };
        columns.appendChild(buildColumn('FALLEN', 'FRIENDLY KIA', casualties || [], 'kia'));
        columns.appendChild(buildColumn('SURVIVORS', 'FIT / WOUNDED / PROMOTED', survivors || [], 'survivor'));
        container.appendChild(columns);

        const next = document.createElement('button');
        next.className = 'sector-report-next';
        next.textContent = 'CONTINUE TO NEXT SECTOR';
        next.onclick = () => { this.sector++; this.startMission(); };
        container.appendChild(next);
    }

    promoteSurvivors() {
        return this.survivingUnits.map(u => {
            const beforeSkills = Array.isArray(u.skills) ? u.skills.slice() : [];
            const beforeHp = u.hp || 0;
            u.sectorsSurvived = (u.sectorsSurvived || 0) + 1;
            if (!u.skills) u.skills = [];
            if (u.sectorsSurvived === 5 && !u.skills.includes("Hero")) u.skills.push("Hero");
            u.rank = Math.min(5, (u.rank||0) + 1);
            u.maxHp = (u.maxHp || 80) + 30; u.hp = (u.hp || u.maxHp) + 30;
            if (u.hp > u.maxHp) u.hp = u.maxHp;
            if (u.skills.length < 8 && Math.random() < 0.7) {
                const k = Object.keys(typeof SKILLS !== 'undefined' ? SKILLS : {}).filter(z => z !== "Hero");
                const available = k.filter(skill => !u.skills.includes(skill));
                if (available.length) u.skills.push(available[Math.floor(Math.random() * available.length)]);
            }
            if (window.gameLogic && window.gameLogic.refreshWoundedState) window.gameLogic.refreshWoundedState(u);
            return {
                id: u.id,
                hpGain: Math.max(0, (u.hp || 0) - beforeHp),
                addedSkills: (u.skills || []).filter(skill => beforeSkills.indexOf(skill) < 0)
            };
        });
    }

    resupplySurvivors(options = {}) {
        const heal = options.heal === true;
        const BAG_SLOTS = 4;
        this.survivingUnits.forEach(u => {
            if (heal && u.hp < u.maxHp) u.hp = Math.floor(u.maxHp * 0.8);
            if (window.gameLogic && window.gameLogic.refreshWoundedState) window.gameLogic.refreshWoundedState(u);

            if (!u.hands) u.hands = [null, null, null];
            if (!u.bag) u.bag = [];
            while (u.bag.length < BAG_SLOTS) u.bag.push(null);

            const w = (code) => (typeof WPNS !== 'undefined' && WPNS[code]) ? WPNS[code] : null;

            u.hands.forEach(h => {
                if (!h) return;
                if (h.current !== undefined && h.cap !== undefined) h.current = h.cap;
                if (h.reserve !== undefined) {
                    if (typeof PlMgTripod !== 'undefined' && PlMgTripod.usesBeltReserve(h.code)) {
                        h.reserve = PlMgTripod.getDefaultBeltReserve(h.code);
                    } else h.reserve = 12;
                }
            });

            let mainWeapon = u.hands[0];
            const mainCode = mainWeapon ? mainWeapon.code : (u.def && u.def.main) ? u.def.main : null;
            if (mainWeapon && mainCode && typeof WPNS !== 'undefined' && WPNS[mainCode] && WPNS[mainCode].acceptsAmmo) {
                mainWeapon.acceptsAmmo = WPNS[mainCode].acceptsAmmo.slice();
            }
            const mainBase = mainCode ? w(mainCode) : null;
            if (!mainWeapon && mainBase) mainWeapon = mainBase;

            u.bag.forEach((item) => {
                if (!item) return;
                if (item.current !== undefined && item.cap !== undefined) item.current = item.cap;
                if (item.reserve !== undefined && !(typeof PlMgTripod !== 'undefined' && PlMgTripod.usesBeltReserve(item.code))) {
                    item.reserve = 12;
                }
            });
            const optCode = (u.def && u.def.opt) ? u.def.opt : null;
            const nadeBase = optCode === 'nade' ? w('nade') : null;

            const emptySlots = [];
            u.bag.forEach((item, i) => { if (!item) emptySlots.push(i); });

            let slotIdx = 0;
            if (mainBase && mainBase.type === 'bullet' && !u.def.isTank && mainBase.mag
                && mainWeapon && mainWeapon.acceptsAmmo && mainWeapon.acceptsAmmo.length) {
                const weaponForAmmo = mainWeapon || mainBase;
                const need = Math.min(emptySlots.length, mainBase.mag);
                for (let k = 0; k < need && slotIdx < emptySlots.length; k++, slotIdx++) {
                    if (typeof buildSpareAmmoItem === 'function') {
                        u.bag[emptySlots[slotIdx]] = buildSpareAmmoItem({ ...weaponForAmmo, code: mainCode });
                    } else {
                        u.bag[emptySlots[slotIdx]] = {
                            type: 'ammo', name: (mainBase.magName || 'Clip'), ammoFor: mainCode,
                            cap: mainBase.cap, current: mainBase.cap, code: 'mag', jam: mainBase.jam
                        };
                    }
                }
            }
            if (nadeBase && slotIdx < emptySlots.length) {
                const need = Math.min(emptySlots.length - slotIdx, nadeBase.mag || 2);
                for (let k = 0; k < need; k++, slotIdx++) {
                    u.bag[emptySlots[slotIdx]] = {
                        ...nadeBase, code: 'nade', id: Math.random(),
                        current: 1, cap: 1, isConsumable: true
                    };
                }
            }

            if (typeof refreshAmmoItemLabel === 'function' && mainWeapon) {
                u.bag.forEach(item => refreshAmmoItemLabel(item, mainWeapon));
            }
            this.repairMortarGunnerLoadout(u, { ensureMissing: true });
        });
    }
}

// キャンペーンマネージャーを起動
window.campaign = new CampaignManager();

window.campaign.scheduleAutodeploy();

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

/** ?mapdebug=1 — 地形確認用: セットアップを飛ばしてマップだけ表示 */
if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('mapdebug')) {
    const bootMapDebug = () => {
        ['setup-screen', 'gameover-screen', 'reward-screen'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        ['sidebar', 'resizer', 'sidebar-toggle'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        const app = document.getElementById('app');
        if (app) app.classList.add('phaser-sidebar');
        window.campaign.survivingUnits = [];
        window.campaign.setupSlots = [
            { key: 'rifleman', portraitIndex: 1, name: 'Debug A' },
            { key: 'rifleman', portraitIndex: 2, name: 'Debug B' },
            { key: 'rifleman', portraitIndex: 3, name: 'Debug C' }
        ];
        window.campaign.startMission();
        setTimeout(() => {
            if (typeof Renderer !== 'undefined') Renderer.centerMap();
        }, 400);
    };
    const runBoot = () => setTimeout(bootMapDebug, (window.BattleFacade || window.BattleLogic) ? 200 : 1200);
    if (document.readyState === 'complete') runBoot();
    else window.addEventListener('load', runBoot);
}

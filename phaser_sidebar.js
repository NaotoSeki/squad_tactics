/** PHASER SIDEBAR: Right panel rendered in Phaser (unit info, loadout, log) */
const SIDEBAR_WIDTH_DEFAULT = 340;
const SIDEBAR_WIDTH_MIN = 200;
const SIDEBAR_WIDTH_MAX = 560;
const initialSidebarMax = Math.max(SIDEBAR_WIDTH_MIN,
    Math.min(SIDEBAR_WIDTH_MAX, window.innerWidth - 320));
const responsiveSidebarDefault = Math.max(SIDEBAR_WIDTH_MIN,
    Math.min(SIDEBAR_WIDTH_DEFAULT, window.innerWidth * 0.30));
window.__sidebarWidth = window.__sidebarWidth != null
    ? Math.max(SIDEBAR_WIDTH_MIN, Math.min(initialSidebarMax, window.__sidebarWidth))
    : Math.min(initialSidebarMax, responsiveSidebarDefault);
window.getSidebarWidth = function() { return (typeof window.__sidebarWidth === 'number' ? window.__sidebarWidth : SIDEBAR_WIDTH_DEFAULT); };
document.documentElement.style.setProperty('--sidebar-width', window.__sidebarWidth + 'px');
window.syncSidebarWidthToViewport = function() {
    const max = Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, window.innerWidth - 320));
    const next = Math.max(SIDEBAR_WIDTH_MIN, Math.min(max, window.getSidebarWidth()));
    if (next === window.__sidebarWidth) return;
    window.__sidebarWidth = next;
    document.documentElement.style.setProperty('--sidebar-width', next + 'px');
    if (window.notifySidebarResize) window.notifySidebarResize();
};
window.addEventListener('resize', window.syncSidebarWidthToViewport);
const PANEL_BG = 0x1a1a1a;
const HEADER_BG = 0x111111;
const SLOT_BG = 0x111111;
const SLOT_BORDER = 0x444444;
const ACCENT = 0xddaa44;
/** 残弾ゲージを1発ずつ落とす間隔(ms)。表示だけの演出で、実弾数は sim が持つ */
const AMMO_PIP_STEP_MS = 55;
/** 背嚢の中身の個数。予備弾倉が消えたことを検出してスロットを組み直すのに使う */
function bagItemCount(u) {
    if (!u) return -1;
    let n = (u.bag || []).length;
    for (let i = 1; i < 3; i++) if (u.hands && u.hands[i]) n++;
    return n;
}
const TEXT_COLOR = '#bbbbbb';
const TEXT_DIM = '#888888';

/** レーダーチャート（右ペイン）のレイアウト・表示しきい値 */
const RADAR_R_MAX = 130;
const RADAR_R_MIN = 36;
const RADAR_OFFSET_BASE = 108;
const RADAR_OFFSET_RADIUS_THRESHOLD = 48;
const RADAR_OFFSET_RADIUS_FACTOR = 0.5;
const RADAR_SHOW_GRID_AT = 44;
const RADAR_SHOW_GRID_DETAIL_AT = 58;
const RADAR_SHOW_VALUES_AT = 70;
const RADAR_SHOW_FULL_GRID_AT = 82;
const RADAR_LABEL_OFFSET_BASE = 10;
const RADAR_LABEL_OFFSET_EXTRA = 4;
const RADAR_LABEL_OFFSET_RADIUS_THRESHOLD = 56;
const RADAR_VALUE_POS_RATIO = 0.7;
const RADAR_BOTTOM_MARGIN = 16;
const GAUGE_TOP = 38;
const GAUGE_BOTTOM_PAD = 6;
const BAG_SLOT_H = 54;
/** 背嚢の枠数。2列×4段（logic_ui.js のDOM版サイドバーと必ず揃える） */
const BAG_SLOTS = 8;

window.PhaserSidebar = class PhaserSidebar {
    constructor(scene) {
        this.scene = scene;
        this.container = scene.add.container(0, 0).setDepth(5000).setScrollFactor(0);
        this.panelBg = null;
        this.unitContent = null;
        this.slots = [];
        this.dragSrc = null;
        this.dragGhost = null;
        this.currentUnit = null;
        this.squadChips = [];
        this.rtwpAmmoText = null;
        this.ammoPips = [];
        this.ammoPipItem = null;
        this._ammoPipsDrawn = -1;
        this._ammoPipsShown = null;
        this._bagCount = -1;
    }

    init() {
        const w = this.scene.scale.width;
        const h = this.scene.scale.height;
        const sw = window.getSidebarWidth();
        const panelX = w - sw / 2;

        this.panelBg = this.scene.add.rectangle(panelX, h / 2, sw, h, PANEL_BG);
        this.panelBg.setStrokeStyle(1, SLOT_BORDER);
        this.container.add(this.panelBg);

        this.unitContent = this.scene.add.container(0, 0);
        this.container.add(this.unitContent);

        this.noSignalText = this.scene.add.text(panelX, h / 2 - 80, '// NO SIGNAL //', { fontSize: '14px', color: '#555555', fontFamily: 'sans-serif' });
        this.noSignalText.setOrigin(0.5, 0.5);
        this.noSignalText.setVisible(false);
        this.container.add(this.noSignalText);

    }

    updateSidebar(u, state, tankAutoReload) {
        if (typeof hideLoadoutCompatTooltip === 'function') hideLoadoutCompatTooltip();
        this.unitContent.removeAll(true);
        this.currentUnit = u;
        this.squadChips = [];
        this.rtwpAmmoText = null;
        this.ammoPips = [];
        this.ammoPipItem = null;
        this._ammoPipsDrawn = -1;
        this._ammoPipsShown = null;
        this._bagCount = bagItemCount(u);

        if (!u || u.hp <= 0) {
            this.noSignalText.setVisible(true);
            return;
        }
        this.noSignalText.setVisible(false);

        const w = this.scene.scale.width;
        const h = this.scene.scale.height;
        const sw = window.getSidebarWidth();
        const left = w - sw + 12;
        let y = 12;

        const usePortrait = (u.team === 'player' && !u.def.isTank && u.portraitIndex !== undefined);
        const portraitKey = usePortrait ? ('portrait_' + ((u.portraitIndex % (typeof PORTRAIT_AVAILABLE !== 'undefined' ? PORTRAIT_AVAILABLE : 7)) + 1)) : null;
        const faceKey = portraitKey && this.scene.textures.exists(portraitKey) ? portraitKey : ('face_' + (u.faceSeed || u.id || 0));
        let faceUrl = '';
        if (faceKey.startsWith('face_') && typeof Renderer !== 'undefined' && Renderer && Renderer.generateFaceIcon) {
            faceUrl = Renderer.generateFaceIcon(u.faceSeed || 0);
        }
        if (faceUrl && !this.scene.textures.exists(faceKey)) {
            try {
                const dataUrl = faceUrl.indexOf('data:') === 0 ? faceUrl : 'data:image/png;base64,' + (faceUrl.indexOf('base64,') >= 0 ? faceUrl.split('base64,')[1] : faceUrl);
                this.scene.textures.addBase64(faceKey, dataUrl);
            } catch (e) { /* ignore */ }
        }
        const contentW = sw - 24;
        const faceSize = Math.min(120, Math.max(72, Math.floor(contentW * 0.38)));
        if (this.scene.textures.exists(faceKey)) {
            const face = this.scene.add.image(left, y, faceKey).setDisplaySize(faceSize, faceSize);
            face.setOrigin(0, 0);
            this.unitContent.add(face);
        }

        const radarAreaW = contentW - faceSize - 8;
        const radarR = Math.min(RADAR_R_MAX, Math.max(RADAR_R_MIN, (radarAreaW / 2) - 12));
        const radarCx = left + faceSize + 4 + radarAreaW / 2;
        const radarCy = y + RADAR_OFFSET_BASE + (radarR > RADAR_OFFSET_RADIUS_THRESHOLD ? (radarR - RADAR_OFFSET_RADIUS_THRESHOLD) * RADAR_OFFSET_RADIUS_FACTOR : 0);
        const params = (typeof LoadoutWeight !== 'undefined' && LoadoutWeight.getRadarDisplayParams)
            ? LoadoutWeight.getRadarDisplayParams(u)
            : (u.params || (u.def && u.def.params) || {});
        const hasLoadDebuff = !!(params._loadDebuff && params._baseSpeed != null);
        const baseParamsForRadar = hasLoadDebuff ? { ...params, speed: params._baseSpeed } : null;
        const paramKeys = window.getParamKeys();
        const paramLabels = (typeof PARAM_LABELS !== 'undefined') ? PARAM_LABELS : paramKeys.map(k => k.slice(0, 3));
        const labelOffset = RADAR_LABEL_OFFSET_BASE + (radarR > RADAR_LABEL_OFFSET_RADIUS_THRESHOLD ? RADAR_LABEL_OFFSET_EXTRA : 0);
        const radarData = (typeof getRadarPoints === 'function') ? getRadarPoints(params, paramKeys, radarR, labelOffset) : null;
        const baseRadarData = (hasLoadDebuff && baseParamsForRadar && typeof getRadarPoints === 'function')
            ? getRadarPoints(baseParamsForRadar, paramKeys, radarR, labelOffset) : null;

        const radarG = this.scene.add.graphics();
        radarG.setPosition(radarCx, radarCy);
        if (radarR >= RADAR_SHOW_GRID_AT) {
            const levels = radarR >= RADAR_SHOW_GRID_DETAIL_AT ? [0.25, 0.5, 0.75] : [0.5];
            levels.forEach(ratio => {
                radarG.lineStyle(1, 0x444444, 0.4);
                radarG.strokeCircle(0, 0, radarR * ratio);
            });
        }
        if (radarR >= RADAR_SHOW_FULL_GRID_AT) {
            for (let v = 2; v <= 10; v += 2) {
                radarG.lineStyle(1, 0x555555, 0.35);
                radarG.strokeCircle(0, 0, radarR * (v / 10));
            }
        }
        if (baseRadarData && baseRadarData.points.length > 0) {
            radarG.beginPath();
            radarG.moveTo(baseRadarData.points[0].x, baseRadarData.points[0].y);
            for (let i = 1; i < baseRadarData.points.length; i++) radarG.lineTo(baseRadarData.points[i].x, baseRadarData.points[i].y);
            radarG.closePath();
            radarG.fillStyle(0x888888, 0.12);
            radarG.fillPath();
            radarG.lineStyle(1, 0x888888, 0.45);
            radarG.strokePath();
        }
        if (radarData && radarData.points.length > 0) {
            radarG.beginPath();
            radarG.moveTo(radarData.points[0].x, radarData.points[0].y);
            for (let i = 1; i < radarData.points.length; i++) radarG.lineTo(radarData.points[i].x, radarData.points[i].y);
            radarG.closePath();
        } else {
            for (let i = 0; i < paramKeys.length; i++) {
                const angle = -Math.PI / 2 + (i / paramKeys.length) * 2 * Math.PI;
                const v = Math.max(0, Math.min(10, params[paramKeys[i]] != null ? params[paramKeys[i]] : 5));
                const r = (v / 10) * radarR;
                const px = Math.cos(angle) * r, py = Math.sin(angle) * r;
                if (i === 0) radarG.beginPath(); else radarG.lineTo(px, py);
                if (i === 0) radarG.moveTo(px, py);
            }
            radarG.closePath();
        }
        radarG.fillStyle(0xddaa44, 0.25);
        radarG.fillPath();
        radarG.lineStyle(2, 0xddaa44, 0.9);
        radarG.strokePath();
        const angles = radarData ? radarData.angles : paramKeys.map((_, i) => -Math.PI / 2 + (i / paramKeys.length) * 2 * Math.PI);
        angles.forEach(angle => {
            radarG.lineStyle(1, 0x666666, 0.5);
            radarG.beginPath();
            radarG.moveTo(0, 0);
            radarG.lineTo(Math.cos(angle) * radarR, Math.sin(angle) * radarR);
            radarG.strokePath();
        });
        radarG.setPosition(0, 0);
        radarG.setDepth(0);
        this.unitContent.add(radarG);
        radarG.setPosition(radarCx, radarCy);
        const labelFontSize = radarR >= RADAR_SHOW_VALUES_AT ? '10px' : '9px';
        if (radarData && radarData.labelPositions.length > 0) {
            radarData.labelPositions.forEach((lp, i) => {
                const labelText = this.scene.add.text(radarCx + lp.x, radarCy + lp.y, paramLabels[i] || '', { fontSize: labelFontSize, color: '#888', fontFamily: 'sans-serif' }).setOrigin(0.5, 0.5);
                this.unitContent.add(labelText);
            });
        } else {
            paramLabels.forEach((lbl, i) => {
                const angle = -Math.PI / 2 + (i / paramKeys.length) * 2 * Math.PI;
                const tx = radarCx + Math.cos(angle) * (radarR + labelOffset);
                const ty = radarCy + Math.sin(angle) * (radarR + labelOffset);
                this.unitContent.add(this.scene.add.text(tx, ty, lbl || '', { fontSize: labelFontSize, color: '#888', fontFamily: 'sans-serif' }).setOrigin(0.5, 0.5));
            });
        }
        if (radarR >= RADAR_SHOW_VALUES_AT && radarData && radarData.points.length > 0) {
            const speedIdx = paramKeys.indexOf('speed');
            radarData.points.forEach((pt, i) => {
                const val = Math.max(0, Math.min(10, params[paramKeys[i]] != null ? params[paramKeys[i]] : 5));
                const isSpdDebuff = hasLoadDebuff && i === speedIdx;
                let label = String(val);
                if (isSpdDebuff && params._baseSpeed != null && params._baseSpeed !== val) {
                    label = `${val}(${params._baseSpeed})`;
                }
                const vx = radarCx + pt.x * RADAR_VALUE_POS_RATIO;
                const vy = radarCy + pt.y * RADAR_VALUE_POS_RATIO;
                const valText = this.scene.add.text(vx, vy, label, {
                    fontSize: radarR >= RADAR_SHOW_FULL_GRID_AT ? '10px' : '9px',
                    color: isSpdDebuff ? '#ff8866' : '#ddaa44',
                    fontFamily: 'sans-serif'
                }).setOrigin(0.5, 0.5);
                this.unitContent.add(valText);
            });
        }
        if (hasLoadDebuff && params._carriedWeightKg != null) {
            const wHint = this.scene.add.text(radarCx, radarCy + radarR + labelOffset + 2,
                `${params._carriedWeightKg}kg`, { fontSize: '9px', color: '#aa7766', fontFamily: 'sans-serif' }).setOrigin(0.5, 0);
            this.unitContent.add(wHint);
        }

        const textLeft = left;
        const headerTop = y + faceSize + 6;
        const radarBottom = radarCy + radarR + labelOffset + RADAR_BOTTOM_MARGIN;
        const nameText = this.scene.add.text(textLeft, headerTop, u.name, { fontSize: '14px', color: '#ffffff', fontFamily: 'sans-serif' });
        this.unitContent.add(nameText);
        const roleText = this.scene.add.text(textLeft, headerTop + 18, (u.def && u.def.role) || '', { fontSize: '11px', color: '#ddaa44', fontFamily: 'monospace' });
        this.unitContent.add(roleText);

        const skills = (u.skills && Array.isArray(u.skills)) ? [...new Set(u.skills)] : [];
        if (skills.length > 0 && typeof SKILLS !== 'undefined') {
            const skillText = this.scene.add.text(textLeft, headerTop + 36, skills.map(sk => SKILLS[sk] ? `${SKILLS[sk].name}: ${SKILLS[sk].desc}` : sk).join('  |  '), { fontSize: '9px', color: TEXT_DIM, fontFamily: 'sans-serif', wordWrap: { width: sw - 24 } });
            this.unitContent.add(skillText);
            y = headerTop + 54;
        } else {
            y = headerTop + 36;
        }
        y += 8;

        const hpLabel = u.wounded ? `HP  ${u.hp}/${u.maxHp}  重傷` : `HP  ${u.hp}/${u.maxHp}`;
        const hpText = this.scene.add.text(textLeft, y, hpLabel, { fontSize: '11px', color: u.wounded ? '#ffdd33' : TEXT_COLOR, fontFamily: 'sans-serif' });
        this.unitContent.add(hpText);
        y += 22;
        // AP は旧ターン制の資源。RTwP では消費も回復もしないので出さない。
        if (window.RtwpBattle && window.RtwpBattle.active) {
            y += 14;
        } else {
            const apText = this.scene.add.text(textLeft, y, `AP  ${u.ap}/${u.maxAp}`, { fontSize: '11px', color: TEXT_COLOR, fontFamily: 'sans-serif' });
            this.unitContent.add(apText);
            y += 36;
        }

        y = this.renderSameHexSquadRow(u, left, y, sw);

        const contentAfterAp = y;
        y = Math.max(contentAfterAp, radarBottom);
        const invLabel = this.scene.add.text(left, y, (u.def && u.def.isTank) ? 'Main armament / Sub armament' : 'LOADOUT', { fontSize: '10px', color: '#666666', fontFamily: 'sans-serif' });
        this.unitContent.add(invLabel);
        y += 20;

        const virtualWpn = window.getCurrentWeapon(u);
        const isMortarActive = virtualWpn && virtualWpn.code === 'm2_mortar';

        // RTwPの正本弾薬。旧ターン制のitem.current表示とは別勘定なので、
        // 発射のたびに減る実弾倉＋予備弾倉を明示する。
        if (u._rtwpAmmo && window.RtwpBattle && window.RtwpBattle.active) {
            this.rtwpAmmoText = this.scene.add.text(left, y, '', {
                fontSize: '10px', color: '#d9bc72', fontFamily: 'monospace'
            });
            this.unitContent.add(this.rtwpAmmoText);
            this.updateLiveStats();
            y += 18;
        }

        this.slots = [];
        for (let i = 0; i < 3; i++) {
            const slot = this.createSlot(u, u.hands[i], 'main', i, left, y, true, isMortarActive);
            this.unitContent.add(slot.container);
            this.slots.push(slot);
            y += slot.height + 6;
        }

        y += 12;
        const bagLabel = this.scene.add.text(left, y, 'BACKPACK', { fontSize: '10px', color: '#666666', fontFamily: 'sans-serif' });
        this.unitContent.add(bagLabel);
        y += 20;

        // 背嚢は2列×4段の8枠。1列4枠では「予備弾倉4本＋手榴弾2＋拳銃＋その予備弾倉」
        // という当たり前の携行すら組めなかった。縦は従来と同じ高さに収まる。
        const bagCols = 2;
        const bagGap = 6;
        const bagW = Math.floor((sw - 36 - bagGap * (bagCols - 1)) / bagCols);
        for (let i = 0; i < BAG_SLOTS; i++) {
            const col = i % bagCols;
            const row = Math.floor(i / bagCols);
            const slot = this.createSlot(u, u.bag[i], 'bag', i,
                left + col * (bagW + bagGap), y + row * (BAG_SLOT_H + 4), false, false, bagW);
            this.unitContent.add(slot.container);
            this.slots.push(slot);
        }
        y += Math.ceil(BAG_SLOTS / bagCols) * (BAG_SLOT_H + 4);

        // RTwP の再装填は sim が自分でやる（RELOADイベントが出る）。旧ターン制の
        // 手動リロードを押せると AP を消費して弾数だけ食い違うので出さない。
        const rtwpActive = !!(window.RtwpBattle && window.RtwpBattle.active);
        if (!rtwpActive && this.canEditLoadout() && virtualWpn && !u.def.isTank && !virtualWpn.partType && virtualWpn.code !== 'm2_mortar' && virtualWpn.current < virtualWpn.cap) {
            y += 10;
            const reloadBtn = this.createButton(left, y, sw - 36, 28, 'RELOAD', () => { if (window.gameLogic) window.gameLogic.reloadWeapon(true); });
            this.unitContent.add(reloadBtn.container);
            y += 38;
        }
    }

    updateLiveStats() {
        // 弾ピップを実弾倉へ追従させる（スロットを組み直さずに色だけ塗り替える）。
        // 減る時だけは1発ずつ落とす — バーストは3発まとめて消費されるが、ゲージが
        // ごそっと飛ぶと発砲の手応えが消える。装填や兵士の切替は即座に合わせる。
        // 選択中の1名しか pips を持たないので、演出はここだけで完結する。
        if (this.ammoPips && this.ammoPips.length && this.ammoPipItem) {
            const loaded = Math.max(0, Number(this.ammoPipItem.current) || 0);
            if (this._ammoPipsShown == null || loaded > this._ammoPipsShown) {
                this._ammoPipsShown = loaded;
            } else if (loaded < this._ammoPipsShown) {
                const now = this.scene.time.now;
                if (now - (this._ammoPipsStepAt || 0) >= AMMO_PIP_STEP_MS) {
                    this._ammoPipsShown--;
                    this._ammoPipsStepAt = now;
                }
            }
            const shown = this._ammoPipsShown;
            if (shown !== this._ammoPipsDrawn) {
                for (let i = 0; i < this.ammoPips.length; i++) {
                    const pip = this.ammoPips[i];
                    const col = pip.index < shown ? ACCENT : 0x333333;
                    pip.tip.setFillStyle(col);
                    pip.body.setFillStyle(col);
                }
                this._ammoPipsDrawn = shown;
            }
        }
        // 予備弾倉は「アイテムが背嚢から消える」ことで減りが見える（RTwP側が
        // 装填のたびに1個ずつ取り除く）。スロット構成が変わるので組み直す。
        if (this.currentUnit && this._bagCount !== bagItemCount(this.currentUnit)) {
            this.updateSidebar(this.currentUnit, window.gameLogic && window.gameLogic.state);
            return;
        }
        if (!this.rtwpAmmoText || !this.currentUnit || !this.currentUnit._rtwpAmmo) return;
        const ammo = this.currentUnit._rtwpAmmo;
        const rounds = Math.max(0, Number(ammo.rounds) || 0);
        const mags = Math.max(0, Number(ammo.magazines) || 0);
        const capacity = Math.max(0, Number(ammo.capacity) || 0);
        const reserve = mags * capacity;
        this.rtwpAmmoText.setText(`RTWP AMMO  ${rounds}/${capacity}  +${reserve} (${mags} mags)`);
        this.rtwpAmmoText.setColor(rounds + reserve > 0 ? '#d9bc72' : '#ff6655');
    }

    renderSameHexSquadRow(u, left, y, sw) {
        const enabled = typeof FEATURE_SAME_HEX_TRANSFER !== 'undefined' && FEATURE_SAME_HEX_TRANSFER;
        const gl = window.gameLogic;
        if (!enabled || !gl || !gl.getSameHexSquadMembers || u.team !== 'player' || (u.def && u.def.isTank)) {
            return y;
        }
        const members = gl.getSameHexSquadMembers(u);
        if (members.length <= 1) return y;

        const squadLabel = this.scene.add.text(left, y, 'SQUAD (同ヘックス)', {
            fontSize: '10px', color: '#668866', fontFamily: 'sans-serif',
        });
        this.unitContent.add(squadLabel);
        y += 16;

        const gap = 4;
        const chipW = Math.max(48, Math.min(80, Math.floor((sw - 24 - (members.length - 1) * gap) / members.length)));
        const chipH = 26;
        let cx = left;
        const self = this;
        members.forEach(function (m) {
            const isActive = m.id === u.id;
            const shortName = (m.name || 'Unit').split(/\s+/)[0];
            const label = shortName.length > 8 ? shortName.substring(0, 7) + '…' : shortName;
            const container = self.scene.add.container(cx, y);
            const bg = self.scene.add.rectangle(chipW / 2, chipH / 2, chipW, chipH, isActive ? 0x2a3020 : 0x151515);
            bg.setStrokeStyle(isActive ? 2 : 1, isActive ? ACCENT : 0x446644, 1);
            bg.setInteractive({ useHandCursor: true });
            const text = self.scene.add.text(chipW / 2, chipH / 2, label, {
                fontSize: '10px', color: isActive ? '#ddcc88' : '#889988', fontFamily: 'sans-serif',
            });
            text.setOrigin(0.5, 0.5);
            container.add(bg);
            container.add(text);
            bg.on('pointerup', function () {
                if (self.dragSrc || self.dragGhost) return;
                if (window.gameLogic && window.gameLogic.selectSquadMember) {
                    window.gameLogic.selectSquadMember(m);
                }
            });
            self.unitContent.add(container);
            self.squadChips.push({ unit: m, container: container, bg: bg, isActive: isActive });
            cx += chipW + gap;
        });
        return y + chipH + 10;
    }

    hitTestSquadChip(px, py) {
        if (!this.squadChips || !this.squadChips.length || !this.currentUnit) return null;
        for (let i = 0; i < this.squadChips.length; i++) {
            const chip = this.squadChips[i];
            if (!chip.container || !chip.unit || chip.unit.id === this.currentUnit.id) continue;
            const bounds = chip.container.getBounds();
            if (bounds.contains(px, py)) return chip.unit;
        }
        return null;
    }

    updateSquadChipHighlight(px, py) {
        if (!this.squadChips) return;
        for (let i = 0; i < this.squadChips.length; i++) {
            const chip = this.squadChips[i];
            if (!chip.bg) continue;
            const isDrop = this.dragSrc && chip.unit && this.currentUnit
                && chip.unit.id !== this.currentUnit.id
                && chip.container.getBounds().contains(px, py);
            const isActive = chip.isActive;
            chip.bg.setStrokeStyle(isDrop ? 3 : (isActive ? 2 : 1), isDrop ? ACCENT : (isActive ? ACCENT : 0x446644), 1);
        }
    }

    createSlot(u, item, type, index, x, y, isMain, isMortarActive, slotWOverride) {
        // 背嚢は2列に割るので幅を外から渡せる。既定は従来どおりの全幅。
        const slotW = slotWOverride || (window.getSidebarWidth() - 36);
        const needsBeltGauge = item && isMain && item.reserve !== undefined
            && typeof PlMgTripod !== 'undefined' && PlMgTripod.usesBeltReserve(item.code);
        const needsM8Gauge = item && item.code === 'm8_rocket' && isMain;
        const slotH = (isMain && needsBeltGauge) ? 130 : (isMain && needsM8Gauge) ? 100 : (isMain ? 90 : BAG_SLOT_H);
        const mainGaugeTop = (contentH) => slotH - contentH - GAUGE_BOTTOM_PAD;
        const borderColor = isMain ? ACCENT : SLOT_BORDER;
        const bgColor = isMain ? 0x2a201a : SLOT_BG;

        const container = this.scene.add.container(x, y);
        const bg = this.scene.add.rectangle(slotW / 2, slotH / 2, slotW, slotH, item ? bgColor : 0x0a0a0a);
        bg.setStrokeStyle(1, borderColor, item ? 1 : 0.3);
        bg.setInteractive({ useHandCursor: this.canEditLoadout() && !!item });
        container.add(bg);

        if (isMain && isMortarActive && item && item.type === 'part') {
            bg.setStrokeStyle(2, 0x44ff44, 0.8);
        }
        if (item && item.isRainbow) {
            const rainbowSlot = this.scene.add.graphics();
            const rw = slotW + 4, rh = slotH + 4, ox = slotW / 2, oy = slotH / 2;
            [0xff0000, 0xff8800, 0xffff00, 0x00ff88, 0x0088ff, 0x8800ff].forEach((col, i) => {
                rainbowSlot.lineStyle(2, col, 0.9);
                rainbowSlot.strokeRect(-ox - 2 + i * 0.3, -oy - 2 + i * 0.3, rw - i * 0.6, rh - i * 0.6);
            });
            rainbowSlot.setPosition(ox, oy);
            container.add(rainbowSlot);
        }

        const mortarIconKey = item && window.M2Mortar
            ? ((isMain && isMortarActive) ? M2Mortar.ASSEMBLED_SLICE_KEYS[index] : M2Mortar.textureKeyForItem(item.code))
            : null;
        if (item && mortarIconKey && this.scene.textures.exists(mortarIconKey)) {
            const icon = this.scene.add.image(slotW / 2, slotH / 2, mortarIconKey);
            const fitScale = Math.min((slotW - 8) / icon.width, (slotH - 8) / icon.height);
            icon.setScale(fitScale).setAlpha(isMortarActive && isMain ? 0.9 : 0.78);
            container.addAt(icon, 1);
        } else if (item && typeof window.plItemHasWeaponIcon === 'function' && window.plItemHasWeaponIcon(item)
            && typeof window.plCbeWeaponIconPath === 'function') {
            const iconKey = window.plCbeWeaponIconKey(item.cbeNameIndex);
            const iconPath = window.plCbeWeaponIconPath(item.cbeNameIndex);
            if (!this.scene.textures.exists(iconKey)) {
                const img = new Image();
                img.onerror = () => { /* スプライト未配置 — 404 ログ抑制 */ };
                img.onload = () => {
                    if (!this.scene || !this.scene.textures) return;
                    if (!this.scene.textures.exists(iconKey)) {
                        this.scene.textures.addImage(iconKey, img);
                    }
                    const icon = this.scene.add.image(slotW / 2, isMain ? slotH * 0.44 : slotH / 2, iconKey);
                    const fitScale = Math.min((slotW - 8) / icon.width, (slotH - 8) / icon.height);
                    icon.setScale(fitScale).setAlpha(0.7);
                    container.addAt(icon, 1);
                };
                img.src = iconPath;
            } else {
                const icon = this.scene.add.image(slotW / 2, isMain ? slotH * 0.44 : slotH / 2, iconKey);
                const fitScale = Math.min((slotW - 8) / icon.width, (slotH - 8) / icon.height);
                icon.setScale(fitScale).setAlpha(0.7);
                container.addAt(icon, 1);
            }
        }

        let label = '[EMPTY]';
        if (item) {
            label = (isMain ? '' : '') + (item.name || '');
            if (u.team === 'enemy') {
                // 敵ユニットは弾丸ゲージ表示なし（はみ出し防止・弾切れは行動で表現）
            } else if (needsBeltGauge) {
                const maxRounds = (typeof PlMgTripod !== 'undefined')
                    ? PlMgTripod.getDefaultBeltReserve(item.code) : 300;
                const reserve = Math.min(maxRounds, item.reserve || 0);
                const cols = 30, rows = 10, gap = 1;
                const availW = slotW - 16;
                const cellW = Math.floor((availW - (cols - 1) * gap) / cols);
                const cellH = 2;
                const gridH = rows * (cellH + gap) - gap;
                const gridTop = isMain ? mainGaugeTop(gridH + 8) + 8 : GAUGE_TOP;
                const countText = this.scene.add.text(8, gridTop - 8, `${reserve}/${maxRounds}`, { fontSize: '8px', color: TEXT_DIM, fontFamily: 'monospace' });
                countText.setOrigin(0, 0);
                container.add(countText);
                for (let r = 0; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                        const idx = r * cols + c;
                        const dot = this.scene.add.rectangle(8 + c * (cellW + gap), gridTop + r * (cellH + gap), cellW, cellH, idx < reserve ? 0xddaa44 : 0x333333);
                        dot.setOrigin(0, 0);
                        container.add(dot);
                    }
                }
            } else if (u.def.isTank && isMain && item.reserve !== undefined) {
                const shellCount = Math.min(20, item.reserve || 0);
                const shellY = isMain ? mainGaugeTop(8) : GAUGE_TOP;
                for (let i = 0; i < shellCount; i++) {
                    const dot = this.scene.add.rectangle(10 + i * 6, shellY, 4, 8, 0xdaa444);
                    dot.setOrigin(0, 0);
                    container.add(dot);
                }
            } else if (item && item.code === 'm8_rocket' && isMain) {
                const cap = 60;
                const current = Math.min(cap, item.current ?? item.cap ?? 0);
                const cols = 12;
                const rows = 5;
                const gap = 1;
                const availW = slotW - 20;
                const cellW = Math.min(4, Math.floor((availW - (cols - 1) * gap) / cols));
                const cellH = 3;
                const gridH = rows * (cellH + gap) - gap;
                const gridTop = isMain ? mainGaugeTop(gridH + 8) + 8 : GAUGE_TOP;
                const countText = this.scene.add.text(8, gridTop - 8, `${current}/${cap}`, { fontSize: '8px', color: TEXT_DIM, fontFamily: 'monospace' });
                countText.setOrigin(0, 0);
                container.add(countText);
                for (let r = 0; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                        const idx = r * cols + c;
                        if (idx >= cap) break;
                        const filled = idx < current;
                        const dot = this.scene.add.rectangle(8 + c * (cellW + gap), gridTop + r * (cellH + gap), cellW, cellH, filled ? 0xddaa44 : 0x333333);
                        dot.setOrigin(0, 0);
                        container.add(dot);
                    }
                }
            } else if (item.cap > 0 && item.code !== 'm8_rocket' && !item.partType && item.type !== 'ammo') {
                const bulletW = 4;
                const bulletH = 10;
                const bulletTipH = 3;
                const bulletGap = 2;
                const step = bulletW + bulletGap;
                const bulletBlockH = bulletTipH + bulletH;
                const baseY = isMain ? mainGaugeTop(bulletBlockH) : GAUGE_TOP;
                for (let i = 0; i < item.cap; i++) {
                    const filled = i < (item.current || 0);
                    const col = filled ? ACCENT : 0x333333;
                    const x = 10 + i * step;
                    const tipY = baseY + bulletTipH / 2;
                    const bodyY = baseY + bulletTipH;
                    const tip = this.scene.add.ellipse(x + bulletW / 2, tipY, bulletW, bulletTipH, col);
                    tip.setOrigin(0.5, 0.5);
                    container.add(tip);
                    const body = this.scene.add.rectangle(x, bodyY, bulletW, bulletH, col);
                    body.setOrigin(0, 0);
                    container.add(body);
                    // RTwPは実時間で撃つので、スロットを組み直さずに毎フレーム塗り替える。
                    if (isMain) this.ammoPips.push({ tip: tip, body: body, index: i });
                }
                if (isMain) this.ammoPipItem = item;
            } else if (item.code === 'mortar_shell_box') {
                const boxY = isMain ? slotH - 12 : GAUGE_TOP;
                for (let i = 0; i < (item.current || 0); i++) {
                    const dot = this.scene.add.rectangle(10 + i * 5, boxY, 3, 6, 0xffaa00);
                    dot.setOrigin(0, 0);
                    container.add(dot);
                }
            }
        }

        const nameLabel = this.scene.add.text(8, 8, label, { fontSize: isMain ? '12px' : '10px', color: item ? '#dddddd' : '#555555', fontFamily: 'sans-serif' });
        nameLabel.setOrigin(0, 0);
        if (label.length > 18) nameLabel.setText(label.substring(0, 17) + '..');
        container.add(nameLabel);

        if (item && (!item.type || item.type !== 'ammo') && !item.partType && (item.rng != null || item.dmg != null)) {
            const baseDmgStr = item.dmg != null ? String(item.dmg) : '-';
            const hasBonus = item.isRainbow && item.rainbowDmgBonus;
            const metaStyle = { fontSize: '9px', fontFamily: 'sans-serif' };
            const rngDmgY = 24;
            const metaLeft = this.scene.add.text(8, rngDmgY, `RNG:${item.rng != null ? item.rng : '-'} DMG:${baseDmgStr}`, Object.assign({}, metaStyle, { color: TEXT_DIM }));
            metaLeft.setOrigin(0, 0);
            if (metaLeft.setResolution) metaLeft.setResolution(2);
            container.add(metaLeft);
            if (hasBonus) {
                const bonusText = this.scene.add.text(8 + metaLeft.width, rngDmgY, `+${item.rainbowDmgBonus}`, Object.assign({}, metaStyle, { color: '#eecc00' }));
                bonusText.setOrigin(0, 0);
                if (bonusText.setResolution) bonusText.setResolution(2);
                container.add(bonusText);
            }
            const malfRate = item.effectiveMalfRate != null
                ? Number(item.effectiveMalfRate)
                : Number(item.malfRate != null ? item.malfRate : item.jam);
            if (Number.isFinite(malfRate)) {
                const malfMod = Number(item.loadedMalfMod) || 0;
                const malfLabel = `故障:${malfRate}%` + (malfMod ? ` (+${malfMod})` : '');
                const malfText = this.scene.add.text(8, rngDmgY + 12, malfLabel,
                    Object.assign({}, metaStyle, { color: malfMod ? '#ffd45d' : TEXT_DIM }));
                malfText.setOrigin(0, 0);
                if (malfText.setResolution) malfText.setResolution(2);
                container.add(malfText);
            }
        }

        if (isMain && u.def && u.def.isTank) {
            const slotLabel = (index === 0 ? 'Main' : 'Sub' + index);
            const tankLabel = this.scene.add.text(slotW - 12, 4, slotLabel, { fontSize: '9px', color: '#ddaa44', fontFamily: 'sans-serif' });
            tankLabel.setOrigin(1, 0);
            container.add(tankLabel);
        }

        const self = this;
        const compatTip = (item && typeof getLoadoutCompatTooltipText === 'function')
            ? getLoadoutCompatTooltipText(item) : null;
        bg.on('pointerdown', (ptr) => {
            if (typeof hideLoadoutCompatTooltip === 'function') hideLoadoutCompatTooltip();
            if (label === '[EMPTY]') return;
            self.onSlotPointerDown(ptr, type, index, slotW, slotH, label, container);
        });
        bg.on('pointerover', (ptr) => {
            if (self.dragSrc) bg.setStrokeStyle(3, ACCENT, 1);
            if (compatTip && typeof showLoadoutCompatTooltip === 'function') {
                showLoadoutCompatTooltip(ptr, compatTip);
            }
        });
        bg.on('pointerout', () => {
            bg.setStrokeStyle(1, borderColor, item ? 1 : 0.3);
            if (typeof hideLoadoutCompatTooltip === 'function') hideLoadoutCompatTooltip();
        });
        bg.on('pointermove', (ptr) => {
            if (compatTip && typeof moveLoadoutCompatTooltip === 'function') {
                moveLoadoutCompatTooltip(ptr);
            }
        });
        bg.on('pointerup', (ptr) => { self.onSlotPointerUp(ptr, type, index); });

        container.slotData = { type, index, u, borderColor, hasItem: !!item };
        return { container, height: slotH };
    }

    updateDropHighlight(px, py) {
        if (!this.canEditLoadout()) {
            this._snapTarget = null;
            return;
        }
        const dragCard = typeof Renderer !== 'undefined' ? Renderer.draggedCard : null;
        const dragSrc = dragCard ? (dragCard.weaponData || dragCard.cardType) : null;
        const isEquipCardDrag = typeof Renderer !== 'undefined' && Renderer.isCardDragging && dragSrc
            && window.gameLogic && window.gameLogic.canEquipItemFromDeck
            && window.gameLogic.canEquipItemFromDeck(dragSrc);
        const showHighlight = this.dragSrc || isEquipCardDrag;
        this._snapTarget = null;
        const over = this.slots.length ? this.hitTestSlots(px, py) : null;
        if (over) {
            for (const s of this.slots) {
                const d = s.container.slotData;
                if (d && d.type === over.type && d.index === over.index) {
                    const b = s.container.getBounds();
                    this._snapTarget = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
                    break;
                }
            }
        }
        for (const s of this.slots) {
            const bg = s.container.list[0];
            if (!bg || typeof bg.setStrokeStyle !== 'function') continue;
            const data = s.container.slotData || {};
            const isTarget = showHighlight && over && data.type === over.type && data.index === over.index;
            bg.setStrokeStyle(isTarget ? 3 : 1, isTarget ? ACCENT : (data.borderColor || SLOT_BORDER), data.hasItem ? 1 : 0.3);
        }
    }

    createButton(x, y, w, h, label, cb, bgColor = 0x442222, borderColor = 0x886644) {
        const container = this.scene.add.container(x, y);
        const bg = this.scene.add.rectangle(w / 2, h / 2, w, h, bgColor);
        bg.setStrokeStyle(1, borderColor);
        bg.setInteractive({ useHandCursor: true });
        const text = this.scene.add.text(w / 2, h / 2, label, { fontSize: '12px', color: '#ffcccc', fontFamily: 'sans-serif' });
        text.setOrigin(0.5, 0.5);
        container.add(bg);
        container.add(text);
        bg.on('pointerdown', () => { if (cb) cb(); });
        return { container };
    }

    // The frozen battle-review façade deliberately keeps the same sidebar so
    // units can be inspected. Equipment, however, must never look draggable
    // there (nor on a WIN/LOSS result screen).
    canEditLoadout() {
        const game = window.gameLogic;
        return !!game && game.state === 'PLAY' && !game._battleReviewReadOnly;
    }

    onSlotPointerDown(pointer, type, index, slotW, slotH, label, slotContainer) {
        if (this.dragSrc || !this.canEditLoadout()) return;
        const isMain = type === 'main';
        const borderColor = isMain ? ACCENT : SLOT_BORDER;
        const bgColor = isMain ? 0x2a201a : SLOT_BG;
        this.dragSrc = { type, index, unitId: this.currentUnit ? this.currentUnit.id : null };
        this.dragLiftedSlot = slotContainer;
        slotContainer.setAlpha(0.2);
        this.dragGhost = this.scene.add.container(pointer.x, pointer.y);
        const liftedBg = this.scene.add.rectangle(0, 0, slotW, slotH, bgColor, 1);
        liftedBg.setStrokeStyle(2, borderColor, 1);
        const liftedText = this.scene.add.text(0, 0, label.length > 18 ? label.substring(0, 17) + '..' : label, { fontSize: isMain ? '12px' : '10px', color: '#dddddd', fontFamily: 'sans-serif' });
        liftedText.setOrigin(0.5, 0.5);
        this.dragGhost.add(liftedBg); this.dragGhost.add(liftedText);
        this.dragGhost.setDepth(10001);
        this.dragGhost.setScale(1.02);
        this.dragGhost.physX = pointer.x; this.dragGhost.physY = pointer.y;
        this.dragGhost.velocityX = 0; this.dragGhost.velocityY = 0;
        this.dragGhost.targetX = pointer.x; this.dragGhost.targetY = pointer.y;
        this.dragGhost.angle = 0; this.dragGhost.velocityAngle = 0;
        this._pointerX = pointer.x; this._pointerY = pointer.y;
        this.container.add(this.dragGhost);
        const onMove = (p) => {
            this.dragGhost.targetX = p.x; this.dragGhost.targetY = p.y;
            this._pointerX = p.x; this._pointerY = p.y;
            this.updateDropHighlight(p.x, p.y);
            this.updateSquadChipHighlight(p.x, p.y);
        };
        const onUp = (p) => {
            this.scene.input.off('pointermove', onMove); this.scene.input.off('pointerup', onUp);
            if (!this.dragSrc || !this.dragGhost) {
                if (this.dragGhost) this.dragGhost.destroy();
                this.dragGhost = null; this.dragSrc = null;
                if (this.dragLiftedSlot) { this.dragLiftedSlot.setAlpha(1); this.dragLiftedSlot = null; }
                return;
            }
            if (!this.canEditLoadout()) {
                if (this.dragLiftedSlot) this.dragLiftedSlot.setAlpha(1);
                this.dragLiftedSlot = null;
                this.dragGhost.destroy(); this.dragGhost = null; this.dragSrc = null;
                this._snapTarget = null;
                this.updateSquadChipHighlight(-1, -1);
                return;
            }
            const dropTarget = this.hitTestSlots(p.x, p.y);
            const squadTarget = this.hitTestSquadChip(p.x, p.y);
            const w = this.scene.scale.width;
            const h = this.scene.scale.height;
            const dropZoneY = h * 0.88;
            const overDeck = p.x < w - window.getSidebarWidth() && p.y >= dropZoneY;
            const sameSlot = dropTarget && this.dragSrc.type === dropTarget.type && this.dragSrc.index === dropTarget.index;
            let didTransfer = false;
            if (squadTarget && window.gameLogic && window.gameLogic.transferEquipment && this.currentUnit) {
                didTransfer = window.gameLogic.transferEquipment(
                    this.currentUnit, squadTarget, this.dragSrc,
                    { type: this.dragSrc.type, index: this.dragSrc.index }
                );
            }
            const didSwap = !didTransfer && dropTarget && window.gameLogic && window.gameLogic.swapEquipment && !sameSlot;
            const didMoveToDeck = !didTransfer && overDeck && window.gameLogic && window.gameLogic.moveWeaponToDeck;
            if (didSwap) {
                window.gameLogic.swapEquipment(this.dragSrc, dropTarget);
            } else if (didMoveToDeck) {
                window.gameLogic.moveWeaponToDeck(this.dragSrc);
            }
            if (this.dragLiftedSlot && !didSwap && !didMoveToDeck && !didTransfer) this.dragLiftedSlot.setAlpha(1);
            this.dragLiftedSlot = null;
            this.dragGhost.destroy(); this.dragGhost = null; this.dragSrc = null;
            this._snapTarget = null;
            this.updateSquadChipHighlight(-1, -1);
        };
        this.scene.input.on('pointermove', onMove);
        this.scene.input.once('pointerup', onUp);
    }

    hitTestSlots(px, py) {
        const w = this.scene.scale.width;
        if (px < w - window.getSidebarWidth()) return null;
        for (const s of this.slots) {
            const bounds = s.container.getBounds();
            if (bounds.contains(px, py)) {
                return s.container.slotData ? { type: s.container.slotData.type, index: s.container.slotData.index } : null;
            }
        }
        return null;
    }

    onSlotPointerUp(pointer, type, index) {
        if (!this.dragSrc || this.dragGhost || !this.canEditLoadout()) return;
        const sameSlot = this.dragSrc.type === type && this.dragSrc.index === index;
        if (!sameSlot && window.gameLogic && window.gameLogic.swapEquipment) {
            window.gameLogic.swapEquipment(this.dragSrc, { type, index });
        }
        this.dragSrc = null;
    }

    updateDragGhost(time, delta) {
        if (!this.dragGhost || !this.dragGhost.scene) return;
        const dt = Math.min(delta / 16, 2);
        const px = this._pointerX !== undefined ? this._pointerX : this.dragGhost.physX;
        const py = this._pointerY !== undefined ? this._pointerY : this.dragGhost.physY;
        if (this._snapTarget) {
            const snapStr = 0.22;
            this.dragGhost.targetX = this.dragGhost.targetX + (this._snapTarget.x - this.dragGhost.targetX) * snapStr;
            this.dragGhost.targetY = this.dragGhost.targetY + (this._snapTarget.y - this.dragGhost.targetY) * snapStr;
        } else {
            this.dragGhost.targetX = px;
            this.dragGhost.targetY = py;
        }
        const stiffness = 0.08;
        const damping = 0.65;
        const ax = (this.dragGhost.targetX - this.dragGhost.physX) * stiffness;
        const ay = (this.dragGhost.targetY - this.dragGhost.physY) * stiffness;
        this.dragGhost.velocityX += ax; this.dragGhost.velocityY += ay;
        this.dragGhost.velocityX *= damping; this.dragGhost.velocityY *= damping;
        this.dragGhost.physX += this.dragGhost.velocityX; this.dragGhost.physY += this.dragGhost.velocityY;
        this.dragGhost.setPosition(this.dragGhost.physX, this.dragGhost.physY);
        const staticAngle = -(this.dragGhost.physX - px) * 0.4;
        const targetAngle = staticAngle - this.dragGhost.velocityX * 1.5;
        const angleForce = (targetAngle - this.dragGhost.angle) * 0.12;
        this.dragGhost.velocityAngle = (this.dragGhost.velocityAngle || 0) + angleForce;
        this.dragGhost.velocityAngle *= 0.85;
        this.dragGhost.angle += this.dragGhost.velocityAngle;
        this.dragGhost.angle = Phaser.Math.Clamp(this.dragGhost.angle, -35, 35);
    }

    onResize(w, h) {
        const sw = window.getSidebarWidth();
        if (this.panelBg) {
            this.panelBg.setPosition(w - sw / 2, h / 2);
            this.panelBg.setSize(sw, h);
        }
        if (this.noSignalText) {
            this.noSignalText.setPosition(w - sw / 2, h / 2 - 80);
        }
    }
};

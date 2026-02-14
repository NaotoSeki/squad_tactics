/** PHASER SIDEBAR: Right panel rendered in Phaser (unit info, loadout, log) */
const SIDEBAR_WIDTH = 340;
const PANEL_BG = 0x1a1a1a;
const HEADER_BG = 0x111111;
const SLOT_BG = 0x111111;
const SLOT_BORDER = 0x444444;
const ACCENT = 0xddaa44;
const TEXT_COLOR = '#bbbbbb';
const TEXT_DIM = '#888888';

window.PhaserSidebar = class PhaserSidebar {
    constructor(scene) {
        this.scene = scene;
        this.container = scene.add.container(0, 0).setDepth(5000).setScrollFactor(0);
        this.panelBg = null;
        this.unitContent = null;
        this.logContent = null;
        this.slots = [];
        this.logEntries = [];
        this.logScrollY = 0;
        this.maxLogEntries = 50;
        this.dragSrc = null;
        this.currentUnit = null;
    }

    init() {
        const w = this.scene.scale.width;
        const h = this.scene.scale.height;
        const panelX = w - SIDEBAR_WIDTH / 2;

        this.panelBg = this.scene.add.rectangle(panelX, h / 2, SIDEBAR_WIDTH, h, PANEL_BG);
        this.panelBg.setStrokeStyle(1, SLOT_BORDER);
        this.container.add(this.panelBg);

        const headerH = 28;
        const header = this.scene.add.rectangle(panelX, headerH / 2, SIDEBAR_WIDTH - 2, headerH, HEADER_BG);
        header.setStrokeStyle(1, SLOT_BORDER, 0.5);
        this.container.add(header);

        const headerText = this.scene.add.text(panelX - SIDEBAR_WIDTH / 2 + 12, 8, 'SOLDIER DOSSIER', { fontSize: '11px', color: '#ddaa44', fontFamily: 'sans-serif' });
        headerText.setOrigin(0, 0);
        this.container.add(headerText);

        this.unitContent = this.scene.add.container(0, 0);
        this.container.add(this.unitContent);

        const logHeaderY = h - 180;
        const logHeader = this.scene.add.rectangle(panelX, logHeaderY - 12, SIDEBAR_WIDTH - 2, 24, HEADER_BG);
        logHeader.setStrokeStyle(1, SLOT_BORDER, 0.5);
        this.container.add(logHeader);

        const logHeaderText = this.scene.add.text(panelX - SIDEBAR_WIDTH / 2 + 12, logHeaderY - 20, 'BATTLE LOG', { fontSize: '11px', color: '#ddaa44', fontFamily: 'sans-serif' });
        logHeaderText.setOrigin(0, 0);
        this.container.add(logHeaderText);

        this.logContent = this.scene.add.container(0, 0);
        this.container.add(this.logContent);

        this.noSignalText = this.scene.add.text(panelX, h / 2 - 80, '// NO SIGNAL //', { fontSize: '14px', color: '#555555', fontFamily: 'sans-serif' });
        this.noSignalText.setOrigin(0.5, 0.5);
        this.noSignalText.setVisible(false);
        this.container.add(this.noSignalText);
    }

    updateSidebar(u, state, tankAutoReload) {
        this.unitContent.removeAll(true);
        this.currentUnit = u;

        if (!u || u.hp <= 0) {
            this.noSignalText.setVisible(true);
            return;
        }
        this.noSignalText.setVisible(false);

        const w = this.scene.scale.width;
        const h = this.scene.scale.height;
        const left = w - SIDEBAR_WIDTH + 12;
        let y = 36;

        const faceKey = 'face_' + (u.faceSeed || u.id || 0);
        const faceUrl = (typeof Renderer !== 'undefined' && Renderer && Renderer.generateFaceIcon) ? Renderer.generateFaceIcon(u.faceSeed || 0) : '';
        if (faceUrl && !this.scene.textures.exists(faceKey)) {
            try {
                const base64 = faceUrl.indexOf('base64,') >= 0 ? faceUrl.split('base64,')[1] : faceUrl;
                this.scene.textures.addBase64(faceKey, base64);
            } catch (e) { /* ignore */ }
        }
        if (faceUrl && this.scene.textures.exists(faceKey)) {
            const face = this.scene.add.image(left + 32, y + 32, faceKey).setDisplaySize(64, 64);
            face.setOrigin(0, 0);
            this.unitContent.add(face);
        }

        const nameText = this.scene.add.text(left + 74, y + 8, u.name, { fontSize: '14px', color: '#ffffff', fontFamily: 'sans-serif' });
        this.unitContent.add(nameText);
        const roleText = this.scene.add.text(left + 74, y + 28, (u.def && u.def.role) || '', { fontSize: '11px', color: '#ddaa44', fontFamily: 'monospace' });
        this.unitContent.add(roleText);
        y += 88;

        const hpText = this.scene.add.text(left, y, `HP  ${u.hp}/${u.maxHp}`, { fontSize: '11px', color: TEXT_COLOR, fontFamily: 'sans-serif' });
        this.unitContent.add(hpText);
        y += 22;
        const apText = this.scene.add.text(left, y, `AP  ${u.ap}/${u.maxAp}`, { fontSize: '11px', color: TEXT_COLOR, fontFamily: 'sans-serif' });
        this.unitContent.add(apText);
        y += 36;

        const invLabel = this.scene.add.text(left, y, 'IN HANDS (3 Slots)', { fontSize: '10px', color: '#666666', fontFamily: 'sans-serif' });
        this.unitContent.add(invLabel);
        y += 20;

        const virtualWpn = (window.gameLogic && window.gameLogic.getVirtualWeapon) ? window.gameLogic.getVirtualWeapon(u) : null;
        const isMortarActive = virtualWpn && virtualWpn.code === 'm2_mortar';

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

        for (let i = 0; i < 4; i++) {
            const slot = this.createSlot(u, u.bag[i], 'bag', i, left, y, false, false);
            this.unitContent.add(slot.container);
            this.slots.push(slot);
            y += slot.height + 4;
        }

        if (virtualWpn && !u.def.isTank && !virtualWpn.partType && virtualWpn.code !== 'm2_mortar' && virtualWpn.current < virtualWpn.cap) {
            y += 10;
            const reloadBtn = this.createButton(left, y, SIDEBAR_WIDTH - 36, 28, 'RELOAD', () => { if (window.gameLogic) window.gameLogic.reloadWeapon(); });
            this.unitContent.add(reloadBtn.container);
            y += 38;
        }

        y += 12;
        const endTurnBtn = this.createButton(left, y, SIDEBAR_WIDTH - 36, 32, 'End Turn', () => { if (window.gameLogic) window.gameLogic.endTurn(); }, 0x552222, 0xdd4444);
        this.unitContent.add(endTurnBtn.container);
    }

    createSlot(u, item, type, index, x, y, isMain, isMortarActive) {
        const slotW = SIDEBAR_WIDTH - 36;
        const slotH = isMain ? 90 : 36;
        const borderColor = isMain ? ACCENT : SLOT_BORDER;
        const bgColor = isMain ? 0x2a201a : SLOT_BG;

        const container = this.scene.add.container(x, y);
        const bg = this.scene.add.rectangle(slotW / 2, slotH / 2, slotW, slotH, item ? bgColor : 0x0a0a0a);
        bg.setStrokeStyle(1, borderColor, item ? 1 : 0.3);
        bg.setInteractive({ useHandCursor: true });
        container.add(bg);

        if (isMain && isMortarActive && item && item.type === 'part') {
            bg.setStrokeStyle(2, 0x44ff44, 0.8);
        }

        let label = '[EMPTY]';
        if (item) {
            label = (isMain ? '' : '') + (item.name || '');
            if (!item.type || item.type !== 'ammo') {
                const meta = this.scene.add.text(8, slotH - 18, `RNG:${item.rng || '-'} DMG:${item.dmg || '-'}`, { fontSize: '9px', color: TEXT_DIM, fontFamily: 'sans-serif' });
                meta.setOrigin(0, 0);
                container.add(meta);
            }
            if (u.def.isTank && isMain && item.reserve !== undefined) {
                const shellCount = Math.min(20, item.reserve || 0);
                for (let i = 0; i < shellCount; i++) {
                    const dot = this.scene.add.rectangle(10 + i * 6, slotH - 10, 4, 8, 0xdaa444);
                    dot.setOrigin(0, 0);
                    container.add(dot);
                }
            } else if (item.cap > 0 && !item.partType && item.type !== 'ammo') {
                for (let i = 0; i < (item.current || 0); i++) {
                    const dot = this.scene.add.rectangle(10 + i * 5, slotH - 12, 2, 6, ACCENT);
                    dot.setOrigin(0, 0);
                    container.add(dot);
                }
                for (let i = (item.current || 0); i < item.cap; i++) {
                    const dot = this.scene.add.rectangle(10 + i * 5, slotH - 12, 2, 6, 0x333333);
                    dot.setOrigin(0, 0);
                    container.add(dot);
                }
            } else if (item.code === 'mortar_shell_box') {
                for (let i = 0; i < (item.current || 0); i++) {
                    const dot = this.scene.add.rectangle(10 + i * 5, slotH - 12, 3, 6, 0xffaa00);
                    dot.setOrigin(0, 0);
                    container.add(dot);
                }
            }
        }

        const nameLabel = this.scene.add.text(8, 8, label, { fontSize: isMain ? '12px' : '10px', color: item ? '#dddddd' : '#555555', fontFamily: 'sans-serif' });
        nameLabel.setOrigin(0, 0);
        if (label.length > 18) nameLabel.setText(label.substring(0, 17) + '..');
        container.add(nameLabel);

        if (isMain) {
            const inHands = this.scene.add.text(slotW - 12, 4, 'IN HANDS', { fontSize: '9px', color: '#ddaa44', fontFamily: 'sans-serif' });
            inHands.setOrigin(1, 0);
            container.add(inHands);
        }

        const self = this;
        bg.on('pointerdown', () => { self.onSlotPointerDown(type, index); });
        bg.on('pointerover', () => { if (self.dragSrc) bg.setStrokeStyle(2, 0xffffff); });
        bg.on('pointerout', () => { bg.setStrokeStyle(1, borderColor, item ? 1 : 0.3); });
        bg.on('pointerup', () => { self.onSlotPointerUp(type, index); });

        container.slotData = { type, index, u };
        return { container, height: slotH };
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

    onSlotPointerDown(type, index) {
        this.dragSrc = { type, index };
    }

    onSlotPointerUp(type, index) {
        if (this.dragSrc && window.gameLogic && window.gameLogic.swapEquipment) {
            window.gameLogic.swapEquipment(this.dragSrc, { type, index });
        }
        this.dragSrc = null;
    }

    log(msg) {
        const h = this.scene.scale.height;
        const left = this.scene.scale.width - SIDEBAR_WIDTH + 14;
        const logBaseY = h - 168;
        const lineH = 16;

        const entry = this.scene.add.text(left, logBaseY + this.logEntries.length * lineH, '> ' + msg, { fontSize: '10px', color: '#66cc66', fontFamily: 'Lucida Console, monospace' });
        entry.setOrigin(0, 0);
        this.logContent.add(entry);
        this.logEntries.push(entry);

        if (this.logEntries.length > this.maxLogEntries) {
            const old = this.logEntries.shift();
            old.destroy();
            this.logEntries.forEach((e, i) => e.setY(logBaseY + i * lineH));
        }
    }

    onResize(w, h) {
        if (this.panelBg) {
            this.panelBg.setPosition(w - SIDEBAR_WIDTH / 2, h / 2);
            this.panelBg.setSize(SIDEBAR_WIDTH, h);
        }
    }
};

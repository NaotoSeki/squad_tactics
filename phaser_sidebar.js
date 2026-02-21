/** PHASER SIDEBAR: Right panel rendered in Phaser (unit info, loadout, log) */
const SIDEBAR_WIDTH_DEFAULT = 340;
const SIDEBAR_WIDTH_MIN = 240;
const SIDEBAR_WIDTH_MAX = 560;
window.__sidebarWidth = window.__sidebarWidth != null ? window.__sidebarWidth : SIDEBAR_WIDTH_DEFAULT;
window.getSidebarWidth = function() { return (typeof window.__sidebarWidth === 'number' ? window.__sidebarWidth : SIDEBAR_WIDTH_DEFAULT); };
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
        this.slots = [];
        this.dragSrc = null;
        this.dragGhost = null;
        this.currentUnit = null;
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
        this.unitContent.removeAll(true);
        this.currentUnit = u;

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
        const portraitKey = usePortrait ? ('portrait_' + ((u.portraitIndex % 7) + 1)) : null;
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
        if (this.scene.textures.exists(faceKey)) {
            const face = this.scene.add.image(left, y, faceKey).setDisplaySize(64, 64);
            face.setOrigin(0, 0);
            this.unitContent.add(face);
        }

        const textLeft = left + 72;
        const nameText = this.scene.add.text(textLeft, y + 4, u.name, { fontSize: '14px', color: '#ffffff', fontFamily: 'sans-serif' });
        this.unitContent.add(nameText);
        const roleText = this.scene.add.text(textLeft, y + 24, (u.def && u.def.role) || '', { fontSize: '11px', color: '#ddaa44', fontFamily: 'monospace' });
        this.unitContent.add(roleText);

        const skills = (u.skills && Array.isArray(u.skills)) ? [...new Set(u.skills)] : [];
        if (skills.length > 0 && typeof SKILLS !== 'undefined') {
            const skillLines = skills.map(sk => SKILLS[sk] ? `${SKILLS[sk].name}: ${SKILLS[sk].desc}` : sk).join('  |  ');
            const skillText = this.scene.add.text(textLeft, y + 42, skillLines, { fontSize: '9px', color: TEXT_DIM, fontFamily: 'sans-serif', wordWrap: { width: sw - 88 } });
            this.unitContent.add(skillText);
            y += 60;
        } else {
            y += 42;
        }
        y += 10;

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
            const reloadBtn = this.createButton(left, y, sw - 36, 28, 'RELOAD', () => { if (window.gameLogic) window.gameLogic.reloadWeapon(); });
            this.unitContent.add(reloadBtn.container);
            y += 38;
        }

        y += 12;
        const endTurnBtn = this.createButton(left, y, sw - 36, 32, 'End Turn', () => { if (window.gameLogic) window.gameLogic.endTurn(); }, 0x552222, 0xdd4444);
        this.unitContent.add(endTurnBtn.container);
    }

    createSlot(u, item, type, index, x, y, isMain, isMortarActive) {
        const slotW = window.getSidebarWidth() - 36;
        const needsMg42Gauge = item && item.code === 'mg42' && item.reserve !== undefined && isMain;
        const slotH = (isMain && needsMg42Gauge) ? 130 : (isMain ? 90 : 36);
        const borderColor = isMain ? ACCENT : SLOT_BORDER;
        const bgColor = isMain ? 0x2a201a : SLOT_BG;

        const container = this.scene.add.container(x, y);
        const bg = this.scene.add.rectangle(slotW / 2, slotH / 2, slotW, slotH, item ? bgColor : 0x0a0a0a);
        bg.setStrokeStyle(1, borderColor, item ? 1 : 0.3);
        bg.setInteractive({ useHandCursor: !!item });
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
            if (u.team === 'enemy') {
                // 敵ユニットは弾丸ゲージ表示なし（はみ出し防止・弾切れは行動で表現）
            } else if (item && item.code === 'mg42' && item.reserve !== undefined && isMain) {
                const maxRounds = 300;
                const reserve = Math.min(maxRounds, item.reserve || 0);
                const cols = 30, rows = 10, gap = 1;
                const availW = slotW - 16;
                const cellW = Math.floor((availW - (cols - 1) * gap) / cols);
                const cellH = 2;
                const gridTop = 38;
                const countText = this.scene.add.text(8, gridTop - 6, `${reserve}/${maxRounds}`, { fontSize: '8px', color: TEXT_DIM, fontFamily: 'monospace' });
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
        bg.on('pointerdown', (ptr) => { if (label === '[EMPTY]') return; self.onSlotPointerDown(ptr, type, index, slotW, slotH, label, container); });
        bg.on('pointerover', () => { if (self.dragSrc) bg.setStrokeStyle(3, ACCENT, 1); });
        bg.on('pointerout', () => { bg.setStrokeStyle(1, borderColor, item ? 1 : 0.3); });
        bg.on('pointerup', (ptr) => { self.onSlotPointerUp(ptr, type, index); });

        container.slotData = { type, index, u, borderColor, hasItem: !!item };
        return { container, height: slotH };
    }

    updateDropHighlight(px, py) {
        const isWeaponryCardDrag = typeof Renderer !== 'undefined' && Renderer.isCardDragging && typeof WPNS !== 'undefined' && Renderer.draggedCardType && WPNS[Renderer.draggedCardType] && WPNS[Renderer.draggedCardType].attr === (typeof ATTR !== 'undefined' ? ATTR.WEAPON : 'Weaponry');
        const showHighlight = this.dragSrc || isWeaponryCardDrag;
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

    onSlotPointerDown(pointer, type, index, slotW, slotH, label, slotContainer) {
        if (this.dragSrc) return;
        const isMain = type === 'main';
        const borderColor = isMain ? ACCENT : SLOT_BORDER;
        const bgColor = isMain ? 0x2a201a : SLOT_BG;
        this.dragSrc = { type, index };
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
        const onMove = (p) => { this.dragGhost.targetX = p.x; this.dragGhost.targetY = p.y; this._pointerX = p.x; this._pointerY = p.y; };
        const onUp = (p) => {
            this.scene.input.off('pointermove', onMove); this.scene.input.off('pointerup', onUp);
            if (!this.dragSrc || !this.dragGhost) {
                if (this.dragGhost) this.dragGhost.destroy();
                this.dragGhost = null; this.dragSrc = null;
                if (this.dragLiftedSlot) { this.dragLiftedSlot.setAlpha(1); this.dragLiftedSlot = null; }
                return;
            }
            const dropTarget = this.hitTestSlots(p.x, p.y);
            const w = this.scene.scale.width;
            const h = this.scene.scale.height;
            const dropZoneY = h * 0.88;
            const overDeck = p.x < w - window.getSidebarWidth() && p.y >= dropZoneY;
            const sameSlot = dropTarget && this.dragSrc.type === dropTarget.type && this.dragSrc.index === dropTarget.index;
            const didSwap = dropTarget && window.gameLogic && window.gameLogic.swapEquipment && !sameSlot;
            const didMoveToDeck = overDeck && window.gameLogic && window.gameLogic.moveWeaponToDeck;
            if (didSwap) {
                window.gameLogic.swapEquipment(this.dragSrc, dropTarget);
            } else if (didMoveToDeck) {
                window.gameLogic.moveWeaponToDeck(this.dragSrc);
            }
            if (this.dragLiftedSlot && !didSwap && !didMoveToDeck) this.dragLiftedSlot.setAlpha(1);
            this.dragLiftedSlot = null;
            this.dragGhost.destroy(); this.dragGhost = null; this.dragSrc = null;
            this._snapTarget = null;
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
        if (!this.dragSrc || this.dragGhost) return;
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
        if (this.panelBg) {
            const sw = window.getSidebarWidth();
            this.panelBg.setPosition(w - sw / 2, h / 2);
            this.panelBg.setSize(sw, h);
        }
    }
};

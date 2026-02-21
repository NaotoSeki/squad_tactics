/** PHASER UNIT: Visuals & Robust Update Loop (Pixel-Perfect Click) */

class UnitView {
    constructor(scene, unitLayer, hpLayer) {
        this.scene = scene;
        this.unitLayer = unitLayer;
        this.hpLayer = hpLayer;
        this.visuals = new Map(); 
        this.defineAnimations();
    }

    defineAnimations() {
        const anims = this.scene.anims;
        if (anims.exists('anim_idle')) return; 

        anims.create({ key: 'anim_idle', frames: anims.generateFrameNumbers('us_soldier', { start: 0, end: 7 }), frameRate: 8, repeat: -1 });
        anims.create({ key: 'anim_crouch', frames: anims.generateFrameNumbers('us_soldier', { start: 8, end: 15 }), frameRate: 15, repeat: 0 });
        anims.create({ key: 'anim_prone', frames: anims.generateFrameNumbers('us_soldier', { start: 24, end: 31 }), frameRate: 15, repeat: 0 });
        anims.create({ key: 'anim_crouch_idle', frames: anims.generateFrameNumbers('us_soldier', { frames: [15] }), frameRate: 1, repeat: -1 });
        anims.create({ key: 'anim_prone_idle', frames: anims.generateFrameNumbers('us_soldier', { frames: [33, 33, 33, 33, 33, 34, 33, 33, 33, 33, 38, 39, 38, 33, 33]}), frameRate: 6, repeat: -1 });
        anims.create({ key: 'anim_crouch_shoot', frames: anims.generateFrameNumbers('us_soldier', { start: 16, end: 23 }), frameRate: 15, repeat: 0 });
        anims.create({ key: 'anim_prone_shoot', frames: anims.generateFrameNumbers('us_soldier', { start: 32, end: 39 }), frameRate: 15, repeat: 0 });
        anims.create({ key: 'anim_shoot', frames: anims.generateFrameNumbers('us_soldier', { start: 40, end: 47 }), frameRate: 15, repeat: 0 });
        anims.create({ key: 'anim_walk', frames: anims.generateFrameNumbers('us_soldier', { start: 48, end: 55 }), frameRate: 10, repeat: -1 });
        anims.create({ key: 'anim_crouch_walk', frames: anims.generateFrameNumbers('us_soldier', { start: 56, end: 63 }), frameRate: 8, repeat: -1 });
        anims.create({ key: 'anim_crawl', frames: anims.generateFrameNumbers('us_soldier', { start: 64, end: 71 }), frameRate: 6, repeat: -1 });
        anims.create({ key: 'anim_melee', frames: anims.generateFrameNumbers('us_soldier', { start: 72, end: 79 }), frameRate: 15, repeat: 0 });

        if (!anims.exists('tank_idle')) { anims.create({ key: 'tank_idle', frames: anims.generateFrameNumbers('tank_sheet', { frames: [7, 6, 5, 6, 7, 5] }), frameRate: 10, repeat: -1 }); }
        if (!anims.exists('explosion_anim')) { 
            anims.create({ 
                key: 'explosion_anim', 
                frames: anims.generateFrameNumbers('explosion_sheet', { start: 0, end: 15 }), 
                frameRate: 60, 
                repeat: 0, 
                hideOnComplete: true 
            }); 
        }
    }

    clear() {
        this.visuals.forEach(v => {
            if (v.container) v.container.destroy();
            if (v.hpBg) v.hpBg.destroy();
            if (v.hpBar) v.hpBar.destroy();
            if (v.infoContainer) v.infoContainer.destroy();
            if (v.skillContainer) v.skillContainer.destroy();
            if (v.rainbowRing) v.rainbowRing.destroy();
        });
        this.visuals.clear();
    }

    update(time, delta) {
        if (!window.gameLogic) return;
        
        try {
            const activeIds = new Set();
            const hexMap = new Map(); 
            
            window.gameLogic.units.forEach(u => {
                if (u.hp <= 0) {
                    const deadVisual = this.visuals.get(u.id);
                    if (deadVisual) {
                        if (deadVisual.container) deadVisual.container.destroy();
                        if (deadVisual.hpBg) deadVisual.hpBg.destroy();
                        if (deadVisual.hpBar) deadVisual.hpBar.destroy();
                        if (deadVisual.infoContainer) deadVisual.infoContainer.destroy();
                        if (deadVisual.skillContainer) deadVisual.skillContainer.destroy();
                        this.visuals.delete(u.id);
                    }
                    return;
                }
                const key = `${u.q},${u.r}`;
                if (!hexMap.has(key)) hexMap.set(key, []);
                hexMap.get(key).push(u);
                activeIds.add(u.id);
            });

            window.gameLogic.units.forEach(u => {
                if (u.hp <= 0) return;
                
                try {
                    let visual = this.visuals.get(u.id);
                    if (!visual) {
                        this.createVisual(u);
                        visual = this.visuals.get(u.id);
                        if(visual && visual.container) this.unitLayer.add(visual.container); 
                    }
                    
                    if (visual && (!visual.container || !visual.container.scene)) {
                        this.visuals.delete(u.id);
                        return;
                    }

                    const siblings = hexMap.get(`${u.q},${u.r}`) || [];
                    const index = siblings.indexOf(u);
                    const count = siblings.length;
                    this.updateVisual(visual, u, delta, index, count);

                    const isSelected = (window.gameLogic.selectedUnit === u);
                    if (isSelected) {
                        if (this.unitLayer.exists(visual.container)) { this.unitLayer.remove(visual.container); this.hpLayer.add(visual.container); }
                        if (!visual.glowFx && visual.sprite) {
                            visual.glowFx = visual.sprite.postFX.addGlow(0xffff00, 2, 0, false, 0.1, 12);
                        }
                    } else {
                        if (this.hpLayer.exists(visual.container)) { this.hpLayer.remove(visual.container); this.unitLayer.add(visual.container); }
                        if (visual.glowFx && visual.sprite) {
                            visual.sprite.postFX.remove(visual.glowFx);
                            visual.glowFx = null;
                        }
                    }
                } catch(err) {
                    console.error("Unit Update Error:", err);
                }
            });

            for (const [id, visual] of this.visuals) {
                if (!activeIds.has(id)) { 
                    this.destroyVisual(visual); 
                    this.visuals.delete(id); 
                }
            }
        } catch(e) {
            console.error("UnitView Main Loop Error:", e);
        }
    }

    createVisual(u) {
        const container = this.scene.add.container(0, 0);
        // ★修正: コンテナ全体のインタラクティブ判定を削除 (これで影や透明部分が反応しなくなる)
        // container.setSize(40, 60); 
        // container.setInteractive({ useHandCursor: true });
        // container.on('pointerdown', ...) も削除

        const shadow = this.scene.add.ellipse(0, -4, 20, 10, 0x000000, 0.5);
        
        let sprite;
        if (u.def.name === "Rifleman" || u.def.role === "infantry" || !u.def.isTank) { 
            sprite = this.scene.add.sprite(0, -20, 'us_soldier'); 
            sprite.setScale(0.25); 
            sprite.play('anim_idle');
            if (u.team === 'player') sprite.setTint(0xeeeeff); else sprite.setTint(0x9955ff);
        } else if (u.def.isTank) {
            sprite = this.scene.add.sprite(0, -10, 'tank_sheet');
            sprite.setScale(0.4);
            sprite.play('tank_idle');
            if (u.team === 'player') sprite.setTint(0xccddee); else sprite.setTint(0x9955ff);
            shadow.setPosition(-2, 2); 
            shadow.setSize(46, 18);
        } else {
            sprite = this.scene.add.rectangle(0, 0, 30, 40, u.team==='player'?0x00f:0xf00);
        }

        // ★修正: スプライト(画像)自体をクリック可能にする
        if (sprite) {
            sprite.setInteractive({ useHandCursor: true });
            sprite.on('pointerdown', (pointer) => {
                if (pointer.button === 0 && window.gameLogic) { 
                    if (window.gameLogic.interactionMode === 'MOVE') { return; }
                    
                    if (typeof Renderer !== 'undefined') Renderer.suppressMapClick = true;
                    pointer.event.stopPropagation(); 
                    window.gameLogic.onUnitClick(u); 
                }
            });
        }

        container.add([shadow, sprite]);

        let rainbowRing = null;
        if (u.fusionCount >= 2) {
            rainbowRing = this.scene.add.graphics().setDepth(-0.5);
            container.add(rainbowRing);
        }

        const hpBg = this.scene.add.rectangle(0, 0, 20, 2, 0x000000).setOrigin(0, 0.5);
        const hpBar = this.scene.add.rectangle(0, 0, 20, 2, 0x00ff00).setOrigin(0, 0.5);
        const infoContainer = this.scene.add.container(0, 18);
        
        this.hpLayer.add(hpBg);
        this.hpLayer.add(hpBar);
        this.hpLayer.add(infoContainer);

        const visual = { container, sprite, hpBg, hpBar, infoContainer, glowFx: null, rainbowRing };
        this.visuals.set(u.id, visual);
        
        if(typeof Renderer !== 'undefined') {
            const pos = Renderer.hexToPx(u.q, u.r);
            container.setPosition(pos.x, pos.y);
            container.targetX = pos.x; container.targetY = pos.y;
        }

        return visual;
    }

    updateVisual(visual, u, delta, index, count) {
        if(typeof Renderer === 'undefined' || !Renderer.hexToPx) return;
        const basePos = Renderer.hexToPx(u.q, u.r);
        
        let offsetX = 0, offsetY = 0;
        if (count > 1) {
            const spread = 20; 
            if (index === 0) { offsetX = -spread; offsetY = -spread; }
            else if (index === 1) { offsetX = spread; offsetY = -spread; }
            else if (index === 2) { offsetX = -spread; offsetY = spread; }
            else if (index === 3) { offsetX = spread; offsetY = spread; }
            else if (index === 4) { offsetX = 0; offsetY = 0; }
        }
        
        visual.targetX = basePos.x + offsetX;
        visual.targetY = basePos.y + offsetY;

        const dx = visual.targetX - visual.container.x;
        const dy = visual.targetY - visual.container.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const speed = 0.06; 
        
        let isMoving = false;
        if (dist > 1) {
            visual.container.x += dx * speed;
            visual.container.y += dy * speed;
            isMoving = true;
            if (Math.abs(dx) > 0.1) visual.sprite.setFlipX(dx < 0);
        } else {
            visual.container.x = visual.targetX;
            visual.container.y = visual.targetY;
        }

        if (visual.rainbowRing && u.fusionCount >= 2) {
            visual.rainbowRing.clear();
            const t = (this.scene.time || { now: 0 }).now * 0.001;
            const colors = [0xff0000, 0xff8800, 0xffff00, 0x00ff00, 0x0088ff, 0x8800ff];
            const segs = 48;
            const rx = 28;
            const ry = 38;
            const cy = -20;
            for (let i = 0; i < segs; i++) {
                const u_frac = (i / segs + t * 0.12) % 1;
                const ci = Math.floor(u_frac * colors.length) % colors.length;
                const c = colors[ci];
                const a1 = (i / segs) * Math.PI * 2;
                const a2 = ((i + 1) / segs) * Math.PI * 2;
                const x1 = rx * Math.cos(a1);
                const y1 = cy + ry * Math.sin(a1);
                const x2 = rx * Math.cos(a2);
                const y2 = cy + ry * Math.sin(a2);
                visual.rainbowRing.lineStyle(2.5, c, 0.9);
                visual.rainbowRing.beginPath();
                visual.rainbowRing.moveTo(x1, y1);
                visual.rainbowRing.lineTo(x2, y2);
                visual.rainbowRing.strokePath();
            }
        }

        if (!u.def.isTank && visual.sprite) {
            const currentAnim = visual.sprite.anims.currentAnim ? visual.sprite.anims.currentAnim.key : '';
            const isAttacking = currentAnim.includes('shoot') || currentAnim.includes('melee');
            
            if (isMoving) {
                let moveAnim = 'anim_walk';
                if (u.stance === 'crouch') moveAnim = 'anim_crouch_walk';
                if (u.stance === 'prone') moveAnim = 'anim_crawl';
                if (currentAnim !== moveAnim) visual.sprite.play(moveAnim, true);
            } else {
                if (!isAttacking || !visual.sprite.anims.isPlaying) {
                    let idleAnim = 'anim_idle';
                    if (u.stance === 'crouch') idleAnim = 'anim_crouch_idle'; 
                    if (u.stance === 'prone') idleAnim = 'anim_prone_idle';
                    if (currentAnim !== idleAnim) visual.sprite.play(idleAnim, true);
                }
            }
        }

        if (visual.hpBg && visual.hpBar && visual.infoContainer) {
            const barY = visual.container.y - 45; 
            const barX = visual.container.x - 10;
            visual.hpBg.setPosition(barX, barY);
            visual.hpBar.setPosition(barX, barY);
            
            const hpPct = u.hp / u.maxHp;
            visual.hpBar.width = Math.max(0, 20 * hpPct);
            visual.hpBar.fillColor = hpPct > 0.5 ? 0x00ff00 : 0xff0000;

            const infoY = visual.container.y + 12;
            visual.infoContainer.setPosition(visual.container.x, infoY);
            visual.infoContainer.removeAll(true);

            let infoText = "";
            if(u.hands && u.hands.isBroken) infoText += "⚠ ";
            if(u.hp < u.maxHp*0.5) infoText += "➕ ";
            
            if (infoText) {
                const txt = this.scene.add.text(0, 0, infoText, { fontSize: '10px' }).setOrigin(0.5);
                visual.infoContainer.add(txt);
            }

            const skillsArr = (u.skills && Array.isArray(u.skills)) ? [...new Set(u.skills)] : [];
            if (typeof SKILL_STYLES !== 'undefined' && skillsArr.length > 0) {
                const scaleFactor = 0.24;
                const iconSize = 8;
                const skillY = barY + 2 + 3;
                const yOffset = 0;
                const spacing = 10;
                let iconX = -((skillsArr.length - 1) * spacing) / 2;

                if(!visual.skillContainer) {
                    visual.skillContainer = this.scene.add.container(0, 0);
                    this.hpLayer.add(visual.skillContainer);
                }
                visual.skillContainer.setPosition(visual.container.x, skillY);
                visual.skillContainer.setScale(scaleFactor);
                visual.skillContainer.removeAll(true);

                skillsArr.forEach(sk => {
                    if (SKILL_STYLES[sk]) {
                        const st = SKILL_STYLES[sk];
                        const bg = this.scene.add.rectangle(iconX, yOffset, iconSize, iconSize, parseInt(st.col.replace('#','0x'), 16), 0.9);
                        const badge = this.scene.add.text(iconX, yOffset, st.icon, { fontSize: '12px', fontFamily: 'Segoe UI Emoji' }).setOrigin(0.5);
                        visual.skillContainer.add([bg, badge]);
                        iconX += spacing;
                    }
                });
            } else {
                if(visual.skillContainer) visual.skillContainer.removeAll(true);
            }
        }
    }

    destroyVisual(visual) {
        if(visual.container) visual.container.destroy();
        if(visual.hpBg) visual.hpBg.destroy();
        if(visual.hpBar) visual.hpBar.destroy();
        if(visual.infoContainer) visual.infoContainer.destroy();
        if(visual.skillContainer) visual.skillContainer.destroy();
        if(visual.rainbowRing) visual.rainbowRing.destroy();
    }

    triggerAttack(attacker, target) {
        const visual = this.visuals.get(attacker.id);
        if (!visual || !visual.sprite) return;
        if (attacker.def.isTank) return; 

        let animKey = 'anim_shoot'; 
        if(typeof Renderer === 'undefined') return;
        const start = Renderer.hexToPx(attacker.q, attacker.r);
        const end = Renderer.hexToPx(target.q, target.r);
        const dist = Phaser.Math.Distance.Between(start.x, start.y, end.x, end.y);
        
        if (dist < 60) {
            animKey = 'anim_melee';
        } else {
            if (attacker.stance === 'crouch') animKey = 'anim_crouch_shoot';
            if (attacker.stance === 'prone') animKey = 'anim_prone_shoot';
        }

        const isRight = end.x >= start.x;
        visual.sprite.setFlipX(!isRight);

        visual.sprite.play(animKey);
        visual.sprite.once('animationcomplete', () => {
            if(visual.sprite) {
                let idleAnim = 'anim_idle';
                if (attacker.stance === 'crouch') idleAnim = 'anim_crouch_idle';
                if (attacker.stance === 'prone') idleAnim = 'anim_prone_idle';
                visual.sprite.play(idleAnim, true);
            }
        });
    }
}

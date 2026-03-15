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
        if (anims.exists('anim_crawl_0')) return;
        // soldier_crawl: 8方向×30フレーム。並びは左から NW,W,SW,S,SE,E,NE,N。匍匐っぽくゆっくり
        for (let d = 0; d < 8; d++) {
            const frames = [];
            for (let row = 0; row < 30; row++) frames.push(d + row * 8);
            anims.create({
                key: 'anim_crawl_' + d,
                frames: anims.generateFrameNumbers('soldier_crawl', { frames }),
                frameRate: 6,
                repeat: -1
            });
        }
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
            if (v.fusionGlowFx && v.sprite) { try { v.sprite.postFX.remove(v.fusionGlowFx); } catch(e){} }
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
                        if (visual.fusionGlowFx && visual.sprite) {
                            visual.sprite.postFX.remove(visual.fusionGlowFx);
                            visual.fusionGlowFx = null;
                        }
                        if (!visual.glowFx && visual.sprite) {
                            visual.glowFx = visual.sprite.postFX.addGlow(0xffff00, 2, 0, false, 0.1, 12);
                        }
                    } else {
                        if (this.hpLayer.exists(visual.container)) { this.hpLayer.remove(visual.container); this.unitLayer.add(visual.container); }
                        if (visual.glowFx && visual.sprite) {
                            visual.sprite.postFX.remove(visual.glowFx);
                            visual.glowFx = null;
                        }
                        if (u.fusionCount >= 2 && visual.sprite) {
                            if (!visual.fusionGlowFx) {
                                visual.fusionGlowFx = visual.sprite.postFX.addGlow(0xffddaa, 1.4, 0, false, 0.06, 10);
                            }
                        } else if (visual.fusionGlowFx && visual.sprite) {
                            visual.sprite.postFX.remove(visual.fusionGlowFx);
                            visual.fusionGlowFx = null;
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

        const shadow = this.scene.add.ellipse(0, -12, 20, 10, 0x000000, 0.5);
        
        let sprite;
        if (u.def.name === "Rifleman" || u.def.role === "infantry" || !u.def.isTank) {
            sprite = this.scene.add.sprite(0, -20, 'soldier_crawl', 0);
            sprite.setScale(0.15); // 256px → 約38px（気持ち大きめ）
            sprite.play('anim_crawl_0');
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

        const hpBg = this.scene.add.rectangle(0, 0, 20, 2, 0x000000).setOrigin(0, 0.5);
        const hpBar = this.scene.add.rectangle(0, 0, 20, 2, 0x00ff00).setOrigin(0, 0.5);
        const infoContainer = this.scene.add.container(0, 18);
        
        this.hpLayer.add(hpBg);
        this.hpLayer.add(hpBar);
        this.hpLayer.add(infoContainer);

        const visual = { container, sprite, hpBg, hpBar, infoContainer, glowFx: null, fusionGlowFx: null, lastDx: 0, lastDy: 0 };
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
        const isInfantry = !u.def.isTank && (u.def.role === 'infantry' || u.def.name === 'Rifleman');
        const speed = isInfantry ? 0.03 : 0.06; // 匍匐はゆっくり移動
        
        let isMoving = false;
        if (dist > 1) {
            visual.container.x += dx * speed;
            visual.container.y += dy * speed;
            isMoving = true;
            visual.lastDx = dx;
            visual.lastDy = dy;
        } else {
            visual.container.x = visual.targetX;
            visual.container.y = visual.targetY;
        }

        if (!u.def.isTank && visual.sprite) {
            const dx_ = visual.lastDx || 0;
            const dy_ = visual.lastDy || 0;
            // スプライト並び: 0=NW, 1=W, 2=SW, 3=S, 4=SE, 5=E, 6=NE, 7=N に合わせる
            let d = Math.round((Math.atan2(-dy_, dx_) + 5 * Math.PI / 4) / (2 * Math.PI) * 8) % 8;
            if (d < 0) d += 8;
            const crawlAnim = 'anim_crawl_' + d;
            if (!visual.sprite.anims.currentAnim || visual.sprite.anims.currentAnim.key !== crawlAnim) {
                visual.sprite.play(crawlAnim, true);
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
        if(visual.fusionGlowFx && visual.sprite) { try { visual.sprite.postFX.remove(visual.fusionGlowFx); } catch(e){} }
        if(visual.container) visual.container.destroy();
        if(visual.hpBg) visual.hpBg.destroy();
        if(visual.hpBar) visual.hpBar.destroy();
        if(visual.infoContainer) visual.infoContainer.destroy();
        if(visual.skillContainer) visual.skillContainer.destroy();
    }

    triggerAttack(attacker, target) {
        const visual = this.visuals.get(attacker.id);
        if (!visual || !visual.sprite) return;
        if (attacker.def.isTank) return;
        if (typeof Renderer === 'undefined') return;

        const start = Renderer.hexToPx(attacker.q, attacker.r);
        const end = Renderer.hexToPx(target.q, target.r);
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        let d = Math.round(Math.atan2(-dy, dx) / (2 * Math.PI) * 8) % 8;
        if (d < 0) d += 8;
        visual.lastDx = dx;
        visual.lastDy = dy;

        const crawlAnim = 'anim_crawl_' + d;
        visual.sprite.play(crawlAnim, true);
    }
}

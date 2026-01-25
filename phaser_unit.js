/** PHASER UNIT: Fixed Shadow Position */
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
        if (!anims.exists('explosion_anim')) { anims.create({ key: 'explosion_anim', frames: anims.generateFrameNumbers('explosion_sheet', { start: 0, end: 7 }), frameRate: 20, repeat: 0, hideOnComplete: true }); }
    }

    update(time, delta) {
        if (!window.gameLogic) return;
        const activeIds = new Set();
        const hexMap = new Map(); 
        window.gameLogic.units.forEach(u => {
            if (u.hp <= 0) return;
            const key = `${u.q},${u.r}`;
            if (!hexMap.has(key)) hexMap.set(key, []);
            hexMap.get(key).push(u);
            activeIds.add(u.id);
        });

        window.gameLogic.units.forEach(u => {
            if (u.hp <= 0) return;
            let visual = this.visuals.get(u.id);
            if (!visual) {
                visual = this.createVisual(u);
                this.visuals.set(u.id, visual);
                this.unitLayer.add(visual);
            }
            const siblings = hexMap.get(`${u.q},${u.r}`) || [];
            const index = siblings.indexOf(u);
            const count = siblings.length;
            this.updateVisual(visual, u, delta, index, count);

            const isSelected = (window.gameLogic.selectedUnit === u);
            if (isSelected) {
                if (this.unitLayer.exists(visual)) { this.unitLayer.remove(visual); this.hpLayer.add(visual); }
            } else {
                if (this.hpLayer.exists(visual)) { this.hpLayer.remove(visual); this.unitLayer.add(visual); }
            }
        });

        for (const [id, visual] of this.visuals) {
            if (!activeIds.has(id)) { this.destroyVisual(visual); this.visuals.delete(id); }
        }
    }

    createVisual(u) {
        const container = this.scene.add.container(0, 0);
        container.setSize(40, 60);
        container.setInteractive({ useHandCursor: true });
        
        container.on('pointerdown', (pointer) => {
            if (pointer.button === 0 && window.gameLogic) { pointer.event.stopPropagation(); window.gameLogic.onUnitClick(u); }
        });

        // ★修正: 影の位置を調整 (足元に)
        const shadow = this.scene.add.ellipse(0, 0, 20, 10, 0x000000, 0.5);
        
        let sprite;
        if (u.def.name === "Rifleman" || u.def.role === "infantry" || !u.def.isTank) { 
            sprite = this.scene.add.sprite(0, -20, 'us_soldier'); 
            sprite.setScale(0.25); 
            sprite.play('anim_idle');
            if (u.team === 'player') sprite.setTint(0xeeeeff); else sprite.setTint(0xffaaaa);
        } else if (u.def.isTank) {
            sprite = this.scene.add.sprite(0, -10, 'tank_sheet');
            sprite.setScale(0.4);
            sprite.play('tank_idle');
            if (u.team === 'player') sprite.setTint(0xccddee); else sprite.setTint(0xffaaaa);
            shadow.setPosition(-2, 0); 
            shadow.setSize(46, 18);
        } else {
            sprite = this.scene.add.rectangle(0, 0, 30, 40, u.team==='player'?0x00f:0xf00);
        }

        const cursor = this.scene.add.image(0, 0, 'cursor').setScale(0.5).setAlpha(0).setVisible(false);
        this.scene.tweens.add({ targets: cursor, scale: { from: 0.5, to: 0.6 }, alpha: { from: 1, to: 0.5 }, yoyo: true, repeat: -1, duration: 800 });

        container.add([shadow, sprite, cursor]);

        const hpBg = this.scene.add.rectangle(0, 0, 20, 4, 0x000000).setOrigin(0, 0.5);
        const hpBar = this.scene.add.rectangle(0, 0, 20, 4, 0x00ff00).setOrigin(0, 0.5);
        const infoContainer = this.scene.add.container(0, 18);
        
        this.hpLayer.add(hpBg);
        this.hpLayer.add(hpBar);
        this.hpLayer.add(infoContainer);

        container.sprite = sprite;
        container.cursor = cursor;
        container.hpBg = hpBg; container.hpBar = hpBar; container.infoContainer = infoContainer;
        
        const pos = Renderer.hexToPx(u.q, u.r);
        container.setPosition(pos.x, pos.y);
        container.targetX = pos.x; container.targetY = pos.y;

        return container;
    }

    updateVisual(visual, u, delta, index, count) {
        if(!Renderer || !Renderer.hexToPx) return;
        const basePos = Renderer.hexToPx(u.q, u.r);
        
        let offsetX = 0, offsetY = 0;
        if (count > 1) {
            const spread = 12; 
            if (index === 0) { offsetX = -spread; offsetY = -spread; }
            else if (index === 1) { offsetX = spread; offsetY = -spread; }
            else if (index === 2) { offsetX = -spread; offsetY = spread; }
            else if (index === 3) { offsetX = spread; offsetY = spread; }
        }
        
        visual.targetX = basePos.x + offsetX;
        visual.targetY = basePos.y + offsetY;

        const dx = visual.targetX - visual.x;
        const dy = visual.targetY - visual.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const speed = 0.06; 
        
        let isMoving = false;
        if (dist > 1) {
            visual.x += dx * speed;
            visual.y += dy * speed;
            isMoving = true;
            if (Math.abs(dx) > 0.1) visual.sprite.setFlipX(dx < 0);
        } else {
            visual.x = visual.targetX;
            visual.y = visual.targetY;
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
            const barY = visual.y - 25; 
            const barX = visual.x - 10;
            visual.hpBg.setPosition(barX, barY);
            visual.hpBar.setPosition(barX, barY);
            
            const hpPct = u.hp / u.maxHp;
            visual.hpBar.width = Math.max(0, 20 * hpPct);
            visual.hpBar.fillColor = hpPct > 0.5 ? 0x00ff00 : 0xff0000;

            const infoY = visual.y + 12;
            visual.infoContainer.setPosition(visual.x, infoY);
            visual.infoContainer.removeAll(true);

            let infoText = "";
            if(u.hands && u.hands.isBroken) infoText += "⚠ ";
            if(u.hp < u.maxHp*0.5) infoText += "➕ ";
            
            if (infoText) {
                const txt = this.scene.add.text(0, 0, infoText, { fontSize: '10px' }).setOrigin(0.5);
                visual.infoContainer.add(txt);
            }
        }

        if (window.gameLogic.selectedUnit === u) {
            visual.cursor.setVisible(true);
            visual.cursor.setAlpha(1);
        } else {
            visual.cursor.setVisible(false);
        }
    }

    destroyVisual(visual) {
        if(visual.hpBg) visual.hpBg.destroy();
        if(visual.hpBar) visual.hpBar.destroy();
        if(visual.infoContainer) visual.infoContainer.destroy();
        visual.destroy();
    }

    triggerAttack(attacker, target) {
        const visual = this.visuals.get(attacker.id);
        if (!visual || !visual.sprite) return;
        if (attacker.def.isTank) return; 

        let animKey = 'anim_shoot'; 
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

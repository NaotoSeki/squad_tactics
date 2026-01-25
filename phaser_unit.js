/** * PHASER UNIT: Unit Visual Management (Slower & Stable Stance) */
class UnitView {
    constructor(scene, unitLayer, hpLayer) {
        this.scene = scene;
        this.unitLayer = unitLayer;
        this.hpLayer = hpLayer;
        this.visuals = new Map(); 
    }

    update(time, delta) {
        if (!window.gameLogic) return;

        const activeIds = new Set();
        window.gameLogic.units.forEach(u => {
            if (u.hp <= 0) return;
            activeIds.add(u.id);

            let visual = this.visuals.get(u.id);
            if (!visual) {
                visual = this.createVisual(u);
                this.visuals.set(u.id, visual);
                this.unitLayer.add(visual);
            }
            this.updateVisual(visual, u, delta); 

            const isSelected = (window.gameLogic.selectedUnit === u);
            if (isSelected) {
                if (this.unitLayer.exists(visual)) {
                    this.unitLayer.remove(visual);
                    this.hpLayer.add(visual);
                }
            } else {
                if (this.hpLayer.exists(visual)) {
                    this.hpLayer.remove(visual);
                    this.unitLayer.add(visual);
                }
            }
        });

        for (const [id, visual] of this.visuals) {
            if (!activeIds.has(id)) {
                this.destroyVisual(visual);
                this.visuals.delete(id);
            }
        }
    }

    createVisual(u) {
        const container = this.scene.add.container(0, 0);
        const shadow = this.scene.add.ellipse(0, 8, 20, 10, 0x000000, 0.5);
        
        let sprite;
        if (u.def.name === "Rifleman" || u.def.role === "infantry" || !u.def.isTank) { 
            sprite = this.scene.add.sprite(0, -20, 'us_soldier'); 
            sprite.setScale(0.5); 
            sprite.play('anim_idle');
            if (u.team === 'player') sprite.setTint(0xeeeeff); else sprite.setTint(0xffaaaa);
        } else if (u.def.isTank) {
            sprite = this.scene.add.sprite(0, -10, 'tank_sheet');
            sprite.setScale(0.5);
            sprite.play('tank_idle');
            if (u.team === 'player') sprite.setTint(0xccddee); else sprite.setTint(0xffaaaa);
            shadow.setPosition(-2, 2); 
            shadow.setSize(46, 18);
        } else {
            sprite = this.scene.add.rectangle(0, 0, 30, 40, u.team==='player'?0x00f:0xf00);
        }

        const cursor = this.scene.add.image(0, 0, 'cursor').setScale(1/window.HIGH_RES_SCALE).setAlpha(0).setVisible(false);
        this.scene.tweens.add({ targets: cursor, scale: { from: 1/window.HIGH_RES_SCALE, to: 1.1/window.HIGH_RES_SCALE }, alpha: { from: 1, to: 0.5 }, yoyo: true, repeat: -1, duration: 800 });

        container.add([shadow, sprite, cursor]);

        const hpBg = this.scene.add.rectangle(0, 0, 20, 4, 0x000000).setOrigin(0, 0.5);
        const hpBar = this.scene.add.rectangle(0, 0, 20, 4, 0x00ff00).setOrigin(0, 0.5);
        const infoContainer = this.scene.add.container(0, 18);
        const rankText = this.scene.add.text(0, 0, "", { fontSize: '8px', color: '#ffcc00' }).setOrigin(0.5, 0.5);

        this.hpLayer.add(hpBg);
        this.hpLayer.add(hpBar);
        this.hpLayer.add(infoContainer);

        container.sprite = sprite;
        container.cursor = cursor;
        container.hpBg = hpBg; container.hpBar = hpBar;
        container.infoContainer = infoContainer;
        container.rankText = rankText;
        
        const pos = Renderer.hexToPx(u.q, u.r);
        container.setPosition(pos.x, pos.y);
        container.targetX = pos.x;
        container.targetY = pos.y;

        return container;
    }

    updateVisual(container, u, delta) {
        if(!Renderer || !Renderer.hexToPx) return;
        
        const targetPos = Renderer.hexToPx(u.q, u.r);
        container.targetX = targetPos.x;
        container.targetY = targetPos.y;

        // ★速度変更: 0.15 -> 0.06 (ゆっくり)
        const dx = container.targetX - container.x;
        const dy = container.targetY - container.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const speed = 0.06; 
        
        let isMoving = false;
        
        if (dist > 1) {
            container.x += dx * speed;
            container.y += dy * speed;
            isMoving = true;
            
            if (Math.abs(dx) > 0.1) {
                // 向き反転 (移動方向へ)
                container.sprite.setFlipX(dx < 0);
            }
        } else {
            container.x = container.targetX;
            container.y = container.targetY;
        }

        // ★アニメーション管理: 姿勢維持のために静止画(idle)を使用
        if (!u.def.isTank && container.sprite) {
            const currentAnim = container.sprite.anims.currentAnim ? container.sprite.anims.currentAnim.key : '';
            const isAttacking = currentAnim.includes('shoot') || currentAnim.includes('melee');
            
            if (isMoving) {
                let moveAnim = 'anim_walk';
                if (u.stance === 'crouch') moveAnim = 'anim_crouch_walk';
                if (u.stance === 'prone') moveAnim = 'anim_crawl';
                
                if (currentAnim !== moveAnim) container.sprite.play(moveAnim, true);
            } else {
                if (!isAttacking || !container.sprite.anims.isPlaying) {
                    let idleAnim = 'anim_idle';
                    // ★修正: 遷移アニメ(anim_crouch)ではなく、静止アニメ(anim_crouch_idle)を使用
                    if (u.stance === 'crouch') idleAnim = 'anim_crouch_idle'; 
                    if (u.stance === 'prone') idleAnim = 'anim_prone_idle';
                    
                    if (currentAnim !== idleAnim) container.sprite.play(idleAnim, true);
                }
            }
        }

        if (container.hpBg && container.hpBar && container.infoContainer) {
            const barY = container.y - 35;
            const barX = container.x - 10;
            container.hpBg.setPosition(barX, barY);
            container.hpBar.setPosition(barX, barY);
            
            const hpPct = u.hp / u.maxHp;
            container.hpBar.width = Math.max(0, 20 * hpPct);
            container.hpBar.fillColor = hpPct > 0.5 ? 0x00ff00 : 0xff0000;

            const infoY = container.y + 18;
            container.infoContainer.setPosition(container.x, infoY);
            container.infoContainer.removeAll(true);

            let currentX = 0;
            if (u.rank > 0 && typeof RANKS !== 'undefined') {
                const rText = this.scene.add.text(0, 0, RANKS[Math.min(u.rank, 5)], { fontSize:'9px', color:'#eee', stroke:'#000', strokeThickness:2 }).setOrigin(0.5);
                container.infoContainer.add(rText);
                currentX += rText.width/2 + 4;
            } else {
                currentX -= 6;
            }

            if (u.skills && u.skills.length > 0 && window.SKILL_STYLES) {
                const g = this.scene.add.graphics();
                let ox = currentX;
                u.skills.forEach(sk => {
                    const st = window.SKILL_STYLES[sk];
                    const color = st ? parseInt(st.col.replace('#','0x')) : 0x888888;
                    g.fillStyle(0x000000, 1); g.fillRect(ox, -2, 5, 5); 
                    g.fillStyle(color, 1); g.fillRect(ox+1, -1, 3, 3); 
                    ox += 6;
                });
                container.infoContainer.add(g);
                container.infoContainer.x -= ox / 4; 
            }
        }

        if (window.gameLogic.selectedUnit === u) {
            container.cursor.setVisible(true);
            container.cursor.setAlpha(1);
        } else {
            container.cursor.setVisible(false);
        }
    }

    destroyVisual(visual) {
        if(visual.hpBg) visual.hpBg.destroy();
        if(visual.hpBar) visual.hpBar.destroy();
        if(visual.infoContainer) visual.infoContainer.destroy();
        if(visual.rankText) visual.rankText.destroy();
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
            // アニメ終わったら、★静止アニメに戻る
            if(visual.sprite) {
                let idleAnim = 'anim_idle';
                if (attacker.stance === 'crouch') idleAnim = 'anim_crouch_idle';
                if (attacker.stance === 'prone') idleAnim = 'anim_prone_idle';
                visual.sprite.play(idleAnim, true);
            }
        });
    }
}

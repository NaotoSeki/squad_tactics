/** PHASER UNIT: UnitView & Animation Controller */

class UnitView {
    constructor(scene, unitGroup, hpGroup) {
        this.scene = scene;
        this.unitGroup = unitGroup;
        this.hpGroup = hpGroup;
        this.visuals = new Map(); // key: unit.id, val: { container, sprite, hpBar, ... }
        this.defineAnimations();
    }

    defineAnimations() {
        const anims = this.scene.anims;
        if (!anims.exists('soldier_idle')) { anims.create({ key: 'soldier_idle', frames: anims.generateFrameNumbers('soldier_sheet', { start: 0, end: 3 }), frameRate: 5, repeat: -1 }); }
        if (!anims.exists('soldier_move')) { anims.create({ key: 'soldier_move', frames: anims.generateFrameNumbers('soldier_sheet', { start: 4, end: 7 }), frameRate: 8, repeat: -1 }); }
        if (!anims.exists('soldier_shoot')) { anims.create({ key: 'soldier_shoot', frames: anims.generateFrameNumbers('soldier_sheet', { start: 8, end: 9 }), frameRate: 10, repeat: 0 }); }
        if (!anims.exists('us_idle')) { anims.create({ key: 'us_idle', frames: anims.generateFrameNumbers('us_soldier', { start: 0, end: 3 }), frameRate: 5, repeat: -1 }); }
        if (!anims.exists('us_move')) { anims.create({ key: 'us_move', frames: anims.generateFrameNumbers('us_soldier', { start: 4, end: 7 }), frameRate: 8, repeat: -1 }); }
        if (!anims.exists('us_shoot')) { anims.create({ key: 'us_shoot', frames: anims.generateFrameNumbers('us_soldier', { start: 8, end: 9 }), frameRate: 10, repeat: 0 }); }
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

    // ★追加: ユニット表示を全消去するメソッド
    clear() {
        this.visuals.forEach(v => {
            if (v.container) v.container.destroy();
            if (v.hpBar) v.hpBar.destroy();
        });
        this.visuals.clear();
    }

    update(time, delta) {
        if (!window.gameLogic) return;
        const logicUnits = window.gameLogic.units;
        const activeIds = new Set();

        logicUnits.forEach(u => {
            if (u.hp <= 0) return; 
            activeIds.add(u.id);
            
            if (!this.visuals.has(u.id)) {
                this.createUnit(u);
            }
            
            const vis = this.visuals.get(u.id);
            const targetPos = Renderer.hexToPx(u.q, u.r);
            
            // Move Animation Interpolation
            const dist = Phaser.Math.Distance.Between(vis.container.x, vis.container.y, targetPos.x, targetPos.y);
            if (dist > 2) {
                const speed = 0.15;
                vis.container.x += (targetPos.x - vis.container.x) * speed;
                vis.container.y += (targetPos.y - vis.container.y) * speed;
                
                if (u.def.isTank) {
                    // Tank logic (no flip, just anim)
                } else {
                    if (targetPos.x < vis.container.x) vis.sprite.setFlipX(true);
                    else vis.sprite.setFlipX(false);
                    const animKey = (u.team === 'player') ? 'us_move' : 'soldier_move';
                    if (vis.sprite.anims.currentAnim?.key !== animKey) vis.sprite.play(animKey, true);
                }
                vis.container.setDepth(vis.container.y); 
            } else {
                vis.container.x = targetPos.x; vis.container.y = targetPos.y;
                if (!vis.isAttacking) {
                    if(u.def.isTank) {
                        if (vis.sprite.anims.currentAnim?.key !== 'tank_idle') vis.sprite.play('tank_idle', true);
                    } else {
                        const animKey = (u.team === 'player') ? 'us_idle' : 'soldier_idle';
                        if (vis.sprite.anims.currentAnim?.key !== animKey) vis.sprite.play(animKey, true);
                    }
                }
                vis.container.setDepth(vis.container.y);
            }

            // Glow Effect for Selection
            if (window.gameLogic.selectedUnit && window.gameLogic.selectedUnit.id === u.id) {
                vis.sprite.setTint(0xffffaa);
            } else {
                vis.sprite.clearTint();
            }

            // Update HP Bar (Slim, Overhead)
            if (vis.hpBar) {
                vis.hpBar.clear();
                vis.hpBar.setPosition(vis.container.x - 16, vis.container.y - 50); 
                vis.hpBar.setDepth(9000); 
                
                const hpPct = u.hp / u.maxHp;
                vis.hpBar.fillStyle(0x000000, 0.8);
                vis.hpBar.fillRect(0, 0, 32, 4);
                
                const color = (u.team === 'player') ? 0x4488ff : 0xff4444;
                vis.hpBar.fillStyle(color, 1.0);
                vis.hpBar.fillRect(1, 1, 30 * hpPct, 2);
                
                // Ammo Indicators (Small dots below HP)
                if(!u.def.isTank && u.hands && u.hands.cap > 0) {
                    const ammoPct = u.hands.current / u.hands.cap;
                    const dotColor = (ammoPct < 0.3) ? 0xff4400 : 0xffee00;
                    vis.hpBar.fillStyle(dotColor, 0.8);
                    const w = 30 * ammoPct;
                    vis.hpBar.fillRect(1, 6, w, 1);
                }
            }
        });

        // Remove dead units
        this.visuals.forEach((v, id) => {
            if (!activeIds.has(id)) {
                v.container.destroy();
                if(v.hpBar) v.hpBar.destroy();
                this.visuals.delete(id);
            }
        });
    }

    createUnit(u) {
        const pos = Renderer.hexToPx(u.q, u.r);
        const container = this.scene.add.container(pos.x, pos.y);
        
        let spriteKey = 'soldier_sheet';
        if (u.team === 'player') spriteKey = 'us_soldier';
        if (u.def.isTank) spriteKey = 'tank_sheet';

        const sprite = this.scene.add.sprite(0, -10, spriteKey);
        sprite.setScale(0.8);
        container.add(sprite);
        
        this.unitGroup.add(container);
        
        const hpBar = this.scene.add.graphics();
        this.hpGroup.add(hpBar);

        this.visuals.set(u.id, { container, sprite, hpBar, isAttacking: false });
    }

    triggerAttack(attacker, target) {
        const vis = this.visuals.get(attacker.id);
        if (vis && !attacker.def.isTank) {
            vis.isAttacking = true;
            const animKey = (attacker.team === 'player') ? 'us_shoot' : 'soldier_shoot';
            vis.sprite.play(animKey);
            vis.sprite.once('animationcomplete', () => {
                vis.isAttacking = false;
            });
            // Face target
            const tPos = Renderer.hexToPx(target.q, target.r);
            if (tPos.x < vis.container.x) vis.sprite.setFlipX(true);
            else vis.sprite.setFlipX(false);
        }
    }
}

/** * PHASER UNIT: Unit Visual Management 
 * Handles sprites, animations, shadows, ribbons, and HP bars.
 */
class UnitView {
    constructor(scene, unitLayer, hpLayer) {
        this.scene = scene;
        this.unitLayer = unitLayer;
        this.hpLayer = hpLayer;
        this.visuals = new Map(); // Unit ID -> Container
    }

    update(time, delta) {
        if (!window.gameLogic) return;

        // 存在するユニットの同期
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
            this.updateVisual(visual, u);

            // 選択中は最前面(hpLayer)へ、それ以外は通常レイヤー(unitLayer)へ
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

        // 死んだユニットの削除
        for (const [id, visual] of this.visuals) {
            if (!activeIds.has(id)) {
                this.destroyVisual(visual);
                this.visuals.delete(id);
            }
        }
    }

    createVisual(u) {
        const container = this.scene.add.container(0, 0);
        
        // 影
        const shadow = this.scene.add.ellipse(0, 8, 20, 10, 0x000000, 0.5);
        
        let sprite;
        // スプライト分岐
        if (u.def.name === "Rifleman" || u.def.role === "infantry") { // 汎用歩兵
            sprite = this.scene.add.sprite(0, -10, 'soldier_sheet');
            sprite.setScale(0.3);
            sprite.play('soldier_idle');
            if (u.team === 'player') sprite.setTint(0xeeeeff); else sprite.setTint(0xffaaaa);
        } else if (u.def.isTank) {
            sprite = this.scene.add.sprite(0, -10, 'tank_sheet');
            sprite.setScale(0.5);
            sprite.play('tank_idle');
            if (u.team === 'player') sprite.setTint(0xccddee); else sprite.setTint(0xffaaaa);
            shadow.setPosition(-2, 2); 
            shadow.setSize(46, 18);
        } else {
            // Fallback
            sprite = this.scene.add.rectangle(0, 0, 30, 40, u.team==='player'?0x00f:0xf00);
        }

        // 選択カーソル
        const cursor = this.scene.add.image(0, 0, 'cursor').setScale(1/window.HIGH_RES_SCALE).setAlpha(0).setVisible(false);
        this.scene.tweens.add({ targets: cursor, scale: { from: 1/window.HIGH_RES_SCALE, to: 1.1/window.HIGH_RES_SCALE }, alpha: { from: 1, to: 0.5 }, yoyo: true, repeat: -1, duration: 800 });

        container.add([shadow, sprite, cursor]);

        // HPバー & 情報 (これらは hpLayer に描画されるよう、containerには入れず管理だけする)
        // ※以前のコードではcontainerに入れていたが、layer移動の都合上、containerに入れておけば
        // containerごとlayer移動するのでOK。
        
        // HPバー背景・中身・ランクテキストの作成
        const hpBg = this.scene.add.rectangle(0, 0, 20, 4, 0x000000).setOrigin(0, 0.5);
        const hpBar = this.scene.add.rectangle(0, 0, 20, 4, 0x00ff00).setOrigin(0, 0.5);
        const infoContainer = this.scene.add.container(0, 18);
        const rankText = this.scene.add.text(0, 0, "", { fontSize: '8px', color: '#ffcc00' }).setOrigin(0.5, 0.5);

        // これらは常に最前面レイヤーに置きたいが、追従させるためManagerで管理
        this.hpLayer.add(hpBg);
        this.hpLayer.add(hpBar);
        this.hpLayer.add(infoContainer);

        container.sprite = sprite;
        container.cursor = cursor;
        container.hpBg = hpBg;
        container.hpBar = hpBar;
        container.infoContainer = infoContainer;
        container.rankText = rankText;

        return container;
    }

    updateVisual(container, u) {
        if(!Renderer || !Renderer.hexToPx) return;
        
        // 座標更新
        const pos = Renderer.hexToPx(u.q, u.r);
        container.setPosition(pos.x, pos.y);

        // HPバー & 情報更新 (ユニットの頭上・足元に追従)
        if (container.hpBg && container.hpBar && container.infoContainer) {
            const barY = pos.y - 35;
            const barX = pos.x - 10;
            
            container.hpBg.setPosition(barX, barY);
            container.hpBar.setPosition(barX, barY);
            
            const hpPct = u.hp / u.maxHp;
            container.hpBar.width = Math.max(0, 20 * hpPct);
            container.hpBar.fillColor = hpPct > 0.5 ? 0x00ff00 : 0xff0000;

            // 足元情報 (リボンバー)
            const infoY = pos.y + 18;
            container.infoContainer.setPosition(pos.x, infoY);
            container.infoContainer.removeAll(true); // ★ここが将来の最適化ポイント

            let currentX = 0;
            // ランク
            if (u.rank > 0 && typeof RANKS !== 'undefined') {
                const rText = this.scene.add.text(0, 0, RANKS[Math.min(u.rank, 5)], { fontSize:'9px', color:'#eee', stroke:'#000', strokeThickness:2 }).setOrigin(0.5);
                container.infoContainer.add(rText);
                currentX += rText.width/2 + 4;
            } else {
                currentX -= 6;
            }

            // スキルリボン
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

        // カーソル表示
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

    // 攻撃アニメーションのトリガー
    triggerAttack(attacker, target) {
        const visual = this.visuals.get(attacker.id);
        if (!visual || !visual.sprite) return;
        
        // 歩兵のみアニメあり
        if (attacker.def.isTank) return; // 戦車は今のところアニメなし(砲撃エフェクトのみ)

        const start = Renderer.hexToPx(attacker.q, attacker.r);
        const end = Renderer.hexToPx(target.q, target.r);
        const isRight = end.x >= start.x;
        const animKey = isRight ? 'soldier_shoot_right' : 'soldier_shoot_left';
        
        visual.sprite.play(animKey);
        visual.sprite.once('animationcomplete', () => {
            if(visual.sprite) visual.sprite.play('soldier_idle');
        });
    }
}

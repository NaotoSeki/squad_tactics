/** * PHASER UNIT: Unit Visual Management (Updated for 10-Row Animation) */
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
            this.updateVisual(visual, u, delta); // deltaを追加

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
        
        // 影
        const shadow = this.scene.add.ellipse(0, 8, 20, 10, 0x000000, 0.5);
        
        let sprite;
        if (u.def.name === "Rifleman" || u.def.role === "infantry" || !u.def.isTank) { 
            // ★新しいスプライトシートを使用
            sprite = this.scene.add.sprite(0, -20, 'us_soldier'); 
            sprite.setScale(0.5); // サイズ調整 (元が128なので大きすぎる場合)
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
        container.hpBg = hpBg;
        container.hpBar = hpBar;
        container.infoContainer = infoContainer;
        container.rankText = rankText;
        
        // ★初期座標を設定 (Lerpの起点)
        const pos = Renderer.hexToPx(u.q, u.r);
        container.setPosition(pos.x, pos.y);
        container.targetX = pos.x;
        container.targetY = pos.y;

        return container;
    }

    updateVisual(container, u, delta) {
        if(!Renderer || !Renderer.hexToPx) return;
        
        // 目標座標
        const targetPos = Renderer.hexToPx(u.q, u.r);
        container.targetX = targetPos.x;
        container.targetY = targetPos.y;

        // ★スムーズな移動 (Lerp)
        // 現在位置と目標位置の差分
        const dx = container.targetX - container.x;
        const dy = container.targetY - container.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        
        const speed = 0.15; // 追従速度
        
        let isMoving = false;
        
        if (dist > 1) {
            container.x += dx * speed;
            container.y += dy * speed;
            isMoving = true;
            
            // 向きの反転 (右に進むなら反転なし、左なら反転)
            // 敵味方でデフォルトの向きが違う場合は調整が必要ですが、一旦「右向きが正」と仮定
            if (Math.abs(dx) > 0.1) {
                container.sprite.setFlipX(dx < 0);
            }
        } else {
            container.x = container.targetX;
            container.y = container.targetY;
        }

        // ★アニメーションステートマシン
        if (!u.def.isTank && container.sprite) {
            const currentAnim = container.sprite.anims.currentAnim ? container.sprite.anims.currentAnim.key : '';
            // 攻撃中アニメの最中は上書きしない（攻撃が終わったら Idle/Walk に戻る）
            // ただし移動中は攻撃モーションをキャンセルして歩きに移行させる
            const isAttacking = currentAnim.includes('shoot') || currentAnim.includes('melee');
            
            if (isMoving) {
                // 移動モーション
                let moveAnim = 'anim_walk';
                if (u.stance === 'crouch') moveAnim = 'anim_crouch_walk';
                if (u.stance === 'prone') moveAnim = 'anim_crawl';
                
                if (currentAnim !== moveAnim) container.sprite.play(moveAnim, true);
            } else {
                // 停止中
                if (!isAttacking || !container.sprite.anims.isPlaying) {
                    // 待機モーション
                    let idleAnim = 'anim_idle';
                    if (u.stance === 'crouch') idleAnim = 'anim_crouch'; // 停止フレームとして使う
                    if (u.stance === 'prone') idleAnim = 'anim_prone';
                    
                    // しゃがみ/伏せの遷移アニメはループさせず、最後のフレームで止めるのが自然だが
                    // 今回は簡易的に再生しっぱなしにするか、アニメーション定義で工夫する
                    if (currentAnim !== idleAnim) container.sprite.play(idleAnim, true);
                }
            }
        }

        // HPバー & 情報更新
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
            
            // ★軽量化: 毎フレーム生成をやめ、変更があった時だけ再描画するフラグ管理などを推奨
            // 今回は前回のまま(動くこと優先)
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

        // ★武器・距離・姿勢に応じてアニメーションを切り替え
        let animKey = 'anim_shoot'; // デフォルト立ち撃ち
        
        // 白兵戦判定 (距離1以内、かつ武器がMeleeタイプなら)
        // ※簡易的に「距離1」なら殴るアニメにしちゃうのもアリ
        const start = Renderer.hexToPx(attacker.q, attacker.r);
        const end = Renderer.hexToPx(target.q, target.r);
        const dist = Phaser.Math.Distance.Between(start.x, start.y, end.x, end.y);
        
        // 1ヘックスは約34*1.7px程度なので、60px以内なら近接とみなす
        if (dist < 60) {
            animKey = 'anim_melee';
        } else {
            // 射撃姿勢
            if (attacker.stance === 'crouch') animKey = 'anim_crouch_shoot';
            if (attacker.stance === 'prone') animKey = 'anim_prone_shoot';
        }

        // 向き調整
        const isRight = end.x >= start.x;
        visual.sprite.setFlipX(!isRight); // FlipX=trueで左向きになる前提(元絵が右向きなら)
        // 元絵がどちら向きかによりますが、通常右向きで作る場合が多いので、左(end < start)ならFlip
        // ※us-soldier-back-sheet.png が「背面」メインなら、Flipロジックは少し変わるかも

        visual.sprite.play(animKey);
        visual.sprite.once('animationcomplete', () => {
            // アニメ終わったらIdleに戻る (updateVisualで自動的に戻るが念のため)
            if(visual.sprite) {
                let idleAnim = 'anim_idle';
                if (attacker.stance === 'crouch') idleAnim = 'anim_crouch';
                if (attacker.stance === 'prone') idleAnim = 'anim_prone';
                visual.sprite.play(idleAnim, true);
            }
        });
    }
}

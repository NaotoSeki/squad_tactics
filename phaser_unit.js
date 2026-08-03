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
        // 19モーションが揃う起動では soldier_crawl を読まない（フォールバック専用の
        // 8.3MBシート）。無い時にアニメを組むと空フレームで例外になるので飛ばす。
        if (!this.scene.textures.exists('soldier_crawl')) return;
        // soldier_crawl: 8方向×30フレーム。移動中は30fpsで蠢く、待機は止める
        for (let d = 0; d < 8; d++) {
            const frames = [];
            for (let row = 0; row < 30; row++) frames.push(d + row * 8);
            anims.create({
                key: 'anim_crawl_' + d,
                frames: anims.generateFrameNumbers('soldier_crawl', { frames }),
                frameRate: 30,
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

    // 死亡時フック（hp<=0 で視覚破棄される直前に呼ばれる。既定は何もしない）
    onUnitDead(u, visual) { }

    // ユニット位置の決定論的ジッタ[0,1)×2を得る（同じヘックスなら不変、移動で変化）
    _jitterHash(u) {
        let h = 2166136261 >>> 0;
        const s = `${u.id}|${u.q}|${u.r}`;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
        const a = ((h >>> 8) & 0xffff) / 0x10000;
        const b = ((h >>> 20) & 0xfff) / 0x1000;
        return [a, b];
    }

    // ユニット表示オフセットを計算（単独vs複数、戦車vs歩兵で振り分け）
    _calcUnitOffset(u, index, count, safe) {
        const [ja, jb] = this._jitterHash(u);
        const isTankU = !!(u.def && u.def.isTank);
        const maxJitter = isTankU ? 4 : (safe ? 8 : 15);
        let offsetX = 0, offsetY = 0;

        if (count <= 1) {
            // 単独: ヘックス内の一様ディスク散布（y は0.72倍で射影感）
            const ang = ja * Math.PI * 2;
            const rad = Math.sqrt(jb) * maxJitter;
            offsetX = Math.cos(ang) * rad;
            offsetY = Math.sin(ang) * rad * 0.72;
        } else {
            // 複数: 黄金角スパイラル基本 + ジッタ±30%
            const spread = safe ? 9 : 18;
            const baseAng = index * 2.399963;  // 黄金角 ≈137.5°
            const baseRad = spread * Math.sqrt((index + 0.6) / count) * 1.35;
            const ang = baseAng + (ja - 0.5) * 0.9;
            let rad = baseRad * (0.85 + jb * 0.3);
            // 戦車は複数時も rad を抑える（車体が大きい）
            if (isTankU) rad *= 0.5;
            offsetX = Math.cos(ang) * rad;
            offsetY = Math.sin(ang) * rad * 0.72;
        }

        return { offsetX, offsetY };
    }

    // 歩兵スプライト生成（createVisual から純粋抽出。サブクラスの差し替えフック）
    buildInfantrySprite(u) {
        // SoldierUnitView(v2 manifest)未使用時のフォールバックのみ。
        // SOLDIER_VIEW_H=20px(2026-07-13実測改訂)に合わせて比例縮小。
        // 19モーションが揃っている起動では soldier_crawl を読み込まない（8.3MB削減）
        // ので、ここへ来て texture が無い＝想定外。緑箱を出すより素の板を出す。
        if (!this.scene.textures.exists('soldier_crawl')) {
            console.warn('soldier_crawl 未ロードのままフォールバック描画が呼ばれた');
            const shadow = this.scene.add.rectangle(5, -9, 10, 4, 0x000000, 0.3);
            const sprite = this.scene.add.rectangle(0, -10, 8, 16,
                u.team === 'player' ? 0xeeeeff : 0x9955ff);
            return { shadow, sprite };
        }
        const shadow = this.scene.add.sprite(5, -9, 'soldier_crawl', 0);
        shadow.setTint(0x000000);
        shadow.setAlpha(0.3);
        shadow.setScale(0.083, 0.025);
        shadow.setOrigin(0.5, 0.52);
        const sprite = this.scene.add.sprite(0, -10, 'soldier_crawl', 0);
        sprite.setScale(0.078); // 256px → 約20px
        sprite.play('anim_crawl_0');
        if (u.team === 'player') sprite.setTint(0xeeeeff); else sprite.setTint(0x9955ff);
        return { shadow, sprite };
    }

    // 歩兵アニメ選択（updateVisual から純粋抽出。サブクラスの差し替えフック）
    /** 現在フレームのアルファ形状を使った、発砲点側の短い暖色リム。 */
    _directionIndex(dx, dy) {
        // soldier_crawl columns: 0=S, 1=SW, 2=W, 3=NW, 4=N, 5=NE,
        // 6=E, 7=SE. Screen Y grows downward, so rotate zero from E to S.
        let d = Math.round((Math.atan2(dy, dx) - Math.PI / 2) / (Math.PI / 4)) % 8;
        if (d < 0) d += 8;
        return d;
    }

    /** Keep the actual rendered soldier facing the current firing target. */
    noteShot(shooterId, from, to) {
        const visual = this.visuals.get(shooterId);
        if (!visual || !visual.sprite || !to) return;
        const sx = visual.container ? visual.container.x : from.x;
        const sy = visual.container ? visual.container.y : from.y;
        visual.lastDx = to.x - sx;
        visual.lastDy = to.y - sy;
        visual.aimFacingFrames = 14;
        visual.sprite.anims.stop();
        visual.sprite.setFrame(this._directionIndex(visual.lastDx, visual.lastDy));
    }

    /** World-space muzzle point based on the rendered per-soldier offset. */
    getMuzzlePoint(unit, target) {
        const id = unit && unit.id != null ? unit.id : unit;
        const visual = this.visuals.get(id);
        if (!visual || !visual.container || !visual.sprite) return null;
        let tx, ty;
        const targetVisual = target && this.visuals.get(target.id);
        if (targetVisual && targetVisual.container) {
            tx = targetVisual.container.x;
            ty = targetVisual.container.y - 8;
        } else if (target && typeof Renderer !== 'undefined' && Renderer.hexToPx) {
            const p = Renderer.hexToPx(target.q, target.r);
            tx = p.x; ty = p.y - 8;
        } else {
            tx = visual.container.x + (visual.lastDx || 1);
            ty = visual.container.y + (visual.lastDy || 0);
        }
        let ox = visual.container.x + visual.sprite.x;
        let oy = visual.container.y + visual.sprite.y;
        // v2写実兵スプライトの原点は「足元」。ここをそのまま銃口の起点にすると
        // 足から発光して見えるため、姿勢ごとの肩・銃床位置まで持ち上げる。
        const isV2Soldier = visual.sprite.texture && visual.sprite.texture.key
            && visual.sprite.texture.key.indexOf('sold_') === 0;
        if (isV2Soldier) {
            const posture = visual.postureLv == null ? 0 : visual.postureLv;
            const lift = posture >= 2 ? 4.5 : (posture === 1 ? 8.5 : 13);
            oy -= lift;
        }
        const dx = tx - ox, dy = ty - oy;
        const len = Math.max(1, Math.hypot(dx, dy));
        const nx = dx / len, ny = dy / len;
        const cls = unit && unit.weapon && unit.weapon.class;
        const barrel = isV2Soldier ? (cls === 'mg' ? 10 : 8) : (cls === 'mg' ? 13 : 11);
        return { x: ox + nx * barrel, y: oy + ny * barrel, angle: Math.atan2(dy, dx) };
    }

    flashMuzzleLight(lightX, lightY, radius) {
        if (!this.scene || !this.scene.tweens) return;
        this.visuals.forEach((visual) => {
            const spr = visual && visual.sprite;
            const container = visual && visual.container;
            if (!spr || !container || !spr.texture || !spr.frame) return;
            const dist = Math.hypot(lightX - container.x, lightY - container.y);
            if (dist > radius) return;
            if (window.AlphaLightSpace && window.AlphaLightSpace.flashAlpha) {
                window.AlphaLightSpace.flashAlpha(
                    this.scene, spr, lightX, lightY, radius,
                    {
                        worldX: container.x + spr.x,
                        worldY: container.y + spr.y,
                        parent: container,
                    }
                );
                return;
            }
            const gain = 1 - dist / Math.max(1, radius);
            const inv = dist > 1 ? 1 / dist : 0;
            const rim = this.scene.add.sprite(
                spr.x + (lightX - container.x) * inv * 2.2,
                spr.y + (lightY - container.y) * inv * 2.2,
                spr.texture.key, spr.frame.name
            );
            rim.setOrigin(spr.originX, spr.originY);
            rim.setScale(spr.scaleX, spr.scaleY);
            rim.setFlip(spr.flipX, spr.flipY);
            rim.setRotation(spr.rotation);
            rim.setTint(0xffad62);
            rim.setAlpha(0.10 + gain * 0.24);
            if (typeof Phaser !== 'undefined' && Phaser.BlendModes) rim.setBlendMode(Phaser.BlendModes.ADD);
            const index = container.getIndex(spr);
            container.addAt(rim, index >= 0 ? index : 0);
            this.scene.tweens.add({
                targets: rim, alpha: 0, duration: 82, ease: 'Cubic.out',
                onComplete: () => { if (rim.active) rim.destroy(); }
            });
        });
    }

    updateInfantryAnim(visual, u, isMoving) {
        if (!isMoving && u._rtwpTargetId && window.gameLogic) {
            const target = window.gameLogic.units.find(t => String(t.id) === String(u._rtwpTargetId) && t.hp > 0);
            if (target && typeof Renderer !== 'undefined' && Renderer.hexToPx) {
                const targetVisual = this.visuals.get(target.id);
                const a = visual.container || Renderer.hexToPx(u.q, u.r);
                const b = targetVisual && targetVisual.container
                    ? targetVisual.container : Renderer.hexToPx(target.q, target.r);
                visual.lastDx = b.x - a.x;
                visual.lastDy = b.y - a.y;
                visual.aimFacingFrames = Math.max(visual.aimFacingFrames || 0, 2);
            }
        }
        const dx_ = visual.lastDx || 0;
        const dy_ = visual.lastDy || 0;
        const d = this._directionIndex(dx_, dy_);
        const crawlAnim = 'anim_crawl_' + d;
        if (isMoving) {
            visual.crawlStopDelay = 4; // 移動終了後 4 フレームだけ再生してから止める
            visual.sprite.play(crawlAnim, true); // 毎フレーム play でアニメ抜けを防ぐ
        } else if (visual.aimFacingFrames > 0) {
            visual.aimFacingFrames--;
            visual.sprite.anims.stop();
            visual.sprite.setFrame(d);
        } else {
            if (visual.crawlStopDelay > 0) {
                visual.crawlStopDelay--;
                visual.sprite.play(crawlAnim, true); // 制止までアニメをゆっくり続ける
            } else {
                visual.sprite.anims.stop(); // 現在のフレームで止める（setFrame しないのでピクつかない）
            }
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

            // ★最適化: (q,r,生死)シグネチャが前フレームと同じなら hexMap を再構築せずに再利用
            let sig = '';
            window.gameLogic.units.forEach(u => {
                sig += u.id + ':' + (u.hp > 0 ? `${u.q},${u.r}` : 'x') + '|';
            });

            let hexMap;
            if (sig === this._hexMapSig && this._hexMapCache) {
                hexMap = this._hexMapCache;
                // activeIds はまだ必要なので軽量に再構築
                window.gameLogic.units.forEach(u => {
                    if (u.hp <= 0) {
                        const deadVisual = this.visuals.get(u.id);
                        if (deadVisual) {
                            this.onUnitDead(u, deadVisual); // 既定は no-op（サブクラス用フック）
                            if (deadVisual.container) deadVisual.container.destroy();
                            if (deadVisual.hpBg) deadVisual.hpBg.destroy();
                            if (deadVisual.hpBar) deadVisual.hpBar.destroy();
                            if (deadVisual.infoContainer) deadVisual.infoContainer.destroy();
                            if (deadVisual.skillContainer) deadVisual.skillContainer.destroy();
                            this.visuals.delete(u.id);
                        }
                        return;
                    }
                    activeIds.add(u.id);
                });
            } else {
                hexMap = new Map();

                window.gameLogic.units.forEach(u => {
                    if (u.hp <= 0) {
                        const deadVisual = this.visuals.get(u.id);
                        if (deadVisual) {
                            this.onUnitDead(u, deadVisual); // 既定は no-op（サブクラス用フック）
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

                this._hexMapSig = sig;
                this._hexMapCache = hexMap;
            }

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
                    // Yソート: 建物・樹木(TerrainRenderV7が同レイヤへdepth=Y-0.5で配置)との
                    // 前後関係を出す。選択中ユニットは視認性優先で常に最前面
                    visual.container.setDepth(visual.container.y + (isSelected ? 100000 : 0));
                    if (isSelected) {
                        if (visual.fusionGlowFx && visual.sprite) {
                            visual.sprite.postFX.remove(visual.fusionGlowFx);
                            visual.fusionGlowFx = null;
                        }
                        if (!visual.glowFx && visual.sprite) {
                            visual.glowFx = visual.sprite.postFX.addGlow(0xffff00, 2, 0, false, 0.1, 12);
                        }
                    } else {
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

        let shadow = null;
        let sprite;
        if (u.def.name === "Rifleman" || u.def.role === "infantry" || !u.def.isTank) {
            ({ shadow, sprite } = this.buildInfantrySprite(u));
        } else if (u.def.isTank) {
            shadow = this.scene.add.sprite(7, -7, 'tank_sheet', 7);
            shadow.setTint(0x000000);
            shadow.setAlpha(0.34);
            shadow.setScale(0.44, 0.14);
            shadow.setOrigin(0.5, 0.5);
            sprite = this.scene.add.sprite(0, -10, 'tank_sheet');
            sprite.setScale(0.4);
            sprite.play('tank_idle');
            if (u.team === 'player') sprite.setTint(0xccddee); else sprite.setTint(0x9955ff);
        } else {
            sprite = this.scene.add.rectangle(0, 0, 30, 40, u.team==='player'?0x00f:0xf00);
            shadow = this.scene.add.ellipse(0, -12, 22, 9, 0x000000, 0.35);
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

        if (shadow) container.add(shadow);
        container.add(sprite);

        const hpBg = this.scene.add.rectangle(0, 0, 20, 2, 0x000000).setOrigin(0, 0.5);
        const hpBar = this.scene.add.rectangle(0, 0, 20, 2, 0x00ff00).setOrigin(0, 0.5);
        const infoContainer = this.scene.add.container(0, 18);
        
        this.hpLayer.add(hpBg);
        this.hpLayer.add(hpBar);
        this.hpLayer.add(infoContainer);

        const visual = {
            container, sprite, shadowSprite: shadow, hpBg, hpBar, infoContainer,
            glowFx: null, fusionGlowFx: null, lastDx: 0, lastDy: 0, crawlStopDelay: 0
        };
        this.visuals.set(u.id, visual);

        if(typeof Renderer !== 'undefined') {
            const pos = Renderer.hexToPx(u.q, u.r);
            // 建物ヘックスへ直接出現(初期配置/増援)する場合、初回から壁際オフセット
            // 込みで置く — updateVisualのクロール移動で毎回にじり寄る見た目を防ぐ
            const t = window.gameLogic && window.gameLogic.map && window.gameLogic.map[u.q] && window.gameLogic.map[u.q][u.r];
            const safe = t && t.building && window.TerrainRenderV7 && window.CityMap && window.CityMap.active
                ? window.TerrainRenderV7.getBuildingSafeOffset(u.q, u.r) : null;
            if (safe) { pos.x += safe.dx; pos.y += safe.dy; }

            // 初回配置でも自然な散布位置を乗せる（count=1で単独扱い）
            const { offsetX, offsetY } = this._calcUnitOffset(u, 0, 1, safe);
            pos.x += offsetX;
            pos.y += offsetY;

            container.setPosition(pos.x, pos.y);
            container.targetX = pos.x; container.targetY = pos.y;
        }

        return visual;
    }

    /**
     * 歩兵スプライトが1フレームで進む距離(px)。走る兵は実際に速く滑る。
     *
     * 以前は 0.9px/frame 固定だった。ヘックス間隔は √3·HEX_SIZE ≈ 93.5px で、sim の
     * 歩きは 8tick(0.8秒)/hex なので必要なのは約1.95px/frame — 固定値では**歩きにすら
     * 追いつけず**、走り(0.4秒/hex)では4倍の遅れが溜まって論理位置から千切れていた。
     * 歩/走の差が画面に出ず、匍匐(2.0秒/hex)だけが唯一まともに見えていた正体はここ。
     * 実効モードの所要時間から逆算する。sim を持たないターン制本編は従来のまま。
     */
    _infantryStepPx(u, delta, dist) {
        const s = u && u._sim;
        if (!s) return 0.9; // ターン制本編（sim 無し）は従来の一定速度
        const T = window.SIM_TUNING || {};
        const pitch = Math.sqrt(3) * (typeof HEX_SIZE !== 'undefined' ? HEX_SIZE : 54);
        // sim が publish する実所要tick（地形コスト・脚の速さ込み）が最優先。無い時だけ
        // モードから概算する — 概算のままだと重い地形や鈍足の兵で先に着いて待ってしまう。
        let ticks = s.stepTicks;
        if (!(ticks > 0)) {
            const mode = s.stepMode || ((s.moveMode && s.moveMode !== 'auto') ? s.moveMode : 'walk');
            const mult = (T.MOVE_MODE_MULT && T.MOVE_MODE_MULT[mode] != null) ? T.MOVE_MODE_MULT[mode] : 1;
            ticks = (T.MOVE_T_PER_HEX || 8) * mult;
        }
        const secPerHex = Math.max(0.05, ticks * ((T.TICK_MS || 100) / 1000));
        // delta は稀に跳ねる（タブ復帰・重いフレーム）。3フレーム分で頭打ちにする
        const dt = Math.min(50, Math.max(1, delta || 16.7)) / 1000;
        let px = (pitch / secPerHex) * dt;
        // 地形コスト・脚の速さ・様子見の停止で遅れる分がある。1ヘックス以上離れたら
        // 追走を速めて千切れを防ぐ（上限つき。ワープはさせない）
        if (dist > pitch) px *= Math.min(3, dist / pitch);
        return px;
    }

    updateVisual(visual, u, delta, index, count) {
        if(typeof Renderer === 'undefined' || !Renderer.hexToPx) return;
        const basePos = Renderer.hexToPx(u.q, u.r);

        // 建物ヘックス内: 壁/屋根に重ならない位置(実測オフセット)へ寄せる。
        // 「市街戦なのに地面に伏せているだけ」を解消 — 歩兵は建物内へ進入でき、
        // 壁際の物陰に身を隠す(2026-07-13)。複数ユニット共存時のばらけ幅は
        // 壁からはみ出さないよう通常の半分に絞る。
        let inBuilding = false;
        if (window.gameLogic && window.gameLogic.map) {
            const t = window.gameLogic.map[u.q] && window.gameLogic.map[u.q][u.r];
            inBuilding = !!(t && t.building);
        }
        const safe = inBuilding && window.TerrainRenderV7 && window.CityMap && window.CityMap.active
            ? window.TerrainRenderV7.getBuildingSafeOffset(u.q, u.r) : null;
        if (safe) { basePos.x += safe.dx; basePos.y += safe.dy; }

        const { offsetX, offsetY } = this._calcUnitOffset(u, index, count, safe);

        visual.targetX = basePos.x + offsetX;
        visual.targetY = basePos.y + offsetY;

        const dx = visual.targetX - visual.container.x;
        const dy = visual.targetY - visual.container.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const isInfantry = !u.def.isTank && (u.def.role === 'infantry' || u.def.name === 'Rifleman');
        const arriveThreshold = isInfantry ? 0.15 : 1;
        
        let isMoving = false;
        if (dist > arriveThreshold) {
            if (isInfantry) {
                const step = Math.min(this._infantryStepPx(u, delta, dist), dist);
                visual.container.x += (dx / dist) * step;
                visual.container.y += (dy / dist) * step;
            } else {
                visual.container.x += dx * 0.06;
                visual.container.y += dy * 0.06;
            }
            isMoving = true;
            visual.lastDx = dx;
            visual.lastDy = dy;
        } else {
            visual.container.x = visual.targetX;
            visual.container.y = visual.targetY;
        }

        if (visual.shadowSprite && visual.sprite) {
            const spr = visual.sprite;
            const sh = visual.shadowSprite;
            if (sh.texture && spr.texture && sh.texture.key === spr.texture.key) {
                if (spr.frame && sh.setFrame) sh.setFrame(spr.frame.name);
                sh.setFlipX(spr.flipX);
                sh.setVisible(spr.visible);
            }
            // v7タイル実測に合わせた影: 方向=真東(tree_v0実測 vec(+37,0))、
            // 濃度α≈0.45(接地部0.65)。姿勢連動 — 立位は影が東へ伸び、
            // 伏せは体の直下にほぼ重ねる（潰して離すと浮いて見える）
            if (!u.def.isTank) {
                const lv = visual.postureLv || 0; // 0=stand 1=kneel 2=prone
                if (window.AlphaLightSpace && window.AlphaLightSpace.syncSunShadow) {
                    const conf = lv === 2
                        ? { castScale: 0.10, flatten: 0.76, widthScale: 1.01, alpha: 0.32 }
                        : lv === 1
                            ? { castScale: 0.24, flatten: 0.43, widthScale: 1.04, alpha: 0.35 }
                            : { castScale: 0.34, flatten: 0.30, widthScale: 1.05, alpha: 0.37 };
                    window.AlphaLightSpace.syncSunShadow(sh, spr, conf);
                } else {
                    const conf = lv === 2 ? { sx: 1.02, sy: 0.85, ox: 3,  oy: 1, a: 0.32 }
                               : lv === 1 ? { sx: 1.1,  sy: 0.45, ox: 6,  oy: 1, a: 0.4 }
                                          : { sx: 1.2,  sy: 0.32, ox: 10, oy: 1, a: 0.42 };
                    sh.setScale(spr.scaleX * conf.sx, spr.scaleY * conf.sy);
                    sh.setPosition(spr.x + conf.ox, spr.y + conf.oy);
                    sh.setAlpha(conf.a);
                }
            } else if (u.def.isTank) {
                sh.setScale(spr.scaleX * 1.04, spr.scaleY * 0.34);
                sh.setPosition(spr.x + 9, spr.y + 2);
                sh.setAlpha(0.42);
            }
        }

        if (!u.def.isTank && visual.sprite) {
            this.updateInfantryAnim(visual, u, isMoving);
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

            let infoText = "";
            if(Array.isArray(u.hands) && u.hands.some(item => item && item.isBroken)) infoText += "⚠ ";
            if(u.hp < u.maxHp*0.5) infoText += "➕ ";

            const skillsArr = (u.skills && Array.isArray(u.skills)) ? [...new Set(u.skills)] : [];

            // ★最適化: 表示内容に影響するキー（infoText, スキル配列）が前回と同じなら
            // removeAll + 再生成をスキップする
            const contentKey = infoText + '|' + skillsArr.join(',');

            if (visual.lastContentKey !== contentKey) {
                visual.infoContainer.removeAll(true);

                if (infoText) {
                    const txt = this.scene.add.text(0, 0, infoText, { fontSize: '10px' }).setOrigin(0.5);
                    visual.infoContainer.add(txt);
                }

                if (typeof SKILL_STYLES !== 'undefined' && skillsArr.length > 0) {
                    const iconSize = 8;
                    const yOffset = 0;
                    const spacing = 10;
                    let iconX = -((skillsArr.length - 1) * spacing) / 2;

                    if(!visual.skillContainer) {
                        visual.skillContainer = this.scene.add.container(0, 0);
                        this.hpLayer.add(visual.skillContainer);
                    }
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

                visual.lastContentKey = contentKey;
            }

            if (visual.skillContainer) {
                const scaleFactor = 0.24;
                const skillY = barY + 2 + 3;
                visual.skillContainer.setPosition(visual.container.x, skillY);
                visual.skillContainer.setScale(scaleFactor);
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
        const d = this._directionIndex(dx, dy);
        visual.lastDx = dx;
        visual.lastDy = dy;
        visual.aimFacingFrames = 14;
        visual.sprite.anims.stop();
        visual.sprite.setFrame(d);
    }
}

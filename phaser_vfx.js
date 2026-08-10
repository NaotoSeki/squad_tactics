/** PHASER VFX & ENV: Spark Only (No Debris/Rects)
 * 森林: ベクター描画(hd_tree_trunk + hd_tree_leaves_0/1/2)を廃止し、
 * asset/environment/fir_tree.png (128x128 x16) のスプライトシートに置換。
 * 軽減率試算: 1本あたり描画オブジェクト 4→1、テクスチャバッチ 4種→1種、
 * 毎フレーム更新 4オブジェクト→1オブジェクト。ロード時のベクター生成(幹+葉3枚)削除。
 * → 森林まわりの描画コール・CPU更新はおおよそ 70〜80% 削減想定。
 */

class VFXSystem {
    constructor() {
        this.particles = [];
        this.windTimer = 0;
        this.scene = null;
    }

    bindScene(scene) { this.scene = scene; }

    _muzzleProfile(weapon) {
        const code = String((weapon && weapon.code) || '').toLowerCase();
        const cls = String((weapon && weapon.class) || '').toLowerCase();
        const burst = Number((weapon && (weapon.burstSize ?? weapon.burst)) || 1);
        if (code.includes('mg42') || cls === 'mg' || burst >= 5) {
            return { flash: 0.08, coreAlpha: 0.58, length: 52, width: 20, alpha: 0.10, rim: 72 };
        }
        if (cls === 'pistol' || code.includes('m1911')) {
            return { flash: 0.04, coreAlpha: 0.50, length: 26, width: 11, alpha: 0.06, rim: 38 };
        }
        if (code.includes('suppressor') || code.includes('silenced')) {
            return { flash: 0.035, coreAlpha: 0.42, length: 22, width: 9, alpha: 0.04, rim: 30, tint: 0xff6a30 };
        }
        return { flash: 0.055, coreAlpha: 0.55, length: 38, width: 15, alpha: 0.075, rim: 52 };
    }

    /**
     * 弾を並べる1発あたりの間隔(ms)。**正本は音源の実測レート**（Sfx.roundIntervalMs）。
     *
     * 絵と音で別々の定数を持つと必ずずれる。旧実装はここがクラス固定値
     * (MG34/SMG46/他72ms) で、どの武器でも音より閃光の方が速く終わっていた
     * ——SMGの30発掃射で閃光1.38秒 対 音2.34秒（2026-08-04 ディレクター指摘）。
     * Sfx が居ない環境（VFX単体のテスト等）では従来の固定値へ落ちる。
     */
    _roundSpacing(weapon, rounds) {
        if (window.Sfx && window.Sfx.roundIntervalMs) {
            try {
                const ms = window.Sfx.roundIntervalMs(weapon, rounds);
                if (isFinite(ms) && ms > 0) return ms;
            } catch (e) { /* 音側が壊れていても描画は続ける */ }
        }
        const cls = String((weapon && weapon.class) || '').toLowerCase();
        return cls === 'mg' ? 46 : (cls === 'smg' ? 78 : 134);
    }

    _ensureMuzzleGlowTexture(scene) {
        const key = 'muzzle_ground_glow';
        if (scene.textures.exists(key)) return key;
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 128;
        const ctx = canvas.getContext('2d');
        // 楕円の上下左右が必ずキャンバス端でalpha=0になる寸法。以前は半径112を
        // 高さ128へ描いていたため、透明になる前に上下端で切れて四角く見えていた。
        ctx.save();
        ctx.translate(64, 64);
        ctx.scale(3, 1);
        const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, 64);
        grad.addColorStop(0, 'rgba(255,255,245,0.98)');
        grad.addColorStop(0.16, 'rgba(255,224,120,0.78)');
        grad.addColorStop(0.48, 'rgba(255,126,38,0.34)');
        grad.addColorStop(1, 'rgba(255,72,16,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, 64, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        // 後方側はキャンバスでクリップされるため、横方向にも透明マスクを掛けて
        // 左端の直線を消す。右端・上下端と合わせ、四辺すべてalpha=0になる。
        ctx.globalCompositeOperation = 'destination-in';
        const edgeMask = ctx.createLinearGradient(0, 0, canvas.width, 0);
        edgeMask.addColorStop(0, 'rgba(0,0,0,0)');
        edgeMask.addColorStop(0.12, 'rgba(0,0,0,1)');
        edgeMask.addColorStop(0.82, 'rgba(0,0,0,1)');
        edgeMask.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = edgeMask;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = 'source-over';
        scene.textures.addCanvas(key, canvas);
        return key;
    }

    /** 0-110msの発砲光。地面反射→アルファ輪郭の縁光→白芯の順で重ねる。 */
    /** One visible flash per projectile while keeping one audio event per burst. */
    playMuzzleBurst(x, y, angle, weapon, rounds) {
        const scene = this.scene;
        if (!scene) return;
        const count = Math.max(1, Math.round(rounds || 1));
        const spacing = this._roundSpacing(weapon, count);
        for (let i = 0; i < count; i++) {
            const fire = () => this.playMuzzleFlash(x, y, angle, weapon);
            if (i === 0) fire();
            else if (scene.time && scene.time.delayedCall) scene.time.delayedCall(i * spacing, fire);
            else setTimeout(fire, i * spacing);
        }
    }

    playMuzzleFlash(x, y, angle, weapon) {
        const scene = this.scene;
        if (!scene) return;
        const profile = this._muzzleProfile(weapon);
        const blend = (typeof Phaser !== 'undefined' && Phaser.BlendModes) ? Phaser.BlendModes.ADD : 1;
        const glowKey = this._ensureMuzzleGlowTexture(scene);
        const glow = scene.add.image(x, y + 3, glowKey)
            .setOrigin(0.20, 0.5).setRotation(angle)
            .setDisplaySize(profile.length, profile.width)
            .setAlpha(profile.alpha).setBlendMode(blend).setDepth(7.5);
        scene.tweens.add({
            targets: glow, alpha: 0, delay: 10, duration: 70, ease: 'Cubic.out',
            onComplete: () => glow.destroy()
        });
        if (scene.unitView && scene.unitView.flashMuzzleLight) {
            scene.unitView.flashMuzzleLight(x, y, profile.rim);
        }
        if (window.PsObjectLayer && window.PsObjectLayer.flashMuzzleLight) {
            window.PsObjectLayer.flashMuzzleLight(x, y, profile.rim);
        }

        if (!scene.textures.exists('muzzle_flash')) return;
        const variant = this._muzzleRR = ((this._muzzleRR || 0) + 1) % 4;
        const animKey = 'muzzle_flash_anim_' + variant;
        if (!scene.anims.exists(animKey)) {
            scene.anims.create({
                key: animKey,
                frames: scene.anims.generateFrameNumbers('muzzle_flash', { start: variant * 2, end: variant * 2 + 1 }),
                frameRate: 40, repeat: 0
            });
        }
        const spr = scene.add.sprite(x, y, 'muzzle_flash', variant * 2);
        spr.setOrigin(0.34, 0.5).setRotation(angle).setScale(profile.flash)
            .setAlpha(profile.coreAlpha).setTint(profile.tint || 0xffffff)
            .setBlendMode(blend).setDepth(1998);
        spr.play(animKey);
        spr.once('animationcomplete', () => spr.destroy());
    }

    /** 高解像度の小口径着弾3変種。必ず8フレーム完走して破棄する。 */
    playImpactSmoke(x, y, scale, variant) {
        const scene = this.scene;
        if (!scene || (typeof document !== 'undefined' && document.hidden)) return;
        const index = variant == null
            ? (this._impactRR = ((this._impactRR || 0) + 1) % 3)
            : Math.abs(Math.round(variant)) % 3;
        const texture = 'impact_rifle_' + index;
        if (!scene.textures.exists(texture)) return;
        const key = texture + '_anim';
        if (!scene.anims.exists(key)) {
            scene.anims.create({
                key: key,
                frames: scene.anims.generateFrameNumbers(texture, { start: 0, end: 7 }),
                frameRate: 30, repeat: 0
            });
        }
        const spr = scene.add.sprite(x, y, texture, 0)
            .setOrigin(0.5, 0.68).setScale(scale || 0.052).setDepth(1997);
        spr.play(key);
        spr.once('animationcomplete', () => spr.destroy());
    }

    /**
     * 実弾1発につき小さな着弾を1つ。命中弾は標的直近、残りは周辺地面へ散らす。
     * 銃口光と同じ発射間隔を使うため、flashとimpactの個数・時間列が対応する。
     */
    playBulletImpactBurst(x, y, rounds, weapon, hit) {
        const scene = this.scene;
        if (!scene) return;
        const count = Math.max(1, Math.round(rounds || 1));
        const spacing = this._roundSpacing(weapon, count);
        const cls = String((weapon && weapon.class) || '').toLowerCase();
        const spread = cls === 'mg' ? 18 : (cls === 'smg' ? 14 : 9);
        for (let i = 0; i < count; i++) {
            const decisive = !!hit && i === 0;
            const radius = decisive ? 2.5 : spread * (0.55 + Math.random() * 0.65);
            const theta = Math.random() * Math.PI * 2;
            const ix = x + Math.cos(theta) * radius;
            const iy = y + Math.sin(theta) * radius * 0.55;
            const size = (cls === 'mg' ? 0.050 : 0.044) * (0.88 + Math.random() * 0.22);
            const fire = () => this.playImpactSmoke(ix, iy, size, i + (this._impactRR || 0));
            if (i === 0) fire();
            else if (scene.time && scene.time.delayedCall) scene.time.delayedCall(i * spacing, fire);
            else setTimeout(fire, i * spacing);
        }
        this._impactRR = ((this._impactRR || 0) + count) % 3;
    }

    /** Commercial-safe material fragments generated only from owned numeric profiles. */
    playMaterialSplatter(x, y, material, seed) {
        const catalog = window.OriginalSplatterProfiles;
        const profile = catalog && catalog.profiles && catalog.profiles[material || 'dirt'];
        if (!profile || profile.releaseSafe !== true) return 0;
        let state = (Number(seed) >>> 0) || 0x6d2b79f5;
        const random = () => {
            state += 0x6d2b79f5;
            let t = state;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const between = (range) => range[0] + (range[1] - range[0]) * random();
        const count = Math.round(between(profile.particleCount));
        for (let i = 0; i < count; i++) {
            const angle = between(profile.launchAngleDeg) * Math.PI / 180;
            const speed = between(profile.speedPxPerFrame);
            this.add({
                x, y, vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed + profile.verticalBias,
                gravity: profile.gravityPxPerFrame2,
                color: profile.colors[Math.floor(random() * profile.colors.length)],
                size: between(profile.sizePx), alpha: between(profile.alpha),
                life: Math.round(between(profile.lifeFrames)),
                delay: Math.round(between(profile.delayFrames)),
                type: 'material-splatter'
            });
        }
        return count;
    }

    update() {
        this.windTimer++;
        if (this.windTimer > 400 + Math.random() * 300) {
            this.triggerWindGust();
            this.windTimer = 0;
        }

        for (let i = this.particles.length - 1; i >= 0; i--) {
            let p = this.particles[i];
            if (p.delay > 0) { p.delay--; continue; }
            
            p.prevX = p.x; p.prevY = p.y;
            p.life--;
            p.x += p.vx; p.y += p.vy;
            
            if (p.type === 'wind') {
                p.alpha = Math.sin((p.life / p.maxLife) * Math.PI) * 0.03;
            } else if (p.type === 'rocket' || p.type === 'mortar') {
                p.progress += p.speed;
                let t = p.progress;
                if (t >= 1) t = 1;
                const dx = p.ex - p.sx; const dy = p.ey - p.sy;
                p.prevX = p.x; p.prevY = p.y;
                p.x = p.sx + dx * t; p.y = p.sy + dy * t;
                if (p.arcHeight > 0) p.y -= Math.sin(t * Math.PI) * p.arcHeight;
                if (t < 1 && p.type === 'rocket') {
                    for (let s = 0; s < 2; s++) {
                        this.add({
                            x: p.x + (Math.random() - 0.5) * 6, y: p.y + (Math.random() - 0.5) * 6,
                            vx: (Math.random() - 0.5) * 0.6, vy: -0.5 - Math.random() * 0.8,
                            color: (Math.random() > 0.35) ? "#5a5a5a" : "#404040",
                            size: 5 + Math.random() * 7, life: 55 + Math.random() * 35, type: 'smoke'
                        });
                    }
                }
                if (t >= 1) { if (typeof p.onHit === 'function') p.onHit(); p.life = 0; }
            } else if (p.type === 'smoke') {
                p.vx *= 0.95; p.vy *= 0.95; 
                p.y -= 0.2; 
            } else if (p.type === 'spark') {
                p.vy += 0.1;
            } else if (p.type === 'material-splatter') {
                p.vy += p.gravity || 0.16;
                p.vx *= 0.985;
            }

            if (p.life <= 0) this.particles.splice(i, 1);
        }
    }

    triggerWindGust() {
        for (let i = 0; i < 4; i++) {
            this.add({
                x: -300 - Math.random() * 500, y: Math.random() * 3000,
                vx: 12 + Math.random() * 5, vy: 1 + Math.random() * 1,
                life: 180, color: "#ffffff", size: 1, type: 'wind'
            });
        }
        if(window.EnvSystem) window.EnvSystem.onGust();
    }

    /** Direction-only visual wind sample for short-lived sprite effects. */
    getVisualWindVector(speed) {
        const gusts = this.particles.filter(p => p.type === 'wind' && p.life > 0);
        if (!gusts.length) return null;
        const vx = gusts.reduce((sum, p) => sum + p.vx, 0) / gusts.length;
        const vy = gusts.reduce((sum, p) => sum + p.vy, 0) / gusts.length;
        const len = Math.hypot(vx, vy) || 1;
        const amount = Number(speed) > 0 ? Number(speed) : 7;
        return { x: vx / len * amount, y: vy / len * amount };
    }

    draw(graphics) {
        this.particles.forEach(p => {
            if (p.delay > 0) return;
            
            // ロケット (弧を描く飛翔＋煙の尾)
            if (p.type === 'rocket' || p.type === 'mortar') {
                const alpha = 0.95 - p.progress * 0.4;
                const mortar = p.type === 'mortar';
                graphics.lineStyle(mortar ? 2 : 4, mortar ? 0xd8d0aa : 0xffaa44, alpha);
                graphics.beginPath(); graphics.moveTo(p.prevX, p.prevY); graphics.lineTo(p.x, p.y); graphics.strokePath();
                graphics.lineStyle(mortar ? 1 : 2, mortar ? 0x5d5a48 : 0xffdd88, alpha + 0.2);
                graphics.beginPath(); graphics.moveTo(p.prevX, p.prevY); graphics.lineTo(p.x, p.y); graphics.strokePath();
                graphics.fillStyle(mortar ? 0x252820 : 0xffcc66, alpha);
                graphics.fillCircle(p.x, p.y, mortar ? 2.5 : 3);
            }
            // 風
            else if (p.type === 'wind') {
                graphics.lineStyle(1, 0xffffff, p.alpha);
                graphics.beginPath(); graphics.moveTo(p.x, p.y); graphics.lineTo(p.x - p.vx * 20, p.y - p.vy * 20); graphics.strokePath();
            }
            // Spark (火花) - 線として描画
            else if (p.type === 'spark') {
                const alpha = (p.alpha !== undefined) ? p.alpha : (p.life / p.maxLife);
                const len = Math.max(p.size, Math.sqrt(p.vx*p.vx + p.vy*p.vy) * 1.5);
                const angle = Math.atan2(p.vy, p.vx);
                const tailX = p.x - Math.cos(angle) * len;
                const tailY = p.y - Math.sin(angle) * len;

                graphics.lineStyle(Math.max(1, p.size), this.hexToInt(p.color), alpha);
                graphics.beginPath();
                graphics.moveTo(p.x, p.y);
                graphics.lineTo(tailX, tailY);
                graphics.strokePath();
            }
            else if (p.type === 'material-splatter') {
                const fade = Math.min(1, p.life / Math.max(1, p.maxLife * 0.45));
                graphics.fillStyle(this.hexToInt(p.color), p.alpha * fade);
                graphics.fillCircle(p.x, p.y, Math.max(0.7, p.size * 0.5));
            }
            // 煙など (単純なRectで描画、回転なし)
            else {
                const alpha = (p.alpha !== undefined) ? p.alpha : (p.life / p.maxLife);
                graphics.fillStyle(this.hexToInt(p.color), alpha);
                graphics.fillCircle(p.x, p.y, p.size * 0.5);
            }
        });
    }
    
    add(p) { 
        p.life = p.life || 60; p.maxLife = p.life; 
        p.vx = p.vx || 0; p.vy = p.vy || 0; 
        p.delay = p.delay || 0; 
        if (!p.color) p.color = "#ffffff"; 
        this.particles.push(p); 
    }
    
    // ★変更: Debris(破片)を削除し、Sparkのみ発生させる
    addExplosion(x, y, color, count) { 
        this.shakeRequest = 4; 
        for(let i=0; i<count*2; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 8 + 4;
            this.add({
                x:x, y:y-5,
                vx:Math.cos(angle)*speed,
                vy:Math.sin(angle)*speed,
                color: (Math.random()>0.5) ? "#ffaa00" : "#ffffff", 
                size: 2,
                life: 10+Math.random()*15,
                type:'spark'
            });
        }
    }
    
    addSmoke(x, y) { 
        this.playImpactSmoke(x, y, 0.052);
    }

    /** ロケットの煙の尾: 始点から終点へ複数煙を並べる（レガシー・一括煙） */
    addRocketTrail(sx, sy, ex, ey) {
        const steps = 8 + Math.floor(Math.random() * 4);
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = sx + (ex - sx) * t + (Math.random() - 0.5) * 8;
            const y = sy + (ey - sy) * t + (Math.random() - 0.5) * 8;
            this.add({
                x, y,
                vx: (Math.random() - 0.5) * 0.6,
                vy: -0.4 - Math.random() * 0.8,
                color: (Math.random() > 0.4) ? "#555555" : "#333333",
                size: 5 + Math.random() * 5,
                life: 40 + Math.random() * 25,
                type: 'smoke',
                delay: Math.floor(i * 2)
            });
        }
    }

    /** ロケット弾: 弧を描いて飛翔し、飛行中に煙の尾を残す。着弾時に onHit() を呼ぶ。 */
    addRocket(sx, sy, ex, ey, onHit) {
        const dist = Math.hypot(ex - sx, ey - sy);
        const arcHeight = Math.min(160, Math.max(70, dist * 0.28));
        this.add({
            type: 'rocket',
            x: sx, y: sy, prevX: sx, prevY: sy,
            sx, sy, ex, ey,
            progress: 0,
            speed: 0.038,
            arcHeight,
            life: 999,
            maxLife: 999,
            onHit: onHit || (() => {})
        });
    }

    /** 60mm shell: steep, smoke-free arc followed by a dedicated impact callback. */
    addMortarShell(sx, sy, ex, ey, onHit) {
        const dist = Math.hypot(ex - sx, ey - sy);
        this.add({
            type: 'mortar',
            x: sx, y: sy, prevX: sx, prevY: sy,
            sx, sy, ex, ey,
            progress: 0,
            speed: 0.026,
            arcHeight: Math.min(260, Math.max(120, dist * 0.46)),
            life: 999,
            maxLife: 999,
            onHit: onHit || (() => {})
        });
    }

    /** Lingering post-blast dust/smoke; intentionally slower than rifle impacts. */
    addMortarSmoke(x, y) {
        for (let i = 0; i < 32; i++) {
            this.add({
                x: x + (Math.random() - 0.5) * 34,
                y: y - 8 + (Math.random() - 0.5) * 14,
                vx: (Math.random() - 0.5) * 0.24,
                vy: -0.22 - Math.random() * 0.28,
                color: Math.random() > 0.35 ? '#625f55' : '#817b69',
                size: 9 + Math.random() * 15,
                life: 90 + Math.random() * 90,
                type: 'smoke',
                delay: Math.floor(Math.random() * 16)
            });
        }
    }

    addBulletImpact(x, y, rounds, weapon, hit) {
        this.playBulletImpactBurst(x, y, rounds, weapon, hit);
        const splatterRole = window.FxPacks && window.FxPacks.get
            ? window.FxPacks.get('impact_splatter') : null;
        if (!splatterRole || splatterRole.kind !== 'procedural') return;
        const eventSeed = ((Math.round(x * 16) * 73856093)
            ^ (Math.round(y * 16) * 19349663)
            ^ ((this._splatterSequence = (this._splatterSequence || 0) + 1) * 83492791)) >>> 0;
        this.playMaterialSplatter(x, y, splatterRole.profile, eventSeed);
    }
    
    addFire(x, y) { 
        this.add({ 
            x:x, y:y, 
            vx:(Math.random()-0.5)*1.5, 
            vy:-2-Math.random()*3, 
            color: (Math.random()>0.3) ? "#ff4400" : "#ffff00", 
            size: 4 + Math.random()*3, 
            life: 30+Math.random()*20, 
            type:'smoke'
        }); 
    }
    
    addUnitDebris(x, y) { }
    hexToInt(hex) { if (hex === undefined || hex === null) return 0xffffff; if (typeof hex === 'number') return hex; if (typeof hex !== 'string') return 0xffffff; return parseInt(hex.replace('#', '0x'), 16); }
}

class EnvSystem {
    constructor() { this.grassElements = []; this.treeElements = []; this.gustPower = 0; this.treeGust = 0; this.waveTime = 0; this.TOTAL_GRASS_FRAMES = 24; }
    preload(scene) {
        const TEXTURE_SCALE = 4.0; const canvasW = 64 * TEXTURE_SCALE * 1.8; const canvasH = 64 * TEXTURE_SCALE;
        const palettes = [0x4a5d23, 0x5b6e34, 0x3a4d13, 0x6c7a44, 0x554e33];
        if (!scene.textures.exists('hd_grass_0')) { const bladeDefsA = []; for(let i=0; i<45; i++) { bladeDefsA.push({ col: palettes[Math.floor(Math.random() * palettes.length)], startX: canvasW/2 + (Math.random()-0.5) * (canvasH * 0.15), len: (canvasH * 0.5) + Math.random() * (canvasH * 0.5), lean: (Math.random() - 0.5) * (canvasH * 0.9), ctrlOff: (Math.random() - 0.5) * (canvasH * 0.2) }); } this.generateGrassFrames(scene, 'hd_grass', bladeDefsA, canvasW, canvasH, TEXTURE_SCALE, 0.7); }
        if (!scene.textures.exists('hd_grass_b_0')) { const bladeDefsB = []; for(let i=0; i<55; i++) { bladeDefsB.push({ col: palettes[Math.floor(Math.random() * palettes.length)], startX: canvasW/2 + (Math.random()-0.5) * (canvasH * 0.6), len: (canvasH * 0.3) + Math.random() * (canvasH * 0.3), lean: (Math.random() - 0.5) * (canvasH * 1.5), ctrlOff: (Math.random() - 0.5) * (canvasH * 0.5) }); } this.generateGrassFrames(scene, 'hd_grass_b', bladeDefsB, canvasW, canvasH, TEXTURE_SCALE, 0.4); }
        // 森林は fir_tree スプライトシート（asset/environment/fir_tree.png）で描画。ベクター生成は廃止。
        if (!scene.textures.exists('rubble_chunk_0')) {
            const RSC = 2.0; // 瓦礫1つ1つのサイズ縮小（影・ひび割れ付き）
            const rubbleColors = [0x9a958c, 0x8c877e, 0xa29d94, 0x7e796e, 0xb0aaa0];
            const rubbleDark = 0x6a6558;
            const shadowColor = 0x2a2520;
            const crackColor = 0x4a4540;
            [0,1,2,3,4].forEach((idx) => {
                const g = scene.make.graphics({x:0,y:0,add:false});
                const w = (72 + idx * 16) * RSC;
                const h = (56 + idx * 14) * RSC;
                const cx = w * 0.5; const cy = h * 0.5;
                const shadowOffX = Math.max(2, RSC * 0.6); const shadowOffY = Math.max(3, RSC * 0.9);
                const drawShadow = () => {
                    g.fillStyle(shadowColor, 0.45);
                    g.fillEllipse(cx + shadowOffX, cy + shadowOffY, w * 0.5, h * 0.35);
                };
                const drawCracks = () => {
                    g.lineStyle(Math.max(0.8, RSC * 0.25), crackColor, 0.65);
                    const numCracks = 2 + (idx % 3);
                    for (let c = 0; c < numCracks; c++) {
                        const len = 0.15 + Math.random() * 0.25;
                        const ax = cx + (Math.random() - 0.5) * w * 0.6;
                        const ay = cy + (Math.random() - 0.5) * h * 0.6;
                        const ang = Math.random() * Math.PI * 2;
                        g.beginPath();
                        g.moveTo(ax, ay);
                        g.lineTo(ax + Math.cos(ang) * w * len, ay + Math.sin(ang) * h * len);
                        g.strokePath();
                    }
                };
                drawShadow();
                g.fillStyle(rubbleColors[idx % rubbleColors.length], 0.97);
                g.lineStyle(Math.max(1.5, RSC * 0.6), rubbleDark, 0.75);
                if (idx === 0 || idx === 1) {
                    const n = 6 + idx; const pts = [];
                    for (let i = 0; i < n; i++) {
                        const a = (i / n) * Math.PI * 2 + idx * 0.4;
                        const r = (0.35 + Math.random() * 0.35) * Math.min(w, h);
                        pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
                    }
                    g.beginPath(); g.moveTo(pts[0].x, pts[0].y);
                    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
                    g.closePath(); g.fillPath(); g.strokePath();
                    g.lineStyle(Math.max(0.8, RSC * 0.3), rubbleDark, 0.4);
                    g.beginPath(); g.moveTo(pts[0].x, pts[0].y); g.lineTo((pts[0].x + pts[Math.floor(n/2)].x)*0.5, (pts[0].y + pts[Math.floor(n/2)].y)*0.5); g.strokePath();
                    drawCracks();
                } else if (idx === 2) {
                    const bw = w * 0.88; const bh = h * 0.48;
                    g.beginPath();
                    g.moveTo(cx - bw/2, cy + bh/2);
                    g.lineTo(cx + bw/2 - w*0.08, cy + bh/2);
                    g.lineTo(cx + bw/2, cy + bh/2 - bh*0.35);
                    g.lineTo(cx + bw/2, cy - bh/2);
                    g.lineTo(cx - bw/2 + w*0.06, cy - bh/2);
                    g.lineTo(cx - bw/2, cy - bh/2 + bh*0.2);
                    g.closePath();
                    g.fillPath(); g.strokePath();
                    drawCracks();
                } else if (idx === 3) {
                    const bw = w * 0.7; const bh = h * 0.55;
                    const notch = bw * 0.25;
                    g.beginPath();
                    g.moveTo(cx - bw/2, cy - bh/2);
                    g.lineTo(cx + bw/2 - notch, cy - bh/2);
                    g.lineTo(cx + bw/2, cy - bh/2 + bh*0.2);
                    g.lineTo(cx + bw/2, cy + bh/2);
                    g.lineTo(cx - bw/2 + notch*0.5, cy + bh/2);
                    g.lineTo(cx - bw/2, cy + bh/2 - bh*0.15);
                    g.closePath();
                    g.fillPath(); g.strokePath();
                    drawCracks();
                } else {
                    const n = 8;
                    const pts = [];
                    for (let i = 0; i < n; i++) {
                        const a = (i / n) * Math.PI * 2 + 0.2;
                        const r = (0.38 + (i % 2) * 0.12 + Math.random() * 0.1) * Math.min(w, h);
                        pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
                    }
                    g.beginPath(); g.moveTo(pts[0].x, pts[0].y);
                    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
                    g.closePath(); g.fillPath(); g.strokePath();
                    drawCracks();
                }
                g.generateTexture(`rubble_chunk_${idx}`, w + 10, h + 12);
            });
        }
    }
    generateGrassFrames(scene, keyPrefix, bladeDefs, w, h, scale, windSens) { for (let frame = 0; frame < this.TOTAL_GRASS_FRAMES; frame++) { const g = scene.make.graphics({x:0, y:0, add:false}); g.fillStyle(0x2a331a, 0.8); g.fillEllipse(w/2, h, h/4, h/10); const bendFactor = frame / (this.TOTAL_GRASS_FRAMES - 1.0); for(let b of bladeDefs) { g.lineStyle(1.5 * scale, b.col, 1.0); const startX = b.startX; const startY = h; const windX = bendFactor * (h * windSens); const windY = Math.abs(windX) * 0.2; const endX = startX + b.lean + windX; const endY = startY - b.len + windY; const ctrlX = startX + (b.lean * 0.1) + (windX * 0.5) + b.ctrlOff; const ctrlY = startY - (b.len * 0.5); const curve = new Phaser.Curves.QuadraticBezier(new Phaser.Math.Vector2(startX, startY), new Phaser.Math.Vector2(ctrlX, ctrlY), new Phaser.Math.Vector2(endX, endY)); curve.draw(g); } g.generateTexture(`${keyPrefix}_${frame}`, w, h); } }
    clear() { this.grassElements = []; this.treeElements = []; }

    /** Stable per-hex roll for sparse decor (0 .. mod-1). */
    _hexDecorRoll(q, r, salt, mod) {
        let h = (q * 73856093) ^ (r * 19349663) ^ (salt * 50331653);
        h = ((h >> 16) ^ h) * 0x45d9f3b;
        h = ((h >> 16) ^ h) * 0x45d9f3b;
        h = (h >> 16) ^ h;
        return (h >>> 0) % mod;
    }

    spawnGrass(scene, group, x, y) {
        if (Math.random() > 0.33) return;
        const count = 60; const scaleFactor = 0.07;
        for(let i=0; i<count; i++) { const r = Math.random() * (HEX_SIZE * 1.0); const angle = Math.random() * Math.PI * 2; const ox = Math.cos(angle) * r; const oy = Math.sin(angle) * r * 0.866; const type = Math.random() > 0.5 ? 'A' : 'B'; const textureKey = type === 'A' ? 'hd_grass_0' : 'hd_grass_b_0'; const grass = scene.add.sprite(x+ox, y+oy, textureKey); grass.setOrigin(0.5, 1.0); const typeScale = type === 'A' ? 1.0 : 0.85; grass.setScale((0.8 + Math.random() * 0.4) * scaleFactor * typeScale); grass.setDepth(y+oy); grass.grassType = type; grass.currentWindValue = 0; grass.origX = x + ox; grass.origY = y + oy; grass.amp = 0.82 + Math.random() * 0.36; const tintVar = Math.floor(Math.random() * 40); grass.setTint(Phaser.Display.Color.GetColor(160 + tintVar, 170 + tintVar, 130 + tintVar)); group.add(grass); this.grassElements.push(grass); }
    }

    decorDepth(worldY, offset) {
        return 8 + (worldY + (offset || 0)) * 0.001;
    }

    /** v1 terrain: hd_grass blade clutter (replaces legacy grass.png hex overlay) */
    spawnGrassSparse(scene, group, x, y, q, r) {
        if (this._hexDecorRoll(q, r, 11, 3) !== 0) return;
        const count = 4 + this._hexDecorRoll(q, r, 17, 5);
        const scaleFactor = 0.1;
        for (let i = 0; i < count; i++) {
            const rad = Math.random() * (HEX_SIZE * 0.82);
            const angle = Math.random() * Math.PI * 2;
            const ox = Math.cos(angle) * rad;
            const oy = Math.sin(angle) * rad * 0.866;
            const type = Math.random() > 0.5 ? 'A' : 'B';
            const textureKey = type === 'A' ? 'hd_grass_0' : 'hd_grass_b_0';
            const grass = scene.add.sprite(x + ox, y + oy, textureKey);
            grass.setOrigin(0.5, 1.0);
            grass.setScale((0.85 + Math.random() * 0.4) * scaleFactor);
            grass.setDepth(this.decorDepth(y, oy));
            grass.grassType = type;
            grass.currentWindValue = 0;
            grass.origX = x + ox;
            grass.origY = y + oy;
            grass.amp = 0.82 + Math.random() * 0.36;
            const tintVar = Math.floor(Math.random() * 30);
            grass.setTint(Phaser.Display.Color.GetColor(150 + tintVar, 165 + tintVar, 120 + tintVar));
            if (group && group.add) group.add(grass);
            this.grassElements.push(grass);
        }
    }

    spawnTrees(scene, group, x, y) {
        const count = 4 + Math.floor(Math.random() * 3);
        const scaleFactor = 0.66;
        const FIR_FRAMES_WEAK = 16;
        const FIR_FRAMES_STRONG = 16;
        for (let i = 0; i < count; i++) {
            const r = Math.random() * (HEX_SIZE * 0.85);
            const angle = Math.random() * Math.PI * 2;
            const ox = Math.cos(angle) * r;
            const oy = Math.sin(angle) * r * 0.866;
            const scaleBase = (0.7 + Math.random() * 0.6) * scaleFactor;
            const scaleX = scaleBase * (0.92 + Math.random() * 0.16);
            const scaleY = scaleBase * (0.88 + Math.random() * 0.24);
            const shadow = scene.add.ellipse(x + ox, y + oy + 3, 40 * scaleBase, 15 * scaleBase, 0x000000, 0.5);
            group.add(shadow);
            const treeContainer = scene.add.container(x + ox, y + oy);
            treeContainer.setDepth(y + oy + 20);
            const firSprite = scene.add.sprite(0, 0, 'fir_tree', Math.floor(Math.random() * FIR_FRAMES_WEAK)).setOrigin(0.5, 0.95);
            firSprite.setScale(scaleX, scaleY);
            const tintR = 0xc0 + Math.floor(Math.random() * 0x30);
            const tintG = 0xd8 + Math.floor(Math.random() * 0x28);
            const tintB = 0xb0 + Math.floor(Math.random() * 0x40);
            firSprite.setTint(Phaser.Display.Color.GetColor(tintR, tintG, tintB));
            treeContainer.add(firSprite);
            treeContainer.firSprite = firSprite;
            treeContainer.currentSkew = 0;
            treeContainer.origX = x + ox;
            treeContainer.origY = y + oy;
            treeContainer.swayOffset = (Math.random() - 0.5) * Math.PI * 0.6;
            treeContainer.amp = 0.88 + Math.random() * 0.24;
            treeContainer.frameOffset = Math.floor(Math.random() * FIR_FRAMES_WEAK);
            group.add(treeContainer);
            this.treeElements.push(treeContainer);
        }
    }

    /** v1 terrain: trees on forest hexes */
    spawnTreesSparse(scene, group, x, y, q, r) {
        const count = 2 + this._hexDecorRoll(q, r, 31, 2);
        const scaleFactor = 0.78;
        const FIR_FRAMES_WEAK = 16;
        for (let i = 0; i < count; i++) {
            const rad = Math.random() * (HEX_SIZE * 0.72);
            const angle = Math.random() * Math.PI * 2;
            const ox = Math.cos(angle) * rad;
            const oy = Math.sin(angle) * rad * 0.866;
            const scaleBase = (0.65 + Math.random() * 0.45) * scaleFactor;
            const depth = this.decorDepth(y, oy);
            const shadow = scene.add.ellipse(x + ox, y + oy + 3, 36 * scaleBase, 13 * scaleBase, 0x000000, 0.45);
            shadow.setDepth(depth - 0.001);
            const treeContainer = scene.add.container(x + ox, y + oy);
            treeContainer.setDepth(depth);
            const firSprite = scene.add.sprite(0, 0, 'fir_tree', Math.floor(Math.random() * FIR_FRAMES_WEAK)).setOrigin(0.5, 0.95);
            firSprite.setScale(scaleBase);
            const tintR = 0xc0 + Math.floor(Math.random() * 0x28);
            const tintG = 0xd0 + Math.floor(Math.random() * 0x28);
            const tintB = 0xb0 + Math.floor(Math.random() * 0x38);
            firSprite.setTint(Phaser.Display.Color.GetColor(tintR, tintG, tintB));
            treeContainer.add(firSprite);
            treeContainer.firSprite = firSprite;
            treeContainer.currentSkew = 0;
            treeContainer.origX = x + ox;
            treeContainer.origY = y + oy;
            treeContainer.swayOffset = (Math.random() - 0.5) * Math.PI * 0.5;
            treeContainer.amp = 0.88 + Math.random() * 0.2;
            treeContainer.frameOffset = Math.floor(Math.random() * FIR_FRAMES_WEAK);
            if (group && group.add) {
                group.add(shadow);
                group.add(treeContainer);
            }
            this.treeElements.push(treeContainer);
        }
    }

    spawnRubble(scene, x, y, decorGroup, rubbleFrontGroup) {
        const countBack = 6 + Math.floor(Math.random() * 4);
        const countFront = 6 + Math.floor(Math.random() * 4);
        const scaleMin = 0.08; const scaleRange = 0.11;
        const rubbleScale = 0.58;
        for (let i = 0; i < countBack; i++) {
            const r = Math.random() * (HEX_SIZE * 0.9); const angle = Math.random() * Math.PI * 2;
            const ox = Math.cos(angle) * r; const oy = Math.sin(angle) * r * 0.866;
            const key = `rubble_chunk_${i % 5}`;
            const chunk = scene.add.image(x + ox, y + oy, key).setOrigin(0.5, 0.5);
            chunk.setScale((scaleMin + Math.random() * scaleRange) * rubbleScale); chunk.setAngle((Math.random() - 0.5) * 55);
            chunk.setDepth(0.5 + (y + oy) * 0.0001 + i * 0.0001);
            chunk.setTint(Phaser.Display.Color.GetColor(130 + Math.floor(Math.random() * 45), 125 + Math.floor(Math.random() * 40), 110 + Math.floor(Math.random() * 35)));
            decorGroup.add(chunk);
        }
        for (let i = 0; i < countFront; i++) {
            const r = Math.random() * (HEX_SIZE * 0.9); const angle = Math.random() * Math.PI * 2;
            const ox = Math.cos(angle) * r; const oy = Math.sin(angle) * r * 0.866;
            const key = `rubble_chunk_${i % 5}`;
            const chunk = scene.add.image(x + ox, y + oy, key).setOrigin(0.5, 0.5);
            chunk.setScale((scaleMin + Math.random() * scaleRange) * rubbleScale); chunk.setAngle((Math.random() - 0.5) * 60);
            chunk.setDepth(1.5 + (y + oy) * 0.0001 + (countBack + i) * 0.0001);
            chunk.setTint(Phaser.Display.Color.GetColor(125 + Math.floor(Math.random() * 50), 120 + Math.floor(Math.random() * 45), 105 + Math.floor(Math.random() * 40)));
            rubbleFrontGroup.add(chunk);
        }
    }
    registerWater(image, y, q, r, group) { if (!image.scene) return; image.scene.tweens.add({ targets: image, alpha: { from: 0.85, to: 1.0 }, y: '+=3', scaleX: { from: 1.0/window.HIGH_RES_SCALE, to: 1.02/window.HIGH_RES_SCALE }, duration: 1500 + Math.random() * 1000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }); }
    onGust() { this.gustPower = 1.0; }
    update(time) {
        // 風向き統一: wavePhase の sin が正のとき「風が右向き」= 草は右に曲がり・樹木は右に傾く（同一方向）
        this.waveTime += 0.018;
        const t = this.waveTime;
        this.gustPower *= 0.98;
        if (this.gustPower < 0.01) this.gustPower = 0;
        this.treeGust += (this.gustPower - this.treeGust) * 0.045;
        const windBase = t * 1.0;
        const windSpreadX = 0.012;
        const windSpreadY = 0.006;

        this.grassElements = this.grassElements.filter(g => g.scene);
        for (let i = 0; i < this.grassElements.length; i++) {
            const g = this.grassElements[i];
            if (!g.active) continue;
            g.visible = true;
            const wavePhase = windBase - g.origX * windSpreadX - g.origY * windSpreadY;
            const bigWave = (Math.sin(wavePhase) + 1.0) * 0.5;
            const ripple = Math.sin(wavePhase * 2.5) * 0.05;
            const gust = this.gustPower * 0.6;
            let targetWindValue = ((bigWave * 0.4) + 0.1 + ripple + gust) * (g.amp !== undefined ? g.amp : 1);
            targetWindValue = Math.max(0, Math.min(1.0, targetWindValue));
            const stiffness = 0.06;
            g.currentWindValue += (targetWindValue - g.currentWindValue) * stiffness;
            const maxFrames = this.TOTAL_GRASS_FRAMES - 1;
            const floatFrame = g.currentWindValue * maxFrames;
            const frameIdx = Math.floor(floatFrame);
            const prefix = (g.grassType === 'B') ? 'hd_grass_b_' : 'hd_grass_';
            const safeFrame = Phaser.Math.Clamp(frameIdx, 0, maxFrames);
            const textureKey = `${prefix}${safeFrame}`;
            if (g.lastTextureKey !== textureKey && g.scene && g.scene.textures.exists(textureKey)) {
                g.setTexture(textureKey);
                g.lastTextureKey = textureKey;
            }
            const remainder = floatFrame - frameIdx;
            if (typeof g.skewX === 'number') g.skewX = remainder * 0.05;
        }

        this.treeElements = this.treeElements.filter(tr => tr.scene);
        const FIR_FRAMES_WEAK = 16;
        const strongWind = this.treeGust > 0.35;
        const frameBase = strongWind ? 16 : 0;
        for (let i = 0; i < this.treeElements.length; i++) {
            const tr = this.treeElements[i];
            if (!tr.active) continue;
            tr.visible = true;
            const wavePhase = windBase - tr.origX * windSpreadX - tr.origY * windSpreadY + tr.swayOffset;
            const amp = (tr.amp !== undefined ? tr.amp : 1);
            const mainSway = Math.sin(wavePhase) * 0.028 * amp;
            const subSway = Math.sin(wavePhase * 1.6 + 1.2) * 0.01 * amp;
            const gust = this.treeGust * 0.1 * amp;
            const targetSkew = mainSway + subSway + gust;
            const stiffness = 0.018;
            tr.currentSkew += (targetSkew - tr.currentSkew) * stiffness;
            if (tr.firSprite && tr.firSprite.active) {
                if (typeof tr.firSprite.skewX === 'number') tr.firSprite.skewX = tr.currentSkew * 0.5;
                const framePhase = (wavePhase * 0.4 + (tr.frameOffset || 0) / FIR_FRAMES_WEAK * Math.PI * 2) % 1;
                const subFrame = (Math.floor(framePhase * FIR_FRAMES_WEAK) + (tr.frameOffset || 0)) % FIR_FRAMES_WEAK;
                const targetFrame = Phaser.Math.Clamp(frameBase + subFrame, 0, 31);
                if (tr.firSprite.lastFrame !== targetFrame) {
                    tr.firSprite.setFrame(targetFrame);
                    tr.firSprite.lastFrame = targetFrame;
                }
            }
        }
    }
}

window.VFX = new VFXSystem();
window.EnvSystem = new EnvSystem();

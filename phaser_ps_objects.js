'use strict';

/**
 * PS OBJECT LAYER — 建物・木・柵・低木を「生きたスプライト」として持つ層。
 *
 * 背景PNGへ焼き込むのは地表と低層デコーだけ。立体物は
 * `scripts/gen_ps_seed_map.py` が出す台帳(ps_objects/v1)からここで生成する。
 * 分離する理由は2つ:
 *   1. 破壊状態の差し替え。PSのSSCは本体の状態列(無傷→破壊)を内包していて、
 *      建物は4〜6段階、植物/低木は slot1 の倒伏地表版を持つ。焼き込んでいると
 *      個体を差し替えられない。
 *   2. 着弾痕デカール(depth -9990)を樹冠の下に潜らせる。焼き込みだとクレーターが
 *      木の上に乗ってしまう。
 *
 * 深度規約: 立体本体は `depth = world Y`。ユニット(phaser_unit.js は
 * `container.y`、phaser_soldier_view.js は `y - 0.6`)と同じ規約なので、
 * 兵士と建物が screen Y で正しく前後する。影は全て -9980 固定(デカールより上、
 * 立体本体より下)。
 *
 * 貼付規約は正本レンダラと同じ: left = x + ox, top = y + oy（キャンバス画素）。
 */
window.PsObjectLayer = {
  /** asset/environment/ps_objects/manifest.json（preloadで読む） */
  manifest: null,
  /**
   * Optional asset/environment/raised_hd/manifest.json.
   * A manifest.js may instead assign window.RAISED_HD_MANIFEST.
   */
  hdManifest: null,
  /**
   * Optional map-priority tree HD manifest. It is resolved after raised_hd so
   * non-tree overrides keep their existing priority and fallback behavior.
   */
  treeHdManifest: null,

  CANONICAL_BASE_PATH: 'asset/environment/ps_objects/',
  HD_BASE_PATH: 'asset/environment/raised_hd/',
  TREE_HD_BASE_PATH: 'asset/environment/trees_hd/production/',
  HD_PIXEL_RATIO: 2,
  // Production PS battlefields opt into this so a lone low-resolution source
  // can never break the smooth HD art direction. Missing HD pieces are skipped.
  HD_ONLY: false,
  TREE_SWAY: {
    angleDeg: 0.42,
    scaleX: 0.0035,
    durationMs: 4200
  },

  SHADOW_DEPTH: -9980,
  // The ground image lives inside hexGroup(depth 0). A root-level object with
  // depth -9980 is therefore still behind the whole layer and cannot be seen.
  // Keep every ground shadow in one root layer above map/decor, below bodies.
  SHADOW_LAYER_DEPTH: 8.5,

  _scene: null,
  _proj: null,
  _shadowLayer: null,
  _objects: [],
  _byHex: null,
  _linearFilteredKeys: null,

  /** 台帳のキャンバス座標 -> ワールド座標 */
  _toWorld(px, py) {
    return {
      x: this._proj.topLeftX + px * this._proj.scale,
      y: this._proj.topLeftY + py * this._proj.scale
    };
  },

  _spriteKey(asset, slot) { return 'pso_' + asset + '_s' + slot; },

  _meta(asset, slot) {
    if (!this.manifest || !this.manifest.sprites) return null;
    return this.manifest.sprites[asset + '_s' + slot] || null;
  },

  _hdSpriteKey(asset, slot) { return 'pso_hd_' + asset + '_s' + slot; },

  _activeHdManifest() {
    if (this.hdManifest) return this.hdManifest;
    if (typeof window !== 'undefined' && window.RAISED_HD_MANIFEST) {
      return window.RAISED_HD_MANIFEST;
    }
    return null;
  },

  _activeTreeHdManifest() {
    if (this.treeHdManifest) return this.treeHdManifest;
    if (typeof window !== 'undefined' && window.TREE_HD_PS_MANIFEST) {
      return window.TREE_HD_PS_MANIFEST;
    }
    return null;
  },

  _activeHdSources() {
    const sources = [];
    const raised = this._activeHdManifest();
    const trees = this._activeTreeHdManifest();
    if (raised) {
      sources.push({ manifest: raised, root: this.HD_BASE_PATH });
    }
    if (trees && trees !== raised) {
      sources.push({ manifest: trees, root: this.TREE_HD_BASE_PATH });
    }
    return sources;
  },

  /**
   * Return a valid 2x HD record, or null so this single slot falls back to PS.
   * HD canvases are exact 2x reconstructions, therefore their offsets remain
   * PS-logical values and must match the canonical origin.
   */
  _hdMeta(asset, slot) {
    const canonical = this._meta(asset, slot);
    if (!canonical) return null;

    const sources = this._activeHdSources();
    for (let index = 0; index < sources.length; index++) {
      const source = sources[index];
      const manifest = source.manifest;
      if (!manifest || !manifest.sprites) continue;

      const meta = manifest.sprites[asset + '_s' + slot];
      if (!meta || typeof meta.file !== 'string' || !meta.file.trim()) continue;

      const pixelRatio = meta.pixelRatio ?? manifest.pixelRatio;
      if (pixelRatio !== this.HD_PIXEL_RATIO) continue;
      if (!Number.isFinite(meta.ox) || !Number.isFinite(meta.oy)) continue;
      if (meta.ox !== canonical.ox || meta.oy !== canonical.oy) continue;

      return {
        file: meta.file,
        ox: meta.ox,
        oy: meta.oy,
        pixelRatio: pixelRatio,
        kind: meta.kind || null,
        family: meta.family || null,
        _manifest: manifest,
        _root: source.root
      };
    }
    return null;
  },

  _hdPath(file, manifest, root) {
    manifest = manifest || {};
    const value = String(file || '').replace(/\\/g, '/');
    if (/^(?:[a-z]+:)?\/\//i.test(value) || value.startsWith('/')
        || value.startsWith('asset/')) {
      return value;
    }

    let base = String(manifest.basePath || '').replace(/\\/g, '/');
    if (/^(?:[a-z]+:)?\/\//i.test(base) || base.startsWith('/')
        || base.startsWith('asset/')) {
      return base.replace(/\/?$/, '/') + value.replace(/^\.\//, '');
    }
    base = base.replace(/^\.\//, '').replace(/^\/+|\/+$/g, '');
    const relative = [base, value.replace(/^\.\//, '')].filter(Boolean).join('/');
    return (root || this.HD_BASE_PATH) + relative;
  },

  _resolvedSprite(asset, slot) {
    const canonical = this._meta(asset, slot);
    if (!canonical) return null;

    const hd = this._hdMeta(asset, slot);
    if (hd) {
      return {
        key: this._hdSpriteKey(asset, slot),
        file: hd.file,
        path: this._hdPath(hd.file, hd._manifest, hd._root),
        meta: hd,
        pixelRatio: hd.pixelRatio,
        hd: true
      };
    }
    if (this.HD_ONLY) return null;
    return {
      key: this._spriteKey(asset, slot),
      file: canonical.file,
      meta: canonical,
      pixelRatio: 1,
      hd: false
    };
  },

  /** この台帳が必要とするスプライトのキー/ファイルを列挙（遅延ロード用） */
  requiredSprites(ledger) {
    const out = [];
    const seen = new Set();
    const add = (asset, slot) => {
      if (slot === null || slot === undefined) return;
      const id = asset + '_s' + slot;
      if (seen.has(id)) return;
      const sprite = this._resolvedSprite(asset, slot);
      if (!sprite) return;
      seen.add(id);
      if (sprite.hd) {
        out.push({ key: sprite.key, file: sprite.file, path: sprite.path });
      } else {
        // Preserve the legacy requiredSprites() item shape for PS fallbacks.
        out.push({ key: sprite.key, file: sprite.file });
      }
    };
    (ledger.objects || []).forEach(o => {
      add(o.asset, o.body_slot);
      add(o.asset, o.shadow_slot);
      if (o.states) {
        (o.states.body || []).forEach(s => add(o.asset, s));
        (o.states.shadow || []).forEach(s => add(o.asset, s));
      }
      ['body_slots', 'shadow_slots', 'crushed_slots', 'crushed_shadow_slots'].forEach(k => {
        (o[k] || []).forEach(s => add(o.asset, s));
      });
    });
    return out;
  },

  /** 1スロット分のスプライトを置く。失敗したら null。 */
  _applyTreeSway(img, px, py, baseScale) {
    if (!this._scene || !this._scene.tweens || !img) return;
    const sway = this.TREE_SWAY;
    const hash = (
      Math.imul(Math.round(px * 16), 73856093) ^
      Math.imul(Math.round(py * 16), 19349663)
    ) >>> 0;
    const direction = (hash & 1) === 0 ? 1 : -1;
    const duration = sway.durationMs * (0.92 + ((hash % 17) / 100));
    this._scene.tweens.add({
      targets: img,
      angle: {
        from: -sway.angleDeg * direction,
        to: sway.angleDeg * direction
      },
      scaleX: {
        from: baseScale * (1 - sway.scaleX),
        to: baseScale * (1 + sway.scaleX)
      },
      scaleY: baseScale,
      duration: duration,
      delay: (hash >>> 8) % Math.max(1, Math.round(sway.durationMs)),
      ease: 'Sine.inOut',
      yoyo: true,
      repeat: -1
    });
  },

  _place(asset, slot, px, py, depth, options) {
    const sprite = this._resolvedSprite(asset, slot);
    if (!sprite) return null;
    if (!this._scene.textures.exists(sprite.key)) return null;

    // HD cut-outs are commonly displayed below their source resolution. Force
    // linear filtering once per texture so their edges match the smooth soldier
    // sheets instead of acquiring nearest-neighbour stair steps while zooming.
    if (!this._linearFilteredKeys) this._linearFilteredKeys = new Set();
    if (!this._linearFilteredKeys.has(sprite.key) && this._scene.textures.get) {
      const texture = this._scene.textures.get(sprite.key);
      if (texture && texture.setFilter && window.Phaser && Phaser.Textures) {
        texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
      }
      this._linearFilteredKeys.add(sprite.key);
    }

    const baseScale = this._proj.scale / sprite.pixelRatio;
    const canonical = this._meta(asset, slot);
    const shouldSway = !!(
      options && options.sway &&
      sprite.hd &&
      sprite.meta.kind === 'body' &&
      sprite.meta.family === 'tree' &&
      canonical &&
      Number.isFinite(canonical.w) && canonical.w > 0 &&
      Number.isFinite(canonical.h) && canonical.h > 0
    );
    let img;
    if (shouldSway) {
      const root = this._toWorld(px, py);
      img = this._scene.add.image(root.x, root.y, sprite.key)
        .setOrigin(
          -canonical.ox / canonical.w,
          -canonical.oy / canonical.h
        )
        .setScale(baseScale)
        .setDepth(depth);
      this._applyTreeSway(img, px, py, baseScale);
    } else {
      const w = this._toWorld(px + sprite.meta.ox, py + sprite.meta.oy);
      img = this._scene.add.image(w.x, w.y, sprite.key)
        .setOrigin(0, 0)
        .setScale(baseScale)
        .setDepth(depth);
    }
    if (this._shadowLayer && depth <= this.SHADOW_DEPTH + 1 && this._shadowLayer.add) {
      this._shadowLayer.add(img);
    }
    return img;
  },

  /** Add the shared alpha-space sun projection for every live body sprite. */
  _ensureAlphaShadow(inst) {
    if (!inst || !inst.bodies.length || !this._scene) return;
    inst.bodies.forEach(body => {
      if (!body || (body.depth != null && body.depth <= this.SHADOW_DEPTH + 1)) return;
      if (window.AlphaLightSpace && window.AlphaLightSpace.createSunShadow) {
        const family = inst.spec && inst.spec.family;
        const isBuilding = family === 'building';
        const isTree = family === 'tree';
        const shadow = window.AlphaLightSpace.createSunShadow(this._scene, body, {
          depth: this.SHADOW_DEPTH + 0.2,
          castScale: isBuilding ? 0.40 : (isTree ? 0.36 : 0.27),
          flatten: isBuilding ? 0.25 : (isTree ? 0.27 : 0.31),
          widthScale: isBuilding ? 1.08 : 1.04,
          alpha: isBuilding ? 0.44 : (isTree ? 0.39 : 0.34),
        });
        if (shadow) {
          shadow._generatedAlphaShadow = true;
          if (this._shadowLayer && this._shadowLayer.add) this._shadowLayer.add(shadow);
          inst.shadows.push(shadow);
        }
        return;
      }
      // Compatibility fallback when the shared lighting module is not loaded.
      if (inst.shadows.length) return;
      const key = body.texture && body.texture.key ? body.texture.key : body.key;
      if (!key) return;
      const frame = body.frame && body.frame.name != null ? body.frame.name : undefined;
      const height = Math.abs(body.displayHeight || 0);
      const originX = body.originX != null ? body.originX : 0;
      const originY = body.originY != null ? body.originY : 0;
      const sx = body.scaleX != null ? body.scaleX : (body.scale != null ? body.scale : 1);
      const sy = body.scaleY != null ? body.scaleY : (body.scale != null ? body.scale : 1);
      const shadowH = height * 0.24;
      const baseY = body.y + height * (1 - originY);
      const shadowY = height ? baseY - shadowH * (1 - originY) : body.y + 6 * this._proj.scale;
      const shadow = this._scene.add.image(body.x + 8 * this._proj.scale, shadowY, key, frame);
      if (shadow.setOrigin) shadow.setOrigin(originX, originY);
      if (shadow.setScale) shadow.setScale(sx * 1.08, sy * 0.24);
      if (shadow.setFlip) shadow.setFlip(body.flipX, body.flipY);
      if (shadow.setTint) shadow.setTint(0x11120e);
      if (shadow.setAlpha) shadow.setAlpha(0.32);
      if (shadow.setDepth) shadow.setDepth(this.SHADOW_DEPTH);
      shadow._generatedAlphaShadow = true;
      if (this._shadowLayer && this._shadowLayer.add) this._shadowLayer.add(shadow);
      inst.shadows.push(shadow);
    });
  },

  /**
   * 台帳から立体物を生成する。
   * @param {Phaser.Scene} scene
   * @param {Object} ledger ps_objects/v1
   * @param {{scale:number, topLeftX:number, topLeftY:number}} projection 背景と共有
   */
  build(scene, ledger, projection) {
    this.clear();
    if (!scene || !ledger || !projection || !this.manifest) return 0;

    this._scene = scene;
    this._proj = projection;
    this._byHex = new Map();
    if (scene.add && scene.add.layer) {
      this._shadowLayer = scene.add.layer();
      if (this._shadowLayer.setDepth) this._shadowLayer.setDepth(this.SHADOW_LAYER_DEPTH);
      this._shadowLayer._psGroundShadowLayer = true;
    }

    (ledger.objects || []).forEach(spec => {
      const world = this._toWorld(spec.x, spec.y);
      const inst = {
        spec: spec,
        stateIndex: 0,          // 破壊段階。0 = 無傷
        worldX: world.x,
        worldY: world.y,
        bodies: [],
        shadows: []
      };

      if (spec.composite) {
        // 柵: 支柱＋半柵の重ね合わせ。1個体として状態を持つ。
        (spec.shadow_slots || []).forEach(s => {
          const img = this._place(spec.asset, s, spec.x, spec.y, this.SHADOW_DEPTH);
          if (img) inst.shadows.push(img);
        });
        (spec.body_slots || []).forEach(s => {
          const img = this._place(
            spec.asset,
            s,
            spec.x,
            spec.y,
            world.y,
            { sway: spec.family === 'tree' }
          );
          if (img) inst.bodies.push(img);
        });
      } else {
        if (spec.shadow_slot !== null && spec.shadow_slot !== undefined) {
          const img = this._place(spec.asset, spec.shadow_slot, spec.x, spec.y, this.SHADOW_DEPTH);
          if (img) inst.shadows.push(img);
        }
        const img = this._place(
          spec.asset,
          spec.body_slot,
          spec.x,
          spec.y,
          world.y,
          { sway: spec.family === 'tree' }
        );
        if (img) inst.bodies.push(img);
      }

      if (!inst.bodies.length) return; // 描けなかったものは登録しない
      this._ensureAlphaShadow(inst);
      this._objects.push(inst);

      if (spec.hex) {
        const k = spec.hex[0] + ',' + spec.hex[1];
        if (!this._byHex.has(k)) this._byHex.set(k, []);
        this._byHex.get(k).push(inst);
      }
    });

    return this._objects.length;
  },

  _lightOccluded(lightX, lightY, target) {
    const tx = target.worldX, ty = target.worldY;
    const vx = tx - lightX, vy = ty - lightY;
    const len2 = vx * vx + vy * vy;
    if (len2 < 1) return false;
    return this._objects.some(blocker => {
      if (blocker === target || !blocker.bodies.length) return false;
      const family = blocker.spec && blocker.spec.family;
      if (family !== 'building' && family !== 'fence' && family !== 'large_prop') return false;
      const wx = blocker.worldX - lightX, wy = blocker.worldY - lightY;
      const t = (wx * vx + wy * vy) / len2;
      if (t <= 0.08 || t >= 0.92) return false;
      const px = lightX + vx * t, py = lightY + vy * t;
      return Math.hypot(blocker.worldX - px, blocker.worldY - py) < 24;
    });
  },

  /** 物体PNGのアルファを2pxずらし、発砲点側だけに短い暖色の縁を作る。 */
  flashMuzzleLight(lightX, lightY, radius) {
    if (!this._scene || !this._scene.tweens) return;
    this._objects.forEach(inst => {
      const dist = Math.hypot(lightX - inst.worldX, lightY - inst.worldY);
      if (dist > radius || this._lightOccluded(lightX, lightY, inst)) return;
      if (window.AlphaLightSpace && window.AlphaLightSpace.flashAlpha) {
        inst.bodies.forEach(body => {
          window.AlphaLightSpace.flashAlpha(
            this._scene, body, lightX, lightY, radius,
            {
              worldX: inst.worldX,
              worldY: inst.worldY,
              shadowDepth: this.SHADOW_DEPTH + 0.3,
              shadowLayer: this._shadowLayer,
              rimDepth: body.depth + 0.02,
            }
          );
        });
        return;
      }
      const gain = 1 - dist / Math.max(1, radius);
      const inv = dist > 1 ? 1 / dist : 0;
      const offX = (lightX - inst.worldX) * inv * 2.4;
      const offY = (lightY - inst.worldY) * inv * 2.4;
      inst.bodies.forEach(body => {
        if (!body || !body.texture || !body.frame) return;
        const rim = this._scene.add.image(body.x + offX, body.y + offY, body.texture.key, body.frame.name);
        rim.setOrigin(body.originX, body.originY);
        rim.setScale(body.scaleX, body.scaleY);
        rim.setFlip(body.flipX, body.flipY);
        rim.setRotation(body.rotation);
        rim.setTint(0xffa65a);
        rim.setAlpha(0.08 + gain * 0.20);
        rim.setDepth(body.depth - 0.01);
        if (typeof Phaser !== 'undefined' && Phaser.BlendModes) rim.setBlendMode(Phaser.BlendModes.ADD);
        this._scene.tweens.add({
          targets: rim, alpha: 0, duration: 82, ease: 'Cubic.out',
          onComplete: () => { if (rim.active) rim.destroy(); }
        });
      });
    });
  },

  clear() {
    this._objects.forEach(inst => {
      inst.bodies.forEach(i => i.destroy());
      inst.shadows.forEach(i => i.destroy());
    });
    if (this._shadowLayer) {
      try { this._shadowLayer.destroy(); } catch (e) { }
    }
    this._objects = [];
    this._byHex = null;
    this._shadowLayer = null;
    this._scene = null;
    this._proj = null;
  },

  count() { return this._objects.length; },

  /** その個体がまだ壊れられるか（段階が残っているか） */
  _maxState(inst) {
    const spec = inst.spec;
    if (spec.composite) return (spec.crushed_slots && spec.crushed_slots.length) ? 1 : 0;
    if (spec.states && spec.states.body) return spec.states.body.length - 1;
    return 0;
  },

  /**
   * 1個体を1段階破壊する。差し替えたら true。
   * 木のように状態列を持たないものは false（PS実機でも木は倒伏対象外）。
   */
  damageObject(inst) {
    const spec = inst.spec;
    const max = this._maxState(inst);
    if (inst.stateIndex >= max) return false;
    inst.stateIndex++;

    inst.bodies.forEach(i => i.destroy());
    inst.shadows.forEach(i => i.destroy());
    inst.bodies = [];
    inst.shadows = [];

    if (spec.composite) {
      // 柵は圧壊スロット列へ丸ごと差し替え
      (spec.crushed_shadow_slots || []).forEach(s => {
        const img = this._place(spec.asset, s, spec.x, spec.y, this.SHADOW_DEPTH);
        if (img) inst.shadows.push(img);
      });
      (spec.crushed_slots || []).forEach(s => {
        const img = this._place(
          spec.asset,
          s,
          spec.x,
          spec.y,
          inst.worldY,
          { sway: spec.family === 'tree' }
        );
        if (img) inst.bodies.push(img);
      });
    } else {
      const bodySlot = spec.states.body[inst.stateIndex];
      const shadowSlot = (spec.states.shadow || [])[inst.stateIndex];
      if (shadowSlot !== null && shadowSlot !== undefined) {
        const img = this._place(spec.asset, shadowSlot, spec.x, spec.y, this.SHADOW_DEPTH);
        if (img) inst.shadows.push(img);
      }
      // 倒伏した植物(slot1)は地表版。デカールと同じ高さへ寝かせる。
      const flattened = spec.states.body[inst.stateIndex] === 1;
      const depth = flattened ? this.SHADOW_DEPTH + 1 : inst.worldY;
      const img = this._place(
        spec.asset,
        bodySlot,
        spec.x,
        spec.y,
        depth,
        { sway: spec.family === 'tree' && !flattened }
      );
      if (img) inst.bodies.push(img);
    }
    this._ensureAlphaShadow(inst);
    return true;
  },

  /**
   * ワールド座標の周囲を破壊する（着弾）。
   * @param {number} worldX
   * @param {number} worldY
   * @param {number} radius ワールドpx
   * @param {number} severity 1段階=1。大口径ほど大きく
   * @returns {number} 実際に段階が進んだ個体数
   */
  damageAt(worldX, worldY, radius, severity) {
    if (!this._objects.length) return 0;
    const steps = Math.max(1, severity || 1);
    let changed = 0;
    this._objects.forEach(inst => {
      const dx = inst.worldX - worldX;
      const dy = inst.worldY - worldY;
      if (dx * dx + dy * dy > radius * radius) return;
      for (let i = 0; i < steps; i++) {
        if (!this.damageObject(inst)) break;
      }
      changed++;
    });
    return changed;
  },

  /** 指定ヘックスの建物だけを1段階壊す（砲撃の直撃判定用） */
  damageBuildingInHex(q, r) {
    if (!this._byHex) return false;
    const list = this._byHex.get(q + ',' + r) || [];
    let hit = false;
    list.forEach(inst => {
      if (inst.spec.family === 'building' && this.damageObject(inst)) hit = true;
    });
    return hit;
  }
};

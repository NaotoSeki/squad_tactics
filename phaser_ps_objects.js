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

  SHADOW_DEPTH: -9980,

  _scene: null,
  _proj: null,
  _objects: [],
  _byHex: null,

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

  /** この台帳が必要とするスプライトのキー/ファイルを列挙（遅延ロード用） */
  requiredSprites(ledger) {
    const out = [];
    const seen = new Set();
    const add = (asset, slot) => {
      if (slot === null || slot === undefined) return;
      const id = asset + '_s' + slot;
      if (seen.has(id)) return;
      const meta = this._meta(asset, slot);
      if (!meta) return;
      seen.add(id);
      out.push({ key: this._spriteKey(asset, slot), file: meta.file });
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
  _place(asset, slot, px, py, depth) {
    const meta = this._meta(asset, slot);
    if (!meta) return null;
    const key = this._spriteKey(asset, slot);
    if (!this._scene.textures.exists(key)) return null;

    const w = this._toWorld(px + meta.ox, py + meta.oy);
    const img = this._scene.add.image(w.x, w.y, key)
      .setOrigin(0, 0)
      .setScale(this._proj.scale)
      .setDepth(depth);
    return img;
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
          const img = this._place(spec.asset, s, spec.x, spec.y, world.y);
          if (img) inst.bodies.push(img);
        });
      } else {
        if (spec.shadow_slot !== null && spec.shadow_slot !== undefined) {
          const img = this._place(spec.asset, spec.shadow_slot, spec.x, spec.y, this.SHADOW_DEPTH);
          if (img) inst.shadows.push(img);
        }
        const img = this._place(spec.asset, spec.body_slot, spec.x, spec.y, world.y);
        if (img) inst.bodies.push(img);
      }

      if (!inst.bodies.length) return; // 描けなかったものは登録しない
      this._objects.push(inst);

      if (spec.hex) {
        const k = spec.hex[0] + ',' + spec.hex[1];
        if (!this._byHex.has(k)) this._byHex.set(k, []);
        this._byHex.get(k).push(inst);
      }
    });

    return this._objects.length;
  },

  clear() {
    this._objects.forEach(inst => {
      inst.bodies.forEach(i => i.destroy());
      inst.shadows.forEach(i => i.destroy());
    });
    this._objects = [];
    this._byHex = null;
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
        const img = this._place(spec.asset, s, spec.x, spec.y, inst.worldY);
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
      const img = this._place(spec.asset, bodySlot, spec.x, spec.y, depth);
      if (img) inst.bodies.push(img);
    }
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

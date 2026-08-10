/**
 * sim_scene.js -- WS-D: Phaser product view for sim_core (NORTH_STAR §7.1, SPEC §15).
 *
 * A NEW Phaser scene that renders sim_core using existing assets (phaser_vfx VFX,
 * soldier_crawl sprites). Does NOT touch index.html / phaser_bridge MainScene
 * This is the standalone RTwP simulation scene used by the product adapter.
 *
 * Core discipline (SPEC §15.2): the sim runs at a FIXED 10Hz timestep inside
 * Phaser's 60fps update via an accumulator; sprites LERP toward hex positions so
 * 10Hz movement looks smooth. The sim never waits for rendering.
 */

const SIM_HEX_SIZE = 44; // px; flat-top axial, matches Renderer.hexToPx formula shape

const SIM_STATE_TINT = {
  idle: 0xffffff, move: 0x88ccff, engage: 0xffcc66,
  suppressed: 0xffcc44, pinned: 0xff5544, reload: 0x9999cc,
  switch: 0xaaaaaa, assault: 0xff66ff, rout: 0x777777,
};

class SimScene extends Phaser.Scene {
  constructor() {
    super({ key: 'SimScene' });
    this.sim = null;
    this.orders = null;
    this.map = null;
    this.acc = 0;          // sim-time accumulator (ms)
    this.speed = 1;        // 0 = paused, 1, 2
    this.selectedId = null;
    this.sprites = new Map();   // soldierId -> { container, sprite, ring, hpBar, supBar, label, note, x, y }
    this.gridW = 12;
    this.gridH = 9;
    this.fps = 0;
  }

  // ---- coordinate bridge (flat-top axial) ----
  hexToPx(q, r) {
    return {
      x: SIM_HEX_SIZE * Math.sqrt(3) * (q + r / 2),
      y: SIM_HEX_SIZE * (3 / 2) * r,
    };
  }

  makeMap() {
    const W = this.gridW, H = this.gridH;
    // trench columns at q=1 and q=W-2 (cover .6), hedgerow mid (.35), else open (.12)
    const coverAt = (q, r) => (q === 1 || q === W - 2) ? 0.6
      : (q === Math.floor(W / 2)) ? 0.35 : 0.12;
    return {
      _coverAt: coverAt, W, H,
      dist: (a, b) => {
        const dq = a.q - b.q, dr = a.r - b.r;
        return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
      },
      hasLos: () => true,
      cover: (hex) => coverAt(hex.q, hex.r),
      moveCost: () => 1,
      neighbors: (hex) => [
        { q: hex.q + 1, r: hex.r }, { q: hex.q - 1, r: hex.r },
        { q: hex.q, r: hex.r + 1 }, { q: hex.q, r: hex.r - 1 },
        { q: hex.q + 1, r: hex.r - 1 }, { q: hex.q - 1, r: hex.r + 1 },
      ],
    };
  }

  preload() {
    // reuse existing soldier + explosion assets (same paths as phaser_bridge)
    if (!this.textures.exists('soldier_crawl')) {
      this.load.spritesheet('soldier_crawl', 'asset/soldier_crawl.png', { frameWidth: 256, frameHeight: 256, endFrame: 239 });
    }
  }

  create() {
    // reset per-run state (scene.restart re-runs create() on the same instance)
    this.sprites = new Map();
    this.acc = 0;
    this.selectedId = null;
    this.map = this.makeMap();
    const rng = mulberry32(this.seed || 1);
    this.sim = new SimCore({ map: this.map, tuning: SIM_TUNING, rng: rng, policy: TraitPolicy });
    this.orders = new CommsOrders({
      getSoldier: (id) => this.sim.getSoldier(id),
      soldiers: () => this.sim.soldiers(),
      map: this.map, tuning: SIM_TUNING,
    });
    this.sim.orders = this.orders;

    this.spawnSquads();

    // layers
    this.terrainG = this.add.graphics().setDepth(0);
    this.drawTerrain();
    this.spriteLayer = this.add.container(0, 0).setDepth(100);
    this.vfxGraphics = this.add.graphics().setDepth(2000);

    this.buildSprites();

    // camera centered on the field
    const c = this.hexToPx(this.gridW / 2, this.gridH / 2);
    this.cameras.main.centerOn(c.x, c.y);
    this.cameras.main.setZoom(0.85);

    this.setupInput();
    this.game.events.emit('sim-ready');
  }

  spawnSquads() {
    const rifle = toSimWeapon('m1', WPNS.m1, SIM_TUNING);
    const smg = toSimWeapon('thompson', WPNS.thompson, SIM_TUNING);
    const mg = toSimWeapon('mg42', WPNS.mg42, SIM_TUNING);
    const TRAITS = [[]].concat((window.TRAIT_IDS || []).map((trait) => [trait]));
    const magsFor = (w) => (SIM_TUNING.DEFAULT_MAGS && SIM_TUNING.DEFAULT_MAGS[w.class]) || 6;
    for (let i = 0; i < 5; i++) {
      const w = (i === 0) ? mg : rifle;
      this.sim.addSoldier({ id: 'A' + i, team: 'A', q: 1, r: i + 2, weapon: w, ammo: { mags: magsFor(w) }, skill: 1.0, isLeader: i === 0, traits: TRAITS[i], facing: { q: 1, r: 0 } });
    }
    for (let i = 0; i < 5; i++) {
      const w = (i === 0) ? smg : rifle;
      this.sim.addSoldier({ id: 'B' + i, team: 'B', q: this.gridW - 2, r: i + 2, weapon: w, ammo: { mags: magsFor(w) }, skill: 1.0, isLeader: i === 0, traits: TRAITS[i], facing: { q: -1, r: 0 } });
    }
  }

  drawTerrain() {
    const g = this.terrainG;
    g.clear();
    for (let q = 0; q < this.gridW; q++) {
      for (let r = 0; r < this.gridH; r++) {
        const cover = this.map.cover({ q, r });
        const { x, y } = this.hexToPx(q, r);
        // darker green with cover; trench columns get a dug-in look
        const base = 0x2c3a22;
        const lift = Math.round(cover * 90);
        const col = ((0x2c + lift * 0.2) << 16) | ((0x3a + lift * 0.6) << 8) | (0x22 + lift * 0.2);
        g.fillStyle(col & 0xffffff, 1);
        this.fillHex(g, x, y, SIM_HEX_SIZE * 0.94);
        g.lineStyle(1, 0x1a2015, 0.6);
        this.strokeHex(g, x, y, SIM_HEX_SIZE * 0.94);
        if (cover >= 0.6) {
          g.lineStyle(2, 0x171c10, 0.8);
          this.strokeHex(g, x, y, SIM_HEX_SIZE * 0.7);
        }
      }
    }
  }

  hexPoints(cx, cy, size) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 180 * (60 * i - 90);
      pts.push({ x: cx + size * Math.cos(a), y: cy + size * Math.sin(a) });
    }
    return pts;
  }
  fillHex(g, cx, cy, size) {
    const p = this.hexPoints(cx, cy, size);
    g.beginPath(); g.moveTo(p[0].x, p[0].y);
    for (let i = 1; i < 6; i++) g.lineTo(p[i].x, p[i].y);
    g.closePath(); g.fillPath();
  }
  strokeHex(g, cx, cy, size) {
    const p = this.hexPoints(cx, cy, size);
    g.beginPath(); g.moveTo(p[0].x, p[0].y);
    for (let i = 1; i < 6; i++) g.lineTo(p[i].x, p[i].y);
    g.closePath(); g.strokePath();
  }

  buildSprites() {
    for (const s of this.sim.soldiers()) {
      const { x, y } = this.hexToPx(s.q, s.r);
      const container = this.add.container(x, y);
      const shadow = this.add.ellipse(0, 6, 26, 12, 0x000000, 0.35);
      let body;
      if (this.textures.exists('soldier_crawl')) {
        body = this.add.sprite(0, -6, 'soldier_crawl', 0).setScale(0.16);
      } else {
        body = this.add.circle(0, 0, 12, 0xcccccc);
      }
      const ring = this.add.circle(0, 0, 15).setStrokeStyle(3, s.team === 'A' ? 0x3399ff : 0xff9933);
      const hpBar = this.add.rectangle(0, 20, 28, 3, 0xdddddd).setOrigin(0.5, 0.5);
      const supBar = this.add.rectangle(0, 24, 28, 4, 0x44aa44).setOrigin(0.5, 0.5);
      const label = this.add.text(0, -34, '', { fontFamily: 'monospace', fontSize: '11px', color: '#dfe' }).setOrigin(0.5);
      const note = this.add.text(0, -48, '', { fontFamily: 'monospace', fontSize: '11px', color: '#ffe678' }).setOrigin(0.5);
      container.add([shadow, body, ring, hpBar, supBar, label, note]);
      this.spriteLayer.add(container);
      this.sprites.set(s.id, { container, body, ring, shadow, hpBar, supBar, label, note, x, y, noteUntil: 0 });
    }
  }

  setupInput() {
    this.input.on('pointerdown', (pointer) => {
      const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      if (pointer.rightButtonDown()) {
        this.orderMoveTo(wp);
      } else {
        this.selectAt(wp);
      }
    });
    this.input.mouse.disableContextMenu();
    // F: leader focus-fire on selected enemy
    this.input.keyboard.on('keydown-F', () => {
      if (!this.selectedId) return;
      const tgt = this.sim.getSoldier(this.selectedId);
      if (!tgt || tgt.team !== 'B' || tgt.hp <= 0) return;
      const ids = this.sim.soldiers().filter(s => s.team === 'A' && s.hp > 0).map(s => s.id);
      this.sim.issueOrder({ type: 'TARGET', soldierIds: ids, payload: { targetId: tgt.id, mode: 'aimed' } });
    });
  }

  nearestSoldier(wp) {
    let best = null, bestD = 30 * 30;
    for (const s of this.sim.soldiers()) {
      if (s.hp <= 0) continue;
      const p = this.hexToPx(s.q, s.r);
      const d = (p.x - wp.x) ** 2 + (p.y - wp.y) ** 2;
      if (d < bestD) { bestD = d; best = s.id; }
    }
    return best;
  }
  selectAt(wp) { this.selectedId = this.nearestSoldier(wp); this.game.events.emit('sim-select', this.selectedId); }

  nearestHex(wp) {
    let best = null, bestD = Infinity;
    for (let q = 0; q < this.gridW; q++) {
      for (let r = 0; r < this.gridH; r++) {
        const p = this.hexToPx(q, r);
        const d = (p.x - wp.x) ** 2 + (p.y - wp.y) ** 2;
        if (d < bestD) { bestD = d; best = { q, r }; }
      }
    }
    return best;
  }
  orderMoveTo(wp) {
    if (!this.selectedId) return;
    const s = this.sim.getSoldier(this.selectedId);
    if (!s || s.hp <= 0) return;
    const dest = this.nearestHex(wp);
    const steps = Math.max(Math.abs(dest.q - s.q), Math.abs(dest.r - s.r));
    const path = [];
    for (let i = 1; i <= steps; i++) {
      path.push({ q: Math.round(s.q + (dest.q - s.q) * i / steps), r: Math.round(s.r + (dest.r - s.r) * i / steps) });
    }
    if (path.length) this.sim.issueOrder({ type: 'MOVE_TO', soldierIds: [this.selectedId], payload: { path } });
  }

  // ---- the driver (SPEC §15.2) ----
  update(time, delta) {
    this.fps = Math.round(this.game.loop.actualFps);
    const TICK = SIM_TUNING.TICK_MS;
    if (this.sim && !this.sim.result()) {
      this.acc += delta * this.speed;
      let n = 0;
      while (this.acc >= TICK && n < 5) {
        this.sim.tick();
        this.dispatch(this.sim.drainEvents());
        this.acc -= TICK;
        n++;
      }
    }
    this.renderSprites(delta);
    if (window.VFX) {
      if (window.VFX.shakeRequest > 0) { this.cameras.main.shake(90, window.VFX.shakeRequest * 0.001); window.VFX.shakeRequest = 0; }
      window.VFX.update();
      this.vfxGraphics.clear();
      window.VFX.draw(this.vfxGraphics);
    }
  }

  dispatch(events) {
    for (const ev of events) {
      switch (ev.type) {
        case 'SHOT': {
          const sh = this.sim.getSoldier(ev.shooterId), tg = this.sim.getSoldier(ev.targetId);
          if (!sh || !tg) break;
          const a = this.hexToPx(sh.q, sh.r), b = this.hexToPx(tg.q, tg.r);
          if (window.VFX) { window.VFX.addSmoke(a.x, a.y - 8); if (ev.hit) window.VFX.addBulletImpact(b.x, b.y - 4, 2); }
          if (window.Sfx) try { window.Sfx.play('shot'); } catch (e) {}
          break;
        }
        case 'DOWN': {
          const s = this.sim.getSoldier(ev.id); if (!s) break;
          const p = this.hexToPx(s.q, s.r);
          if (window.VFX) window.VFX.addExplosion(p.x, p.y - 4, '#cc3333', 6);
          this.flashNote(ev.id, '☠', 0);
          break;
        }
        case 'GRENADE': {
          const s = this.sim.getSoldier(ev.id); if (!s) break;
          const a = this.hexToPx(s.q, s.r);
          const t = ev.target ? this.hexToPx(ev.target.q, ev.target.r) : a;
          if (window.VFX) window.VFX.addRocket(a.x, a.y - 6, t.x, t.y - 6, () => window.VFX.addExplosion(t.x, t.y - 4, '#ffaa00', 12));
          break;
        }
        case 'POLICY': this.flashNote(ev.id, ev.note, 60); break;
        case 'ORDER_DELIVERED': this.flashNote(ev.id, '了解! ' + ev.order.type, 40); break;
        case 'ROUT': this.flashNote(ev.id, '敗走!', 60); break;
        case 'RESULT': this.game.events.emit('sim-result', ev); break;
        default: break;
      }
    }
  }

  flashNote(id, text, ttl) {
    const v = this.sprites.get(id);
    if (v) { v.pendingNote = text; v.noteUntil = this.sim._tick + (ttl || 40); }
  }

  renderSprites(delta) {
    const lerp = Math.min(1, delta / 120); // smooth toward hex target
    for (const s of this.sim.soldiers()) {
      const v = this.sprites.get(s.id);
      if (!v) continue;
      const target = this.hexToPx(s.q, s.r);
      v.x += (target.x - v.x) * lerp;
      v.y += (target.y - v.y) * lerp;
      v.container.setPosition(v.x, v.y);
      const alive = s.hp > 0;
      v.container.setAlpha(alive ? 1 : 0.5);
      if (v.body.setTint) v.body.setTint(alive ? (SIM_STATE_TINT[s.state] || 0xffffff) : 0x442222);
      v.container.setDepth(100 + Math.round(v.y));
      // bars
      v.hpBar.width = 28 * Math.max(0, Math.min(1, s.hp / 100));
      v.supBar.width = 28 * Math.max(0, Math.min(1, s.suppression / 100));
      v.supBar.fillColor = s.suppression >= SIM_TUNING.PINNED_AT ? 0xff2222
        : (s.suppression >= SIM_TUNING.SUPPRESSED_AT ? 0xffaa22 : 0x44aa44);
      v.hpBar.setVisible(alive); v.supBar.setVisible(alive);
      v.ring.setStrokeStyle(s.id === this.selectedId ? 4 : 3, s.team === 'A' ? 0x3399ff : 0xff9933);
      const tag = s.id + (s.isLeader ? '★' : '') + ' ' + s.weapon.class;
      if (v.label.text !== tag) v.label.setText(tag);
      // floating note
      if (v.pendingNote && this.sim._tick < v.noteUntil) {
        if (v.note.text !== v.pendingNote) v.note.setText(v.pendingNote);
        v.note.setAlpha(Math.max(0, (v.noteUntil - this.sim._tick) / 60));
      } else if (v.note.text) { v.note.setText(''); }
    }
  }

  restart(seed) {
    this.seed = seed;
    this.scene.restart();
  }
}

if (typeof window !== 'undefined') { window.SimScene = SimScene; }

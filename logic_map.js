/** LOGIC MAP: Map Generation, Pathfinding, and Geometry Math (hands は常に3スロット配列を前提) */

class MapSystem {
  constructor(game) {
    this.game = game;
  }

  generate() {
    this.game.map = [];
    for (let q = 0; q < MAP_W; q++) {
      this.game.map[q] = [];
      for (let r = 0; r < MAP_H; r++) {
        this.game.map[q][r] = TERRAIN.VOID;
      }
    }
    const cx = Math.floor(MAP_W / 2), cy = Math.floor(MAP_H / 2);
    let walkers = [{ q: cx, r: cy }];

    const paintBrush = (cq, cr) => {
      [{ q: cq, r: cr }, ...this.getNeighbors(cq, cr)].forEach(h => {
        if (this.isValidHex(h.q, h.r)) { this.game.map[h.q][h.r] = TERRAIN.GRASS; }
      });
    };

    for (let i = 0; i < 140; i++) {
      const wIdx = Math.floor(Math.random() * walkers.length);
      const w = walkers[wIdx];
      paintBrush(w.q, w.r);
      const dir = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]][Math.floor(Math.random() * 6)];
      const next = { q: w.q + dir[0], r: w.r + dir[1] };
      if (Math.random() < 0.05 && walkers.length < 5) { walkers.push(next); } else { walkers[wIdx] = next; }
    }

    for (let i = 0; i < 3; i++) {
      for (let q = 1; q < MAP_W - 1; q++) {
        for (let r = 1; r < MAP_H - 1; r++) {
          if (this.game.map[q][r].id === -1) {
            const ln = this.getNeighbors(q, r).filter(n => this.game.map[n.q][n.r].id !== -1).length;
            if (ln >= 4) { this.game.map[q][r] = TERRAIN.GRASS; }
          }
        }
      }
    }

    for (let loop = 0; loop < 2; loop++) {
      const wC = [];
      for (let q = 0; q < MAP_W; q++) {
        for (let r = 0; r < MAP_H; r++) {
          if (this.game.map[q][r].id === -1) {
            const hn = this.getNeighbors(q, r).some(n => this.game.map[n.q][n.r].id !== -1);
            if (hn) { wC.push({ q, r }); }
          }
        }
      }
      wC.forEach(w => { this.game.map[w.q][w.r] = TERRAIN.WATER; });
    }

    for (let q = 0; q < MAP_W; q++) {
      for (let r = 0; r < MAP_H; r++) {
        const tId = this.game.map[q][r].id;
        if (tId !== -1 && tId !== 5) {
          const n = Math.sin(q * 0.4) + Math.cos(r * 0.4) + Math.random() * 0.4;
          let t = TERRAIN.GRASS;
          if (n > 1.1) { t = TERRAIN.FOREST; }
          else if (n < -0.9) { t = TERRAIN.DIRT; }
          if (t !== TERRAIN.WATER && Math.random() < 0.05) { t = TERRAIN.TOWN; }
          this.game.map[q][r] = t;
        }
      }
    }
  }

  isValidHex(q, r) { return q >= 0 && q < MAP_W && r >= 0 && r < MAP_H; }

  hexDist(a, b) { return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2; }

  getNeighbors(q, r) { return [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]].map(d => ({ q: q + d[0], r: r + d[1] })).filter(h => this.isValidHex(h.q, h.r)); }

  findPath(u, tq, tr) {
    const f = [{ q: u.q, r: u.r }], cf = {}, cs = {};
    cf[`${u.q},${u.r}`] = null;
    cs[`${u.q},${u.r}`] = 0;
    while (f.length > 0) {
      const c = f.shift();
      if (c.q === tq && c.r === tr) { break; }
      this.getNeighbors(c.q, c.r).forEach(n => {
        if (this.game.getUnitsInHex(n.q, n.r).length >= 4 && (n.q !== tq || n.r !== tr)) { return; }
        const cost = this.game.map[n.q][n.r].cost;
        if (cost >= 99) { return; }
        const nc = cs[`${c.q},${c.r}`] + cost;
        if (nc <= u.ap) {
          const k = `${n.q},${n.r}`;
          if (!(k in cs) || nc < cs[k]) { cs[k] = nc; f.push(n); cf[k] = c; }
        }
      });
    }
    const p = [];
    let c = { q: tq, r: tr };
    if (!cf[`${tq},${tr}`]) { return []; }
    while (c) {
      if (c.q === u.q && c.r === u.r) { break; }
      p.push(c);
      c = cf[`${c.q},${c.r}`];
    }
    return p.reverse();
  }

  /**
   * 攻撃ライン（射線上のヘックス）を計算する。
   * 定格射程までは alpha:1、それ以遠は 2*range 付近で 0 に線形でフェード。各要素に { q, r, alpha } を返す。
   * u.hands は常に3スロット配列を前提。getVirtualWeapon で実効武器を取得。
   */
  calcAttackLine(u, targetQ, targetR) {
    if (!u || u.ap < 2) { return []; }

    const w = this.game.getVirtualWeapon ? this.game.getVirtualWeapon(u) : null;
    if (!w) { return []; }

    const range = w.rng;
    const dist = this.hexDist(u, { q: targetQ, r: targetR });
    if (dist === 0) { return []; }

    const maxDrawLen = Math.min(dist, Math.ceil(range * 2));
    const start = this.axialToCube(u.q, u.r);
    const end = this.axialToCube(targetQ, targetR);

    const line = [];
    for (let i = 1; i <= maxDrawLen; i++) {
      const t = i / dist;
      const lerpCube = {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
        z: start.z + (end.z - start.z) * t
      };
      const roundCube = this.cubeRound(lerpCube);
      const hex = this.cubeToAxial(roundCube);
      if (!this.isValidHex(hex.q, hex.r)) break;
      let alpha = 1;
      if (i > range) {
        const over = i - range;
        alpha = Math.max(0, 1 - over / range);
      }
      line.push({ q: hex.q, r: hex.r, alpha });
    }
    return line;
  }

  axialToCube(q, r) { return { x: q, y: r, z: -q - r }; }
  cubeToAxial(c) { return { q: c.x, r: c.y }; }
  cubeRound(c) {
    let rx = Math.round(c.x), ry = Math.round(c.y), rz = Math.round(c.z);
    const x_diff = Math.abs(rx - c.x), y_diff = Math.abs(ry - c.y), z_diff = Math.abs(rz - c.z);
    if (x_diff > y_diff && x_diff > z_diff) rx = -ry - rz;
    else if (y_diff > z_diff) ry = -rx - rz;
    else rz = -rx - ry;
    return { x: rx, y: ry, z: rz };
  }
}

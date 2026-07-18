/** LOGIC MAP: Map Generation, Pathfinding, and Geometry Math (hands は常に3スロット配列を前提) */

class MapSystem {
  constructor(game) {
    this.game = game;
  }

  generate() {
    // 農村V29モード (logic_map_rural_v29.js)。優先度: RuralV29 > CityMap > 田園
    if (window.RuralV29Map && window.RuralV29Map.enabled) {
      window.RuralV29Map.generate(this.game);
      return;
    }
    if (window.RuralV29Map) window.RuralV29Map.active = false;
    // WW2廃墟都市モード (logic_map_city.js)。無効時は従来の田園ジェネレータへ。
    if (window.CityMap && window.CityMap.enabled) {
      window.CityMap.generate(this.game);
      return;
    }
    if (window.CityMap) window.CityMap.active = false;
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
          let t = TERRAIN.DIRT;
          if (n > 1.15) { t = TERRAIN.FOREST; }
          else if (n > 0.25) { t = TERRAIN.GRASS; }
          if (t !== TERRAIN.WATER && Math.random() < 0.05) { t = TERRAIN.TOWN; }
          this.game.map[q][r] = t;
        }
      }
    }

    this.generateRoads();
  }

  /** 地形コスト付き A* で往来路を生成 */
  generateRoads() {
    const anchors = this.collectRoadAnchors();
    if (anchors.length < 2) return;

    const shuffle = (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };
    const pick = (arr) => arr.length ? arr[Math.floor(Math.random() * arr.length)] : null;

    const pairs = [];
    const towns = anchors.filter((a) => a.isTown);
    if (towns.length >= 2) {
      const t = shuffle(towns.slice());
      pairs.push([t[0], t[1]]);
      if (t.length >= 3 && Math.random() < 0.25) pairs.push([t[1], t[2]]);
    } else if (towns.length === 1) {
      const others = anchors.filter((a) => !a.isTown);
      if (others.length) pairs.push([towns[0], pick(others)]);
    }

    const spread = this.pickSpreadAnchors(anchors, 2);
    for (let i = 0; i + 1 < spread.length; i++) {
      pairs.push([spread[i], spread[i + 1]]);
    }
    if (pairs.length === 0 && anchors.length >= 2) {
      pairs.push([anchors[0], anchors[1]]);
    }

    pairs.forEach(([a, b]) => {
      if (!a || !b) return;
      this.paintRoadPath(this.findRoadPath(a.q, a.r, b.q, b.r), a, b);
    });

    const branchStarts = [];
    for (let q = 0; q < MAP_W; q++) {
      for (let r = 0; r < MAP_H; r++) {
        if (this.game.map[q][r].id === 3) branchStarts.push({ q, r });
      }
    }
    shuffle(branchStarts);
    const branchCount = Math.random() < 0.75 ? 0 : 1;
    for (let i = 0; i < branchCount && i < branchStarts.length; i++) {
      const goal = pick(towns) || pick(anchors);
      if (!goal) break;
      const path = this.findRoadPath(branchStarts[i].q, branchStarts[i].r, goal.q, goal.r);
      if (path.length > 1) this.paintRoadPath(path, branchStarts[i], goal);
    }
  }

  collectRoadAnchors() {
    const towns = [];
    const inland = [];
    for (let q = 0; q < MAP_W; q++) {
      for (let r = 0; r < MAP_H; r++) {
        const id = this.game.map[q][r].id;
        if (id === -1 || id === 5) continue;
        const waterAdj = this.getNeighbors(q, r).filter((n) => this.game.map[n.q][n.r].id === 5).length;
        if (id === 4) towns.push({ q, r, isTown: true, waterAdj });
        else if ((id === 0 || id === 1) && waterAdj === 0) {
          inland.push({ q, r, isTown: false, waterAdj });
        } else if (id === 1 && waterAdj === 1) {
          inland.push({ q, r, isTown: false, waterAdj });
        }
      }
    }
    const anchors = [...towns];
    if (inland.length) {
      const shuffled = inland.slice();
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      shuffled.slice(0, Math.min(4, shuffled.length)).forEach((h) => anchors.push(h));
    }
    return anchors;
  }

  pickSpreadAnchors(anchors, count) {
    if (anchors.length <= count) return anchors.slice();
    const picked = [anchors[Math.floor(Math.random() * anchors.length)]];
    while (picked.length < count && picked.length < anchors.length) {
      let best = null;
      let bestScore = -1;
      anchors.forEach((a) => {
        if (picked.some((p) => p.q === a.q && p.r === a.r)) return;
        const minD = Math.min(...picked.map((p) => this.hexDist(p, a)));
        const score = minD + (a.isTown ? 2 : 0);
        if (score > bestScore) { bestScore = score; best = a; }
      });
      if (best) picked.push(best);
      else break;
    }
    return picked;
  }

  paintRoadPath(path, from, to) {
    if (from) this.paintRoadHex(from.q, from.r);
    path.forEach((h) => this.paintRoadHex(h.q, h.r));
    if (to) this.paintRoadHex(to.q, to.r);
  }

  isNearWater(q, r) {
    return this.getNeighbors(q, r).some((n) => this.game.map[n.q][n.r].id === 5);
  }

  roadStepCost(q, r, fromDir, toDir) {
    const cell = this.game.map[q][r];
    if (cell.id === -1 || cell.id === 5) return 999;
    if (cell.id === 3) return 0.25;

    let cost = 1.0;
    if (cell.id === 0) cost = 1.45;
    else if (cell.id === 1) cost = 1.0;
    else if (cell.id === 2) cost = 4.0;
    else if (cell.id === 4) cost = 0.55;

    const waterAdj = this.getNeighbors(q, r).filter((n) => this.game.map[n.q][n.r].id === 5).length;
    cost += waterAdj * 2.8;

    cost += Math.sin(q * 0.61 + r * 0.47) * 0.45 + Math.cos(q * 0.29 - r * 0.53) * 0.4;

    // Add cost penalty if adjacent to an existing road, to avoid parallel roads
    const hasRoadNeighbor = this.getNeighbors(q, r).some((n) => this.game.map[n.q][n.r].id === 3);
    if (hasRoadNeighbor) {
      cost += 3.5;
    }

    if (fromDir != null && toDir != null) {
      if (fromDir === toDir) cost += 0.22;
      else cost -= 0.1;
    }
    return Math.max(0.4, cost);
  }

  findRoadPath(sq, sr, tq, tr) {
    if (sq === tq && sr === tr) return [];
    const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    const sk = `${sq},${sr}`;
    const open = [{ q: sq, r: sr, g: 0, f: this.hexDist({ q: sq, r: sr }, { q: tq, r: tr }) }];
    const gScore = { [sk]: 0 };
    const cameFrom = {};
    const inDir = { [sk]: null };

    while (open.length > 0) {
      open.sort((a, b) => a.f - b.f);
      const cur = open.shift();
      if (cur.q === tq && cur.r === tr) break;
      const ck = `${cur.q},${cur.r}`;
      const prevDir = inDir[ck];
      dirs.forEach((d, di) => {
        const nq = cur.q + d[0];
        const nr = cur.r + d[1];
        if (!this.isValidHex(nq, nr)) return;
        const step = this.roadStepCost(nq, nr, prevDir, di);
        if (step >= 900) return;
        const nk = `${nq},${nr}`;
        const ng = gScore[ck] + step;
        if (!(nk in gScore) || ng < gScore[nk]) {
          gScore[nk] = ng;
          cameFrom[nk] = ck;
          inDir[nk] = di;
          open.push({ q: nq, r: nr, g: ng, f: ng + this.hexDist({ q: nq, r: nr }, { q: tq, r: tr }) * 1.05 });
        }
      });
    }

    const tk = `${tq},${tr}`;
    if (!(tk in cameFrom)) return [];
    const path = [];
    let k = tk;
    while (k !== sk) {
      const [q, r] = k.split(',').map(Number);
      path.push({ q, r });
      k = cameFrom[k];
    }
    return path.reverse();
  }

  paintRoadHex(q, r) {
    if (!this.isValidHex(q, r)) return;
    const cell = this.game.map[q][r];
    if (cell.id === -1 || cell.id === 5 || cell.id === 3) return;
    this.game.map[q][r] = { ...TERRAIN.ROAD, underId: cell.id };
  }

  isValidHex(q, r) { return q >= 0 && q < MAP_W && r >= 0 && r < MAP_H; }

  hexDist(a, b) { return hexDist(a, b); }

  getNeighbors(q, r) { return [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]].map(d => ({ q: q + d[0], r: r + d[1] })).filter(h => this.isValidHex(h.q, h.r)); }

  /** 中心ヘックスから距離 radius 以内の全ヘックス（March of ants 用）。radius=2 で 19 ヘックス。 */
  getHexesInRange(q, r, radius) {
    const out = [];
    for (let dq = -radius; dq <= radius; dq++) {
      for (let dr = -radius; dr <= radius; dr++) {
        const hq = q + dq;
        const hr = r + dr;
        if (!this.isValidHex(hq, hr)) continue;
        if (this.hexDist({ q, r }, { q: hq, r: hr }) > radius) continue;
        out.push({ q: hq, r: hr });
      }
    }
    return out;
  }

  findPath(u, tq, tr) {
    const maxCost = this.game.getMovementBudget ? this.game.getMovementBudget(u) : u.ap;
    return this.findPathWithMaxCost(u, tq, tr, maxCost);
  }

  findPathWithMaxCost(u, tq, tr, maxCost) {
    const f = [{ q: u.q, r: u.r }], cf = {}, cs = {};
    cf[`${u.q},${u.r}`] = null;
    cs[`${u.q},${u.r}`] = 0;
    while (f.length > 0) {
      const c = f.shift();
      if (c.q === tq && c.r === tr) { break; }
      this.getNeighbors(c.q, c.r).forEach(n => {
        const hexCap = this.game.getHexMoveBlock ? this.game.getHexMoveBlock() : 4;
        if (this.game.getUnitsInHex(n.q, n.r).length >= hexCap && (n.q !== tq || n.r !== tr)) { return; }
        const cost = this.game.getTerrainMoveCost ? this.game.getTerrainMoveCost(u, n.q, n.r) : this.game.map[n.q][n.r].cost;
        const blocked = this.game.isHexBlockedForUnit ? this.game.isHexBlockedForUnit(u, n.q, n.r) : this.game.map[n.q][n.r].cost >= 99;
        if (blocked) { return; }
        const nc = cs[`${c.q},${c.r}`] + cost;
        if (nc <= maxCost) {
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

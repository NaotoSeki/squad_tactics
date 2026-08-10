/** Deterministic, validated RTwP battlefield generation. Opt-in until rollout. */
(function (root) {
  'use strict';

  const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  const DEFAULTS = { width: 20, height: 20, recentLimit: 8, maxAttempts: 24 };

  function hashSeed(value) {
    const text = String(value == null ? '' : value);
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function rngFrom(seed) {
    let state = hashSeed(seed) || 0x6d2b79f5;
    return function () {
      state += 0x6d2b79f5;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function key(q, r) { return q + ',' + r; }
  function inside(q, r, w, h) { return q >= 0 && q < w && r >= 0 && r < h; }
  function neighbors(q, r, w, h) {
    return DIRS.map(d => ({ q: q + d[0], r: r + d[1] }))
      .filter(p => inside(p.q, p.r, w, h));
  }
  function hexDistance(a, b) {
    const ds = (a.q + a.r) - (b.q + b.r);
    return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(ds));
  }
  function shuffle(items, rng) {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  function terrain(base, elevation) {
    const defs = {
      GRASS: { id: 0, name: 'Grass', cost: 1, cover: 0 },
      FOREST: { id: 2, name: 'Forest', cost: 2, cover: 35, sightBlock: 0.38, tankBlocked: false },
      ROAD: { id: 3, name: 'Road', cost: 1, cover: 0 },
      RUIN: { id: 4, name: 'Ruin', cost: 2, cover: 42, sightBlock: 0.28, tankBlocked: false },
      FIELD: { id: 7, name: 'Field', cost: 2, cover: 15 },
      BLDG: { id: 6, name: 'Building', cost: 99, cover: 0, sightBlock: 1, building: true, tankBlocked: true }
    };
    return Object.assign({}, defs[base], { base, elevation });
  }

  function generateCandidate(seed, options) {
    const w = options.width, h = options.height;
    const rng = rngFrom(seed);
    const map = Array.from({ length: w }, () => Array(h));
    const phaseA = rng() * 10, phaseB = rng() * 10;
    for (let q = 0; q < w; q++) {
      for (let r = 0; r < h; r++) {
        const wave = Math.sin(q * 0.48 + phaseA) + Math.cos(r * 0.41 + phaseB)
          + Math.sin((q + r) * 0.22 + phaseB) * 0.7;
        let elevation = Math.max(0, Math.min(4, Math.round(2 + wave * 0.75)));
        // Preserve broad seed-shaped hills while guaranteeing enough tactically
        // relevant high ground even for unusually flat wave phases.
        if (((q * 7 + r * 11 + hashSeed(seed)) % 7) === 0) elevation = Math.max(3, elevation);
        const roll = rng();
        const base = roll < 0.12 ? 'FOREST' : (roll < 0.27 ? 'FIELD' : 'GRASS');
        map[q][r] = terrain(base, elevation);
      }
    }

    // Two separated, three-hex-wide north/south corridors guarantee mass movement.
    const corridorCenters = [Math.max(3, Math.floor(w * 0.30)), Math.min(w - 4, Math.floor(w * 0.70))];
    const massRoutes = [];
    corridorCenters.forEach((start, ci) => {
      let center = start;
      const route = [];
      for (let r = 0; r < h; r++) {
        if (r > 1 && r < h - 2 && rng() < 0.20) center += rng() < 0.5 ? -1 : 1;
        center = Math.max(2, Math.min(w - 3, center));
        route.push({ q: center, r });
        for (let dq = -1; dq <= 1; dq++) map[center + dq][r] = terrain(dq === 0 ? 'ROAD' : 'GRASS', map[center + dq][r].elevation);
        if (ci === 0 && r === Math.floor(h / 2)) {
          for (let q = center; q < corridorCenters[1]; q++) map[q][r] = terrain('ROAD', map[q][r].elevation);
        }
      }
      massRoutes.push(route);
    });

    // Settlement stays off the main corridors; openings prevent sealed compounds.
    const settlement = { q: Math.floor(w / 2) + (rng() < 0.5 ? -2 : 2), r: Math.floor(h / 2) + Math.floor(rng() * 5) - 2 };
    const ring = neighbors(settlement.q, settlement.r, w, h);
    shuffle(ring, rng)
      .filter(p => corridorCenters.every(c => Math.abs(p.q - c) > 1))
      .slice(0, 3)
      .forEach((p, i) => {
        map[p.q][p.r] = terrain(i === 0 ? 'RUIN' : 'BLDG', map[p.q][p.r].elevation);
      });
    map[settlement.q][settlement.r] = terrain('ROAD', map[settlement.q][settlement.r].elevation);

    // Spawn reserves are broad, open, and connected to both corridors.
    const spawnRows = { enemy: [0, 1, 2, 3], player: [h - 4, h - 3, h - 2, h - 1] };
    Object.values(spawnRows).flat().forEach(r => {
      for (let q = 1; q < w - 1; q++) {
        if (map[q][r].base === 'BLDG') map[q][r] = terrain('GRASS', map[q][r].elevation);
      }
    });
    const spawnCells = {};
    Object.keys(spawnRows).forEach(team => {
      const candidates = [];
      spawnRows[team].forEach(r => {
        for (let q = 1; q < w - 1; q++) {
          const cell = map[q][r];
          if (cell.cost < 99 && cell.base !== 'FOREST') candidates.push({ q, r });
        }
      });
      spawnCells[team] = shuffle(candidates, rng).slice(0, Math.min(24, candidates.length));
    });

    const enemyInitial = spawnCells.enemy.slice(0, 12).map((p, index) => ({ q: p.q, r: p.r, group: index % 3 }));
    return { seed: String(seed), map, spawns: spawnCells, enemyInitial, settlement, corridorCenters, massRoutes };
  }

  function flood(map, starts, passable) {
    const w = map.length, h = map[0].length;
    const seen = new Set(), queue = starts.slice();
    queue.forEach(p => seen.add(key(p.q, p.r)));
    while (queue.length) {
      const p = queue.shift();
      neighbors(p.q, p.r, w, h).forEach(n => {
        const k = key(n.q, n.r);
        if (!seen.has(k) && passable(map[n.q][n.r])) { seen.add(k); queue.push(n); }
      });
    }
    return seen;
  }

  function validate(result) {
    const map = result.map, w = map.length, h = map[0].length;
    const errors = [];
    const foot = c => c && c.cost < 99;
    const vehicle = c => foot(c) && !c.tankBlocked;
    const reachable = flood(map, result.spawns.player.slice(0, 1), foot);
    if (!result.spawns.player.length || !result.spawns.enemy.length) errors.push('missing_spawn_zone');
    if (!result.spawns.enemy.some(p => reachable.has(key(p.q, p.r)))) errors.push('spawn_zones_disconnected');
    const vehicleArea = flood(map, result.spawns.player.slice(0, 1), vehicle);
    if (vehicleArea.size < w * h * 0.72) errors.push('vehicle_area_too_small');
    const runs = (result.massRoutes || []).filter(route => route.every(p =>
      [-1, 0, 1].every(dq => inside(p.q + dq, p.r, w, h) && vehicle(map[p.q + dq][p.r]))
    )).length;
    if (runs < 2) errors.push('insufficient_mass_routes');
    let cover = 0, open = 0, blocked = 0, elevated = 0;
    for (let q = 0; q < w; q++) for (let r = 0; r < h; r++) {
      const c = map[q][r];
      if (c.cost >= 99) blocked++;
      else if (c.cover >= 15) cover++;
      else open++;
      if (c.elevation >= 3) elevated++;
    }
    const total = w * h;
    if (cover / total < 0.16 || cover / total > 0.48) errors.push('cover_balance');
    if (open / total < 0.38) errors.push('insufficient_open_los');
    if (blocked / total > 0.08) errors.push('too_many_blockers');
    if (elevated / total < 0.12) errors.push('insufficient_elevation');
    if (result.spawns.player.length < 12 || result.spawns.enemy.length < 12) errors.push('spawn_capacity');
    return { ok: errors.length === 0, errors, metrics: { reachable: reachable.size, vehicleArea: vehicleArea.size, cover, open, blocked, elevated, massRouteRuns: runs } };
  }

  const NextGenMapGenerator = {
    enabled: false,
    active: false,
    seed: null,
    lastResult: null,
    recentSeeds: [],
    configure(values) { Object.assign(this, values || {}); },
    create(seed, values) {
      const options = Object.assign({}, DEFAULTS, values || {});
      let lastRejected = null;
      for (let attempt = 0; attempt < options.maxAttempts; attempt++) {
        const actualSeed = attempt ? String(seed) + ':repair:' + attempt : String(seed);
        const result = generateCandidate(actualSeed, options);
        result.requestedSeed = String(seed);
        result.validation = validate(result);
        if (result.validation.ok) return result;
        lastRejected = result;
      }
      return options.returnInvalid ? lastRejected : null;
    },
    nextSeed(seed) {
      let candidate = seed == null ? String(Date.now()) + ':' + Math.random() : String(seed);
      let suffix = 0;
      while (this.recentSeeds.includes(candidate)) candidate = String(seed) + ':repeat:' + (++suffix);
      return candidate;
    },
    apply(game, seed, values) {
      const options = Object.assign({}, DEFAULTS, values || {});
      const chosen = this.nextSeed(seed == null ? this.seed : seed);
      const result = this.create(chosen, options);
      if (!result) { this.active = false; return false; }
      game.map = result.map;
      game.mapScenario = { source: 'nextgen', seed: result.seed, requestedSeed: result.requestedSeed, spawns: result.spawns, enemyInitial: result.enemyInitial, validation: result.validation };
      this.lastResult = result;
      this.recentSeeds.push(chosen);
      if (this.recentSeeds.length > options.recentLimit) this.recentSeeds.shift();
      this.active = true;
      return true;
    },
    validate,
    rngFrom,
    hashSeed
  };

  root.NextGenMapGenerator = NextGenMapGenerator;
  if (typeof module !== 'undefined' && module.exports) module.exports = NextGenMapGenerator;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * sim_battle_adapter.js -- WS-G (NORTH_STAR SS7.4 基準6 / SIM_CORE_SPEC.md SS17)
 *
 * Facade layer that lets the PRODUCT rendering code (phaser_unit.js UnitView,
 * phaser_terrain.js TerrainRender) draw sim_core's headless battle unmodified.
 *
 * Three responsibilities (SPEC SS17.1):
 *   1. SimBattleAdapter(sim)  -- window.gameLogic-compatible read surface for UnitView
 *      (units / selectedUnit / onUnitClick / interactionMode), soldier -> unit-shape.
 *   2. buildBattleMap()        -- a small fixed 2D terrain grid (TERRAIN cells, same
 *      shape logic_map.js produces) + a sim_core MapApi adapter over it.
 *   3. SIM_TUNING.TERRAIN_COVER (added in data.js) is consumed here by cover().
 *
 * Pure JS otherwise; the only "impurity" is that SimBattleAdapter wraps a live
 * SimCore instance and re-derives its unit array on read (a getter), which is
 * fine -- it is a read-only projection, not a probe (SPEC SS1.4).
 */

// ---------------------------------------------------------------------------
// 1. Fixed battle map (5v5 trench-vs-open-ground standoff, SPEC SS17.2 #1)
// ---------------------------------------------------------------------------

/**
 * Builds a small fixed terrain grid using the real TERRAIN cells (data.js).
 * Shape matches what logic_map.js produces: map[q][r] = TERRAIN.XXX (a
 * {id,name,cost,cover} object), so TerrainRender.buildMap can draw it
 * unmodified (it only reads map[q][r].id / .underId).
 *
 * Layout (q = column, r = row), width x height = BATTLE_MAP_W x BATTLE_MAP_H:
 *   - q=1 and q=W-2 columns: TOWN (cover .5) -- the two dug-in flanks (A/B)
 *   - q=floor(W/2): FOREST (cover .4) -- a hedgerow spine, partial cover
 *   - everything else: DIRT (cover .12), open ground squads must cross
 *
 * W-2 - 1 = 7 hexes between the two dug-in columns: exactly M1 Garand's
 * rngMax (WPNS.m1.rng=7), so riflemen on both flanks can trade fire
 * immediately without anyone having to move first (TraitPolicy never
 * self-issues MOVE_TO -- SS sim_policy.js -- so an out-of-range standoff would
 * otherwise sit silent forever; SMG/sniper ranges differ and simply join as
 * the range check allows, same as dev_sim.html's proven layout).
 *
 * @returns {{grid: Array<Array<Object>>, W: number, H: number}}
 */
const BATTLE_MAP_W = 10;
const BATTLE_MAP_H = 8;

function buildBattleMap() {
  const W = BATTLE_MAP_W, H = BATTLE_MAP_H;
  const grid = [];
  for (let q = 0; q < W; q++) {
    grid[q] = [];
    for (let r = 0; r < H; r++) {
      let cell;
      if (q === 1 || q === W - 2) cell = TERRAIN.TOWN;      // dug-in flanks
      else if (q === Math.floor(W / 2)) cell = TERRAIN.FOREST; // hedgerow spine
      else cell = TERRAIN.DIRT;                              // open ground
      grid[q][r] = cell;
    }
  }
  return { grid, W, H };
}

/**
 * TerrainRender.buildMap (phaser_terrain.js) iterates `for q<MAP_W, r<MAP_H`
 * (the data.js globals, 20x20) and reads map[q][r].id directly -- it does not
 * take a width/height parameter. To reuse it UNMODIFIED we must hand it a
 * full MAP_W x MAP_H grid, not our small BATTLE_MAP_W x BATTLE_MAP_H logical
 * grid. This wraps the small battle grid inside a MAP_W x MAP_H canvas of
 * TERRAIN.VOID (id -1, which buildMap/spawnHex skip and never draw), placed
 * at the same (q,r) origin the sim uses -- so sim hex (q,r) and rendered hex
 * (q,r) stay numerically identical (no offset math needed elsewhere).
 * @param {{grid, W, H}} mapData - from buildBattleMap()
 * @returns {Array<Array<Object>>} MAP_W x MAP_H grid for TerrainRender.buildMap
 */
function toRenderGrid(mapData) {
  const full = [];
  for (let q = 0; q < MAP_W; q++) {
    full[q] = [];
    for (let r = 0; r < MAP_H; r++) {
      full[q][r] = (q < mapData.W && r < mapData.H) ? mapData.grid[q][r] : TERRAIN.VOID;
    }
  }
  return full;
}

/**
 * sim_core MapApi (SIM_CORE_SPEC.md SS3) over a fixed terrain grid.
 * hasLos is always true in v1 (documented in the spec as an acceptable v1
 * simplification -- see SPEC SS17.1 note on the SimBattleAdapter façade).
 * @param {{grid, W, H}} mapData
 * @returns {Object} MapApi
 */
function makeBattleMapApi(mapData) {
  const { grid, W, H } = mapData;
  const coverTable = (typeof SIM_TUNING !== 'undefined' && SIM_TUNING.TERRAIN_COVER) || {};

  return {
    _grid: grid, _W: W, _H: H,
    dist: (a, b) => {
      const dq = a.q - b.q, dr = a.r - b.r;
      return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
    },
    // v1: LOS is always true (documented simplification -- SPEC SS17 façade note).
    hasLos: () => true,
    cover: (hex) => {
      if (hex.q < 0 || hex.q >= W || hex.r < 0 || hex.r >= H) return 0;
      const cell = grid[hex.q][hex.r];
      const id = cell ? cell.id : 0;
      return coverTable[id] != null ? coverTable[id] : 0;
    },
    moveCost: (hex) => {
      if (hex.q < 0 || hex.q >= W || hex.r < 0 || hex.r >= H) return 99;
      const cell = grid[hex.q][hex.r];
      return cell ? cell.cost : 99;
    },
    neighbors: (hex) => [
      { q: hex.q + 1, r: hex.r }, { q: hex.q - 1, r: hex.r },
      { q: hex.q, r: hex.r + 1 }, { q: hex.q, r: hex.r - 1 },
      { q: hex.q + 1, r: hex.r - 1 }, { q: hex.q - 1, r: hex.r + 1 },
    ].filter((h) => h.q >= 0 && h.q < W && h.r >= 0 && h.r < H),
  };
}

// ---------------------------------------------------------------------------
// 2. SimBattleAdapter -- window.gameLogic-compatible façade for UnitView
// ---------------------------------------------------------------------------

/**
 * UnitView (phaser_unit.js) reads exactly 4 members off window.gameLogic
 * (SPEC SS17 "接合面の実測"):
 *   - units: Array<{id, def, hp, maxHp, q, r, team, hands, skills, fusionCount}>
 *   - selectedUnit: one of the entries in `units`, or null
 *   - onUnitClick(unit): called on sprite pointerdown
 *   - interactionMode: a string; UnitView only special-cases 'MOVE' (click-through
 *     while placing a move order). We never enter that mode, so 'NONE' always.
 *
 * `def` is read for def.name / def.role / def.isTank (createVisual) and
 * def.isTank again in updateVisual. Sim soldiers are always infantry in v1,
 * so def is a fixed small stand-in object per weapon class (not a full
 * UNIT_TEMPLATES entry -- sim_core has no such concept and does not need one).
 *
 * @param {Object} sim - a live SimCore instance
 */
function SimBattleAdapter(sim) {
  this.sim = sim;
  this.selectedUnit = null;
  this.interactionMode = 'NONE';
  this._onSelect = null; // optional external hook (scene wires this to update HUD)
}

/** def stand-ins per weapon class -- only the fields UnitView reads. */
SimBattleAdapter.DEF_BY_CLASS = {
  rifle: { name: 'Rifleman', role: 'infantry', isTank: false },
  smg: { name: 'Scout', role: 'infantry', isTank: false },
  mg: { name: 'Gunner', role: 'infantry', isTank: false },
  sniper: { name: 'Sniper', role: 'infantry', isTank: false },
  pistol: { name: 'Rifleman', role: 'infantry', isTank: false },
  at: { name: 'Rifleman', role: 'infantry', isTank: false },
};

/**
 * Converts one SimCore soldier snapshot into a UnitView-shaped unit.
 * @param {Object} s - sim.getSoldier() / sim.soldiers() snapshot
 * @returns {Object}
 */
SimBattleAdapter.prototype._toUnit = function (s) {
  const cls = (s.weapon && s.weapon.class) || 'rifle';
  const def = SimBattleAdapter.DEF_BY_CLASS[cls] || SimBattleAdapter.DEF_BY_CLASS.rifle;
  return {
    id: s.id,
    def: def,
    hp: s.hp,
    maxHp: 100, // sim_core soldiers always start at 100 (SS4); no per-unit maxHp concept
    q: s.q,
    r: s.r,
    team: s.team,
    hands: null,       // sim_core has no broken-hands concept; UnitView treats falsy as "ok"
    skills: [],        // sim_core has no equipment-skill badges (product-only concept)
    fusionCount: 0,    // sim_core has no card-fusion concept
    // passthrough fields UnitView does not read but callers (HUD overlay) want:
    _sim: s,
  };
};

/**
 * Live unit array, rebuilt from the current sim snapshot on every read.
 * This is a getter (not a cached field) so UnitView's per-frame poll of
 * window.gameLogic.units always sees the current tick's state.
 */
Object.defineProperty(SimBattleAdapter.prototype, 'units', {
  get: function () {
    return this.sim.soldiers().map((s) => this._toUnit(s));
  },
});

/**
 * UnitView calls this on sprite pointerdown. We resolve back to a live
 * unit-shaped object (selectedUnit must be one of the `units` entries for
 * UnitView's `window.gameLogic.selectedUnit === u` identity check -- SS SPEC
 * note: identity, not just id-equality) and notify the scene.
 * @param {Object} unit - the unit object UnitView had in hand (from `units`)
 */
SimBattleAdapter.prototype.onUnitClick = function (unit) {
  this.selectedUnit = unit;
  if (this._onSelect) this._onSelect(unit ? unit.id : null);
};

/**
 * Selects by soldier id (used by scene-level input, e.g. right-click-to-move
 * needs a currently-selected id even though the click landed on empty ground).
 * Re-derives a fresh unit object from `units` so identity matches what
 * UnitView's next frame will compare against (SS see onUnitClick note above).
 * @param {string|null} id
 */
SimBattleAdapter.prototype.selectById = function (id) {
  if (!id) { this.selectedUnit = null; return; }
  const found = this.units.find((u) => u.id === id);
  this.selectedUnit = found || null;
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SimBattleAdapter,
    buildBattleMap,
    makeBattleMapApi,
    toRenderGrid,
    BATTLE_MAP_W,
    BATTLE_MAP_H,
  };
}
if (typeof window !== 'undefined') {
  window.SimBattleAdapter = SimBattleAdapter;
  window.buildBattleMap = buildBattleMap;
  window.makeBattleMapApi = makeBattleMapApi;
  window.toRenderGrid = toRenderGrid;
}

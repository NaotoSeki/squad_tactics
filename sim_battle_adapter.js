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
 * axial(q,r) の2点を結ぶ hex 直線上のマス列を返す。両端を含む。
 * cube 座標で線形補間し cubeRound で最寄り hex へ丸める標準実装。
 *
 * 補間前に始点へ 1e-6 のオフセットを入れているのは、ちょうど辺をなぞる線で
 * 丸めが同点になり結果が揺れるのを防ぐため。ただしこの nudge は**始点側だけ**に
 * 効くので、a→b と b→a で経路が変わり得る。視線判定の対称性が要る箇所では
 * makeHasLos のように端点を正規化してから呼ぶこと。
 *
 * @param {{q: number, r: number}} a
 * @param {{q: number, r: number}} b
 * @returns {{q: number, r: number}[]}
 */
function hexLine(a, b) {
  const dq = a.q - b.q, dr = a.r - b.r;
  const N = (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;

  if (N === 0) return [a];

  const epsilon = 1e-6;
  const ax = a.q + epsilon;
  const az = a.r - epsilon * 2;
  const ay = -ax - az;
  const bx = b.q;
  const bz = b.r;
  const by = -bx - bz;
  const line = [];

  const cubeRound = (x, y, z) => {
    let rx = Math.round(x);
    let ry = Math.round(y);
    let rz = Math.round(z);
    const xDiff = Math.abs(rx - x);
    const yDiff = Math.abs(ry - y);
    const zDiff = Math.abs(rz - z);

    if (xDiff > yDiff && xDiff > zDiff) {
      rx = -ry - rz;
    } else if (yDiff > zDiff) {
      ry = -rx - rz;
    } else {
      rz = -rx - ry;
    }
    return { x: rx, y: ry, z: rz };
  };

  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const cube = cubeRound(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t);
    line.push({ q: cube.x, r: cube.z });
  }
  return line;
}

/**
 * 地形セルにもとづく視線判定関数を作る。
 *
 * hex 直線上の**中間マス**の遮光度(SIM_TUNING.TERRAIN_SIGHT_BLOCK)を積算し、
 * LOS_BLOCK_THRESHOLD 以上で遮る。両端は数えない — 自分の居る林から外は見えるし、
 * 林の中の敵も林の縁からなら見える。建物(building) と cost>=99 は一枚で完全遮蔽。
 *
 * 端点は座標順で正規化してから直線を引く。視線は物理的に対称でなければならず
 * （見えるなら見られる）、非対称だと「Aからは撃てるがBからは撃ち返せない」という
 * 一方的な射撃が発生する。hexLine の epsilon nudge は始点側にしか効かないため、
 * ここで順序を固定して打ち消す。
 *
 * @param {function({q: number, r: number}): Object|null} cellAt
 * @param {function(Object): boolean=} isPlayable 省略時は cell が truthy なら通行圏内
 * @returns {function({q: number, r: number}, {q: number, r: number}): boolean}
 */
function makeHasLos(cellAt, isPlayable) {
  const playable = isPlayable || ((cell) => !!cell);

  return (a, b) => {
    if (!a || !b) return true;   // 判定不能なら通す（安全側）

    const dq = a.q - b.q, dr = a.r - b.r;
    const distance = (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
    if (distance <= 1) return true;   // 同一マス・隣接は常に見える

    const tuning = typeof SIM_TUNING !== 'undefined' ? SIM_TUNING : null;
    const sightBlockTable = (tuning && tuning.TERRAIN_SIGHT_BLOCK) || {};
    const threshold = (tuning && typeof tuning.LOS_BLOCK_THRESHOLD === 'number')
      ? tuning.LOS_BLOCK_THRESHOLD : 1.0;

    // 対称性の担保: 常に同じ端点から線を引く。遮光度は総和なので順序に依存しない。
    const swap = (a.q !== b.q) ? (a.q > b.q) : (a.r > b.r);
    const from = swap ? b : a;
    const to = swap ? a : b;

    const line = hexLine(from, to);
    let sightBlock = 0;

    for (let i = 1; i < line.length - 1; i++) {
      const cell = cellAt(line[i]);
      if (!cell || !playable(cell)) continue;   // 盤外は遮蔽物ではない

      if (cell.building || (typeof cell.cost === 'number' && cell.cost >= 99)) return false;

      // セルが自前の遮光度を持つならそちらが正本（立体物台帳から導出した
      // per-hex の値。低木・柵・薪など、地形の種別だけでは表せないもの）。
      // 持たないセルは従来どおり地形id表を引く。
      const block = (typeof cell.sightBlock === 'number')
        ? cell.sightBlock : sightBlockTable[cell.id];
      if (typeof block === 'number') sightBlock += block;
      if (sightBlock >= threshold) return false;
    }
    return true;
  };
}

/**
 * sim_core MapApi (SIM_CORE_SPEC.md SS3) over a fixed terrain grid.
 * @param {{grid, W, H}} mapData
 * @returns {Object} MapApi
 */
function makeBattleMapApi(mapData) {
  const { grid, W, H } = mapData;
  const coverTable = (typeof SIM_TUNING !== 'undefined' && SIM_TUNING.TERRAIN_COVER) || {};

  const cellAt = (hex) => {
    if (!hex || hex.q < 0 || hex.q >= W || hex.r < 0 || hex.r >= H) return null;
    const col = grid[hex.q];
    return col ? col[hex.r] : null;
  };

  return {
    _grid: grid, _W: W, _H: H,
    dist: (a, b) => {
      const dq = a.q - b.q, dr = a.r - b.r;
      return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
    },
    // hex直線上の中間マスの遮光度を積算し、閾値以上なら遮る（両端は数えない）。
    hasLos: makeHasLos(cellAt),
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
  this._onUnitCommand = null; // tactical-pause click may consume the selection click
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
    maxHp: s.maxHp || 100,
    q: s.q,
    r: s.r,
    team: s.team,
    hands: null,       // sim_core has no broken-hands concept; UnitView treats falsy as "ok"
    skills: Array.isArray(s.skills) ? s.skills.slice() : [],
    traits: Array.isArray(s.traits) ? s.traits.slice() : [],
    effects: Object.assign({}, s.effects || {}),
    hasRadio: !!s.hasRadio,
    fusionCount: 0,    // sim_core has no card-fusion concept
    weapon: s.weapon,
    _rtwpTargetId: s.engageTargetId || null,
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
  if (this._onUnitCommand && this._onUnitCommand(unit) === true) return;
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

// ---------------------------------------------------------------------------
// 4. PS正本マップ上で sim を回す（2026-07-30）
//
// 合成グリッド(buildBattleMap)は「遮蔽0.5の市街に全員が潜る」盤面なので、開豁地が
// 存在せず自動Coverを観察できない。本編と同じ PS 30hex 地形の上で回すための経路。
// RuralV29Map.generate() が game.map[q][r] へ TERRAIN セルを敷く形は buildBattleMap
// の返す grid と同形なので、そのまま MapApi へ載せられる。
// ---------------------------------------------------------------------------

/**
 * PS正本マップ(ps_seed_*)の地形を sim 用グリッドとして得る。
 * @param {string} [seedName] - PS_BATTLEFIELDS のキー。省略時は RuralV29Map の通常選択
 * @returns {{grid: Array<Array<Object>>, W: number, H: number, variant: Object}}
 */
function buildPsBattleMap(seedName) {
  const rural = (typeof window !== 'undefined') ? window.RuralV29Map : null;
  if (!rural || typeof rural.generate !== 'function') {
    throw new Error('RuralV29Map が読み込まれていません（logic_map_rural_v29.js）');
  }
  if (seedName) rural.fixedVariant = seedName;

  // generate が触るのは game.map だけなのでスタブで足りる
  const stub = {};
  rural.generate(stub);
  if (!stub.map) throw new Error('RuralV29Map.generate が map を生成しませんでした');

  return { grid: stub.map, W: MAP_W, H: MAP_H, variant: rural.lastVariant };
}

/**
 * PS地形グリッド上の sim_core MapApi。
 *
 * 合成マップ用の makeBattleMapApi と違い、遮蔽は id 参照表ではなく**セルが持つ
 * cover 値(0..100)を直接**使う。PS地形には FIELD(id7) や BLDG(id6) のように
 * SIM_TUNING.TERRAIN_COVER に無い id が出るため、id 表では 0 に落ちてしまう。
 *
 * 進入不可（建物・cost>=IMPASSABLE_COST）は moveCost で **Infinity** を返す。
 * 99 のような「高いだけの有限値」だと自衛の退避先として選ばれて建物へ突っ込む。
 *
 * @param {{grid, W, H}} mapData
 * @returns {Object} MapApi
 */
const IMPASSABLE_COST = 99;

function makePsBattleMapApi(mapData) {
  const grid = mapData.grid, W = mapData.W, H = mapData.H;
  const coverTable = (typeof SIM_TUNING !== 'undefined' && SIM_TUNING.TERRAIN_COVER) || {};

  const cellAt = (hex) => {
    if (!hex || hex.q < 0 || hex.q >= W || hex.r < 0 || hex.r >= H) return null;
    const col = grid[hex.q];
    return col ? col[hex.r] : null;
  };
  // 30hexの盤面は MAP_W×MAP_H キャンバス内の島で、外側は VOID(id -1)
  const isPlayable = (cell) => !!cell && cell.id !== -1;

  return {
    _grid: grid, _W: W, _H: H,
    dist: (a, b) => {
      const dq = a.q - b.q, dr = a.r - b.r;
      return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
    },
    // hex直線上の中間マスの遮光度を積算し、閾値以上なら遮る（両端は数えない）。
    hasLos: makeHasLos(cellAt, isPlayable),
    cover: (hex) => {
      const cell = cellAt(hex);
      if (!isPlayable(cell)) return 0;
      if (typeof cell.cover === 'number') return Math.max(0, Math.min(1, cell.cover / 100));
      return coverTable[cell.id] != null ? coverTable[cell.id] : 0;
    },
    moveCost: (from, to) => {
      const cell = cellAt(to || from);
      if (!isPlayable(cell)) return Infinity;
      if (cell.building) return Infinity;
      const cost = typeof cell.cost === 'number' ? cell.cost : IMPASSABLE_COST;
      return cost >= IMPASSABLE_COST ? Infinity : cost;
    },
    neighbors: (hex) => [
      { q: hex.q + 1, r: hex.r }, { q: hex.q - 1, r: hex.r },
      { q: hex.q, r: hex.r + 1 }, { q: hex.q, r: hex.r - 1 },
      { q: hex.q + 1, r: hex.r - 1 }, { q: hex.q - 1, r: hex.r + 1 },
    ].filter((h) => isPlayable(cellAt(h))),
  };
}

/**
 * 実体のある hex（VOID でない）の座標範囲を返す。
 *
 * カメラの可動域を論理グリッド全体(MAP_W x MAP_H)から作ると、PS盤面のように
 * 30hex しか実体が無い場合に広大な VOID へパンできてしまう。描画・可動域の
 * 基準は常に「絵がある範囲」でなければならない。
 *
 * @param {{grid, W, H}} mapData
 * @returns {{minQ,maxQ,minR,maxR,count}|null} 実体が無ければ null
 */
function validHexExtent(mapData) {
  let minQ = Infinity, maxQ = -Infinity, minR = Infinity, maxR = -Infinity, count = 0;
  for (let q = 0; q < mapData.W; q++) {
    for (let r = 0; r < mapData.H; r++) {
      const cell = mapData.grid[q] && mapData.grid[q][r];
      if (!cell || cell.id === -1) continue;
      count++;
      if (q < minQ) minQ = q;
      if (q > maxQ) maxQ = q;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
    }
  }
  return count ? { minQ: minQ, maxQ: maxQ, minR: minR, maxR: maxR, count: count } : null;
}

/**
 * 盤面から「配置に使える hex」を集める。開豁地(遮蔽薄)と遮蔽地を分けて返すので、
 * 自動Coverが観察できる初期配置（露出した兵士を混ぜる）を組める。
 * @param {Object} api - makePsBattleMapApi の返り値
 * @param {number} [exposedBelow=0.2] - これ未満を開豁地とみなす
 */
function collectPlayableHexes(api, exposedBelow) {
  const limit = exposedBelow != null ? exposedBelow : 0.2;
  const exposed = [], covered = [];
  for (let q = 0; q < api._W; q++) {
    for (let r = 0; r < api._H; r++) {
      const hex = { q: q, r: r };
      if (!isFinite(api.moveCost(hex, hex))) continue;
      (api.cover(hex) < limit ? exposed : covered).push(hex);
    }
  }
  return { exposed: exposed, covered: covered };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SimBattleAdapter,
    buildBattleMap,
    makeBattleMapApi,
    toRenderGrid,
    buildPsBattleMap,
    makePsBattleMapApi,
    collectPlayableHexes,
    validHexExtent,
    hexLine,
    makeHasLos,
    BATTLE_MAP_W,
    BATTLE_MAP_H,
  };
}
if (typeof window !== 'undefined') {
  window.SimBattleAdapter = SimBattleAdapter;
  window.buildBattleMap = buildBattleMap;
  window.makeBattleMapApi = makeBattleMapApi;
  window.toRenderGrid = toRenderGrid;
  window.buildPsBattleMap = buildPsBattleMap;
  window.makePsBattleMapApi = makePsBattleMapApi;
  window.collectPlayableHexes = collectPlayableHexes;
  window.validHexExtent = validHexExtent;
  window.hexLine = hexLine;
  window.makeHasLos = makeHasLos;
}

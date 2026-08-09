/**
 * sim_policy.js -- WS-C (NORTH_STAR SS4.1 / SIM_CORE_SPEC.md SS13)
 *
 * Pure JS, zero dependencies, headless. No window/document/Phaser/setTimeout/Math.random.
 * Requireable from node, and exposed as a global in the browser (UMD-ish, see bottom).
 *
 * TraitPolicy implements the SS8 Policy contract (`decide(soldierView, worldView, rng)`).
 * Baseline behaviour mirrors sim_core.js's DefaultPolicy; `soldierView.traits` steers
 * the decision away from that baseline per SS13's trait table. All numeric knobs live
 * in TRAIT_MODS below -- no magic numbers inline.
 */

// ---------------------------------------------------------------------------
// TRAIT_MODS -- the sole table of trait-driven numeric offsets (SS13)
// ---------------------------------------------------------------------------

const TRAIT_MODS = {
  aggressive: {
    ENGAGE_RANGE_BONUS: 2,     // +2hex to the effective engagement range
    DEFAULT_FIRE_MODE: 'suppress', // default fireMode when no order present
  },
  cautious: {
    MIN_SELF_MOVE_COVER: 0.3,  // will not self-initiate a MOVE_TO into cover < this
  },
  calm: {
    ENGAGE_RANGE_FRACTION: 2 / 3, // withholds fire until dist <= rngMax * this fraction
    HARASS_FIRE_P: 0.15,            // harassing fire probability for suppressed targets (60% of default 0.25)
  },
  timid: {
    FREEZE_AT_SUPPRESSION: 40, // suppression >= this => self-initiated actions stop
  },
};

// ---------------------------------------------------------------------------
// TraitPolicy
// ---------------------------------------------------------------------------

/**
 * 進入可能か。moveCost が Infinity/0/負なら不可。実装差で不明なら通す。
 */
function isPassable(map, from, to) {
  if (typeof map.moveCost !== 'function') return true;
  let cost = null;
  try { cost = map.moveCost(from, to); } catch (e) { cost = null; }
  if (typeof cost !== 'number') return true;
  return isFinite(cost) && cost > 0;
}

/**
 * 自分から見えており、退避経路の露出計算に使う敵脅威を集める。
 *
 * 「見えている敵だけ」を数えるのは知識モデルの都合でもある — 兵士は見えている
 * 銃口を恐れるのであって、盤面全体の敵配置を知っているわけではない。
 *
 * @returns {Array<{q:number, r:number, weight:number}>}
 */
function collectThreats(soldierView, worldView) {
  const s = soldierView;
  const map = worldView.map;
  const T = worldView.tuning || {};
  const soldiers = worldView.soldiers || [];

  // LOS 実装がない MapApi では露出評価不能なので、従来の遮蔽探索へ degrade する。
  if (!map || typeof map.hasLos !== 'function') return [];

  const exposureWeights = T.COVER_SEEK_EXPOSURE_WEIGHT || null;
  const shooterEffectiveness = T.PHIT_SHOOTER_SUPPRESSED_PINNED || null;
  const here = { q: s.q, r: s.r };
  const threats = [];

  for (let i = 0; i < soldiers.length; i++) {
    const o = soldiers[i];
    if (!o || o.hp <= 0 || o.team === s.team) continue;

    let visible = false;
    try { visible = map.hasLos(here, { q: o.q, r: o.r }); } catch (e) { visible = false; }
    if (!visible) continue;

    let classWeight = 1;
    if (exposureWeights) {
      if (o.weapon && o.weapon.class && exposureWeights[o.weapon.class] != null) {
        classWeight = exposureWeights[o.weapon.class];
      } else if (exposureWeights.default != null) {
        classWeight = exposureWeights.default;
      }
    }

    // 制圧されている敵は撃ってこない。射撃有効度の係数を流用する（新定数を作らない）。
    let effectiveness = 1;
    if (shooterEffectiveness) {
      if (o.state === 'pinned' && shooterEffectiveness.pinned != null) {
        effectiveness = shooterEffectiveness.pinned;
      } else if (o.state === 'suppressed' && shooterEffectiveness.suppressed != null) {
        effectiveness = shooterEffectiveness.suppressed;
      }
    }

    threats.push({ q: o.q, r: o.r, weight: classWeight * effectiveness, index: i });
  }

  if (typeof map.dist === 'function') {
    threats.sort(function (a, b) {
      let da = 0;
      let db = 0;
      try { da = map.dist(here, a); } catch (e) { da = 0; }
      try { db = map.dist(here, b); } catch (e) { db = 0; }
      if (typeof da !== 'number') da = 0;
      if (typeof db !== 'number') db = 0;
      if (da !== db) return da - db;
      return a.index - b.index;
    });
  }

  const maxThreats = T.COVER_SEEK_MAX_THREATS != null ? T.COVER_SEEK_MAX_THREATS : 6;
  const limited = threats.slice(0, maxThreats);
  for (let i = 0; i < limited.length; i++) delete limited[i].index;
  return limited;
}

/**
 * 経路が「何人にどれだけ見られているか」の総量。findCoverPath の内部評価と同じ
 * 尺度（脅威の weight を、視線の通るマスごとに積算）を経路全体へ適用したもの。
 *
 * 移動モードの判断に使う: 見られていない経路なら歩いても這っても同じなので、
 * 性格による分岐は**露出がある時にだけ**意味を持つ。
 *
 * @returns {number} 0 なら死角。大きいほど射線に晒される
 */
function pathExposure(soldierView, worldView, path) {
  if (!path || !path.length) return 0;
  const map = worldView && worldView.map;
  if (!map || typeof map.hasLos !== 'function') return 0;
  const threats = collectThreats(soldierView, worldView);
  if (!threats.length) return 0;

  let total = 0;
  for (let i = 0; i < path.length; i++) {
    for (let j = 0; j < threats.length; j++) {
      let visible = false;
      try { visible = map.hasLos({ q: threats[j].q, r: threats[j].r }, path[i]); } catch (e) { visible = false; }
      if (visible) total += threats[j].weight;
    }
  }
  return total;
}

/**
 * 遮蔽へ向かう短距離経路を幅優先で探す。
 *
 * 隣接1マスしか見ないと、大きな畑の中にいる兵士は隣接6マスすべてが同じ薄い遮蔽で
 * **逃げ場が無く**動けない（2026-07-30 実測: A1/A3 が畑の真ん中で候補0）。
 * 「野原から林へ走る」を成立させるには数マス先を見る必要がある。
 *
 * v2（2026-07-31）は経路途中の露出も評価する。**移動中の目標は hex の遮蔽を
 * 享受しない**（sim_core の射撃解決で遮蔽乗算が PHIT_MOVING_MULT に置き換わる）
 * ため、経路の安全性は遮蔽ではなく「敵から見えているか」だけで決まる。これは
 * NORTH_STAR §3.2 殺傷ベクトル4「開豁地移動への持続射撃 = MGの存在意義」を
 * policy 側にも効かせるもので、射線を横切る退避を自ら避けさせるのが狙い。
 *
 * 距離優先（近いものから）、同距離なら露出調整後の価値が高い方を選ぶ。深い方が
 * 高価値でも遡らない — 開豁地では1マスでも早く遮蔽へ入る方が正しく、経路が伸びれば
 * その分だけ露出時間も伸びる（risk が経路長に比例して積算されるので自動的に効く）。
 *
 * **代償は「渡る地面」であって「辿り着く地面」ではない**: risk は到達マスを除いた
 * 通過マスだけで積算する。到達マスの危険度は遮蔽値 c として既に評価されており、
 * そこに露出コストも掛けると二重計上になる。実害も出た — 実マップで最も自然な退避
 * である 畑(0.15)→森林(0.25) は MIN_GAIN 込みで余裕ゼロのため、到達マスに課金すると
 * 「見られている限り絶対に林へ入れない」という馬鹿げた挙動になった（2026-07-31 実測）。
 * この定義なら1マス退避は通過マス0＝常に許され、長距離ダッシュだけが罰される。
 *
 * 例外は PINNED（exposure.includeDest）。伏射前進は移動が2倍遅い（sim_core の
 * proneMult）ので、匍匐で入る先の射線もそのまま危険として数える。
 *
 * @param {{threats: Array, cost: number, includeDest: boolean}|null} exposure
 * @returns {{path: Array<{q,r}>, cover: number, value: number, risk: number}|null}
 */
function findCoverPath(map, start, required, minDest, maxSteps, exposure) {
  const keyOf = (h) => h.q + ',' + h.r;
  const seen = {};
  seen[keyOf(start)] = true;
  let frontier = [{ hex: start, path: [] }];

  // 脅威・コスト未指定時は、候補選択を従来の生遮蔽値比較と完全に同じに保つ。
  const threats = exposure && exposure.threats;
  const exposureCost = exposure && exposure.cost;
  const includeDest = !!(exposure && exposure.includeDest);
  const useExposure = !!(threats && threats.length > 0 && exposureCost);
  const exposureMemo = {};

  const exposureOf = function (hex) {
    if (!useExposure || typeof map.hasLos !== 'function') return 0;
    const k = keyOf(hex);
    if (exposureMemo[k] != null) return exposureMemo[k];

    let exposure = 0;
    for (let i = 0; i < threats.length; i++) {
      const t = threats[i];
      let visible = false;
      try { visible = map.hasLos({ q: t.q, r: t.r }, hex); } catch (e) { visible = false; }
      if (visible) exposure += t.weight;
    }
    exposureMemo[k] = exposure;
    return exposure;
  };

  for (let depth = 1; depth <= maxSteps; depth++) {
    const next = [];
    let best = null;

    for (let i = 0; i < frontier.length; i++) {
      const node = frontier[i];
      const cells = map.neighbors(node.hex) || [];
      for (let j = 0; j < cells.length; j++) {
        const cell = cells[j];
        if (!cell) continue;
        const k = keyOf(cell);
        if (seen[k]) continue;
        seen[k] = true;
        if (!isPassable(map, node.hex, cell)) continue;

        const c = map.cover(cell);
        if (typeof c !== 'number') continue;
        const path = node.path.concat([{ q: cell.q, r: cell.r }]);

        // 露出コストは非負なので、生遮蔽値での足切りは常に admissible。
        if (c >= minDest && c >= required - 1e-9) {
          let risk = 0;
          let value = c;

          if (useExposure) {
            // 到達マス(path の末尾)は数えない。渡る地面だけが代償。
            const upto = includeDest ? path.length : path.length - 1;
            for (let p = 0; p < upto; p++) risk += exposureOf(path[p]);
            value = c - exposureCost * risk;
          }

          if (value >= required - 1e-9) {
            if (!best || (useExposure ? value > best.value : c > best.cover)) {
              best = { path: path, cover: c, value: value, risk: risk };
            }
          }
        }
        next.push({ hex: cell, path: path });
      }
    }

    if (best) return best;   // この距離で見つかった中の最良（=最短距離優先）
    frontier = next;
    if (!frontier.length) break;
  }
  return null;
}

/**
 * 指定された1マスまでの経路を幅優先で探す（「あの塀まで」の解決）。
 *
 * sim_core の移動は movePath の要素へ隣接判定なしで座標を代入する（=1要素につき
 * 1hex進む前提）。遠くの hex を要素1個の経路として渡すとワープするので、
 * 命令で場所を指定された時も必ず1マスずつ刻んだ経路を作る必要がある。
 *
 * @returns {Array<{q,r}>|null} start を含まない経路。到達不能なら null
 */
function findPathTo(map, start, goal, maxSteps) {
  if (!goal || (goal.q === start.q && goal.r === start.r)) return null;
  const keyOf = (h) => h.q + ',' + h.r;
  const goalKey = keyOf(goal);
  const seen = {};
  seen[keyOf(start)] = true;
  let frontier = [{ hex: start, path: [] }];

  for (let depth = 1; depth <= maxSteps; depth++) {
    const next = [];
    for (let i = 0; i < frontier.length; i++) {
      const node = frontier[i];
      const cells = map.neighbors(node.hex) || [];
      for (let j = 0; j < cells.length; j++) {
        const cell = cells[j];
        if (!cell) continue;
        const k = keyOf(cell);
        if (seen[k]) continue;
        seen[k] = true;
        if (!isPassable(map, node.hex, cell)) continue;
        const path = node.path.concat([{ q: cell.q, r: cell.r }]);
        if (k === goalKey) return path;
        next.push({ hex: cell, path: path });
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return null;
}

/**
 * A known enemy behind cover should cause a bounded, covered approach rather
 * than permanent observation.  Search nearby cells only; prefer a firing
 * position, otherwise make safe progress.  Occupied/adjacent cells are
 * penalized and a stable soldier-specific choice spreads a squad over equally
 * useful cover instead of collapsing it onto one hex.
 */
function findCautiousApproach(s, target, worldView) {
  const map = worldView && worldView.map;
  const T = (worldView && worldView.tuning) || {};
  if (!map || typeof map.neighbors !== 'function' || typeof map.cover !== 'function'
      || typeof map.dist !== 'function' || typeof map.hasLos !== 'function') return null;

  const start = { q: s.q, r: s.r };
  const targetHex = { q: target.q, r: target.r };
  const startDist = map.dist(start, targetHex);
  const maxSteps = T.CAUTIOUS_APPROACH_MAX_STEPS != null ? T.CAUTIOUS_APPROACH_MAX_STEPS : 5;
  const baseMinCover = T.CAUTIOUS_APPROACH_MIN_COVER != null ? T.CAUTIOUS_APPROACH_MIN_COVER : 0.25;
  const minCover = (s.traits || []).indexOf('cautious') !== -1
    ? Math.max(baseMinCover, TRAIT_MODS.cautious.MIN_SELF_MOVE_COVER) : baseMinCover;
  const openCover = T.AUTO_MOVE_OPEN_COVER != null ? T.AUTO_MOVE_OPEN_COVER : 0.2;
  const occupied = {};
  (worldView.soldiers || []).forEach(function (o) {
    if (o && o.hp > 0 && o.id !== s.id) occupied[o.q + ',' + o.r] = o;
  });

  const keyOf = function (h) { return h.q + ',' + h.r; };
  const seen = {}; seen[keyOf(start)] = true;
  let frontier = [{ hex: start, path: [], minPathCover: 1, exposed: 0 }];
  const candidates = [];
  for (let depth = 1; depth <= maxSteps; depth++) {
    const next = [];
    for (let n = 0; n < frontier.length; n++) {
      const node = frontier[n];
      const neighbors = map.neighbors(node.hex) || [];
      for (let i = 0; i < neighbors.length; i++) {
        const cell = neighbors[i];
        if (!cell || seen[keyOf(cell)] || !isPassable(map, node.hex, cell)) continue;
        seen[keyOf(cell)] = true;
        let cover = 0;
        try { cover = Number(map.cover(cell)) || 0; } catch (e) { cover = 0; }
        let watched = false;
        try { watched = !!map.hasLos(targetHex, cell); } catch (e) { watched = false; }
        const exposed = node.exposed + ((watched && cover < openCover) ? 1 : 0);
        const path = node.path.concat([{ q: cell.q, r: cell.r }]);
        const minPathCover = Math.min(node.minPathCover, cover);
        const entry = { hex: cell, path: path, minPathCover: minPathCover, exposed: exposed };
        next.push(entry);

        const dist = map.dist(cell, targetHex);
        const progress = startDist - dist;
        if (progress <= 0 || cover < minCover || occupied[keyOf(cell)] || exposed > 0) continue;
        let firing = false;
        try { firing = map.hasLos(cell, targetHex)
          && dist <= (s.weapon && s.weapon.rngMax != null ? s.weapon.rngMax : Infinity)
          && dist >= (s.weapon && s.weapon.rngMin != null ? s.weapon.rngMin : 0); } catch (e) { firing = false; }
        let nearAllies = 0;
        (worldView.soldiers || []).forEach(function (o) {
          if (!o || o.hp <= 0 || o.id === s.id || o.team !== s.team) return;
          if (map.dist(cell, { q: o.q, r: o.r }) <= 1) nearAllies++;
        });
        const score = (firing ? 100 : 0) + progress * 5 + cover * 12 - depth - nearAllies * 4;
        candidates.push({ path: path, score: score, firing: firing,
          minPathCover: minPathCover, key: keyOf(cell) });
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  if (!candidates.length) return null;
  const firingExists = candidates.some(function (c) { return c.firing; });
  const useful = candidates.filter(function (c) { return !firingExists || c.firing; });
  useful.sort(function (a, b) { return b.score - a.score || a.key.localeCompare(b.key); });
  const bestScore = useful[0].score;
  const peers = useful.filter(function (c) { return c.score >= bestScore - 3; }).slice(0, 4);
  let hash = 0;
  const id = String(s.id || '');
  for (let i = 0; i < id.length; i++) hash = ((hash * 31) + id.charCodeAt(i)) >>> 0;
  const chosen = peers[hash % peers.length];
  return {
    type: 'MOVE_TO', soldierIds: [s.id],
    payload: { path: chosen.path,
      mode: chosen.minPathCover < openCover ? 'crawl' : 'auto', selfInitiated: true },
    note: chosen.firing ? '接敵: 遮蔽射点へ接近' : '接敵: 遮蔽伝いに接近',
  };
}

const TraitPolicy = {
  /**
   * 移動命令の関門（2026-08-02）。**命令された移動にだけ**掛かり、「どう渡るか」を
   * 現場の性格で書き換える。NORTH_STAR §4.1「個性 = 無命令時の行動差」を、命令への
   * 応答差まで広げたもの — 走れと言われて走る兵と、這って寄る兵が居る。
   *
   * 自発移動（selfPreserve 等）は sim_core 側で素通りする（payload.selfInitiated）。
   * 自分の判断を自分で検閲すると、トレイト補正が二重に乗る。
   *
   * @param {{path: Array, mode: string}} payload - 命令された経路と移動モード
   * @returns {{mode?: string, refuse?: boolean, note?: string}|null} null = 命令どおり
   */
  vetMoveOrder: function (soldierView, worldView, rng, payload) {
    const s = soldierView;
    const traits = s.traits || [];
    const has = function (t) { return traits.indexOf(t) !== -1; };
    const T = (worldView && worldView.tuning) || {};
    const requested = (payload && payload.mode) || 'walk';

    // 臆病は制圧下では命令が通らない。seekCoverForOrder と同じ閾値・同じ見せ方に
    // 揃える（黙って無視せず、なぜ動かないかをノートで出す）。
    if (has('timid') && s.suppression >= TRAIT_MODS.timid.FREEZE_AT_SUPPRESSION) {
      return { refuse: true, note: '臆病: 竦んで動けない' };
    }

    // 釘付けの兵は誰であれ這うしかない。sim_core の _effectiveMoveMode が強制するが、
    // 命令側でも降格させて「走れと言ったのに這っている」理由を可視化する。
    const pinnedAt = T.PINNED_AT != null ? T.PINNED_AT : 80;
    if (requested === 'rush' && s.suppression >= pinnedAt) {
      return { mode: 'crawl', note: '釘付け: 走れない、匍匐で進む' };
    }

    // 露出のない経路ではどう渡っても同じなので、性格差を出す意味がない。
    const exposure = pathExposure(s, worldView, payload && payload.path);
    if (exposure <= 0) return null;

    // 慎重は「見られている地面を走って渡る」を拒む。動かないのではなく、這ってでも
    // 行く — cautious は臆病ではなく、生き延びる道を選ぶ性格として実装する。
    if (has('cautious') && requested === 'rush') {
      return { mode: 'crawl', note: '慎重: 走らず匍匐で寄る' };
    }
    // 攻撃的は歩けと言われても駆ける。速く着く代わりに息を切らす（§4.1 の
    // 「弾を浪費する」と同じ質の、勝手に前に出る癖）。
    if (has('aggressive') && requested === 'walk') {
      return { mode: 'rush', note: '攻撃的: 駆け足で行く' };
    }
    return null;
  },

  /**
   * 次の1マスをどう渡るか（2026-08-02 ディレクター指示）。
   *
   * プレイヤーの命令は「移動」だけ。敵が居る戦場で「歩け」と命じるのは不自然で、
   * 遮蔽伝いに寄るのか・様子を窺うのか・開豁地を走り抜けるのかは、そのマスへ
   * 踏み出す直前に現場が決める（§3.4 三現主義）。ここがその判断。
   *
   *   撃たれている／制圧されている → 匍匐（伏せたまま進む）
   *   次が開豁地で敵に見られている → ダッシュ。ただし遮蔽から出るなら一拍様子を窺う
   *   次に遮蔽がある               → 歩き（遮蔽伝いに慎重に）
   *
   * @returns {{mode:string, observeT:number, note?:string}}
   */
  pickMoveStep: function (soldierView, worldView, nextHex) {
    const s = soldierView;
    const T = (worldView && worldView.tuning) || {};
    const map = worldView && worldView.map;
    if (!map || !nextHex) return { mode: 'walk', observeT: 0 };

    const pinnedAt = T.PINNED_AT != null ? T.PINNED_AT : 80;
    const underFireWindow = T.COVER_SEEK_UNDER_FIRE_T != null ? T.COVER_SEEK_UNDER_FIRE_T : 30;
    const tick = (typeof worldView.tick === 'number') ? worldView.tick : null;
    const beingShot = (tick != null && typeof s.underFireT === 'number')
      && (tick - s.underFireT) <= underFireWindow;

    // 弾が来ている間に立ち上がるのは自殺。伏せたまま進む
    if (s.suppression >= pinnedAt || beingShot) {
      return { mode: 'crawl', observeT: 0, note: '匍匐で前進' };
    }

    let nextCover = 0;
    try { nextCover = map.cover(nextHex) || 0; } catch (e) { nextCover = 0; }
    const openAt = T.AUTO_MOVE_OPEN_COVER != null ? T.AUTO_MOVE_OPEN_COVER : 0.2;

    // 次のマスが見られているか（1挺でも射線が通れば開豁地の横断とみなす）
    const threats = collectThreats(s, worldView);
    let watched = false;
    for (let i = 0; i < threats.length && !watched; i++) {
      try { watched = map.hasLos({ q: threats[i].q, r: threats[i].r }, nextHex); } catch (e) { watched = false; }
    }

    if (nextCover < openAt && watched) {
      // 遮蔽の中から開豁地へ出る時だけ、しゃがんで頃合いを窺う。既に開豁地に
      // 居るなら止まる方が危ないので、そのまま走り抜ける。
      let hereCover = 0;
      try { hereCover = map.cover({ q: s.q, r: s.r }) || 0; } catch (e) { hereCover = 0; }
      const fromCover = hereCover >= openAt;
      return {
        mode: 'rush',
        observeT: fromCover ? (T.AUTO_MOVE_OBSERVE_T || 0) : 0,
        note: fromCover ? '様子を窺って開豁地へ' : '開豁地を走り抜ける',
      };
    }
    return { mode: 'walk', observeT: 0, note: watched ? null : '遮蔽伝いに前進' };
  },

  /**
   * 自衛の反射（自動Cover）。撃たれて露出しているなら隣接のより濃い遮蔽へ退避する。
   *
   * `decide` から独立させてあるのは、**射撃命令が立っている間も自衛だけは通す**ため。
   * sim_core は currentOrder があると decide を呼ばないので、TARGET 命令は永続する
   * 性質上「一度撃てと言われた兵士は以後永久に自己判断しない」状態になり、撃たれても
   * 遮蔽へ移らなくなる。NORTH_STAR §3.2 は pinned を「自衛のみ」と定めているので、
   * 自衛は命令に割り込んでよい。移動命令(MOVE_TO)には割り込まない — プレイヤーが
   * 意図した機動を二度手間にしないため（呼び出し側 sim_core が制御する）。
   *
   * @returns {Object|null} MOVE_TO intent、退避不要/不能なら null
   */
  selfPreserve: function (soldierView, worldView, rng) {
    const s = soldierView;
    const traits = s.traits || [];
    const has = function (t) { return traits.indexOf(t) !== -1; };
    const T = worldView.tuning || {};
    const map = worldView.map;

    const coverSeekAt = T.COVER_SEEK_AT != null ? T.COVER_SEEK_AT
      : (T.SUPPRESSED_AT != null ? T.SUPPRESSED_AT : 50);
    const pinnedAt = T.PINNED_AT != null ? T.PINNED_AT : 80;
    const seekMaxCover = T.COVER_SEEK_MAX_COVER != null ? T.COVER_SEEK_MAX_COVER : 0.35;
    const seekMinGain = T.COVER_SEEK_MIN_GAIN != null ? T.COVER_SEEK_MIN_GAIN : 0.2;
    const underFireWindow = T.COVER_SEEK_UNDER_FIRE_T != null ? T.COVER_SEEK_UNDER_FIRE_T : 30;

    // 主トリガは「今撃たれているか」。制圧値は集中射撃で 0 か 100 に張り付き、
    // 中間帯をほぼ通過しないため（2026-07-30 実測: 10名が 0,0,0,0,4,6,26,0,100,100)、
    // 値の帯だけを条件にすると原理的にほぼ発火しない。弾が来たから動く方が自然。
    // 制圧値の帯は補助トリガとして残す（撃たれていなくても既に制圧されているケース）。
    const tick = (typeof worldView.tick === 'number') ? worldView.tick : null;
    const recentlyShotAt = (tick != null && typeof s.underFireT === 'number')
      ? (tick - s.underFireT) <= underFireWindow
      : false;
    const inSuppressionBand = s.suppression >= coverSeekAt;
    if (!recentlyShotAt && !inSuppressionBand) return null;

    // PINNED でも「匍匐で隣の遮蔽へ」だけは許す。§3.2 は pinned を「自衛のみ」と
    // 定めており、弾雨の中で遮蔽へ這うのはまさに自衛そのもの。ただし走って
    // 数マス渡るのは自殺なので、PINNED 時は 1hex に制限する。
    const pinned = s.suppression >= pinnedAt;
    const maxSteps = pinned
      ? 1
      : (T.COVER_SEEK_MAX_STEPS != null ? T.COVER_SEEK_MAX_STEPS : 4);
    if (s.state === 'move' || (s.movePath && s.movePath.length > 0)) return null;
    if (!map || typeof map.neighbors !== 'function' || typeof map.cover !== 'function') return null;
    // timid は自発行動が止まる（SS13）。竦んで動けない方が性格として正しい。
    if (has('timid') && s.suppression >= TRAIT_MODS.timid.FREEZE_AT_SUPPRESSION) return null;

    const here = { q: s.q, r: s.r };
    const hereCover = map.cover(here);
    if (typeof hereCover !== 'number' || hereCover >= seekMaxCover) return null;

    // cautious は薄い遮蔽へは動かない。既存の movePath ガードと同じ閾値を使う。
    const minDest = has('cautious') ? TRAIT_MODS.cautious.MIN_SELF_MOVE_COVER : 0;
    // 必要な遮蔽。**以上**で採用する（超過ではない）。地形の遮蔽値は 0.05 刻みに
    // 量子化されていて（草0.10/畑0.15/林0.25/道0.35/町0.40）、改善幅がちょうど
    // 閾値に一致するケースが頻発する。厳密不等号だと畑0.15→林0.25(要求0.25)が
    // 常に落ちて、実質どこへも退避できなかった（2026-07-30 実機で確認）。
    const required = hereCover + seekMinGain;

    // 経路途中の露出を遮蔽換算で差し引く（§3.2 殺傷ベクトル4）。
    // PINNED 時は maxSteps=1 なので通過マスが無く、そのままでは露出評価が効かない。
    // 匍匐は移動が2倍遅い（sim_core の proneMult）ぶん射線に長く晒されるので、
    // 這って入る先の射線を数える（includeDest）ことで「見られている隣へは這わない」
    // を成立させる。走って渡る時と違い、伏せたままなら現状維持も有力な選択肢。
    const threats = collectThreats(s, worldView);
    const found = findCoverPath(map, here, required, minDest, maxSteps, {
      threats: threats,
      cost: T.COVER_SEEK_EXPOSURE_COST != null ? T.COVER_SEEK_EXPOSURE_COST : 0.05,
      includeDest: pinned,
    });
    if (!found) {
      // 逃げ場が無い＝開豁地で撃たれている。棒立ちで撃ち合うより、その場で
      // 伏せて的を小さくする方が正しい。これが無いと平地の撃ち合いが立ち姿の
      // まま延々続く（移動できる時は従来どおり遮蔽への退避を優先する）。
      if (!s.prone && T.PRONE_DROP_UNDER_FIRE) {
        return {
          type: 'GO_PRONE', soldierIds: [s.id], payload: {},
          note: '自衛: その場で伏せる',
        };
      }
      return null;
    }

    // 「死角伝い」を名乗れるのは**露出を実際に評価した上で** risk 0 だった時だけ。
    // 敵が1人も見えていない時は評価そのものをしていないので従来の文言に戻す。
    // 匍匐は死角かどうかより優先して見せる（プレイヤーが姿勢を読み取る手掛かり）。
    // 文言と実際の移動モードを一致させる。以前は「匍匐で遮蔽へ」と言いながら
    // 速度は伏せ状態の副作用でしか変わっておらず、表示と機構が別物だった。
    const mode = pinned ? 'crawl' : (threats.length > 0 ? 'rush' : 'walk');
    const label = pinned ? '匍匐で遮蔽へ'
      : (threats.length > 0 && found.risk === 0) ? '死角伝いに遮蔽へ'
        : '遮蔽へ退避';
    return {
      type: 'MOVE_TO', soldierIds: [s.id],
      payload: { path: found.path, mode: mode, selfInitiated: true },
      note: (has('cautious') ? '慎重: 被制圧、' : '被制圧: ') + label,
    };
  },

  /**
   * 撃たれる前の遮蔽確保。開豁地に立っていて敵から見えているなら、遮蔽へ移るか
   * 伏せる。selfPreserve（撃たれたら動く）の一段手前にある、歩兵の常識のほう。
   *
   * @returns {Object|null} MOVE_TO / GO_PRONE intent、必要なければ null
   */
  seekCoverIfExposed: function (soldierView, worldView, rng) {
    const s = soldierView;
    const T = (worldView && worldView.tuning) || {};
    const map = worldView && worldView.map;
    if (!map || typeof map.cover !== 'function' || typeof map.neighbors !== 'function') return null;
    if (s.state === 'move' || (s.movePath && s.movePath.length > 0)) return null;

    const openMax = T.OPEN_GROUND_COVER_MAX != null ? T.OPEN_GROUND_COVER_MAX : 0.18;
    const here = { q: s.q, r: s.r };
    const hereCover = map.cover(here);
    if (typeof hereCover !== 'number' || hereCover >= openMax) return null;

    const traits = s.traits || [];
    const has = function (t) { return traits.indexOf(t) !== -1; };
    if (has('timid') && s.suppression >= TRAIT_MODS.timid.FREEZE_AT_SUPPRESSION) return null;

    // 見られていなければ隠れる必要はない
    const threats = collectThreats(s, worldView);
    if (!threats.length) return null;

    const minGain = T.COVER_SEEK_MIN_GAIN != null ? T.COVER_SEEK_MIN_GAIN : 0.10;
    const maxSteps = T.COVER_SEEK_MAX_STEPS != null ? T.COVER_SEEK_MAX_STEPS : 4;
    const found = findCoverPath(map, here, hereCover + minGain, 0, maxSteps, {
      threats: threats,
      cost: T.COVER_SEEK_EXPOSURE_COST != null ? T.COVER_SEEK_EXPOSURE_COST : 0.05,
      includeDest: false,
    });
    if (found) {
      return {
        type: 'MOVE_TO', soldierIds: [s.id],
        payload: { path: found.path, mode: 'auto', selfInitiated: true },
        note: '開豁地: 遮蔽へ移る',
      };
    }
    // 移れる遮蔽が無いなら、せめて伏せる（棒立ちで撃たれるのを待たない）
    if (!s.prone) {
      return {
        type: 'GO_PRONE', soldierIds: [s.id], payload: {},
        note: '開豁地: 身を伏せる',
      };
    }
    return null;
  },

  /**
   * 指示によるCover（NORTH_STAR §3.4 分隊長の采配）。
   *
   * `TAKE_COVER` 命令が**届いた瞬間**に呼ばれ、行き先を現場で決める。命令自体は
   * 行き先を持たない（三現主義: どこへ隠れるかは、そこに居る兵にしか分からない）。
   * 伝達遅延があるので、届いた頃には状況が変わっている可能性がある — だから
   * 発令時ではなく到達時に解決する。
   *
   * selfPreserve との違いは「なぜ動くか」:
   *  - selfPreserve = 自分が撃たれているから逃げる（生存本能）
   *  - seekCoverForOrder = 組織として動けと言われたから動く（命令）
   * ゆえに発火条件を課さず、露出コストにも ORDERED_COVER_RISK_TOLERANCE を掛けて
   * より大きな危険を受け入れる。§3.4「命を守る本能と、組織として攻めねばならない
   * 重圧のせめぎあい」の数値表現がこの係数。
   *
   * @param {Object} payload - { hex? } 場所を指す命令なら hex を持つ（「あの塀まで」）
   * @returns {Object|null} MOVE_TO intent / 竦んで動けない場合は HOLD_POS / 不能なら null
   */
  seekCoverForOrder: function (soldierView, worldView, rng, payload) {
    const s = soldierView;
    const T = (worldView && worldView.tuning) || {};
    const map = worldView && worldView.map;
    payload = payload || {};

    if (!map || typeof map.neighbors !== 'function' || typeof map.cover !== 'function') return null;
    if (s.state === 'move' || (s.movePath && s.movePath.length > 0)) return null;

    const traits = s.traits || [];
    const has = function (t) { return traits.indexOf(t) !== -1; };

    // timid は命令でも竦む。命令が通らない兵が居ること自体が §4.1 の狙いなので、
    // 黙って無視せず HOLD_POS + ノートで「届いたが動けない」を可視化する。
    if (has('timid') && s.suppression >= TRAIT_MODS.timid.FREEZE_AT_SUPPRESSION) {
      return {
        type: 'HOLD_POS', soldierIds: [s.id], payload: {},
        note: '命令が届かない: 竦んで動けない',
      };
    }

    const here = { q: s.q, r: s.r };
    const pinnedAt = T.PINNED_AT != null ? T.PINNED_AT : 80;
    const pinned = s.suppression >= pinnedAt;
    const maxSteps = pinned
      ? 1
      : (T.ORDERED_COVER_MAX_STEPS != null ? T.ORDERED_COVER_MAX_STEPS : 6);

    // 場所を指す命令は遮蔽の改善を要求しない（指揮官が明示的に其処を指している）。
    // 1要素の経路でワープしないよう、必ず1マスずつ刻んだ経路を作る。
    if (payload.hex) {
      const path = findPathTo(map, here, payload.hex, maxSteps);
      if (!path) return null;
      return {
        type: 'MOVE_TO', soldierIds: [s.id],
        payload: {
          path: path,
          mode: payload.mode || (pinned ? 'crawl' : 'walk'),
          selfInitiated: true,
        },
        note: '命令: 指示された地点へ',
      };
    }

    const hereCover = map.cover(here);
    if (typeof hereCover !== 'number') return null;

    const minDest = has('cautious') ? TRAIT_MODS.cautious.MIN_SELF_MOVE_COVER : 0;
    const seekMinGain = T.COVER_SEEK_MIN_GAIN != null ? T.COVER_SEEK_MIN_GAIN : 0.10;
    const required = hereCover + seekMinGain;

    const threats = collectThreats(s, worldView);
    const baseCost = T.COVER_SEEK_EXPOSURE_COST != null ? T.COVER_SEEK_EXPOSURE_COST : 0.05;
    const tolerance = T.ORDERED_COVER_RISK_TOLERANCE != null ? T.ORDERED_COVER_RISK_TOLERANCE : 0.5;
    const found = findCoverPath(map, here, required, minDest, maxSteps, {
      threats: threats,
      cost: baseCost * tolerance,
      includeDest: pinned,
    });
    if (!found) return null;

    const mode = pinned ? 'crawl' : (threats.length > 0 ? 'rush' : 'walk');
    const label = pinned ? '命令: 匍匐で遮蔽へ'
      : (threats.length > 0 && found.risk === 0) ? '命令: 死角伝いに遮蔽へ'
        : '命令: 遮蔽へ';
    return {
      type: 'MOVE_TO', soldierIds: [s.id],
      payload: { path: found.path, mode: mode, selfInitiated: true },
      note: label,
    };
  },

  /**
   * @param {Object} soldierView - read-only snapshot (self)
   * @param {Object} worldView - { soldiers: [...], map, tuning }
   * @param {function(): number} rng
   * @returns {Object} intent (same shape as Order), optionally with a `note`
   */
  decide: function (soldierView, worldView, rng) {
    const s = soldierView;
    const traits = s.traits || [];
    const has = function (t) { return traits.indexOf(t) !== -1; };
    const T = worldView.tuning || {};

    // ---------------------------------------------------------------------
    // Influence network (SIM_CORE_SPEC.md SS16.3, v1: 2 rules only).
    // Both are read-only observations of worldView.soldiers -- no mutation,
    // no probe. Only engage when a qualifying neighbour actually exists, so
    // scenarios without such neighbours (e.g. existing sim_policy tests) are
    // unaffected.
    // ---------------------------------------------------------------------
    const steadyRadius = T.LEADER_STEADY_RADIUS != null ? T.LEADER_STEADY_RADIUS : 2;
    const steadyBonus = T.LEADER_STEADY_BONUS != null ? T.LEADER_STEADY_BONUS : 20;
    const steadyFireMult = T.LEADER_STEADY_FIRE_MULT != null ? T.LEADER_STEADY_FIRE_MULT : 1.5;
    const joinFireMult = T.INFLUENCE_JOIN_FIRE_MULT != null ? T.INFLUENCE_JOIN_FIRE_MULT : 2.0;

    let nearLeader = false;
    let engagedNeighbours = 0;
    for (const other of worldView.soldiers) {
      if (other.id === s.id || other.team !== s.team || other.hp <= 0) continue;
      const d = worldView.map.dist({ q: s.q, r: s.r }, { q: other.q, r: other.r });
      if (other.isLeader && d <= steadyRadius) nearLeader = true;
      if (other.state === 'engage' && d <= 2) engagedNeighbours++;
    }
    let harassMult = 1.0;
    if (engagedNeighbours >= 2) harassMult *= joinFireMult;
    if (nearLeader) harassMult *= steadyFireMult;
    const applyHarassMult = function (p) { return Math.min(1.0, p * harassMult); };

    // timid: once suppression crosses the freeze threshold, stop all
    // self-initiated action and stay put (explicit orders still bypass
    // this because they arrive via s.currentOrder in sim_core, never
    // reaching policy.decide()). A steady leader nearby raises the
    // threshold -- "having the NCO close by settles the nerves".
    const timidFreezeAt = TRAIT_MODS.timid.FREEZE_AT_SUPPRESSION + (nearLeader ? steadyBonus : 0);
    if (has('timid') && s.suppression >= timidFreezeAt) {
      return {
        type: 'HOLD_POS', soldierIds: [s.id], payload: {},
        note: '臆病: 制圧下のため行動停止',
      };
    }

    // reload / out-of-ammo handling mirrors DefaultPolicy baseline.
    if (s.magRemaining <= 0 && s.magsLeft <= 0) {
      return { type: 'HOLD_POS', soldierIds: [s.id], payload: {} };
    }
    if (s.magRemaining <= 0 && s.magsLeft > 0) {
      return { type: 'FIRE_MODE', soldierIds: [s.id], payload: { mode: 'reload' } };
    }
    if (s.suppression >= (T.PINNED_AT != null ? T.PINNED_AT : 80)) {
      return { type: 'HOLD_POS', soldierIds: [s.id], payload: { prone: true } };
    }

    // Retain knowledge of a previously acquired target across temporary LOS
    // loss. Explicit orders never enter this branch (SimCore applies them
    // before policy.decide), and assault/throw states skip decision entirely.
    if (s.engageTargetId) {
      const known = (worldView.soldiers || []).find(function (o) {
        return o && o.id === s.engageTargetId && o.team !== s.team && o.hp > 0;
      });
      if (known) {
        let directLos = false;
        try { directLos = !!worldView.map.hasLos(
          { q: s.q, r: s.r }, { q: known.q, r: known.r }); } catch (e) { directLos = false; }
        if (!directLos) {
          if (s.state === 'move' && s.movePath && s.movePath.length) {
            return { type: 'HOLD_POS', soldierIds: [s.id], payload: {},
              note: '接敵: 遮蔽接近を継続' };
          }
          const approach = findCautiousApproach(s, known, worldView);
          if (approach) return approach;
          return { type: 'HOLD_POS', soldierIds: [s.id],
            payload: { prone: worldView.map.cover({ q: s.q, r: s.r }) < 0.2 },
            note: '接敵: 安全な接近路を待つ' };
        }
      }
    }

    const effRangeBonus = has('aggressive') ? TRAIT_MODS.aggressive.ENGAGE_RANGE_BONUS : 0;

    // fire discipline (aggressive ignores it -- that IS the trait):
    // suppressed targets are not worth ammo unless close or moving;
    // on the last magazine only worthwhile targets get shot at.
    const disciplined = !has('aggressive');
    const supAt = T.SUPPRESSED_AT != null ? T.SUPPRESSED_AT : 50;
    const closeRng = T.DISCIPLINE_CLOSE_RNG != null ? T.DISCIPLINE_CLOSE_RNG : 2;
    const lastMag = s.magsLeft <= 0;

    let bestTarget = null;
    let bestDist = Infinity;
    let sawEnemy = false;
    for (const other of worldView.soldiers) {
      // 行動不能の敵も候補に残す。倒れた敵を撃つかどうかは戦場の判断であって、
      // AIが勝手に「安全な相手」と決めて無視してよいものではない。
      // （fire discipline 側で「頭を下げている敵は後回し」は既に効いている）
      if (other.team === s.team || other.hp <= 0) continue;
      if (!s.weapon.indirect && !worldView.map.hasLos({ q: s.q, r: s.r }, { q: other.q, r: other.r })) continue;
      const d = worldView.map.dist({ q: s.q, r: s.r }, { q: other.q, r: other.r });
      const effRange = s.weapon.rngMax + effRangeBonus;
      if (d > effRange || d < (s.weapon.rngMin || 0)) continue;
      sawEnemy = true;
      if (disciplined && other.suppression >= supAt && d > closeRng && other.state !== 'move') {
        let harassP = T.HARASS_FIRE_P != null ? T.HARASS_FIRE_P : 0.25;
        if (has('calm') && TRAIT_MODS.calm.HARASS_FIRE_P != null) {
          harassP = TRAIT_MODS.calm.HARASS_FIRE_P;
        }
        harassP = applyHarassMult(harassP);
        if (rng() >= harassP) continue;
      }
      if (disciplined && lastMag && !(other.state === 'move'
        || worldView.map.cover({ q: other.q, r: other.r }) < (T.DISCIPLINE_LAST_MAG_COVER_MAX || 0.3)
        || d <= s.weapon.rngMax / 3)) continue;
      if (d < bestDist) {
        bestDist = d;
        bestTarget = other;
      }
    }

    // 自衛の反射（自動Cover）は射撃より優先する — 撃ち返すより先に身を守る。
    // 実体は selfPreserve()。sim_core は射撃命令が立っている間もこれだけを別途
    // 参照するので、命令下でも自衛が効く。
    const preserve = this.selfPreserve(s, worldView, rng);
    if (preserve) return preserve;

    // **撃たれる前に身を隠す。** selfPreserve は「撃たれたら動く」なので、まだ
    // 誰も撃ってきていない開豁地では発火せず、兵が平野に突っ立ったままになる
    // （2026-08-02 ディレクター指摘）。敵に見られている開豁地に居ると分かった
    // 時点で、遮蔽へ移るか、無ければ伏せる — 撃たれてから動くのでは遅い。
    if (sawEnemy && T.OPEN_GROUND_SEEK_COVER !== false) {
      const exposed = this.seekCoverIfExposed(s, worldView, rng);
      if (exposed) return exposed;
    }

    if (bestTarget) {
      // calm: 確実な距離まで引きつけてから撃つ。
      //
      // **ただし引きつけるのは「自分ひとりで判断している時」だけ。**
      // 無条件に保留していた版は、射程いっぱいで膠着した撃ち合い（＝実戦で最も
      // 多い形）では間合いが詰まらないので、冷静な兵が**一度も撃たないまま**
      // 戦闘が終わっていた（2026-08-05 実測: calm の兵が総発砲0発、非交戦理由の
      // 最大がこの保留で全判断の18%）。m1 は rngMax=7 なので保留線は約4.7hex、
      // 撃ち合いはたいてい5〜7hexで安定する — 構造的に永久保留だった。
      //
      // 分隊が撃ち始めているなら斉射に加わる。撃たれているなら撃ち返す。
      // 「冷静」は無駄弾を惜しむ性格であって、傍観する性格ではない。
      if (has('calm')) {
        const calmMaxDist = s.weapon.rngMax * TRAIT_MODS.calm.ENGAGE_RANGE_FRACTION;
        const joinAt = T.CALM_JOIN_VOLLEY_N != null ? T.CALM_JOIN_VOLLEY_N : 2;
        const squadFiring = engagedNeighbours >= joinAt;
        const underFireWindow = T.COVER_SEEK_UNDER_FIRE_T != null ? T.COVER_SEEK_UNDER_FIRE_T : 30;
        const tick = worldView.tick;
        const underFire = (tick != null && typeof s.underFireT === 'number')
          && (tick - s.underFireT) <= underFireWindow;
        if (bestDist > calmMaxDist && !squadFiring && !underFire) {
          return {
            type: 'HOLD_POS', soldierIds: [s.id], payload: {},
            note: '冷静: 距離が詰まるまで射撃を保留',
          };
        }
      }

      const mode = has('aggressive') ? TRAIT_MODS.aggressive.DEFAULT_FIRE_MODE : 'aimed';
      const intent = {
        type: 'TARGET', soldierIds: [s.id],
        payload: { targetId: bestTarget.id, mode: mode },
      };
      if (has('aggressive')) intent.note = '攻撃的: 独断で射撃開始';
      return intent;
    }

    if (sawEnemy) {
      return { type: 'HOLD_POS', soldierIds: [s.id], payload: {}, note: '射撃節制: 敵は頭を下げている' };
    }

    // cautious: do not self-initiate a move into low-cover ground. TraitPolicy
    // never self-issues MOVE_TO in this slice (no self-initiated movement
    // exists in the baseline either), so this is a guard for future callers
    // that might route movement decisions through here.
    if (has('cautious') && s.movePath && s.movePath.length > 0) {
      const nextHex = s.movePath[0];
      const cover = worldView.map.cover(nextHex);
      if (cover < TRAIT_MODS.cautious.MIN_SELF_MOVE_COVER) {
        return {
          type: 'HOLD_POS', soldierIds: [s.id], payload: {},
          note: '慎重: 遮蔽の薄い地形への自発移動を拒否',
        };
      }
    }

    return { type: 'HOLD_POS', soldierIds: [s.id], payload: {} };
  },
};

// ---------------------------------------------------------------------------
// exports (UMD-ish: node module + browser global)
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TraitPolicy: TraitPolicy,
    TRAIT_MODS: TRAIT_MODS,
    pathExposure: pathExposure,
  };
}
if (typeof window !== 'undefined') {
  window.TraitPolicy = TraitPolicy;
  window.TRAIT_MODS = TRAIT_MODS;
}

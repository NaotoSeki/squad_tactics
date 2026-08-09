/**
 * sim_leader.js -- WS-F (NORTH_STAR SS3.4 三現主義 / SIM_CORE_SPEC.md SS16)
 *
 * Pure JS, zero dependencies, headless. No window/document/Phaser/setTimeout/Math.random.
 * Requireable from node, and exposed as a global in the browser (UMD-ish, see bottom).
 *
 * LeaderPolicy.assess(leaderView, worldView, rng, state) is a pure function: it reads
 * leaderView/worldView and the caller-held `state` record, and RETURNS Order[] (SS8
 * shape) for the caller to feed into sim.issueOrder(). It never mutates sim state
 * itself and never queues orders directly -- all orders travel through CommsOrders,
 * same channel and same delay as player orders (that IS the "field leader is fast
 * because the voice carries" mechanic).
 *
 * `state` is caller-held per-squad memory: { lastDoctrine, lastOrderTick, playerLockUntil,
 * quietT }. quietT is LeaderPolicy's own bookkeeping (see HOLD_FIRE below) -- callers
 * should treat it as opaque and simply pass the same object back in on every call.
 */

// ---------------------------------------------------------------------------
// helpers (module-private, no side effects)
// ---------------------------------------------------------------------------

/**
 * Squad-average morale and casualty count for a team, from worldView snapshots.
 * @private
 */
function _squadStats(worldView, team) {
  let aliveMorale = 0;
  let aliveCount = 0;
  let dead = 0;
  for (const s of worldView.soldiers) {
    if (s.team !== team) continue;
    if (s.hp <= 0) { dead++; continue; }
    aliveMorale += s.morale;
    aliveCount++;
  }
  return {
    dead: dead,
    avgMorale: aliveCount > 0 ? aliveMorale / aliveCount : 100,
    aliveCount: aliveCount,
  };
}

/**
 * Ammo fraction approximation (SIM_CORE_SPEC.md SS16 design note):
 * sum(magRemaining + magsLeft*burstsPerMag) / sum(full magCap*(magsLeft_full+1)) with
 * magCap already expressed in bursts-per-mag terms by toSimWeapon -- so this reduces
 * to remaining bursts / (magCap * (DEFAULT_MAGS+1)) per soldier, summed.
 * @private
 */
function _squadAmmoFraction(worldView, team) {
  const T = worldView.tuning || {};
  const defaultMags = T.DEFAULT_MAGS || {};
  let have = 0;
  let full = 0;
  for (const s of worldView.soldiers) {
    if (s.team !== team || s.hp <= 0 || !s.weapon) continue;
    const magCap = s.weapon.magCap || 1;
    const startMags = (defaultMags[s.weapon.class] != null ? defaultMags[s.weapon.class] : s.magsLeft) + 1;
    have += (s.magRemaining || 0) + (s.magsLeft || 0) * magCap;
    full += magCap * startMags;
  }
  return full > 0 ? have / full : 1;
}

/**
 * Nearest living enemy to a hex, or null.
 * @private
 */
function _nearestEnemy(worldView, team, hex) {
  let best = null;
  let bestDist = Infinity;
  for (const s of worldView.soldiers) {
    if (s.team === team || s.hp <= 0) continue;
    const d = worldView.map.dist(hex, { q: s.q, r: s.r });
    if (d < bestDist) { bestDist = d; best = s; }
  }
  return best;
}

/**
 * Build a 2-hex straight-line retreat path away from the nearest enemy, using the
 * same integer-rounding straight-line approach as dev_sim.html's right-click move
 * (see dev_sim.html contextmenu handler). Out-of-map hexes are clamped by refusing
 * to step onto a hex the MapApi reports as impassable (moveCost >= 99); LeaderPolicy
 * has no notion of map bounds beyond MapApi, so this is the only clamp available to
 * a pure function fed only the SS3 MapApi.
 * @private
 */
function _fallbackPath(worldView, soldier, retreatHexes) {
  const enemy = _nearestEnemy(worldView, soldier.team, { q: soldier.q, r: soldier.r });
  if (!enemy) return null;
  const dq = soldier.q - enemy.q;
  const dr = soldier.r - enemy.r;
  const mag = Math.max(Math.abs(dq), Math.abs(dr), 1);
  // unit-ish direction away from the enemy, then walk it out `retreatHexes` steps,
  // rounding each step the same way dev_sim's straight-line path builder does.
  const dirQ = dq / mag;
  const dirR = dr / mag;
  const path = [];
  let cq = soldier.q, cr = soldier.r;
  for (let i = 1; i <= retreatHexes; i++) {
    const nq = Math.round(soldier.q + dirQ * i);
    const nr = Math.round(soldier.r + dirR * i);
    const hex = { q: nq, r: nr };
    if (worldView.map.moveCost(hex) >= 99) break; // impassable/out-of-map: clamp here
    cq = nq; cr = nr;
    path.push({ q: cq, r: cr });
  }
  return path.length > 0 ? path : null;
}

/**
 * 生存する敵を hex 隣接でまとめたクラスタ。大きい順に返す。
 *
 * 「どこを叩くか」の答えは頭数の塊なので、まず塊を見つける。中心は最も敵が
 * 重なっている hex — そこへ制圧を落とせば一度に複数の頭が下がる。
 * @private
 */
function _enemyClusters(worldView, team) {
  const map = worldView.map;
  const foes = worldView.soldiers.filter((s) => s.team !== team && s.hp > 0
    && s.state !== 'incap' && s.state !== 'rout');
  const clusters = [];
  const used = Object.create(null);

  foes.forEach((f) => {
    if (used[f.id]) return;
    used[f.id] = true;
    const members = [f];
    for (let i = 0; i < members.length; i++) {
      foes.forEach((o) => {
        if (used[o.id]) return;
        if (map.dist({ q: members[i].q, r: members[i].r }, { q: o.q, r: o.r }) <= 1) {
          used[o.id] = true;
          members.push(o);
        }
      });
    }
    const counts = Object.create(null);
    let bestKey = null;
    let bestN = 0;
    members.forEach((m) => {
      const k = m.q + ',' + m.r;
      counts[k] = (counts[k] || 0) + 1;
      if (counts[k] > bestN) { bestN = counts[k]; bestKey = k; }
    });
    const parts = bestKey.split(',');
    clusters.push({
      members: members, size: members.length,
      hex: { q: Number(parts[0]), r: Number(parts[1]) },
    });
  });
  clusters.sort((a, b) => b.size - a.size);
  return clusters;
}

/** その hex を撃てる分隊員。制圧力の高い順（MGが先頭に来る）。@private */
function _shootersOn(worldView, squad, hex) {
  const map = worldView.map;
  return squad.filter((s) => s.weapon
    && (s.magRemaining > 0 || s.magsLeft > 0)
    && map.dist({ q: s.q, r: s.r }, hex) <= s.weapon.rngMax
    && map.hasLos({ q: s.q, r: s.r }, hex))
    .sort((a, b) => (b.weapon.suppressPerBurst || 0) - (a.weapon.suppressPerBurst || 0));
}

/**
 * 突入させる兵の順位付け。**ここが「地形を読む」の実体**。
 *
 * 目標までの直線上の遮蔽を平均し、寄りやすい経路を持つ者を上位にする。加えて
 * 投擲弾持ち（遮蔽ごと排除できる）と近い者を優遇し、制圧されている者を下げる。
 * 距離だけで選ぶと、開豁地を最短で横切る一番死にやすい兵を突っ込ませてしまう。
 * @private
 */
function _assaultCandidates(worldView, squad, hex, T) {
  const map = worldView.map;
  const approachW = T.PUSH_APPROACH_W != null ? T.PUSH_APPROACH_W : 2.0;
  return squad.map((s) => {
    const d = map.dist({ q: s.q, r: s.r }, hex);
    const steps = Math.max(1, Math.round(d));
    let sum = 0;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const q = Math.round(s.q + (hex.q - s.q) * t);
      const r = Math.round(s.r + (hex.r - s.r) * t);
      let c = 0;
      try { c = map.cover({ q: q, r: r }) || 0; } catch (e) { c = 0; }
      sum += c;
    }
    const approach = sum / steps;
    const nades = (s.grenades || 0) + (s.rifleGrenades || 0);
    return {
      s: s, d: d, approach: approach,
      score: approach * approachW + (nades > 0 ? 0.6 : 0) - d * 0.08
        - (s.suppression || 0) / 100,
    };
  }).sort((a, b) => b.score - a.score);
}

/**
 * 目標へ寄る短い経路。1マスずつ、**距離を詰めつつ遮蔽の濃い方**を選ぶ貪欲法。
 *
 * A* を持たない（MapApi にコスト探索が無い）ので、地形を読む部分はこの重み付けが
 * 全て: `距離 - 遮蔽 × coverW`。これで塀や林を伝って寄る経路が自然に出る。
 * @private
 */
function _advancePath(map, soldier, goal, steps, coverW) {
  const start = { q: soldier.q, r: soldier.r };
  const scoreOf = (hex) => {
    let cover = 0;
    try { cover = map.cover(hex) || 0; } catch (e) { cover = 0; }
    return map.dist(hex, goal) - cover * coverW;
  };

  // 現在地の評価を基準にする。**遮蔽込みで比べないと横這いを繰り返す** —
  // 同じ距離・同じ遮蔽のマスへ延々と移り続けて前進しなくなる（実測で踏んだ）。
  let bestScore = scoreOf(start);
  let best = null;

  const seen = Object.create(null);
  seen[start.q + ',' + start.r] = true;
  let frontier = [{ hex: start, path: [] }];

  // 貪欲な1マス選択では建物に突き当たった兵が毎回その場で詰まる。数マス先まで
  // 幅優先で見て、届く範囲で最も良いマスへの経路を返す。
  for (let depth = 1; depth <= steps && frontier.length; depth++) {
    const next = [];
    for (let i = 0; i < frontier.length; i++) {
      const node = frontier[i];
      const cells = map.neighbors(node.hex) || [];
      for (let j = 0; j < cells.length; j++) {
        const c = cells[j];
        const key = c.q + ',' + c.r;
        if (seen[key]) continue;
        seen[key] = true;
        let cost = Infinity;
        try { cost = map.moveCost(node.hex, c); } catch (e) { cost = Infinity; }
        if (!isFinite(cost) || cost <= 0) continue;
        const path = node.path.concat([{ q: c.q, r: c.r }]);
        const score = scoreOf(c);
        if (score < bestScore) { bestScore = score; best = path; }
        next.push({ hex: c, path: path });
      }
    }
    frontier = next;
  }
  return best || [];
}

/** クラスタで最も危険な敵（制圧力の高い武器を持つ者）。「あのMG手を潰せ」 @private */
function _priorityFoe(cluster) {
  let best = cluster.members[0];
  cluster.members.forEach((m) => {
    const a = (m.weapon && m.weapon.suppressPerBurst) || 0;
    const b = (best.weapon && best.weapon.suppressPerBurst) || 0;
    if (a > b) best = m;
  });
  return best;
}

// ---------------------------------------------------------------------------
// LeaderPolicy
// ---------------------------------------------------------------------------

const LeaderPolicy = {
  /**
   * @param {Object} leaderView - read-only snapshot of the squad leader (self)
   * @param {Object} worldView - { soldiers: [...], map, tuning }
   * @param {function(): number} rng
   * @param {Object} state - caller-held per-squad memory:
   *   { lastDoctrine, lastOrderTick, playerLockUntil, quietT }
   * @returns {Object[]} Order[] (SS8 shape), empty if standing pat this cycle
   */
  assess: function (leaderView, worldView, rng, state) {
    const T = worldView.tuning || {};
    const tick = worldView.tick != null ? worldView.tick : 0;
    const team = leaderView.team;

    state.lastOrderTick = state.lastOrderTick != null ? state.lastOrderTick : -Infinity;
    state.playerLockUntil = state.playerLockUntil != null ? state.playerLockUntil : 0;
    state.quietT = state.quietT != null ? state.quietT : 0;

    // no living leader -> no doctrine (F1: "squad without a leader" issues nothing).
    // The caller is expected to only call assess() for a squad's designated leader,
    // but a dead/missing leaderView is guarded here defensively.
    if (!leaderView || leaderView.hp <= 0 || !leaderView.isLeader) return [];

    // **采配の賞味期限。** state.plan は新しい采配を発令した時にしか書き換わらない
    // ので、下のクールダウン・同一采配抑制・「該当する采配なし」のどの早期returnを
    // 通っても、古い計画が盤面に残り続ける。的が倒れた／移動した後もリングだけが
    // 居座り、プレイヤーは誰も居ない地点を狙う（2026-08-05 ディレクター報告
    // 「遺体の上に指揮官円」「誰もいないところに残る」。実測: 描画中の41%が
    // 敵の居ない hex を指し、連続7.9秒嘘をついた）。
    // 発令の有無に関わらず、毎サイクルここで前提を検算する。
    this._refreshPlan(state, worldView, team, T);

    // HOLD_FIRE's "no engagement for N ticks" proxy: LeaderPolicy holds no event
    // history, so it tracks "nobody on the squad is currently engaging" as a
    // running counter across assess() calls (SIM_CORE_SPEC.md SS16 design note).
    // Each assess() call represents one LEADER_ASSESS_INTERVAL_T-sized step.
    const interval = T.LEADER_ASSESS_INTERVAL_T != null ? T.LEADER_ASSESS_INTERVAL_T : 25;
    const anyEngaged = worldView.soldiers.some((s) => s.team === team && s.hp > 0 && s.state === 'engage');
    state.quietT = anyEngaged ? 0 : state.quietT + interval;

    // player order lock: NCO stays silent while the player's own order is fresh.
    if (tick < state.playerLockUntil) return [];

    const cooldownT = T.DOCTRINE_COOLDOWN_T != null ? T.DOCTRINE_COOLDOWN_T : 100;
    if (tick - state.lastOrderTick < cooldownT) return [];

    const doctrine = this._pickDoctrine(leaderView, worldView, T, state);
    if (!doctrine) return [];

    // no repeating the same doctrine back-to-back when nothing about the
    // situation score has moved (SS16.2 "same-doctrine suppression"). `score`
    // is a doctrine-specific severity number (e.g. casualty count, suppressed
    // count) -- same name AND same score means "nothing changed, stay quiet";
    // same name but a worse score (situation escalated) still re-issues.
    if (doctrine.name === state.lastDoctrine && doctrine.score === state.lastDoctrineScore) return [];

    state.lastDoctrine = doctrine.name;
    state.lastDoctrineScore = doctrine.score;
    state.lastOrderTick = tick;
    // 采配の中身を呼び出し側へ残す。PAUSE画面が「指揮官が何を企てているか」を
    // 描くための唯一の口（ここで出さないと、AIの判断は盤面から読めない）。
    state.plan = doctrine.plan
      ? Object.assign({ name: doctrine.name, tick: tick }, doctrine.plan)
      : { name: doctrine.name, tick: tick, label: doctrine.name };
    return doctrine.orders;
  },

  /**
   * 采配の前提を検算し、消えていたら采配ごと捨てる。
   *
   *   ・名指しの的が生きている → その**今の位置**へリングを追随させる
   *     （倒していないのに古い hex を指すのは、それ自体が誤認の元）
   *   ・的は居ないが、指した hex の近くにまだ敵が居る → そのまま有効
   *   ・どちらでもない → 采配を捨てる（盤面から消える）
   *
   * @private
   */
  _refreshPlan: function (state, worldView, team, T) {
    const plan = state.plan;
    if (!plan) return;
    if (!plan.hex) { state.plan = null; return; }   // hex の無い采配は元々描けない

    const alive = (s) => s && s.hp > 0 && s.state !== 'incap' && s.state !== 'down';
    const foes = worldView.soldiers.filter((s) => s.team !== team && alive(s));

    if (plan.targetId) {
      const tg = foes.filter((s) => s.id === plan.targetId)[0];
      if (tg) { plan.hex = { q: tg.q, r: tg.r }; return; }
    }
    const radius = T.PLAN_STALE_RADIUS != null ? T.PLAN_STALE_RADIUS : 1;
    const stillThere = foes.some((s) =>
      worldView.map.dist({ q: s.q, r: s.r }, plan.hex) <= radius);
    if (!stillThere) state.plan = null;
  },

  /**
   * Evaluate the SS16.2 doctrine table in priority order, first match wins.
   * @private
   */
  _pickDoctrine: function (leaderView, worldView, T, state) {
    const team = leaderView.team;
    const aliveSquad = worldView.soldiers.filter((s) => s.team === team && s.hp > 0);
    const aliveIds = aliveSquad.map((s) => s.id);
    if (aliveIds.length === 0) return null;

    // 1. FALL_BACK -- casualties + low morale.
    const stats = _squadStats(worldView, team);
    const fallbackCasualties = T.FALLBACK_CASUALTIES != null ? T.FALLBACK_CASUALTIES : 2;
    const fallbackMoraleBelow = T.FALLBACK_MORALE_BELOW != null ? T.FALLBACK_MORALE_BELOW : 50;
    if (stats.dead >= fallbackCasualties && stats.avgMorale < fallbackMoraleBelow) {
      const orders = [];
      for (const s of aliveSquad) {
        const path = _fallbackPath(worldView, s, 2);
        if (path) orders.push({ type: 'MOVE_TO', soldierIds: [s.id], payload: { path: path } });
      }
      if (orders.length > 0) {
        return { name: 'FALL_BACK', score: stats.dead, orders: this._withNote(orders, '下がれ！下がれ！') };
      }
    }

    // 2. TAKE_COVER -- 開豁地で敵に見られている部下が居るなら、撃ち返すより先に
    //    遮蔽へ入れる。行き先は指定しない — どこへ隠れるかは現場の兵が決める
    //    （NORTH_STAR §3.4 三現主義）。FOCUS_FIRE より優先するのは、味方が的に
    //    なっている状況で好機を狙うのは順序が逆だから。
    const takeCoverMinExposed = T.TAKE_COVER_MIN_EXPOSED != null ? T.TAKE_COVER_MIN_EXPOSED : 2;
    const takeCoverCoverMax = T.TAKE_COVER_COVER_MAX != null ? T.TAKE_COVER_COVER_MAX : 0.20;
    const livingEnemies = worldView.soldiers.filter((s) => s.team !== team && s.hp > 0);
    const exposedSquad = aliveSquad.filter((s) => {
      const cover = worldView.map.cover({ q: s.q, r: s.r });
      if (cover >= takeCoverCoverMax || s.state === 'move') return false;
      // 見られていない兵を動かす必要はない
      if (typeof worldView.map.hasLos !== 'function') return true;
      return livingEnemies.some((e) => worldView.map.hasLos(
        { q: e.q, r: e.r }, { q: s.q, r: s.r }));
    });
    // **撃たれている時にだけ発令する。** 「開豁地に立っていて見られている」だけで
    // 発令していた版は、遮蔽の薄い盤面（市街地）でほぼ毎回これを選び、攻勢まで
    // 一度も辿り着かなかった（2026-08-02 実測: 9000tickで采配は TAKE_COVER のみ）。
    // 撃たれる前に隠れるのは兵士側の判断（TraitPolicy.seekCoverIfExposed）の仕事で、
    // 分隊長が口を出すのは弾が飛んできてからでよい。
    const underFireWindow = T.COVER_SEEK_UNDER_FIRE_T != null ? T.COVER_SEEK_UNDER_FIRE_T : 30;
    const now = worldView.tick != null ? worldView.tick : 0;
    const beingShot = aliveSquad.some((s) => (s.suppression || 0) > 0
      || (typeof s.underFireT === 'number' && (now - s.underFireT) <= underFireWindow));
    if (beingShot && exposedSquad.length >= takeCoverMinExposed) {
      const orders = exposedSquad.map((s) => ({
        type: 'TAKE_COVER', soldierIds: [s.id], payload: {},
      }));
      return {
        name: 'TAKE_COVER', score: exposedSquad.length,
        orders: this._withNote(orders, '遮蔽に入れ！'),
      };
    }

    // 3. 攻勢 -- 制圧してから突入する。**唯一「勝ちに行く」采配**で、他は全て受け身。
    const push = this._pushDoctrine(leaderView, worldView, T, state, aliveSquad);
    if (push) return push;

    // 4. 前進 -- まだ誰とも撃ち合えていないなら、敵の方へ寄る。
    //    これが無いと両軍は視線の通らない距離で睨み合ったまま永久に決着しない
    //    （2026-08-02 実測: 9v9 を 9000tick 回して両軍とも無傷・未決着）。
    const advance = this._advanceDoctrine(leaderView, worldView, T, state, aliveSquad);
    if (advance) return advance;

    // 5. FOCUS_FIRE -- an exposed/moving enemy within range of >= FOCUS_MIN_SHOOTERS.
    const focusMinShooters = T.FOCUS_MIN_SHOOTERS != null ? T.FOCUS_MIN_SHOOTERS : 3;
    const focusCoverMax = T.FOCUS_TARGET_COVER_MAX != null ? T.FOCUS_TARGET_COVER_MAX : 0.3;
    const enemies = worldView.soldiers.filter((s) => s.team !== team && s.hp > 0);
    for (const enemy of enemies) {
      const cover = worldView.map.cover({ q: enemy.q, r: enemy.r });
      const exposed = cover < focusCoverMax || enemy.state === 'move';
      if (!exposed) continue;
      const shooters = aliveSquad.filter((s) => s.weapon
        && worldView.map.dist({ q: s.q, r: s.r }, { q: enemy.q, r: enemy.r }) <= s.weapon.rngMax
        && worldView.map.hasLos({ q: s.q, r: s.r }, { q: enemy.q, r: enemy.r }));
      if (shooters.length >= focusMinShooters) {
        const orders = shooters.map((s) => ({
          type: 'TARGET', soldierIds: [s.id], payload: { targetId: enemy.id, mode: 'aimed' },
        }));
        return { name: 'FOCUS_FIRE', score: enemy.id, orders: this._withNote(orders, 'あの一点を潰せ！') };
      }
    }

    // 4. SUPPRESS_FIRE -- >= N squadmates currently suppressed.
    const suppressedAt = T.SUPPRESSED_AT != null ? T.SUPPRESSED_AT : 50;
    const suppressMin = T.SUPPRESS_DOCTRINE_MIN_SUPPRESSED != null ? T.SUPPRESS_DOCTRINE_MIN_SUPPRESSED : 2;
    const suppressedCount = aliveSquad.filter((s) => s.suppression >= suppressedAt).length;
    if (suppressedCount >= suppressMin) {
      const orders = [];
      for (const s of aliveSquad) {
        if (!s.weapon) continue;
        const enemy = _nearestEnemy(worldView, team, { q: s.q, r: s.r });
        if (!enemy) continue;
        const d = worldView.map.dist({ q: s.q, r: s.r }, { q: enemy.q, r: enemy.r });
        if (d > s.weapon.rngMax) continue;
        orders.push({ type: 'TARGET', soldierIds: [s.id], payload: { targetId: enemy.id, mode: 'suppress' } });
      }
      if (orders.length > 0) {
        return { name: 'SUPPRESS_FIRE', score: suppressedCount, orders: this._withNote(orders, '制圧しろ！頭を上げさせるな！') };
      }
    }

    // 5. HOLD_FIRE -- quiet for HOLDFIRE_QUIET_T and squad ammo fraction is low.
    const holdfireQuietT = T.HOLDFIRE_QUIET_T != null ? T.HOLDFIRE_QUIET_T : 300;
    const holdfireAmmoBelow = T.HOLDFIRE_AMMO_BELOW != null ? T.HOLDFIRE_AMMO_BELOW : 0.4;
    if (state.quietT >= holdfireQuietT && _squadAmmoFraction(worldView, team) < holdfireAmmoBelow) {
      const orders = aliveSquad.map((s) => ({ type: 'FIRE_MODE', soldierIds: [s.id], payload: { mode: 'hold' } }));
      return { name: 'HOLD_FIRE', orders: this._withNote(orders, '撃ち方やめ！') };
    }

    return null;
  },

  /**
   * 攻勢ドクトリン。**制圧 → 機動 → 決定打**の三拍子を分隊長が自分で回す。
   *
   * 2段構え:
   *   ①制圧班に敵クラスタの中心を叩かせる（TARGET_HEX）
   *   ②その頭が下がったら、突入班を送り込む（ASSAULT）。制圧班は撃ち続ける
   *
   * 一度に両方やらないのが要点で、頭が上がったまま突っ込ませたら self-destruction。
   * 制圧が効いたことを確認してから機動させるので、盤面には「撃つ人」と「動く人」が
   * 分かれて見える。プレイヤーが使うのと**同じ命令語彙**（制圧・強襲）を使う。
   *
   * @returns {{name, score, orders, plan}|null}
   * @private
   */
  _pushDoctrine: function (leaderView, worldView, T, state, aliveSquad) {
    const team = leaderView.team;
    const minAmmo = T.PUSH_MIN_AMMO != null ? T.PUSH_MIN_AMMO : 0.3;
    const minShooters = T.PUSH_MIN_SHOOTERS != null ? T.PUSH_MIN_SHOOTERS : 2;
    const maxAssault = T.PUSH_ASSAULT_MAX != null ? T.PUSH_ASSAULT_MAX : 2;

    const clusters = _enemyClusters(worldView, team);
    if (!clusters.length) return null;

    // **叩ける塊を選ぶ。** 常に最大クラスタの中心を撃とうとした版は、廃墟で
    // 中心への射線が通らず「射手0」で毎回却下されていた（実測: 却下理由の最多）。
    // 中心が見えなくても、塊の別の兵なら見えていることがある。
    let cluster = null;
    let shooters = null;
    for (let i = 0; i < clusters.length && !cluster; i++) {
      const sh = _shootersOn(worldView, aliveSquad, clusters[i].hex);
      if (sh.length >= minShooters) { cluster = clusters[i]; shooters = sh; }
    }
    for (let i = 0; i < clusters.length && !cluster; i++) {
      const members = clusters[i].members;
      for (let j = 0; j < members.length && !cluster; j++) {
        const hexAlt = { q: members[j].q, r: members[j].r };
        const sh = _shootersOn(worldView, aliveSquad, hexAlt);
        if (sh.length >= minShooters) {
          cluster = { members: members, size: clusters[i].size, hex: hexAlt };
          shooters = sh;
        }
      }
    }
    if (!cluster) return null;
    const hex = cluster.hex;

    const ranked = _assaultCandidates(worldView, aliveSquad, hex, T);

    // **弾が細った時こそ決めに行く。** 「残弾が少なければ攻めない」とだけ書いた版は、
    // 一度閾値を割ると二度と攻勢へ戻れず、撃ち合いだけが延々続いて決着しなかった。
    // 撃ち合いで勝てないと分かった局面での正解は、投擲弾と白兵で間合いを潰すこと。
    if (_squadAmmoFraction(worldView, team) < minAmmo) {
      const closers = ranked.filter((c) => (c.s.grenades || 0) + (c.s.rifleGrenades || 0) > 0
        || c.d <= 3).slice(0, maxAssault).map((c) => c.s);
      if (!closers.length) return null;
      const lastFoe = _priorityFoe(cluster);
      return {
        name: 'PUSH_LAST',
        score: hex.q + ',' + hex.r + ':' + lastFoe.id,
        orders: this._withNote(closers.map((s) => ({
          type: 'ASSAULT', soldierIds: [s.id], payload: { targetId: lastFoe.id },
        })), '弾が無い！走れ、刺せ！'),
        plan: {
          phase: 'assault', hex: { q: hex.q, r: hex.r },
          baseIds: [], assaultIds: closers.map((s) => s.id),
          targetId: lastFoe.id, label: '決死突撃',
        },
      };
    }
    const shooterIds = shooters.map((s) => s.id);

    // **撃てていない兵から先に突入させる。** 撃てる兵を機動へ回すと、その分だけ
    // 制圧が細って窓が閉じる。射線の通らない位置に居る兵はどのみち火力に
    // 寄与していないので、彼らが機動要素になるのが道理（火力と機動の分業）。
    const pool = ranked.filter((c) => shooterIds.indexOf(c.s.id) < 0)
      .concat(ranked.filter((c) => shooterIds.indexOf(c.s.id) >= 0));

    const assaulters = [];
    let takenFromBase = 0;
    for (let i = 0; i < pool.length && assaulters.length < maxAssault; i++) {
      const cand = pool[i].s;
      const isShooter = shooterIds.indexOf(cand.id) >= 0;
      // 制圧班を最低人数より下げてまで突入要員にはしない
      if (isShooter && (shooters.length - takenFromBase - 1) < minShooters) continue;
      if (isShooter) takenFromBase++;
      assaulters.push(cand);
    }
    if (!assaulters.length) return null;
    const assaultIds = assaulters.map((s) => s.id);
    const base = shooters.filter((s) => assaultIds.indexOf(s.id) < 0);
    if (!base.length) return null;

    const suppressedAt = T.SUPPRESSED_AT != null ? T.SUPPRESSED_AT : 50;
    const readyRatio = T.PUSH_READY_RATIO != null ? T.PUSH_READY_RATIO : 0.5;
    const ready = cluster.members.filter((m) => m.suppression >= suppressedAt).length;
    const needReady = Math.max(1, Math.ceil(cluster.size * readyRatio));

    const suppressOrders = base.map((s) => ({
      type: 'TARGET_HEX', soldierIds: [s.id],
      payload: { hex: { q: hex.q, r: hex.r }, mode: 'suppress' },
    }));

    if (ready < needReady) {
      return {
        name: 'PUSH_SUPPRESS',
        score: hex.q + ',' + hex.r + ':' + ready,
        orders: this._withNote(suppressOrders, 'あの一角を黙らせろ！'),
        plan: {
          phase: 'suppress', hex: { q: hex.q, r: hex.r },
          baseIds: base.map((s) => s.id), assaultIds: [],
          targetId: null, label: '制圧',
        },
      };
    }

    // 頭が下がった。窓が開いている間に決めに行く
    const foe = _priorityFoe(cluster);
    const assaultOrders = assaulters.map((s) => ({
      type: 'ASSAULT', soldierIds: [s.id], payload: { targetId: foe.id },
    }));
    return {
      name: 'PUSH_ASSAULT',
      score: hex.q + ',' + hex.r + ':' + foe.id,
      orders: this._withNote(suppressOrders, '撃ち続けろ！')
        .concat(this._withNote(assaultOrders, '今だ、突っ込め！')),
      plan: {
        phase: 'assault', hex: { q: hex.q, r: hex.r },
        baseIds: base.map((s) => s.id), assaultIds: assaultIds,
        targetId: foe.id, label: '強襲',
      },
    };
  },

  /**
   * 接敵前進。**誰も撃ち合えていない時だけ**、敵の塊へ向かって寄る。
   *
   * セクターを終わらせる責任はここにある。撃ち合いが始まれば攻勢ドクトリンが
   * 引き継ぐので、この采配の役目は「戦闘を発生させること」だけ。
   * 一度に全部は詰めず `ADVANCE_STEPS` ずつの躍進にして、クールダウン毎に
   * 状況を見直しながら寄る（＝盤面では前進と停止を繰り返す動きになる）。
   * @private
   */
  _advanceDoctrine: function (leaderView, worldView, T, state, aliveSquad) {
    const map = worldView.map;
    const clusters = _enemyClusters(worldView, leaderView.team);
    if (!clusters.length) return null;
    const goal = clusters[0].hex;

    // 既に**どの塊とでも**撃ち合える者が居るなら前進ではない（攻勢の領分）。
    // 最大クラスタだけを見ていると、別方向の敵と交戦中なのに前進命令が出る。
    const inContact = aliveSquad.some((s) => s.weapon && clusters.some((c) =>
      map.dist({ q: s.q, r: s.r }, c.hex) <= s.weapon.rngMax
      && map.hasLos({ q: s.q, r: s.r }, c.hex)));
    if (inContact) return null;

    const steps = T.ADVANCE_STEPS != null ? T.ADVANCE_STEPS : 4;
    const coverW = T.ADVANCE_COVER_W != null ? T.ADVANCE_COVER_W : 1.5;
    const orders = [];
    aliveSquad.forEach((s) => {
      if (s.state === 'move') return;   // 既に動いている兵は放っておく
      const path = _advancePath(map, s, goal, steps, coverW);
      if (path.length) {
        orders.push({ type: 'MOVE_TO', soldierIds: [s.id], payload: { path: path, mode: 'auto' } });
      }
    });
    if (!orders.length) return null;

    // 距離をスコアにすると、寄るたびに再発令されて躍進が続く
    const lead = Math.round(map.dist({ q: leaderView.q, r: leaderView.r }, goal));
    return {
      name: 'ADVANCE',
      score: goal.q + ',' + goal.r + ':' + lead,
      orders: this._withNote(orders, '前へ！'),
      plan: {
        phase: 'advance', hex: { q: goal.q, r: goal.r },
        baseIds: [], assaultIds: orders.map((o) => o.soldierIds[0]),
        targetId: null, label: '前進',
      },
    };
  },

  /** @private attach the same NCO note to every order in a batch (dev_sim renders it as a speech bubble) */
  _withNote: function (orders, note) {
    return orders.map((o) => Object.assign({}, o, { note: note }));
  },
};

// ---------------------------------------------------------------------------
// exports (UMD-ish: module.exports on node, global on browser)
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LeaderPolicy: LeaderPolicy };
}
if (typeof window !== 'undefined') {
  window.LeaderPolicy = LeaderPolicy;
}

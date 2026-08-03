/**
 * sim_actions.js -- 行動カタログ（NORTH_STAR §3.2 殺傷ベクトル / §3.4 分隊長の采配）
 *
 * Pure JS, zero dependencies, headless. No window/document/Phaser/setTimeout/Math.random.
 * Requireable from node, and exposed as a global in the browser (UMD-ish, see bottom).
 *
 * **なぜ表にするのか。**
 * 「突撃」「手榴弾」「制圧射撃」を個別に足していくと、同じ前提条件の判定が
 *   ① プレイヤーUI（メニューの活性/非活性）
 *   ② 分隊長AI（sim_leader のドクトリン選択）
 *   ③ 兵士AI（sim_policy の自発行動）
 * の3箇所に散り、片方だけ直すと「AIは使えるのにプレイヤーは選べない技」が生まれる。
 * ここを唯一の語彙にして3者が同じ表を読む。**新しい戦術 = 1エントリ + 1ステート処理**
 * になり、追加した瞬間からAIもそれを使えるようになる。
 *
 * 各エントリの契約:
 *   id        識別子（Order.type とは独立。1行動が複数命令へ展開されてよい）
 *   label     日本語表示名（メニュー・ログ共通。UI側で別名を持たない）
 *   hotkey    ホットキー1文字（null 可）
 *   needs     'enemy' | 'hex' | null — **目的語**の種類。メニューを開く前に確定させる
 *   scope     'self' | 'squad' — 命令が1人へ向くか分隊全体へ向くか
 *   section   メニューの見出し（「この地点へ」「この敵へ」「分隊」）。誰に効くのかを
 *             一目で示すためのもの。動詞だけ並べたメニューは意味を持たない
 *             （2026-08-02 ディレクター指摘「移動と匍匐前進と走るって…どこへ？」）
 *   cost      表示用の代償（露出/準備/消耗）。数値ではなく「何を払うか」の語
 *   available(ctx) -> { ok, reason }  前提条件。reason はそのままUIの非活性理由になる
 *   detail(ctx)    -> string|null     目的語が確定した時の見積り（「1.2秒 · 射線3」）
 *   issue(ctx)     -> Order[]         sim_core.issueOrder() へ流す命令列
 *
 * ctx（呼び出し側が組む）:
 *   { self, target, hex, world: { soldiers, map, tuning }, squad: [soldierView] }
 *   self/target/squad は sim_core の**スナップショット**（破壊的プローブ禁止 §7.3-2）
 */

// ---------------------------------------------------------------------------
// helpers（モジュール private・副作用なし）
// ---------------------------------------------------------------------------

const OK = { ok: true, reason: '' };
function no(reason) { return { ok: false, reason: reason }; }

/** 撃てる状態か（弾があり、武器を持ち、行動可能） */
function canFire(s) {
  if (!s || !s.weapon) return no('武器なし');
  if ((s.magRemaining || 0) <= 0 && (s.magsLeft || 0) <= 0) return no('弾切れ');
  return OK;
}

/** 命令を受け付けられる状態か。行動不能・敗走中の兵には何も届かない */
function canReceiveOrders(s) {
  if (!s || s.hp <= 0) return no('戦闘不能');
  if (s.state === 'incap') return no('行動不能');
  if (s.state === 'rout') return no('敗走中');
  return OK;
}

function distTo(world, a, b) {
  if (!world || !world.map || typeof world.map.dist !== 'function') return Infinity;
  try { return world.map.dist({ q: a.q, r: a.r }, { q: b.q, r: b.r }); } catch (e) { return Infinity; }
}

function hasLos(world, a, b) {
  if (!world || !world.map || typeof world.map.hasLos !== 'function') return true;
  try { return !!world.map.hasLos({ q: a.q, r: a.r }, { q: b.q, r: b.r }); } catch (e) { return false; }
}

/** 射程内かつ視線が通る敵か */
function canEngage(s, target, world) {
  const fire = canFire(s);
  if (!fire.ok) return fire;
  if (!target || target.hp <= 0) return no('対象なし');
  const d = distTo(world, s, target);
  if (d > s.weapon.rngMax) return no('射程外');
  if (!hasLos(world, s, target)) return no('射線が通らない');
  return OK;
}

/**
 * 移動系3行動の共通前提。行き先が未指定なら「これから選ぶ」状態としてメニューは
 * 活性のままにし（hex なし = 対象待ち）、行き先が有るのに経路が無い時だけ弾く。
 */
function canMoveTo(ctx) {
  const r = canReceiveOrders(ctx.self);
  if (!r.ok) return r;
  if (ctx.hex && (!ctx.path || !ctx.path.length)) return no('到達できない');
  return OK;
}

/**
 * 経路が何挺の銃に見られているか。sim_policy の findCoverPath が使う露出評価と
 * 同じ考え方（視線の通る通過マスを数える）だが、こちらは**メニューへ出す数**なので
 * 重み付けをせず「何挺」で示す。sim_policy へは依存しない（各 sim_* は零依存が原則）。
 */
function routeExposure(ctx, path) {
  const map = ctx.world && ctx.world.map;
  if (!path || !path.length || !map || typeof map.hasLos !== 'function') return 0;
  const foes = (ctx.world.soldiers || []).filter(function (o) {
    return o.hp > 0 && o.team !== ctx.self.team;
  });
  let seen = 0;
  for (let i = 0; i < foes.length; i++) {
    for (let j = 0; j < path.length; j++) {
      let visible = false;
      try { visible = map.hasLos({ q: foes[i].q, r: foes[i].r }, path[j]); } catch (e) { visible = false; }
      if (visible) { seen++; break; }   // 1挺につき1回だけ数える
    }
  }
  return seen;
}

/** その経路を指定モードで渡り切る秒数。地形コストを1マスずつ積む。 */
function crossingSeconds(ctx, path, mode) {
  const T = (ctx.world && ctx.world.tuning) || {};
  const map = ctx.world && ctx.world.map;
  if (!path || !path.length || !T.MOVE_T_PER_HEX) return null;
  const modeMult = (T.MOVE_MODE_MULT && T.MOVE_MODE_MULT[mode] != null) ? T.MOVE_MODE_MULT[mode] : 1;
  let ticks = 0;
  for (let i = 0; i < path.length; i++) {
    let cost = 1;
    if (map && typeof map.moveCost === 'function') {
      try { const c = map.moveCost(path[i]); if (isFinite(c) && c > 0) cost = c; } catch (e) { cost = 1; }
    }
    ticks += T.MOVE_T_PER_HEX * cost * modeMult;
  }
  return ticks * ((T.TICK_MS || 100) / 1000);
}

/** 移動系の見積り文字列。「1.2秒 · 射線3」 */
function moveDetail(ctx, mode, extra) {
  if (!ctx.path || !ctx.path.length) return null;
  const sec = crossingSeconds(ctx, ctx.path, mode);
  const seen = routeExposure(ctx, ctx.path);
  const parts = [];
  if (sec != null) parts.push(sec.toFixed(1) + '秒');
  parts.push(seen > 0 ? '射線' + seen : '射線なし');
  if (extra) parts.push(extra);
  return parts.join(' · ');
}

/** 分隊のうち、その敵を実際に撃てる者だけ */
function shootersAgainst(squad, target, world) {
  return (squad || []).filter(function (s) {
    return canReceiveOrders(s).ok && canEngage(s, target, world).ok;
  });
}

// ---------------------------------------------------------------------------
// ACTIONS
// ---------------------------------------------------------------------------

const ACTIONS = {
  /**
   * 歩いて移動。遮蔽を失う（PHIT_MOVING_MULT）が等倍の時間で渡る、既定の移動。
   */
  MOVE: {
    id: 'MOVE', label: '移動', hotkey: null, needs: 'hex', scope: 'self',
    section: 'この地点へ', cost: '露出',
    detail: function (ctx) { return moveDetail(ctx, 'walk'); },
    available: function (ctx) { return canMoveTo(ctx); },
    issue: function (ctx) {
      // モードは指定しない。遮蔽伝いに寄るか・様子を窺うか・走り抜けるかは
      // 1マスごとに現場が決める（sim_policy.pickMoveStep）。敵が居る戦場で
      // 「歩け」と命じるのは不自然、というのがこの設計の出発点。
      return [{
        type: 'MOVE_TO', soldierIds: [ctx.self.id],
        payload: { path: ctx.path, mode: 'auto' },
      }];
    },
  },

  /**
   * 走る（躍進）。渡る時間が半分 = 浴びる弾数が半分。着いた直後は息が上がって
   * 撃てない（PHIT_WINDED）。突撃の足回りでもある。
   */
  RUSH: {
    id: 'RUSH', label: '走る', hotkey: 'R', needs: 'hex', scope: 'self',
    section: 'この地点へ', cost: '速いが、着いた直後は撃てない',
    detail: function (ctx) { return moveDetail(ctx, 'rush', '着後に息切れ'); },
    available: function (ctx) {
      const r = canMoveTo(ctx);
      if (!r.ok) return r;
      const T = (ctx.world && ctx.world.tuning) || {};
      const pinnedAt = T.PINNED_AT != null ? T.PINNED_AT : 80;
      // 選べはするが、釘付けの兵は現場で匍匐へ降格される（vetMoveOrder）。
      // 隠さず理由を見せる方が、なぜ走らないのかが伝わる。
      if (ctx.self.suppression >= pinnedAt) return no('釘付け（匍匐になる）');
      return OK;
    },
    issue: function (ctx) {
      return [{
        type: 'MOVE_TO', soldierIds: [ctx.self.id],
        payload: { path: ctx.path, mode: 'rush' },
      }];
    },
  },

  /**
   * 匍匐前進。2.5倍遅いが**遮蔽を失わない**うえ的も小さい。
   * MGの射線(×4.0)を渡る唯一の現実的な手段。
   */
  CRAWL: {
    id: 'CRAWL', label: '匍匐', hotkey: 'V', needs: 'hex', scope: 'self',
    section: 'この地点へ', cost: '遅いが、遮蔽を失わない',
    detail: function (ctx) { return moveDetail(ctx, 'crawl', '遮蔽を保つ'); },
    available: function (ctx) { return canMoveTo(ctx); },
    issue: function (ctx) {
      return [{
        type: 'MOVE_TO', soldierIds: [ctx.self.id],
        payload: { path: ctx.path, mode: 'crawl' },
      }];
    },
  },

  /**
   * 制圧（対象＝地点）。指定hexを叩き続け、**見えている敵は着実に削りながら
   * 反撃の隙を与えない**。行動可能な敵がそのhexから居なくなれば自動で解除され、
   * 兵は次の最適な行動へ戻る。
   */
  SUPPRESS_HEX: {
    id: 'SUPPRESS_HEX', label: '制圧', hotkey: 'S', needs: 'hex', scope: 'self',
    section: 'この地点へ', cost: '弾薬',
    available: function (ctx) {
      const r = canReceiveOrders(ctx.self);
      if (!r.ok) return r;
      const f = canFire(ctx.self);
      if (!f.ok) return f;
      if (!ctx.hex) return OK;
      if (distTo(ctx.world, ctx.self, ctx.hex) > ctx.self.weapon.rngMax) return no('射程外');
      if (!hasLos(ctx.world, ctx.self, ctx.hex)) return no('射線が通らない');
      return OK;
    },
    issue: function (ctx) {
      return [{
        type: 'TARGET_HEX', soldierIds: [ctx.self.id],
        payload: { hex: { q: ctx.hex.q, r: ctx.hex.r }, mode: 'suppress' },
      }];
    },
  },

  /**
   * 強襲（対象＝敵ユニット）。**撃滅がゴール**で、そのためにリスクを取る。
   * 主武器・拳銃・手榴弾・銃擲弾・白兵を距離に応じて使い分け、同一hexの敵を
   * 全滅させるまで続く。見失って周囲にも居なくなれば解除。
   */
  ASSAULT: {
    id: 'ASSAULT', label: '強襲', hotkey: 'V', needs: 'enemy', scope: 'self',
    section: 'この敵へ', cost: '身を晒す',
    available: function (ctx) {
      const r = canReceiveOrders(ctx.self);
      if (!r.ok) return r;
      if (!ctx.target) return OK;
      if (ctx.target.hp <= 0) return no('対象なし');
      return OK;
    },
    issue: function (ctx) {
      return [{
        type: 'ASSAULT', soldierIds: [ctx.self.id],
        payload: { targetId: ctx.target.id },
        note: '突っ込め！',
      }];
    },
  },

  /**
   * 単体の照準射撃。メニューには出さない（制圧・強襲へ集約した）が、
   * 分隊長AIとトレイトAIの語彙としては残る。
   */
  FIRE: {
    id: 'FIRE', label: '射撃', hotkey: null, needs: 'enemy', scope: 'self',
    section: 'この敵へ', cost: '弾薬',
    detail: function (ctx) {
      return (ctx.self && ctx.self.name) ? ctx.self.name + ' が狙う' : null;
    },
    available: function (ctx) {
      const r = canReceiveOrders(ctx.self);
      if (!r.ok) return r;
      // 対象未指定は「これから敵を選ぶ」状態なので活性のまま。的が決まっていない
      // ことを理由に射撃を選べなくすると、メニューから撃つ手段が消える。
      if (!ctx.target) return canFire(ctx.self);
      return canEngage(ctx.self, ctx.target, ctx.world);
    },
    issue: function (ctx) {
      return [{
        type: 'TARGET', soldierIds: [ctx.self.id],
        payload: { targetId: ctx.target.id, mode: 'aimed' },
      }];
    },
  },

  /**
   * 手榴弾。遮蔽の効かない唯一の殺傷手段だが、射程が短いので**接近が要る**。
   * 信管の数秒があるため、制圧できていない敵は逃げられる。
   */
  GRENADE: {
    id: 'GRENADE', label: '手榴弾', hotkey: 'G', needs: 'hex', scope: 'self',
    section: 'この地点へ', cost: '接近が要る・残数',
    available: function (ctx) { return canThrow(ctx, 'grenade'); },
    issue: function (ctx) {
      return [{
        type: 'GRENADE', soldierIds: [ctx.self.id],
        payload: { hex: { q: ctx.hex.q, r: ctx.hex.r }, kind: 'grenade' },
      }];
    },
  },

  /**
   * 銃擲弾。手榴弾より遠く届くが、装着に3秒以上かかる（その間は無防備）。
   * 遠くの遮蔽下を叩ける唯一の手段。
   */
  RIFLE_GRENADE: {
    id: 'RIFLE_GRENADE', label: '銃擲弾', hotkey: 'T', needs: 'hex', scope: 'self',
    section: 'この地点へ', cost: '装着に数秒・残数',
    available: function (ctx) { return canThrow(ctx, 'rifle_grenade'); },
    issue: function (ctx) {
      return [{
        type: 'GRENADE', soldierIds: [ctx.self.id],
        payload: { hex: { q: ctx.hex.q, r: ctx.hex.r }, kind: 'rifle_grenade' },
      }];
    },
  },

  /**
   * 集中射撃（§3.4 分隊長の采配）。「全員であのMG手を狙え」。
   * 速くpinする道具であって殺す道具ではない（FOCUS_PHIT_PENALTY_PER_EXTRA）。
   */
  FOCUS_FIRE: {
    id: 'FOCUS_FIRE', label: '集中射撃', hotkey: 'F', needs: 'enemy', scope: 'squad',
    section: '分隊', cost: '分隊の弾薬',
    detail: function (ctx) {
      const n = shootersAgainst(ctx.squad, ctx.target, ctx.world).length;
      return n ? '届く' + n + '名' : null;
    },
    available: function (ctx) {
      if (!ctx.target || ctx.target.hp <= 0) return no('対象なし');
      const shooters = shootersAgainst(ctx.squad, ctx.target, ctx.world);
      if (!shooters.length) return no('届く者がいない');
      return OK;
    },
    issue: function (ctx) {
      const shooters = shootersAgainst(ctx.squad, ctx.target, ctx.world);
      return shooters.map(function (s) {
        return {
          type: 'TARGET', soldierIds: [s.id],
          payload: { targetId: ctx.target.id, mode: 'aimed' },
          note: 'あの一点を潰せ！',
        };
      });
    },
  },

  /**
   * 制圧射撃（対象＝敵）。「あのMG手の頭を上げさせるな」。
   * 集中射撃との違いは目的で、こちらは殺すためでなく**動きを止める**ために撃つ。
   */
  SUPPRESS: {
    id: 'SUPPRESS', label: '制圧射撃', hotkey: 'S', needs: 'enemy', scope: 'squad',
    section: '分隊', cost: '分隊の弾薬（大）',
    detail: function (ctx) {
      const n = shootersAgainst(ctx.squad, ctx.target, ctx.world).length;
      return n ? 'この敵を' + n + '名で' : null;
    },
    available: function (ctx) {
      if (!ctx.target || ctx.target.hp <= 0) return no('対象なし');
      const shooters = shootersAgainst(ctx.squad, ctx.target, ctx.world);
      if (!shooters.length) return no('届く者がいない');
      return OK;
    },
    issue: function (ctx) {
      return shootersAgainst(ctx.squad, ctx.target, ctx.world).map(function (s) {
        return {
          type: 'TARGET', soldierIds: [s.id],
          payload: { targetId: ctx.target.id, mode: 'suppress' },
          note: '制圧しろ！頭を上げさせるな！',
        };
      });
    },
  },

  /**
   * 面制圧（対象＝地点）。「あの林を制圧しろ」。
   * **見えていない敵の潜む地帯へ撃ち込める**のが単体制圧との違い。命中判定は
   * 行われないので敵は減らない — 頭を下げさせて機動の窓を開ける道具。
   */
  SUPPRESS_AREA: {
    id: 'SUPPRESS_AREA', label: 'この一帯を制圧', hotkey: 'A', needs: 'hex', scope: 'squad',
    section: '分隊', cost: '分隊の弾薬（大）・命中なし',
    detail: function (ctx) {
      const n = areaShooters(ctx).length;
      return n ? n + '名が撃ち込む' : null;
    },
    available: function (ctx) {
      if (!ctx.hex) return no('地点が未指定');
      if (!areaShooters(ctx).length) return no('届く者がいない');
      return OK;
    },
    issue: function (ctx) {
      return areaShooters(ctx).map(function (s) {
        return {
          type: 'TARGET_HEX', soldierIds: [s.id],
          payload: { hex: { q: ctx.hex.q, r: ctx.hex.r }, mode: 'suppress' },
          note: 'あの一帯を叩け！',
        };
      });
    },
  },

  /**
   * 遮蔽に入れ。行き先は指定しない — どこへ隠れるかは現場の兵が決める（§3.4 三現主義）。
   */
  TAKE_COVER: {
    id: 'TAKE_COVER', label: '遮蔽に入れ', hotkey: 'C', needs: null, scope: 'squad',
    section: '分隊', cost: '射撃の中断',
    detail: function (ctx) {
      const n = (ctx.squad || []).filter(function (s) { return canReceiveOrders(s).ok; }).length;
      return n ? n + '名・行き先は各自が選ぶ' : null;
    },
    available: function (ctx) {
      const movable = (ctx.squad || []).filter(function (s) { return canReceiveOrders(s).ok; });
      if (!movable.length) return no('動ける兵がいない');
      return OK;
    },
    issue: function (ctx) {
      return (ctx.squad || [])
        .filter(function (s) { return canReceiveOrders(s).ok; })
        .map(function (s) {
          return { type: 'TAKE_COVER', soldierIds: [s.id], payload: {}, note: '遮蔽に入れ！' };
        });
    },
  },
};

/** 投擲・擲弾の前提。残数・射程・視線。@private */
function canThrow(ctx, kind) {
  const s = ctx.self;
  const r = canReceiveOrders(s);
  if (!r.ok) return r;
  const spec = ((ctx.world && ctx.world.tuning && ctx.world.tuning.MUNITIONS) || {})[kind];
  if (!spec) return no('未装備');
  const have = (kind === 'rifle_grenade') ? (s.rifleGrenades || 0) : (s.grenades || 0);
  if (have <= 0) return no('残数なし');
  if (!ctx.hex) return OK;   // これから投げ先を選ぶ
  if (distTo(ctx.world, s, ctx.hex) > spec.rng) return no('届かない');
  if (!hasLos(ctx.world, s, ctx.hex)) return no('視線が通らない');
  return OK;
}

/** 指定 hex へ撃ち込める分隊員（射程内・視線が通る）。@private */
function areaShooters(ctx) {
  if (!ctx.hex) return [];
  return (ctx.squad || []).filter(function (s) {
    if (!canReceiveOrders(s).ok || !canFire(s).ok) return false;
    if (distTo(ctx.world, s, ctx.hex) > s.weapon.rngMax) return false;
    return hasLos(ctx.world, s, ctx.hex);
  });
}

// 表示順。メニューもホットキー一覧もここを唯一の順序とする。
// 個人の語彙は**3つだけ**（2026-08-02 ディレクター確定）:
//   移動 — どう渡るかは1マスごとに現場が決める
//   制圧 — 地点を叩き続け、削りながら反撃させない。敵が居なくなれば自動解除
//   強襲 — 特定ユニットの撃滅。あらゆる手段を使い、同一hexを全滅させるまで続く
// 走る/匍匐/射撃/手榴弾/銃擲弾は**行動の中身**であって命令ではない。カタログには
// 残すのでAI・テストからは名指しできるが、メニューには出さない。
const ACTION_ORDER = ['MOVE', 'SUPPRESS_HEX', 'ASSAULT',
  'SUPPRESS_AREA', 'FOCUS_FIRE', 'TAKE_COVER'];
const HIDDEN_ACTIONS = ['RUSH', 'CRAWL', 'FIRE', 'GRENADE', 'RIFLE_GRENADE', 'SUPPRESS'];

const SimActions = {
  ACTIONS: ACTIONS,
  ORDER: ACTION_ORDER,

  get: function (id) { return ACTIONS[id] || null; },

  /** ホットキー -> 行動。大文字小文字は問わない。 */
  byHotkey: function (key) {
    if (!key) return null;
    const k = String(key).toUpperCase();
    for (let i = 0; i < ACTION_ORDER.length; i++) {
      const a = ACTIONS[ACTION_ORDER[i]];
      if (a.hotkey && a.hotkey.toUpperCase() === k) return a;
    }
    return null;
  },

  /** メニューに出さない行動（移動モードの名指し）。AI・テストからは使える。 */
  HIDDEN: HIDDEN_ACTIONS,

  /**
   * 表示順に、各行動の可否・理由・見積りを返す。メニュー描画はこれをそのまま
   * 並べればよい（UI側で前提条件を再実装しないための入口）。
   * @returns {Array<{action, ok, reason, detail, section}>}
   */
  list: function (ctx) {
    return ACTION_ORDER.map(function (id) {
      const action = ACTIONS[id];
      let verdict;
      try { verdict = action.available(ctx) || OK; } catch (e) { verdict = no('判定不能'); }
      let detail = null;
      if (verdict.ok && typeof action.detail === 'function') {
        try { detail = action.detail(ctx); } catch (e) { detail = null; }
      }
      return {
        action: action, ok: !!verdict.ok, reason: verdict.reason || '',
        detail: detail || '', section: action.section || '',
      };
    });
  },

  /**
   * **目的語が確定した状態の**メニュー。地面を右クリックしたなら地点を取る行動、
   * 敵を右クリックしたなら敵を取る行動だけを返す（+ 目的語不要の分隊命令）。
   *
   * 動詞を先に選ばせて後から「どこへ？」と訊く順序が混乱の元だった
   * （2026-08-02 ディレクター指摘）。目的語 → 動詞、が正しい順序。
   *
   * @param {'hex'|'enemy'} kind クリックされた対象の種類
   */
  listFor: function (kind, ctx) {
    return this.list(ctx).filter(function (entry) {
      const needs = entry.action.needs;
      return needs === kind || needs === null;
    });
  },

  /**
   * 行動を命令列へ変換する。前提を満たさない場合は空配列（呼び出し側は理由を
   * `available` で取る）。
   * @returns {Object[]} Order[]
   */
  issue: function (id, ctx) {
    const action = ACTIONS[id];
    if (!action) return [];
    let verdict;
    try { verdict = action.available(ctx) || OK; } catch (e) { return []; }
    if (!verdict.ok) return [];
    try { return action.issue(ctx) || []; } catch (e) { return []; }
  },
};

// ---------------------------------------------------------------------------
// exports (UMD-ish: module.exports on node, global on browser)
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SimActions: SimActions, ACTIONS: ACTIONS };
}
if (typeof window !== 'undefined') {
  window.SimActions = SimActions;
}

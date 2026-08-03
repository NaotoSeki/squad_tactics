/**
 * LOGIC BATTLE RTWP — 本編をリアルタイム＋一時停止へ移行する接ぎ木モジュール
 *
 * NORTH_STAR §7 Strangler Fig。**logic_game.js（2133行）は一行も書き換えない。**
 * 旧ターン制コアは残置し、このモジュールを外せば即座に元へ戻る。
 *
 * この方式が成立する理由:
 *   phaser_unit.js の UnitView.update() は毎フレーム window.gameLogic.units を走査し、
 *   各ユニットの q / r / hp からスプライト位置と HP バーを同期している。したがって
 *   **シムの状態を gameLogic.units へ書き戻すだけで、既存の描画・アニメ・VFX が
 *   そのまま追従する**（syncUnits を参照）。新しい描画コードは要らない。
 *
 * 責務:
 *   - gameLogic.map（TERRAIN互換グリッド）から sim_core の MapApi を作る
 *   - 生存ユニットを sim の兵士として登録し、id で対応表を持つ
 *   - 毎フレーム固定100msでシムを進め、イベントを演出とログへ流し、状態を書き戻す
 *   - プレイヤー命令（移動・集中射撃・制圧射撃）を sim の命令へ翻訳する
 */
(function () {
  'use strict';

  /** ユニットのスキル名 -> sim のトレイト（§4.1 の無命令時行動の差分） */
  const SKILL_TRAITS = {
    Berserker: 'aggressive',
    Veteran: 'calm',
    Medic: 'cautious',
    Rookie: 'timid',
  };

  /** axial hex 距離（cube 換算の max 形） */
  function hexDist(a, b) {
    const dq = a.q - b.q, dr = a.r - b.r;
    return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
  }

  function cubeRound(q, r) {
    const x = q, z = r, y = -x - z;
    let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
    const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (dy > dz) ry = -rx - rz;
    else rz = -rx - ry;
    return { q: rx, r: rz };
  }

  /**
   * from から to への**1hexずつ刻んだ**経路。
   * sim_core の移動は movePath の要素へ隣接判定なしで座標を代入する（1要素=1hex前提）
   * ため、遠い hex を要素1個で渡すと兵士がワープする。進入不可に当たったら手前で止める。
   */
  function straightPath(map, from, to) {
    const n = hexDist(from, to);
    const path = [];
    let prev = { q: from.q, r: from.r };
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const step = cubeRound(from.q + (to.q - from.q) * t, from.r + (to.r - from.r) * t);
      if (step.q === prev.q && step.r === prev.r) continue;
      let cost = Infinity;
      try { cost = map.moveCost(prev, step); } catch (e) { cost = Infinity; }
      if (!isFinite(cost)) break;
      path.push(step);
      prev = step;
    }
    return path;
  }

  // -------------------------------------------------------------------------

  function RtwpInstance(gameLogic, sim, map, rng) {
    this.gameLogic = gameLogic;
    this.sim = sim;
    this.map = map;
    this.rng = rng;
    this.unitById = new Map();
    this.leaderState = { A: {}, B: {} };
    this.acc = 0;
    this.speed = 1;
    this.paused = false;
    this._skipNextDelta = false;
    // 対象待ちの行動。「走る」を選んだ後に行き先をクリックする、の中間状態。
    // { id, unit } を持ち、次のクリックで消費される。
    this.pendingAction = null;
  }

  /**
   * 本編側で新しく生成された兵士を、進行中のRTwPへ参加させる。
   * 初期配置だけでなく、手札カード・増援など戦闘開始後の追加にも使う。
   */
  RtwpInstance.prototype.registerUnit = function (unit) {
    if (!unit || unit.hp <= 0 || !this.sim) return null;
    const id = String(unit.id);
    const existing = this.sim.getSoldier(id);
    if (existing) {
      this.unitById.set(id, unit);
      return existing;
    }
    if (unit._rtwpSkipped) return null;

    const D = resolveDeps();
    const T = D.SIM_TUNING;
    const team = (unit.team === 'player') ? 'A' : 'B';
    let weapon = null;
    try { weapon = this.gameLogic.getVirtualWeapon(unit); } catch (e) { weapon = null; }
    const code = weapon && weapon.code;
    if (!code || !D.WPNS || !D.WPNS[code]) {
      unit._rtwpSkipped = true;
      return null;
    }

    let simWeapon = null;
    try { simWeapon = D.toSimWeapon(code, D.WPNS[code], T); } catch (e) { simWeapon = null; }
    if (!simWeapon) {
      unit._rtwpSkipped = true;
      return null;
    }

    const traits = [];
    (unit.skills || []).forEach((skill) => {
      if (SKILL_TRAITS[skill]) traits.push(SKILL_TRAITS[skill]);
    });
    const hasLeader = this.sim.soldiers().some((soldier) => soldier.team === team && soldier.isLeader && soldier.hp > 0);

    // 予備弾倉は「実際に背負っている弾」から数える。DEFAULT_MAGS を使うと、
    // 右ペインに見えている予備弾アイテムとシムの弾数が別勘定になり、
    // 撃ってもリロードしても背嚢が減らない（オーナー指摘 2026-08-02）。
    // 携行弾を持たないユニット（敵の既定装備など）だけ従来の既定値へ落とす。
    const found = this._collectSpareAmmo(unit, weapon);
    const magCap = Number(simWeapon.magCap) || 0;
    const defaultMags = (T.DEFAULT_MAGS && T.DEFAULT_MAGS[simWeapon.class] != null)
      ? T.DEFAULT_MAGS[simWeapon.class] : 4;
    const spares = (found.length && magCap > 0)
      ? this._splitIntoMagazines(unit, found, magCap)
      : [];
    const mags = spares.length ? spares.length : (found.length ? 0 : defaultMags);
    unit._rtwpSpareAmmo = spares;

    // 投擲弾は**実際に背負っている物**から数える。既定値で配ると、右ペインに
    // 見えている個数とシムの残数が別勘定になる（弾倉で踏んだのと同じ罠）。
    // 銃擲弾はその銃に適合する品だけ（RIFLE_GRENADE_FOR_MAIN は PL 実データ由来）。
    const rgCodes = (D.RIFLE_GRENADE_FOR_MAIN && D.RIFLE_GRENADE_FOR_MAIN[code]) || [];
    const nades = this._collectMunitions(unit, ['nade']);
    const rifleNades = this._collectMunitions(unit, rgCodes);
    unit._rtwpNades = nades;
    unit._rtwpRifleNades = rifleNades;

    this.sim.addSoldier({
      id: id, team: team, q: unit.q, r: unit.r,
      weapon: simWeapon, ammo: { mags: mags }, skill: 1.0,
      grenades: nades.length, rifleGrenades: rifleNades.length,
      // 実物の性能（射程・威力）を弾種スペックへ持ち込む。SIM_TUNING 側は
      // 挙動（構え・信管・範囲）だけを持ち、数字は現物に従う。
      munitionSpec: {
        grenade: this._munitionSpecFromItem(nades[0]),
        rifle_grenade: this._munitionSpecFromItem(rifleNades[0]),
      },
      attrs: unit.params || null,
      sidearm: this._findSidearm(unit, code, T, D),
      isLeader: !hasLeader, traits: traits,
      facing: (team === 'A') ? { q: 1, r: 0 } : { q: -1, r: 0 },
    });

    const soldier = this.sim.getSoldier(id);
    if (!soldier) return null;
    const maxHp = Number(unit.maxHp) || Number(unit.hp) || 100;
    unit._rtwpHpScale = maxHp / Math.max(1, soldier.hp || 100);
    // 弾薬の書き戻し先。sim は code から作った simWeapon で撃つので、
    // 同じ code を持つ手持ちスロットが「その銃」の実体になる。
    unit._rtwpWeaponCode = code;
    delete unit._rtwpSkipped;
    this.unitById.set(id, unit);
    return soldier;
  };

  RtwpInstance.prototype.registerMissingUnits = function () {
    const units = (this.gameLogic && this.gameLogic.units) || [];
    for (let i = 0; i < units.length; i++) {
      const unit = units[i];
      if (unit && unit.hp > 0 && !this.unitById.has(String(unit.id))) this.registerUnit(unit);
    }
  };

  /**
   * **接ぎ木の要。** sim の状態を既存ユニットへ書き戻す。UnitView はここで書いた
   * q/r/hp を毎フレーム読むので、これだけで既存の描画が RTwP に追従する。
   */
  RtwpInstance.prototype.syncUnits = function () {
    if (!this.sim) return;
    const soldiers = this.sim.soldiers();
    for (let i = 0; i < soldiers.length; i++) {
      const s = soldiers[i];
      const unit = this.unitById.get(String(s.id));
      if (!unit) continue;

      unit.q = s.q;
      unit.r = s.r;

      // sim の hp は 0..100 固定。本編のユニットは maxHp がまちまちなので、
      // 登録時に取った比率で戻す（sim 側で半分減ったら本編でも半分減る）。
      const scale = (typeof unit._rtwpHpScale === 'number') ? unit._rtwpHpScale : 1;
      unit.hp = Math.max(0, Math.min(unit.maxHp, Math.round(s.hp * scale)));

      // 表示用の付加情報。既存描画が読まなくても害はない。
      unit.suppression = s.suppression;
      unit.simState = s.state;
      unit.facing = s.facing;
      unit._rtwpTargetId = s.engageTargetId || null;
      if (s.engageTargetId) delete unit._rtwpPendingTargetId;
      // SoldierUnitView はこの完全なsnapshotから engage/reload/suppression/facingを
      // 選ぶ。本番側で渡していなかったため、見た目だけ常時idleになっていた。
      unit._sim = s;
      unit._rtwpAmmo = {
        rounds: s.magRemaining,
        magazines: s.magsLeft,
        capacity: s.weapon ? s.weapon.magCap : 0,
      };
      // 弾薬もq/r/hpと同じ接ぎ木で書き戻す。旧ターン制の item.current は RTwP では
      // 誰も減らさないため、既存の弾ゲージが常に満タンのままだった（正本は sim）。
      this._writeBackAmmo(unit, s);
      // 投げた分だけ背嚢から実体を消す（残数バーではなく物の数で見せる）
      this._writeBackMunitions(unit, '_rtwpNades', s.grenades);
      this._writeBackMunitions(unit, '_rtwpRifleNades', s.rifleGrenades);

      if (s.state === 'pinned' || s.state === 'suppressed') unit.stance = 'prone';
      else if (s.state === 'move') unit.stance = 'stand';
    }
  };

  /**
   * sim の実弾倉を、本編が持つ武器アイテムへ書き戻す。
   *
   * 既存の弾ゲージ（LOADOUTスロットの弾ピップ）は `item.current` を読む。RTwP の
   * 発射は sim 側で `magRemaining` を減らすだけなので、書き戻さないとゲージが
   * 一発も減らない。予備弾倉は本数×装弾数を `reserve` へ入れて総弾数を合わせる。
   */
  RtwpInstance.prototype._writeBackAmmo = function (unit, s) {
    const code = unit._rtwpWeaponCode;
    if (!code || !unit.hands || !s.weapon) return;
    const magCap = Number(s.weapon.magCap) || 0;

    for (let i = 0; i < unit.hands.length; i++) {
      const item = unit.hands[i];
      if (!item || item.code !== code) continue;
      const cap = Number(item.cap) || magCap;
      item.current = Math.max(0, Math.min(cap, Number(s.magRemaining) || 0));
      // ベルト給弾(MG)は元から reserve を持つ。持たない銃にも予備弾数を載せると
      // 旧ターン制の再装填判定が誤作動しうるので、既にある時だけ更新する。
      if (item.reserve !== undefined) {
        item.reserve = Math.max(0, (Number(s.magsLeft) || 0) * magCap);
      }
      break;
    }

    // 予備弾倉は**アイテムとして**消える。装填のたびに背嚢から1個ずつ取り除く
    // ので、右ペインを見れば残り何本かが一目で分かる（残量バーではなく物の数）。
    const spares = unit._rtwpSpareAmmo;
    if (!spares || !spares.length) return;
    const want = Math.max(0, Number(s.magsLeft) || 0);
    while (spares.length > want) {
      const gone = spares.pop();
      this._removeItem(unit, gone);
    }
  };

  /**
   * 指定コードの投擲弾を背嚢・LOADOUT から集める。1個 = 1発として扱い、
   * 使うたびに実体を取り除く（右ペインの個数がそのまま残数になる）。
   */
  RtwpInstance.prototype._collectMunitions = function (unit, codes) {
    const out = [];
    if (!codes || !codes.length) return out;
    const take = (item) => { if (item && codes.indexOf(item.code) >= 0) out.push(item); };
    for (let i = 1; i < (unit.hands || []).length; i++) take(unit.hands[i]);
    (unit.bag || []).forEach(take);
    return out;
  };

  /**
   * 副武装（拳銃）。強襲で主武器が尽きた時に持ち替える先。
   * 現物主義: 背嚢・LOADOUT に**実際に入っている拳銃**だけを拾う。
   */
  RtwpInstance.prototype._findSidearm = function (unit, mainCode, T, D) {
    const isPistol = (item) => {
      if (!item || !item.code || item.code === mainCode) return false;
      const def = D.WPNS && D.WPNS[item.code];
      if (!def || def.type !== 'bullet') return false;
      return def.plCategory === 'pistol' || (def.rng <= 4 && (def.cap || 0) > 0 && (def.cap || 0) <= 10);
    };
    const slots = [];
    for (let i = 1; i < (unit.hands || []).length; i++) slots.push(unit.hands[i]);
    (unit.bag || []).forEach((item) => slots.push(item));
    const found = slots.find(isPistol);
    if (!found) return null;
    let w = null;
    try { w = D.toSimWeapon(found.code, D.WPNS[found.code], T); } catch (e) { w = null; }
    return w ? { weapon: w, mags: 1 } : null;
  };

  /**
   * 投擲弾の実物性能。射程と威力は WPNS（PL実データ）から取り、SIM_TUNING 側の
   * 既定を上書きする。挙動（構え時間・信管・範囲）はチューニング表が持つ。
   */
  RtwpInstance.prototype._munitionSpecFromItem = function (item) {
    const W = resolveDeps().WPNS;
    const def = item && W && W[item.code];
    if (!def) return null;
    const spec = {};
    if (def.rng > 0) spec.rng = def.rng;
    if (def.dmg > 0) spec.dmg = { base: def.dmg, spread: Math.round(def.dmg * 0.4) };
    return spec;
  };

  /** sim の残数まで、背嚢の投擲弾を減らす。 */
  RtwpInstance.prototype._writeBackMunitions = function (unit, key, want) {
    const list = unit[key];
    if (!list || !list.length) return;
    const target = Math.max(0, Number(want) || 0);
    while (list.length > target) this._removeItem(unit, list.pop());
  };

  /** 背嚢/LOADOUT から実体を取り除く（同じ参照だけを消す） */
  RtwpInstance.prototype._removeItem = function (unit, item) {
    if (!item) return;
    if (unit.bag) {
      const i = unit.bag.indexOf(item);
      if (i >= 0) { unit.bag.splice(i, 1); return; }
    }
    if (unit.hands) {
      for (let i = 1; i < unit.hands.length; i++) {
        if (unit.hands[i] === item) { unit.hands[i] = null; return; }
      }
    }
  };

  /**
   * 予備弾のプール（例: 250発の弾帯1個）を、弾倉1本ぶんずつのアイテムへ割り直す。
   *
   * こうしないと「弾倉を1本使った」ことが背嚢の見た目に出ない — 250/250 が
   * 200/250 になっても、アイテムの個数が変わらないので減った実感が無い。
   * 1個=1弾倉にしておけば、装填のたびに背嚢から1個消える。
   * 端数（弾倉に満たない残り）は装填できないので捨てる。
   */
  RtwpInstance.prototype._splitIntoMagazines = function (unit, items, magCap) {
    const mags = [];
    items.forEach((item) => {
      const rounds = Number(item.current) || 0;
      const n = Math.floor(rounds / magCap);
      this._removeItem(unit, item);
      for (let i = 0; i < n; i++) {
        const mag = Object.assign({}, item, {
          current: magCap, cap: magCap, id: Math.random(),
        });
        mags.push(mag);
        if (unit.bag) unit.bag.push(mag);
      }
    });
    return mags;
  };

  /**
   * その銃に装填できる予備弾アイテムを LOADOUT(hands[1-2]) → 背嚢 の順に集める。
   * 適合判定は旧ターン制の再装填と同じ `isSpareAmmoCompatible` を使う（別基準を
   * 作ると「手動リロードでは装填できるのにRTwPでは数えない弾」が生まれる）。
   */
  RtwpInstance.prototype._collectSpareAmmo = function (unit, weapon) {
    const out = [];
    const fits = function (item) {
      if (!item || item.type !== 'ammo') return false;
      if (typeof window.isSpareAmmoCompatible === 'function') {
        try { return !!window.isSpareAmmoCompatible(weapon, item); } catch (e) { /* 落ちない */ }
      }
      return item.ammoFor === weapon.code;
    };
    for (let i = 1; i < 3; i++) {
      if (unit.hands && fits(unit.hands[i])) out.push(unit.hands[i]);
    }
    (unit.bag || []).forEach(function (item) { if (fits(item)) out.push(item); });
    return out;
  };

  /** 分隊長AI（三現主義: 現場の下士官が采配する）。命令は CommsOrders 経由で遅延配達。 */
  RtwpInstance.prototype.runLeaderAI = function () {
    const D = resolveDeps();
    const T = D.SIM_TUNING;
    const LP = D.LeaderPolicy;
    if (!LP || typeof LP.assess !== 'function') return;
    const interval = T.LEADER_ASSESS_INTERVAL_T;
    if (!interval || (this.sim._tick % interval) !== 0) return;

    const soldiers = this.sim.soldiers();
    ['A', 'B'].forEach((team) => {
      // incap の分隊長は采配しない（倒れた指揮官が指揮を続けない）
      const leader = soldiers.find((s) => s.team === team && s.isLeader && s.hp > 0
        && s.state !== 'incap');
      if (!leader) return;
      try {
        const wv = { soldiers: soldiers, map: this.map, tuning: T, tick: this.sim._tick };
        (LP.assess(leader, wv, this.rng, this.leaderState[team]) || [])
          .forEach((o) => this.sim.issueOrder(o));
      } catch (e) { /* 分隊長AIの失敗でシムを止めない（無命令ならトレイトで動く） */ }
    });
  };

  RtwpInstance.prototype._name = function (id) {
    const u = this.unitById.get(String(id));
    return (u && u.name) || String(id);
  };
  RtwpInstance.prototype._log = function (msg) {
    const ui = this.gameLogic && this.gameLogic.ui;
    if (ui && typeof ui.log === 'function') ui.log(msg);
  };

  /** sim_battle.html と同一のイベント文言。製品側だけ日本語へ要約しない。 */
  RtwpInstance.prototype.formatEvent = function (ev) {
    const parts = ['t' + ev.tick, ev.type];
    if (ev.id) parts.push(this._name(ev.id));
    if (ev.shooterId && ev.area) {
      parts.push(this._name(ev.shooterId) + '->('
        + (ev.targetHex ? ev.targetHex.q + ',' + ev.targetHex.r : '?') + ') 面制圧');
    } else if (ev.shooterId) {
      parts.push(this._name(ev.shooterId) + '->' + this._name(ev.targetId)
        + (ev.hit ? ' HIT' : ' miss') + (ev.killed ? ' KILL' : ''));
    }
    if (ev.type === 'SHOT' && ev.roundsFired) parts.push('x' + ev.roundsFired);
    if (ev.type === 'GRENADE') {
      const T = resolveDeps().SIM_TUNING;
      const spec = (T && T.MUNITIONS && T.MUNITIONS[ev.kind]) || null;
      parts.push((spec ? spec.label : ev.kind)
        + '->(' + ev.target.q + ',' + ev.target.r + ')');
    }
    if (ev.type === 'BLAST') {
      const killed = (ev.casualties || []).filter((c) => c.killed).length;
      parts.push('(' + ev.hex.q + ',' + ev.hex.r + ') 命中'
        + (ev.casualties || []).length + (killed ? ' KILL' + killed : ''));
    }
    if (ev.note) parts.push('「' + ev.note + '」');
    if (ev.type === 'ORDER_DELIVERED' && ev.order) parts.push(ev.order.type);
    if (ev.type === 'ASSAULT_START') parts.push('強襲 -> ' + this._name(ev.targetId));
    if (ev.type === 'ASSAULT_END') parts.push('強襲終了 (' + ev.reason + ')');
    if (ev.type === 'SUPPRESS_END') parts.push('制圧終了 (' + ev.reason + ')');
    if (ev.type === 'MELEE_START') parts.push('白兵 -> ' + this._name(ev.targetId));
    if (ev.type === 'SWAP') parts.push('拳銃へ持ち替え');
    if (ev.type === 'STUMBLE') parts.push('躓いて伏せる');
    return parts.join(' ');
  };

  /**
   * ブラウザでは既存Battle Log窓を sim_battle のイベントログとして使う。
   * UIManager.log は先頭へ `> ` を加えるため、ここだけ直接追加して文言を一致させる。
   * headless では既存 ui.log へ落とし、同じ文字列をテストできるようにする。
   */
  RtwpInstance.prototype.pushEventLog = function (text) {
    if (typeof document !== 'undefined') {
      const body = document.getElementById('battle-log-body');
      if (body) {
        const d = document.createElement('div');
        d.className = 'log-entry';
        d.textContent = text;
        body.appendChild(d);
        while (body.children.length > 300) body.removeChild(body.firstChild);
        body.scrollTop = body.scrollHeight;
        return;
      }
    }
    // installUi後は ui.log 自体が pushEventLog を指す。ログDOMが無い環境で _logへ
    // 戻すと再帰するため、保存してある元の実装を直接呼ぶ。
    const ui = this.gameLogic && this.gameLogic.ui;
    if (ui && this._orig && typeof this._orig.uiLog === 'function') {
      this._orig.uiLog.call(ui, text);
      return;
    }
    this._log(text);
  };

  /** シムのイベントを既存の演出とログへ流す。演出の失敗はシムを止めない。 */
  RtwpInstance.prototype.dispatch = function (events) {
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      try {
        switch (ev.type) {
          case 'SHOT': {
            const sh = this.sim.getSoldier(String(ev.shooterId));
            const tg = ev.targetId ? this.sim.getSoldier(String(ev.targetId)) : null;
            const R = window.Renderer;
            if (R && typeof R.hexToPx === 'function' && sh && window.VFX) {
              const a = R.hexToPx(sh.q, sh.r);
              // 面制圧(TARGET_HEX)は撃つ相手が個体ではないので、着弾点は hex から取る。
              // これが無いと銃口炎も着弾も出ず、命令したのに何も起きていないように見える。
              const aimAt = tg || ev.targetHex;
              const b = aimAt ? R.hexToPx(aimAt.q, aimAt.r) : null;
              if (b && R.playMuzzleFlash) {
                const muzzle = R.getMuzzlePoint ? R.getMuzzlePoint(sh, tg) : null;
                const mx = muzzle ? muzzle.x : a.x;
                const my = muzzle ? muzzle.y : a.y - 14;
                const angle = muzzle ? muzzle.angle : Math.atan2((b.y - 16) - my, b.x - mx);
                if (R.playMuzzleBurst) {
                  R.playMuzzleBurst(mx, my, angle, sh.weapon, ev.roundsFired || 1);
                } else {
                  R.playMuzzleFlash(mx, my, angle, sh.weapon);
                }
              }
              // 面制圧でも射手は撃つ動作を見せる。目標は個体でないので、着弾点だけを
              // 持つ擬似ターゲットを渡す（triggerAttack は id が無くても向きを出せる）。
              const animTarget = tg || (ev.targetHex
                ? { id: null, q: ev.targetHex.q, r: ev.targetHex.r } : null);
              if (R.playAttackAnim && animTarget) R.playAttackAnim(sh, animTarget);
              // 1 burst = 1煙ではなく、発射された実弾ごとに小さな着弾を出す。
              // 命中弾以外も標的周辺の地面へ落ちるので、missでも表示する。
              if (b && window.VFX.addBulletImpact) {
                window.VFX.addBulletImpact(b.x, b.y - 16, ev.roundsFired || 1, sh.weapon, ev.hit);
              }
            }
            // 武器コードで鳴らす（'shot' 固定だと実録音のラウンドロビンが使われない）
            if (window.Sfx && sh && sh.weapon) {
              if (window.Sfx.playWeapon) window.Sfx.playWeapon(sh.weapon, sh.fireMode);
              else window.Sfx.play(sh.weapon.code, 'shot');
            }
            break;
          }
          case 'GRENADE': {
            // 手を離れた瞬間。飛翔体を出し、投擲モーションを再生する。
            const R = window.Renderer;
            const thrower = this.sim.getSoldier(String(ev.id));
            if (R && R.hexToPx && ev.target) {
              const a = R.hexToPx(ev.from.q, ev.from.r);
              const b = R.hexToPx(ev.target.q, ev.target.r);
              if (window.VFX && window.VFX.addRocket) window.VFX.addRocket(a.x, a.y - 10, b.x, b.y - 10);
              const main = window.phaserGame && window.phaserGame.scene
                && window.phaserGame.scene.getScene('MainScene');
              if (main && main.unitView && main.unitView.playThrow && thrower) {
                main.unitView.playThrow(thrower, a, b);
              }
            }
            if (window.Sfx) window.Sfx.play('throw');
            break;
          }
          case 'BLAST': {
            const R = window.Renderer;
            if (R && R.hexToPx && ev.hex && window.VFX) {
              const p = R.hexToPx(ev.hex.q, ev.hex.r);
              if (window.VFX.addExplosion) window.VFX.addExplosion(p.x, p.y - 8, '#ffb347', 16);
              if (window.VFX.addSmoke) window.VFX.addSmoke(p.x, p.y - 8);
            }
            if (window.Sfx) window.Sfx.play('explosion');
            break;
          }
          case 'MELEE_START': {
            // 白兵は突撃モーションで見せる（専用アセットが無いので突進を流用）
            const R = window.Renderer;
            const a = this.sim.getSoldier(String(ev.id));
            const b = this.sim.getSoldier(String(ev.targetId));
            if (R && R.playAttackAnim && a && b) R.playAttackAnim(a, b);
            if (window.Sfx) window.Sfx.play('melee');
            break;
          }
          case 'DOWN':
            if (window.Sfx) window.Sfx.play('death');
            break;
          default: break;
        }
        this.pushEventLog(this.formatEvent(ev));
      } catch (e) { /* 演出の失敗でシムを止めない */ }
    }
  };

  /** 描画ループから毎フレーム呼ぶ。 */
  RtwpInstance.prototype.update = function (delta) {
    const T = resolveDeps().SIM_TUNING;
    // カード配置や後着増援は戦闘開始後に gameLogic.units へ増える。
    // ポーズ中でも即座にRTwPへ登録し、見た目だけの兵士にしない。
    this.registerMissingUnits();
    // 行き先マーカーはポーズ中こそ要る（盤面を読んで命令を組み立てる時間だから）。
    // シムを進める判定より前に更新しないと、PAUSE 中は一切表示されない。
    this.updateMovePreview();
    if (this.sim && this.sim.result()) { this.finishBattle(); return; }
    if (this.paused || !this.sim) return;
    // 非アクティブ中の巨大deltaを復帰後に消化すると、古いSHOTイベントが連続再生される。
    if (isPageInactive()) {
      this.acc = 0;
      this._skipNextDelta = true;
      return;
    }
    if (this._skipNextDelta) {
      this.acc = 0;
      this._skipNextDelta = false;
      return;
    }
    this.acc += delta * this.speed;
    let n = 0;
    // 1フレームで進めるのは最大5tick。フレーム落ち後に取り戻そうとして
    // 大量のtickを一度に回すと、さらに重くなって雪だるま式に破綻する。
    while (this.acc >= T.TICK_MS && n < 5) {
      this.sim.tick();
      this.runLeaderAI();
      this.dispatch(this.sim.drainEvents());
      this.acc -= T.TICK_MS;
      n++;
    }
    this.syncUnits();
    this.updateMovePreview();
  };

  /**
   * 行き先を **hex のマーカー**で示す（`gameLogic.reachableHexes` = 既存の hex 枠描画）。
   *
   * 線は使わない（2026-08-02 ディレクター指示「六角ヘックスで移動先指定して。
   * 移動線やだ」）。示すのは経路ではなく**行き先1マス**だけ。
   *
   * 状態は2つしかない:
   *   1. 行き先を選んでいる最中 → カーソルのマス
   *   2. 命令を出した後 → その兵が向かっている目的地のマス（命令の受領確認）
   * それ以外では必ず消す。以前はホバーする限り出し続けたため、命令を出した後も
   * 残って何も確定していないように見えた。
   */
  RtwpInstance.prototype.updateMovePreview = function () {
    const g = this.gameLogic;
    if (!g || !this.sim) return;
    const clear = () => {
      if (this._previewOwned) {
        g.reachableHexes = [];
        g.path = [];
        this._previewOwned = false;
      }
    };
    const mark = (hex) => {
      g.reachableHexes = [{ q: hex.q, r: hex.r }];
      g.path = [];   // 線は出さない
      this._previewOwned = true;
    };
    const sel = g.selectedUnit;
    if (!sel || sel.team !== 'player') return clear();
    const s = this.sim.getSoldier(String(sel.id));
    if (!s) return clear();

    // 1. 行き先を選んでいる最中: カーソルのマスを指す
    const SA = resolveDeps().SimActions;
    const pending = this.pendingAction;
    const pendingDef = pending && SA && SA.get(pending.id);
    if (pendingDef && pendingDef.needs === 'hex' && pending.unitId === String(sel.id)) {
      const hover = g.hoverHex;
      if (!hover || (hover.q === s.q && hover.r === s.r)) return clear();
      return mark(hover);
    }

    // 2. 移動中なら目的地のマス
    if (s.movePath && s.movePath.length) {
      delete sel._rtwpOrderedPath;
      return mark(s.movePath[s.movePath.length - 1]);
    }
    // 2b. 発令したが伝達中（§3.4 の遅延で数秒かかる）。届くまでマーカーが消えると
    //     「命令が通っていない」ように見えるので、頼んだ行き先を出したままにする。
    const ordered = sel._rtwpOrderedPath;
    if (ordered && ordered.length) return mark(ordered[ordered.length - 1]);
    clear();
  };

  /**
   * 戦闘の決着をキャンペーン進行へ渡す。
   *
   * **RTwP には決着処理が最初から無かった。** 旧ターン制の勝敗判定
   * （checkWin/checkLose）は `gameLogic.applyDamage` と `endTurn` からしか
   * 呼ばれず、RTwP はそのどちらも通らない — ダメージは sim_core の中で解決し、
   * endTurn は一時停止トグルへ差し替えてあるため。結果、敵を全滅させても
   * セクターが進まないまま盤面が止まる（2026-08-02 実プレイで判明）。
   *
   * 報酬画面・増援・セクター加算は旧経路が正本なので、こちらでは判定結果を
   * その入口へ運ぶだけにする。
   */
  RtwpInstance.prototype.finishBattle = function () {
    if (this._finished) return;
    const g = this.gameLogic;
    const res = this.sim && this.sim.result();
    if (!g || !res) return;
    this._finished = true;

    this.syncUnits();          // 最終状態（戦死者の hp=0）を本編ユニットへ反映
    this.pendingAction = null;
    this.setPaused(true);
    this._log(res.winner === 'A'
      ? '-- SECTOR CLEAR (' + res.reason + ') --'
      : '-- 作戦失敗 (' + res.reason + ') --');

    const alivePlayers = (g.units || []).filter((u) => u.team === 'player' && u.hp > 0);

    if (res.winner === 'A') {
      // 全滅させた場合は旧来の判定がそのまま通る（報酬画面 → promoteSurvivors →
      // 次セクターの経路を共有する。経験値・昇進はこの先の既存処理が担当）
      if (!(typeof g.checkWin === 'function' && g.checkWin())) {
        // 敗走勝ち: 敵が盤上に生き残っているので上の判定は通らない。同じ結末へ手で運ぶ
        g.state = 'WIN';
        g._victoryProcessed = true;
        if (g.campaign && typeof g.campaign.onSectorCleared === 'function') {
          g.campaign.onSectorCleared(alivePlayers);
        }
      }
    } else {
      if (typeof g.checkLose === 'function') g.checkLose();
      // 全滅ではなく敗走・戦闘不能で負けた場合は checkLose が発火しないので、
      // ここで送る。**負け方を取り違えて伝えないよう理由と生存数を渡す** —
      // 文言が「全滅しました」固定で、負傷兵が生きているのに全滅と出ていた。
      if (alivePlayers.length > 0 && g.campaign && typeof g.campaign.onGameOver === 'function') {
        g.campaign.onGameOver(res.reason, alivePlayers.length);
      }
    }

    // **必ず自分を切り離す。** 次のセクターは新しい BattleLogic として作られるが、
    // phaser_bridge の接続は「instance が無い時だけ」なので、決着済みのインスタンス
    // が残っていると再接続されない。その結果、次セクターは決着済みsimを抱えたまま
    // update() が即returnし、盤面が一切動かない（2026-08-02 SECTOR2 で発生）。
    if (typeof window !== 'undefined' && window.RtwpBattle
      && window.RtwpBattle.instance === this) {
      window.RtwpBattle.detach();
    }
  };

  /** プレイヤーが命令を出したら、分隊長AIが即座に上書きしないよう黙らせる */
  RtwpInstance.prototype._lockLeader = function () {
    const T = resolveDeps().SIM_TUNING;
    this.leaderState.A.playerLockUntil = this.sim._tick + (T.PLAYER_ORDER_LOCK_T || 150);
  };

  // -------------------------------------------------------------------------
  // 行動カタログ（sim_actions.js）の呼び出し口
  //
  // 前提条件の判定はカタログ側にしか無い。ここで「射程内か」「弾があるか」を
  // 再実装すると、AIとプレイヤーで使える技が食い違う（カタログを作った理由）。
  // -------------------------------------------------------------------------

  /**
   * 行動カタログへ渡す文脈。sim のスナップショットだけを積む（§7.3-2 破壊的プローブ禁止）。
   * @param {Object} unit 本編ユニット（実行者） / @param {Object} target 敵ユニット / @param {{q,r}} hex 目標地点
   */
  RtwpInstance.prototype.actionContext = function (unit, target, hex) {
    if (!this.sim) return null;
    const self = unit ? this.sim.getSoldier(String(unit.id)) : null;
    if (!self) return null;
    const soldiers = this.sim.soldiers();
    const ctx = {
      self: self,
      target: target ? this.sim.getSoldier(String(target.id)) : null,
      hex: hex || null,
      squad: soldiers.filter((s) => s.team === self.team && s.hp > 0),
      world: { soldiers: soldiers, map: this.map, tuning: resolveDeps().SIM_TUNING },
    };
    // 経路は1hexずつ刻む。1要素へ遠い hex を入れると sim_core の移動がワープする。
    if (hex) ctx.path = straightPath(this.map, { q: self.q, r: self.r }, hex);
    return ctx;
  };

  /** カタログの行動を実行する。@returns {boolean} 命令を発行できたか */
  RtwpInstance.prototype.runAction = function (actionId, unit, target, hex) {
    const SA = resolveDeps().SimActions;
    if (!SA || !this.sim) return false;
    const ctx = this.actionContext(unit, target, hex);
    if (!ctx || ctx.self.team !== 'A') return false;
    const orders = SA.issue(actionId, ctx);
    if (!orders.length) return false;
    orders.forEach((o) => this.sim.issueOrder(o));
    // 伝達遅延中も「どんな命令を受けたか」は見た目へ即時反映する。
    // 実際の発砲・移動は ORDER_DELIVERED 後なので、弾薬・命中処理は先走らない。
    if (ctx.target && unit) unit._rtwpPendingTargetId = ctx.target.id;
    // 命令が通ったことを盤面で見せる。クリックしただけでは「効いた感じ」が出ない
    // （2026-08-02 ディレクター指摘）ので、対象へターゲットカーソルを点滅させる。
    if (ctx.target && typeof window !== 'undefined' && window.TacticalPauseOverlay
      && window.TacticalPauseOverlay.flash) {
      window.TacticalPauseOverlay.flash(ctx.target.id);
    }
    if (unit) {
      const mine = orders.find((o) => o.type === 'MOVE_TO'
        && o.soldierIds.indexOf(String(unit.id)) >= 0);
      if (mine && mine.payload.path) unit._rtwpOrderedPath = mine.payload.path.slice();
      else delete unit._rtwpOrderedPath;
    }
    this._lockLeader();
    const def = SA.get(actionId);
    this._log('命令: ' + (def ? def.label : actionId)
      + (def && def.scope === 'self' && unit ? '（' + unit.name + '）' : '')
      + (target ? ' → ' + target.name : ''));
    return true;
  };

  RtwpInstance.prototype.orderMove = function (unit, q, r, mode) {
    const id = (mode === 'rush') ? 'RUSH' : (mode === 'crawl') ? 'CRAWL' : 'MOVE';
    if (resolveDeps().SimActions) return this.runAction(id, unit, null, { q: q, r: r });
    // カタログが読み込まれていない環境（古いHTML）でも移動だけは通す
    if (!unit || !this.sim) return false;
    const s = this.sim.getSoldier(String(unit.id));
    if (!s || s.hp <= 0 || s.team !== 'A') return false;
    const path = straightPath(this.map, { q: s.q, r: s.r }, { q: q, r: r });
    if (!path.length) return false;
    this.sim.issueOrder({ type: 'MOVE_TO', soldierIds: [String(unit.id)], payload: { path: path } });
    this._lockLeader();
    return true;
  };

  /**
   * 行動を「対象待ち」にする。needs が無い行動はその場で実行する。
   * @returns {boolean} 実行した（=対象待ちにならなかった）か
   */
  RtwpInstance.prototype.armAction = function (actionId, unit) {
    const SA = resolveDeps().SimActions;
    const def = SA && SA.get(actionId);
    if (!def) return false;
    if (!def.needs) {
      this.pendingAction = null;
      return this.runAction(actionId, unit, null, null);
    }
    this.pendingAction = { id: actionId, unitId: unit ? String(unit.id) : null };
    this._log(def.label + ': ' + (def.needs === 'enemy' ? '対象の敵をクリック' : '地点をクリック'));
    return false;
  };

  /**
   * 複数兵へ同じ行動を構える（矩形選択→同一メニュー）。
   *
   * メニューは単一選択と**まったく同じ**ものを出す（2026-08-03 ディレクター指示）。
   * 語彙を増やさず、主語だけが増える形にしてある。対象が要らない行動はその場で
   * 全員へ適用し、要る行動は1回のクリックで全員へ配る。
   * @returns {boolean} 実行した（=対象待ちにならなかった）か
   */
  RtwpInstance.prototype.armActionForUnits = function (actionId, units) {
    const SA = resolveDeps().SimActions;
    const def = SA && SA.get(actionId);
    const list = (units || []).filter(Boolean);
    if (!def || !list.length) return false;
    if (list.length === 1) return this.armAction(actionId, list[0]);
    if (!def.needs) {
      this.pendingAction = null;
      let any = false;
      for (const u of list) { if (this.runAction(actionId, u, null, null)) any = true; }
      return any;
    }
    this.pendingAction = {
      id: actionId,
      unitId: String(list[0].id),
      unitIds: list.map((u) => String(u.id)),
    };
    this._log(def.label + '（' + list.length + '名）: '
      + (def.needs === 'enemy' ? '対象の敵をクリック' : '地点をクリック'));
    return false;
  };

  /** その hex に居る生きた敵ユニット（右クリックの目的語判定用）。 */
  RtwpInstance.prototype._enemyAt = function (hex) {
    if (!hex || !this.sim) return null;
    const foe = this.sim.soldiers().find((s) => s.team === 'B' && s.hp > 0
      && s.q === hex.q && s.r === hex.r);
    return foe ? this.unitById.get(String(foe.id)) || null : null;
  };

  /** 分隊命令のホットキー用に、生きている自軍兵を1人拾う（誰でも文脈は同じ）。 */
  RtwpInstance.prototype._anyPlayerUnit = function () {
    if (!this.sim) return null;
    const alive = this.sim.soldiers().find((s) => s.team === 'A' && s.hp > 0);
    return alive ? this.unitById.get(String(alive.id)) || null : null;
  };

  /** 対象待ちの行動の実行者。選び直しで選択が動いていても、命じた本人へ届ける。 */
  RtwpInstance.prototype._pendingActor = function (fallbackUnit) {
    const pending = this.pendingAction;
    if (pending && pending.unitId && this.unitById.has(pending.unitId)) {
      return this.unitById.get(pending.unitId);
    }
    return fallbackUnit;
  };

  /** 対象待ちの行動を、クリックされた敵/地点で消費する。@returns {boolean} 消費したか */
  RtwpInstance.prototype.consumePendingAction = function (unit, target, hex) {
    const pending = this.pendingAction;
    if (!pending) return false;
    const SA = resolveDeps().SimActions;
    const def = SA && SA.get(pending.id);
    if (!def) { this.pendingAction = null; return false; }
    if (def.needs === 'enemy' && !target) return false;
    if (def.needs === 'hex' && !hex) return false;
    this.pendingAction = null;
    // 複数選択で構えていたなら、1回のクリックを全員へ配る。
    // 個々に available() が通らない兵は runAction 側で弾かれるので、ここでは選別しない。
    if (pending.unitIds && pending.unitIds.length > 1) {
      let any = false;
      for (const id of pending.unitIds) {
        const u = this.unitById.get(id);
        if (u && u.hp > 0 && this.runAction(pending.id, u, target, hex)) any = true;
      }
      return any;
    }
    return this.runAction(pending.id, unit, target, hex);
  };

  RtwpInstance.prototype.orderFocusFire = function (targetUnit) {
    if (!targetUnit || !this.sim) return false;
    const tg = this.sim.getSoldier(String(targetUnit.id));
    if (!tg || tg.hp <= 0 || tg.team !== 'B') return false;
    const ids = this.sim.soldiers().filter((s) => s.team === 'A' && s.hp > 0).map((s) => s.id);
    if (!ids.length) return false;
    this.sim.issueOrder({ type: 'TARGET', soldierIds: ids, payload: { targetId: tg.id, mode: 'aimed' } });
    this._lockLeader();
    return true;
  };

  /** 手動の射撃Actionを、旧ターン制の即時攻撃ではなくRTwPの命令へ変換する。 */
  RtwpInstance.prototype.orderAttack = function (shooterUnit, targetUnit, mode) {
    if (!shooterUnit || !targetUnit || !this.sim) return false;
    const sh = this.sim.getSoldier(String(shooterUnit.id));
    const tg = this.sim.getSoldier(String(targetUnit.id));
    if (!sh || !tg || sh.hp <= 0 || tg.hp <= 0 || sh.team !== 'A' || tg.team !== 'B') return false;
    this.sim.issueOrder({
      type: 'TARGET',
      soldierIds: [sh.id],
      payload: { targetId: tg.id, mode: mode === 'suppress' ? 'suppress' : 'aimed' },
    });
    // 伝達遅延中も「誰を狙う命令を受けたか」は見た目へ即時反映する。
    // 実際の発砲はORDER_DELIVERED後なので、弾薬・命中処理は先走らない。
    shooterUnit._rtwpPendingTargetId = tg.id;
    this._lockLeader();
    return true;
  };

  /** 空hexへの手動射撃は、その地点に最も近い射程内の敵への制圧命令として扱う。 */
  RtwpInstance.prototype.targetNearHex = function (shooterUnit, hex) {
    if (!shooterUnit || !hex || !this.sim) return null;
    const sh = this.sim.getSoldier(String(shooterUnit.id));
    if (!sh || !sh.weapon) return null;
    let best = null, bestScore = Infinity;
    this.sim.soldiers().forEach((tg) => {
      if (tg.team !== 'B' || tg.hp <= 0) return;
      const fromShooter = this.map.dist({ q: sh.q, r: sh.r }, { q: tg.q, r: tg.r });
      if (fromShooter > sh.weapon.rngMax) return;
      if (this.map.hasLos && !this.map.hasLos({ q: sh.q, r: sh.r }, { q: tg.q, r: tg.r })) return;
      const score = this.map.dist({ q: hex.q, r: hex.r }, { q: tg.q, r: tg.r });
      if (score < bestScore) { bestScore = score; best = tg; }
    });
    return best && this.unitById.get(String(best.id));
  };

  RtwpInstance.prototype.orderSuppress = function () {
    if (!this.sim) return false;
    const all = this.sim.soldiers();
    const foes = all.filter((s) => s.team === 'B' && s.hp > 0);
    let issued = 0;
    all.forEach((s) => {
      if (s.team !== 'A' || s.hp <= 0 || !s.weapon) return;
      const rng = s.weapon.rngMax;   // sim の武器は rngMax（range ではない）
      let best = null, bestD = Infinity;
      foes.forEach((e) => {
        const d = this.map.dist({ q: s.q, r: s.r }, { q: e.q, r: e.r });
        if (d <= rng && d < bestD) { bestD = d; best = e; }
      });
      if (best) {
        this.sim.issueOrder({ type: 'TARGET', soldierIds: [s.id], payload: { targetId: best.id, mode: 'suppress' } });
        issued++;
      }
    });
    if (issued) this._lockLeader();
    return issued > 0;
  };

  /**
   * 味方兵を左クリックした時の命令メニュー。旧ターン制と同じ位置・同じ操作。
   *
   * **その兵にできることだけを、一語ずつ並べる。** 分隊全体への命令（集中射撃・
   * 制圧射撃・遮蔽）はここに出さない — 1人を選んで開いたメニューに分隊命令が
   * 混ざるのは筋が通らない（2026-08-02 ディレクター指摘）。分隊命令はホットキー。
   *
   * 所要秒数・射線数のような数字も、tooltip も出さない。命令の意味は名前だけで
   * 伝わるべきで、伝わらないなら名前を直す（2026-08-02「ALT文消せ ださい」）。
   */
  /**
   * 矩形選択された兵へ、単一選択と**同じメニュー**を出す。
   * 語彙も見た目も変えない — 変わるのは適用先が複数になることだけ。
   */
  RtwpInstance.prototype.showSquadSelectionMenu = function (units, px, py) {
    const list = (units || []).filter((u) => u && u.hp > 0 && u.team === 'player');
    if (!list.length) return false;
    return this.showSoldierMenu(this._firstActionable(list), px, py, list);
  };

  /**
   * メニューの可否判定を代表する兵を選ぶ。
   *
   * 可否は代表1名の文脈で決まるので、矩形の先頭がたまたま行動不能（hp は
   * 残っているが state='incap'/'rout'）だと**分隊ごとメニューが灰色**になる。
   * 動ける兵を代表に立てれば、残りの全員へ命令は届く（2026-08-04）。
   */
  RtwpInstance.prototype._firstActionable = function (list) {
    const SA = resolveDeps().SimActions;
    if (!SA || !list.length) return list[0];
    for (const u of list) {
      const ctx = this.actionContext(u, null, null);
      if (!ctx) continue;
      if (SA.list(ctx).some((e) => e.ok && e.action.scope === 'self')) return u;
    }
    return list[0];
  };

  RtwpInstance.prototype.showSoldierMenu = function (unit, px, py, units) {
    const SA = resolveDeps().SimActions;
    const menu = (typeof document !== 'undefined') ? document.getElementById('command-menu') : null;
    if (!SA || !menu || !unit) return false;
    const ctx = this.actionContext(unit, null, null);
    if (!ctx || ctx.self.team !== 'A') return false;

    const entries = SA.list(ctx).filter((e) => e.action.scope === 'self');
    if (!entries.length) return false;
    // 複数選択なら適用先を覚えておく。メニューの中身は単一選択と同一。
    // gameLogic 側にも置くのは描画のため — 選ばれた兵はここを見て発光する。
    // 単一選択で開いた時は null が入り、それで前の集合が解ける。
    const targets = (units && units.length > 1) ? units.slice() : null;
    this.selectedUnits = targets;
    if (this.gameLogic) this.gameLogic.selectedUnits = targets;
    this.pendingAction = null;
    if (this._menuHtml == null) this._menuHtml = menu.innerHTML;

    const self = this;
    const g = this.gameLogic;
    menu.innerHTML = '';

    // 何人へ命じるのかを見出しに出す。ボタンではないので押せない — 命令の語彙は
    // 単一選択と同じままで、主語だけが明示される。
    //
    // 全部の行動が塞がっている時は**その理由**も出す。hp が残っているのに
    // 何も押せないと理由が分からない（2026-08-04 ディレクター指摘）。理由は
    // sim_actions.js が返す文言をそのまま使う（行動不能／敗走中／弾切れ…）。
    const dead = entries.every(function (e) { return !e.ok; });
    const why = dead ? (entries.find(function (e) { return e.reason; }) || {}).reason : '';
    if (targets || why) {
      const head = document.createElement('div');
      head.className = 'cmd-head';
      head.style.cssText = 'padding:2px 4px 5px; margin-bottom:4px;'
        + ' border-bottom:1px solid rgba(255,255,255,0.15); text-align:center;'
        + ' color:' + (why ? '#c66' : 'var(--accent)') + ';'
        + " font-family:'Share Tech Mono', monospace;"
        + ' font-size:11px; letter-spacing:1px;';
      head.textContent = [targets ? targets.length + '人を選択' : '', why]
        .filter(Boolean).join(' — ');
      menu.appendChild(head);
    }

    entries.forEach(function (entry) {
      const def = entry.action;
      const btn = document.createElement('div');
      btn.className = 'cmd-btn' + (entry.ok ? '' : ' disabled');
      btn.textContent = def.label;
      if (entry.ok) {
        btn.onclick = function () {
          if (targets) self.armActionForUnits(def.id, targets);
          else self.armAction(def.id, unit);
          if (g && g.ui && g.ui.hideActionMenu) g.ui.hideActionMenu();
        };
      }
      menu.appendChild(btn);
    });

    const cancel = document.createElement('div');
    cancel.className = 'cmd-btn';
    cancel.style.cssText = 'text-align:center; color:#888;';
    cancel.textContent = 'CANCEL';
    cancel.onclick = function () {
      self.pendingAction = null;
      if (g && g.clearSelection) g.clearSelection();
      else if (g && g.ui && g.ui.hideActionMenu) g.ui.hideActionMenu();
    };
    menu.appendChild(cancel);

    // 先に表示してから置く — display:none のままでは寸法が測れず、画面端で
    // 押し戻すべき量が分からない
    menu.style.display = 'block';
    if (typeof window !== 'undefined' && window.RtwpBattle && window.RtwpBattle.placeMenu) {
      window.RtwpBattle.placeMenu(menu, px, py);
    } else {
      menu.style.left = (px + 20) + 'px';
      menu.style.top = (py - 50) + 'px';
    }
    return true;
  };

  RtwpInstance.prototype.orderTakeCover = function () {
    if (!this.sim) return false;
    const ids = this.sim.soldiers().filter((s) => s.team === 'A' && s.hp > 0).map((s) => s.id);
    if (!ids.length) return false;
    // 行き先は指定しない — どこへ隠れるかは現場の兵が決める（§3.4 三現主義）
    this.sim.issueOrder({ type: 'TAKE_COVER', soldierIds: ids, payload: {} });
    this._lockLeader();
    return true;
  };

  // -------------------------------------------------------------------------
  // UI 配線
  //
  // logic_game.js / logic_ui.js は書き換えず、**インスタンスのメソッドを包む**。
  // 元の実装はそのまま残り、detach() で元に戻る。クラスではなくインスタンスを
  // 差し替えるので、旧ターン制の挙動は一切壊れない。
  // -------------------------------------------------------------------------

  RtwpInstance.prototype.installUi = function () {
    const g = this.gameLogic;
    const self = this;
    if (!g || this._uiInstalled) return;
    this._orig = {
      handleClick: g.handleClick,
      handleMarqueeSelect: g.handleMarqueeSelect,
      handleRightClick: g.handleRightClick,
      actionAttack: g.actionAttack,
      onUnitClick: g.onUnitClick,
      endTurn: g.endTurn,
      uiLog: g.ui && g.ui.log,
      showActionMenu: g.ui && g.ui.showActionMenu,
    };

    // 戦闘中のログはフローティング窓を再表示せず、RTwPドックへ集約する。
    if (g.ui && typeof g.ui.log === 'function') {
      g.ui.log = function (msg) { self.pushEventLog(String(msg)); };
    }

    // 命令メニューは**味方の左クリック**で開く（旧ターン制と同じ操作）。中身だけ
    // RTwP の語彙へ差し替える — 修理・白兵・治療は AP 制ターン戦のもので対応行動が無い。
    if (g.ui && typeof g.ui.showActionMenu === 'function' && resolveDeps().SimActions) {
      g.ui.showActionMenu = function (u, px, py) { self.showSoldierMenu(u, px, py); };
    }

    // 矩形選択（左ドラッグ）。単一選択と同じメニューを、選んだ全員へ向けて開く。
    // 1人しか掴めなかった時は従来の単体選択とまったく同じ経路へ落とす。
    g.handleMarqueeSelect = function (units, px, py) {
      const list = (units || []).filter((u) => u && u.hp > 0 && u.team === 'player');
      if (!list.length) { if (g.clearSelection) g.clearSelection(); return; }
      // 主兵はメニューの可否を代表する兵と揃える（サイドバーもこの兵を出す）
      g.selectedUnit = self._firstActionable(list);
      self.selectedUnits = list.length > 1 ? list.slice() : null;
      g.selectedUnits = self.selectedUnits;   // 選択表示用（phaser_unit.js の輪が読む）
      if (g.updateSidebar) g.updateSidebar();
      self.showSquadSelectionMenu(list, px, py);
    };

    // 左クリック = 選んだ行動の対象を指す。行き先を左で確定できないと、メニューで
    // 「移動」を選んだ後に何をすればよいか分からない（2026-08-02 ディレクター指摘）。
    g.handleClick = function (hex, px, py) {
      if (hex && self.pendingAction) {
        const actor = self._pendingActor(g.selectedUnit);
        if (self.consumePendingAction(actor, self._enemyAt(hex), hex)) return;
      }
      if (self._orig.handleClick) return self._orig.handleClick.call(g, hex, px, py);
    };

    // 右クリック = **取り消しだけ。** 移動の意味は持たせない（2026-08-02 ディレクター
    // 指示）。命令はメニューかホットキーから出す、という一本道にする。
    g.handleRightClick = function () {
      if (self.pendingAction) { self.pendingAction = null; self._log('取り消し'); }
      if (g.ui && g.ui.hideActionMenu) g.ui.hideActionMenu();
      if (g.clearSelection) g.clearSelection();
    };

    // コンテキストメニューの「射撃」もRTwPへ流す。旧 actionAttack を呼ぶとAP制・
    // 即時命中判定・旧音源が混ざるため、RT中は必ずTARGET命令に変換する。
    g.actionAttack = function (shooter, destination) {
      const direct = destination && destination.hp !== undefined ? destination : null;
      const target = direct || self.targetNearHex(shooter, destination);
      const mode = direct ? 'aimed' : 'suppress';
      if (target && self.orderAttack(shooter, target, mode)) {
        self._log('命令: ' + shooter.name + ' → ' + target.name
          + (mode === 'suppress' ? ' 制圧射撃' : ' 射撃'));
        if (g.setMode) g.setMode('SELECT');
        if (g.ui && g.ui.hideActionMenu) g.ui.hideActionMenu();
        return Promise.resolve(true);
      }
      self._log('射撃可能な対象がいない');
      if (g.setMode) g.setMode('SELECT');
      return Promise.resolve(false);
    };

    // Tactical pause: keep the selected friendly soldier and turn an enemy
    // click into an aimed TARGET order instead of replacing the selection.
    g.onUnitClick = function (unit) {
      const shooter = g.selectedUnit;
      // メニューで選んだ「射撃」「集中射撃」の対象として先に消費する
      if (unit && unit.team === 'enemy'
        && self.consumePendingAction(self._pendingActor(shooter), unit, null)) return;
      if (self.paused && shooter && shooter.team === 'player'
          && unit && unit.team === 'enemy') {
        if (self.orderAttack(shooter, unit, 'aimed')) {
          self._log('命令: ' + shooter.name + ' → ' + unit.name + ' を射撃');
          return;
        }
      }
      if (self._orig.onUnitClick) return self._orig.onUnitClick.call(g, unit);
    };

    // END TURN は RTwP に存在しない。Phaserサイドバーのボタンは伏せてあるが、
    // 他経路から呼ばれても壊れないよう一時停止のトグルにしておく。
    g.endTurn = function () {
      self.setPaused(!self.paused);
      self._log(self.paused ? '一時停止' : '再開');
    };

    this._keyHandler = function (e) {
      const el = document.activeElement;
      const tag = el && (el.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      const sel = g.selectedUnit;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          self.setPaused(!self.paused); self._log(self.paused ? '一時停止' : '再開');
          break;
        case '1': self.setSpeed(1); break;
        case '2': self.setSpeed(2); break;
        case '3': self.setSpeed(4); break;
        case 'Escape':
          if (self.pendingAction) { self.pendingAction = null; self._log('命令を取り消し'); }
          break;
        default: {
          // ホットキーもメニューと同じカタログを引く。片方にしか無い技を作らない。
          const SA = resolveDeps().SimActions;
          const def = SA && SA.byHotkey(e.key);
          if (!def) return;
          const friendly = (sel && sel.team === 'player') ? sel : self._anyPlayerUnit();
          if (!friendly) return;
          // 単体行動は「誰に」が決まっていないと出せない
          if (def.scope === 'self' && (!sel || sel.team !== 'player')) return;
          if (def.needs === 'enemy' && sel && sel.team === 'enemy') {
            self.runAction(def.id, friendly, sel, null);
          } else {
            self.armAction(def.id, friendly);
          }
          break;
        }
      }
    };
    document.addEventListener('keydown', this._keyHandler);
    this._visibilityHandler = function (e) { self.onWindowActivity(e && e.type); };
    document.addEventListener('visibilitychange', this._visibilityHandler);
    if (window.addEventListener) {
      window.addEventListener('blur', this._visibilityHandler);
      window.addEventListener('focus', this._visibilityHandler);
      window.addEventListener('pagehide', this._visibilityHandler);
    }

    // 左下の常設HUDは置かない。操作の手引きは手が止まる一時停止中にだけ要るもので、
    // それは戦術判断モード(phaser_tactical_pause.js)の上部バナーが同じ文言で出す。
    // 実時間中にここへ何か置くと下部カード列を覆う。
    const dock = document.getElementById('rtwp-dock');
    const eventsPane = document.getElementById('rtwp-events-pane');
    const debugPane = document.getElementById('rtwp-debug-pane');
    const logBody = document.getElementById('battle-log-body');
    const logWindow = document.getElementById('battle-log-window');
    const debugWindow = document.getElementById('debug-window');
    const remember = function (el) {
      return el ? { el: el, parent: el.parentNode, next: el.nextSibling, style: el.getAttribute('style') } : null;
    };
    this._dockState = {
      dock: dock,
      logBody: remember(logBody),
      debugWindow: remember(debugWindow),
      logWindow: logWindow,
      logWindowDisplay: logWindow ? logWindow.style.display : '',
    };
    if (dock && eventsPane && debugPane && logBody && debugWindow) {
      eventsPane.appendChild(logBody);
      debugPane.appendChild(debugWindow);
      debugWindow.style.display = 'flex';
      if (logWindow) logWindow.style.display = 'none';
      dock.classList.add('active');
      // 既定は畳んだ状態。最下部のタブ列だけが出て、押したときに開く。
      dock.classList.add('collapsed');

      const paneButtons = dock.querySelectorAll('[data-rtwp-pane]');
      const panes = dock.querySelectorAll('.rtwp-pane');
      paneButtons.forEach(function (button) {
        button.onclick = function () {
          const name = button.getAttribute('data-rtwp-pane');
          paneButtons.forEach(function (b) { b.classList.toggle('active', b === button); });
          panes.forEach(function (pane) { pane.classList.toggle('active', pane.id === 'rtwp-' + name + '-pane'); });
          dock.classList.remove('collapsed');
        };
      });
      const collapse = dock.querySelector('.rtwp-collapse');
      if (collapse) collapse.onclick = function () { dock.classList.toggle('collapsed'); };
    }
    this._uiInstalled = true;
  };

  RtwpInstance.prototype.uninstallUi = function () {
    const g = this.gameLogic;
    if (!this._uiInstalled) return;
    if (g && this._orig) {
      if (this._orig.handleClick) g.handleClick = this._orig.handleClick;
      else delete g.handleClick;
      if (this._orig.handleMarqueeSelect) g.handleMarqueeSelect = this._orig.handleMarqueeSelect;
      else delete g.handleMarqueeSelect;
      if (this._orig.handleRightClick) g.handleRightClick = this._orig.handleRightClick;
      else delete g.handleRightClick;
      if (this._orig.actionAttack) g.actionAttack = this._orig.actionAttack;
      else delete g.actionAttack;
      if (this._orig.onUnitClick) g.onUnitClick = this._orig.onUnitClick;
      else delete g.onUnitClick;
      if (this._orig.endTurn) g.endTurn = this._orig.endTurn;
      else delete g.endTurn;
      if (g.ui && this._orig.uiLog) g.ui.log = this._orig.uiLog;
      if (g.ui && this._orig.showActionMenu) g.ui.showActionMenu = this._orig.showActionMenu;
    }
    // カタログ駆動で書き換えたメニューDOMを元へ戻す（旧ターン制は id 付きの
    // ボタンを直接掴むので、innerHTML を戻さないと切り戻しで壊れる）
    if (this._menuHtml != null && typeof document !== 'undefined') {
      const menu = document.getElementById('command-menu');
      if (menu) { menu.innerHTML = this._menuHtml; menu.style.display = 'none'; }
      this._menuHtml = null;
    }
    this.pendingAction = null;
    if (this._keyHandler) document.removeEventListener('keydown', this._keyHandler);
    if (this._visibilityHandler) document.removeEventListener('visibilitychange', this._visibilityHandler);
    if (this._visibilityHandler && window.removeEventListener) {
      window.removeEventListener('blur', this._visibilityHandler);
      window.removeEventListener('focus', this._visibilityHandler);
      window.removeEventListener('pagehide', this._visibilityHandler);
    }
    if (this._dockState) {
      const restore = function (state) {
        if (!state || !state.el || !state.parent) return;
        if (state.next && state.next.parentNode === state.parent) state.parent.insertBefore(state.el, state.next);
        else state.parent.appendChild(state.el);
        if (state.style == null) state.el.removeAttribute('style');
        else state.el.setAttribute('style', state.style);
      };
      restore(this._dockState.logBody);
      restore(this._dockState.debugWindow);
      if (this._dockState.logWindow) this._dockState.logWindow.style.display = this._dockState.logWindowDisplay;
      if (this._dockState.dock) {
        this._dockState.dock.classList.remove('active', 'collapsed');
      }
    }
    this._dockState = null;
    this._uiInstalled = false;
  };

  /**
   * ウィンドウの可視/フォーカス変化。離れたら PAUSE へ入れる。
   * **戻ってきても自動再開はしない**（復帰直後は盤面を読み直す前なので、Spaceを待つ）。
   * リスナから切り離してあるのは、DOMなしのテストから直接叩けるようにするため。
   */
  RtwpInstance.prototype.onWindowActivity = function (type) {
    this.acc = 0;
    this._skipNextDelta = true;
    if (type === 'focus') return;
    if (type === 'blur' || type === 'pagehide' || isPageInactive()) this.setPaused(true);
  };

  RtwpInstance.prototype.setPaused = function (v) { this.paused = !!v; };
  RtwpInstance.prototype.setSpeed = function (v) { if (typeof v === 'number' && v >= 0) this.speed = v; };

  RtwpInstance.prototype.detach = function () {
    this.uninstallUi();
    const units = (this.gameLogic && this.gameLogic.units) || [];
    units.forEach((u) => {
      delete u._rtwpSkipped; delete u._rtwpHpScale;
      delete u._rtwpTargetId; delete u._rtwpPendingTargetId;
      delete u._rtwpAmmo; delete u._sim; delete u._rtwpOrderedPath;
    });
    if (this.gameLogic && this._previewOwned) {
      this.gameLogic.path = [];
      this.gameLogic.reachableHexes = [];
    }
    this.sim = null;
    this.gameLogic = null;
    this.unitById.clear();
  };

  // -------------------------------------------------------------------------

  /**
   * 依存グローバルの解決。
   *
   * data.js の `WPNS` / `MAP_W` / `MAP_H` は **const 宣言**なので、素の識別子としては
   * 見えるが `window` のプロパティにはならない。`window[name]` だけで探すと本編では
   * 必ず undefined になり、RTwP が黙って起動しない（node の vm テストでは明示的に
   * 露出させていたため通ってしまい、実機で初めて露見した）。
   */
  /**
   * ページが「見えていない or ウィンドウが非アクティブ」か。
   * Sfx.isPageActive() は visibilitychange だけでなく window blur も見ているので、
   * 別ウィンドウへ切り替えただけ（タブは可視）の場合もここで拾える。
   */
  function isPageInactive() {
    if (typeof window !== 'undefined' && window.Sfx && window.Sfx.isPageActive) {
      return !window.Sfx.isPageActive();
    }
    return typeof document !== 'undefined'
      && (document.hidden || document.visibilityState === 'hidden');
  }

  function resolveDeps() {
    const d = {};
    d.SimCore = (typeof SimCore !== 'undefined') ? SimCore : window.SimCore;
    d.TraitPolicy = (typeof TraitPolicy !== 'undefined') ? TraitPolicy : window.TraitPolicy;
    d.CommsOrders = (typeof CommsOrders !== 'undefined') ? CommsOrders : window.CommsOrders;
    d.LeaderPolicy = (typeof LeaderPolicy !== 'undefined') ? LeaderPolicy : window.LeaderPolicy;
    // 行動カタログ。必須にはしない — 読み込まれていなければ移動・射撃だけの
    // 旧UIへ degrade する（REQUIRED に入れると古いHTMLでRTwPごと起動しなくなる）。
    d.SimActions = (typeof SimActions !== 'undefined') ? SimActions : window.SimActions;
    d.makePsBattleMapApi = (typeof makePsBattleMapApi !== 'undefined')
      ? makePsBattleMapApi : window.makePsBattleMapApi;
    d.mulberry32 = (typeof mulberry32 !== 'undefined') ? mulberry32 : window.mulberry32;
    d.toSimWeapon = (typeof toSimWeapon !== 'undefined') ? toSimWeapon : window.toSimWeapon;
    d.SIM_TUNING = (typeof SIM_TUNING !== 'undefined') ? SIM_TUNING : window.SIM_TUNING;
    d.WPNS = (typeof WPNS !== 'undefined') ? WPNS : window.WPNS;
    d.RIFLE_GRENADE_FOR_MAIN = (typeof RIFLE_GRENADE_FOR_MAIN !== 'undefined')
      ? RIFLE_GRENADE_FOR_MAIN : window.RIFLE_GRENADE_FOR_MAIN;
    d.MAP_W = (typeof MAP_W !== 'undefined') ? MAP_W : window.MAP_W;
    d.MAP_H = (typeof MAP_H !== 'undefined') ? MAP_H : window.MAP_H;
    return d;
  }
  const REQUIRED = ['SimCore', 'TraitPolicy', 'CommsOrders', 'makePsBattleMapApi',
    'SIM_TUNING', 'WPNS', 'MAP_W', 'MAP_H', 'mulberry32', 'toSimWeapon'];

  window.RtwpBattle = {
    /** false にすると本モジュールは何もしない = 旧ターン制のまま（切り戻し） */
    enabled: true,
    active: false,
    instance: null,
    fixedSeed: null,

    /**
     * メニューを画面内へ収めて置く。
     *
     * 画面下端・右端の近くで開くと枠外へはみ出て選べなくなる（2026-08-04
     * ディレクター指摘）。logic_ui.js には「簡易的な画面端チェック (もし必要なら)」
     * とコメントだけが残っていた箇所で、3つのメニューが同じ穴を持っていたので
     * ここに1本化する。
     *
     * **寸法は display:block にした後でないと測れない**ので、呼ぶ側は表示を
     * 先に済ませること。
     *
     * @param {HTMLElement} el 表示済みのメニュー
     * @param {number} px クリックした画面座標
     * @param {number} py
     * @param {{dx?:number, dy?:number, margin?:number}} [opts] 既定のずらし量と画面端の余白
     * @returns {{left:number, top:number}|null} 実際に置いた位置
     */
    placeMenu(el, px, py, opts) {
      if (!el) return null;
      const o = opts || {};
      const dx = (o.dx != null) ? o.dx : 20;
      const dy = (o.dy != null) ? o.dy : -50;
      const m = (o.margin != null) ? o.margin : 8;
      const vw = (typeof window !== 'undefined' && window.innerWidth) || 0;
      const vh = (typeof window !== 'undefined' && window.innerHeight) || 0;
      const w = el.offsetWidth || 0;
      const h = el.offsetHeight || 0;
      let left = px + dx;
      let top = py + dy;
      if (vw && w) {
        // 右に入らなければカーソルの反対側へ返す。それでも入らない狭さなら端に寄せる
        if (left + w > vw - m) left = px - dx - w;
        if (left < m) left = m;
        if (left + w > vw - m) left = Math.max(m, vw - m - w);
      }
      if (vh && h) {
        if (top + h > vh - m) top = vh - m - h;
        if (top < m) top = m;
      }
      el.style.left = Math.round(left) + 'px';
      el.style.top = Math.round(top) + 'px';
      return { left: left, top: top };
    },

    /**
     * この起動でRTwPが走る見込みか。`active` は初回 MainScene.update の attach まで
     * false なので、それより前に描くUI（配置カードの文言など）はこちらで判定する。
     * 実際に attach するかの判断は phaser_bridge.js の update 側が正本。
     */
    isEnabled() {
      if (!this.enabled) return false;
      if (typeof location === 'undefined' || !location.search) return true;
      return !/(?:\?|&)rtwp=0(?:&|$)/.test(location.search);
    },

    attach(gameLogic) {
      if (!this.enabled || !gameLogic || !gameLogic.map) return null;
      // 依存が1つでも欠けたら黙って諦める。旧ターン制コアは無傷なのでゲームは動く。
      const D = resolveDeps();
      for (let i = 0; i < REQUIRED.length; i++) {
        if (D[REQUIRED[i]] == null) return null;
      }
      if (this.instance) this.detach();

      const T = D.SIM_TUNING;
      const map = D.makePsBattleMapApi({ grid: gameLogic.map, W: D.MAP_W, H: D.MAP_H });
      const seed = (this.fixedSeed != null) ? this.fixedSeed : (Date.now() & 0xffff);
      const rng = D.mulberry32(seed);
      const sim = new D.SimCore({ map: map, tuning: T, rng: rng, policy: D.TraitPolicy });
      sim.orders = new D.CommsOrders({
        getSoldier: (id) => sim.getSoldier(id),
        soldiers: () => sim.soldiers(),
        map: map, tuning: T,
      });

      const inst = new RtwpInstance(gameLogic, sim, map, rng);

      // 初期配置も戦闘中の増援(registerUnit)と同じ経路で登録する。以前はここに
      // 同じ処理が複製されていて、片方だけ直すと初期配置兵にだけ効かない不具合に
      // なった（2026-08-02: 弾薬の書き戻し先 `_rtwpWeaponCode` で実際に踏んだ）。
      (gameLogic.units || []).forEach((unit) => { inst.registerUnit(unit); });

      this.instance = inst;
      this.active = true;
      // ヘッドレス(node)には document が無いので、その時はUI配線を飛ばす
      if (typeof document !== 'undefined' && document.body) {
        try { inst.installUi(); } catch (e) { console.error('RTwP installUi', e); }
      }
      if (gameLogic.ui && typeof gameLogic.ui.log === 'function') gameLogic.ui.log('-- REAL TIME --');
      return inst;
    },

    detach() {
      if (this.instance) this.instance.detach();
      this.instance = null;
      this.active = false;
    },
  };
}());

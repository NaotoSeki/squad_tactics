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
  }

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

      if (s.state === 'pinned' || s.state === 'suppressed') unit.stance = 'prone';
      else if (s.state === 'move') unit.stance = 'stand';
    }
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
      const leader = soldiers.find((s) => s.team === team && s.isLeader && s.hp > 0);
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

  /** シムのイベントを既存の演出とログへ流す。演出の失敗はシムを止めない。 */
  RtwpInstance.prototype.dispatch = function (events) {
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      try {
        switch (ev.type) {
          case 'SHOT': {
            const sh = this.sim.getSoldier(String(ev.shooterId));
            const tg = this.sim.getSoldier(String(ev.targetId));
            const R = window.Renderer;
            if (R && typeof R.hexToPx === 'function' && sh && window.VFX) {
              const a = R.hexToPx(sh.q, sh.r);
              if (window.VFX.addSmoke) window.VFX.addSmoke(a.x, a.y - 20);
              if (ev.hit && tg && window.VFX.addBulletImpact) {
                const b = R.hexToPx(tg.q, tg.r);
                window.VFX.addBulletImpact(b.x, b.y - 16, 2);
              }
            }
            // 武器コードで鳴らす（'shot' 固定だと実録音のラウンドロビンが使われない）
            if (window.Sfx && sh && sh.weapon) window.Sfx.play(sh.weapon.code, 'shot');
            break;
          }
          case 'DOWN':
            if (window.Sfx) window.Sfx.play('death');
            this._log(this._name(ev.id) + ' 戦死');
            break;
          case 'PINNED': this._log(this._name(ev.id) + ' 釘付け'); break;
          case 'POLICY': this._log(this._name(ev.id) + ': ' + ev.note); break;
          case 'ORDER_DELIVERED': this._log(this._name(ev.id) + ' ← 命令到達'); break;
          case 'AMMO_OUT': this._log(this._name(ev.id) + ' 弾切れ'); break;
          default: break;
        }
      } catch (e) { /* 演出の失敗でシムを止めない */ }
    }
  };

  /** 描画ループから毎フレーム呼ぶ。 */
  RtwpInstance.prototype.update = function (delta) {
    const T = resolveDeps().SIM_TUNING;
    if (this.paused || !this.sim || this.sim.result()) return;
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
  };

  /** プレイヤーが命令を出したら、分隊長AIが即座に上書きしないよう黙らせる */
  RtwpInstance.prototype._lockLeader = function () {
    const T = resolveDeps().SIM_TUNING;
    this.leaderState.A.playerLockUntil = this.sim._tick + (T.PLAYER_ORDER_LOCK_T || 150);
  };

  RtwpInstance.prototype.orderMove = function (unit, q, r) {
    if (!unit || !this.sim) return false;
    const s = this.sim.getSoldier(String(unit.id));
    if (!s || s.hp <= 0 || s.team !== 'A') return false;
    const path = straightPath(this.map, { q: s.q, r: s.r }, { q: q, r: r });
    if (!path.length) return false;
    this.sim.issueOrder({ type: 'MOVE_TO', soldierIds: [String(unit.id)], payload: { path: path } });
    this._lockLeader();
    return true;
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
      handleRightClick: g.handleRightClick,
      endTurn: g.endTurn,
    };

    // 右クリック = 移動命令。RTwP では経路も AP も無いので、選択兵へ直接命令する。
    g.handleRightClick = function (px, py, hex) {
      const sel = g.selectedUnit;
      if (sel && hex && self.orderMove(sel, hex.q, hex.r)) {
        self._log(sel.name + ' へ移動命令');
        return;
      }
      if (self._orig.handleRightClick) return self._orig.handleRightClick.call(g, px, py, hex);
    };

    // END TURN は RTwP に存在しない。押されたら一時停止のトグルにする
    // （ボタンを消すには logic_ui.js の書き換えが要るので、意味を差し替える）。
    g.endTurn = function () {
      self.setPaused(!self.paused);
      self._log(self.paused ? '一時停止' : '再開');
      self.updateHud();
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
        case 'f': case 'F':
          if (sel && sel.team === 'enemy' && self.orderFocusFire(sel)) self._log('命令: ' + sel.name + 'へ集中射撃');
          break;
        case 's': case 'S':
          if (self.orderSuppress()) self._log('命令: 制圧射撃');
          break;
        case 'c': case 'C':
          if (self.orderTakeCover()) self._log('命令: 遮蔽に入れ');
          break;
        case '1': self.setSpeed(1); break;
        case '2': self.setSpeed(2); break;
        case '3': self.setSpeed(4); break;
        default: return;
      }
      self.updateHud();
    };
    document.addEventListener('keydown', this._keyHandler);

    // 操作の手引きと状態を出す小さなHUD（既存DOMを壊さないよう独立要素で足す）
    const hud = document.createElement('div');
    hud.id = 'rtwp-hud';
    hud.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:60;background:rgba(0,0,0,.66);'
      + 'color:#dfe;font:11px/1.5 monospace;padding:6px 9px;border:1px solid #465;border-radius:4px;pointer-events:none';
    document.body.appendChild(hud);
    this._hud = hud;
    this.updateHud();
    this._uiInstalled = true;
  };

  RtwpInstance.prototype.updateHud = function () {
    if (!this._hud) return;
    const sp = this.paused ? '停止中' : (this.speed + 'x');
    this._hud.innerHTML = '<b>REAL TIME</b> [' + sp + ']<br>'
      + '右クリック=移動命令 / Space=一時停止 / 1,2,3=速度<br>'
      + '敵を選択して F=集中射撃 / S=制圧射撃 / C=遮蔽に入れ';
  };

  RtwpInstance.prototype.uninstallUi = function () {
    const g = this.gameLogic;
    if (!this._uiInstalled) return;
    if (g && this._orig) {
      if (this._orig.handleRightClick) g.handleRightClick = this._orig.handleRightClick;
      else delete g.handleRightClick;
      if (this._orig.endTurn) g.endTurn = this._orig.endTurn;
      else delete g.endTurn;
    }
    if (this._keyHandler) document.removeEventListener('keydown', this._keyHandler);
    if (this._hud && this._hud.parentNode) this._hud.parentNode.removeChild(this._hud);
    this._hud = null;
    this._uiInstalled = false;
  };

  RtwpInstance.prototype.setPaused = function (v) { this.paused = !!v; };
  RtwpInstance.prototype.setSpeed = function (v) { if (typeof v === 'number' && v >= 0) this.speed = v; };

  RtwpInstance.prototype.detach = function () {
    this.uninstallUi();
    const units = (this.gameLogic && this.gameLogic.units) || [];
    units.forEach((u) => {
      delete u._rtwpSkipped; delete u._rtwpHpScale;
    });
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
  function resolveDeps() {
    const d = {};
    d.SimCore = (typeof SimCore !== 'undefined') ? SimCore : window.SimCore;
    d.TraitPolicy = (typeof TraitPolicy !== 'undefined') ? TraitPolicy : window.TraitPolicy;
    d.CommsOrders = (typeof CommsOrders !== 'undefined') ? CommsOrders : window.CommsOrders;
    d.LeaderPolicy = (typeof LeaderPolicy !== 'undefined') ? LeaderPolicy : window.LeaderPolicy;
    d.makePsBattleMapApi = (typeof makePsBattleMapApi !== 'undefined')
      ? makePsBattleMapApi : window.makePsBattleMapApi;
    d.mulberry32 = (typeof mulberry32 !== 'undefined') ? mulberry32 : window.mulberry32;
    d.toSimWeapon = (typeof toSimWeapon !== 'undefined') ? toSimWeapon : window.toSimWeapon;
    d.SIM_TUNING = (typeof SIM_TUNING !== 'undefined') ? SIM_TUNING : window.SIM_TUNING;
    d.WPNS = (typeof WPNS !== 'undefined') ? WPNS : window.WPNS;
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
      const hasLeader = { A: false, B: false };

      (gameLogic.units || []).forEach((unit) => {
        if (!unit || unit.hp <= 0) return;
        const team = (unit.team === 'player') ? 'A' : 'B';
        let w = null;
        try { w = gameLogic.getVirtualWeapon(unit); } catch (e) { w = null; }
        const code = w && w.code;
        if (!code || !D.WPNS[code]) { unit._rtwpSkipped = true; return; }

        let sw = null;
        try { sw = D.toSimWeapon(code, D.WPNS[code], T); } catch (e) { sw = null; }
        if (!sw) { unit._rtwpSkipped = true; return; }

        const traits = [];
        (unit.skills || []).forEach((sk) => { if (SKILL_TRAITS[sk]) traits.push(SKILL_TRAITS[sk]); });

        const mags = (T.DEFAULT_MAGS && T.DEFAULT_MAGS[sw.class] != null) ? T.DEFAULT_MAGS[sw.class] : 4;
        sim.addSoldier({
          id: String(unit.id), team: team, q: unit.q, r: unit.r,
          weapon: sw, ammo: { mags: mags }, skill: 1.0,
          isLeader: !hasLeader[team], traits: traits,
          facing: (team === 'A') ? { q: 1, r: 0 } : { q: -1, r: 0 },
        });
        hasLeader[team] = true;

        // sim の hp(0..100) と本編の maxHp の縮尺を橋渡しする比率
        const s0 = sim.getSoldier(String(unit.id));
        const simHp0 = (s0 && s0.hp > 0) ? s0.hp : 100;
        unit._rtwpHpScale = unit.maxHp / simHp0;
        inst.unitById.set(String(unit.id), unit);
      });

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

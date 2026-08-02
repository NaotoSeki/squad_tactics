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

    this.sim.addSoldier({
      id: id, team: team, q: unit.q, r: unit.r,
      weapon: simWeapon, ammo: { mags: mags }, skill: 1.0,
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

  /** sim_battle.html と同一のイベント文言。製品側だけ日本語へ要約しない。 */
  RtwpInstance.prototype.formatEvent = function (ev) {
    const parts = ['t' + ev.tick, ev.type];
    if (ev.id) parts.push(this._name(ev.id));
    if (ev.shooterId) parts.push(this._name(ev.shooterId) + '->' + this._name(ev.targetId)
      + (ev.hit ? ' HIT' : ' miss') + (ev.killed ? ' KILL' : ''));
    if (ev.type === 'SHOT' && ev.roundsFired) parts.push('x' + ev.roundsFired);
    if (ev.note) parts.push('「' + ev.note + '」');
    if (ev.type === 'ORDER_DELIVERED' && ev.order) parts.push(ev.order.type);
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
            const tg = this.sim.getSoldier(String(ev.targetId));
            const R = window.Renderer;
            if (R && typeof R.hexToPx === 'function' && sh && window.VFX) {
              const a = R.hexToPx(sh.q, sh.r);
              const b = tg ? R.hexToPx(tg.q, tg.r) : null;
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
              if (R.playAttackAnim && tg) R.playAttackAnim(sh, tg);
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
    if (this.paused || !this.sim || this.sim.result()) return;
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
      actionAttack: g.actionAttack,
      onUnitClick: g.onUnitClick,
      endTurn: g.endTurn,
      uiLog: g.ui && g.ui.log,
    };

    // 戦闘中のログはフローティング窓を再表示せず、RTwPドックへ集約する。
    if (g.ui && typeof g.ui.log === 'function') {
      g.ui.log = function (msg) { self.pushEventLog(String(msg)); };
    }

    // 右クリック = 移動命令。RTwP では経路も AP も無いので、選択兵へ直接命令する。
    g.handleRightClick = function (px, py, hex) {
      const sel = g.selectedUnit;
      if (sel && hex && self.orderMove(sel, hex.q, hex.r)) {
        self._log(sel.name + ' へ移動命令');
        return;
      }
      if (self._orig.handleRightClick) return self._orig.handleRightClick.call(g, px, py, hex);
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
      if (this._orig.handleRightClick) g.handleRightClick = this._orig.handleRightClick;
      else delete g.handleRightClick;
      if (this._orig.actionAttack) g.actionAttack = this._orig.actionAttack;
      else delete g.actionAttack;
      if (this._orig.onUnitClick) g.onUnitClick = this._orig.onUnitClick;
      else delete g.onUnitClick;
      if (this._orig.endTurn) g.endTurn = this._orig.endTurn;
      else delete g.endTurn;
      if (g.ui && this._orig.uiLog) g.ui.log = this._orig.uiLog;
    }
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
      delete u._rtwpAmmo; delete u._sim;
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

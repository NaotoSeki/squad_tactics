/**
 * LOGIC BATTLE: RTwP-native BattleFacade (旧 BattleLogic を改称)
 *
 * このクラスは戦闘の**共有面**（campaign/map/spawn/units/inventory/ammo/deploy/
 * geometry/UI/log）を持つ facade である。RTwP（logic_battle_rtwp.js）はこの facade を
 * 直接の実行基盤として使う。旧ターン制のターン遷移と自動戦闘入口は撤去済みで、
 * RTwP が唯一の実行系である。共有面（弾薬・装備・地形・UI補助）はここに残す。
 *
 * NORTH_STAR §7 Strangler Fig の最終段階: RTwP が唯一の実行系。?rtwp=0 の切り戻しは撤去済み。
 */

// グローバルスコープに BattleFacade を登録（BattleLogic は後方互換の別名）
window.BattleFacade = class BattleFacade {
  constructor(campaign, playerUnits, sector) {
    this.campaign = campaign; // 親への参照
    this.units = [...playerUnits]; // プレイヤーユニット
    this.sector = sector;

    this.map = [];
    this.state = 'INIT';
    this.path = [];
    this.reachableHexes = [];
    this.attackLine = [];
    this.aimTargetUnit = null;
    this.aimTargetHex = null;
    this.hoverHex = null;

    this.isExecutingAttack = false;
    this._attackAnimDepth = 0;
    this.interactionMode = 'SELECT';
    this.selectedUnit = null;
    this.tankAutoReload = true;
    this.cardsUsed = 0; // 増援カード用

    /**
     * 射撃モード用の弾数上書き情報。
     * { unitId, weaponCode, shots }
     * コンテキストメニューから弾数を指定したときに設定される。
     * ATTACK MODE の間は維持され、SELECT など別モードに戻ったタイミングでクリアされる。
     */
    this.attackBurstOverride = null;

    this.ui = new UIManager(this);
    if (typeof MapSystem !== 'undefined') {
      this.mapSystem = new MapSystem(this);
    }
    // グローバルgameLogicを自分自身に更新
    window.gameLogic = this;
  }

  // --- INITIALIZATION ---
  init() {
    this.generateMap();

    // プレイヤー配置
    this.units.forEach(u => {
      const p = this.getSafeSpawnPos('player', u.def && u.def.isTank);
      if (p) { u.q = p.q; u.r = p.r; }
    });

    // 敵生成（FactoryはCampaignから借りる）
    this.spawnEnemies();
    this.spawnAlliedReinforcements();

    if (this.campaign && this.campaign.repairMortarGunnerLoadout) {
      this.units.filter(u => u.team === 'player').forEach(u => this.campaign.repairMortarGunnerLoadout(u, { ensureMissing: true }));
    }

    this.units.forEach(u => {
      if (typeof sanitizeUnitSpareAmmo === 'function') sanitizeUnitSpareAmmo(u);
      else if (typeof sanitizeUnitBagAmmo === 'function') sanitizeUnitBagAmmo(u);
      if (typeof LoadoutWeight !== 'undefined') LoadoutWeight.refreshUnitLoadout(u);
      // 戦果報告用の重傷表示。戦闘不能判定そのものはSimCoreが担う。
      if (!u.def?.isTank && u.maxHp) {
        u.wounded = u.hp > 0 && u.hp < u.maxHp * 0.25;
      }
    });

    this.state = 'PLAY';
    this._victoryProcessed = false;
    const allyN = this.units.filter(u => u.team === 'player').length;
    const foeN = this.units.filter(u => u.team === 'enemy').length;
    const preset = (typeof BATTLE_SCALE !== 'undefined' && BATTLE_SCALE._preset) ? BATTLE_SCALE._preset : 'chaos';
    const dialLabel = (typeof formatTacticsDialLabel === 'function')
      ? formatTacticsDialLabel(BATTLE_SCALE)
      : preset;
    this.ui.log(`SECTOR ${this.sector} [${dialLabel}] — ${allyN} vs ${foeN}`);

    const secCounter = document.getElementById('sector-counter');
    if(secCounter) secCounter.innerText = `SECTOR: ${this.sector.toString().padStart(2, '0')}`;

    // ★修正: マップ描画の準備ができるまで少し待ってからカメラを移動
    // エラーが出てもゲームを止めないように保護
    setTimeout(() => {
      if (typeof Renderer !== 'undefined' && Renderer.game) {
        try {
          Renderer.centerMap();
        } catch(e) {
          console.warn("Renderer not ready for centerMap (Skipped):", e);
        }
      }
    }, 200); // 200ms遅延

    // 支援カード配布（融合カードを先頭に、続けてランダム）
    setTimeout(() => {
      if (typeof Renderer !== 'undefined' && Renderer.game && Renderer.dealCards) {
        const deck = [...(this.campaign.carriedCards || [])].filter(card => {
          const key = card && typeof card === 'object' ? card.type : card;
          const template = typeof UNIT_TEMPLATES !== 'undefined' ? UNIT_TEMPLATES[key] : null;
          return !!template && (!template.isTank || (typeof FEATURE_TANK_UNITS !== 'undefined' && FEATURE_TANK_UNITS));
        });
        this.campaign.carriedCards = [];
        const need = Math.max(0, 5 - deck.length);
        for (let i = 0; i < need; i++) {
          deck.push(AVAILABLE_CARDS[Math.floor(Math.random() * AVAILABLE_CARDS.length)]);
        }
        Renderer.dealCards(deck);
      }
    }, 600);
  }

  generateMap() { if(this.mapSystem) this.mapSystem.generate(); }

  getHexUnitCap() {
    return (typeof BATTLE_SCALE !== 'undefined' && BATTLE_SCALE.HEX_UNIT_CAP) || 5;
  }

  getHexMoveBlock() {
    return (typeof BATTLE_SCALE !== 'undefined' && BATTLE_SCALE.HEX_MOVE_BLOCK) || 4;
  }

  getDeployCardMax() {
    return (typeof BATTLE_SCALE !== 'undefined' && BATTLE_SCALE.DEPLOY_CARD_MAX) || 2;
  }

  getEnemySpawnCount() {
    const base = (typeof BATTLE_SCALE !== 'undefined' && BATTLE_SCALE.ENEMY_BASE) || 4;
    const per = (typeof BATTLE_SCALE !== 'undefined' && BATTLE_SCALE.ENEMY_PER_SECTOR) || 0.7;
    return base + Math.floor(this.sector * per);
  }

  pickEnemyTemplate() {
    const cfg = (typeof BATTLE_SCALE !== 'undefined') ? BATTLE_SCALE : {};
    const s = this.sector;
    const tanksAvailable = typeof FEATURE_TANK_UNITS !== 'undefined' && FEATURE_TANK_UNITS;
    const tigerP = tanksAvailable ? (cfg.ENEMY_TIGER_CHANCE || 0) + s * (cfg.ENEMY_TIGER_CHANCE_PER_SECTOR || 0) : 0;
    const tankP = tanksAvailable ? (cfg.ENEMY_TANK_CHANCE || 0.02) + s * (cfg.ENEMY_TANK_CHANCE_PER_SECTOR || 0) : 0;
    const r = Math.random();
    if (r < tigerP) return 'tank_tiger';
    if (r < tigerP + tankP) return 'tank_pz4';
    if (r < tigerP + tankP + 0.23) return 'gunner';
    if (r < tigerP + tankP + 0.43) return 'sniper';
    return 'rifleman';
  }

  pickAlliedTemplate() {
    const pool = ['rifleman', 'rifleman', 'scout', 'gunner', 'gunner', 'rifleman'];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  spawnUnitAt(team, templateKey, preferredHex) {
    const template = typeof UNIT_TEMPLATES !== 'undefined' ? UNIT_TEMPLATES[templateKey] : null;
    if (!template || (template.isTank && (typeof FEATURE_TANK_UNITS === 'undefined' || !FEATURE_TANK_UNITS))) return false;
    const u = this.campaign.createSoldier(templateKey, team);
    if (!u) return false;
    const p = this.getSafeSpawnPos(team, u.def && u.def.isTank, preferredHex);
    if (!p) return false;
    u.q = p.q;
    u.r = p.r;
    this.units.push(u);
    if (window.VFX && typeof Renderer !== 'undefined' && Renderer.hexToPx) {
      const pos = Renderer.hexToPx(p.q, p.r);
      window.VFX.addSmoke(pos.x, pos.y);
    }
    return true;
  }

  spawnEnemies() {
    const c = this.getEnemySpawnCount();
    const initial = (this.mapScenario && this.mapScenario.enemyInitial) || [];
    for (let i = 0; i < c; i++) {
      this.spawnUnitAt('enemy', this.pickEnemyTemplate(), initial.length ? initial[i % initial.length] : null);
    }
  }

  spawnAlliedReinforcements() {
    const n = (typeof BATTLE_SCALE !== 'undefined' && BATTLE_SCALE.ALLIED_REINFORCEMENTS) || 0;
    if (n <= 0) return;
    let ok = 0;
    for (let i = 0; i < n; i++) {
      if (this.spawnUnitAt('player', this.pickAlliedTemplate())) ok++;
    }
    if (ok > 0) this.ui.log(`増援 ${ok} 名到着`);
  }

  // --- BATTLE STATE ---
  checkWin() {
    if (this.state === 'WIN') return true;
    if (this._victoryProcessed) return true;
    const enemies = this.units.filter(u => u.team === 'enemy' && u.hp > 0);
    if (enemies.length === 0) {
      this.state = 'WIN';
      this._victoryProcessed = true;
      const survivors = this.units.filter(u => u.team === 'player' && u.hp > 0);
      if (this.campaign && typeof BattleReview !== 'undefined' && BattleReview.capture) {
        const tick = window.RtwpBattle && window.RtwpBattle.instance
          ? window.RtwpBattle.instance.sim._tick : 0;
        this.campaign.endBattleSnapshot = BattleReview.capture(this,
          { winner: 'A', reason: 'annihilation', tick: tick },
          { tick: tick, units: this.units,
            visual: { sector: this.campaign.sector, mode: 'rtwp' } });
      }
      this.campaign.onSectorCleared(survivors);
      return true;
    }
    return false;
  }

  checkLose() {
    const players = this.units.filter(u => u.team === 'player' && u.hp > 0);
    if (players.length === 0) {
      this.state = 'LOSS';
      if (this.campaign && typeof BattleReview !== 'undefined' && BattleReview.capture) {
        const tick = window.RtwpBattle && window.RtwpBattle.instance
          ? window.RtwpBattle.instance.sim._tick : 0;
        this.campaign.endBattleSnapshot = BattleReview.capture(this,
          { winner: 'B', reason: 'annihilation', tick: tick },
          { tick: tick, units: this.units,
            visual: { sector: this.campaign.sector, mode: 'rtwp' } });
      }
      // ここへ来るのは本当に全員戦死した時だけ（生存者が居る敗北は
      // RtwpInstance.finishBattle が理由付きで送る）
      this.campaign.onGameOver('annihilation', 0);
    }
  }

  _beginAttackAnim(parallel) {
    if (parallel) return;
    this._attackAnimDepth = (this._attackAnimDepth || 0) + 1;
    this.isExecutingAttack = true;
    this.state = 'ANIM';
  }

  _endAttackAnim(parallel) {
    if (parallel) return;
    this._attackAnimDepth = Math.max(0, (this._attackAnimDepth || 1) - 1);
    if (this._attackAnimDepth === 0) {
      this.isExecutingAttack = false;
      this.state = 'PLAY';
    }
  }

  _ammoCtx() {
    return typeof window !== 'undefined' ? window : {};
  }

  /** 主兵装に装填可能な予備弾（acceptsAmmo 厳密・全銃種） */
  _canLoadSpareAmmo(weapon, ammoItem) {
    const fn = this._ammoCtx().isSpareAmmoCompatible;
    if (typeof fn === 'function') return fn(weapon, ammoItem);
    return ammoItem && ammoItem.type === 'ammo' && ammoItem.ammoFor === weapon.code;
  }

  _findCompatibleSpareMagSlot(u, w) {
    const fn = this._ammoCtx().findCompatibleSpareMagSlot;
    if (typeof fn === 'function') return fn(u, w);
    return null;
  }

  _clearSpareMagSlot(u, where, index) {
    const fn = this._ammoCtx().clearSpareMagSlot;
    if (typeof fn === 'function') fn(u, where, index);
  }

  _applySpareMagToPrimary(primary, weapon, mag) {
    const fn = this._ammoCtx().applySpareMagToPrimary;
    if (typeof fn === 'function') fn(primary, weapon, mag);
    else if (primary && mag) primary.current = primary.cap;
  }

  /** PL CBE +0x26 base rate plus the currently loaded category-18 modifier. */
  _getWeaponMalfunctionRate(w) {
    if (!w) return 0;
    const value = w.effectiveMalfRate != null
      ? w.effectiveMalfRate
      : (w.malfRate != null ? w.malfRate : w.jam);
    return Math.max(0, Math.min(100, Number(value) || 0));
  }

  /** One malfunction roll per fire action; CBE values are percentage points. */
  _rollWeaponMalfunction(w) {
    const rate = this._getWeaponMalfunctionRate(w);
    return rate > 0 && (Math.random() * 100) < rate;
  }

  countCompatibleSpareMags(u, w) {
    const fn = this._ammoCtx().countCompatibleSpareMags;
    if (typeof fn === 'function') return fn(u, w);
    return 0;
  }

  _enrichCombatWeapon(u, w) {
    if (!w) return w;
    return (typeof PlMgTripod !== 'undefined') ? PlMgTripod.enrichWeaponForCombat(u, w) : w;
  }

  /** 弾倉残量比率（0〜1） */
  getMagazineRatio(u, w) {
    // 規則本体は logic_combat_rules.js へ切り出した（headless テスト可能にするため）。
    // 未ロード時は下のフォールバック（移設元と同一のコード）へ落ちる。
    if (typeof CombatRules !== 'undefined') {
      return CombatRules.magazineRatio(u, w, {
        findMortarShellTotal: (w && w.code === 'm2_mortar') ? this._ammoCtx().findMortarShellTotal : undefined,
      });
    }
    if (!w) return 0;
    if (w.code === 'm2_mortar') {
      const fn = this._ammoCtx().findMortarShellTotal;
      const t = typeof fn === 'function' ? fn(u) : 0;
      return t > 0 ? 1 : 0;
    }
    const belt = typeof PlMgTripod !== 'undefined' && PlMgTripod.usesBeltReserve(w.code) && w.reserve !== undefined;
    if (belt) {
      const cap = w.cap || 50;
      const inGun = (w.current || 0) + (w.reserve || 0);
      return Math.min(1, inGun / Math.max(1, cap));
    }
    const cap = w.cap || 1;
    return Math.min(1, (w.current || 0) / cap);
  }

  /**
   * 弾切れ時: 銃種に適合する予備弾のみ消費してリロード（AI/自動用）。
   * @returns {boolean}
   */
  tryAutoReloadWeapon(u, options = {}) {
    const silent = !!options.silent;
    if (!u) return false;
    const w = this.getVirtualWeapon(u);
    if (!w) return false;

    if (w.code === 'm2_mortar') {
      const fn = this._ammoCtx().findMortarShellTotal;
      return typeof fn === 'function' ? fn(u) > 0 : false;
    }

    if (u.def?.isTank) {
      const slot0 = u.hands[0];
      if (!slot0) return false;
      if (slot0.type && slot0.type.includes('shell')) {
        if ((slot0.current || 0) > 0) return true;
        if ((slot0.reserve || 0) <= 0) return false;
        if (u.ap < 1) return false;
        u.ap -= 1;
        slot0.current = 1;
        slot0.reserve -= 1;
        if (!silent) this.ui.log(`${u.name} 装填`);
        if (window.Sfx) Sfx.play('tank_reload');
        return true;
      }
    }

    const primary = u.hands[0];
    if (!primary || primary.code !== w.code) return false;
    if ((primary.current || 0) > 0) return true;

    if (typeof PlMgTripod !== 'undefined' && PlMgTripod.usesBeltReserve(w.code)
        && primary.reserve !== undefined && (primary.reserve || 0) > 0) {
      const fill = Math.min(primary.cap || w.cap || 50, primary.reserve);
      primary.current = fill;
      primary.reserve = Math.max(0, (primary.reserve || 0) - fill);
      return true;
    }

    const cost = w.rld || 1;
    if (u.ap < cost) return false;

    const magSlot = this._findCompatibleSpareMagSlot(u, w);
    if (!magSlot) return false;

    const mag = magSlot.item;
    this._clearSpareMagSlot(u, magSlot.where, magSlot.index);
    u.ap -= cost;

    this._applySpareMagToPrimary(primary, w, mag);
    if (!silent) this.ui.log(`${u.name} リロード (${mag.name || '予備弾'})`);
    if (window.Sfx) Sfx.play('reload');
    this.refreshUnitState(u);
    return true;
  }

  // --- COMBAT LOGIC ---
  async actionAttack(a, d, opts) {
    const parallel = !!(opts && opts.parallel);
    if (!a || a.hp <= 0) return;
    const targetUnitForWeapon = (d.hp !== undefined) ? d : this.getUnitInHex(d.q, d.r);

    const game = this;
    let w = this.getAttackWeapon ? this.getAttackWeapon(a, targetUnitForWeapon) : null;
    if (!w) w = this.getVirtualWeapon(a);
    if (!w) return;
    if (w.isBroken) { this.ui.log("武器故障中！修理が必要"); return; }

    // ユニットクリック＝狙い撃ち、ヘックスクリック＝制圧
    let targetUnit = null;
    let targetHex = null;
    let isAreaAttack = false;
    if (d.hp !== undefined) {
      targetUnit = d;
      targetHex = { q: d.q, r: d.r };
      if (w.indirect) { isAreaAttack = true; targetUnit = null; }
      else { isAreaAttack = false; }
    } else {
      targetHex = d;
      targetUnit = null;
      isAreaAttack = true;
    }
    if (w.indirect) isAreaAttack = true;

    if (!w.indirect && !targetUnit && !isAreaAttack) { this.setMode('SELECT'); return; }

    // 虚空・水域ヘックスには攻撃不可（AP消費しない）
    if (targetHex && !this.canAttackHex(targetHex.q, targetHex.r)) {
      this.ui.log("虚空や水には攻撃できません");
      return;
    }

    // 弾薬チェック（弾切れログは出さない）
    if (w.code === 'm2_mortar') {
      if (w.current <= 0) return;
    } else if (typeof PlMgTripod !== 'undefined' && PlMgTripod.usesBeltReserve(w.code) && w.reserve !== undefined) {
      if (w.reserve <= 0 && (w.current || 0) <= 0) return;
    } else {
      if (w.isConsumable && w.current <= 0) return;
      if (w.current <= 0) {
        if (!this.tryAutoReloadWeapon(a, { silent: true })) return;
        w = this.getVirtualWeapon(a);
        if (!w || w.current <= 0) return;
      }
    }

    if (a.ap < w.ap) { this.rejectAction("AP不足"); return; }

    const dist = this.hexDist(a, targetHex);
    if (w.minRng && dist < w.minRng) { this.rejectAction("目標が近すぎます！"); return; }
    const maxRange = Math.ceil((w.rng || 1) * 2);
    if (dist > maxRange) { this.rejectAction("射程外"); return; }

    a.ap -= w.ap;
    if (this._rollWeaponMalfunction(w)) {
      const equippedSlot = (a.hands || []).find(item => item && item.code === w.code);
      const broken = equippedSlot || w;
      broken.isBroken = true;
      this.ui.log(`${a.name}の${w.name || '武器'}が故障！`);
      this.refreshUnitState(a);
      if (this.ui && this.ui.updateSidebar) this.ui.updateSidebar(a);
      return;
    }
    this._beginAttackAnim(parallel);

    if (a.def.isTank && w.type && w.type.includes('shell')) {
      this.consumeAmmo(a, w.code);
      this.updateSidebar();
    }

    const animTarget = targetUnit || { q: targetHex.q, r: targetHex.r, hp: 100 };
    if (typeof Renderer !== 'undefined' && Renderer.playAttackAnim) Renderer.playAttackAnim(a, animTarget);

    const terrainCover = this.map[targetHex.q][targetHex.r].cover;
    const coverMult = (typeof BATTLE_SCALE !== 'undefined' && BATTLE_SCALE.coverMult) || 1;
    const distPenalty = dist * (w.acc_drop || 5);
    const overRange = Math.max(0, dist - (w.rng || 0));
    let hitChance = 0;
    if (!isAreaAttack && targetUnit) {
      const aimVal = (a.params && a.params.aim != null) ? a.params.aim : (a.stats?.aim || 0);
      hitChance = aimVal * 2 + w.acc - distPenalty - terrainCover * coverMult;
      const moraleMod = (a.params && a.params.morale != null) ? (a.params.morale / 10) : 1;
      hitChance = Math.round(hitChance * moraleMod);
      hitChance -= overRange * (w.overRangePenalty ?? 15);
      if (w._hitBonus) hitChance += w._hitBonus;
      if (w._hitPenalty) hitChance -= w._hitPenalty;
      if (targetUnit.stance === 'prone') hitChance -= 20;
      if (targetUnit.stance === 'crouch') hitChance -= 10;
      if (targetUnit.skills && targetUnit.skills.includes('Ambush')) hitChance -= 15;
      if (a.skills && a.skills.includes('Precision')) hitChance += 15;
      if (typeof window.BattleCloud !== 'undefined') {
        const pin = window.BattleCloud.getIntruderPressure(targetUnit);
        if (pin > 0) hitChance += Math.floor(pin * 16);
        const atkPin = window.BattleCloud.getIntruderPressure(a);
        if (atkPin > 0) hitChance -= Math.floor(atkPin * 14);
      }
      // 射手が制圧中なら命中率-15
      if (a.suppressedTurns && a.suppressedTurns > 0) hitChance -= 15;
    }

    // 弾数撃ち分けによる命中率ペナルティ（多弾発射側を選んだとき）
    const overrideInfo = (this.attackBurstOverride &&
      this.attackBurstOverride.unitId === a.id &&
      this.attackBurstOverride.weaponCode === w.code) ? this.attackBurstOverride : null;
    if (!isAreaAttack && targetUnit && overrideInfo) {
      const cfg = this.getBurstSelectionConfigForWeapon(w, a);
      if (cfg && cfg.modes && cfg.modes.length >= 2) {
        const maxMode = Math.max.apply(null, cfg.modes);
        if (overrideInfo.shots >= maxMode) {
          // 多弾数モードは命中率を数％低下させる
          hitChance -= 5;
        }
      }
    }

    // --- 発射弾数計算（弾数撃ち分け: 選択値を優先、w.burst では cap しない） ---
    let shots = this._resolveAttackShots(a, w, overrideInfo);

    if (opts && opts.maxShots != null && shots > 0) {
      shots = Math.max(1, Math.min(shots, opts.maxShots));
    }

    let tankMg42ShotList = [];
    if (w.tankMg42Slots && w.tankMg42Slots.length > 0) {
      const burst = w.burst || 15;
      const perGun = w.tankMg42Slots.map(o => Math.min(burst, (o.mg.reserve !== undefined ? o.mg.reserve : o.mg.current) || 0));
      for (let r = 0; r < burst; r++) {
        for (let g = 0; g < w.tankMg42Slots.length; g++) {
          if (r < perGun[g]) tankMg42ShotList.push({ handIndex: w.tankMg42Slots[g].handIndex, gunIndex: g });
        }
      }
      shots = tankMg42ShotList.length;
    }

    if (w.indirect) { this.ui.log(`${a.name} 砲撃開始!`); }
    else { this.ui.log(`${a.name} 攻撃開始`); }

    // パフォーマンス改善: UI更新をループ外へ
    await new Promise(async (resolve) => {
      const isMg42 = (typeof PlMgTripod !== 'undefined' && PlMgTripod.usesBeltReserve(w.code));
      const isMortarWpn = (w.code === 'm2_mortar');
      const isShellWpn = w.type && w.type.includes('shell');
      const fireRate = isMg42 ? 30 : ((w.type === 'bullet') ? 60 : 300);
      const lastFlightTime = isMortarWpn ? 1000 : (isShellWpn ? 300 : (isMg42 ? dist * 50 : dist * 30));
      const animEndMs = Math.max(500, shots * fireRate + lastFlightTime);
      const tankGunCount = (w.tankMg42Slots && w.tankMg42Slots.length) || 1;
      // 非アクティブ化をまたいだActionは、復帰後にタイマーだけ続行しても音を鳴らさない。
      const audioEpoch = window.Sfx && Sfx.captureEpoch ? Sfx.captureEpoch() : null;

      for (let i = 0; i < shots; i++) {
        const shotInfo = tankMg42ShotList[i];
        const gunIndex = shotInfo ? shotInfo.gunIndex : 0;
        const muzzleOffsetX = (gunIndex - (tankGunCount - 1) * 0.5) * 24;

        if (!(a.def.isTank && w.type && w.type.includes('shell'))) {
          if (shotInfo && a.def.isTank && typeof PlMgTripod !== 'undefined' && PlMgTripod.usesBeltReserve(w.code)) {
            game.consumeAmmo(a, w.code, 1, shotInfo.handIndex);
          } else {
            game.consumeAmmo(a, w.code);
          }
        }
        if (game.updateSidebar) {
          requestAnimationFrame(() => game.updateSidebar(a));
        }

        const sPos = Renderer.hexToPx(a.q, a.r);
        const sx = sPos.x + muzzleOffsetX;
        const sy = sPos.y;

        const isMortar = (w.code === 'm2_mortar');
        const isShell = w.type.includes('shell');
        const mortarImpact = isMortar && typeof M2Mortar !== 'undefined' && M2Mortar.resolveImpact
          ? M2Mortar.resolveImpact({
            aimHex: targetHex, range: dist, minRange: w.minRng || 0,
            maxRange: Math.max((w.minRng || 0) + 1, Math.ceil((w.rng || dist) * 2)),
            accuracy: w.acc,
            suppressionRatio: Math.max(0, Math.min(1, (Number(a.suppression) || 0) / 80)),
            neighbors: (hex) => game.getNeighbors(hex.q, hex.r),
            isValidHex: (hex) => game.canAttackHex(hex.q, hex.r),
            rng: Math.random
          }) : null;
        const resolvedHex = mortarImpact ? mortarImpact.hex : targetHex;
        const ePos = mortarImpact && M2Mortar.impactScreenPoint
          ? M2Mortar.impactScreenPoint(mortarImpact, (q, r) => Renderer.hexToPx(q, r))
          : Renderer.hexToPx(resolvedHex.q, resolvedHex.r);
        const spread = (100 - w.acc) * 0.3;
        const tx = isMortar ? ePos.x : ePos.x + (Math.random() - 0.5) * spread * (isMg42 ? 2 : 1);
        const ty = isMortar ? ePos.y : ePos.y + (Math.random() - 0.5) * spread * (isMg42 ? 2 : 1);

        if (window.Sfx) {
          if (isMortar) {
            // Legacy action path: fire sound precedes the one-second mortar flight.
            Sfx.play('m2_mortar_fire_ps', 'cannon', audioEpoch);
          } else if (isShell || !Sfx.playWeapon) {
            Sfx.play(w.code, isShell ? 'cannon' : (isMg42 ? 'mg' : 'shot'), audioEpoch);
          } else {
            // 旧ターン制の手動Action（退役予定）でもRTwPと同じ武器別実録音を使う。
            // WPNSのburstではなく、このActionで実際に選んだ弾数を渡す。
            Sfx.playWeapon({ ...w, burstSize: shots },
              isAreaAttack ? 'suppress' : 'aimed', audioEpoch, shots);
          }
        }

        // 銃口炎(迫撃砲以外)。射線方向へ回転、銃口の高さぶんyを上げる
        if (!isMortar && typeof Renderer !== 'undefined' && Renderer.playMuzzleFlash) {
          const my = sy - 14;
          const mAng = Math.atan2(ty - my, tx - sx);
          const muzzleX = sx + Math.cos(mAng) * 10;
          const muzzleY = my + Math.sin(mAng) * 10;
          const muzzleWeapon = { ...w, burstSize: shots };
          Renderer.playMuzzleFlash(muzzleX, muzzleY, mAng, muzzleWeapon);
          if (Renderer.playMuzzleSmoke) {
            Renderer.playMuzzleSmoke(muzzleX, muzzleY, mAng, muzzleWeapon, shots);
          }
        }

        const flightTime = isMortar ? 1000 : (isShell ? 300 : (isMg42 ? dist * 50 : dist * 30));

        // 着弾処理 (非同期)
        const getWeaponDmg = (weapon) => (weapon && (typeof weapon.dmg === 'number' ? weapon.dmg : 0) + (weapon && weapon.rainbowDmgBonus || 0)) || 0;
        setTimeout(() => {
          if (isMortar || isShell) {
            if (typeof Renderer !== 'undefined' && Renderer.playExplosion) {
              // 60mm用の18フレームT3爆発を少し大きくし、専用の残煙を重ねる。
              if (isMortar) {
                Renderer.playExplosion(tx, ty, 't2_grenade', resolvedHex, {
                  sizeScale: 1.18,
                  blastTier: 't3_mortar60',
                  persistentDecal: true,
                  psDecalTier: 'medium',
                  psDecalScale: 0.50
                });
                const usedPsSmoke = Renderer.playPsFx && Renderer.playPsFx(tx, ty, 'smoke', { scale: 1.08 });
                if (!usedPsSmoke && window.VFX && VFX.addMortarSmoke) VFX.addMortarSmoke(tx, ty);
              }
              else Renderer.playExplosion(tx, ty, 't4_shell120', resolvedHex);
            } else if (window.VFX) window.VFX.addExplosion(tx, ty, "#f55", 5);
            if (window.Sfx) Sfx.play('death', null, audioEpoch);
            if (isShell && window.Sfx) setTimeout(() => Sfx.play('tank_reload', null, audioEpoch), 200);
          }

          if (w.indirect) {
            const victims = game.getUnitsInHex(resolvedHex.q, resolvedHex.r);
            const neighbors = game.getNeighbors(resolvedHex.q, resolvedHex.r);
            const areaVictims = [];
            neighbors.forEach(n => { areaVictims.push(...game.getUnitsInHex(n.q, n.r)); });
            const wDmg = getWeaponDmg(w);
            let totalBlastDamage = 0;
            const applyMortarBlast = (v, blastDistance) => {
              const rawCover = game.map[v.q] && game.map[v.q][v.r] ? Number(game.map[v.q][v.r].cover) || 0 : 0;
              const cover = Math.max(0, Math.min(1, rawCover > 1 ? rawCover / 100 : rawCover));
              const radialScale = 0.62 * (blastDistance === 0 ? 1 : (w.splashScale || 0.45));
              const variance = 0.82 + Math.random() * 0.36;
              const dmg = Math.max(1, Math.round(wDmg * radialScale * Math.max(0.35, 1 - cover * 0.65) * variance));
              const before = v.hp;
              game.applyDamage(v, dmg, blastDistance === 0 ? "迫撃砲" : "爆風");
              totalBlastDamage += Math.max(0, before - v.hp);
            };
            victims.forEach(v => applyMortarBlast(v, 0));
            areaVictims.forEach(v => applyMortarBlast(v, 1));
            game.ui.log(`>> M2着弾 (${targetHex.q},${targetHex.r})→(${resolvedHex.q},${resolvedHex.r})${mortarImpact && mortarImpact.adjacent ? ' 散布' : ''} DMG ${totalBlastDamage}`);
            // 迫撃砲による制圧
            game.applySuppression(resolvedHex.q, resolvedHex.r, w, a);

          } else if (isAreaAttack) {
            const victims = game.getUnitsInHex(targetHex.q, targetHex.r).filter(v => v.team !== a.team);
            const baseChance = (w.type === 'bullet') ? 15 : 25;
            const distDrop = Math.min(10, dist * 1.5);
            let areaHitChance = Math.max(2, baseChance - distDrop);
            const wDmg = getWeaponDmg(w);
            victims.forEach(v => {
              if ((Math.random() * 100) < areaHitChance) {
                let dmg = Math.floor(wDmg * (0.6 + Math.random() * 0.3));
                if (a.skills && a.skills.includes('HighPower')) dmg = Math.floor(dmg * 1.2);
                if (v.def.isTank && w.type === 'bullet') dmg = 0;
                if (dmg > 0) {
                  if (window.Sfx) Sfx.play('soft_hit', null, audioEpoch);
                  game.applyDamage(v, dmg, "制圧射撃", { isFire: true, attacker: a });
                }
              }
            });
            // 面制圧による制圧
            game.applySuppression(targetHex.q, targetHex.r, w, a);

          } else {
            const mainDmg = Math.floor(getWeaponDmg(w) * (0.8 + Math.random() * 0.4));
            const dmgWithSkill = a.skills && a.skills.includes('HighPower') ? Math.floor(mainDmg * 1.2) : mainDmg;
            if (targetUnit && targetUnit.hp > 0) {
              if ((Math.random() * 100) < hitChance) {
                let dmg = targetUnit.def.isTank && w.type === 'bullet' ? 0 : dmgWithSkill;
                if (dmg > 0 && typeof window.BattleCloud !== 'undefined'
                    && window.BattleCloud.getOutgoingDamageMultiplier) {
                  dmg = Math.max(1, Math.floor(dmg * window.BattleCloud.getOutgoingDamageMultiplier(a)));
                }
                if (dmg > 0) {
                  if (window.Sfx) Sfx.play('soft_hit', null, audioEpoch);
                  if (!isShell && window.VFX) window.VFX.add({ x: tx, y: ty, vx: 0, vy: -5, life: 10, maxLife: 10, color: "#fff", size: 2, type: 'spark' });
                  game.applyDamage(targetUnit, dmg, w.name, { isFire: true, attacker: a });
                } else {
                  if (window.Sfx) Sfx.play('hard_hit', null, audioEpoch);
                  if (i === 0) game.ui.log(">> 装甲により無効化！");
                }
              } else {
                if (!isShell && w.type === 'bullet') game.playBulletImpact(tx, ty, isMg42);
              }
            } else if (!isShell && w.type === 'bullet') {
              game.playBulletImpact(tx, ty, isMg42);
            }
            const sameHexUnits = game.getUnitsInHex(targetHex.q, targetHex.r).filter(u => u !== targetUnit && u.team !== a.team && u.hp > 0);
            const splashChance = (w.type === 'bullet') ? 5 : 10;
            const splashDmg = (w.type === 'bullet') ? Math.floor(dmgWithSkill * 0.5) : Math.floor(dmgWithSkill * 0.5);
            sameHexUnits.forEach(v => {
              if ((Math.random() * 100) < splashChance) {
                let sd = v.def.isTank && w.type === 'bullet' ? 0 : splashDmg;
                if (sd > 0) game.applyDamage(v, sd, isShell ? "破片" : "流弾", { isFire: true });
              }
            });
            // 直接射撃による制圧（命中・外れを問わず）
            game.applySuppression(targetHex.q, targetHex.r, w, a);
          }
        }, flightTime);

        await new Promise(r => setTimeout(r, fireRate));
      }

      setTimeout(() => {
        game.updateSidebar(a);

        const wAfter = game.getVirtualWeapon(a);
        const lastWeaponWasMg42 = (w && typeof PlMgTripod !== 'undefined' && PlMgTripod.usesBeltReserve(w.code));
        const lastWeaponWasShell = (w && w.type && w.type.includes('shell'));
        if (!lastWeaponWasMg42 && !lastWeaponWasShell && a.def.isTank && wAfter && wAfter.current === 0 && wAfter.reserve > 0 && game.tankAutoReload && a.ap >= 1) {
          game.reloadWeapon(a, false);
        }
        game.refreshUnitState(a);
        game._endAttackAnim(parallel);
        if (game.interactionMode === 'ATTACK' && game.selectedUnit === a && !game.canFireAgain(a)) {
          game.setMode('SELECT');
          game.attackLine = [];
        }
        resolve();
      }, animEndMs);
    });
  }

  /** 拒否理由をログ＋選択ユニット位置にフロート表示する */
  rejectAction(text) {
    this.ui.log(text);
    const u = this.selectedUnit;
    if (u && typeof Renderer !== 'undefined' && Renderer.game && Renderer.showFloatText) {
      try {
        Renderer.showFloatText(u.q, u.r, text, '#ff5555');
      } catch(e) {
        console.warn("Renderer not ready for showFloatText (Skipped):", e);
      }
    }
  }

  /**
   * 戦果報告用: HP が maxHp の25%未満なら「重傷」、25%以上に回復したら解除。
   * RTwPの行動不能はSimCoreの `incap` が正本で、ここでは戦闘数値を変更しない。
   */
  refreshWoundedState(u) {
    if (!u || u.hp <= 0 || !u.maxHp) return;
    if (u.def && u.def.isTank) return;
    const threshold = u.maxHp * 0.25;
    if (u.hp < threshold) {
      if (!u.wounded) {
        u.wounded = true;
        this.ui.log(`${u.name} 重傷！`);
        if (typeof Renderer !== 'undefined' && Renderer.game && Renderer.showFloatText) {
          try {
            Renderer.showFloatText(u.q, u.r, '重傷！', '#ffdd33');
          } catch (e) {
            console.warn("Renderer not ready for showFloatText (Skipped):", e);
          }
        }
      }
    } else if (u.wounded) {
      u.wounded = false;
    }
  }

  /**
   * 着弾点周辺への制圧を適用
   * 弾種に基づく suppress_range 内の敵味方歩兵に suppressedTurns=1 を付与
   * @param {number} centerQ - 着弾点Q座標
   * @param {number} centerR - 着弾点R座標
   * @param {Object} weapon - 武器オブジェクト
   * @param {Object} attacker - 攻撃者ユニット
   */
  applySuppression(centerQ, centerR, weapon, attacker) {
    if (!weapon || !window.ReactionRules) return;
    const radius = window.ReactionRules.suppressionRadius(weapon);
    if (radius <= 0) return; // 制圧なし

    const affectedUnits = [];
    // 中心から radius 以内の全hexを走査
    for (let q = centerQ - radius; q <= centerQ + radius; q++) {
      const qr_map = this.map[q];
      if (!qr_map) continue;
      for (let r = centerR - radius; r <= centerR + radius; r++) {
        if (!qr_map[r]) continue;
        const dist = this.hexDist({ q, r }, { q: centerQ, r: centerR });
        if (dist <= radius) {
          const unitsInHex = this.getUnitsInHex(q, r);
          if (unitsInHex) {
            unitsInHex.forEach(u => {
              // attacker自身、味方、撃破済み：除外
              if (u === attacker || u.team === attacker.team || u.hp <= 0) return;
              // 制圧対象（歩兵のみ）ならば
              if (window.ReactionRules.shouldSuppress(u)) {
                affectedUnits.push(u);
                u.suppressedTurns = 1;
                if (u.stance === 'stand') u.stance = 'crouch';
              }
            });
          }
        }
      }
    }

    if (affectedUnits.length > 0) {
      this.ui.log(`>> 制圧: ${affectedUnits.length}名が頭を下げた`);
    }
  }

  applyDamage(target, damage, sourceName = "攻撃", opts = {}) {
    if (!target || target.hp <= 0) return;
    if (target.skills && target.skills.includes('Armor')) damage = Math.max(0, damage - 5);
    if (typeof window.BattleCloud !== 'undefined' && damage > 0) {
      damage = Math.max(1, Math.floor(damage * window.BattleCloud.getDefenseMultiplier(target)));
      if (window.BattleCloud.getDamageTakenMultiplier) {
        damage = Math.max(1, Math.floor(damage * window.BattleCloud.getDamageTakenMultiplier(target)));
      }
    }
    target.hp -= damage;
    this.refreshWoundedState(target);
    if (target.hp <= 0 && !target.deadProcessed) {
      target.deadProcessed = true;
      this.ui.log(`>> ${target.name} を撃破！`);
      if (target.team === 'player' && !target.def?.isTank) {
        const sectors = target.sectorsSurvived || 0;
        const skillTxt = (target.skills && target.skills.length) ? `（${target.skills.join(', ')}）` : '';
        if (sectors > 0) {
          this.ui.log(`☠ ${target.name}${skillTxt} 戦死 — ${sectors}セクターを生き抜いた古参兵だった`);
        } else {
          this.ui.log(`☠ ${target.name} 戦死`);
        }
      }
      if (window.Sfx) { Sfx.play('death'); }
      if (window.VFX) { const p = Renderer.hexToPx(target.q, target.r); window.VFX.addUnitDebris(p.x, p.y); }

      if (target.team === 'enemy') {
        this.checkWin();
      } else {
        this.checkLose();
      }
    } else if (target.hp > 0 && opts.isFire && window.ReactionRules) {
      // 生存時の被弾リアクション処理
      if (!target.def?.isTank) {
        // 伏せリアクション
        if (window.ReactionRules.shouldGoProne(target, damage) && target.stance !== 'prone') {
          target.stance = 'prone';
          this.ui.log(`>> ${target.name} は伏せた！`);
        }
        // 退避リアクション（damage>=8 かつ未反応）
        const currentHex = this.map[target.q] ? this.map[target.q][target.r] : null;
        if (!target.reactedThisTurn && damage >= 8 && currentHex && (currentHex.cover || 0) < 30) {
          const ctx = {
            map: this.map,
            neighbors: (q, r) => this.getNeighbors(q, r),
            unitsInHex: (q, r) => this.getUnitsInHex(q, r),
            hexCap: this.getHexUnitCap(),
            hexDist: (a, b) => this.hexDist(a, b),
          };
          const dest = window.ReactionRules.pickCoverHex(ctx, target,
            opts.attacker ? { q: opts.attacker.q, r: opts.attacker.r } : null);
          if (dest) {
            target.reactedThisTurn = true;
            target.q = dest.q;
            target.r = dest.r;
            this.ui.log(`>> ${target.name} は物陰へ飛び込んだ！`);
          }
        }
      }
    }
  }

  // --- INVENTORY HELPERS (hands は常に3スロット配列 [slot0, slot1, slot2]) ---
  /**
   * ユニットの「実効武器」を取得する。
   * hands[0] が通常武器、または mortar パーツ3種揃いで仮想迫撃砲を返す。
   */
  getVirtualWeapon(u) {
    if (!u || !u.hands) return null;
    // 前提: hands は常に3要素配列
    if (!Array.isArray(u.hands) || u.hands.length < 3) return null;

    // スロット0が通常武器の場合（attr がなくても code で WPNS 一致すれば武器扱い）
    const slot0 = u.hands[0];
    const weaponAttr = typeof ATTR !== 'undefined' ? ATTR.WEAPON : 'Weaponry';
    const recoveryAttr = typeof ATTR !== 'undefined' ? ATTR.RECOVERY : 'Recovery';
    const master0 = slot0 && slot0.code && typeof WPNS !== 'undefined' ? WPNS[slot0.code] : null;
    /** マスタが補助装備（三脚等）なら type 欠落時も主兵装にしない */
    const slot0IsRecoveryGear = master0 && master0.attr === recoveryAttr;
    // CBE category-13 ammunition boxes used to inherit a rifle-shaped
    // placeholder from the imported master table.  They supply belts; they
    // are never a firearm, even when placed in the primary hand slot.
    const slot0IsAmmoSupply = slot0 && (slot0.type === 'ammo' || master0?.plCategory === 'ammo_box');
    const isWeapon = slot0 && !slot0IsRecoveryGear && !slot0IsAmmoSupply && slot0.type !== 'part'
      && (slot0.attr === weaponAttr || (slot0.code && master0 && master0.attr === weaponAttr));
    if (isWeapon) {
      if (typeof syncWeaponAcceptsAmmo === 'function') syncWeaponAcceptsAmmo(slot0);
      return this._enrichCombatWeapon(u, slot0);
    }

    // 迫撃砲パーツ3種揃い → 仮想 m2_mortar
    const mortarReady = (typeof M2Mortar !== 'undefined')
      ? M2Mortar.isAssembled(u)
      : ['mortar_barrel', 'mortar_bipod', 'mortar_plate'].every(code => u.hands.some(i => i && i.code === code));
    if (mortarReady) {
      const base = WPNS['m2_mortar'];
      const fn = this._ammoCtx().findMortarShellTotal;
      const totalAmmo = typeof fn === 'function' ? fn(u) : 0;
      return { ...base, code: 'm2_mortar', current: totalAmmo > 0 ? 1 : 0, cap: 1, isVirtual: true };
    }
    return null;
  }

  /** Compatibility helper for inventory-side ammunition consumption. */
  _extraAmmoBurnRoll() {
    if (typeof CombatRules !== 'undefined') return CombatRules.extraAmmoBurnRoll();
    const mult = (typeof BATTLE_SCALE !== 'undefined' && BATTLE_SCALE.ammoBurnMult) || 1;
    const extra = mult - 1;
    if (extra <= 0) return 0;
    return Math.random() < extra ? 1 : 0;
  }

  consumeAmmo(u, weaponCode, count, handIndex) {
    const n = (count != null && count > 0) ? count : 1;
    if (weaponCode === 'm2_mortar') {
      for (let i = 0; i < 3; i++) {
        const h = u.hands && u.hands[i];
        if (h && h.code === 'mortar_shell_box' && h.current > 0) { h.current--; return true; }
      }
      const ammoBox = u.bag.find(i => i && i.code === 'mortar_shell_box' && i.current > 0);
      if (ammoBox) { ammoBox.current--; return true; }
      return false;
    }
    if (typeof PlMgTripod !== 'undefined' && PlMgTripod.usesBeltReserve(weaponCode) && u.hands) {
      if (u.def?.isTank) {
        if (handIndex !== undefined && u.hands[handIndex] && u.hands[handIndex].code === weaponCode) {
          const mg = u.hands[handIndex];
          if ((mg.reserve !== undefined ? mg.reserve : mg.current) > 0) {
            if (mg.reserve !== undefined) mg.reserve = Math.max(0, mg.reserve - 1);
            else if (mg.current > 0) mg.current--;
            return true;
          }
          return false;
        }
        const mgs = u.hands.filter(h => h && h.code === weaponCode && (h.reserve !== undefined ? h.reserve > 0 : h.current > 0));
        for (let i = 0; i < n && mgs.length > 0; i++) {
          const mg = mgs.find(m => (m.reserve !== undefined ? m.reserve : m.current) > 0);
          if (!mg) break;
          if (mg.reserve !== undefined) mg.reserve = Math.max(0, mg.reserve - 1);
          else if (mg.current > 0) mg.current--;
        }
        return true;
      }
      const mg = u.hands.find(h => h && h.code === weaponCode);
      if (!mg) return false;
      const burnCount = n + this._extraAmmoBurnRoll();
      for (let i = 0; i < burnCount; i++) {
        if (mg.current <= 0 && (mg.reserve || 0) > 0) {
          const fill = Math.min(mg.cap || 50, mg.reserve);
          mg.current = fill;
          mg.reserve = Math.max(0, mg.reserve - fill);
        }
        if (mg.current > 0) mg.current--;
        else return i > 0;
      }
      return true;
    }
    if (weaponCode === 'nade') {
      for (let i = 0; i < (u.hands || []).length; i++) {
        if (u.hands[i] && u.hands[i].code === 'nade') {
          u.hands[i].current = (u.hands[i].current || 1) - 1;
          if (u.hands[i].current <= 0) u.hands[i] = null;
          return true;
        }
      }
      for (let i = 0; i < (u.bag || []).length; i++) {
        if (u.bag[i] && u.bag[i].code === 'nade') {
          u.bag[i].current = (u.bag[i].current || 1) - 1;
          if (u.bag[i].current <= 0) u.bag[i] = null;
          return true;
        }
      }
      return false;
    }
    // 戦車主砲(shell_fast): reserve消費+即時装填（リロードAP不要）
    if (u.def?.isTank && u.hands[0] && u.hands[0].code === weaponCode && u.hands[0].type?.includes('shell') && u.hands[0].reserve !== undefined && u.hands[0].reserve > 0) {
      u.hands[0].reserve--;
      u.hands[0].current = 1;
      return true;
    }
    const w = this.getVirtualWeapon(u);
    if (!w) return false;
    const primarySlot = u.hands[0];
    if (primarySlot && primarySlot.code === w.code) {
      primarySlot.current -= (1 + this._extraAmmoBurnRoll());
      if (primarySlot.current < 0) primarySlot.current = 0;
      return true;
    }
    return false;
  }

  getAttackWeapon(a, targetUnit) {
    const main = this.getVirtualWeapon(a);
    if (!main) return null;
    if (a.def.isTank && targetUnit && !targetUnit.def?.isTank) {
      const tankMgSlots = (a.hands || []).map((h, idx) => (
        h && typeof PlMgTripod !== 'undefined' && PlMgTripod.usesBeltReserve(h.code)
      ) ? { handIndex: idx, mg: h } : null).filter(Boolean);
      const totalReserve = tankMgSlots.reduce((s, o) => s + (o.mg.reserve !== undefined ? o.mg.reserve : o.mg.current || 0), 0);
      if (tankMgSlots.length > 0 && totalReserve > 0) {
        const dist = this.hexDist(a, targetUnit);
        const mg = tankMgSlots[0].mg;
        const rng = mg.rng || 8; const minRng = mg.minRng || 0;
        if (dist >= minRng && dist <= rng && a.ap >= (mg.ap || 2)) {
          return { ...mg, reserve: totalReserve, burst: mg.burst || 15, tankMg42Slots: tankMgSlots };
        }
      }
    }
    return main;
  }

  /** ATTACKモード継続可否。AP・残弾を判定し、もう一発撃てないなら false */
  canFireAgain(u) {
    const w = this.getVirtualWeapon(u);
    if (!w || w.isBroken) return false;
    if (u.ap < (w.ap || 1)) return false;
    if (w.code === 'm2_mortar') {
      let total = 0;
      (u.bag || []).forEach(i => { if (i && i.code === 'mortar_shell_box') total += (i.current || 0); });
      return total > 0;
    }
    if (typeof PlMgTripod !== 'undefined' && PlMgTripod.usesBeltReserve(w.code) && w.reserve !== undefined) {
      return (w.reserve > 0) || ((w.current || 0) > 0);
    }
    if (u.def?.isTank && w.type && w.type.includes('shell')) {
      return (w.reserve !== undefined && w.reserve > 0) || (w.current !== undefined && w.current > 0);
    }
    if (w.isConsumable) return (w.current || 0) > 0;
    return (w.current || 0) > 0;
  }

  // --- HELPER METHODS ---

  _resolveAttackShots(a, w, overrideInfo) {
    if (!w) return 1;
    if (w.isConsumable) return 1;
    if (a.def?.isTank && w.type && w.type.includes('shell')) return 1;

    let ammoCap = 0;
    if (w.code === 'm2_mortar') {
      (a.bag || []).forEach((item) => {
        if (item && item.code === 'mortar_shell_box') ammoCap += (item.current || 0);
      });
    } else if (typeof PlMgTripod !== 'undefined' && PlMgTripod.usesBeltReserve(w.code) && w.reserve !== undefined) {
      ammoCap = (w.current || 0) + (w.reserve || 0);
    } else {
      ammoCap = w.current || 0;
    }

    let requested = w.burst || 1;
    if (overrideInfo && overrideInfo.weaponCode === w.code && overrideInfo.shots > 0) {
      requested = overrideInfo.shots;
    }

    if (ammoCap <= 0) return 0;
    return Math.max(1, Math.min(requested, ammoCap));
  }

  /**
   * 弾数撃ち分けUIの対象かどうかとモード情報を返す。
   * @param {Object} w - getVirtualWeapon / getAttackWeapon が返す武器オブジェクト
   * @returns {{ weaponCode: string, modes: number[] }|null}
   */
  getBurstSelectionConfigForWeapon(w, u) {
    if (!w || !w.code) return null;
    const unit = u || this.selectedUnit;
    let modes = null;
    if (typeof PlMgTripod !== 'undefined') {
      modes = PlMgTripod.getFireModes(w, unit);
      if (!modes && PlMgTripod.normalizeFireModes) {
        modes = PlMgTripod.normalizeFireModes(w.modes);
      }
    } else if (Array.isArray(w.modes)) {
      modes = w.modes.slice();
    }
    if (typeof PlMgTripod !== 'undefined' && PlMgTripod.normalizeFireModes) {
      modes = PlMgTripod.normalizeFireModes(modes);
    } else if (modes) {
      modes = [...new Set(modes.filter((n) => Number(n) > 0))].sort((a, b) => a - b);
      if (modes.length < 2) modes = null;
    }
    if (!modes) return null;
    return { weaponCode: w.code, modes };
  }

  /**
   * コンテキストメニューから弾数を選んで ATTACK モードへ入る。
   * UI から直接呼ばれる。
   * @param {number} shots - 選択された発射弾数
   */
  setAttackModeWithBurst(shots) {
    const u = this.selectedUnit;
    if (!u || !shots || shots <= 0) return;
    const w = this.getVirtualWeapon ? this.getVirtualWeapon(u) : null;
    const cfg = this.getBurstSelectionConfigForWeapon(w, u);
    if (!w || !cfg) return;
    this.attackBurstOverride = {
      unitId: u.id,
      weaponCode: w.code,
      shots: shots
    };
    this.setMode('ATTACK');
  }

  toggleSidebar() { this.ui.toggleSidebar(); }
  toggleTankAutoReload() { this.tankAutoReload = !this.tankAutoReload; this.updateSidebar(); }
  updateSidebar(unitOverride) {
    const u = unitOverride != null ? unitOverride : this.selectedUnit;
    this.ui.updateSidebar(u, this.state, this.tankAutoReload);
  }
  showContext(mx, my, hex) { this.ui.showContext(mx, my, hex); }
  hideActionMenu() { this.ui.hideActionMenu(); }
  getUnitsInHex(q, r) { return this.units.filter(u => u.q === q && u.r === r && u.hp > 0); }

  /** 同ヘックスの味方（装備渡し UI 用） */
  getSameHexSquadMembers(unit) {
    if (!unit || unit.hp <= 0) return [];
    return this.getUnitsInHex(unit.q, unit.r).filter(u => u.team === 'player' && u.hp > 0);
  }

  canTransferEquipmentBetween(fromUnit, toUnit) {
    if (typeof FEATURE_SAME_HEX_TRANSFER !== 'undefined' && !FEATURE_SAME_HEX_TRANSFER) return false;
    if (!fromUnit || !toUnit || fromUnit === toUnit) return false;
    if (this.state !== 'PLAY') return false;
    if (fromUnit.team !== 'player' || toUnit.team !== 'player') return false;
    if (fromUnit.q !== toUnit.q || fromUnit.r !== toUnit.r) return false;
    if (fromUnit.hp <= 0 || toUnit.hp <= 0) return false;
    if (fromUnit.def && fromUnit.def.isTank) return false;
    if (toUnit.def && toUnit.def.isTank) return false;
    return true;
  }

  /**
   * 同一ヘックスの味方へ装備を渡す（src スロット ↔ tgt スロットを swap）。
   * @returns {boolean}
   */
  transferEquipment(fromUnit, toUnit, src, tgt) {
    if (!this.canTransferEquipmentBetween(fromUnit, toUnit)) {
      this.ui.log('同ヘックスの味方歩兵にのみ渡せます');
      return false;
    }
    const srcIdx = src.type === 'main' ? (src.index ?? 0) : src.index;
    const tgtIdx = tgt.type === 'main' ? (tgt.index ?? 0) : tgt.index;
    const item1 = src.type === 'main' ? fromUnit.hands[srcIdx] : fromUnit.bag[srcIdx];
    const item2 = tgt.type === 'main' ? toUnit.hands[tgtIdx] : toUnit.bag[tgtIdx];
    if (!item1 && !item2) return false;
    const changed = (item1 !== item2) || (item1 && item2 && (item1.code !== item2.code || item1.id !== item2.id));
    if (!changed) return false;

    if (typeof PlMgTripod !== 'undefined' && PlMgTripod.validateItemPlacement) {
      const vFrom = PlMgTripod.validateItemPlacement(fromUnit, src.type, srcIdx, item2);
      const vTo = PlMgTripod.validateItemPlacement(toUnit, tgt.type, tgtIdx, item1);
      if (!vFrom.ok || !vTo.ok) {
        this.ui.log((vFrom.reason || vTo.reason) || '装備配置不可');
        return false;
      }
    }

    if (src.type === 'main') fromUnit.hands[srcIdx] = item2; else fromUnit.bag[srcIdx] = item2;
    if (tgt.type === 'main') toUnit.hands[tgtIdx] = item1; else toUnit.bag[tgtIdx] = item1;

    this.refreshLoadoutDerivedState(fromUnit);
    this.refreshLoadoutDerivedState(toUnit);
    if (fromUnit !== this.selectedUnit && toUnit !== this.selectedUnit) this.updateSidebar();
    if (window.Sfx) Sfx.play('swap');
    const itemName = item1 ? (item1.name || item1.code) : (item2 ? item2.name || item2.code : '装備');
    this.ui.log(`${fromUnit.name} → ${toUnit.name}: ${itemName}`);
    return true;
  }

  /** サイドバー SQUAD 行: 同ヘックス味方の LOADOUT 表示対象を切替 */
  selectSquadMember(u) {
    if (!u || u.team !== 'player' || u.hp <= 0) return;
    if (this.interactionMode !== 'SELECT') this.setMode('SELECT');
    this.selectedUnit = u;
    this.refreshUnitState(u);
    this.updateSidebar(u);
    if (window.Sfx) Sfx.play('click');
  }

  /** Recompute all load-dependent state before repainting the sidebar/menu. */
  refreshLoadoutDerivedState(u) {
    if (!u) return;
    if (typeof LoadoutWeight !== 'undefined' && LoadoutWeight.refreshUnitLoadout) {
      LoadoutWeight.refreshUnitLoadout(u);
    }
    const rtwp = (typeof RtwpBattle !== 'undefined' && RtwpBattle.active)
      ? RtwpBattle.instance : null;
    if (rtwp && rtwp.syncUnitLoadout) rtwp.syncUnitLoadout(u);
    if (u === this.selectedUnit) {
      this.updateSidebar(u);
      if (this.ui && this.ui.refreshCommandMenuState) this.ui.refreshCommandMenuState(u);
    }
  }

  getUnitInHex(q, r) { return this.units.find(u => u.q === q && u.r === r && u.hp > 0); }
  getUnit(q, r) { return this.getUnitInHex(q, r); }
  isValidHex(q, r) { return this.mapSystem ? this.mapSystem.isValidHex(q, r) : false; }
  /** 攻撃可能なヘックスか（有効かつ虚空・水域でない） */
  canAttackHex(q, r) {
    if (!this.isValidHex(q, r)) return false;
    const tile = this.map[q] && this.map[q][r];
    return tile && tile.id !== -1 && tile.id !== 5;
  }
  hexDist(a, b) { return this.mapSystem ? this.mapSystem.hexDist(a, b) : 0; }
  getNeighbors(q, r) { return this.mapSystem ? this.mapSystem.getNeighbors(q, r) : []; }
  findPath(u, tq, tr) { return this.mapSystem ? this.mapSystem.findPath(u, tq, tr) : []; }

  calcAttackLine(u, tq, tr) {
    if (!this.mapSystem) return;
    this.attackLine = this.mapSystem.calcAttackLine(u, tq, tr);
    const w = this.getVirtualWeapon(u);
    if (w && w.indirect && this.attackLine.length === 0) {
      const dist = this.hexDist(u, {q:tq, r:tr});
      if (dist <= w.rng && dist >= (w.minRng || 0)) {
        this.attackLine = [{q: u.q, r: u.r}, {q: tq, r: tr}];
      }
    }
    if (this.attackLine.length > 0) {
      const last = this.attackLine[this.attackLine.length - 1];
      if (last.q === tq && last.r === tr) {
        const target = this.getUnitInHex(last.q, last.r);
        if (target && target.team !== u.team) { this.aimTargetUnit = target; }
        else { this.aimTargetUnit = null; }
      } else { this.aimTargetUnit = null; }
    } else { this.aimTargetUnit = null; }
  }

  /** Largest connected component of hexes that tracked vehicles can traverse. */
  getMainVehiclePassableComponent() {
    if (this._vehicleSpawnMap === this.map && this._vehicleSpawnComponent) {
      return this._vehicleSpawnComponent;
    }

    const visited = new Set();
    let largest = new Set();
    const passable = (q, r) => {
      const t = this.map[q] && this.map[q][r];
      return !!t && t.cost < 99 && !t.tankBlocked;
    };

    for (let q = 0; q < MAP_W; q++) {
      for (let r = 0; r < MAP_H; r++) {
        const startKey = q + ',' + r;
        if (visited.has(startKey)) continue;
        visited.add(startKey);
        if (!passable(q, r)) continue;

        const component = new Set([startKey]);
        const pending = [{ q, r }];
        while (pending.length > 0) {
          const current = pending.pop();
          this.getNeighbors(current.q, current.r).forEach((neighbor) => {
            const neighborKey = neighbor.q + ',' + neighbor.r;
            if (visited.has(neighborKey)) return;
            visited.add(neighborKey);
            if (!passable(neighbor.q, neighbor.r)) return;
            component.add(neighborKey);
            pending.push(neighbor);
          });
        }
        if (component.size > largest.size) largest = component;
      }
    }

    this._vehicleSpawnMap = this.map;
    this._vehicleSpawnComponent = largest;
    return largest;
  }

  getSafeSpawnPos(team, isTank, preferredHex) {
    const vehicleComponent = isTank ? this.getMainVehiclePassableComponent() : null;
    const cy = Math.floor(MAP_H / 2);
    const canSpawnAt = (q, r) => {
      if (!this.isValidHex(q, r)) return false;
      if (team === 'player' && r < cy) return false;
      if (team === 'enemy' && r >= cy) return false;
      const t = this.map[q][r];
      const inVehicleComponent = !vehicleComponent || vehicleComponent.has(q + ',' + r);
      return inVehicleComponent && this.getUnitsInHex(q, r).length < this.getHexUnitCap()
        && t.cost < 99 && !(isTank && t.tankBlocked);
    };

    // Validated procedural maps provide deterministic spawn candidates.
    // Static maps retain the legacy random search below.
    const scenarioSpawns = this.mapScenario && this.mapScenario.spawns
      && this.mapScenario.spawns[team];
    if (preferredHex && canSpawnAt(preferredHex.q, preferredHex.r)) {
      return { q: preferredHex.q, r: preferredHex.r };
    }
    if (Array.isArray(scenarioSpawns) && scenarioSpawns.length > 0) {
      for (const candidate of scenarioSpawns) {
        if (canSpawnAt(candidate.q, candidate.r)) return { q: candidate.q, r: candidate.r };
      }
    }

    for (let i = 0; i < 100; i++) {
      const q = Math.floor(Math.random() * MAP_W);
      const r = Math.floor(Math.random() * MAP_H);
      if (canSpawnAt(q, r)) return { q, r };
    }

    // A sparse team-side slice of the main component can be missed by random trials.
    if (isTank) {
      for (let q = 0; q < MAP_W; q++) {
        for (let r = 0; r < MAP_H; r++) {
          if (canSpawnAt(q, r)) return { q, r };
        }
      }
    }
    return null;
  }

  // --- OTHERS ---
  setMode(mode) {
    this.interactionMode = mode;
    this.ui.hideActionMenu();
    const indicator = document.getElementById('mode-label');
    if (mode === 'SELECT') {
      if(indicator) indicator.style.display = 'none';
      this.path = [];
      this.attackLine = [];
      this.reachableHexes = [];
      // ATTACK以外のモードに移行したら弾数指定はクリアしておく
      this.attackBurstOverride = null;
    } else {
      if(indicator) {
        indicator.style.display = 'block';
        indicator.innerText = mode + " MODE";
      }
      if (mode === 'MOVE') { this.calcReachableHexes(this.selectedUnit); }
      else if (mode === 'ATTACK') { this.reachableHexes = []; }
    }
  }

  onUnitClick(u) {
    if (this.state === 'REVIEW' && this._battleReviewReadOnly) {
      this.selectedUnits = null;
      this.selectedUnit = u;
      if (this.ui && this.ui.hideActionMenu) this.ui.hideActionMenu();
      if (this.updateSidebar) this.updateSidebar();
      return;
    }
    if (this.state !== 'PLAY' && this.state !== 'ANIM') return;
    // 誰か1人を選び直した時点で矩形選択は解ける（味方の場合は続く
    // showActionMenu が同じ値を入れ直す）
    this.selectedUnits = null;
    if (u.team === 'player') {
      if (this.interactionMode !== 'SELECT') { this.setMode('SELECT'); }
      this.selectedUnit = u;
      this.refreshUnitState(u);
      if (typeof Renderer !== 'undefined' && Renderer.game) {
        const pointer = Renderer.game.input.activePointer;
        this.ui.showActionMenu(u, pointer.x, pointer.y);
      }
      if (window.Sfx) { Sfx.play('click'); }
      return;
    }
    if (this.interactionMode === 'ATTACK' && this.selectedUnit && this.selectedUnit.team === 'player') {
      this.actionAttack(this.selectedUnit, u); return;
    }
    if (this.interactionMode === 'MELEE' && this.selectedUnit && this.selectedUnit.team === 'player') {
      this.actionMelee(this.selectedUnit, u); this.setMode('SELECT'); return;
    }
    this.selectedUnit = u; this.refreshUnitState(u); this.ui.hideActionMenu();
  }

  /** Tabキー: 行動可能な自軍兵を順番に選択し、カメラを寄せる（dir=-1 で逆順 / Shift+Tab） */
  selectNextUnit(dir = 1) {
    const candidates = this.units.filter(u => u.team === 'player' && u.hp > 0 && u.ap > 0);
    if (candidates.length === 0) return;
    const curIdx = this.selectedUnit ? candidates.indexOf(this.selectedUnit) : -1;
    const next = candidates[(curIdx + dir + candidates.length) % candidates.length];
    this.onUnitClick(next);
    if (typeof Renderer !== 'undefined' && Renderer.game && Renderer.centerOn) {
      try {
        Renderer.centerOn(next.q, next.r);
      } catch(e) {
        console.warn("Renderer not ready for centerOn (Skipped):", e);
      }
    }
  }

  handleClick(p, pointerX, pointerY) {
    if (this.state !== 'PLAY' && this.state !== 'ANIM') return;
    if (this.interactionMode === 'SELECT') { this.clearSelection(); }
    else if (this.interactionMode === 'MOVE') {
      if (this.selectedUnit && this.isValidHex(p.q, p.r) && this.path.length > 0) {
        const last = this.path[this.path.length - 1];
        if (last.q === p.q && last.r === p.r) {
          const u = this.selectedUnit;
          const isThisTurn = this.reachableHexes.some(h => h.q === p.q && h.r === p.r);
          if (isThisTurn) {
            this.actionMove(u, this.path);
          }
          this.setMode('SELECT');
        }
      } else { this.setMode('SELECT'); }
    }
    else if (this.interactionMode === 'ATTACK') {
      if (this.selectedUnit) {
        const w = this.getVirtualWeapon(this.selectedUnit);
        const isIndirect = w && w.indirect;
        if (isIndirect) {
          this.actionAttack(this.selectedUnit, p);
        } else {
          let targetUnit = null;
          const inHex = this.getUnitsInHex(p.q, p.r);
          if (pointerX != null && pointerY != null && typeof phaserGame !== 'undefined' && phaserGame.scene) {
            const main = phaserGame.scene.getScene('MainScene');
            if (main && main.getUnitAtScreenPosition) targetUnit = main.getUnitAtScreenPosition(pointerX, pointerY);
            if (targetUnit && inHex.indexOf(targetUnit) < 0) targetUnit = null;
            if (!targetUnit && inHex.length > 1 && main && main.getClosestUnitToScreen) targetUnit = main.getClosestUnitToScreen(inHex, pointerX, pointerY);
          }
          if (!targetUnit) targetUnit = inHex[0] || this.getUnitInHex(p.q, p.r);
          if (targetUnit && targetUnit.team !== this.selectedUnit.team) {
            this.actionAttack(this.selectedUnit, targetUnit);
          } else {
            this.actionAttack(this.selectedUnit, p);
          }
        }
      } else {
        this.setMode('SELECT');
      }
    }
    else if (this.interactionMode === 'MELEE') { this.setMode('SELECT'); }
  }

  handleHover(p) {
    if (this.state !== 'PLAY' && this.state !== 'ANIM') return;
    this.hoverHex = p;
    const u = this.selectedUnit;
    if (u && u.team === 'player') {
      if (this.interactionMode === 'MOVE') {
        const isReachable = this.reachableHexes.some(h => h.q === p.q && h.r === p.r);
        const targetUnits = this.getUnitsInHex(p.q, p.r);
        const canEnter = targetUnits.length < this.getHexUnitCap();
        if (canEnter && isReachable) {
          this.path = this.findPath(u, p.q, p.r);
        } else {
          this.path = [];
        }
      } else if (this.interactionMode === 'ATTACK') {
        this.calcAttackLine(u, p.q, p.r);
      }
    }
  }

  /**
   * ATTACK MODE用：指定ヘックスへの概算命中率（％）を返す。ユニット狙いとエリア射撃で計算が異なる。
   * @param {Object} attacker - 攻撃者ユニット
   * @param {{q:number,r:number}} targetHex - 目標ヘックス
   * @param {Object|null} targetUnit - 狙うユニット（いなければエリア射撃として中央着弾目安）
   * @returns {{ hit: number, isArea: boolean }|null} 攻撃不可時は null
   */
  getEstimatedHitChance(attacker, targetHex, targetUnit) {
    if (!attacker || !targetHex || !this.map[targetHex.q] || !this.map[targetHex.q][targetHex.r]) return null;
    const w = this.getVirtualWeapon ? this.getVirtualWeapon(attacker) : null;
    if (!w || w.type === 'melee') return null;
    const dist = this.hexDist(attacker, targetHex);
    const maxRange = Math.ceil((w.rng || 1) * 2);
    if (dist > maxRange) return null;
    if (w.minRng && dist < w.minRng) return null;
    const terrainCover = this.map[targetHex.q][targetHex.r].cover;
    const coverMult = (typeof BATTLE_SCALE !== 'undefined' && BATTLE_SCALE.coverMult) || 1;
    const aimVal = (attacker.params && attacker.params.aim != null) ? attacker.params.aim : (attacker.stats?.aim || 0);
    const throwVal = (attacker.params && attacker.params.throw != null) ? attacker.params.throw : 5;
    const moraleMod = (attacker.params && attacker.params.morale != null) ? (attacker.params.morale / 10) : 1;

    // ATTACK MODE で弾数撃ち分けを指定済みなら、概算命中率にも反映
    const overrideInfo = (this.attackBurstOverride &&
      this.attackBurstOverride.unitId === attacker.id &&
      this.attackBurstOverride.weaponCode === w.code) ? this.attackBurstOverride : null;
    let applyBurstPenalty = false;
    if (overrideInfo) {
      const cfg = this.getBurstSelectionConfigForWeapon(w, attacker);
      if (cfg && cfg.modes && cfg.modes.length >= 2) {
        const maxMode = Math.max.apply(null, cfg.modes);
        if (overrideInfo.shots >= maxMode) {
          applyBurstPenalty = true;
        }
      }
    }

    return computeHitChance({
      dist, w, terrainCover, coverMult, aimVal, throwVal, moraleMod,
      targetUnit, wounded: false, applyBurstPenalty
    });
  }

  handleRightClick(mx, my, hex) {
    if (!hex && typeof Renderer !== 'undefined') {
      hex = Renderer.pxToHex(mx, my);
    }
    if (this.interactionMode !== 'SELECT') {
      this.setMode('SELECT');
      if (this.selectedUnit && this.selectedUnit.team === 'player') {
        this.ui.showActionMenu(this.selectedUnit, mx, my);
        if (window.Sfx) { Sfx.play('click'); }
      }
      return;
    }
    if (this.selectedUnit) {
      this.clearSelection();
      if (window.Sfx) { Sfx.play('click'); }
    } else {
      if (hex) { this.ui.showContext(mx, my, hex); }
    }
  }

  clearSelection() {
    this.selectedUnit = null;
    this.selectedUnits = null;   // 矩形選択の集合。足元の輪の解除もこれが正
    this.reachableHexes = [];
    this.attackLine = [];
    this.aimTargetUnit = null;
    this.path = [];
    this.setMode('SELECT');
    this.ui.hideActionMenu();
    this.updateSidebar();
  }

  refreshUnitState(u) {
    if (!u || u.hp <= 0) {
      this.selectedUnit = null;
      this.reachableHexes = [];
      this.attackLine = [];
      this.aimTargetUnit = null;
    }
    this.updateSidebar();
  }

  getMovementBudget(u, apOverride) {
    if (typeof CombatRules !== 'undefined') return CombatRules.movementBudget(u, apOverride);
    if (typeof LoadoutWeight !== 'undefined') {
      return LoadoutWeight.getMovementBudget(u, apOverride != null ? apOverride : u.ap);
    }
    const spd = (u.params && u.params.speed != null) ? u.params.speed : 5;
    const ap = apOverride != null ? apOverride : u.ap;
    return Math.max(1, Math.floor(ap * (spd / 5)));
  }

  getTerrainMoveCost(u, q, r) {
    const base = this.map[q][r].cost;
    const mult = (typeof LoadoutWeight !== 'undefined') ? LoadoutWeight.getTerrainCostMultiplier(u) : 1;
    return Math.max(1, Math.ceil(base * mult));
  }

  /**
   * ヘックスがそのユニットにとって進入不可か。地形cost>=99(荒地・ボカージュ等の
   * 純粋な不可侵)に加え、建物(tankBlocked)は戦車のみ通行不可。歩兵は建物内へ
   * 進入し壁際に隠れられる(2026-07-13追加)。
   */
  isHexBlockedForUnit(u, q, r) {
    const t = this.map[q] && this.map[q][r];
    if (!t) return true;
    if (t.cost >= 99) return true;
    if (t.tankBlocked && u && u.def && u.def.isTank) return true;
    return false;
  }

  calcReachableHexes(u) {
    this.reachableHexes = [];
    if (!u) return;
    const maxCost = this.getMovementBudget(u);
    const frontier = [{ q: u.q, r: u.r, cost: 0 }];
    const costSoFar = new Map();
    costSoFar.set(`${u.q},${u.r}`, 0);
    while (frontier.length > 0) {
      const current = frontier.shift();
      this.getNeighbors(current.q, current.r).forEach(n => {
        if (this.getUnitsInHex(n.q, n.r).length >= this.getHexMoveBlock()) { return; }
        const stepCost = this.getTerrainMoveCost(u, n.q, n.r);
        if (this.isHexBlockedForUnit(u, n.q, n.r)) { return; }
        const nc = costSoFar.get(`${current.q},${current.r}`) + stepCost;
        if (nc > maxCost) return;
        const key = `${n.q},${n.r}`;
        if (costSoFar.has(key) && nc >= costSoFar.get(key)) return;
        costSoFar.set(key, nc);
        frontier.push({ q: n.q, r: n.r, cost: nc });
        this.reachableHexes.push({ q: n.q, r: n.r });
      });
    }
  }

  setStance(s) {
    const u = this.selectedUnit; if (!u || u.def.isTank) return;
    if (u.stance === s) return;
    let cost = 0; if (u.stance === 'prone' && (s === 'stand' || s === 'crouch')) { cost = 1; }
    if (u.ap < cost) { this.rejectAction("AP不足"); return; }
    u.ap -= cost; u.stance = s; this.refreshUnitState(u); this.ui.hideActionMenu(); if (window.Sfx) Sfx.play('click');
  }

  toggleStance() { const u = this.selectedUnit; if (!u) return; let next = 'stand'; if (u.stance === 'stand') next = 'crouch'; else if (u.stance === 'crouch') next = 'prone'; this.setStance(next); }

  /**
   * 装備をスワップする。
   * @param {Object} src - { type: 'main'|'bag', index?: number }
   * @param {Object} tgt - { type: 'main'|'bag', index?: number }
   * @param {Object} [unitOverride] - 対象ユニット（AI用。省略時は selectedUnit）
   */
  swapEquipment(src, tgt, unitOverride) {
    const u = unitOverride ?? this.selectedUnit;
    if (!u) return;
    const srcIdx = src.type === 'main' ? (src.index ?? 0) : src.index;
    const tgtIdx = tgt.type === 'main' ? (tgt.index ?? 0) : tgt.index;

    let item1 = src.type === 'main' ? u.hands[srcIdx] : u.bag[srcIdx];
    let item2 = tgt.type === 'main' ? u.hands[tgtIdx] : u.bag[tgtIdx];

    if (src.type === tgt.type && srcIdx === tgtIdx) return;
    const changed = (item1 !== item2) || (item1 && item2 && (item1.code !== item2.code || item1.id !== item2.id));
    if (!changed) return;

    if (typeof PlMgTripod !== 'undefined' && PlMgTripod.validateEquipmentSwap) {
      const v = PlMgTripod.validateEquipmentSwap(u, src, tgt, item1, item2);
      if (!v.ok) {
        this.ui.log(v.reason || '装備配置不可');
        if (window.Sfx) Sfx.play('click');
        return;
      }
    }

    if (src.type === 'main') u.hands[srcIdx] = item2; else u.bag[srcIdx] = item2;
    if (tgt.type === 'main') u.hands[tgtIdx] = item1; else u.bag[tgtIdx] = item1;

    this.refreshLoadoutDerivedState(u);
    if (window.Sfx) Sfx.play('click');
    this.ui.log(`${u.name} 装備変更`);
  }

  /** 装備スロットからデッキへ戻せるアイテムか */
  _canMoveItemToDeck(item) {
    if (!item || !item.code || typeof WPNS === 'undefined' || !WPNS[item.code]) return false;
    const m = WPNS[item.code];
    if (typeof PlMgTripod !== 'undefined' && PlMgTripod.isTripodCode(item.code)) return true;
    if (item.code === 'mortar_shell_box' || item.code === 'mag') return true;
    if (m.type === 'part' && m.partType) return true;
    if (m.attr === ATTR.WEAPON || m.attr === ATTR.RECOVERY) return true;
    return false;
  }

  /** デッキカードを LOADOUT / BACKPACK スロットへ装備できるか（UI D&D 用） */
  canEquipItemFromDeck(source) {
    if (!source) return false;
    if (typeof source === 'string') {
      if (typeof WPNS === 'undefined' || !WPNS[source]) return false;
      return this._canMoveItemToDeck({ code: source });
    }
    return this._canMoveItemToDeck(source);
  }

  moveWeaponToDeck(src) {
    const u = this.selectedUnit;
    if (!u) return;
    const idx = src.type === 'main' ? src.index : src.index;
    const item = src.type === 'main' ? u.hands[idx] : u.bag[idx];
    if (!this._canMoveItemToDeck(item)) return;
    if (src.type === 'main') u.hands[idx] = null; else u.bag[idx] = null;
    if (typeof Renderer !== 'undefined' && Renderer.dealCard) {
      Renderer.dealCard({ type: item.code, weaponData: item });
    }
    this.refreshLoadoutDerivedState(u);
    if (window.Sfx) Sfx.play('click');
    this.ui.log(`${u.name} 装備解除: ${item.name || item.code}`);
  }

  /**
   * デッキから武器カードを装備スロットへ移す。
   * weaponSource は string（従来どおりWPNSから生成）か、
   * { code, ... } などの実インスタンスオブジェクトのどちらか。
   */
  equipWeaponFromDeck(weaponSource, slotTarget) {
    const u = this.selectedUnit;
    if (!u) return;

    let newItem = null;
    let base = null;

    if (typeof weaponSource === 'string') {
      const weaponCode = weaponSource;
      if (!WPNS[weaponCode]) return;
      const isTripod = typeof PlMgTripod !== 'undefined' && PlMgTripod.isTripodCode(weaponCode);
      if (!isTripod && WPNS[weaponCode].attr !== ATTR.WEAPON && WPNS[weaponCode].attr !== ATTR.RECOVERY) return;
      base = WPNS[weaponCode];
      newItem = { ...base, code: weaponCode, id: Math.random(), isBroken: false };
      if (base.type === 'bullet' || base.type === 'shell_fast') newItem.current = newItem.cap;
      else if (base.type === 'shell' || base.area) { newItem.current = 1; newItem.isConsumable = true; }
      else if (base.type === 'ammo') newItem.current = base.current || base.cap;
      if (u.def && u.def.isTank && !base.type.includes('part') && !base.type.includes('ammo')) {
        newItem.current = 1; newItem.cap = 1;
        newItem.reserve = newItem.reserve || (
          (typeof PlMgTripod !== 'undefined' && PlMgTripod.usesBeltReserve(weaponCode))
            ? PlMgTripod.getDefaultBeltReserve(weaponCode) : 12
        );
      } else if (typeof PlMgTripod !== 'undefined') {
        PlMgTripod.applyItemDefaults(newItem, weaponCode, false);
      }
    } else if (weaponSource && weaponSource.code && WPNS[weaponSource.code]) {
      if (!this._canMoveItemToDeck(weaponSource)) return;
      newItem = weaponSource;
      base = WPNS[newItem.code];
    } else {
      return;
    }

    const tgtIdx = slotTarget.type === 'main' ? slotTarget.index : slotTarget.index;
    if (typeof PlMgTripod !== 'undefined' && PlMgTripod.validateItemPlacement) {
      const v = PlMgTripod.validateItemPlacement(u, slotTarget.type, tgtIdx, newItem);
      if (!v.ok) {
        this.ui.log(v.reason || '装備配置不可');
        return;
      }
    }

    const oldItem = slotTarget.type === 'main' ? u.hands[tgtIdx] : u.bag[tgtIdx];
    if (slotTarget.type === 'main') u.hands[tgtIdx] = newItem; else u.bag[tgtIdx] = newItem;

    if (oldItem && this._canMoveItemToDeck(oldItem) && typeof Renderer !== 'undefined' && Renderer.dealCard) {
      Renderer.dealCard({ type: oldItem.code, weaponData: oldItem });
    }
    this.refreshLoadoutDerivedState(u);
    if (window.Sfx) Sfx.play('click');
    this.ui.log(`${u.name} 装備: ${newItem.name || newItem.code}`);
  }

  toggleFireMode() {
    const u = this.selectedUnit;
    if (!u || !u.hands || !Array.isArray(u.hands)) return;
    const slot0 = u.hands[0];
    if (!slot0) return;
    const modes = (typeof PlMgTripod !== 'undefined' && PlMgTripod.normalizeFireModes)
      ? PlMgTripod.normalizeFireModes(slot0.modes)
      : null;
    if (!modes) return;
    const currentBurst = slot0.burst;
    let nextIndex = modes.indexOf(currentBurst) + 1;
    if (nextIndex >= modes.length) nextIndex = 0;
    slot0.burst = modes[nextIndex];
    if (window.Sfx) Sfx.play('click');
    this.updateSidebar();
  }

  /**
   * 武器をリロードする。
   * @param {Object} unit - リロード対象ユニット（AI用）。省略時は selectedUnit を使用
   * @param {boolean} manual - 手動リロード（メニューから押した場合 true）
   */
  reloadWeapon(unitOrManual, manualArg) {
    let u, manual;
    if (typeof unitOrManual === 'object') {
      u = unitOrManual;
      manual = manualArg === true;
    } else {
      u = this.selectedUnit;
      manual = unitOrManual === true;
    }
    if (!u) return;
    const w = this.getVirtualWeapon(u);
    if (!w) return;

    if (u.def.isTank) {
      if (u.ap < 1) { this.ui.log("AP不足"); return; }
      if (w.reserve <= 0) { this.ui.log("予備弾なし"); return; }
      u.ap -= 1;
      w.current = 1;
      w.reserve -= 1;
      this.ui.log("装填完了");
      if (window.Sfx) Sfx.play('tank_reload');
      this.refreshUnitState(u);
      if (manual) this.ui.hideActionMenu();
      return;
    }

    // 歩兵: マガジン交換
    const cost = w.rld || 1;
    if (u.ap < cost) { this.rejectAction("AP不足"); return; }

    const magSlot = this._findCompatibleSpareMagSlot(u, w);
    if (!magSlot) {
      const hasAmmo = (u.hands || []).slice(1).some(i => i && i.type === 'ammo')
        || (u.bag || []).some(i => i && i.type === 'ammo');
      this.ui.log(hasAmmo ? "この武器に合う予備弾がありません" : "予備弾なし");
      return;
    }

    const mag = magSlot.item;
    this._clearSpareMagSlot(u, magSlot.where, magSlot.index);
    u.ap -= cost;
    const primarySlot = u.hands[0];
    if (primarySlot && primarySlot.code === w.code) {
      this._applySpareMagToPrimary(primarySlot, w, mag);
    }
    this.ui.log("リロード完了");
    if (window.Sfx) Sfx.play('reload');
    this.refreshUnitState(u);
    if (manual) this.ui.hideActionMenu();
  }

  actionMeleeSetup() {
    this.setMode('MELEE');
  }

  actionRepair() {
    const u = this.selectedUnit; if (!u || u.ap < 2) return;
    const brokenSlot = (u.hands || []).find(item => item && item.isBroken);
    if (!brokenSlot) return;
    u.ap -= 2;
    brokenSlot.isBroken = false;
    this.ui.log(`${u.name} 武器修理完了`);
    if (window.Sfx) Sfx.play('reload');
    this.refreshUnitState(u);
    this.ui.hideActionMenu();
  }

  actionHeal() {
    const u = this.selectedUnit; if (!u || u.ap < 2) return;
    const targets = this.getUnitsInHex(u.q, u.r).filter(t => t.team === u.team && t.hp < t.maxHp);
    if (targets.length === 0) return;
    targets.sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp));
    const target = targets[0];
    u.ap -= 2;
    const healAmount = 30;
    target.hp = Math.min(target.maxHp, target.hp + healAmount);
    this.refreshWoundedState(target);
    this.ui.log(`${u.name} が ${target.name} を治療`);
    if (window.VFX) { const p = Renderer.hexToPx(u.q, u.r); window.VFX.add({ x: p.x, y: p.y - 20, vx: 0, vy: -1, life: 30, maxLife: 30, color: "#0f0", size: 4, type: 'spark' }); }
    this.refreshUnitState(u);
    this.ui.hideActionMenu();
  }

  async actionMelee(a, d, opts) {
    const parallel = !!(opts && opts.parallel);
    if (!a || a.ap < 2 || a.hp <= 0 || !d || d.hp <= 0) return;
    if (a.q !== d.q || a.r !== d.r) return;
    const getWeaponDmg = (w) => (w && (typeof w.dmg === 'number' ? w.dmg : 0) + (w && w.rainbowDmgBonus || 0)) || 0;
    let wpnName = "銃床"; let bonusDmg = 0;
    if (a.def.isTank) { wpnName = "体当たり"; bonusDmg = 15; }
    else {
      let bestWeapon = null;
      if (a.hands?.[0] && a.hands[0].type === 'melee') { bestWeapon = a.hands[0]; }
      a.bag.forEach(item => { if (item && item.type === 'melee') { if (!bestWeapon || getWeaponDmg(item) > getWeaponDmg(bestWeapon)) { bestWeapon = item; } } });
      if (bestWeapon) { wpnName = bestWeapon.name; bonusDmg = getWeaponDmg(bestWeapon); }
    }
    a.ap -= 2;
    this.ui.log(`${a.name} 白兵攻撃`);
    if (typeof Renderer !== 'undefined' && Renderer.playAttackAnim) { Renderer.playAttackAnim(a, d); }
    await new Promise(r => setTimeout(r, parallel ? 60 : 300));
    const meleeVal = (a.params && a.params.melee != null) ? a.params.melee : ((a.stats && a.stats.str) ? a.stats.str : 0);
    let totalDmg = 10 + (meleeVal * 3) + bonusDmg;
    if (d.skills && d.skills.includes('CQC')) { this.ui.log(`>> カウンター！`); this.applyDamage(a, 15, "カウンター"); }
    if (window.Sfx) Sfx.play('hit');
    this.applyDamage(d, totalDmg, "白兵");
    this.refreshUnitState(a);
  }

  async actionMove(u, p, opts) {
    if (!u || u.hp <= 0) return;
    // Equipment weight can reduce effective spd to zero. Direct callers must
    // not bypass the reachable-hex budget used by the normal UI path.
    if (this.getMovementBudget(u) <= 0) return;
    const parallel = !!(opts && opts.parallel);
    const stepMs = 180;
    if (!parallel) this.state = 'ANIM';
    for (const s of p) {
      u.ap -= this.getTerrainMoveCost(u, s.q, s.r);
      u.q = s.q;
      u.r = s.r;
      if (window.Sfx) Sfx.play('move');
      await new Promise(r => setTimeout(r, stepMs));
    }
    if (!parallel) this.checkReactionFire(u);
    if (!parallel) this.state = 'PLAY';
    this.refreshUnitState(u);
  }
  /**
   * 小銃・機関銃の地面弾着。KHAOS T1(12.7mm土煙)を縮小再生し、
   * MG42連射はスパム防止で確率間引き(残りは従来スパーク)。
   */
  playBulletImpact(x, y, isMg) {
    const useKhaos = typeof Renderer !== 'undefined' && Renderer.playExplosion && (!isMg || Math.random() < 0.4);
    if (useKhaos) {
      Renderer.playExplosion(x, y, 't1_12mm', null, { sizeScale: 0.45 + Math.random() * 0.2 });
    } else if (window.VFX) {
      window.VFX.addBulletImpact(x, y, 1);
    }
  }

  checkReactionFire(u) { this.units.filter(e => e.team !== u.team && e.hp > 0 && e.def.isTank && this.hexDist(u, e) <= 1).forEach(t => { this.ui.log("防御射撃"); this.applyDamage(u, 15, "防御"); const rp = Renderer.hexToPx(u.q, u.r); if (Renderer.playExplosion) Renderer.playExplosion(rp.x, rp.y, 't1_12mm'); else if(window.VFX) window.VFX.addExplosion(rp.x, rp.y, "#fa0", 5); }); }
  // --- UTILS ---
  checkDeploy(targetHex, cardType) {
    const template = typeof UNIT_TEMPLATES !== 'undefined' && cardType ? UNIT_TEMPLATES[cardType] : null;
    if (!template || (template.isTank && (typeof FEATURE_TANK_UNITS === 'undefined' || !FEATURE_TANK_UNITS))) return false;
    if(!this.isValidHex(targetHex.q, targetHex.r) || this.map[targetHex.q][targetHex.r].id === -1) return false;
    const t = this.map[targetHex.q][targetHex.r];
    if(t.cost >= 99) return false;
    const isTank = template.isTank;
    if (isTank && t.tankBlocked) return false;
    if (this.getUnitsInHex(targetHex.q, targetHex.r).length >= this.getHexUnitCap()) return false;
    if (this.cardsUsed >= this.getDeployCardMax()) return false;
    return true;
  }

  deployUnit(targetHex, cardType, fusionData, portraitIndex, fusionCount, unitName) {
    if(!this.checkDeploy(targetHex, cardType)) { return; }
    const u = this.campaign.createSoldier(cardType, 'player', fusionData, portraitIndex, unitName, fusionCount);
    if(u) {
      u.q = targetHex.q; u.r = targetHex.r;
      this.units.push(u); this.cardsUsed++;
      this.ui.log(`増援到着: ${u.name}`);
      if(window.VFX) { const pos = Renderer.hexToPx(targetHex.q, targetHex.r); window.VFX.addSmoke(pos.x, pos.y); }
      this.updateSidebar();
    }
  }

  async triggerBombardment(centerHex) {
    if (!this.isValidHex(centerHex.q, centerHex.r)) return;
    this.ui.log(`>> 航空支援要請`);
    const neighbors = this.getNeighbors(centerHex.q, centerHex.r);
    const fullPool = [centerHex, ...neighbors];
    if (fullPool.length === 0) return;
    // 海域・null も含む全ヘックスから抽選し、1ヘックスあたりの命中率を一定にする
    const hits = [];
    for (let i = 0; i < 3; i++) hits.push(fullPool[Math.floor(Math.random() * fullPool.length)]);
    const audioEpoch = window.Sfx && Sfx.captureEpoch ? Sfx.captureEpoch() : null;
    for (const hex of hits) {
      const pos = Renderer.hexToPx(hex.q, hex.r);
      const canHit = this.canAttackHex(hex.q, hex.r);
      setTimeout(() => {
        if (window.Sfx) { Sfx.play('cannon', null, audioEpoch); }
        if (typeof Renderer !== 'undefined') { Renderer.playExplosion(pos.x, pos.y, 't5_aerialbomb', hex); }
        if (canHit) {
          const units = this.getUnitsInHex(hex.q, hex.r);
          units.forEach(u => { this.ui.log(`>> 爆撃命中`); this.applyDamage(u, 350, "爆撃"); });
        }
        this.updateSidebar();
      }, Math.random() * 800);
    }
  }

  addReinforcement(u) { this.units.push(u); }

  refreshUnitState(u) {
    if (!u || u.hp <= 0) {
      this.selectedUnit = null;
      this.reachableHexes = [];
      this.attackLine = [];
      this.aimTargetUnit = null;
    }
    this.updateSidebar();
  }
};

// 後方互換: 旧名 BattleLogic は BattleFacade の別名。既存の呼び出し・テストが
// 移行し切るまで残す（段階退役の対象。参照が消えたら削除する）。
window.BattleLogic = window.BattleFacade;

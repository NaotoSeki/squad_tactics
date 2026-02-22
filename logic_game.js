/** LOGIC BATTLE: Pure Combat Engine (Decoupled from Meta-Game) */

// グローバルスコープにBattleLogicを登録
window.BattleLogic = class BattleLogic {
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

    this.isAuto = false;
    if (this.campaign) this.campaign.isAutoMode = false;
    const autoBtn = document.getElementById('auto-toggle');
    if (autoBtn) autoBtn.classList.remove('active');
    this.isExecutingAttack = false;
    this.isProcessingTurn = false;
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
    this.ai = new EnemyAI(this);

    // グローバルgameLogicを自分自身に更新
    window.gameLogic = this;
  }

  // --- INITIALIZATION ---
  init() {
    this.generateMap();

    // SECTOR開始時にAUTOは常にOFF
    this.isAuto = false;
    if (this.campaign) this.campaign.isAutoMode = false;
    const autoBtn = document.getElementById('auto-toggle');
    if (autoBtn) autoBtn.classList.remove('active');

    // プレイヤー配置
    this.units.forEach(u => {
      const p = this.getSafeSpawnPos('player');
      if (p) { u.q = p.q; u.r = p.r; }
    });

    // 敵生成（FactoryはCampaignから借りる）
    this.spawnEnemies();

    this.state = 'PLAY';
    this._victoryProcessed = false;
    this.ui.log(`SECTOR ${this.sector} ENGAGEMENT START`);

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
        const deck = [...(this.campaign.carriedCards || [])];
        this.campaign.carriedCards = [];
        const need = Math.max(0, 5 - deck.length);
        for (let i = 0; i < need; i++) {
          deck.push(AVAILABLE_CARDS[Math.floor(Math.random() * AVAILABLE_CARDS.length)]);
        }
        Renderer.dealCards(deck);
      }
      if (this.isAuto) this.runAuto();
    }, 600);
  }

  generateMap() { if(this.mapSystem) this.mapSystem.generate(); }

  spawnEnemies() {
    const c = 4 + Math.floor(this.sector * 0.7);
    for (let i = 0; i < c; i++) {
      let k = 'rifleman'; const r = Math.random();
      if (r < 0.1 + this.sector * 0.1) k = 'tank_pz4'; else if (r < 0.4) k = 'gunner'; else if (r < 0.6) k = 'sniper';

      // CampaignのFactoryを使用
      const e = this.campaign.createSoldier(k, 'enemy');
      if (e) {
        const p = this.getSafeSpawnPos('enemy');
        if (p) { e.q = p.q; e.r = p.r; this.units.push(e); }
      }
    }
  }

  // --- GAME LOOP & TURN ---
  endTurn() {
    if (this.isProcessingTurn) return;
    this.isProcessingTurn = true;
    this.setMode('SELECT');
    this.selectedUnit = null;
    this.reachableHexes = [];
    this.attackLine = [];
    this.ui.hideActionMenu();

    this.state = 'ANIM';
    const e = document.getElementById('eyecatch');
    if (e) e.style.opacity = 1;

    // ターン経過処理
    this.units.filter(u => u.team === 'player' && u.hp > 0 && u.skills.includes("Mechanic")).forEach(u => {
      if (u.hp < u.maxHp) { u.hp = Math.min(u.maxHp, u.hp + 20); this.ui.log("修理"); }
    });

    const turnDelay = this.isAuto ? 300 : 1200;
    setTimeout(async () => {
      if (e) e.style.opacity = 0;
      await this.ai.executeTurn(this.units);

      if (this.checkWin()) return;

      this.units.forEach(u => { if (u.team === 'player') u.ap = u.maxAp; });
      this.ui.log("-- PLAYER PHASE --");
      this.state = 'PLAY';
      this.isProcessingTurn = false;
      if (this.isAuto) this.runAuto();
    }, turnDelay);
  }

  checkWin() {
    if (this.state === 'WIN') return true;
    if (this._victoryProcessed) return true;
    const enemies = this.units.filter(u => u.team === 'enemy' && u.hp > 0);
    if (enemies.length === 0) {
      this.state = 'WIN';
      this._victoryProcessed = true;
      const survivors = this.units.filter(u => u.team === 'player' && u.hp > 0);
      this.campaign.onSectorCleared(survivors);
      return true;
    }
    return false;
  }

  checkLose() {
    const players = this.units.filter(u => u.team === 'player' && u.hp > 0);
    if (players.length === 0) {
      this.campaign.onGameOver();
    }
  }

  // --- COMBAT LOGIC ---
  async actionAttack(a, d) {
    if (!a) return;
    const targetUnitForWeapon = (d.hp !== undefined) ? d : (this.getUnitInHex(d.q, d.r));

    const game = this;
    let w = this.getAttackWeapon ? this.getAttackWeapon(a, targetUnitForWeapon) : null;
    if (!w) w = this.getVirtualWeapon(a);
    if (!w) return;
    if (w.isBroken) { this.ui.log("武器故障中！修理が必要"); return; }

    // ターゲット判定：ユニットクリック＝狙い撃ち、ヘックスクリック＝制圧射撃
    // indirectは常にエリア射撃。直接武器はd.hpの有無で区別（ユニット指定なら狙い撃ち、ヘックスのみなら制圧）
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

    // 弾薬チェック
    if (w.code === 'm2_mortar') {
      if (w.current <= 0) { this.ui.log("弾切れ！弾薬箱が空です"); return; }
    } else if (w.code === 'mg42' && w.reserve !== undefined) {
      if (w.reserve <= 0) { this.ui.log("弾切れ！MG42ベルトが空です"); return; }
    } else {
      if (w.isConsumable && w.current <= 0) { this.ui.log("使用済みです"); return; }
      if (w.current <= 0) {
        this.reloadWeapon(a, false);
        if (this.getVirtualWeapon(a)?.current <= 0) return;
      }
    }

    if (a.ap < w.ap) { this.ui.log("AP不足"); return; }

    // M8 Rocket: 照準確定後にMarch of antsを消してから攻撃描写
    if (w.code === 'm8_rocket' && isAreaAttack && targetHex) {
      const hasAmmo = a.hands[0] && a.hands[0].code === 'm8_rocket' && (a.hands[0].current || 0) > 0;
      if (!hasAmmo) { this.ui.log("M8 弾切れ"); return; }
      this.isExecutingAttack = true;
      a.ap -= w.ap;
      this.state = 'ANIM';
      this.attackLine = [];
      this.aimTargetUnit = null;
      await this.triggerM8Rocket(a, targetHex);
      this.isExecutingAttack = false;
      this.state = 'PLAY';
      this.checkPhaseEnd();
      if (this.ui && this.ui.updateSidebar) this.ui.updateSidebar();
      return;
    }

    const dist = this.hexDist(a, targetHex);
    if (w.minRng && dist < w.minRng) { this.ui.log("目標が近すぎます！"); return; }
    const maxRange = Math.ceil((w.rng || 1) * 2);
    if (dist > maxRange) { this.ui.log("射程外"); return; }

    this.isExecutingAttack = true;
    a.ap -= w.ap;
    this.state = 'ANIM';

    if (a.def.isTank && w.type && w.type.includes('shell')) {
      this.consumeAmmo(a, w.code);
      this.updateSidebar();
    }

    const animTarget = targetUnit || { q: targetHex.q, r: targetHex.r, hp: 100 };
    if (typeof Renderer !== 'undefined' && Renderer.playAttackAnim) Renderer.playAttackAnim(a, animTarget);

    const terrainCover = this.map[targetHex.q][targetHex.r].cover;
    const distPenalty = dist * (w.acc_drop || 5);
    const overRange = Math.max(0, dist - (w.rng || 0));
    let hitChance = 0;
    if (!isAreaAttack && targetUnit) {
      hitChance = (a.stats?.aim || 0) * 2 + w.acc - distPenalty - terrainCover;
      hitChance -= overRange * (w.overRangePenalty ?? 15);
      if (w.code === 'mg42') hitChance += 15;
      if (targetUnit.stance === 'prone') hitChance -= 20;
      if (targetUnit.stance === 'crouch') hitChance -= 10;
      if (targetUnit.skills && targetUnit.skills.includes('Ambush')) hitChance -= 15;
      if (a.skills && a.skills.includes('Precision')) hitChance += 15;
    }

    // 弾数撃ち分けによる命中率ペナルティ（多弾発射側を選んだとき）
    const overrideInfo = (this.attackBurstOverride &&
      this.attackBurstOverride.unitId === a.id &&
      this.attackBurstOverride.weaponCode === w.code) ? this.attackBurstOverride : null;
    if (!isAreaAttack && targetUnit && overrideInfo) {
      const cfg = this.getBurstSelectionConfigForWeapon(w);
      if (cfg && cfg.modes && cfg.modes.length >= 2) {
        const maxMode = Math.max.apply(null, cfg.modes);
        if (overrideInfo.shots >= maxMode) {
          // 多弾数モードは命中率を数％低下させる
          hitChance -= 5;
        }
      }
    }

    // --- 発射弾数計算（弾数撃ち分け対応） ---
    let shots;
    if (w.code === 'mg42' && w.reserve !== undefined) {
      shots = Math.min(w.burst || 15, w.reserve);
    } else if (a.def.isTank && w.type && w.type.includes('shell')) {
      shots = 1;
    } else if (w.code === 'm2_mortar') {
      // M2 迫撃砲は仮想武器。弾薬箱残数に応じて最大発射数を制限
      let totalAmmo = 0;
      a.bag.forEach(item => {
        if (item && item.code === 'mortar_shell_box') totalAmmo += (item.current || 0);
      });
      shots = Math.min(w.burst || 1, totalAmmo);
      if (shots <= 0) shots = 1;
    } else if (w.isConsumable) {
      shots = 1;
    } else {
      shots = Math.min(w.burst || 1, w.current);
    }

    // 弾数撃ち分けの上書き（BAR / SMG / Mortar のみ）
    if (overrideInfo) {
      let maxByAmmo = shots;
      if (w.code === 'm2_mortar') {
        let totalAmmo = 0;
        a.bag.forEach(item => {
          if (item && item.code === 'mortar_shell_box') totalAmmo += (item.current || 0);
        });
        maxByAmmo = totalAmmo;
      } else if (!w.isConsumable && !(a.def.isTank && w.type && w.type.includes('shell'))) {
        maxByAmmo = w.current;
      }
      if (maxByAmmo > 0) {
        shots = Math.max(1, Math.min(overrideInfo.shots, maxByAmmo));
      }
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
      const isMg42 = (w.code === 'mg42');
      const fireRate = isMg42 ? 30 : ((w.type === 'bullet') ? 60 : 300);
      const mg42Speed = 0.08;
      const tankGunCount = (w.tankMg42Slots && w.tankMg42Slots.length) || 1;

      for (let i = 0; i < shots; i++) {
        const shotInfo = tankMg42ShotList[i];
        const gunIndex = shotInfo ? shotInfo.gunIndex : 0;
        const muzzleOffsetX = (gunIndex - (tankGunCount - 1) * 0.5) * 24;

        if (!(a.def.isTank && w.type && w.type.includes('shell'))) {
          if (shotInfo && a.def.isTank && w.code === 'mg42') {
            game.consumeAmmo(a, w.code, 1, shotInfo.handIndex);
          } else {
            game.consumeAmmo(a, w.code);
          }
        }
        if (game.updateSidebar) {
          requestAnimationFrame(() => game.updateSidebar(a));
        }

        const sPos = Renderer.hexToPx(a.q, a.r);
        const ePos = Renderer.hexToPx(targetHex.q, targetHex.r);
        const sx = sPos.x + muzzleOffsetX;
        const sy = sPos.y;

        const isMortar = (w.code === 'm2_mortar');
        const isShell = w.type.includes('shell');
        const spread = (100 - w.acc) * 0.3;
        const tx = ePos.x + (Math.random() - 0.5) * spread * (isMg42 ? 2 : 1);
        const ty = ePos.y + (Math.random() - 0.5) * spread * (isMg42 ? 2 : 1);

        if (window.Sfx) Sfx.play(w.code, isShell ? 'cannon' : (isMg42 ? 'mg' : 'shot'));

        const arc = isMortar ? 250 : (isShell ? 30 : 0);
        const flightTime = isMortar ? 1000 : (isShell ? 300 : (isMg42 ? dist * 50 : dist * 30));
        const projSpeed = isMg42 ? mg42Speed : (isMortar ? 0.05 : 0.2);

        if (window.VFX) {
          if (isMg42) {
            for (let m = 0; m < 3; m++) {
              const mfx = sx - 8 + Math.random() * 16;
              const mfy = sy - 25 - Math.random() * 15;
              VFX.add({ x: mfx, y: mfy, vx: 1 + Math.random() * 2, vy: -2 - Math.random() * 2, life: 12, maxLife: 12, color: "#ffffaa", size: 4 + Math.random() * 2, type: 'spark' });
            }
          }
          VFX.addProj({
            x: sx, y: sy, sx: sx, sy: sy, ex: tx, ey: ty,
            type: w.type, speed: projSpeed,
            progress: 0,
            arcHeight: arc, isTracer: true,
            onHit: () => { }
          });
        }

        // 着弾処理 (非同期)
        const getWeaponDmg = (weapon) => (weapon && (typeof weapon.dmg === 'number' ? weapon.dmg : 0) + (weapon && weapon.rainbowDmgBonus || 0)) || 0;
        setTimeout(() => {
          if (isMortar || isShell) {
            if (window.VFX) VFX.addExplosion(tx, ty, "#f55", 5);
            if (window.Sfx) Sfx.play('death');
            if (isShell && window.Sfx) setTimeout(() => Sfx.play('tank_reload'), 200);
          }

          if (w.indirect) {
            const victims = game.getUnitsInHex(targetHex.q, targetHex.r);
            const neighbors = game.getNeighbors(targetHex.q, targetHex.r);
            const areaVictims = [];
            neighbors.forEach(n => { areaVictims.push(...game.getUnitsInHex(n.q, n.r)); });
            const wDmg = getWeaponDmg(w);
            victims.forEach(v => {
              if ((Math.random() * 100) < 65 + 20 - dist * 2) {
                game.applyDamage(v, wDmg, "迫撃砲");
              } else {
                game.ui.log(">> 至近弾！");
                game.applyDamage(v, Math.floor(wDmg / 3), "爆風");
              }
            });
            areaVictims.forEach(v => {
              game.applyDamage(v, Math.floor(wDmg / 4), "爆風");
            });

          } else if (isAreaAttack) {
            const victims = game.getUnitsInHex(targetHex.q, targetHex.r).filter(v => v.team !== a.team);
            const baseChance = (w.type === 'bullet') ? 15 : 25;
            const distDrop = Math.min(10, dist * 1.5);
            const areaHitChance = Math.max(2, baseChance - distDrop);
            const wDmg = getWeaponDmg(w);
            victims.forEach(v => {
              if ((Math.random() * 100) < areaHitChance) {
                let dmg = Math.floor(wDmg * (0.6 + Math.random() * 0.3));
                if (a.skills && a.skills.includes('HighPower')) dmg = Math.floor(dmg * 1.2);
                if (v.def.isTank && w.type === 'bullet') dmg = 0;
                if (dmg > 0) {
                  if (window.Sfx) Sfx.play('soft_hit');
                  game.applyDamage(v, dmg, "制圧射撃");
                }
              }
            });

          } else {
            const mainDmg = Math.floor(getWeaponDmg(w) * (0.8 + Math.random() * 0.4));
            const dmgWithSkill = a.skills && a.skills.includes('HighPower') ? Math.floor(mainDmg * 1.2) : mainDmg;
            if (targetUnit && targetUnit.hp > 0) {
              if ((Math.random() * 100) < hitChance) {
                let dmg = targetUnit.def.isTank && w.type === 'bullet' ? 0 : dmgWithSkill;
                if (dmg > 0) {
                  if (window.Sfx) Sfx.play('soft_hit');
                  if (!isShell && window.VFX) VFX.add({ x: tx, y: ty, vx: 0, vy: -5, life: 10, maxLife: 10, color: "#fff", size: 2, type: 'spark' });
                  game.applyDamage(targetUnit, dmg, w.name);
                } else {
                  if (window.Sfx) Sfx.play('hard_hit');
                  if (i === 0) game.ui.log(">> 装甲により無効化！");
                }
              } else {
                if (window.VFX) {
                  VFX.add({ x: tx, y: ty, vx: 0, vy: 0, life: 10, maxLife: 10, color: "#aaa", size: 2, type: 'smoke' });
                  if (!isShell && w.type === 'bullet') VFX.addBulletImpact(tx, ty, 1);
                }
              }
            } else if (!isShell && w.type === 'bullet' && window.VFX) {
              VFX.addBulletImpact(tx, ty, 1);
            }
            const sameHexUnits = game.getUnitsInHex(targetHex.q, targetHex.r).filter(u => u !== targetUnit && u.team !== a.team && u.hp > 0);
            const splashChance = (w.type === 'bullet') ? 5 : 10;
            const splashDmg = (w.type === 'bullet') ? Math.floor(dmgWithSkill * 0.5) : Math.floor(dmgWithSkill * 0.5);
            sameHexUnits.forEach(v => {
              if ((Math.random() * 100) < splashChance) {
                let sd = v.def.isTank && w.type === 'bullet' ? 0 : splashDmg;
                if (sd > 0) game.applyDamage(v, sd, isShell ? "破片" : "流弾");
              }
            });
          }
        }, flightTime);

        await new Promise(r => setTimeout(r, fireRate));
      }

      setTimeout(() => {
        game.state = 'PLAY';
        game.updateSidebar(a);

        const wAfter = game.getVirtualWeapon(a);
        const lastWeaponWasMg42 = (w && w.code === 'mg42');
        const lastWeaponWasShell = (w && w.type && w.type.includes('shell'));
        if (!lastWeaponWasMg42 && !lastWeaponWasShell && a.def.isTank && wAfter && wAfter.current === 0 && wAfter.reserve > 0 && game.tankAutoReload && a.ap >= 1) {
          game.reloadWeapon(a, false);
        }
        game.refreshUnitState(a);
        game.isExecutingAttack = false;
        game.state = 'PLAY';
        game.checkPhaseEnd();
        resolve();
      }, 500);
    });
  }

  applyDamage(target, damage, sourceName = "攻撃") {
    if (!target || target.hp <= 0) return;
    if (target.skills && target.skills.includes('Armor')) damage = Math.max(0, damage - 5);
    target.hp -= damage;
    if (target.hp <= 0 && !target.deadProcessed) {
      target.deadProcessed = true;
      this.ui.log(`>> ${target.name} を撃破！`);
      if (window.Sfx) { Sfx.play('death'); }
      if (window.VFX) { const p = Renderer.hexToPx(target.q, target.r); VFX.addUnitDebris(p.x, p.y); }

      if (target.team === 'enemy') {
        this.checkWin();
      } else {
        this.checkLose();
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
    const isWeapon = slot0 && slot0.type !== 'part' && (slot0.attr === (typeof ATTR !== 'undefined' ? ATTR.WEAPON : 'Weaponry') || (slot0.code && typeof WPNS !== 'undefined' && WPNS[slot0.code] && WPNS[slot0.code].attr === (typeof ATTR !== 'undefined' ? ATTR.WEAPON : 'Weaponry')));
    if (isWeapon) return slot0;

    // 迫撃砲パーツ3種揃い → 仮想 m2_mortar
    const parts = u.hands.map(i => i ? i.code : null);
    if (parts.includes('mortar_barrel') && parts.includes('mortar_bipod') && parts.includes('mortar_plate')) {
      const base = WPNS['m2_mortar'];
      let totalAmmo = 0;
      u.bag.forEach(item => { if (item && item.code === 'mortar_shell_box') totalAmmo += item.current; });
      return { ...base, code: 'm2_mortar', current: totalAmmo > 0 ? 1 : 0, cap: 1, isVirtual: true };
    }
    return null;
  }

  consumeAmmo(u, weaponCode, count, handIndex) {
    const n = (count != null && count > 0) ? count : 1;
    if (weaponCode === 'm2_mortar') {
      const ammoBox = u.bag.find(i => i && i.code === 'mortar_shell_box' && i.current > 0);
      if (ammoBox) { ammoBox.current--; return true; }
      return false;
    }
    if (weaponCode === 'm8_rocket') {
      const slot0 = u.hands && u.hands[0];
      if (!slot0 || slot0.code !== 'm8_rocket') return false;
      const need = n > 0 ? n : 60;
      const cur = slot0.current ?? slot0.cap ?? 0;
      if (cur < need) return false;
      slot0.current = cur - need;
      return true;
    }
    if (weaponCode === 'mg42' && u.hands) {
      if (u.def?.isTank) {
        if (handIndex !== undefined && u.hands[handIndex] && u.hands[handIndex].code === 'mg42') {
          const mg = u.hands[handIndex];
          if ((mg.reserve !== undefined ? mg.reserve : mg.current) > 0) {
            if (mg.reserve !== undefined) mg.reserve = Math.max(0, mg.reserve - 1);
            else if (mg.current > 0) mg.current--;
            return true;
          }
          return false;
        }
        const mgs = u.hands.filter(h => h && h.code === 'mg42' && (h.reserve !== undefined ? h.reserve > 0 : h.current > 0));
        for (let i = 0; i < n && mgs.length > 0; i++) {
          const mg = mgs.find(m => (m.reserve !== undefined ? m.reserve : m.current) > 0);
          if (!mg) break;
          if (mg.reserve !== undefined) mg.reserve = Math.max(0, mg.reserve - 1);
          else if (mg.current > 0) mg.current--;
        }
        return true;
      }
      const mg = u.hands.find(h => h && h.code === 'mg42');
      if (!mg) return false;
      for (let i = 0; i < n && mg.current > 0; i++) mg.current--;
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
      primarySlot.current--;
      return true;
    }
    return false;
  }

  getAttackWeapon(a, targetUnit) {
    const main = this.getVirtualWeapon(a);
    if (!main) return null;
    // 戦車がヘックス指定（範囲攻撃）のときは Main armament が M8 の場合のみ M8 を使用
    if (a.def?.isTank && !targetUnit) {
      const slot0 = a.hands && a.hands[0];
      if (slot0 && slot0.code === 'm8_rocket' && (slot0.current > 0 || slot0.cap > 0)) {
        return { ...slot0, current: slot0.current ?? slot0.cap, cap: slot0.cap };
      }
    }
    if (a.def.isTank && targetUnit && !targetUnit.def?.isTank) {
      const tankMgSlots = (a.hands || []).map((h, idx) => (h && h.code === 'mg42') ? { handIndex: idx, mg: h } : null).filter(Boolean);
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

  // --- HELPER METHODS ---

  /**
   * 指定武器が弾数撃ち分けUIの対象かどうかと、そのモード情報を返す。
   * 現状は BAR / M1A1 SMG / M2 Mortar のみ対象。
   * @param {Object} w - getVirtualWeapon / getAttackWeapon が返す武器オブジェクト
   * @returns {{ weaponCode: string, modes: number[] }|null}
   */
  getBurstSelectionConfigForWeapon(w) {
    if (!w || !w.code) return null;
    const supported = ['bar', 'thompson', 'm2_mortar'];
    if (supported.indexOf(w.code) === -1) return null;
    if (!Array.isArray(w.modes) || w.modes.length < 2) return null;
    return {
      weaponCode: w.code,
      modes: w.modes.slice()
    };
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
    const cfg = this.getBurstSelectionConfigForWeapon(w);
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
  getUnitInHex(q, r) { return this.units.find(u => u.q === q && u.r === r && u.hp > 0); }
  getUnit(q, r) { return this.getUnitInHex(q, r); }
  isValidHex(q, r) { return this.mapSystem ? this.mapSystem.isValidHex(q, r) : false; }
  hexDist(a, b) { return this.mapSystem ? this.mapSystem.hexDist(a, b) : 0; }
  getNeighbors(q, r) { return this.mapSystem ? this.mapSystem.getNeighbors(q, r) : []; }
  findPath(u, tq, tr) { return this.mapSystem ? this.mapSystem.findPath(u, tq, tr) : []; }

  calcAttackLine(u, tq, tr) {
    if (!this.mapSystem) return;
    if (u && u.hands && u.hands[0] && u.hands[0].code === 'm8_rocket') {
      this.attackLine = this.mapSystem.getHexesInRange(tq, tr, 2);
      return;
    }
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

  getSafeSpawnPos(team) {
    const cy = Math.floor(MAP_H / 2);
    for (let i = 0; i < 100; i++) {
      const q = Math.floor(Math.random() * MAP_W);
      const r = Math.floor(Math.random() * MAP_H);
      if (team === 'player' && r < cy) { continue; }
      if (team === 'enemy' && r >= cy) { continue; }
      if (this.isValidHex(q, r) && this.getUnitsInHex(q, r).length < 5 && this.map[q][r].id !== -1 && this.map[q][r].id !== 5) { return { q, r }; }
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
    if (this.state !== 'PLAY' && this.state !== 'ANIM') return;
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

  handleClick(p, pointerX, pointerY) {
    if (this.state !== 'PLAY' && this.state !== 'ANIM') return;
    if (this.interactionMode === 'SELECT') { this.clearSelection(); }
    else if (this.interactionMode === 'MOVE') {
      if (this.selectedUnit && this.isValidHex(p.q, p.r) && this.path.length > 0) {
        const last = this.path[this.path.length - 1];
        if (last.q === p.q && last.r === p.r) { this.actionMove(this.selectedUnit, this.path); this.setMode('SELECT'); }
      } else { this.setMode('SELECT'); }
    }
    else if (this.interactionMode === 'ATTACK') {
      if (this.selectedUnit) {
        const w = this.getVirtualWeapon(this.selectedUnit);
        const isIndirect = w && w.indirect;
        if (w && w.code === 'm8_rocket') {
          this.actionAttack(this.selectedUnit, p);
        } else if (isIndirect) {
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
        if (isReachable && targetUnits.length < 5) {
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
    let hit = (attacker.stats?.aim || 0) * 2 + (w.acc || 0) - (dist * (w.acc_drop || 5)) - terrainCover;
    const overRange = Math.max(0, dist - (w.rng || 0));
    hit -= overRange * (w.overRangePenalty ?? 15);
    if (targetUnit) {
      if (targetUnit.stance === 'prone') hit -= 20;
      if (targetUnit.stance === 'crouch') hit -= 10;
    } else if (w.area) {
      hit += 20;
    }

    // ATTACK MODE で弾数撃ち分けを指定済みなら、概算命中率にも反映
    const overrideInfo = (this.attackBurstOverride &&
      this.attackBurstOverride.unitId === attacker.id &&
      this.attackBurstOverride.weaponCode === w.code) ? this.attackBurstOverride : null;
    if (overrideInfo) {
      const cfg = this.getBurstSelectionConfigForWeapon(w);
      if (cfg && cfg.modes && cfg.modes.length >= 2) {
        const maxMode = Math.max.apply(null, cfg.modes);
        if (overrideInfo.shots >= maxMode) {
          hit -= 5;
        }
      }
    }
    hit = Math.max(0, Math.min(100, Math.round(hit)));
    return { hit, isArea: !!w.area && !targetUnit };
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

  calcReachableHexes(u) {
    this.reachableHexes = []; if (!u) return;
    let frontier = [{ q: u.q, r: u.r, cost: 0 }], costSoFar = new Map(); costSoFar.set(`${u.q},${u.r}`, 0);
    while (frontier.length > 0) {
      let current = frontier.shift();
      this.getNeighbors(current.q, current.r).forEach(n => {
        if (this.getUnitsInHex(n.q, n.r).length >= 4) { return; }
        const cost = this.map[n.q][n.r].cost; if (cost >= 99) { return; }
        const nc = costSoFar.get(`${current.q},${current.r}`) + cost;
        if (nc <= u.ap) {
          const key = `${n.q},${n.r}`;
          if (!costSoFar.has(key) || nc < costSoFar.get(key)) { costSoFar.set(key, nc); frontier.push({ q: n.q, r: n.r }); this.reachableHexes.push({ q: n.q, r: n.r }); }
        }
      });
    }
  }

  setStance(s) {
    const u = this.selectedUnit; if (!u || u.def.isTank) return;
    if (u.stance === s) return;
    let cost = 0; if (u.stance === 'prone' && (s === 'stand' || s === 'crouch')) { cost = 1; }
    if (u.ap < cost) { this.ui.log("AP不足"); return; }
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

    if (src.type === 'main') u.hands[srcIdx] = item2; else u.bag[srcIdx] = item2;
    if (tgt.type === 'main') u.hands[tgtIdx] = item1; else u.bag[tgtIdx] = item1;

    this.updateSidebar();
    if (u === this.selectedUnit) this.ui.refreshCommandMenuState(u);
    if (window.Sfx) Sfx.play('click');
    this.ui.log(`${u.name} 装備変更`);
  }

  moveWeaponToDeck(src) {
    const u = this.selectedUnit;
    if (!u) return;
    const idx = src.type === 'main' ? src.index : src.index;
    const item = src.type === 'main' ? u.hands[idx] : u.bag[idx];
    if (!item || !item.code || !WPNS[item.code] || WPNS[item.code].attr !== ATTR.WEAPON) return;
    // ユニットからは取り外し、弾数などの状態を保持したままカード化する
    if (src.type === 'main') u.hands[idx] = null; else u.bag[idx] = null;
    if (typeof Renderer !== 'undefined' && Renderer.dealCard) {
      Renderer.dealCard({ type: item.code, weaponData: item });
    }
    this.updateSidebar();
    if (window.Sfx) Sfx.play('click');
    this.ui.log(`${u.name} 装備解除: ${item.name}`);
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
      if (!WPNS[weaponCode] || WPNS[weaponCode].attr !== ATTR.WEAPON) return;
      base = WPNS[weaponCode];
      // 従来どおりの「新品」生成パス
      newItem = { ...base, code: weaponCode, id: Math.random(), isBroken: false };
      if (base.type === 'bullet' || base.type === 'shell_fast') newItem.current = newItem.cap;
      else if (base.type === 'shell' || base.area) { newItem.current = 1; newItem.isConsumable = true; }
      else if (base.type === 'ammo') newItem.current = base.current || base.cap;
      if (u.def && u.def.isTank && !base.type.includes('part') && !base.type.includes('ammo')) {
        newItem.current = 1; newItem.cap = 1;
        newItem.reserve = newItem.reserve || (weaponCode === 'mg42' ? 300 : 12);
      }
    } else if (weaponSource && weaponSource.code && WPNS[weaponSource.code] && WPNS[weaponSource.code].attr === ATTR.WEAPON) {
      // 実インスタンスから装備（弾数などの状態を保持）
      newItem = weaponSource;
      base = WPNS[newItem.code];
    } else {
      return;
    }

    const tgtIdx = slotTarget.type === 'main' ? slotTarget.index : slotTarget.index;
    const oldItem = slotTarget.type === 'main' ? u.hands[tgtIdx] : u.bag[tgtIdx];
    if (slotTarget.type === 'main') u.hands[tgtIdx] = newItem; else u.bag[tgtIdx] = newItem;

    // 既にそのスロットにあった武器は、状態を保持したままデッキへ送る
    if (oldItem && oldItem.code && WPNS[oldItem.code] && WPNS[oldItem.code].attr === ATTR.WEAPON && typeof Renderer !== 'undefined' && Renderer.dealCard) {
      Renderer.dealCard({ type: oldItem.code, weaponData: oldItem });
    }
    this.updateSidebar();
    if (window.Sfx) Sfx.play('click');
    this.ui.log(`${u.name} 装備: ${newItem.name}`);
  }

  toggleFireMode() {
    const u = this.selectedUnit;
    if (!u || !u.hands || !Array.isArray(u.hands)) return;
    const slot0 = u.hands[0];
    if (slot0 && slot0.modes) {
      const modes = slot0.modes;
      const currentBurst = slot0.burst;
      let nextIndex = modes.indexOf(currentBurst) + 1;
      if (nextIndex >= modes.length) nextIndex = 0;
      slot0.burst = modes[nextIndex];
      if (window.Sfx) Sfx.play('click');
      this.updateSidebar();
    }
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
    if (u.ap < cost) { this.ui.log("AP不足"); return; }

    const magIndex = u.bag.findIndex(i => i && i.type === 'ammo' && i.ammoFor === w.code);
    if (magIndex === -1) { this.ui.log("予備弾なし"); return; }

    u.bag[magIndex] = null;
    u.ap -= cost;
    const primarySlot = u.hands[0];
    if (primarySlot && primarySlot.code === w.code) {
      primarySlot.current = primarySlot.cap;
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
    const slot0 = u.hands?.[0];
    if (!slot0 || !slot0.isBroken) return;
    u.ap -= 2;
    slot0.isBroken = false;
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
    this.ui.log(`${u.name} が ${target.name} を治療`);
    if (window.VFX) { const p = Renderer.hexToPx(u.q, u.r); window.VFX.add({ x: p.x, y: p.y - 20, vx: 0, vy: -1, life: 30, maxLife: 30, color: "#0f0", size: 4, type: 'spark' }); }
    this.refreshUnitState(u);
    this.ui.hideActionMenu();
  }

  async actionMelee(a, d) {
    if (!a || a.ap < 2) return;
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
    await new Promise(r => setTimeout(r, 300));
    let strVal = (a.stats && a.stats.str) ? a.stats.str : 0;
    let totalDmg = 10 + (strVal * 3) + bonusDmg;
    if (d.skills && d.skills.includes('CQC')) { this.ui.log(`>> カウンター！`); this.applyDamage(a, 15, "カウンター"); }
    if (window.Sfx) Sfx.play('hit');
    this.applyDamage(d, totalDmg, "白兵");
    this.refreshUnitState(a);
    this.checkPhaseEnd();
  }

  toggleAuto() { this.isAuto = !this.isAuto; const b = document.getElementById('auto-toggle'); if(b) b.classList.toggle('active'); if(this.isAuto && this.state==='PLAY') this.runAuto(); }
  async runAuto() { if(this.state!=='PLAY') return; this.ui.log(":: Auto ::"); this.clearSelection(); this.isAutoProcessing = true; await this.ai.execute(this.units, 'player'); this.isAutoProcessing = false; if(this.state==='WIN') return; if(this.isAuto && this.state==='PLAY') this.endTurn(); }
  async actionMove(u, p) { this.state = 'ANIM'; const stepMs = (this.isAuto || this.isAutoProcessing) ? 60 : 180; for(let s of p){u.ap-=this.map[s.q][s.r].cost; u.q=s.q; u.r=s.r; if(window.Sfx) Sfx.play('move'); await new Promise(r => setTimeout(r, stepMs)); } this.checkReactionFire(u); this.state = 'PLAY'; this.refreshUnitState(u); this.checkPhaseEnd(); }
  checkReactionFire(u) { this.units.filter(e => e.team !== u.team && e.hp > 0 && e.def.isTank && this.hexDist(u, e) <= 1).forEach(t => { this.ui.log("防御射撃"); this.applyDamage(u, 15, "防御"); if(window.VFX) VFX.addExplosion(Renderer.hexToPx(u.q, u.r).x, Renderer.hexToPx(u.q, u.r).y, "#fa0", 5); }); }
  checkPhaseEnd() { if (this.units.filter(u => u.team === 'player' && u.hp > 0 && u.ap > 0).length === 0 && this.state === 'PLAY') { this.endTurn(); } }

  // --- UTILS ---
  checkDeploy(targetHex) {
    if(!this.isValidHex(targetHex.q, targetHex.r) || this.map[targetHex.q][targetHex.r].id === -1) return false;
    if(this.map[targetHex.q][targetHex.r].id === 5) return false;
    if (this.getUnitsInHex(targetHex.q, targetHex.r).length >= 5) return false;
    if (this.cardsUsed >= 2) return false;
    return true;
  }

  deployUnit(targetHex, cardType, fusionData, portraitIndex, fusionCount) {
    if(!this.checkDeploy(targetHex)) { return; }
    const u = this.campaign.createSoldier(cardType, 'player', fusionData, portraitIndex, undefined, fusionCount);
    if(u) {
      u.q = targetHex.q; u.r = targetHex.r;
      this.units.push(u); this.cardsUsed++;
      this.ui.log(`増援到着: ${u.name}`);
      if(window.VFX) { const pos = Renderer.hexToPx(targetHex.q, targetHex.r); window.VFX.addSmoke(pos.x, pos.y); }
      this.updateSidebar();
    }
  }

  async triggerM8Rocket(attacker, centerHex) {
    if (!this.isValidHex(centerHex.q, centerHex.r)) return;
    const game = this;
    const pool = this.mapSystem ? this.mapSystem.getHexesInRange(centerHex.q, centerHex.r, 2) : [centerHex];
    const validPool = pool.filter(h => this.isValidHex(h.q, h.r));
    if (validPool.length === 0) return;
    const hitHexes = [];
    for (let i = 0; i < 60; i++) {
      hitHexes.push(validPool[Math.floor(Math.random() * validPool.length)]);
    }
    const tankPos = typeof Renderer !== 'undefined' ? Renderer.hexToPx(attacker.q, attacker.r) : { x: 0, y: 0 };
    const dmg = 45;
    this.ui.log(`>> M8 Rocket 斉射`);
    for (let i = 0; i < hitHexes.length; i++) {
      const hex = hitHexes[i];
      const targetPos = typeof Renderer !== 'undefined' ? Renderer.hexToPx(hex.q, hex.r) : { x: 0, y: 0 };
      const delay = i * 55;
      setTimeout(() => {
        if (!game.consumeAmmo(attacker, 'm8_rocket', 1)) return;
        game.updateSidebar();
        if (window.VFX) {
          window.VFX.addRocket(tankPos.x, tankPos.y, targetPos.x, targetPos.y, () => {
            if (window.Sfx) Sfx.play('cannon');
            if (typeof Renderer !== 'undefined') Renderer.playExplosion(targetPos.x, targetPos.y);
            if (window.VFX) { window.VFX.addSmoke(targetPos.x, targetPos.y); window.VFX.shakeRequest = 3; }
            const units = game.getUnitsInHex(hex.q, hex.r);
            units.forEach(u => { game.ui.log(`>> ロケット命中`); game.applyDamage(u, dmg, "M8 Rocket"); });
            game.updateSidebar();
          });
        }
      }, delay);
    }
    await new Promise(r => setTimeout(r, hitHexes.length * 55 + 550));
  }

  async triggerBombardment(centerHex) {
    if (!this.isValidHex(centerHex.q, centerHex.r)) return;
    this.ui.log(`>> 航空支援要請`);
    const neighbors = this.getNeighbors(centerHex.q, centerHex.r);
    const hits = []; const pool = [centerHex, ...neighbors].filter(h => this.isValidHex(h.q, h.r));
    for (let i = 0; i < 3; i++) { if (pool.length === 0) break; const idx = Math.floor(Math.random() * pool.length); hits.push(pool[idx]); pool.splice(idx, 1); }
    for (const hex of hits) {
      const pos = Renderer.hexToPx(hex.q, hex.r);
      setTimeout(() => {
        if (window.Sfx) { Sfx.play('cannon'); }
        if (typeof Renderer !== 'undefined') { Renderer.playExplosion(pos.x, pos.y); }
        const units = this.getUnitsInHex(hex.q, hex.r);
        units.forEach(u => { this.ui.log(`>> 爆撃命中`); this.applyDamage(u, 350, "爆撃"); });
        this.updateSidebar();
        if (window.VFX) { VFX.addSmoke(pos.x, pos.y); }
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

/** LOGIC AI: Enemy behavior (hands は常に3スロット配列を前提) */

class EnemyAI {
  constructor(game) {
    this.game = game;
  }

  /** ウェーブ内で既に誰が狙っているか */
  _targetClaimCount(claims, targetId) {
    return claims.get(targetId) || 0;
  }

  _claimTarget(claims, targetId) {
    claims.set(targetId, (claims.get(targetId) || 0) + 1);
  }

  /**
   * 戦雲戦術が有効ならクラスタを保ちつつ1歩、なければ敵へ最短
   */
  pickMoveStep(actor, units, team, combatTarget) {
    if (window.BattleCloudTactics && typeof window.BattleCloudTactics.pickCloudMoveStep === 'function') {
      const cloudStep = window.BattleCloudTactics.pickCloudMoveStep(
        actor, this.game, units, team, combatTarget
      );
      if (cloudStep) return cloudStep;
    }
    if (!combatTarget) return null;
    const path = this.game.findPath(actor, combatTarget.q, combatTarget.r);
    return path.length > 0 ? path[0] : null;
  }

  /**
   * 兵士ごとに距離・被弾・目立ち度・重複回避でターゲットを選ぶ。
   */
  pickStrategicTarget(actor, units, targetTeam, claims) {
    const targets = units.filter(u => u.team === targetTeam && u.hp > 0);
    if (targets.length === 0) return null;

    const w = this.game.getVirtualWeapon(actor);
    const preferSoft = w && w.type === 'bullet' && !w.type.includes('shell');
    let best = null;
    let bestScore = -99999;

    targets.forEach(t => {
      const dist = this.game.hexDist(actor, t);
      const minRng = w ? (w.minRng || 0) : 0;
      const maxRng = w ? w.rng : 1;
      let score = 0;

      score += Math.max(0, 42 - dist * 4.5);
      if (dist >= minRng && dist <= maxRng) score += 38;
      else if (dist > maxRng) score -= 28;
      else if (dist < minRng) score -= 15;

      const hpRatio = t.hp / Math.max(1, t.maxHp);
      score += (1 - hpRatio) * 50;

      const mapRow = this.game.map[t.q] && this.game.map[t.q][t.r];
      const cover = mapRow ? (mapRow.cover || 0) : 0;
      score += Math.max(0, 28 - cover);

      const alliesNear = units.filter(u =>
        u.team === targetTeam && u.hp > 0 && u.id !== t.id && this.game.hexDist(u, t) <= 2
      ).length;
      if (alliesNear >= 3) score += 14;
      if (alliesNear === 0) score += 10;

      if (window.BattleCloud && typeof window.BattleCloud.getIntensity === 'function') {
        const cloudI = window.BattleCloud.getIntensity(t);
        if (cloudI > 0.15) score += 10 + cloudI * 22;
      }

      if (t.def?.isTank) score += preferSoft ? -90 : 45;
      else if (preferSoft) score += 12;

      if (t.stance === 'stand') score += 6;
      else if (t.stance === 'crouch') score += 3;

      const claimsOn = this._targetClaimCount(claims, t.id);
      score -= claimsOn * 26;

      score += (Math.random() - 0.5) * 22;
      score += (actor.id % 97) * 0.03;

      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    });

    if (best) this._claimTarget(claims, best.id);
    return best;
  }

  /** 残弾が少ないときは発射数を抑える */
  getConservativeMaxShots(actor, w) {
    if (!w) return 1;
    const burst = w.burst || 1;
    const ratio = this.game.getMagazineRatio(actor, w);
    const spare = this.game.countCompatibleSpareMags(actor, w);
    const lowTh = (typeof BATTLE_SCALE !== 'undefined' && BATTLE_SCALE.RT_LOW_AMMO_RATIO) || 0.35;

    if (ratio > 0.55 && spare >= 2) return burst;
    if (ratio > lowTh) return Math.max(1, Math.ceil(burst * 0.7));
    if (ratio > 0.12 || spare >= 1) return Math.max(1, Math.ceil(burst * 0.45));
    return 1;
  }

  async _staggeredRun(tasks, cfg) {
    const minD = cfg.RT_STAGGER_MIN_MS || 90;
    const maxD = cfg.RT_STAGGER_MAX_MS || 480;
    const shuffled = tasks.slice().sort(() => Math.random() - 0.5);
    await Promise.all(shuffled.map((task, i) => {
      const delay = minD + Math.random() * (maxD - minD) + i * 12;
      return new Promise(async (resolve) => {
        await new Promise(r => setTimeout(r, delay));
        try {
          await task();
        } catch (e) {
          console.warn('AI stagger task:', e);
        }
        resolve();
      });
    }));
  }

  async execute(units, team) {
    const cfg = (typeof BATTLE_SCALE !== 'undefined') ? BATTLE_SCALE : {};
    if (cfg.RT_SIMULTANEOUS_AI) {
      return this.executeSimultaneous(units, team);
    }
    return this.executeSequential(units, team);
  }

  async executeSimultaneous(units, team) {
    const actors = units.filter(u => u.team === team && u.hp > 0);
    const targetTeam = (team === 'player') ? 'enemy' : 'player';
    const cfg = (typeof BATTLE_SCALE !== 'undefined') ? BATTLE_SCALE : {};
    const waves = cfg.RT_AI_WAVES || 5;
    const waveGap = cfg.RT_WAVE_GAP_MS || 35;
    const parallel = { parallel: true };

    actors.forEach(a => { a._aiSwaps = 0; });
    if (team === 'enemy') {
      actors.forEach(a => { a.ap = a.maxAp; });
    }

    const shuffledActors = actors.slice().sort(() => Math.random() - 0.5);

    for (let wave = 0; wave < waves; wave++) {
      if (this.game.state === 'WIN' || this.game._victoryProcessed) break;
      let anyActed = false;
      const targetClaims = new Map();

      await this._staggeredRun(shuffledActors.map(actor => async () => {
        if (actor.hp <= 0) return;
        const t = this.pickStrategicTarget(actor, units, targetTeam, targetClaims);
        if (t) await this.optimizeWeapon(actor, t);
      }), cfg);

      const attackTasks = [];
      for (const actor of shuffledActors) {
        if (actor.hp <= 0 || actor.ap <= 0) continue;

        const target = this.pickStrategicTarget(actor, units, targetTeam, targetClaims);
        if (!target || target.hp <= 0) continue;

        let w = this.game.getVirtualWeapon(actor);
        const dist = this.game.hexDist(actor, target);
        const minRng = w ? (w.minRng || 0) : 0;

        if (dist === 0 && actor.ap >= 2) {
          attackTasks.push(() => this.game.actionMelee(actor, target, parallel));
          anyActed = true;
          continue;
        }

        if (w && (w.current === undefined || w.current <= 0)) {
          if (!this.trySwitchToWeaponWithAmmo(actor)) {
            this.game.tryAutoReloadWeapon(actor, { silent: true });
          }
          w = this.game.getVirtualWeapon(actor);
        }

        const canShoot = w && w.current > 0 && dist >= minRng && dist <= w.rng && actor.ap >= w.ap;
        if (canShoot) {
          const maxShots = this.getConservativeMaxShots(actor, w);
          attackTasks.push(() => this.game.actionAttack(actor, target, { parallel: true, maxShots }));
          anyActed = true;
        }
      }

      if (attackTasks.length > 0) {
        await this._staggeredRun(attackTasks, cfg);
        anyActed = true;
      }

      const moveTasks = [];
      const moveClaims = new Map();
      for (const actor of shuffledActors) {
        if (actor.hp <= 0 || actor.ap < 1) continue;
        const target = this.pickStrategicTarget(actor, units, targetTeam, moveClaims);
        if (!target) continue;
        const next = this.pickMoveStep(actor, units, team, target);
        if (!next) continue;
        const cost = this.game.getTerrainMoveCost ? this.game.getTerrainMoveCost(actor, next.q, next.r) : this.game.map[next.q][next.r].cost;
        if (actor.ap >= cost) {
          moveTasks.push(() => this.game.actionMove(actor, [next], parallel));
          anyActed = true;
        }
      }

      if (moveTasks.length > 0) {
        await this._staggeredRun(moveTasks, cfg);
      }

      if (!anyActed) break;
      await new Promise(r => setTimeout(r, waveGap));
    }
  }

  async executeSequential(units, team) {
    const actors = units.filter(u => u.team === team && u.hp > 0);
    const targetTeam = (team === 'player') ? 'enemy' : 'player';

    for (let actor of actors) {
      if (actor.hp <= 0) continue;
      actor._aiSwaps = 0;
      if (team === 'enemy') actor.ap = actor.maxAp;

      const targets = units.filter(u => u.team === targetTeam && u.hp > 0);
      if (targets.length === 0) break;

      const claims = new Map();
      let target = this.pickStrategicTarget(actor, units, targetTeam, claims);
      if (!target) continue;
      await this.optimizeWeapon(actor, target);

      let acted = true;
      let loopCount = 0;
      let attackCount = 0;
      const watchAuto = this.game.isAuto || this.game.isAutoProcessing;
      const maxAttacks = (team === 'player' && watchAuto)
        ? ((typeof BATTLE_SCALE !== 'undefined' && BATTLE_SCALE.AUTO_ATTACKS_PER_ACTOR) || 3)
        : (team === 'enemy' && watchAuto)
          ? ((typeof BATTLE_SCALE !== 'undefined' && BATTLE_SCALE.ENEMY_ATTACKS_IN_AUTO) || 2)
          : 1;
      const maxLoops = watchAuto ? 12 : 5;
      const actorDelay = watchAuto ? 8 : 30;

      while (acted && actor.ap > 0 && loopCount < maxLoops) {
        acted = false;
        loopCount++;
        if (actor.hp <= 0) break;
        if (!target || target.hp <= 0) {
          const c2 = new Map();
          target = this.pickStrategicTarget(actor, units, targetTeam, c2);
          if (!target) break;
        }
        if (attackCount >= maxAttacks) break;

        let w = this.game.getVirtualWeapon(actor);
        const dist = this.game.hexDist(actor, target);
        const minRng = w ? (w.minRng || 0) : 0;
        const canShoot = w && w.current > 0 && dist >= minRng && dist <= w.rng && actor.ap >= w.ap;

        if (dist === 0 && actor.ap >= 2) {
          await this.game.actionMelee(actor, target);
          acted = true;
          attackCount++;
          if (target.hp <= 0) break;
          continue;
        }

        if (canShoot) {
          const maxShots = this.getConservativeMaxShots(actor, w);
          await this.game.actionAttack(actor, target, { maxShots });
          acted = true;
          attackCount++;
          if (target.hp <= 0) break;
          continue;
        }

        if (w && (w.current === undefined || w.current <= 0)) {
          const switched = this.trySwitchToWeaponWithAmmo(actor);
          if (switched) {
            acted = true;
            await new Promise(r => setTimeout(r, 50));
            continue;
          }
        }

        if (w && (w.current === undefined || w.current <= 0)) {
          if (this.game.tryAutoReloadWeapon(actor, { silent: true })) {
            acted = true;
            await new Promise(r => setTimeout(r, 40));
            continue;
          }
        }

        if (actor.ap >= 1) {
          const next = this.pickMoveStep(actor, units, team, target);
          if (next) {
            const cost = this.game.getTerrainMoveCost ? this.game.getTerrainMoveCost(actor, next.q, next.r) : this.game.map[next.q][next.r].cost;
            if (actor.ap >= cost) {
              await this.game.actionMove(actor, [next]);
              acted = true;
              await new Promise(r => setTimeout(r, actorDelay));
              continue;
            }
          }
        }
      }
      await new Promise(r => setTimeout(r, actorDelay));
    }
  }

  async optimizeWeapon(actor, target) {
    if (!actor.hands || !Array.isArray(actor.hands)) return;
    if ((actor._aiSwaps || 0) >= 1) return; // 対物/対人の持ち替えは1ターン1回まで（乱発防止）

    const currentWpn = this.game.getVirtualWeapon(actor);
    if (!currentWpn) return;

    const isTargetHard = target.def?.isTank;
    let bestSlotIndex = -1;

    if (isTargetHard && currentWpn.type === 'bullet') {
      bestSlotIndex = actor.bag.findIndex(item => item && item.type && (item.type.includes('shell') || item.type === 'rocket'));
    } else if (!isTargetHard && currentWpn.type && (currentWpn.type.includes('shell') || currentWpn.type === 'rocket')) {
      bestSlotIndex = actor.bag.findIndex(item => item && item.type === 'bullet');
    }

    if (bestSlotIndex !== -1) {
      this.game.swapEquipment({ type: 'main', index: 0 }, { type: 'bag', index: bestSlotIndex }, actor);
      actor._aiSwaps = (actor._aiSwaps || 0) + 1;
      if (window.Sfx) window.Sfx.play('swap');
      await new Promise(r => setTimeout(r, 50));
    }
  }

  trySwitchToWeaponWithAmmo(actor) {
    if (!actor.hands || !Array.isArray(actor.hands) || actor.hands.length < 3) return false;
    const game = this.game;
    const attrWeapon = typeof ATTR !== 'undefined' ? ATTR.WEAPON : 'Weaponry';

    // 候補は副作用なしで評価する（swap→確認→戻す の破壊的プローブ禁止 — NORTH_STAR §7.3）。
    // 弾薬 current/reserve はアイテム自身が保持しているため、構えなくても判定できる。
    const isReadyWeapon = (item) => {
      if (!item || !item.code || item.type === 'part') return false;
      const master = (typeof WPNS !== 'undefined') ? WPNS[item.code] : null;
      if (master && master.attr !== attrWeapon) return false;
      if (!master && item.attr !== attrWeapon) return false;
      return (item.current || 0) > 0 || (item.reserve || 0) > 0;
    };

    const doSwap = (srcType, srcIndex) => {
      game.swapEquipment({ type: 'main', index: 0 }, { type: srcType, index: srcIndex }, actor);
      const w = game.getVirtualWeapon(actor);
      if (w && ((w.current || 0) > 0 || (w.reserve || 0) > 0)) {
        if (window.Sfx) window.Sfx.play('swap');
        return true;
      }
      // 構えてみたら撃てない特殊ケース（enrich 依存）のみ戻す
      game.swapEquipment({ type: 'main', index: 0 }, { type: srcType, index: srcIndex }, actor);
      return false;
    };

    for (let i = 0; actor.bag && i < actor.bag.length; i++) {
      if (isReadyWeapon(actor.bag[i]) && doSwap('bag', i)) return true;
    }
    for (let idx of [1, 2]) {
      if (isReadyWeapon(actor.hands[idx]) && doSwap('main', idx)) return true;
    }
    return false;
  }

  async executeTurn(units) {
    return this.execute(units, 'enemy');
  }
}

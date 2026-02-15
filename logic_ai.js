/** LOGIC AI: Enemy behavior (hands は常に3スロット配列を前提) */

class EnemyAI {
  constructor(game) {
    this.game = game;
  }

  async execute(units, team) {
    const actors = units.filter(u => u.team === team && u.hp > 0);
    const targetTeam = (team === 'player') ? 'enemy' : 'player';

    for (let actor of actors) {
      if (actor.hp <= 0) continue;
      if (team === 'enemy') actor.ap = actor.maxAp;

      const targets = units.filter(u => u.team === targetTeam && u.hp > 0);
      if (targets.length === 0) break;

      const w = this.game.getVirtualWeapon(actor) || (actor.hands?.[1]?.code === 'mg42' ? actor.hands[1] : null);
      const preferSoft = w && w.type === 'bullet' && !w.type.includes('shell');
      let target = targets[0];
      let bestScore = -9999;
      targets.forEach(t => {
        const dist = this.game.hexDist(actor, t);
        const inRange = w && dist >= (w.minRng || 0) && dist <= w.rng;
        let score = -dist * 2 - t.hp;
        if (preferSoft && !t.def?.isTank) score += 200;
        if (inRange) score += 100;
        if (score > bestScore) { bestScore = score; target = t; }
      });
      await this.optimizeWeapon(actor, target);

      let w = this.game.getVirtualWeapon(actor);

      let acted = true;
      let loopCount = 0;
      let hasAttacked = false;

      while (acted && actor.ap > 0 && loopCount < 5) {
        acted = false;
        loopCount++;
        if (actor.hp <= 0 || target.hp <= 0) break;
        if (hasAttacked) break;

        w = this.game.getVirtualWeapon(actor);
        const dist = this.game.hexDist(actor, target);
        const minRng = w ? (w.minRng || 0) : 0;
        const canShoot = w && w.current > 0 && dist >= minRng && dist <= w.rng && actor.ap >= w.ap;

        // 同一ヘックスで白兵可能
        if (dist === 0 && actor.ap >= 2) {
          await this.game.actionMelee(actor, target);
          acted = true;
          hasAttacked = true;
          if (target.hp <= 0) break;
          continue;
        }

        // 射撃可能なら射撃（弾あり）
        if (canShoot) {
          await this.game.actionAttack(actor, target);
          acted = true;
          hasAttacked = true;
          if (target.hp <= 0) break;
          continue;
        }

        // 弾切れ時はリロード試行（成功したら次ループで射撃）
        if (w && w.current <= 0 && (actor.def.isTank || !w.code.includes('mortar'))) {
          this.game.reloadWeapon(actor, false);
          await new Promise(r => setTimeout(r, 50));
          w = this.game.getVirtualWeapon(actor);
          if (w && w.current > 0) { acted = true; continue; }
        }

        // 武器なし・弾切れ・射程外: 移動（接近 or 退却）または隣接時は次のターンで白兵するため接近
        if (actor.ap >= 1) {
          const path = this.game.findPath(actor, target.q, target.r);
          if (path.length > 0) {
            const next = path[0];
            const cost = this.game.map[next.q][next.r].cost;
            if (actor.ap >= cost) {
              await this.game.actionMove(actor, [next]);
              acted = true;
              await new Promise(r => setTimeout(r, 30));
              continue;
            }
          }
        }
      }
      await new Promise(r => setTimeout(r, 30));
    }
  }

  /**
   * ターゲットに応じて最適な武器に持ち替える。
   * hands は常に3スロット配列 [slot0, slot1, slot2] を前提。
   */
  async optimizeWeapon(actor, target) {
    if (!actor.hands || !Array.isArray(actor.hands)) return;

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
      if (window.Sfx) window.Sfx.play('swap');
      await new Promise(r => setTimeout(r, 50));
    }
  }

  async executeTurn(units) {
    return this.execute(units, 'enemy');
  }
}

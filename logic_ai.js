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

      let target = targets[0];
      let minDist = 9999;
      targets.forEach(t => {
        const d = this.game.hexDist(actor, t);
        if (d < minDist) { minDist = d; target = t; }
      });

      await this.optimizeWeapon(actor, target);

      let w = this.game.getVirtualWeapon(actor);
      if (!w) continue;

      let acted = true;
      let loopCount = 0;
      let hasAttacked = false;

      while (acted && actor.ap > 0 && loopCount < 5) {
        acted = false;
        loopCount++;

        if (actor.hp <= 0 || target.hp <= 0) break;
        if (hasAttacked) break;

        const dist = this.game.hexDist(actor, target);

        // 射程内攻撃 (迫撃砲対応)
        const minRng = w.minRng || 0;
        if (dist >= minRng && dist <= w.rng && actor.ap >= w.ap) {
          if (w.current <= 0) {
            // リロード試行（actor を明示的に渡す）
            if (actor.def.isTank || !w.code.includes('mortar')) {
              this.game.reloadWeapon(actor, false);
              await new Promise(r => setTimeout(r, 200));
              w = this.game.getVirtualWeapon(actor);
              if (w.current <= 0) continue;
            } else {
              // 迫撃砲弾切れなら何もしない
              break;
            }
          }

          if (w.current > 0) {
            await this.game.actionAttack(actor, target);
            acted = true;
            hasAttacked = true;
            if (target.hp <= 0) break;
            continue;
          }
        }

        // 移動
        if ((dist > w.rng || dist < minRng) && actor.ap >= 1) {
          const path = this.game.findPath(actor, target.q, target.r);
          if (path.length > 0) {
            const next = path[0];
            const cost = this.game.map[next.q][next.r].cost;
            if (actor.ap >= cost) {
              await this.game.actionMove(actor, [next]);
              acted = true;
              await new Promise(r => setTimeout(r, 100));
              continue;
            }
          }
        }
      }
      await new Promise(r => setTimeout(r, 100));
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
      await new Promise(r => setTimeout(r, 200));
    }
  }

  async executeTurn(units) {
    return this.execute(units, 'enemy');
  }
}

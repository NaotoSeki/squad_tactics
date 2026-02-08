/** LOGIC AI: Mortar & 3-Slot Support */

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

            // ★修正: 仮想武器取得
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

                // 射程内攻撃
                // 迫撃砲の最短射程も考慮
                const minRng = w.minRng || 0;
                if (dist >= minRng && dist <= w.rng && actor.ap >= w.ap) {
                    
                    // 迫撃砲の弾切れチェックなどは省略（敵は無限弾想定）
                    // プレイヤーAIの場合は弾切れで止まる可能性があるが、今回は簡易実装

                    await this.game.actionAttack(actor, target);
                    acted = true;
                    hasAttacked = true;
                    if (target.hp <= 0) break; 
                    continue;
                }

                // 移動
                if ((dist > w.rng || dist < minRng) && actor.ap >= 1) {
                    // 逃げる動きはまだないので、近づくのみ
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
    
    // optimizeWeaponは3スロット化で複雑になったため、一旦無効化（迫撃砲AIは持ち替えしない）
    async optimizeWeapon(actor, target) {}

    async executeTurn(units) {
        return this.execute(units, 'enemy');
    }
}

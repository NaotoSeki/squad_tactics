/** LOGIC AI: Restricted to Single Attack per Turn */

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

            let w = actor.hands;
            if (!w) continue;

            // --- 行動ループ ---
            let acted = true;
            let loopCount = 0;
            let hasAttacked = false; // ★追加: 攻撃済みフラグ

            while (acted && actor.ap > 0 && loopCount < 5) {
                acted = false;
                loopCount++;
                
                if (actor.hp <= 0 || target.hp <= 0) break;
                // ★追加: 既に攻撃済みなら行動終了 (移動もしない)
                if (hasAttacked) break;

                const dist = this.game.hexDist(actor, target);

                // 1. 射程内なら攻撃
                if (dist <= w.rng && actor.ap >= w.ap) {
                    if (w.current <= 0 || (actor.def.isTank && w.reserve > 0 && w.current === 0)) {
                        const cost = (actor.def.isTank) ? 1 : (w.rld || 1);
                        if (actor.ap >= cost) {
                            await this.game.reloadWeapon(false); 
                            await new Promise(r => setTimeout(r, 600)); 
                            continue; 
                        }
                    }

                    if (w.current > 0 || (actor.def.isTank && w.reserve > 0)) {
                        await this.game.actionAttack(actor, target);
                        acted = true;
                        hasAttacked = true; // ★フラグON: これでループを抜ける
                        
                        await new Promise(r => setTimeout(r, 800));
                        continue;
                    }
                }

                // 2. 射程外なら移動
                if (dist > w.rng && actor.ap >= 1) {
                    const path = this.game.findPath(actor, target.q, target.r);
                    if (path.length > 0) {
                        const next = path[0];
                        const cost = this.game.map[next.q][next.r].cost;
                        
                        if (actor.ap >= cost) {
                            await this.game.actionMove(actor, [next]);
                            acted = true;
                            await new Promise(r => setTimeout(r, 400));
                            continue; 
                        }
                    }
                }
            }
            
            await new Promise(r => setTimeout(r, 200));
        }
    }

    async optimizeWeapon(actor, target) {
        if (!actor.hands) return;
        const currentWpn = actor.hands;
        const isTargetHard = target.def.isTank;
        let bestSlotIndex = -1;

        if (isTargetHard && currentWpn.type === 'bullet') {
            bestSlotIndex = actor.bag.findIndex(item => item && (item.type.includes('shell') || item.type === 'rocket'));
        }
        else if (!isTargetHard && (currentWpn.type.includes('shell') || currentWpn.type === 'rocket')) {
            bestSlotIndex = actor.bag.findIndex(item => item && item.type === 'bullet');
        }

        if (bestSlotIndex !== -1) {
            const newWpn = actor.bag[bestSlotIndex];
            this.game.log(`${actor.name} 武装切替: ${currentWpn.name} -> ${newWpn.name}`);
            this.game.swapEquipment({type:'main'}, {type:'bag', index: bestSlotIndex});
            if (window.Sfx) window.Sfx.play('swap');
            await new Promise(r => setTimeout(r, 800));
        }
    }

    async executeTurn(units) {
        return this.execute(units, 'enemy');
    }
}

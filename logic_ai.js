/** LOGIC AI: Fast Paced & Smart Weapon Switching */

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

            let acted = true;
            let loopCount = 0;
            let hasAttacked = false;

            while (acted && actor.ap > 0 && loopCount < 5) {
                acted = false;
                loopCount++;
                
                if (actor.hp <= 0 || target.hp <= 0) break;
                if (hasAttacked) break; // 1ターン1攻撃制限

                const dist = this.game.hexDist(actor, target);

                // 1. 射程内なら攻撃
                if (dist <= w.rng && actor.ap >= w.ap) {
                    if (w.current <= 0 || (actor.def.isTank && w.reserve > 0 && w.current === 0)) {
                        const cost = (actor.def.isTank) ? 1 : (w.rld || 1);
                        if (actor.ap >= cost) {
                            await this.game.reloadWeapon(false); 
                            // リロードは一瞬のタメを入れるが、以前より短く
                            await new Promise(r => setTimeout(r, 200)); 
                            continue; 
                        }
                    }

                    if (w.current > 0 || (actor.def.isTank && w.reserve > 0)) {
                        await this.game.actionAttack(actor, target);
                        acted = true;
                        hasAttacked = true;
                        // ★修正: 攻撃後のウェイトを削除 (アニメーション完了待ちのみ)
                        if (target.hp <= 0) break; 
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
                            // 移動後のウェイトも最小限に
                            await new Promise(r => setTimeout(r, 100));
                            continue; 
                        }
                    }
                }
            }
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
            // const newWpn = actor.bag[bestSlotIndex];
            // this.game.log(`${actor.name} 武装切替`); // ログ削減でテンポアップ
            this.game.swapEquipment({type:'main'}, {type:'bag', index: bestSlotIndex});
            if (window.Sfx) window.Sfx.play('swap');
            await new Promise(r => setTimeout(r, 300)); // 持ち替え時間も短縮
        }
    }

    async executeTurn(units) {
        return this.execute(units, 'enemy');
    }
}

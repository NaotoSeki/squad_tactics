/** LOGIC AI: Smart Weapon Switching & Paced Actions */

class EnemyAI {
    constructor(game) {
        this.game = game;
    }

    async execute(units, team) {
        const actors = units.filter(u => u.team === team && u.hp > 0);
        const targetTeam = (team === 'player') ? 'enemy' : 'player';

        for (let actor of actors) {
            if (actor.hp <= 0) continue;

            // 敵AIのみAPリセット
            if (team === 'enemy') actor.ap = actor.maxAp;

            // ターゲット選定
            const targets = units.filter(u => u.team === targetTeam && u.hp > 0);
            if (targets.length === 0) break; 

            // 最寄りの敵を探す
            let target = targets[0]; 
            let minDist = 9999; 
            targets.forEach(t => { 
                const d = this.game.hexDist(actor, t); 
                if (d < minDist) { minDist = d; target = t; } 
            });

            // --- ★AI思考: 武器の最適化 (対戦車/対歩兵 スイッチ) ---
            await this.optimizeWeapon(actor, target);

            let w = actor.hands;
            if (!w) continue;

            // --- 行動ループ ---
            let acted = true;
            // 安全策: 無限ループ防止のため最大行動回数を制限
            let loopCount = 0;
            
            while (acted && actor.ap > 0 && loopCount < 5) {
                acted = false;
                loopCount++;
                
                if (actor.hp <= 0 || target.hp <= 0) break;

                const dist = this.game.hexDist(actor, target);

                // 1. 射程内なら攻撃
                if (dist <= w.rng && actor.ap >= w.ap) {
                    // 弾切れチェック & リロード
                    if (w.current <= 0 || (actor.def.isTank && w.reserve > 0 && w.current === 0)) {
                        const cost = (actor.def.isTank) ? 1 : (w.rld || 1);
                        if (actor.ap >= cost) {
                            await this.game.reloadWeapon(false); 
                            await new Promise(r => setTimeout(r, 600)); // リロードのタメ
                            continue; 
                        }
                    }

                    // 攻撃実行
                    if (w.current > 0 || (actor.def.isTank && w.reserve > 0)) {
                        await this.game.actionAttack(actor, target);
                        acted = true;
                        
                        // ★重要: 連続攻撃の間隔を空ける (これで「2回攻撃？」の違和感を解消)
                        await new Promise(r => setTimeout(r, 1000));
                        
                        // ターゲット死亡確認
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
                            // 移動後のタメ
                            await new Promise(r => setTimeout(r, 500));
                            continue; 
                        }
                    }
                }
            }
            
            // 次のユニットへ移る前のウェイト
            await new Promise(r => setTimeout(r, 200));
        }
    }

    // 武器持ち替えロジック
    async optimizeWeapon(actor, target) {
        if (!actor.hands) return;

        const currentWpn = actor.hands;
        const isTargetHard = target.def.isTank; // 相手は戦車か？
        
        let bestSlotIndex = -1;

        // A. 相手が戦車なのに、小火器(bullet)を持っている場合 -> 重火器(shell/rocket)を探す
        if (isTargetHard && currentWpn.type === 'bullet') {
            bestSlotIndex = actor.bag.findIndex(item => item && (item.type.includes('shell') || item.type === 'rocket'));
        }
        // B. 相手が歩兵なのに、重火器(shell)を持っている場合 -> 小火器(bullet)を探す (弾の節約 & 命中率)
        else if (!isTargetHard && (currentWpn.type.includes('shell') || currentWpn.type === 'rocket')) {
            bestSlotIndex = actor.bag.findIndex(item => item && item.type === 'bullet');
        }

        // 持ち替え実行
        if (bestSlotIndex !== -1) {
            // UIログ用
            const newWpn = actor.bag[bestSlotIndex];
            this.game.log(`${actor.name} 武装切替: ${currentWpn.name} -> ${newWpn.name}`);
            
            // 装備交換 (LogicGameのメソッドを借用)
            this.game.swapEquipment({type:'main'}, {type:'bag', index: bestSlotIndex});
            
            // 持ち替え演出のウェイト
            if (window.Sfx) window.Sfx.play('swap');
            await new Promise(r => setTimeout(r, 800));
        }
    }

    // 後方互換
    async executeTurn(units) {
        return this.execute(units, 'enemy');
    }
}

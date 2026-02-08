/** LOGIC AI: Generic AI for both Enemy and Player (Auto Mode) */

class EnemyAI {
    constructor(game) {
        this.game = game;
    }

    // 汎用AI実行メソッド (team: 'enemy' | 'player')
    async execute(units, team) {
        // 行動可能な自軍ユニット
        const actors = units.filter(u => u.team === team && u.hp > 0);
        const targetTeam = (team === 'player') ? 'enemy' : 'player';

        for (let actor of actors) {
            if (actor.hp <= 0) continue;

            // 敵の場合のみAPをリセット（プレイヤーは現在のAPで行動する）
            if (team === 'enemy') actor.ap = actor.maxAp;

            // ターゲット選定（最も近い敵）
            const targets = units.filter(u => u.team === targetTeam && u.hp > 0);
            if (targets.length === 0) break; 

            let target = targets[0]; 
            let minDist = 9999; 
            targets.forEach(t => { 
                const d = this.game.hexDist(actor, t); 
                if (d < minDist) { minDist = d; target = t; } 
            });

            const w = actor.hands;
            if (!w) continue;

            // --- 行動ループ ---
            let acted = true;
            while (acted && actor.ap > 0) {
                acted = false;
                if (actor.hp <= 0 || target.hp <= 0) break;

                const dist = this.game.hexDist(actor, target);

                // 1. 射程内でAPがあれば攻撃
                if (dist <= w.rng && actor.ap >= w.ap) {
                    // 弾切れならリロード（APがあれば）
                    if (w.current <= 0 || (actor.def.isTank && w.reserve > 0 && w.current === 0)) {
                        const cost = (actor.def.isTank) ? 1 : (w.rld || 1);
                        if (actor.ap >= cost) {
                            await this.game.reloadWeapon(false); 
                            continue; // リロードできたので攻撃へ戻る
                        }
                    }

                    // 弾があれば攻撃
                    if (w.current > 0 || (actor.def.isTank && w.reserve > 0)) {
                        await this.game.actionAttack(actor, target);
                        acted = true;
                        await new Promise(r => setTimeout(r, 300));
                        // 敵が死んだらターゲット再取得（簡易的）
                        if (target.hp <= 0) break; 
                        continue;
                    }
                }

                // 2. 射程外なら移動 (1歩ずつ)
                if (dist > w.rng && actor.ap >= 1) {
                    const path = this.game.findPath(actor, target.q, target.r);
                    if (path.length > 0) {
                        const next = path[0];
                        const cost = this.game.map[next.q][next.r].cost;
                        
                        if (actor.ap >= cost) {
                            await this.game.actionMove(actor, [next]); // 1マス移動
                            acted = true;
                            // 移動後、再度攻撃チャンスがあるかチェックするためにループ
                            continue; 
                        }
                    }
                }
            }
            
            // ユニットごとのウェイト
            await new Promise(r => setTimeout(r, 100));
        }
    }

    // 後方互換用（敵ターンの呼び出し）
    async executeTurn(units) {
        return this.execute(units, 'enemy');
    }
}

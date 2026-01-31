// ==========================================
// 2. ENEMY AI (Decision Making)
// ==========================================
class EnemyAI {
    constructor(game) {
        this.game = game;
    }

    async executeTurn(units) {
        const es = units.filter(u => u.team === 'enemy' && u.hp > 0);
        
        for (let e of es) {
            const ps = units.filter(u => u.team === 'player' && u.hp > 0);
            if (ps.length === 0) break; // Player wiped out

            // Target Selection (Nearest)
            let target = ps[0]; 
            let minDist = 999; 
            ps.forEach(p => { 
                const d = this.game.hexDist(e, p); 
                if (d < minDist) { minDist = d; target = p; } 
            });

            e.ap = e.maxAp; 
            const w = e.hands; 
            if (!w) continue; 

            // Simple Aggressive AI
            const distToTarget = this.game.hexDist(e, target);
            if (distToTarget <= w.rng && e.ap >= w.ap) { 
                await this.game.actionAttack(e, target); 
            } else {
                const p = this.game.findPath(e, target.q, target.r);
                if (p.length > 0) {
                    const next = p[0]; 
                    if (this.game.map[next.q][next.r].cost <= e.ap) { 
                        // Move
                        e.q = next.q; e.r = next.r; 
                        e.ap -= this.game.map[next.q][next.r].cost; 
                        await new Promise(r => setTimeout(r, 200)); 
                        // Try Attack after move
                        if (this.game.hexDist(e, target) <= w.rng && e.ap >= w.ap) { 
                            await this.game.actionAttack(e, target); 
                        } 
                    }
                }
            }
        }
    }
}

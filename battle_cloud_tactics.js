/**
 * 戦雲を意識した行動判断（味方・敵共通）
 */
(function () {
    'use strict';

    function hexKey(q, r) { return `${q},${r}`; }

    function findClusterForUnit(unit, clusters) {
        if (!unit || !clusters) return null;
        const k = hexKey(unit.q, unit.r);
        for (let i = 0; i < clusters.length; i++) {
            const cl = clusters[i];
            if (cl.team === unit.team && cl.hexes.has(k)) return cl;
        }
        return null;
    }

    function clusterCentroidHex(cluster, game) {
        if (!cluster || !cluster.hexes.size) return null;
        let sq = 0;
        let sr = 0;
        let n = 0;
        cluster.hexes.forEach(k => {
            const parts = k.split(',');
            sq += parseInt(parts[0], 10);
            sr += parseInt(parts[1], 10);
            n++;
        });
        return { q: Math.round(sq / n), r: Math.round(sr / n) };
    }

    function alliesInCluster(cluster, units) {
        return units.filter(u =>
            u.team === cluster.team && u.hp > 0 && cluster.hexes.has(hexKey(u.q, u.r))
        );
    }

    function nearestBridgeForUnit(unit, bridges) {
        if (!bridges || !bridges.length) return null;
        const uk = hexKey(unit.q, unit.r);
        let best = null;
        let bestD = Infinity;
        bridges.forEach(br => {
            if (br.team !== unit.team) return;
            [br.hexA, br.hexB, br.bridgeHex].forEach(hk => {
                const parts = hk.split(',');
                const d = Math.abs(parseInt(parts[0], 10) - unit.q) + Math.abs(parseInt(parts[1], 10) - unit.r);
                if (d < bestD) {
                    bestD = d;
                    best = br;
                }
            });
        });
        return bestD <= 4 ? best : null;
    }

    function decidePosture(actor, cluster, game, units, team, combatTarget) {
        const shape = cluster.shapeType || 'balanced';
        const allies = alliesInCluster(cluster, units);
        const avgHp = allies.length
            ? allies.reduce((s, u) => s + u.hp / Math.max(1, u.maxHp), 0) / allies.length
            : 1;
        const selfHp = actor.hp / Math.max(1, actor.maxHp);
        const cell = game.map[actor.q] && game.map[actor.q][actor.r];
        const cover = cell ? (cell.cover || 0) : 0;

        const enemyTeam = team === 'player' ? 'enemy' : 'player';
        let rangedThreats = 0;
        units.forEach(u => {
            if (u.team !== enemyTeam || u.hp <= 0) return;
            const d = game.hexDist(actor, u);
            const w = game.getVirtualWeapon(u);
            if (w && d <= (w.rng || 1) && d >= (w.minRng || 0)) rangedThreats++;
        });

        const clusters = game._battleCloudClusters || [];
        const bridges = (window.BattleCloud && window.BattleCloud.findOneHexBridges)
            ? window.BattleCloud.findOneHexBridges(clusters.filter(c => c.team === team))
            : [];
        if (nearestBridgeForUnit(actor, bridges)) return 'BRIDGE';

        if ((selfHp < 0.38 || avgHp < 0.42) && cover < 22) return 'DISPERSE';
        if (rangedThreats >= 2 && cover < 18 && shape !== 'compact') return 'DISPERSE';
        if (rangedThreats >= 3 && cover < 30) return 'DISPERSE';

        const cen = clusterCentroidHex(cluster, game);
        if (!combatTarget || !cen) return 'HOLD_CLOUD';

        const distCenToEnemy = game.hexDist(
            { q: cen.q, r: cen.r },
            { q: combatTarget.q, r: combatTarget.r }
        );
        const w = game.getVirtualWeapon(actor);
        const actorDist = game.hexDist(actor, combatTarget);
        const inRange = w && actorDist >= (w.minRng || 0) && actorDist <= (w.rng || 1);

        if (inRange && cover >= 15) return 'HOLD_CLOUD';
        if (distCenToEnemy > 6) {
            return shape === 'elongated' ? 'ADVANCE_LINE' : 'ADVANCE_BLOB';
        }
        if (distCenToEnemy > 3 && !inRange) {
            return shape === 'elongated' ? 'ADVANCE_LINE' : 'ADVANCE_BLOB';
        }
        return 'HOLD_CLOUD';
    }

    function scoreAlongAxis(hex, cluster, towardTarget) {
        const sh = cluster.shape;
        if (!sh || !sh.axisA || !sh.axisB) return 0;
        const dq = sh.axisB.q - sh.axisA.q;
        const dr = sh.axisB.r - sh.axisA.r;
        const len = Math.hypot(dq, dr) || 1;
        const ux = dq / len;
        const ur = dr / len;
        const vx = towardTarget.q - hex.q;
        const vr = towardTarget.r - hex.r;
        const dot = vx * ux + vr * ur;
        return dot * 4.5;
    }

    function scoreMoveHex(actor, hex, posture, cluster, game, units, team, combatTarget) {
        let score = 0;
        const hk = hexKey(hex.q, hex.r);
        const cohesion = (cluster.shape && cluster.shape.cohesion) || 1;

        const adjCluster = game.getNeighbors(hex.q, hex.r).filter(n =>
            cluster.hexes.has(hexKey(n.q, n.r))
        ).length;

        const occupiers = game.getUnitsInHex(hex.q, hex.r).length;
        const cell = game.map[hex.q] && game.map[hex.q][hex.r];
        const cover = cell ? (cell.cover || 0) : 0;
        const terrainCost = game.getTerrainMoveCost
            ? game.getTerrainMoveCost(actor, hex.q, hex.r)
            : (cell ? cell.cost : 1);

        const cen = clusterCentroidHex(cluster, game);

        switch (posture) {
            case 'BRIDGE': {
                const clusters = game._battleCloudClusters || [];
                const bridges = window.BattleCloud.findOneHexBridges(
                    clusters.filter(c => c.team === team)
                );
                const br = nearestBridgeForUnit(actor, bridges);
                if (br) {
                    const parts = br.bridgeHex.split(',');
                    const bq = parseInt(parts[0], 10);
                    const br_ = parseInt(parts[1], 10);
                    score += Math.max(0, 50 - game.hexDist(hex, { q: bq, r: br_ }) * 14);
                }
                score += adjCluster * 8;
                break;
            }
            case 'DISPERSE':
                score += cover * 0.55;
                score += (cell && cell.id === 2) ? 12 : 0;
                score += (cell && cell.id === 4) ? 8 : 0;
                score -= occupiers * 18;
                if (cen) score += game.hexDist(hex, cen) * 2.2;
                score -= adjCluster * 4;
                if (combatTarget) {
                    const d = game.hexDist(hex, combatTarget);
                    if (d < 3) score -= 20;
                }
                break;
            case 'ADVANCE_LINE':
                if (combatTarget) {
                    score += Math.max(0, 44 - game.hexDist(hex, combatTarget) * 4.8);
                    score += scoreAlongAxis(hex, cluster, combatTarget);
                }
                score += adjCluster * (5 * cohesion);
                score -= Math.abs(adjCluster - 2) * 2;
                break;
            case 'ADVANCE_BLOB':
                if (combatTarget) {
                    score += Math.max(0, 42 - game.hexDist(hex, combatTarget) * 4.5);
                }
                if (cen) score += Math.max(0, 18 - game.hexDist(hex, cen) * 2.5);
                score += adjCluster * (11 * cohesion);
                break;
            case 'HOLD_CLOUD':
            default:
                score += adjCluster * (13 * cohesion);
                if (cen) score += Math.max(0, 14 - game.hexDist(hex, cen) * 2);
                score += cover * 0.2;
                if (combatTarget) {
                    const d = game.hexDist(hex, combatTarget);
                    const w = game.getVirtualWeapon(actor);
                    if (w && d >= (w.minRng || 0) && d <= (w.rng || 1)) score += 16;
                }
                break;
        }

        if (posture !== 'DISPERSE') {
            score -= terrainCost * 2.5;
            if (terrainCost >= 2 && posture === 'ADVANCE_BLOB') score -= 5;
        }

        const cap = game.getHexUnitCap ? game.getHexUnitCap() : 5;
        const sameHexAllies = game.getUnitsInHex(hex.q, hex.r).filter(
            u => u.team === team && u.hp > 0 && u.id !== actor.id
        ).length;
        if ((posture === 'ADVANCE_BLOB' || posture === 'HOLD_CLOUD' || posture === 'BRIDGE')
            && sameHexAllies > 0 && occupiers < cap) {
            score += sameHexAllies * (8 * cohesion);
        }

        score -= Math.max(0, occupiers - 1) * 5;
        score += (Math.random() - 0.5) * 4;

        return score;
    }

    function getAdjacentReachable(actor, game) {
        game.calcReachableHexes(actor);
        const reach = game.reachableHexes || [];
        const out = [];
        reach.forEach(h => {
            if (h.q === actor.q && h.r === actor.r) return;
            if (game.hexDist(actor, h) !== 1) return;
            const cost = game.getTerrainMoveCost
                ? game.getTerrainMoveCost(actor, h.q, h.r)
                : 1;
            if (actor.ap >= cost) out.push(h);
        });
        return out;
    }

    function pickCloudMoveStep(actor, game, units, team, combatTarget) {
        if (!window.BattleCloud || !actor || actor.hp <= 0) return null;

        window.BattleCloud.computeAll(units);
        const list = game._battleCloudClusters || [];
        const cluster = findClusterForUnit(actor, list);
        if (!cluster || cluster.count < window.BattleCloud.START_COUNT) return null;

        const candidates = getAdjacentReachable(actor, game);
        if (!candidates.length) return null;

        const posture = decidePosture(actor, cluster, game, units, team, combatTarget);
        let best = null;
        let bestScore = -99999;

        candidates.forEach(hex => {
            const s = scoreMoveHex(actor, hex, posture, cluster, game, units, team, combatTarget);
            if (s > bestScore) {
                bestScore = s;
                best = hex;
            }
        });

        return best;
    }

    window.BattleCloudTactics = {
        findClusterForUnit,
        decidePosture,
        scoreMoveHex,
        pickCloudMoveStep
    };
})();

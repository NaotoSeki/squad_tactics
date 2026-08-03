/**
 * 戦雲（密集クラスタ）: 同一ヘックス上の重なり＋隣接ヘックス上の兵士を1つの塊として扱う。
 * 兵士数は「同一マス＋隣接マス」にいる全員でカウント。4名で発生、12名付近で最大化。
 *
 * 【2026-07-25 一時廃止】window.BATTLE_CLOUD_ENABLED = false。
 * 戦雲の外周グロー・ヘックス塗りが六角グリッドを画面上で強調しすぎ、PS由来の
 * 精緻な連続キャンバス（docs/PS_NATIVE_MAP_ASSEMBLER.md）と絵の意図が衝突するため。
 * computeAll() が描画・ダメージ乗数・AI戦術の共通上流なので、ここ一箇所で系全体を止める。
 * 復活は true に戻すだけ（他ファイルに条件分岐を撒いていない）。
 */
(function () {
    'use strict';

    // 一時廃止スイッチ。false = 戦雲の視覚・戦闘補正・AI戦術をすべて無効化。
    if (typeof window.BATTLE_CLOUD_ENABLED === 'undefined') {
        window.BATTLE_CLOUD_ENABLED = false;
    }

    const START_COUNT = 4;
    const MAX_COUNT = 12;
    const MAX_DAMAGE_REDUCTION = 0.52;
    /** 敵戦雲内の侵入者への被ダメ加算（最大 +58%） */
    const MAX_INTRUDER_DAMAGE_BONUS = 0.58;
    /** 戦雲内で攻撃側が被るダメージ低下（最大 -32%） */
    const MAX_INTRUDER_OUTGOING_PENALTY = 0.32;

    function hexKey(q, r) { return `${q},${r}`; }

    function neighbors(q, r) {
        if (window.gameLogic && typeof window.gameLogic.getNeighbors === 'function') {
            return window.gameLogic.getNeighbors(q, r);
        }
        return [
            { q: q + 1, r }, { q: q - 1, r }, { q, r: r + 1 },
            { q: q + 1, r: r - 1 }, { q: q - 1, r: r + 1 }, { q, r: r - 1 }
        ];
    }

    function unitsShareCloudHex(a, b) {
        if (a.q === b.q && a.r === b.r) return true;
        return neighbors(a.q, a.r).some(n => n.q === b.q && n.r === b.r);
    }

    function buildHexUnitCounts(clusterUnits) {
        const hexUnitCounts = new Map();
        clusterUnits.forEach(u => {
            const k = hexKey(u.q, u.r);
            hexUnitCounts.set(k, (hexUnitCounts.get(k) || 0) + 1);
        });
        return hexUnitCounts;
    }

    /**
     * ユニット隣接グラフでクラスタ化（同一ヘックス＝隣接、隣接ヘックス上の兵士も連結）
     */
    function computeClustersForTeam(units, team) {
        const alive = units.filter(u => u.team === team && u.hp > 0);
        if (alive.length < START_COUNT) return [];

        const unitVisited = new Set();
        const clusters = [];

        alive.forEach(startU => {
            if (unitVisited.has(startU.id)) return;

            const clusterUnits = [];
            const queue = [startU];
            unitVisited.add(startU.id);

            while (queue.length > 0) {
                const u = queue.shift();
                clusterUnits.push(u);
                alive.forEach(other => {
                    if (unitVisited.has(other.id)) return;
                    if (!unitsShareCloudHex(u, other)) return;
                    unitVisited.add(other.id);
                    queue.push(other);
                });
            }

            const count = clusterUnits.length;
            if (count < START_COUNT) return;

            const componentHexes = new Set(clusterUnits.map(u => hexKey(u.q, u.r)));
            const hexUnitCounts = buildHexUnitCounts(clusterUnits);

            const countIntensity = Math.min(1, Math.max(0,
                (count - START_COUNT) / Math.max(1, MAX_COUNT - START_COUNT)));
            const shape = computeClusterShape(componentHexes, count, hexUnitCounts);
            const density = computeDensityHeat(count, componentHexes.size, hexUnitCounts, shape);
            const intensity = Math.min(1, countIntensity * shape.defenseMult);
            const centroid = clusterCentroid(componentHexes);
            const contaminatedHexes = findContaminatedHexes(componentHexes, team, units);
            clusters.push({
                team, count, countIntensity, intensity, hexes: componentHexes,
                hexUnitCounts, units: clusterUnits, centroid,
                shapeType: shape.shapeType,
                shape: shape,
                density,
                contaminatedHexes
            });
        });

        return clusters;
    }

    function hexSize() {
        return (typeof HEX_SIZE !== 'undefined' ? HEX_SIZE : 54);
    }

    function hexCornerPx(q, r, cornerIdx, pad, outward) {
        const R = typeof window !== 'undefined' ? window.Renderer : null;
        if (!R || !R.hexToPx) return { x: 0, y: 0 };
        const c = R.hexToPx(q, r);
        const a = Math.PI / 180 * (90 + 60 * cornerIdx);
        const rad = hexSize() * pad + outward;
        return { x: c.x + rad * Math.cos(a), y: c.y + rad * Math.sin(a) };
    }

    const NEIGHBOR_DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

    /**
     * クラスタ外周の辺（隣接方向 s の外側＝境界）。共有辺は含めない。
     * 描画側で各辺を結合すれば閉じた輪郭になる。
     * @returns {Array<{q:number,r:number,s:number}>}
     */
    function buildPerimeterSegments(hexSet) {
        if (!hexSet || !hexSet.size) return [];
        const segs = [];
        hexSet.forEach(k => {
            const parts = k.split(',');
            const q = parseInt(parts[0], 10);
            const r = parseInt(parts[1], 10);
            for (let s = 0; s < 6; s++) {
                const nq = q + NEIGHBOR_DIRS[s][0];
                const nr = r + NEIGHBOR_DIRS[s][1];
                if (!hexSet.has(hexKey(nq, nr))) segs.push({ q, r, s });
            }
        });
        return segs;
    }

    function neighborDir(q, r, nq, nr) {
        for (let s = 0; s < 6; s++) {
            if (q + NEIGHBOR_DIRS[s][0] === nq && r + NEIGHBOR_DIRS[s][1] === nr) return s;
        }
        return -1;
    }

    /**
     * 同一チームの戦雲クラスタのうち、ちょうど1マス空いた隣接ペア（しずくの糸用）
     * @returns {Array<{team:string,hexA:string,hexB:string,bridgeHex:string,intensity:number}>}
     */
    function findOneHexBridges(clusters) {
        const bridges = [];
        const byTeam = {};
        clusters.forEach(cl => {
            if (!byTeam[cl.team]) byTeam[cl.team] = [];
            byTeam[cl.team].push(cl);
        });

        Object.keys(byTeam).forEach(team => {
            const list = byTeam[team];
            for (let i = 0; i < list.length; i++) {
                for (let j = i + 1; j < list.length; j++) {
                    const clA = list[i];
                    const clB = list[j];
                    let best = null;
                    let bestScore = Infinity;

                    clA.hexes.forEach(ka => {
                        const parts = ka.split(',');
                        const q1 = parseInt(parts[0], 10);
                        const r1 = parseInt(parts[1], 10);
                        neighbors(q1, r1).forEach(mid => {
                            const km = hexKey(mid.q, mid.r);
                            if (clA.hexes.has(km) || clB.hexes.has(km)) return;
                            neighbors(mid.q, mid.r).forEach(end => {
                                const kb = hexKey(end.q, end.r);
                                if (!clB.hexes.has(kb)) return;
                                const partsB = kb.split(',');
                                const q2 = parseInt(partsB[0], 10);
                                const r2 = parseInt(partsB[1], 10);
                                const score = Math.abs(q1 - q2) + Math.abs(r1 - r2);
                                if (score < bestScore) {
                                    bestScore = score;
                                    best = {
                                        team,
                                        hexA: ka,
                                        hexB: kb,
                                        bridgeHex: km,
                                        intensity: Math.min(clA.intensity, clB.intensity)
                                    };
                                }
                            });
                        });
                    });

                    if (best) bridges.push(best);
                }
            }
        });
        return bridges;
    }

    function perimeterEdgeMidpoint(q, r, towardQ, towardR, pad) {
        const s = neighborDir(q, r, towardQ, towardR);
        if (s < 0) return null;
        const c0 = (4 - s + 6) % 6;
        const c1 = (5 - s + 6) % 6;
        const p0 = hexCornerPx(q, r, c0, pad, 0);
        const p1 = hexCornerPx(q, r, c1, pad, 0);
        return { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    }

    /**
     * 人員÷占有ヘックス面積。面積が小さいほど heat↑（壁・凝集の「アツさ」）
     */
    function computeDensityHeat(unitCount, hexCount, hexUnitCounts, shape) {
        const area = Math.max(1, hexCount);
        const personnelPerHex = unitCount / area;
        let maxStack = 1;
        if (hexUnitCounts) {
            hexUnitCounts.forEach(c => { maxStack = Math.max(maxStack, c); });
        }

        const packRatio = Math.min(1, Math.max(0, (personnelPerHex - 1) / 3.5));
        const stackRatio = Math.min(1, Math.max(0, (maxStack - 1) / 5));
        let shapeRatio = 0.08;
        if (shape) {
            if (shape.shapeType === 'stack') shapeRatio = 0.38;
            else if (shape.shapeType === 'compact') shapeRatio = 0.28;
            else if (shape.shapeType === 'elongated') shapeRatio = 0.04;
            shapeRatio += Math.min(0.12, (shape.compactness || 0) * 0.15);
        }

        const heat = Math.min(1, packRatio * 0.42 + stackRatio * 0.38 + shapeRatio);
        return {
            heat,
            personnelPerHex,
            maxStack,
            hexArea: area,
            wallTier: heat >= 0.72 ? 3 : (heat >= 0.45 ? 2 : (heat >= 0.22 ? 1 : 0))
        };
    }

    function hexDistQR(q1, r1, q2, r2) {
        return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;
    }

    /**
     * 塊（compact）／細長（elongated）で防御倍率が変わる
     */
    function computeClusterShape(hexSet, unitCount, hexUnitCounts) {
        const coords = [];
        hexSet.forEach(k => {
            const parts = k.split(',');
            coords.push({ q: parseInt(parts[0], 10), r: parseInt(parts[1], 10) });
        });
        const n = coords.length;
        let maxStack = 1;
        if (hexUnitCounts) {
            hexUnitCounts.forEach(c => { maxStack = Math.max(maxStack, c); });
        }

        if (n === 1) {
            const stackT = Math.min(1, Math.max(0,
                (unitCount - START_COUNT) / Math.max(1, MAX_COUNT - START_COUNT)));
            const isStack = maxStack >= START_COUNT;
            return {
                shapeType: isStack ? 'stack' : 'compact',
                compactness: 1,
                elongation: 1,
                maxSpan: 0,
                defenseMult: isStack ? 1.08 + 0.14 * stackT : 1.1,
                cohesion: isStack ? 1.28 : 1.15,
                axisA: coords[0],
                axisB: coords[0],
                hexCount: 1,
                maxStack
            };
        }

        let maxSpan = 0;
        let axisA = coords[0];
        let axisB = coords[0];
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                const d = hexDistQR(coords[i].q, coords[i].r, coords[j].q, coords[j].r);
                if (d > maxSpan) {
                    maxSpan = d;
                    axisA = coords[i];
                    axisB = coords[j];
                }
            }
        }

        const perimeter = buildPerimeterSegments(hexSet).length;
        const compactness = (2 * n) / Math.max(perimeter, 1);

        const dq = axisB.q - axisA.q;
        const dr = axisB.r - axisA.r;
        let onAxis = 0;
        coords.forEach(c => {
            const cross = Math.abs((c.q - axisA.q) * dr - (c.r - axisA.r) * dq);
            if (cross <= 1.05) onAxis++;
        });
        const width = Math.max(1, onAxis > 0 ? n / onAxis : 1);
        const elongation = maxSpan / width;

        let shapeType = 'balanced';
        let defenseMult = 1.0;
        let cohesion = 1.0;

        if (compactness >= 0.5 && elongation < 2.15) {
            shapeType = 'compact';
            const t = Math.min(1, (compactness - 0.42) / 0.22);
            defenseMult = 1.0 + 0.16 * t;
            cohesion = 1.18;
        } else if (elongation >= 2.35 || (maxSpan >= 3 && compactness < 0.36)) {
            shapeType = 'elongated';
            const t = Math.min(1, (elongation - 2) / 2.5);
            defenseMult = 0.86 + 0.06 * (1 - t);
            cohesion = 0.72;
        } else {
            defenseMult = 0.96 + compactness * 0.08;
            cohesion = 0.95;
        }

        return {
            shapeType, compactness, elongation, maxSpan, defenseMult, cohesion,
            axisA, axisB, hexCount: n, maxStack
        };
    }

    function clusterCentroid(hexSet) {
        let sx = 0;
        let sy = 0;
        let n = 0;
        hexSet.forEach(k => {
            const parts = k.split(',');
            const p = hexCornerPx(parseInt(parts[0], 10), parseInt(parts[1], 10), 0, 0.5, 0);
            const R = typeof window !== 'undefined' ? window.Renderer : null;
            if (R && R.hexToPx) {
                const c = R.hexToPx(parseInt(parts[0], 10), parseInt(parts[1], 10));
                sx += c.x;
                sy += c.y;
                n++;
            }
        });
        return n ? { x: sx / n, y: sy / n } : { x: 0, y: 0 };
    }

    function findContaminatedHexes(hexSet, clusterTeam, units) {
        const foe = clusterTeam === 'player' ? 'enemy' : 'player';
        const contaminated = new Set();
        hexSet.forEach(hk => {
            const parts = hk.split(',');
            const q = parseInt(parts[0], 10);
            const r = parseInt(parts[1], 10);
            const hasFoe = units.some(u => u.team === foe && u.hp > 0 && u.q === q && u.r === r);
            if (hasFoe) contaminated.add(hk);
        });
        return contaminated;
    }

    function assignIntruderPressure(units, clusters) {
        const map = new Map();
        units.forEach(u => {
            if (u.hp <= 0) return;
            let best = 0;
            clusters.forEach(cl => {
                if (cl.team === u.team) return;
                const hk = hexKey(u.q, u.r);
                if (!cl.hexes.has(hk)) return;
                best = Math.max(best, cl.intensity);
            });
            if (best > 0) map.set(u.id, best);
        });
        return map;
    }

    function assignUnitIntensity(units, clusters) {
        const map = new Map();
        units.forEach(u => {
            if (u.hp <= 0) return;
            let best = 0;
            clusters.forEach(cl => {
                if (cl.team !== u.team) return;
                const hk = hexKey(u.q, u.r);
                if (!cl.hexes.has(hk)) return;
                let i = cl.intensity;
                const stack = cl.hexUnitCounts && cl.hexUnitCounts.get(hk);
                if (stack >= 2) {
                    i = Math.min(1, i * (1 + 0.025 * Math.min(4, stack - 1)));
                }
                best = Math.max(best, i);
            });
            map.set(u.id, best);
        });
        return map;
    }

    window.BattleCloud = {
        START_COUNT,
        MAX_COUNT,
        buildPerimeterSegments,
        computeClusterShape,
        computeDensityHeat,
        findOneHexBridges,
        perimeterEdgeMidpoint,
        /** @deprecated use buildPerimeterSegments */
        buildPerimeterLoops: buildPerimeterSegments,

        /** ユニット配置・生死が変わったときだけ再計算するための指紋 */
        _fingerprint(units) {
            if (!units || !units.length) return '';
            const parts = [];
            units.forEach(u => {
                if (!u) return;
                parts.push(`${u.id}:${u.team}:${u.q},${u.r}:${u.hp > 0 ? 1 : 0}`);
            });
            parts.sort();
            return parts.join(';');
        },

        /** キャッシュを捨て、次回 computeAll で必ず再計算 */
        invalidate() {
            const gl = typeof window !== 'undefined' ? window.gameLogic : null;
            if (gl) gl._battleCloudFingerprint = null;
        },

        /**
         * 戦雲クラスタを返す（配置が変わるまでキャッシュ）
         * @param {Object} [opts] - { force: true } で強制再計算
         */
        computeAll(units, opts) {
            const force = !!(opts && opts.force);
            const gl = typeof window !== 'undefined' ? window.gameLogic : null;
            const fp = this._fingerprint(units);

            if (!force && gl && gl._battleCloudFingerprint === fp && gl._battleCloudClusters) {
                return gl._battleCloudClusters;
            }

            // 一時廃止中: 空クラスタを返す。下流は全て無害に縮退する
            // （描画=何も描かない / 各乗数=1.0 / AIは最短経路へフォールバック）。
            if (!window.BATTLE_CLOUD_ENABLED || !units || !units.length) {
                if (gl) {
                    gl._battleCloudUnitIntensity = new Map();
                    gl._battleCloudIntruderPressure = new Map();
                    gl._battleCloudClusters = [];
                    gl._battleCloudFingerprint = fp;
                }
                return [];
            }
            const all = [
                ...computeClustersForTeam(units, 'player'),
                ...computeClustersForTeam(units, 'enemy')
            ];

            const R = typeof window !== 'undefined' ? window.Renderer : null;
            if (R && R.hexToPx) {
                all.forEach(cl => {
                    let sx = 0;
                    let sy = 0;
                    let n = 0;
                    cl.hexes.forEach(k => {
                        const parts = k.split(',');
                        const p = R.hexToPx(parseInt(parts[0], 10), parseInt(parts[1], 10));
                        sx += p.x;
                        sy += p.y;
                        n++;
                    });
                    cl.centroidX = n ? sx / n : 0;
                    cl.centroidY = n ? sy / n : 0;
                });
            }

            if (gl) {
                gl._battleCloudUnitIntensity = assignUnitIntensity(units, all);
                gl._battleCloudIntruderPressure = assignIntruderPressure(units, all);
                gl._battleCloudClusters = all;
                gl._battleCloudFingerprint = fp;
            }
            return all;
        },

        getIntensity(unit) {
            if (!unit || !window.gameLogic) return 0;
            const gl = window.gameLogic;
            if (!gl._battleCloudUnitIntensity && gl.units && gl.units.length) {
                this.computeAll(gl.units);
            }
            if (!gl._battleCloudUnitIntensity) return 0;
            return gl._battleCloudUnitIntensity.get(unit.id) || 0;
        },

        /** 被ダメ倍率（1.0 = 通常、0.48 = 最大52%軽減） */
        getDefenseMultiplier(unit) {
            const i = this.getIntensity(unit);
            return 1 - i * MAX_DAMAGE_REDUCTION;
        },

        /** 敵戦雲オーラ内にいる侵入者の圧力 0〜1 */
        getIntruderPressure(unit) {
            if (!unit || !window.gameLogic) return 0;
            const gl = window.gameLogic;
            if (!gl._battleCloudIntruderPressure && gl.units && gl.units.length) {
                this.computeAll(gl.units);
            }
            if (!gl._battleCloudIntruderPressure) return 0;
            return gl._battleCloudIntruderPressure.get(unit.id) || 0;
        },

        /** 侵入者の被ダメ倍率（1.0 = 通常、最大 1.58） */
        getDamageTakenMultiplier(unit) {
            const p = this.getIntruderPressure(unit);
            return 1 + p * MAX_INTRUDER_DAMAGE_BONUS;
        },

        /** 戦雲内で攻撃する侵入者の与ダメ倍率 */
        getOutgoingDamageMultiplier(unit) {
            const p = this.getIntruderPressure(unit);
            return 1 - p * MAX_INTRUDER_OUTGOING_PENALTY;
        }
    };
})();

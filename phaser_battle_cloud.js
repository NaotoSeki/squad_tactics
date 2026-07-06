/** 戦雲: 外周辺を順繰り描画＋有機的揺れ・火花・1マス隙間の糸 */

class BattleCloudRenderer {
    constructor(scene) {
        this.scene = scene;
        this.hexGfx = scene.add.graphics().setDepth(20.5).setScrollFactor(1);
        this.glowGfx = scene.add.graphics().setDepth(21).setScrollFactor(1);
        this.lineGfx = scene.add.graphics().setDepth(22).setScrollFactor(1);
        this.sparkGfx = scene.add.graphics().setDepth(23).setScrollFactor(1);
        this.hexGfx.setBlendMode(Phaser.BlendModes.NORMAL);
        this.glowGfx.setBlendMode(Phaser.BlendModes.ADD);
        this.lineGfx.setBlendMode(Phaser.BlendModes.NORMAL);
        this.sparkGfx.setBlendMode(Phaser.BlendModes.ADD);
        this._clusterAnim = new Map();
        this._revealTotalMs = 300;
        this._revealEdgeMsMin = 14;
        this._revealEdgeMsMax = 32;
        this._bridgePhase = new Map();
        this._sparks = new Map();
    }

    clear() {
        this.hexGfx.clear();
        this.glowGfx.clear();
        this.lineGfx.clear();
        this.sparkGfx.clear();
    }

    _renderer() {
        return typeof window !== 'undefined' ? window.Renderer : null;
    }

    _hexSize() {
        return (typeof HEX_SIZE !== 'undefined' ? HEX_SIZE : 54);
    }

    _hexCorners(q, r, pad) {
        const R = this._renderer();
        if (!R || !R.hexToPx) return null;
        const c = R.hexToPx(q, r);
        const pts = [];
        for (let i = 0; i < 6; i++) {
            const a = Math.PI / 180 * (90 + 60 * i);
            const rad = this._hexSize() * pad;
            pts.push({ x: c.x + rad * Math.cos(a), y: c.y + rad * Math.sin(a) });
        }
        return pts;
    }

    _cornerKey(q, r, c) {
        return `${q},${r},${c}`;
    }

    _vkey(x, y) {
        return `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`;
    }

    _segKey(s) {
        return `${s.q},${s.r},${s.s}`;
    }

    _clusterKey(cl) {
        return `${cl.team}:[${[...cl.hexes].sort().join('|')}]`;
    }

    _ease(t) {
        return t * (2 - t);
    }

    _lerp(a, b, t) {
        return a + (b - a) * t;
    }

    _phaseHash(key) {
        let h = 0;
        for (let i = 0; i < key.length; i++) h = ((h << 5) - h + key.charCodeAt(i)) | 0;
        return ((h & 0xffff) / 0xffff) * Math.PI * 2;
    }

    _applyOrganicMotion(cornerMap, centroid, time, intensity, shapeType) {
        const t = time * 0.001;
        const shapeAmp = shapeType === 'elongated' ? 1.22
            : (shapeType === 'stack' ? 0.95 : (shapeType === 'compact' ? 0.82 : 1));
        const amp = this._hexSize() * (0.009 + intensity * 0.007) * shapeAmp;
        const rhythm = 0.65 + 0.35 * Math.sin(t * 1.05) + 0.2 * Math.sin(t * 1.9);
        const out = new Map();

        cornerMap.forEach((p, k) => {
            const ph = this._phaseHash(k);
            const s1 = Math.sin(t * 2.6 + ph);
            const s2 = Math.sin(t * 4.1 + ph * 1.6);
            const s3 = Math.sin(t * 6.8 + ph * 2.2) * 0.45;
            const wobble = (s1 * 0.55 + s2 * 0.35 + s3) * rhythm * amp;
            const ox = p.x - centroid.x;
            const oy = p.y - centroid.y;
            const len = Math.hypot(ox, oy) || 1;
            const nx = ox / len;
            const ny = oy / len;
            const breath = 0.5 + 0.5 * Math.sin(t * 1.35 + ph * 0.7);
            const radial = amp * 0.4 * breath * Math.sin(t * 1.75 + ph);
            out.set(k, {
                x: p.x + nx * (wobble + radial) + Math.sin(t * 1.1 + ph) * amp * 0.15,
                y: p.y + ny * (wobble + radial) + Math.cos(t * 1.25 + ph * 0.9) * amp * 0.15
            });
        });
        return out;
    }

    _sampleQuadratic(p0, p1, p2, steps) {
        const pts = [];
        for (let i = 0; i <= steps; i++) {
            const u = i / steps;
            const omu = 1 - u;
            pts.push({
                x: omu * omu * p0.x + 2 * omu * u * p1.x + u * u * p2.x,
                y: omu * omu * p0.y + 2 * omu * u * p1.y + u * u * p2.y
            });
        }
        return pts;
    }

    _buildSegments(hexSet) {
        if (window.BattleCloud && typeof window.BattleCloud.buildPerimeterSegments === 'function') {
            return window.BattleCloud.buildPerimeterSegments(hexSet);
        }
        return [];
    }

    _cornersMapFromSegments(segments, pad) {
        const map = new Map();
        segments.forEach(({ q, r, s }) => {
            const corners = this._hexCorners(q, r, pad);
            if (!corners) return;
            const c0 = (4 - s + 6) % 6;
            const c1 = (5 - s + 6) % 6;
            map.set(this._cornerKey(q, r, c0), { x: corners[c0].x, y: corners[c0].y });
            map.set(this._cornerKey(q, r, c1), { x: corners[c1].x, y: corners[c1].y });
        });
        return map;
    }

    _centroid(cornerMap) {
        let sx = 0;
        let sy = 0;
        let n = 0;
        cornerMap.forEach(p => {
            sx += p.x;
            sy += p.y;
            n++;
        });
        return n ? { x: sx / n, y: sy / n } : { x: 0, y: 0 };
    }

    /** 外周辺を輪郭に沿って1本の鎖状に並べる */
    _orderPerimeterEdges(segments) {
        if (!segments.length) return [];
        const items = segments.map(({ q, r, s }) => {
            const c0 = (4 - s + 6) % 6;
            const c1 = (5 - s + 6) % 6;
            return { q, r, s, k0: this._cornerKey(q, r, c0), k1: this._cornerKey(q, r, c1) };
        });
        if (items.length === 1) return items;

        const adj = new Map();
        const link = (k, ref) => {
            if (!adj.has(k)) adj.set(k, []);
            adj.get(k).push(ref);
        };
        items.forEach((item, idx) => {
            link(item.k0, { idx, other: item.k1 });
            link(item.k1, { idx, other: item.k0 });
        });

        const used = new Set();
        const ordered = [];
        let curKey = items[0].k0;
        used.add(0);
        ordered.push(items[0]);

        while (used.size < items.length) {
            const candidates = (adj.get(curKey) || []).filter(l => !used.has(l.idx));
            if (!candidates.length) {
                let nextIdx = -1;
                for (let i = 0; i < items.length; i++) {
                    if (!used.has(i)) { nextIdx = i; break; }
                }
                if (nextIdx < 0) break;
                used.add(nextIdx);
                ordered.push(items[nextIdx]);
                curKey = items[nextIdx].k1;
                continue;
            }
            const pick = candidates[0];
            used.add(pick.idx);
            ordered.push(items[pick.idx]);
            curKey = pick.other;
        }
        return ordered;
    }

    /** 形状変化時: 辺を順繰りサッと描いていく */
    _getEdgeReveal(clusterKey, segments, now) {
        const targetKey = segments.map(s => this._segKey(s)).sort().join(';');
        let st = this._clusterAnim.get(clusterKey);

        if (!st || st.targetKey !== targetKey) {
            const ordered = this._orderPerimeterEdges(segments);
            const edgeMs = Math.max(
                this._revealEdgeMsMin,
                Math.min(this._revealEdgeMsMax, this._revealTotalMs / Math.max(1, ordered.length))
            );
            st = { targetKey, morphStart: now, ordered, edgeMs };
            this._clusterAnim.set(clusterKey, st);
        }

        const n = st.ordered.length;
        if (!n) {
            return { ordered: [], fullEdges: 0, partialT: 1, done: true, progress: 1 };
        }

        const elapsed = now - st.morphStart;
        const done = elapsed >= st.edgeMs * n;
        const progress = done ? n : elapsed / st.edgeMs;
        const fullEdges = Math.min(n, Math.floor(progress));
        const partialT = done ? 1 : Math.min(1, progress - fullEdges);

        return {
            ordered: st.ordered,
            fullEdges,
            partialT,
            done,
            progress: done ? 1 : progress / n
        };
    }

    _collectEdgesFromOrdered(ordered, cornerMap, reveal) {
        const edges = [];
        const joints = new Map();
        const limit = reveal
            ? reveal.fullEdges + (reveal.partialT > 0 ? 1 : 0)
            : ordered.length;

        for (let i = 0; i < ordered.length && i < limit; i++) {
            const { q, r, s } = ordered[i];
            const c0 = (4 - s + 6) % 6;
            const c1 = (5 - s + 6) % 6;
            const p0 = cornerMap.get(this._cornerKey(q, r, c0));
            const p1 = cornerMap.get(this._cornerKey(q, r, c1));
            if (!p0 || !p1) continue;

            let end = p1;
            const isPartial = reveal && i === reveal.fullEdges && reveal.partialT < 1;
            if (isPartial) {
                const t = reveal.partialT;
                end = {
                    x: this._lerp(p0.x, p1.x, t),
                    y: this._lerp(p0.y, p1.y, t)
                };
            }

            const mx = (p0.x + end.x) * 0.5;
            const my = (p0.y + end.y) * 0.5;
            edges.push({
                p0, p1: end, mx, my,
                phase: this._phaseHash(`${q},${r},${s},${i}`),
                seg: { q, r, s }
            });
            joints.set(this._vkey(p0.x, p0.y), {
                x: p0.x, y: p0.y,
                phase: this._phaseHash(this._cornerKey(q, r, c0))
            });
            if (!isPartial) {
                joints.set(this._vkey(p1.x, p1.y), {
                    x: p1.x, y: p1.y,
                    phase: this._phaseHash(this._cornerKey(q, r, c1))
                });
            }
        }
        return { edges, joints };
    }

    _strokeSingleEdge(g, p0, p1, lineW, color, alpha) {
        if (alpha < 0.02 || lineW < 0.35) return;
        g.lineStyle(lineW, color, alpha);
        g.beginPath();
        g.moveTo(p0.x, p0.y);
        g.lineTo(p1.x, p1.y);
        g.strokePath();
    }

    /**
     * ★最適化: 同色・同幅・同アルファのセグメントをまとめて1回の lineStyle/strokePath で描画する。
     * items: [{ p0, p1, lineW, color, alpha }]
     * 見た目は _strokeSingleEdge を個別に呼んだ場合と同一（描画順のみグループ単位に変わる）。
     */
    _strokeEdgeBatch(g, items) {
        if (!items.length) return;
        const groups = new Map();
        const order = [];
        for (const it of items) {
            if (it.alpha < 0.02 || it.lineW < 0.35) continue;
            // 微小な浮動小数差は同一グループとして扱う（見た目に影響しない範囲で量子化）
            const key = (Math.round(it.lineW * 100) / 100) + '|' + it.color + '|' + (Math.round(it.alpha * 1000) / 1000);
            let g2 = groups.get(key);
            if (!g2) {
                g2 = { lineW: it.lineW, color: it.color, alpha: it.alpha, segs: [] };
                groups.set(key, g2);
                order.push(key);
            }
            g2.segs.push(it);
        }
        for (const key of order) {
            const grp = groups.get(key);
            g.lineStyle(grp.lineW, grp.color, grp.alpha);
            g.beginPath();
            for (const seg of grp.segs) {
                g.moveTo(seg.p0.x, seg.p0.y);
                g.lineTo(seg.p1.x, seg.p1.y);
            }
            g.strokePath();
        }
    }

    /**
     * ★最適化: 同色・同アルファの fillCircle をまとめて1回の fillStyle で描画する。
     * items: [{ x, y, r, alpha }]
     */
    _fillCircleBatch(g, color, items) {
        if (!items.length) return;
        const groups = new Map();
        const order = [];
        for (const it of items) {
            const key = (Math.round(it.alpha * 1000) / 1000);
            let g2 = groups.get(key);
            if (!g2) {
                g2 = { alpha: it.alpha, items: [] };
                groups.set(key, g2);
                order.push(key);
            }
            g2.items.push(it);
        }
        for (const key of order) {
            const grp = groups.get(key);
            g.fillStyle(color, grp.alpha);
            for (const it of grp.items) {
                g.fillCircle(it.x, it.y, it.r);
            }
        }
    }

    /**
     * 外周辺を描画（辺ごとに太さ・透明度が脈動する有機的オーラ）
     */
    _heatTint(team, heat) {
        if (heat < 0.35) return null;
        const warm = team === 'player' ? 0xffcc88 : 0xffaa66;
        const hot = 0xffeecc;
        return heat >= 0.7 ? hot : warm;
    }

    _flickerAlpha(time, phase, mx, my) {
        const t = time * 0.001;
        const erratic = 0.2 + 0.8 * (0.5 + 0.5 * Math.sin(t * 9.4 + phase * 2.3));
        const pulse = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 15.2 + mx * 0.04 + my * 0.03));
        const stutter = 0.5 + 0.5 * Math.sin(t * 22.7 + phase * 4.1);
        return Math.max(0.12, erratic * pulse * (0.65 + 0.35 * stutter));
    }

    _strokePerimeterEdges(ordered, cornerMap, intensity, team, pulse, time, shapeType, heat, reveal, contaminatedHexes) {
        if (!ordered.length) return null;

        const { edges, joints } = this._collectEdgesFromOrdered(ordered, cornerMap, reveal);
        if (!edges.length) return null;

        const h = heat || 0;
        const contaminated = contaminatedHexes || null;
        const palette = team === 'player'
            ? [0xa8c8e8, 0xd8eeff]
            : [0xe8c8a8, 0xffeedd];
        const color = palette[0];
        const hiColor = palette[1];
        const wallTint = this._heatTint(team, h);
        const shapeW = shapeType === 'stack' ? 0.5
            : (shapeType === 'compact' ? 0.35 : (shapeType === 'elongated' ? -0.15 : 0));
        const heatW = h * 0.55;
        const baseW = 2.2 + intensity * 1.4 + shapeW + heatW;
        const pulseA = (0.42 + intensity * 0.45 + pulse * 0.14) * (1 + h * 0.12);
        const t = time * 0.001;
        const rhythm = 0.7 + 0.3 * Math.sin(t * 1.15) + 0.15 * Math.sin(t * 2.05);

        // ★最適化: lineStyle切替を減らすため、glowGfx/lineGfx向けセグメントをまとめて収集し
        // 最後に色・幅・アルファごとにバッチ描画する（描画結果は従来と同一）
        const glowItems = [];
        const lineItems = [];

        edges.forEach(({ p0, p1, mx, my, phase, seg }) => {
            const swell = 0.82 + 0.18 * (0.5 + 0.5 * Math.sin(t * 2.9 + phase))
                + 0.08 * Math.sin(t * 5.5 + mx * 0.02 + my * 0.02);
            const edgeW = baseW * swell * rhythm;
            let edgeA = pulseA * (0.88 + 0.12 * Math.sin(t * 3.4 + phase * 1.2));
            let glowA = (0.06 + intensity * 0.09 + h * 0.07) * (0.75 + 0.25 * Math.sin(t * 2.2 + phase));
            let lineCol = hiColor;
            let glowCol = 0xffffff;

            const hk = seg ? `${seg.q},${seg.r}` : null;
            if (contaminated && hk && contaminated.has(hk)) {
                const flick = this._flickerAlpha(time, phase, mx, my);
                edgeA *= flick;
                glowA *= flick * 0.9;
                lineCol = team === 'player' ? 0xffaa88 : 0xff8866;
                glowCol = 0xffccaa;
            }

            glowItems.push({ p0, p1, lineW: edgeW + 5.5, color: glowCol, alpha: glowA });
            glowItems.push({ p0, p1, lineW: edgeW + 1.8, color: glowCol, alpha: glowA * 1.35 });
            if (wallTint && h >= 0.45 && !(contaminated && hk && contaminated.has(hk))) {
                glowItems.push({ p0, p1, lineW: edgeW + 2.2, color: wallTint, alpha: glowA * 0.45 * h });
            }
            lineItems.push({ p0, p1, lineW: edgeW + 0.8, color: color, alpha: edgeA * 0.5 });
            lineItems.push({ p0, p1, lineW: edgeW, color: lineCol, alpha: edgeA });
        });

        this._strokeEdgeBatch(this.glowGfx, glowItems);
        this._strokeEdgeBatch(this.lineGfx, lineItems);

        joints.forEach(({ x, y, phase }) => {
            const jr = Math.max(0.9, baseW * (0.32 + 0.1 * Math.sin(t * 3.1 + phase)));
            const ja = pulseA * (0.75 + 0.25 * Math.sin(t * 2.6 + phase));
            this.lineGfx.fillStyle(hiColor, ja);
            this.lineGfx.fillCircle(x, y, jr);
            if (wallTint && h >= 0.55) {
                this.glowGfx.fillStyle(wallTint, ja * 0.35 * h);
                this.glowGfx.fillCircle(x, y, jr + 1.5);
            }
        });

        return edges;
    }

    _sparkColors(team, heat) {
        if (team === 'player') {
            if (heat >= 0.75) return [0xffffff, 0xffeeaa, 0xa8d8ff];
            if (heat >= 0.45) return [0xd8eeff, 0xffddaa, 0xffffff];
            return [0xa8c8e8, 0xd8eeff];
        }
        if (heat >= 0.75) return [0xffffff, 0xffcc88, 0xffeedd];
        if (heat >= 0.45) return [0xffeedd, 0xffaa66, 0xffffff];
        return [0xe8c8a8, 0xffeedd];
    }

    _spawnSparkOnEdge(edge, centroid, team, heat, intensity) {
        const t = 0.08 + Math.random() * 0.84;
        const x = edge.p0.x + (edge.p1.x - edge.p0.x) * t;
        const y = edge.p0.y + (edge.p1.y - edge.p0.y) * t;
        const edx = edge.p1.x - edge.p0.x;
        const edy = edge.p1.y - edge.p0.y;
        const elen = Math.hypot(edx, edy) || 1;
        let nx = -edy / elen;
        let ny = edx / elen;
        const toInX = centroid.x - x;
        const toInY = centroid.y - y;
        if (nx * toInX + ny * toInY > 0) {
            nx = -nx;
            ny = -ny;
        }
        const spread = 0.35 + heat * 0.55;
        const ca = Math.cos((Math.random() - 0.5) * spread);
        const sa = Math.sin((Math.random() - 0.5) * spread);
        const ox = nx * ca - ny * sa;
        const oy = nx * sa + ny * ca;
        const speed = 3.0 + heat * 4.8 + intensity * 1.4;
        const colors = this._sparkColors(team, heat);
        const life = 3 + Math.floor(Math.random() * (3 + heat * 4));
        return {
            x, y,
            vx: ox * speed * (0.9 + Math.random() * 0.25),
            vy: oy * speed * (0.9 + Math.random() * 0.25),
            life,
            maxLife: life,
            color: colors[Math.floor(Math.random() * colors.length)],
            size: 0.45 + heat * 0.65 + Math.random() * 0.35
        };
    }

    _updateClusterSparks(cKey, cl, edges, cornerMap, centroid, time, team, intensity) {
        const density = cl.density || { heat: 0 };
        const heat = density.heat || 0;
        if (heat < 0.18 || !edges || !edges.length) return;

        let particles = this._sparks.get(cKey);
        if (!particles) {
            particles = [];
            this._sparks.set(cKey, particles);
        }

        const spawnRate = 0.14 + heat * 0.42 * (0.5 + intensity * 0.5);
        const burstTries = 1 + (heat >= 0.45 ? 1 : 0) + (heat >= 0.72 ? 1 : 0);
        const maxP = Math.floor(28 + heat * 70);

        for (let b = 0; b < burstTries; b++) {
            if (Math.random() >= spawnRate) continue;
            const e = edges[Math.floor(Math.random() * edges.length)];
            particles.push(this._spawnSparkOnEdge(e, centroid, team, heat, intensity));
            if (Math.random() < 0.22 + heat * 0.38) {
                particles.push(this._spawnSparkOnEdge(e, centroid, team, heat, intensity));
            }
        }

        // ★最適化: ストローク(lineStyle)・塗り(fillStyle)を粒子ごとに即時発行せず、
        // 一旦収集してから色・幅・アルファ単位でバッチ描画する（見た目は従来と同一）
        const streakItems = [];
        const dotItems = [];

        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vx *= 0.84;
            p.vy *= 0.84;
            p.life--;
            if (p.life <= 0) {
                particles.splice(i, 1);
                continue;
            }
            const fade = p.life / p.maxLife;
            const alpha = fade * fade * (0.55 + heat * 0.45);
            const spd = Math.hypot(p.vx, p.vy);
            const streak = Math.min(4.2, 1.3 + spd * 0.26);
            const angle = Math.atan2(p.vy, p.vx);
            const tx = p.x - Math.cos(angle) * streak;
            const ty = p.y - Math.sin(angle) * streak;
            streakItems.push({
                p0: { x: p.x, y: p.y }, p1: { x: tx, y: ty },
                lineW: Math.max(0.5, p.size), color: p.color, alpha
            });
            if (fade > 0.55) {
                dotItems.push({ x: p.x, y: p.y, r: p.size * 0.4, alpha: alpha * 0.65 });
            }
        }

        this._strokeEdgeBatch(this.sparkGfx, streakItems);
        this._fillCircleBatch(this.sparkGfx, 0xffffff, dotItems);

        if (particles.length > maxP) {
            particles.splice(0, particles.length - maxP);
        }
    }

    _bridgeKey(br) {
        return `${br.team}:${br.hexA}|${br.bridgeHex}|${br.hexB}`;
    }

    /**
     * 1マス空けたクラスタ間の儚い糸（しずくのつながり）
     */
    _drawBridgeThreads(bridges, pad, time, pulse) {
        if (!bridges.length || !window.BattleCloud.perimeterEdgeMidpoint) return;

        const R = this._renderer();
        const t = time * 0.001;
        const activeBridgeKeys = new Set();

        bridges.forEach(br => {
            const bKey = this._bridgeKey(br);
            activeBridgeKeys.add(bKey);
            let ph = this._bridgePhase.get(bKey);
            if (ph == null) {
                ph = Math.random() * Math.PI * 2;
                this._bridgePhase.set(bKey, ph);
            }

            const partsA = br.hexA.split(',').map(Number);
            const partsB = br.hexB.split(',').map(Number);
            const partsM = br.bridgeHex.split(',').map(Number);
            const p0 = window.BattleCloud.perimeterEdgeMidpoint(partsA[0], partsA[1], partsM[0], partsM[1], pad);
            const p2 = window.BattleCloud.perimeterEdgeMidpoint(partsB[0], partsB[1], partsM[0], partsM[1], pad);
            if (!p0 || !p2 || !R || !R.hexToPx) return;

            const mid = R.hexToPx(partsM[0], partsM[1]);
            const wobble = this._hexSize() * 0.04 * (0.5 + br.intensity * 0.5);
            const p1 = {
                x: mid.x + Math.sin(t * 2.4 + ph) * wobble,
                y: mid.y + Math.cos(t * 2.8 + ph * 1.1) * wobble * 0.85
            };

            const pts = this._sampleQuadratic(p0, p1, p2, 26);
            const team = br.team;
            const hiColor = team === 'player' ? 0xd8eeff : 0xffeedd;
            const baseA = (0.06 + br.intensity * 0.1) * (0.55 + pulse * 0.45);
            const flicker = 0.5 + 0.5 * Math.sin(t * 3.6 + ph);

            for (let i = 0; i < pts.length - 1; i++) {
                const u = i / (pts.length - 1);
                const taper = Math.sin(Math.PI * u);
                const segPh = ph + u * 5.5 + t * 4.2;
                const w = (0.35 + taper * 1.05) * (0.7 + 0.3 * Math.sin(segPh));
                const a = baseA * taper * flicker * (0.65 + 0.35 * Math.sin(segPh * 1.4));
                if (a < 0.012) continue;
                this._strokeSingleEdge(this.glowGfx, pts[i], pts[i + 1], w + 2.5, 0xffffff, a * 0.55);
                this._strokeSingleEdge(this.lineGfx, pts[i], pts[i + 1], w, hiColor, a);
            }

            const beadA = baseA * flicker * 0.85;
            if (beadA > 0.02) {
                const beadR = 0.7 + 0.5 * Math.sin(t * 4.5 + ph);
                this.glowGfx.fillStyle(0xffffff, beadA * 0.4);
                this.glowGfx.fillCircle(p1.x, p1.y, beadR + 1.2);
                this.lineGfx.fillStyle(hiColor, beadA * 0.75);
                this.lineGfx.fillCircle(p1.x, p1.y, beadR);
            }
        });

        this._bridgePhase.forEach((_, k) => {
            if (!activeBridgeKeys.has(k)) this._bridgePhase.delete(k);
        });
    }

    _drawAffectedHexes(g, hexSet, team, intensity, pulse, hexUnitCounts, heat, revealProgress, contaminatedHexes, time) {
        const h = heat || 0;
        const revealMul = revealProgress != null ? Math.min(1, revealProgress * 1.15) : 1;
        const baseA = (0.08 + intensity * 0.1 + pulse * 0.03) * (1 + h * 0.15) * revealMul;
        const fillCol = team === 'player' ? 0x556677 : 0x665544;
        const hiCol = team === 'player' ? 0x8899aa : 0xaa9988;
        const t = time * 0.001;
        hexSet.forEach(k => {
            const isContaminated = contaminatedHexes && contaminatedHexes.has(k);
            const parts = k.split(',');
            const q = parseInt(parts[0], 10);
            const r = parseInt(parts[1], 10);
            const stack = (hexUnitCounts && hexUnitCounts.get(k)) || 1;
            const pad = stack >= 2 ? 0.82 : 0.88;
            const corners = this._hexCorners(q, r, pad);
            if (!corners) return;
            let fillA = Math.min(0.28, baseA * (1 + Math.min(0.4, (stack - 1) * 0.14)));
            let useFill = fillCol;
            if (isContaminated) {
                const flick = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 11.5 + q * 1.7 + r * 2.3));
                fillA *= flick;
                useFill = team === 'player' ? 0x664433 : 0x553322;
            }
            g.fillStyle(useFill, fillA);
            g.beginPath();
            g.moveTo(corners[0].x, corners[0].y);
            for (let i = 1; i < 6; i++) g.lineTo(corners[i].x, corners[i].y);
            g.closePath();
            g.fillPath();
            if (stack >= 2 || h >= 0.5) {
                const innerA = fillA * (0.55 + 0.1 * Math.min(3, stack - 1) + h * 0.2);
                const warm = this._heatTint(team, h) || hiCol;
                g.fillStyle(warm, innerA);
                const cen = this._renderer().hexToPx(q, r);
                const coreR = this._hexSize() * (0.2 + Math.min(0.14, stack * 0.035) + h * 0.06);
                g.fillCircle(cen.x, cen.y, coreR);
                if (h >= 0.65 && stack >= 2) {
                    g.fillStyle(0xffffff, innerA * 0.35);
                    g.fillCircle(cen.x, cen.y, coreR * 0.45);
                }
            }
        });
    }

    update(time) {
        const R = this._renderer();
        if (!window.BattleCloud || !window.gameLogic || !R || !R.hexToPx) {
            this.clear();
            this._clusterAnim.clear();
            return;
        }

        const clusters = window.BattleCloud.computeAll(window.gameLogic.units);
        this.clear();
        if (!clusters.length) {
            this._clusterAnim.clear();
            this._sparks.clear();
            return;
        }

        const pulse = 0.5 + 0.5 * Math.sin(time * 0.001 * 1.1);
        const pad = 0.9;
        const activeKeys = new Set();
        const bridges = window.BattleCloud.findOneHexBridges
            ? window.BattleCloud.findOneHexBridges(clusters)
            : [];

        clusters.forEach(cl => {
            const intensity = cl.intensity;
            const cKey = this._clusterKey(cl);
            activeKeys.add(cKey);

            const segments = this._buildSegments(cl.hexes);
            const reveal = this._getEdgeReveal(cKey, segments, time);
            const cornerMap = this._cornersMapFromSegments(segments, pad);
            const centroid = {
                x: cl.centroidX != null ? cl.centroidX : this._centroid(cornerMap).x,
                y: cl.centroidY != null ? cl.centroidY : this._centroid(cornerMap).y
            };
            const shapeType = cl.shapeType || 'balanced';
            const heat = (cl.density && cl.density.heat) || 0;
            const organic = this._applyOrganicMotion(cornerMap, centroid, time, intensity, shapeType);

            const contaminated = cl.contaminatedHexes || null;

            this._drawAffectedHexes(
                this.hexGfx, cl.hexes, cl.team, intensity, pulse, cl.hexUnitCounts, heat,
                reveal.progress, contaminated, time
            );

            let drawnEdges = null;
            if (reveal.ordered.length > 0 && organic.size > 0) {
                drawnEdges = this._strokePerimeterEdges(
                    reveal.ordered, organic, intensity, cl.team, pulse, time, shapeType, heat,
                    reveal.done ? null : reveal, contaminated
                );
            }

            this._updateClusterSparks(cKey, cl, drawnEdges, organic, centroid, time, cl.team, intensity);
        });

        this._drawBridgeThreads(bridges, pad, time, pulse);

        this._clusterAnim.forEach((_, k) => {
            if (!activeKeys.has(k)) this._clusterAnim.delete(k);
        });
        this._sparks.forEach((_, k) => {
            if (!activeKeys.has(k)) this._sparks.delete(k);
        });
    }
}

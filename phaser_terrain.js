/**

 * Hex terrain rendering.

 * v1.0 tiles + blend.py placement rules (scripts/terrain_v1/lib/blend.py)

 */

window.TerrainRender = {

    enabled: true,

    useV1Tiles: true,

    useCurveOverlay: true,



    ROAD_DIR_DELTAS: [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]],



    BASE_TEXTURES: {

        0: 'hex_dirt',

        1: 'hex_grass',

        2: 'hex_forest',

        4: 'hex_town'

    },



    V1_TERRAIN: {

        0: 'dirt',

        1: 'grass',

        2: 'forest',

        4: 'dirt',

        5: 'water'

    },



    /** blend.py TERRAIN_PRIORITY — higher = encroaches, does not blend away */

    V1_PRIORITY: { water: 3, forest: 2, grass: 1, dirt: 1 },



    /** Pre-made transition tiles: hex_trans_{from}_{to}_d{dir} */

    V1_TRANSITIONS: [

        ['grass', 'forest'],

        ['grass', 'water'],

        ['grass', 'dirt'],

        ['forest', 'water']

    ],



    V1_VARIANTS: ['dirt', 'grass', 'forest', 'water'],



    LEGACY_WATER_TINT: 0x303840,



    hexDisplayScale() {

        return 1 / (window.HIGH_RES_SCALE || 1);

    },



    roadMaskKey(mask) {

        return `hex_road_m${mask.toString(16).padStart(2, '0')}`;

    },



    v1HasTransition(fromName, toName) {

        return this.V1_TRANSITIONS.some(([a, b]) => a === fromName && b === toName);

    },



    v1VariantIndex(q, r) {

        let h = (q * 73856093) ^ (r * 19349663);

        h = ((h >> 16) ^ h) * 0x45d9f3b;

        h = ((h >> 16) ^ h) * 0x45d9f3b;

        h = (h >> 16) ^ h;

        return ((Math.floor(q / 2) + Math.floor(r / 2) * 2) % 6 + 6) % 6;

    },



    v1TerrainName(terrainId, map, q, r) {

        const baseId = map && q != null ? this.baseTerrainId(map, q, r, terrainId) : terrainId;

        return this.V1_TERRAIN[baseId] || 'grass';

    },



    v1BaseKey(map, q, r, terrainId) {

        const name = this.v1TerrainName(terrainId, map, q, r);

        const v = this.v1VariantIndex(q, r);

        return `hex_${name}_${v}`;

    },



    /**

     * blend.py: collect neighbors that encroach on this hex.

     * - Higher-priority neighbor (water > forest > grass/dirt)

     * - Or pre-made trans tile exists (e.g. grass→dirt at equal priority)

     */

    v1BlendNeighbors(map, q, r, terrainId) {

        if (!map || q == null || r == null) return [];

        const myName = this.v1TerrainName(terrainId, map, q, r);

        const out = [];



        this.ROAD_DIR_DELTAS.forEach((d, dir) => {

            const nq = q + d[0];

            const nr = r + d[1];

            if (nq < 0 || nr < 0 || nq >= MAP_W || nr >= MAP_H) return;

            const cell = map[nq][nr];

            if (cell.id === -1) return;

            const neiName = this.v1TerrainName(cell.id, map, nq, nr);

            if (neiName === myName) return;

            if (!this.v1HasTransition(myName, neiName)) return;

            const neiPri = this.V1_PRIORITY[neiName] || 1;

            out.push({ dir, neiName, neiPri });

        });



        return out;

    },



    /**

     * Pick one trans tile when multiple encroach (blend.py merges all; PNG = strongest + stable dir).

     */

    v1TransitionKey(map, q, r, terrainId) {

        const myName = this.v1TerrainName(terrainId, map, q, r);

        const neighbors = this.v1BlendNeighbors(map, q, r, terrainId);

        if (!neighbors.length) return null;



        neighbors.sort((a, b) => {

            if (b.neiPri !== a.neiPri) return b.neiPri - a.neiPri;

            return a.dir - b.dir;

        });



        const pick = neighbors[0];

        return `hex_trans_${myName}_${pick.neiName}_d${pick.dir}`;

    },



    v1TextureKey(map, q, r, terrainId) {

        const trans = this.v1TransitionKey(map, q, r, terrainId);

        if (trans) return trans;

        return this.v1BaseKey(map, q, r, terrainId);

    },



    preload(scene) {

        const base = 'asset/environment/hex_tiles';

        if (this.useV1Tiles) {

            this.V1_VARIANTS.forEach((terrain) => {

                for (let v = 0; v < 6; v++) {

                    const key = `hex_${terrain}_${v}`;

                    if (!scene.textures.exists(key)) {

                        scene.load.image(key, `${base}/${key}.png`);

                    }

                }

            });

            this.V1_TRANSITIONS.forEach(([a, b]) => {

                for (let d = 0; d < 6; d++) {

                    const key = `hex_trans_${a}_${b}_d${d}`;

                    if (!scene.textures.exists(key)) {

                        scene.load.image(key, `${base}/${key}.png`);

                    }

                }

            });

            return;

        }



        const names = ['hex_dirt', 'hex_grass', 'hex_forest', 'hex_town'];

        names.forEach((key) => {

            if (!scene.textures.exists(key)) {

                scene.load.image(key, `${base}/${key}.png`);

            }

        });

        if (!this.useCurveOverlay) {

            for (let m = 0; m < 64; m++) {

                const key = this.roadMaskKey(m);

                if (!scene.textures.exists(key)) {

                    scene.load.image(key, `${base}/roads/m${m.toString(16).padStart(2, '0')}.png`);

                }

            }

        }

    },



    isRoadCell(map, q, r) {

        if (q < 0 || r < 0 || q >= MAP_W || r >= MAP_H) return false;

        return map[q][r].id === 3;

    },



    roadNeighborMask(map, q, r) {

        let mask = 0;

        this.ROAD_DIR_DELTAS.forEach((d, i) => {

            if (this.isRoadCell(map, q + d[0], r + d[1])) mask |= 1 << i;

        });

        return mask;

    },



    baseTerrainId(map, q, r, terrainId) {

        if (terrainId !== 3) return terrainId;

        const cell = map[q][r];

        return cell.underId != null ? cell.underId : 1;

    },



    textureForCell(map, q, r, terrainId) {

        if (this.useV1Tiles && terrainId !== 3 && terrainId !== 5) {

            return { key: this.v1TextureKey(map, q, r, terrainId), angle: 0 };

        }

        if (terrainId === 5 && this.useV1Tiles) {

            return { key: this.v1BaseKey(map, q, r, 5), angle: 0 };

        }

        if (terrainId === 3 && this.useCurveOverlay) {

            const baseId = this.baseTerrainId(map, q, r, terrainId);

            if (this.useV1Tiles) {

                return { key: this.v1TextureKey(map, q, r, baseId), angle: 0 };

            }

            const key = this.BASE_TEXTURES[baseId] || 'hex_grass';

            return { key, angle: 0 };

        }

        if (terrainId === 3) {

            const mask = this.roadNeighborMask(map, q, r);

            return { key: this.roadMaskKey(mask), angle: 0 };

        }

        const key = this.BASE_TEXTURES[terrainId] || 'hex_dirt';

        return { key, angle: 0 };

    },



    edgeKey(q0, r0, q1, r1) {

        if (q0 < q1 || (q0 === q1 && r0 < r1)) return `${q0},${r0}|${q1},${r1}`;

        return `${q1},${r1}|${q0},${r0}`;

    },



    edgeCurveSeed(q0, r0, q1, r1) {

        let h = (q0 * 73856093) ^ (r0 * 19349663) ^ (q1 * 83492791) ^ (r1 * 50331653);

        h = ((h >> 16) ^ h) * 0x45d9f3b;

        h = ((h >> 16) ^ h) * 0x45d9f3b;

        h = (h >> 16) ^ h;

        return h >>> 0;

    },



    drawRoadNetwork(roadGraphics, map) {

        if (!roadGraphics || !window.Renderer) return;

        roadGraphics.clear();

        const edges = new Set();

        const hexSize = typeof HEX_SIZE !== 'undefined' ? HEX_SIZE : 54;

        const roadW = hexSize * 0.44;

        let segCount = 0;



        for (let q = 0; q < MAP_W; q++) {

            for (let r = 0; r < MAP_H; r++) {

                if (!this.isRoadCell(map, q, r)) continue;

                this.ROAD_DIR_DELTAS.forEach((d) => {

                    const nq = q + d[0];

                    const nr = r + d[1];

                    if (!this.isRoadCell(map, nq, nr)) return;

                    const key = this.edgeKey(q, r, nq, nr);

                    if (edges.has(key)) return;

                    edges.add(key);

                    segCount++;



                    const pA = Renderer.hexToPx(q, r);

                    const pB = Renderer.hexToPx(nq, nr);

                    const mx = (pA.x + pB.x) / 2;

                    const my = (pA.y + pB.y) / 2;

                    const dx = pB.x - pA.x;

                    const dy = pB.y - pA.y;

                    const len = Math.hypot(dx, dy) || 1;

                    const seed = this.edgeCurveSeed(q, r, nq, nr);

                    const side = (seed & 1) ? 1 : -1;

                    const bend = hexSize * (0.1 + (seed % 80) / 800);

                    const cx = mx + side * (-dy / len) * bend;

                    const cy = my + side * (dx / len) * bend;



                    const curve = new Phaser.Curves.QuadraticBezier(

                        new Phaser.Math.Vector2(pA.x, pA.y),

                        new Phaser.Math.Vector2(cx, cy),

                        new Phaser.Math.Vector2(pB.x, pB.y)

                    );

                    const pts = curve.getPoints(16);

                    roadGraphics.lineStyle(roadW + 5, 0x1a1814, 0.45);

                    roadGraphics.beginPath();

                    roadGraphics.moveTo(pts[0].x, pts[0].y);

                    for (let i = 1; i < pts.length; i++) roadGraphics.lineTo(pts[i].x, pts[i].y);

                    roadGraphics.strokePath();



                    roadGraphics.lineStyle(roadW, 0x8a8278, 0.96);

                    roadGraphics.beginPath();

                    roadGraphics.moveTo(pts[0].x, pts[0].y);

                    for (let i = 1; i < pts.length; i++) roadGraphics.lineTo(pts[i].x, pts[i].y);

                    roadGraphics.strokePath();



                    roadGraphics.lineStyle(Math.max(2, roadW * 0.12), 0xc8beb0, 0.35);

                    roadGraphics.beginPath();

                    roadGraphics.moveTo(pts[0].x, pts[0].y);

                    for (let i = 1; i < pts.length; i++) roadGraphics.lineTo(pts[i].x, pts[i].y);

                    roadGraphics.strokePath();

                });

            }

        }

        roadGraphics.setVisible(segCount > 0);

    },



    spawnLegacyWater(scene, group, worldX, worldY, q, r, decorGroup) {

        if (!scene.textures.exists('hex_base')) window.createHexTexture(scene);

        const hex = scene.add.image(worldX, worldY, 'hex_base');

        hex.setOrigin(0.5, 0.5);

        hex.setScale(this.hexDisplayScale());

        hex.setTint(this.LEGACY_WATER_TINT);

        hex.setDepth(worldY);

        group.add(hex);

        if (window.EnvSystem && decorGroup) {

            window.EnvSystem.registerWater(hex, worldY, q, r, decorGroup);

        }

        return hex;

    },



    spawnHex(scene, group, worldX, worldY, q, r, terrainId, decorGroup, map) {

        if (terrainId === 5 && !this.useV1Tiles) {

            return this.spawnLegacyWater(scene, group, worldX, worldY, q, r, decorGroup);

        }

        let key;
        let angle = 0;
        if (this.useV1Tiles && map && window.TerrainRenderV1Bake) {
            key = window.TerrainRenderV1Bake.textureKey(scene, map, q, r, terrainId);
        } else {
            const picked = this.textureForCell(map, q, r, terrainId);
            key = picked.key;
            angle = picked.angle;
        }

        if (!scene.textures.exists(key)) {

            return this._spawnFallbackHex(scene, group, worldX, worldY, terrainId, map, q, r);

        }

        const hex = scene.add.image(worldX, worldY, key);

        hex.setOrigin(0.5, 0.5);

        hex.setScale(this.hexDisplayScale());

        if (angle) hex.setAngle(angle);

        if (terrainId === 3 && this.useCurveOverlay) hex.setTint(0xd8ccc0);

        hex.setDepth(Math.min(worldY * 0.01, 3));

        group.add(hex);

        if (terrainId === 5 && this.useV1Tiles && window.EnvSystem && decorGroup) {

            window.EnvSystem.registerWater(hex, worldY, q, r, decorGroup);

        }

        return hex;

    },



    buildMap(scene, hexGroup, map, decorGroup, roadGraphics) {

        if (!this.enabled) return;

        if (this.useV1Tiles && window.TerrainRenderV1Bake) {
            window.TerrainRenderV1Bake.clear(scene);
        }

        for (let q = 0; q < MAP_W; q++) {

            for (let r = 0; r < MAP_H; r++) {

                const t = map[q][r];

                if (t.id === -1) continue;

                const pos = Renderer.hexToPx(q, r);

                this.spawnHex(scene, hexGroup, pos.x, pos.y, q, r, t.id, decorGroup, map);

            }

        }

        if (this.useCurveOverlay) this.drawRoadNetwork(roadGraphics, map);

    },



    _spawnFallbackHex(scene, group, worldX, worldY, terrainId, map, q, r) {

        if (!scene.textures.exists('hex_base')) window.createHexTexture(scene);

        const hex = scene.add.image(worldX, worldY, 'hex_base').setScale(this.hexDisplayScale());

        let tint = 0x555555;

        const id = map && q != null ? this.baseTerrainId(map, q, r, terrainId) : terrainId;

        if (id === 0) tint = 0x5a5245;

        else if (id === 1) tint = 0x335522;

        else if (id === 2) tint = 0x112211;

        else if (id === 3) tint = 0x4a4845;

        else if (id === 4) tint = 0x504540;

        else if (id === 5) tint = this.LEGACY_WATER_TINT;

        hex.setTint(tint);

        hex.setDepth(worldY);

        group.add(hex);

        return hex;

    }

};



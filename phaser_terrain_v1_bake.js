/**
 * v1.0 terrain: runtime hex bake (scripts/terrain_v1/lib/blend.py parity).
 * Sample maps smooth boundaries via per-pixel blend, not single trans PNG picks.
 */
(function () {
    const W = 202;
    const H = 233;
    const CX = W / 2;
    const CY = H / 2;
    const HEX_R = 108;

    function edgeNoise(ex, ey, d, seed) {
        const s = Math.sin((ex * 0.025 + d * 7 + seed) * 12.9898 + (ey * 0.025 + d * 5) * 78.233) * 43758.5453;
        return (s - Math.floor(s)) * 0.3;
    }

    function getTileImage(scene, key) {
        if (!scene.textures.exists(key)) return null;
        const src = scene.textures.get(key).getSourceImage();
        if (!src || !src.width) return null;
        return src;
    }

    function imageToData(img) {
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, W, H);
        return ctx.getImageData(0, 0, W, H);
    }

    function applyBlendPy(baseData, terrainRender, scene, map, q, r, terrainId) {
        const myName = terrainRender.v1TerrainName(terrainId, map, q, r);
        const myPri = terrainRender.V1_PRIORITY[myName] || 1;
        const neighbors = [];

        terrainRender.ROAD_DIR_DELTAS.forEach((d, dir) => {
            const nq = q + d[0];
            const nr = r + d[1];
            if (nq < 0 || nr < 0 || nq >= MAP_W || nr >= MAP_H) return;
            const cell = map[nq][nr];
            if (cell.id === -1) return;
            const neiName = terrainRender.v1TerrainName(cell.id, map, nq, nr);
            if (neiName === myName) return;
            const neiPri = terrainRender.V1_PRIORITY[neiName] || 1;
            const grassTowardDirt = myName === 'grass' && neiName === 'dirt';
            if (neiPri > myPri || grassTowardDirt) {
                neighbors.push({ dir, nq, nr, neiName });
            }
        });

        if (!neighbors.length) return baseData;

        const seed = ((q * 73856093) ^ (r * 19349663)) % 10000 + 999;
        const outR = new Float32Array(W * H);
        const outG = new Float32Array(W * H);
        const outB = new Float32Array(W * H);
        const outW = new Float32Array(W * H);

        neighbors.forEach(({ dir, nq, nr }) => {
            const neiKey = terrainRender.v1BaseKey(map, nq, nr, map[nq][nr].id);
            const neiImg = getTileImage(scene, neiKey);
            if (!neiImg) return;
            const neiData = imageToData(neiImg).data;
            const angle = (dir * 60 * Math.PI) / 180;
            const cosA = Math.cos(angle);
            const sinA = Math.sin(angle);

            for (let y = 0; y < H; y++) {
                const ys = (y - CY) / HEX_R;
                for (let x = 0; x < W; x++) {
                    const xs = (x - CX) / HEX_R;
                    const proj = xs * cosA - ys * sinA;
                    const n = edgeNoise(x, y, dir, seed);
                    let t = (proj + n - 0.2) / 0.5;
                    if (t < 0) t = 0;
                    else if (t > 1) t = 1;
                    t = t * t * (3 - 2 * t);
                    const i = y * W + x;
                    const j = i * 4;
                    outR[i] += neiData[j] * t;
                    outG[i] += neiData[j + 1] * t;
                    outB[i] += neiData[j + 2] * t;
                    outW[i] += t;
                }
            }
        });

        const d = baseData.data;
        for (let i = 0; i < W * H; i++) {
            const w = outW[i];
            if (w <= 0.01) continue;
            const j = i * 4;
            const nr = outR[i] / w;
            const ng = outG[i] / w;
            const nb = outB[i] / w;
            const fw = w > 1 ? 1 : w;
            d[j] = Math.round(d[j] * (1 - fw) + nr * fw);
            d[j + 1] = Math.round(d[j + 1] * (1 - fw) + ng * fw);
            d[j + 2] = Math.round(d[j + 2] * (1 - fw) + nb * fw);
        }
        return baseData;
    }

    function needsBake(tr, map, q, r, terrainId) {
        const myName = tr.v1TerrainName(terrainId, map, q, r);
        const myPri = tr.V1_PRIORITY[myName] || 1;
        let blend = false;
        tr.ROAD_DIR_DELTAS.forEach((d) => {
            const nq = q + d[0];
            const nr = r + d[1];
            if (nq < 0 || nr < 0 || nq >= MAP_W || nr >= MAP_H) return;
            const cell = map[nq][nr];
            if (cell.id === -1) return;
            const neiName = tr.v1TerrainName(cell.id, map, nq, nr);
            if (neiName === myName) return;
            const neiPri = tr.V1_PRIORITY[neiName] || 1;
            if (neiPri > myPri || (myName === 'grass' && neiName === 'dirt')) blend = true;
        });
        return blend;
    }

    window.TerrainRenderV1Bake = {
        clear(scene) {
            if (!this._keys) return;
            this._keys.forEach((k) => { if (scene.textures.exists(k)) scene.textures.remove(k); });
            this._keys = new Set();
        },

        textureKey(scene, map, q, r, terrainId) {
            const tr = window.TerrainRender;
            const id = tr.baseTerrainId(map, q, r, terrainId);
            const baseKey = tr.v1BaseKey(map, q, r, terrainId);
            if (!needsBake(tr, map, q, r, terrainId)) return baseKey;

            const cacheKey = `v1b_${q}_${r}_${id}`;
            if (scene.textures.exists(cacheKey)) return cacheKey;

            const baseImg = getTileImage(scene, baseKey);
            if (!baseImg) return baseKey;

            let data = imageToData(baseImg);
            data = applyBlendPy(data, tr, scene, map, q, r, terrainId);

            const canvas = document.createElement('canvas');
            canvas.width = W;
            canvas.height = H;
            canvas.getContext('2d').putImageData(data, 0, 0);
            scene.textures.addCanvas(cacheKey, canvas);
            if (!this._keys) this._keys = new Set();
            this._keys.add(cacheKey);
            return cacheKey;
        }
    };
})();

/**
 * PHASER TERRAIN V7: hex_tiles_v7 (WW2廃墟都市) レンダラ
 *
 * CityMap (logic_map_city.js) が生成した map[q][r].city メタを描画する。
 * タイル素材はミリタリー投影 288x384px・ヘックス半径128px・アンカー(144,234.5)
 * (2026-07-13: 576x768から半減 — 表示は121x162px程度なのに4倍相当の
 * オーバースペックだったため。501枚合計195MB→40MBに削減)。
 * 表示スケール = HEX_SIZE / 128。
 *
 * テクスチャは「そのマップが実際に参照するファイルだけ」を実行時ロードする
 * （340枚全載せはVRAM~600MB級になるため不可）。建物も現在の損傷段だけを読み込み、
 * 被弾時は次段階を遅延ロードして差し替える（全面再描画しない）。
 *
 * 描画順:
 *   地面・瓦礫・鉄条網など低層 → hexGroup(depth0) 内で worldY ソート
 *   建物・教会・工場・ボカージュ・樹木など背高 → scene.unitGroup (ユニットと同じ
 *   Layer) に depth=worldY で同居 = ユニットとの前後関係が正しく出る
 *   （北隣のユニットは建物の陰に隠れ、南隣のユニットは手前に立つ）。
 *   ユニット側は phaser_unit.js が毎フレーム container.depth=y を振る。
 */
window.TerrainRenderV7 = {
    BASE: 'asset/environment/hex_tiles_v7',
    SRC_W: 288, SRC_H: 384,
    HEX_R: 128, ANCHOR_X: 144, ANCHOR_Y: 234.5,
    BACKDROP_PAD: 3,
    DETAIL_PACK_READY: true,
    _buildSerial: 0,

    /** 'q,r' -> 建物 Phaser image（損傷差し替え用） */
    buildingSprites: new Map(),
    /** 'q,r' -> 地面 Phaser image（着弾クレーター・道路損傷の差し替え用） */
    groundSprites: new Map(),
    /** テクスチャキー -> 壁際オフセット(画面px)。回転ごとに別画像なのでキャッシュ必須 */
    _safeOffsetCache: new Map(),
    _buildingDamageSerial: new Map(),
    _groundDamageSerial: new Map(),

    texKey(file) { return 'v7_' + file; },

    displayScale() { return HEX_SIZE / this.HEX_R; },

    /** マップが参照するファイルだけを列挙（建物の次損傷段は遅延ロード） */
    collectFiles(map) {
        const files = new Set();
        let hasScar = false;
        for (let q = 0; q < MAP_W; q++) for (let r = 0; r < MAP_H; r++) {
            const t = map[q] && map[q][r];
            const cell = t && t.city;
            if (!cell || cell.void) continue;
            if (cell.scar || cell.ground === 'pair') hasScar = true;
            files.add(window.CityMap.groundFile(cell, window.CityMap.lastSeed));
            (cell.flat || []).forEach(f => files.add(f));
            (cell.over || []).forEach(f => {
                files.add(f);
                // Kitbash住宅は直撃で一発瓦礫化するため、変換先を先読み
                if (window.CityMap.KBRES_RE && window.CityMap.KBRES_RE.test(f)) {
                    for (let v = 0; v < 3; v++) for (const rr of [0, 60]) {
                        files.add(`rubble_v${v}_rot${rr}.png`);
                    }
                }
            });
            this._cellDecals(cell).forEach(d => files.add(d.file));
        }
        // スカー境界のシームブレーカー土パッチ(実行時オフセット配置)
        if (hasScar) for (let v = 0; v < 4; v++) files.add(`dirtpatch_v${v}.png`);
        this._forEachBackdrop(map, item => {
            files.add(item.ground);
            item.flat.forEach(f => files.add(f));
            item.tall.forEach(f => files.add(f));
        });
        this._forEachCobbleDetail(map, item => files.add(item.file));
        return files;
    },

    /**
     * 都市マップを描画。未ロードのテクスチャがあれば実行時ロード後に描画する
     * （ローカル配信なので体感は一瞬。ロード中は地面なしだが直後に埋まる）。
     */
    buildMap(scene, hexGroup, map) {
        const serial = ++this._buildSerial;
        const files = this.collectFiles(map);
        const missing = [...files].filter(f => !scene.textures.exists(this.texKey(f)));
        const draw = () => {
            if (serial !== this._buildSerial ||
                (scene.sys && scene.sys.isActive && !scene.sys.isActive())) return;
            this._draw(scene, hexGroup, map, serial);
        };
        if (missing.length === 0) { draw(); return; }
        missing.forEach(f => scene.load.image(this.texKey(f), `${this.BASE}/${f}`));
        scene.load.once('complete', draw);
        scene.load.start();
        console.log(`[TerrainRenderV7] loading ${missing.length} tiles (${files.size} referenced)`);
    },

    /** ユニットとYソートすべき背高オブジェクト（低層の瓦礫・小物・下草は除く） */
    TALL_RE: /^(bldg_s\d+|kbres_[a-e]|church|factory|bocage_\w+|tree_v\d+)_/,
    _cellDecals(cell) {
        if (!cell || !cell.decals) return [];
        const list = Array.isArray(cell.decals) ? cell.decals : [cell.decals];
        return list.filter(d => d && typeof d.file === 'string' && d.file.length);
    },

    _forEachBackdrop(map, visit) {
        const CM = window.CityMap;
        const seed = CM.lastSeed;
        const h32 = CM.h32.bind(CM);
        const pad = this.BACKDROP_PAD;
        for (let q = -pad; q < MAP_W + pad; q++) {
            for (let r = -pad; r < MAP_H + pad; r++) {
                const outside = q < 0 || r < 0 || q >= MAP_W || r >= MAP_H;
                const t = outside ? null : (map[q] && map[q][r]);
                const cell = t && t.city;
                if (!outside && cell && !cell.void) continue;

                const ground = `gnd_grass_v${h32(seed, q, r, 'backdrop-ground') % 6}.png`;
                const flat = [];
                const tall = [];
                // Axial (q,r) is cube (x,z). Quantising those cube axes makes
                // coherent 4x4 land parcels while preserving negative rings.
                const parcelX = Math.floor(q / 4), parcelZ = Math.floor(r / 4);
                const isFieldParcel = h32(seed, parcelX, parcelZ, 'backdrop-field') % 100 < 60;
                if (isFieldParcel &&
                    h32(seed, q, r, parcelX, parcelZ, 'backdrop-field-fill') % 100 < 90) {
                    const v = h32(seed, parcelX, parcelZ, 'backdrop-field-v') % 4;
                    const rot = (h32(seed, parcelX, parcelZ, 'backdrop-field-r') % 3) * 60;
                    flat.push(`fieldrows_v${v}_rot${rot}.png`);
                } else if (!isFieldParcel) {
                    const macroX = Math.floor(q / 3), macroZ = Math.floor(r / 3);
                    const inVegMacro = h32(seed, macroX, macroZ, 'backdrop-veg') % 100 < 42;
                    if (inVegMacro &&
                        h32(seed, q, r, macroX, macroZ, 'backdrop-veg-fill') % 100 < 40) {
                        const v = 3 + h32(seed, q, r, 'backdrop-veg-v') % 3;
                        flat.push(`veg_v${v}_rot0.png`);
                    }
                }
                if (outside && h32(seed, q, r, 'backdrop-tree') % 100 < 10) {
                    const v = 5 + h32(seed, q, r, 'backdrop-tree-v') % 5;
                    tall.push(`tree_v${v}_rot0.png`);
                }
                visit({ q, r, outside, ground, flat, tall });
            }
        }
    },

    _isCobbleRoad(cell) {
        if (!cell || cell.void) return false;
        if (cell.ground === 'cobble' || cell.ground === 'road' || cell.ground === 'street') return true;
        return typeof cell.gfile === 'string' && /^(gnd_cobble|road_)/.test(cell.gfile);
    },

    _forEachCobbleDetail(map, visit) {
        const CM = window.CityMap;
        const seed = CM.lastSeed;
        const h32 = CM.h32.bind(CM);
        const cellAt = (q, r) => {
            const t = map[q] && map[q][r];
            return t && t.city;
        };
        const INR = 9 * Math.sqrt(3) / 2;
        for (let q = 0; q < MAP_W; q++) for (let r = 0; r < MAP_H; r++) {
            if (!this._isCobbleRoad(cellAt(q, r))) continue;
            for (let k = 0; k < 3; k++) {
                const nq = q + CM.DIRS[k][0], nr = r + CM.DIRS[k][1];
                if (!this._isCobbleRoad(cellAt(nq, nr))) continue;
                if (h32(seed, q, r, k, 'cobble-detail-use') % 100 >= 28) continue;
                const a = Math.PI / 3 * k;
                const normal = ((h32(seed, q, r, k, 'cobble-detail-n') % 101) / 100 - 0.5) * 0.8;
                const tangent = ((h32(seed, q, r, k, 'cobble-detail-t') % 101) / 100 - 0.5) * 1.8;
                const wx = Math.cos(a) * (INR + normal) + Math.cos(a + Math.PI / 2) * tangent;
                const wy = Math.sin(a) * (INR + normal) + Math.sin(a + Math.PI / 2) * tangent;
                visit({
                    q, r, wx, wy,
                    file: `cobble_detail_v${h32(seed, q, r, k, 'cobble-detail-v') % 6}.png`,
                    scale: 0.75 + (h32(seed, q, r, k, 'cobble-detail-s') % 41) / 100,
                    alpha: 0.8 + (h32(seed, q, r, k, 'cobble-detail-a') % 21) / 100,
                });
            }
        }
    },
    _decalDepth(decal, y, tall) {
        const layer = decal.layer;
        const numeric = layer !== null && layer !== undefined && layer !== '' &&
            Number.isFinite(Number(layer)) ? Number(layer) : null;
        if (tall) return y - 0.45 + (numeric === null ? 0 : numeric * 0.001);
        if (numeric !== null) return numeric + y * 0.001;
        if (layer === 'ground' || layer === 'below') return 300 + y * 0.001;
        if (layer === 'flat') return 1300 + y * 0.001;
        if (layer === 'over' || layer === 'overlay') return 2000 + y;
        return 1650 + y * 0.001;
    },

    _drawBackdrop(scene, hexGroup, tallGroup, map) {
        this._forEachBackdrop(map, item => {
            const pos = Renderer.hexToPx(item.q, item.r);
            this._addTile(scene, hexGroup, item.ground, pos.x, pos.y,
                -1000 + pos.y * 0.001);
            item.flat.forEach(f => this._addTile(scene, hexGroup, f, pos.x, pos.y,
                -500 + pos.y * 0.001));
            item.tall.forEach(f => this._addTile(scene, tallGroup, f, pos.x, pos.y,
                pos.y - 1));
        });
    },

    _drawDecals(scene, hexGroup, tallGroup, cell, pos) {
        this._cellDecals(cell).forEach(decal => {
            const wx = Number(decal.wx), wy = Number(decal.wy);
            const off = this._worldOffToPx(Number.isFinite(wx) ? wx : 0,
                Number.isFinite(wy) ? wy : 0);
            const x = pos.x + off.dx, y = pos.y + off.dy;
            const tall = typeof decal.tall === 'boolean'
                ? decal.tall : this.TALL_RE.test(decal.file);
            const img = this._addTile(scene, tall ? tallGroup : hexGroup, decal.file,
                x, y, this._decalDepth(decal, y, tall));
            if (!img) return;
            const rawScale = Number(decal.scale);
            const scale = Number.isFinite(rawScale) ? Math.max(0, rawScale) : 1;
            img.setScale(img.scaleX * scale, img.scaleY * scale);
            const rawAlpha = Number(decal.alpha);
            if (Number.isFinite(rawAlpha)) img.setAlpha(Math.max(0, Math.min(1, rawAlpha)));
        });
    },

    _placeCobbleDetails(scene, hexGroup, map) {
        this._forEachCobbleDetail(map, item => {
            const pos = Renderer.hexToPx(item.q, item.r);
            const off = this._worldOffToPx(item.wx, item.wy);
            const img = this._addTile(scene, hexGroup, item.file,
                pos.x + off.dx, pos.y + off.dy, 425 + pos.y * 0.001);
            if (!img) return;
            img.setScale(img.scaleX * item.scale, img.scaleY * item.scale);
            img.setAlpha(item.alpha);
        });
    },

    _addTile(scene, group, file, x, y, depth) {
        const key = this.texKey(file);
        if (!scene.textures.exists(key)) return null;
        const img = scene.add.image(x, y, key);
        img.setOrigin(this.ANCHOR_X / this.SRC_W, this.ANCHOR_Y / this.SRC_H);
        img.setScale(this.displayScale());
        img.setDepth(depth);
        group.add(img);
        return img;
    },

    _draw(scene, hexGroup, map, serial) {
        if (serial !== this._buildSerial) return;
        this.buildingSprites.clear();
        this.groundSprites.clear();
        this._buildingDamageSerial.clear();
        this._groundDamageSerial.clear();
        const tallGroup = scene.unitGroup || hexGroup;
        this._drawBackdrop(scene, hexGroup, tallGroup, map);
        for (let q = 0; q < MAP_W; q++) for (let r = 0; r < MAP_H; r++) {
            const t = map[q] && map[q][r];
            const cell = t && t.city;
            if (!cell || cell.void) continue;
            const pos = Renderer.hexToPx(q, r);
            const gimg = this._addTile(scene, hexGroup, window.CityMap.groundFile(cell, window.CityMap.lastSeed),
                pos.x, pos.y, pos.y * 0.001);
            if (gimg) this.groundSprites.set(q + ',' + r, gimg);
            (cell.flat || []).forEach(f =>
                this._addTile(scene, hexGroup, f, pos.x, pos.y, 1000 + pos.y * 0.001));
            (cell.over || []).forEach(f => {
                const tall = this.TALL_RE.test(f);
                // 背高: ユニットと同じレイヤで depth=Y（-0.5 は同Yのユニットを手前にするバイアス）
                const img = tall
                    ? this._addTile(scene, tallGroup, f, pos.x, pos.y, pos.y - 0.5)
                    : this._addTile(scene, hexGroup, f, pos.x, pos.y, 2000 + pos.y);
                if (img && t.building &&
                    (window.CityMap.BLDG_RE.test(f) || (window.CityMap.KBRES_RE && window.CityMap.KBRES_RE.test(f)))) {
                    this.buildingSprites.set(q + ',' + r, img);
                }
            });
            this._drawDecals(scene, hexGroup, tallGroup, cell, pos);
        }
        this._placeCobbleDetails(scene, hexGroup, map);
        this._placeScarPatches(scene, hexGroup, map);
    },

    /** 世界座標オフセット(m)→画面pxオフセット。ミリタリー投影は平面図が
     * 無歪(pixel_aspectトリック)なので線形換算で足りる。北=+wy=画面上方向 */
    _worldOffToPx(wx, wy) {
        const ppm = (this.SRC_W / 20.25) * this.displayScale();   // 20.25m = キャンバス幅の実世界カバー
        return { dx: wx * ppm, dy: -wy * ppm };
    },

    /**
     * スカー境界のシームブレーカー: 土パッチ(dirtpatch_v0-3)をスカー同士の
     * 共有エッジ中点と、スカーが3枚揃う3タイル頂点に散らして、
     * くっきりした六角形の境界線とコーナーのスパイクを覆う(2026-07-14)。
     * タイル量産ではなくデカール4種+配置で解決する方式。
     */
    _placeScarPatches(scene, hexGroup, map) {
        if (!scene.textures.exists(this.texKey('dirtpatch_v0.png'))) return;
        const CM = window.CityMap;
        const isScar = (q, r) => {
            const t = map[q] && map[q][r];
            return !!(t && t.city && (t.city.scar || t.city.ground === 'pair'));
        };
        const isPair = (q, r) => {
            const t = map[q] && map[q][r];
            return !!(t && t.city && t.city.ground === 'pair');
        };
        const R = 9, INR = R * Math.sqrt(3) / 2;   // ヘックス実寸(m)
        const seed = CM.lastSeed;
        const h32 = CM.h32.bind(CM);
        const place = (q, r, wx, wy, salt) => {
            if (h32(seed, q, r, salt, 'skip') % 100 < 42) return;   // 敷き詰め感の間引き
            const jx = ((h32(seed, q, r, salt, 'jx') % 100) / 100 - 0.5) * 1.6;
            const jy = ((h32(seed, q, r, salt, 'jy') % 100) / 100 - 0.5) * 1.6;
            const off = this._worldOffToPx(wx + jx, wy + jy);
            const pos = Renderer.hexToPx(q, r);
            const v = h32(seed, q, r, salt, 'pv') % 4;
            const img = this._addTile(scene, hexGroup, `dirtpatch_v${v}.png`,
                pos.x + off.dx, pos.y + off.dy, 500 + pos.y * 0.001);
            if (img) img.setScale(img.scaleX * (0.75 + (h32(seed, q, r, salt, 'ps') % 50) / 100));
        };
        for (let q = 0; q < MAP_W; q++) for (let r = 0; r < MAP_H; r++) {
            if (!isScar(q, r)) continue;
            // 共有エッジ(k=0..2のみ走査=各エッジ1回): 境界の直線を砕く。
            // cpairの内部辺は溶接済みシームレスなのでスキップ
            for (let k = 0; k < 3; k++) {
                const nq = q + CM.DIRS[k][0], nr = r + CM.DIRS[k][1];
                if (!isScar(nq, nr)) continue;
                if (isPair(q, r) && isPair(nq, nr)) continue;
                const a = Math.PI / 3 * k;
                place(q, r, Math.cos(a) * INR, Math.sin(a) * INR, 'e' + k);
            }
            // 頂点(上90°/下270°は各頂点ちょうど1セルが所有): 3タイル交点のスパイクを覆う
            for (const vd of [
                { ang: Math.PI / 2, n: [[1, -1], [0, -1]], salt: 'vt' },
                { ang: -Math.PI / 2, n: [[-1, 1], [0, 1]], salt: 'vb' },
            ]) {
                if (!vd.n.every(d => isScar(q + d[0], r + d[1]))) continue;
                place(q, r, Math.cos(vd.ang) * R, Math.sin(vd.ang) * R, vd.salt);
            }
        }
    },

    /**
     * 建物ヘックス内でユニットを表示する際、壁/屋根に重ならない位置への
     * オフセット(画面px、ヘックス中心からの相対値)を返す。建物でなければ null。
     * 建物は回転ごとに別画像として焼かれている(固定オフセットが使えない)ため、
     * 実際にロード済みのテクスチャのアルファをその場でサンプリングして求める
     * (2026-07-13: 「壁の影に隠れる」表現のため兵士が建物ヘックスへ進入可に
     * なったのに合わせて追加)。結果はテクスチャキー単位でキャッシュ。
     */
    getBuildingSafeOffset(q, r) {
        const img = this.buildingSprites.get(q + ',' + r);
        if (!img) return null;
        const key = img.texture.key;
        if (this._safeOffsetCache.has(key)) return this._safeOffsetCache.get(key);
        const off = this._computeSafeOffset(img.texture);
        this._safeOffsetCache.set(key, off);
        return off;
    },

    _computeSafeOffset(texture) {
        const s = this.displayScale();
        try {
            const src = texture.getSourceImage();
            const cv = document.createElement('canvas');
            cv.width = this.SRC_W; cv.height = this.SRC_H;
            const ctx = cv.getContext('2d');
            ctx.drawImage(src, 0, 0, this.SRC_W, this.SRC_H);
            const data = ctx.getImageData(0, 0, this.SRC_W, this.SRC_H).data;
            const alphaAt = (x, y) => {
                x = Math.round(x); y = Math.round(y);
                if (x < 0 || y < 0 || x >= this.SRC_W || y >= this.SRC_H) return 0;
                return data[(y * this.SRC_W + x) * 4 + 3];
            };
            // アンカー(=壁の起点)から南寄りの角度で探索。建物はアンカーから北へ
            // 伸びる構造なので南側が最も早く透明(=空き地)になる実測(bldg_s1-5)に
            // 基づく優先順位。半径は小さい順=中心/壁に近い「物陰」を優先。
            // (半径は288px空間基準 — 576px時代の70-170から縮小版に合わせ半減)
            const angles = [90, 70, 110, 50, 130, 30, 150, 10, 170];
            for (const rad of [35, 45, 55, 65, 75, 85]) {
                for (const deg of angles) {
                    const a = deg * Math.PI / 180;
                    const dx = Math.cos(a) * rad, dy = Math.sin(a) * rad;
                    if (alphaAt(this.ANCHOR_X + dx, this.ANCHOR_Y + dy) < 40) {
                        return { dx: dx * s, dy: dy * s };
                    }
                }
            }
        } catch (e) { /* 読み取り不可時はフォールバックへ */ }
        return { dx: 0, dy: 45 * s };   // フォールバック(実測の南オフセット。288px空間換算)
    },

    /**
     * 直撃した建物を1段階損傷させる（データ側 CityMap.damageBuilding と対）。
     * 成功時 true。d2カンストや建物なしは false。
     */
    damageBuilding(scene, q, r) {
        if (!window.gameLogic || !window.CityMap) return false;
        const res = window.CityMap.damageBuilding(window.gameLogic, q, r);
        if (!res) return false;
        const spriteId = q + ',' + r;
        const img = this.buildingSprites.get(spriteId);
        if (!img) return true;
        const key = this.texKey(res.file);
        const requestSerial = (this._buildingDamageSerial.get(spriteId) || 0) + 1;
        this._buildingDamageSerial.set(spriteId, requestSerial);
        const apply = () => {
            if (this._buildingDamageSerial.get(spriteId) === requestSerial &&
                this.buildingSprites.get(spriteId) === img && img.scene &&
                scene.textures.exists(key)) img.setTexture(key);
        };
        if (scene.textures.exists(key)) {
            apply();
        } else {
            scene.load.image(key, `${this.BASE}/${res.file}`);
            scene.load.once('complete', apply);
            scene.load.start();
        }
        return true;
    },

    /**
     * 直撃ヘックスの地面損傷（道路寸断・石畳クレーター化）。建物がある
     * ヘックスは対象外（そちらは damageBuilding が持つ）。損傷段テクスチャは
     * マップ構築時にプリロードしないので、初回は遅延ロード→差し替え。
     */
    damageGround(scene, q, r) {
        if (!window.gameLogic || !window.CityMap) return false;
        const res = window.CityMap.damageGround(window.gameLogic, q, r);
        if (!res) return false;
        const spriteId = q + ',' + r;
        const img = this.groundSprites.get(spriteId);
        if (!img) return true;
        const key = this.texKey(res.file);
        const requestSerial = (this._groundDamageSerial.get(spriteId) || 0) + 1;
        this._groundDamageSerial.set(spriteId, requestSerial);
        const apply = () => {
            if (this._groundDamageSerial.get(spriteId) === requestSerial &&
                this.groundSprites.get(spriteId) === img && img.scene &&
                scene.textures.exists(key)) img.setTexture(key);
        };
        if (scene.textures.exists(key)) {
            apply();
        } else {
            scene.load.image(key, `${this.BASE}/${res.file}`);
            scene.load.once('complete', apply);
            scene.load.start();
        }
        return true;
    }
};

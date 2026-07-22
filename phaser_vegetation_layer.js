'use strict';

var VEGETATION_ASSET_BASE = 'asset/environment/trees_ps/';
var VEGETATION_MANIFEST_URL = VEGETATION_ASSET_BASE + 'manifest.json';
var VEGETATION_SEED = 0x51F0;
var VEGETATION_TREES_PER_HEX = 5;
var VEGETATION_MIN_SPACING = HEX_SIZE * 0.34;
var VEGETATION_SCATTER_RADIUS = HEX_SIZE * 0.62;
var VEGETATION_TARGET_HEIGHT = HEX_SIZE * 1.9;
var VEGETATION_NEIGHBORS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, -1],
    [-1, 1]
];

function vegetationMulberry32(seed) {
    return function () {
        var t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function vegetationTextureKey(filename) {
    return 'veg_' + String(filename).replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
}

function vegetationCellAt(map, q, r) {
    return map &&
        q >= 0 &&
        q < map.length &&
        map[q] &&
        r >= 0 &&
        r < map[q].length
        ? map[q][r]
        : null;
}

function vegetationIsForest(map, q, r) {
    var cell = vegetationCellAt(map, q, r);
    return !!(cell && cell.id === 2);
}

function vegetationHasForestNeighbor(map, q, r) {
    for (var i = 0; i < VEGETATION_NEIGHBORS.length; i++) {
        var neighbor = VEGETATION_NEIGHBORS[i];
        if (vegetationIsForest(map, q + neighbor[0], r + neighbor[1])) {
            return true;
        }
    }
    return false;
}

function vegetationSampleCircle(prng, radius) {
    var distance = radius * Math.sqrt(prng());
    var angle = Math.PI * 2 * prng();

    return {
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance
    };
}

window.VegetationLayer = {
    _layer: null,
    _buildId: 0,

    clear: function (scene) {
        this._buildId++;

        if (this._layer) {
            this._layer.destroy(true);
            this._layer = null;
        }
    },

    build: function (scene, map, opts) {
        var api = this;
        var activeMap = map || (window.gameLogic && window.gameLogic.map);

        this.clear(scene);

        var buildId = this._buildId;

        if (!scene || !activeMap || !Array.isArray(activeMap)) {
            console.warn('[VegetationLayer] scene or map is unavailable.');
            return;
        }

        fetch(VEGETATION_MANIFEST_URL)
            .then(function (response) {
                if (!response || !response.ok) {
                    throw new Error('manifest request failed');
                }
                return response.json();
            })
            .then(function (manifest) {
                if (buildId !== api._buildId) {
                    return;
                }

                if (!manifest || !Array.isArray(manifest.trees) || manifest.trees.length === 0) {
                    console.warn('[VegetationLayer] manifest contains no trees.');
                    return;
                }

                var queuedKeys = {};
                var needsLoading = false;

                manifest.trees.forEach(function (tree) {
                    if (!tree || !tree.body) {
                        return;
                    }

                    var bodyKey = vegetationTextureKey(tree.body);

                    if (!scene.textures.exists(bodyKey) && !queuedKeys[bodyKey]) {
                        scene.load.image(bodyKey, VEGETATION_ASSET_BASE + tree.body);
                        queuedKeys[bodyKey] = true;
                        needsLoading = true;
                    }

                    if (tree.shadow) {
                        var shadowKey = vegetationTextureKey(tree.shadow);

                        if (!scene.textures.exists(shadowKey) && !queuedKeys[shadowKey]) {
                            scene.load.image(shadowKey, VEGETATION_ASSET_BASE + tree.shadow);
                            queuedKeys[shadowKey] = true;
                            needsLoading = true;
                        }
                    }
                });

                var placeTrees = function () {
                    if (buildId !== api._buildId) {
                        return;
                    }

                    var forestHexes = [];
                    var q;
                    var r;

                    for (q = 0; q < activeMap.length; q++) {
                        if (!activeMap[q]) {
                            continue;
                        }

                        for (r = 0; r < activeMap[q].length; r++) {
                            if (activeMap[q][r] && activeMap[q][r].id === 2) {
                                forestHexes.push({ q: q, r: r });
                            }
                        }
                    }

                    if (forestHexes.length === 0) {
                        console.warn('[VegetationLayer] no forest hexes found.');
                        return;
                    }

                    var pools = {
                        conifer: [],
                        broadleaf: []
                    };

                    manifest.trees.forEach(function (tree) {
                        if (!tree || !tree.body || !pools[tree.kind]) {
                            return;
                        }

                        var height = Number(tree.h);
                        var bodyKey = vegetationTextureKey(tree.body);

                        if (!isFinite(height) || height <= 0) {
                            console.warn('[VegetationLayer] invalid tree height:', tree.body);
                            return;
                        }

                        if (!scene.textures.exists(bodyKey)) {
                            console.warn('[VegetationLayer] missing body texture:', bodyKey);
                            return;
                        }

                        var shadowKey = tree.shadow ? vegetationTextureKey(tree.shadow) : null;

                        if (shadowKey && !scene.textures.exists(shadowKey)) {
                            console.warn('[VegetationLayer] missing shadow texture:', shadowKey);
                            shadowKey = null;
                        }

                        // Trees are low-res pixel-art; the game runs pixelArt:false (LINEAR),
                        // which blurs magnified foliage into "green noise". Force NEAREST on
                        // tree textures only so the leaf detail stays crisp when zoomed
                        // (ground/soldiers keep LINEAR).
                        if (Phaser.Textures && Phaser.Textures.FilterMode) {
                            scene.textures.get(bodyKey).setFilter(Phaser.Textures.FilterMode.NEAREST);
                            if (shadowKey) scene.textures.get(shadowKey).setFilter(Phaser.Textures.FilterMode.NEAREST);
                        }

                        pools[tree.kind].push({
                            bodyKey: bodyKey,
                            shadowKey: shadowKey,
                            h: height
                        });
                    });

                    if (pools.conifer.length === 0 && pools.broadleaf.length === 0) {
                        console.warn('[VegetationLayer] no usable tree textures are available.');
                        return;
                    }

                    api._layer = scene.add.layer();
                    api._layer.setDepth(10);

                    var layer = api._layer;
                    var prng = vegetationMulberry32(VEGETATION_SEED);
                    var acceptedPositions = [];
                    var treeCount = 0;

                    function hasMinimumSpacing(px, py) {
                        var minimumSquared = VEGETATION_MIN_SPACING * VEGETATION_MIN_SPACING;

                        for (var i = 0; i < acceptedPositions.length; i++) {
                            var dx = px - acceptedPositions[i].x;
                            var dy = py - acceptedPositions[i].y;

                            if ((dx * dx) + (dy * dy) < minimumSquared) {
                                return false;
                            }
                        }

                        return true;
                    }

                    function selectTree(kind) {
                        var selectedPool = pools[kind];
                        var otherKind = kind === 'conifer' ? 'broadleaf' : 'conifer';

                        if (!selectedPool || selectedPool.length === 0) {
                            selectedPool = pools[otherKind];
                        }

                        if (!selectedPool || selectedPool.length === 0) {
                            return null;
                        }

                        return selectedPool[Math.floor(prng() * selectedPool.length)];
                    }

                    function placeTree(centerX, centerY, tree) {
                        if (!tree) {
                            return false;
                        }

                        for (var attempt = 0; attempt < 8; attempt++) {
                            var offset = vegetationSampleCircle(prng, VEGETATION_SCATTER_RADIUS);
                            var px = centerX + offset.x;
                            var py = centerY + offset.y;

                            if (!hasMinimumSpacing(px, py)) {
                                continue;
                            }

                            var scaleVar = 0.82 + prng() * 0.36;
                            var scale = (VEGETATION_TARGET_HEIGHT / tree.h) * scaleVar;

                            if (tree.shadowKey) {
                                var shadow = scene.add.image(px, py, tree.shadowKey)
                                    .setOrigin(0.5, 0.5)
                                    .setScale(scale)
                                    .setAlpha(0.5)
                                    .setDepth(py - 0.6);

                                layer.add(shadow);
                            }

                            var body = scene.add.image(px, py, tree.bodyKey)
                                .setOrigin(0.5, 1)
                                .setScale(scale)
                                .setDepth(py);

                            layer.add(body);

                            acceptedPositions.push({ x: px, y: py });
                            treeCount++;
                            return true;
                        }

                        return false;
                    }

                    forestHexes.forEach(function (forestHex) {
                        var center = Renderer.hexToPx(forestHex.q, forestHex.r);
                        var hashSeed = (forestHex.q * 73856093) ^ (forestHex.r * 19349663);
                        var dominantKind = ((hashSeed >>> 0) & 1) === 0 ? 'conifer' : 'broadleaf';
                        var otherKind = dominantKind === 'conifer' ? 'broadleaf' : 'conifer';

                        for (var i = 0; i < VEGETATION_TREES_PER_HEX; i++) {
                            var kind = prng() < 0.7 ? dominantKind : otherKind;
                            placeTree(center.x, center.y, selectTree(kind));
                        }
                    });

                    for (q = 0; q < activeMap.length; q++) {
                        if (!activeMap[q]) {
                            continue;
                        }

                        for (r = 0; r < activeMap[q].length; r++) {
                            var cell = activeMap[q][r];

                            if (!cell || cell.id === 2 || cell.id === -1 || typeof cell.id === 'undefined') {
                                continue;
                            }

                            if (!vegetationHasForestNeighbor(activeMap, q, r) || prng() >= 0.25) {
                                continue;
                            }

                            var edgeCenter = Renderer.hexToPx(q, r);
                            var edgeKind = prng() < 0.5 ? 'conifer' : 'broadleaf';

                            placeTree(edgeCenter.x, edgeCenter.y, selectTree(edgeKind));
                        }
                    }

                    if (typeof layer.sort === 'function') {
                        layer.sort('depth');
                    }

                    console.log(
                        '[VegetationLayer] forest hexes=%d trees=%d (conifer/broadleaf pools=%d/%d)',
                        forestHexes.length,
                        treeCount,
                        pools.conifer.length,
                        pools.broadleaf.length
                    );
                };

                if (needsLoading) {
                    scene.load.once('complete', placeTrees);
                    scene.load.start();
                } else {
                    placeTrees();
                }
            })
            .catch(function (error) {
                if (buildId === api._buildId) {
                    console.warn('[VegetationLayer] failed to load manifest:', error);
                }
            });
    }
};

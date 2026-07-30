'use strict';

var VEGETATION_ASSET_BASE = 'asset/environment/trees_ps/';
var VEGETATION_MANIFEST_URL = VEGETATION_ASSET_BASE + 'manifest.json';
var VEGETATION_HD_MANIFEST_URL = 'asset/environment/trees_hd/manifest.json';
var VEGETATION_SEED = 0x51F0;
// v3: trees render at native sprite size (PS 1:1) — roughly 2x the old
// normalized height — so fewer trees per hex with wider spacing.
var VEGETATION_TREES_PER_HEX = 2;
var VEGETATION_MIN_SPACING = HEX_SIZE * 0.85;
var VEGETATION_SCATTER_RADIUS = HEX_SIZE * 0.7;
var VEGETATION_TARGET_HEIGHT = HEX_SIZE * 1.9; // legacy (unused since v3 native scale)
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

function vegetationFetchJson(url, optional) {
    return fetch(url)
        .then(function (response) {
            if (!response || !response.ok) {
                throw new Error('manifest request failed: ' + url);
            }
            return response.json();
        })
        .catch(function (error) {
            if (optional) {
                console.warn('[VegetationLayer] optional HD manifest unavailable:', error);
                return null;
            }
            throw error;
        });
}

function vegetationMergeOverrides(manifest, overrideManifest) {
    if (!manifest || !Array.isArray(manifest.trees) ||
        !overrideManifest || !Array.isArray(overrideManifest.overrides)) {
        return manifest;
    }

    var overridesById = {};
    overrideManifest.overrides.forEach(function (override) {
        if (override && override.id) {
            overridesById[override.id] = override;
        }
    });

    manifest.trees = manifest.trees.map(function (tree) {
        var override = tree && overridesById[tree.id];
        return override ? Object.assign({}, tree, override) : tree;
    });
    return manifest;
}

function vegetationApplySway(scene, body, tree, px, py, baseScale) {
    var sway = tree && tree.sway;
    if (!sway || !sway.enabled || !scene.tweens) {
        return;
    }

    var angle = Number(sway.angleDeg);
    var scaleXAmount = Number(sway.scaleX);
    var duration = Number(sway.durationMs);
    if (!isFinite(angle) || angle <= 0 ||
        !isFinite(scaleXAmount) || scaleXAmount < 0 ||
        !isFinite(duration) || duration <= 0) {
        return;
    }

    var hash = (
        Math.imul(Math.round(px * 16), 73856093) ^
        Math.imul(Math.round(py * 16), 19349663)
    ) >>> 0;
    var direction = (hash & 1) === 0 ? 1 : -1;
    var phaseDelay = (hash >>> 8) % Math.max(1, Math.round(duration));

    scene.tweens.add({
        targets: body,
        angle: { from: -angle * direction, to: angle * direction },
        scaleX: {
            from: baseScale * (1 - scaleXAmount),
            to: baseScale * (1 + scaleXAmount)
        },
        scaleY: baseScale,
        duration: duration * (0.92 + ((hash % 17) / 100)),
        delay: phaseDelay,
        ease: 'Sine.inOut',
        yoyo: true,
        repeat: -1
    });
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

        Promise.all([
            vegetationFetchJson(VEGETATION_MANIFEST_URL, false),
            vegetationFetchJson(VEGETATION_HD_MANIFEST_URL, true)
        ])
            .then(function (manifests) {
                var manifest = vegetationMergeOverrides(manifests[0], manifests[1]);
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

                        // Keep LINEAR (Phaser default). PS renders sprites as GPU textures
                        // with hardware bilinear filtering (config: device:hardware,
                        // driver:direct3d9) — the dither in the source resolves via the HW
                        // sampler at draw scale. NEAREST (an earlier mistake) crisps the
                        // dither into "salt-and-pepper" and is exactly wrong for the PS look.

                        pools[tree.kind].push({
                            bodyKey: bodyKey,
                            shadowKey: shadowKey,
                            h: height,
                            // v3 manifest: exact PS anchor-origin fractions inside the
                            // POT-padded texture (body anchor = trunk base, shadow anchor
                            // shares the same world point).
                            ox: isFinite(tree.ox) ? tree.ox : 0.5,
                            oy: isFinite(tree.oy) ? tree.oy : 1,
                            sox: isFinite(tree.sox) ? tree.sox : 0.5,
                            soy: isFinite(tree.soy) ? tree.soy : 0.5,
                            renderScale: isFinite(tree.renderScale) && tree.renderScale > 0
                                ? tree.renderScale
                                : 1,
                            sampleGuarantee: !!tree.sampleGuarantee,
                            sway: tree.sway || null
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
                    var guaranteedSamplePlaced = false;

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

                        if (!guaranteedSamplePlaced) {
                            for (var i = 0; i < selectedPool.length; i++) {
                                if (selectedPool[i].sampleGuarantee) {
                                    return selectedPool[i];
                                }
                            }
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

                            // PS draws sprites 1:1 into the world buffer (no size
                            // normalization) — on-screen size comes from camera zoom.
                            // Mild variance only; big/small species stay big/small.
                            var scale = (0.9 + prng() * 0.25) * tree.renderScale;

                            if (tree.shadowKey) {
                                // v3 shadows carry TRUE color+coverage (~0.5) from the
                                // differential-blit extraction — no extra alpha needed.
                                var shadow = scene.add.image(px, py, tree.shadowKey)
                                    .setOrigin(tree.sox, tree.soy)
                                    .setScale(scale)
                                    .setDepth(py - 0.6);

                                layer.add(shadow);
                            }

                            var body = scene.add.image(px, py, tree.bodyKey)
                                .setOrigin(tree.ox, tree.oy)
                                .setScale(scale)
                                .setDepth(py);

                            layer.add(body);
                            vegetationApplySway(scene, body, tree, px, py, scale);
                            if (tree.sampleGuarantee) {
                                guaranteedSamplePlaced = true;
                            }

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

# Next-generation RTwP map generator

## Safety boundary

`logic_map_nextgen.js` is a new, self-contained module. It is opt-in
(`NextGenMapGenerator.enabled === false` by default) and does not alter the
RuralV29 or PS battlefield registries. `MapSystem.generate()` calls it before
RuralV29 only when enabled; rejection or an exception falls through to the
existing static map path.

## Generation contract

Given a seed, the generator deterministically produces a 20x20 battlefield
with terrain, roads, a small settlement, cover, elevation, broad team spawn
zones, and suggested enemy initial positions. A candidate is accepted only if:

- a player spawn reaches an enemy spawn;
- the tank-passable connected area covers at least 72% of the board;
- two independent three-hex-wide mass-movement routes cross the battlefield;
- both sides have at least 12 spawn cells;
- cover, open LOS space, hard blockers, and elevated terrain remain within
  tactical bounds.
- a continuous covered approach crosses the map using runtime-passable cells;
- a spawn-to-spawn open lane passes the same cumulative sight-block rules used
  by the RTwP map adapter;
- at least 12 radius-two passable footprints remain available for mortars and
  large formations.

Failed candidates are repaired by deterministic derived seeds, up to 24
attempts. If all attempts fail, `apply()` returns `false` and static-map
fallback remains responsible for the battle.

## Reproducibility and run history

`CampaignManager` owns one `runSeed`. It can be supplied with `?runSeed=...`
for a replay, or is generated once when a new campaign manager is constructed.
Each battle receives the explicit seed `<runSeed>:sector:<number>`.
`create(seed)` and repeated generation of the same run/sector are therefore
reproducible, while different sectors cannot repeat within a run. Effective and
requested seeds are stored in `game.mapScenario` for diagnostics.

The preferred deployment contract contains 24 cells per side. Runtime placement
consumes those cells first, then deterministically fills remaining passable cells
on the same side. `mapScenario.sideCapacity` records the finite capacity; forces
above it are explicitly capped and diagnosed in `enemyDeployment`.

## Rollout

1. Keep disabled in production while property tests and visual review mature.
2. Enable explicitly in a development session and capture seed/validation
   metadata for every rejected battlefield.
3. Run a limited opt-in cohort with static fallback telemetry.
4. Make it the default only after navigation, mortar, large-unit, and renderer
   soak tests show no regression.

## Visual review status

The HTML/PNG review tools are preliminary structural views, not runtime Phaser
scene approval. They expose roads, terrain, elevation metadata, and spawn zones
for rapid seed triage. A rendered runtime-scene soak test remains a rollout
gate before enabling the generator by default.

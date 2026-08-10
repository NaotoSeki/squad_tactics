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

Failed candidates are repaired by deterministic derived seeds, up to 24
attempts. If all attempts fail, `apply()` returns `false` and static-map
fallback remains responsible for the battle.

## Reproducibility and run history

`create(seed)` is pure and reproducible. `apply(game, seed)` keeps a short
in-memory seed history and derives a distinct seed when a requested seed was
already used during the same run. The effective and requested seeds are stored
in `game.mapScenario` for bug reports and replay diagnostics.

## Rollout

1. Keep disabled in production while property tests and visual review mature.
2. Enable explicitly in a development session and capture seed/validation
   metadata for every rejected battlefield.
3. Run a limited opt-in cohort with static fallback telemetry.
4. Make it the default only after navigation, mortar, large-unit, and renderer
   soak tests show no regression.

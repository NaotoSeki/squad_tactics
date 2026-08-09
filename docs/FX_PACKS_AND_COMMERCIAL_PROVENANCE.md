# FX packs and commercial provenance

Gameplay should request logical roles through `window.FxPacks`, not choose a
vendor/source path. Both packs expose the same keys and playback intent.

- `original` is the release default. It uses project-owned KHAOS effects and
  original/procedural work. Missing roles deliberately fall back to runtime VFX.
- `panzer_reference` is a private local benchmark. Select it only on localhost
  with `?fxpack=panzer_reference`. It is never a release dependency.

The current migration is intentionally staged: the registry, selection rules
and packaging guard land first; gameplay call sites can then move one logical
role at a time without changing damage, timing or event dispatch.

## Swap procedure

1. Create an original asset with a provenance sidecar and source hashes.
2. Add it under the same logical key in the `original` pack.
3. Compare locally against `panzer_reference` without branching gameplay.
4. Change only the pack descriptor after approval.
5. Build a release file manifest and run:

```powershell
node scripts/check_release_fx_pack.js path/to/release-files.json
```

The guard rejects a non-original active pack and any bundle path containing
`ps_fx`, `ps_sprites`, `panzer_reference` or Panzer Strike names.

## Commercial-safe production plan

Blender is not currently installed/on PATH in this workspace, so no simulation
was launched. Recommended owned pipeline:

1. Blender/Mantaflow renders separate transparent passes for emissive flame,
   soot volume, embers and optional ground light, with fixed camera/scale.
2. Store `.blend`, Blender version, simulation seed, cache settings, render
   command, source hashes and license declarations.
3. Pack approved passes into atlases; KHAOS may seed owned blast vocabulary where
   the project confirms ownership, but provenance remains explicit.
4. Runtime Fire System controls intensity, fuel, age, wind, size and seed;
   asynchronous particle ages and seeded non-periodic births prevent dancing.
5. Teacher feedback trains/scorers only on owned/generated outputs. Panzer
   observations remain qualitative research principles unless separate rights
   explicitly authorize training.

## Provenance required for every output

Each output sidecar must record `assetId`, logical key, author/tool, tool/model
version, source files and hashes, licenses/ownership, prompts or Blender settings,
seed, generation date, transformations, reviewer decision and release status.

Research-only manifests and decoded reference files must live outside release
file lists. Existing PS-derived runtime smoke/fire/crater material remains a
commercial-release blocker until each role is replaced or excluded.

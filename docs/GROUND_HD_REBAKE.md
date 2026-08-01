# Ground HD background rebake

`scripts/gen_ps_seed_map.py` can bake the low ground layer to a high-density
canvas without changing the PS logical coordinate system used by gameplay and
tall objects.

## Safe default

With no HD options, generation is unchanged:

```powershell
python scripts/gen_ps_seed_map.py --seed 3101
```

The output remains `ps_seed_3101.*` at 1600 × 1000. The regression test compares
the regenerated PNG, battlefield JSON, and object ledger byte-for-byte with the
existing seed.

## Explicit 2x rebake

Both options are required. The manifest `pixelRatio` must match the command:

```powershell
python scripts/gen_ps_seed_map.py `
  --seed 3101 `
  --ground-hd-manifest asset/environment/ground_hd/manifest.json `
  --pixel-ratio 2 `
  --out-dir output/ground_hd_rebake
```

This writes a separate artifact set:

- `ps_seed_3101_ground_hd_x2.png` — 3200 × 2000 physical pixels
- `ps_seed_3101_ground_hd_x2.json` — background projection scale `0.42`
- `ps_seed_3101_ground_hd_x2_objects.json` — original 1600 × 1000 logical
  coordinates and projection scale `0.84`

The `_ground_hd_x2` suffix prevents the existing PS backgrounds from being
overwritten, including when the normal maps directory is selected.

## Composition contract

- Terrain planning, random sampling, placement order, and all logical
  coordinates remain unchanged.
- A matching manifest override is composited at its native 2x size.
- A ground sprite not yet present in the HD manifest is resized from the PS
  canonical sprite with LANCZOS, so partial inventories still produce a
  complete 2x map.
- Canonical slot-0 origins are multiplied by the pixel ratio. Alpha order is
  unchanged.
- Buildings, trees, fences, shrubs, and other tall objects are not baked into
  the background and are not scaled in their ledger.
- `ground_hd_overrides_drawn`, `ground_hd_fallbacks_drawn`, and
  `ground_hd_assets_used` in the battlefield audit show actual override
  coverage.

The baker does not relight generated art. Lighting consistency is therefore an
asset-generation requirement. The current ground manifest fixes the reference
to soft overcast illumination from the upper-left; new overrides must keep that
same direction and contrast.

## Validation

```powershell
python -m unittest tests.test_ps_seed_ground_hd
```

The tests cover exact legacy output preservation, isolated HD filenames,
3200 × 2000 output, background/object projection separation, unchanged tall
object placements, fallback coverage, and manifest ratio validation.

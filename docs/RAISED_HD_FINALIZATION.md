# Raised HD finalization

`scripts/raised_hd_batch.py` prepares one built-in ImageGen BODY job per
canonical body/state slot. After selecting the generated PNG, finalize it with:

```powershell
python scripts/finalize_raised_hd_asset.py `
  --id bench_001_0 `
  --body-slot 2 `
  --generated C:\path\to\selected-built-in-imagegen.png
```

The finalizer copies the selected source to `tmp/raised_hd`, removes the flat
chroma background with the installed ImageGen `remove_chroma_key.py` helper,
and writes:

- `asset/environment/raised_hd/body/<id>_s<slot>_body_hd_v1.png`
- `asset/environment/raised_hd/shadow/<id>_s<slot>_shadow_hd_v1.png` when the
  canonical state has a paired shadow
- `asset/environment/raised_hd/review/<id>_s<slot>_world_review.png`
- `asset/environment/raised_hd/metadata/<id>_s<slot>.json`
- `asset/environment/raised_hd/manifest.json`

BODY and shadow canvases are exactly twice their corresponding canonical
canvases. Runtime manifest origins remain canonical logical `ox`/`oy` values
and each entry declares `pixelRatio: 2`.

The canonical BODY contributes numeric canvas, bbox, origin, contact, and
BODY-to-SHADOW transform calibration. Its alpha is never installed as the
generated BODY alpha. The paired canonical shadow contributes the target
world-origin and projected shape statistics. Its pixels are never copied,
warped, scaled, traced, pasted, or recolored.

The production shadow contract is
`shadow-v4-paired-transform` with the light-only grade:

- fit the paired canonical BODY→SHADOW transform per asset;
- apply that transform to the accepted generated BODY;
- use family-specific source layers: building/fence/prop lower envelope,
  shrub silhouette, and separate tree canopy/trunk projection;
- preserve the generated tree trunk-base notch and cast the trunk lower-right;
- remove the dense shadow core with a soft knee at alpha 52 and a hard
  asymptote/cap of alpha 76;
- keep the body authoritative and the shadow static under
  `ps-overcast-upper-left-v1`.

This contract is implemented by `scripts/shadow_v4_pipeline.py`. New single
assets finalized through `scripts/finalize_raised_hd_asset.py` use it by
default.

Shadowless flattened/prone states emit no shadow. In the world review, the
orange cross is the common logical world origin, the green circle is BODY
contact, the pink square is calibrated shadow contact, and the cyan line is
the required lower-right shadow direction.

Validate all completed outputs and atomically rebuild the runtime manifest:

```powershell
python scripts/validate_raised_hd.py --sync-manifest
```

Require the complete 287 BODY / 252 shadow production set:

```powershell
python scripts/validate_raised_hd.py --sync-manifest --require-complete
```

Per-job metadata is written atomically. Manifest rebuilding is serialized with
a cross-process lock, then rescans all completed sidecars while holding that
lock, so concurrent finalizers cannot regress an entry written by another
process.

To rebuild every completed production shadow without regenerating any BODY:

```powershell
# Stage and validate all 310 shadows without touching production.
python scripts/rebuild_raised_hd_shadows_v4.py

# Back up the previous shadows/metadata, then install V4 light-only.
python scripts/rebuild_raised_hd_shadows_v4.py --commit

# Repackage the 58 map-priority trees for both PS-object and vegetation paths.
python scripts/package_tree_hd_runtime.py
```

The commit backup is written to
`output/shadow_v4_light_backup_20260730/`.

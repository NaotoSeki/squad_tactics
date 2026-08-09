# Panzer Strike runtime effects

These sheets are direct runtime packs of locally installed **Panzer Strike
Demo** SSC/SPL animations. They are not KHAOS assets and were not repainted.

- `ps_fire_cell_00`: body slots 1-133 from `Animations/fire_cell_00.ssc`.
  Slots 151+ are the separate ground-shadow layer and are intentionally not
  packed.
- `ps_fire_cell_01`: alternate body slots 3-137 from
  `Animations/fire_cell_01.ssc`. Slots 153+ are its ground-shadow layer.
- `ps_gun_light_dust_00`: body slots 1-72 from
  `Animations/Guns/gun_light_hit_default_dust_00.ssc`. Slots 76+ are its
  separate shadow layer.
- `ps_gun_medium_smoke_00`: main smoke body slots 6-113 from
  `Animations/Guns/gun_medium_hit_default_smoke_00.ssc`. Tiny leading helper
  slots and the shadow layer at 121+ are not packed.

The adjacent JSON files preserve slot order, SSC anchor, frame geometry,
`frames_per_tick: 1000`, source paths and source hashes. Runtime playback is
30 fps: `PanzerStrike.sdt` declares 30 core updates/second and the source
animation value is 1.000 frame per update. Rebuild from the canonical
differential-blit extraction with:

```powershell
python scripts/build_ps_runtime_fx.py
```

Runtime integration is feature-gated by `PS_ORIGINAL_FX.enabled`; append
`?psfx=0` to disable it. Append `?psfxpreview=1` to show both original fire
variants and the smoke sequence once in the actual MainScene renderer without
changing combat events.

Current mapping: normal grenade and M2 impacts keep the KHAOS T2 burst, then
use the original PS `gun_medium_hit_default_smoke_00` body sequence. The
previous procedural smoke remains the missing-asset fallback. Both fire-cell
variants are exposed to the renderer and gated preview, but are not attached
to a gameplay event until burning-unit/terrain semantics are decided. The
light dust pack remains available for a later event-mapping decision.

No standalone redistribution licence or NOTICE was found in the workspace;
confirm distribution rights before shipping these extracted pixels outside
the owner's project.

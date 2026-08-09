# M2 Mortar impact FX provenance

The M2 impact deliberately combines two existing project effects:

- As an interim fallback, the animated impact shares the baked `t2_grenade`
  KHAOS PNG sheets with normal grenades. Its blast profile remains
  `t3_mortar60`; only the selected visual sheet changed. KHAOS/Blender is a
  build-time source only, and this fallback is not a Panzer Strike asset.
- The persistent impact mark uses the Panzer Strike-derived `medium` crater
  entries declared by `asset/environment/decals/manifest.json` (`source`:
  `ps_sprites_canonical_v1`). M2 calls this tier explicitly and applies only a
  0.50 display multiplier so its 79-97 px native source footprint remains
  roughly 0.42-0.52 of one 93.5 px hex width; the original anchor offsets
  remain intact.
  The M2 path requests a persistent scene decal so the crater stays visible
  even when the PS-native RenderTexture layer is not initialized.

Decoded Panzer Strike explosion/dust/smoke frame families exist only below the
ignored `scratch/ps_sprites_canonical_v1` research tree; no standalone PS
explosion sheet is tracked or loaded at runtime. The project therefore does not
mislabel the KHAOS animation as a PS asset. The repository also contains no
standalone redistribution licence or NOTICE covering either the decoded Panzer
Strike pixels or KHAOS outputs. Existing project notes record the owner's local
reuse direction in `docs/HANDOFF_TO_GPT.md`; distribution outside this project
must confirm the applicable rights separately.

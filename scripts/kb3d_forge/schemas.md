# KB3D Forge JSON Schemas

This document defines the implementation schema emitted by
`catalog_build.py` and `catalog_v8_build.py`, plus the recipe schema consumed
by later forge phases.

## `parts_catalog.json`

```json
{
 "meta": {
  "source": "absolute source blend path",
  "generated": "UTC ISO-8601 timestamp",
  "blender": "Blender version string"
 },
 "parts": [],
 "templates": [],
 "opening_clusters": {},
 "damage_decal_sets": {},
 "debris_pool": [],
 "prop_themes": {}
}
```

### `meta`

| Field | Type | Description |
|---|---|---|
| `source` | string | `bpy.data.filepath` of the source blend. |
| `generated` | string | UTC ISO-8601 generation timestamp. |
| `blender` | string | Blender version reported by `bpy.app.version_string`. |

### `parts[]`

Each entry represents one object in `KB3D_WorldWarTwo-Native` whose name
starts with `KB3D_WWT_` and does not end with `_grp`.

```json
{
 "name": "KB3D_WWT_BldgMdResidential_A_BuildingA",
 "family": "BldgMdResidential",
 "variant": "A",
 "part": "BuildingA",
 "cls": "CORE",
 "grp": "KB3D_WWT_BldgMdResidential_A_grp",
 "rel_loc": [0.0, 0.0, 0.0],
 "rot": [0.0, 0.0, 0.0],
 "scale": [1.0, 1.0, 1.0],
 "dim": [10.0, 6.8, 14.8],
 "bb_min_rel": [-5.0, -3.4, 0.0],
 "bb_max_rel": [5.0, 3.4, 14.8],
 "verts": 34223,
 "mats": ["MaterialName"]
}
```

| Field | Type | Description |
|---|---|---|
| `name` | string | Blender object name. |
| `family` | string | Family parsed from the KB3D name. |
| `variant` | string | Variant parsed from the KB3D name. |
| `part` | string | Part component parsed from the KB3D name. |
| `cls` | string | `CORE`, `OPENING`, `DECAL`, `DEBRIS`, `GROUND`, `STRUCT`, or `PROP`. |
| `grp` | string | Expected group Empty name. |
| `rel_loc` | number[3] | Object location in grp-local coordinates. |
| `rot` | number[3] | Object Euler rotation in radians. |
| `scale` | number[3] | Object scale. |
| `dim` | number[3] | Group-relative transformed bbox extent. |
| `bb_min_rel` | number[3] | Group-relative transformed bbox minimum. |
| `bb_max_rel` | number[3] | Group-relative transformed bbox maximum. |
| `verts` | integer | Mesh vertex count, otherwise `0`. |
| `mats` | string[] | Non-empty material slot names. |

The parser uses:

```text
^KB3D_WWT_([A-Za-z0-9]+?)_([A-Z])(?:_(.+))?$
```

Group Empty objects are not included in `parts`.

### `templates[]`

One template is emitted for every valid `KB3D_WWT_<Family>_<Variant>_grp`
Empty in the target scene.

```json
{
 "name": "BldgMdResidential_A",
 "grp": "KB3D_WWT_BldgMdResidential_A_grp",
 "cores": ["KB3D_WWT_BldgMdResidential_A_BuildingA"],
 "ground": [],
 "struct": [],
 "openings": [],
 "decals": [],
 "debris": [],
 "props": []
}
```

`cores`, `ground`, `struct`, `decals`, `debris`, and `props` contain object
names from `parts`.

Each `openings[]` entry is an anchor occupied by the original source object.

```json
{
 "anchor_id": "BldgMdResidential_A_op_00",
 "occupant": "KB3D_WWT_BldgMdResidential_A_DoorA",
 "kind": "door",
 "rel_loc": [0.0, 0.0, 0.0],
 "rot": [0.0, 0.0, 0.0],
 "dim": [1.0, 0.1, 2.1],
 "cluster": "door_1.0x2.1"
}
```

| Field | Type | Description |
|---|---|---|
| `anchor_id` | string | Stable template-local anchor ID. |
| `occupant` | string | Original opening object name. |
| `kind` | string | `door`, `door_wing`, or `shutter`. |
| `rel_loc` | number[3] | Original occupant grp-relative location. |
| `rot` | number[3] | Original occupant rotation. |
| `dim` | number[3] | Original occupant bbox extent. |
| `cluster` | string | Compatible opening cluster ID. |

Opening kind rules:

- Names containing `Left` or `Right` are `door_wing` when normalized height
  is at least `1.5`.
- Names containing `Left` or `Right` are `shutter` when normalized height is
  below `1.5`.
- Other opening names are `door`.

### `opening_clusters`

Clusters are keyed by normalized kind, width, and height.

```json
{
 "shutter_0.5x1.0": {
  "members": [
   "KB3D_WWT_BldgMdResidential_A_WindowLeftA",
   "KB3D_WWT_BldgMdResidential_A_WindowRightA"
  ],
  "swappable": true
 }
}
```

| Field | Type | Description |
|---|---|---|
| key | string | `<kind>_<width:0.1f>x<height:0.1f>`. |
| `members` | string[] | Compatible opening object names. |
| `swappable` | boolean | `true` only when the cluster has at least two members. |

Width is the longer of the two horizontal bbox extents. Height is the Z bbox
extent. Both values are rounded to `0.1m` in the cluster key.

### `damage_decal_sets`

```json
{
 "bullet": ["...DecalBulletHolesA"],
 "crack": ["...DecalCracksA"],
 "damage": ["...DecalDamageA"],
 "grunge": ["...DecalGrungeA"]
}
```

All four keys always exist. Empty sets are represented by empty arrays.

### `debris_pool`

```json
[
 {
  "name": "KB3D_WWT_BldgMdResidential_A_DebrisK",
  "dim": [1.0, 1.0, 1.0],
  "verts": 9082,
  "size_class": "L"
 }
]
```

`size_class` is `S` for fewer than 500 vertices, `M` for fewer than 5000
vertices, and `L` otherwise.

### `prop_themes`

```json
{
 "military": ["...MachineGunA"],
 "domestic": ["...TableA"],
 "church": ["...AltarA"]
}
```

All three keys always exist. Military matching uses the configured military
keyword list. Church matching uses `Altar`, `Pew`, `BookStand`, and
`Banners`. Remaining PROP objects are domestic.

## `hex_tiles_v8/catalog.json`

`catalog_v8_build.py` keeps the legacy `tiles` and `bases` shapes unchanged and
adds a top-level `multihex_assets` list. The list is always emitted, including
when it is empty. `meta.multihex_count` records its length; `meta.count`
continues to count only legacy `tiles` entries.

```json
{
 "meta": {
  "generated": "UTC ISO-8601 timestamp",
  "count": 0,
  "multihex_count": 1
 },
 "tiles": [],
 "bases": {},
 "multihex_assets": [
  {
   "id": "camp_a_d0",
   "kind": "building",
   "world_scale": 1.0,
   "damage_stage": 0,
   "origin": {"q": 0, "r": 0},
   "pieces": [
    {"q": 0, "r": 0, "file": "camp_a_d0_q0_r0.png"},
    {"q": 1, "r": 0, "file": "camp_a_d0_q1_r0.png"}
   ],
   "occupied_cells": [
    {"q": 0, "r": 0},
    {"q": 1, "r": 0}
   ]
  }
 ]
}
```

### `multihex_assets[]`

| Field | Type | Description |
|---|---|---|
| `id` | string | Required, non-empty, catalog-unique asset ID. |
| `kind` | string | Required, non-empty asset category such as `building`. |
| `world_scale` | number | Required and exactly `1.0`; piece images use the standard tile projection and scale. |
| `origin` | `{q, r}` | Required axial coordinate used as the asset anchor; it must be occupied. |
| `pieces` | object[] | Required non-empty list mapping one axial cell to one relative PNG path. |
| `occupied_cells` | `{q, r}`[] | Required non-empty footprint. Its cell set must exactly equal the `pieces` cell set. |
| `damage_stage` | integer | Optional non-negative damage stage. |

Every `q` and `r` is an integer. Cells must be unique within both `pieces` and
`occupied_cells`; files must be unique within an asset and across the complete
`multihex_assets` list. Paths must be relative to the v8 tile directory and may
not contain `..`. A piece file that already exists is validated as a PNG of
exactly `288x384` pixels. A not-yet-rendered piece path may be cataloged before
the image exists.

Multi-hex data is loaded in this order:

1. The file passed with `--multihex-manifest`.
2. `<v8-dir>/multihex_assets.json` when it exists.
3. The `multihex_assets` list in the existing output catalog, preserving it
   across a legacy catalog rebuild.
4. An empty list.

A manifest may be either the list itself or an object whose
`multihex_assets` field contains the list. PNGs explicitly claimed by a
multi-hex asset are not duplicated in the legacy `tiles` list. All other
legacy parsing and `bases` generation remains unchanged.

## `recipe.json`

`core_keep` is an optional non-empty list of exact source object names from the
selected template's `cores`. When omitted, all template cores are spawned as
before. When present, only listed cores are spawned, retaining template order;
unknown names, non-string entries, and duplicate names are invalid.
`core_swaps` is applied only to the selected core slots.

The recipe format is reserved for the recombination phase (P2). The
authoritative recipe contract lives in `docs/KB3D_FORGE_DESIGN.md` section
4.2; P2 implementation must follow the design document. P1 does not read or
write recipes.

Opening replacements must select an occupant from the same
`opening_clusters` entry as the anchor's original occupant.

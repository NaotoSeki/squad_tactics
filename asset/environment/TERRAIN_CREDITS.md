# Terrain texture credits

## v1.0 hex tiles (`hex_tiles/`)

Procedural military-map style tiles from `v1.0.zip` (OpenSimplex noise fields).

- Import: `python scripts/import_v1_terrain.py`
- Regenerate: `pip install numpy pillow opensimplex` → `python scripts/terrain_v1/generate_tiles.py` → import again
- In-game: `TerrainRender.useV1Tiles = true` in `phaser_terrain.js`

## Legacy CC0 sources (`terrain_*.jpg`)

| File | Source | License |
|------|--------|---------|
| terrain_dirt.jpg, terrain_town.jpg | [ambientCG Ground 103](https://ambientcg.com/a/Ground103) | CC0 |
| terrain_grass.jpg | [ambientCG Ground 079S](https://ambientcg.com/a/Ground079s) | CC0 |
| terrain_forest.jpg | [ambientCG Ground 086](https://ambientcg.com/a/Ground086) | CC0 |
| terrain_road.jpg | [ambientCG Road 005](https://ambientcg.com/a/Road005) | CC0 |

Used by `scripts/build_hex_tile_parts.py` when `useV1Tiles` is false.

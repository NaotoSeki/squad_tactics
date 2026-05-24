# Hex terrain tiles (v1.0)

Imported from `v1.0.zip` via `scripts/import_v1_terrain.py`.

## Files
- `hex_{terrain}_{0-5}.png` — grass / forest / water / dirt variants
- `hex_trans_{a}_{b}_d{0-5}.png` — boundary transitions (higher-priority neighbor)
- `hex_{terrain}.png` — alias of variant 0

## Regenerate source tiles
```powershell
pip install numpy pillow opensimplex
python scripts/terrain_v1/generate_tiles.py
python scripts/import_v1_terrain.py
```

In-game: `TerrainRender.useV1Tiles = true` in `phaser_terrain.js`.
Size: 202×233 px, scale `1/HIGH_RES_SCALE`.

# Hex terrain tile parts
 
## Base terrain (`hex_*.png`)
dirt / grass / forest / town / water
 
## Roads / Trenches (`roads/m00.png` … `roads/m3f.png`)
**14 rotation base variants** from 6-bit neighbor mask (dir order = `logic_map.getNeighbors`).
Other 50 patterns are rotated at runtime in Phaser client.
 
Regenerate:
```powershell
python scripts/build_hex_tile_parts.py
```
 
Size: 202×233px, scale `1/HIGH_RES_SCALE`.

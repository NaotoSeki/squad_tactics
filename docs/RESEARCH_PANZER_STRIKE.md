# RESEARCH: Panzer Strike Architecture and Integration Essences

*Date: 2026-07-19*
*Target: Panzer Strike Demo*

## 1. Directory and Architecture Overview
- **Location:** `Data\Game\Common\`
- **Configs (`Configs\`):** Uses a proprietary key-value text format (`*.sdt`) instead of XML or JSON. Includes deeply decoupled definitions for units, buildings, craters, hotkeys, etc. Data is separated logically (e.g. `Units\German`, `Units\Soviet`).
- **Media (`Media\Objects\`):** Contains highly granular layers for terrain and environment: `Buildings, Trees, Grass, Fields, Roads, Craters, Fences, Stones, Sticks, Spots` etc. (Over 17 categories).
- **Locales (`Locales\`):** Display strings are fully decoupled from internal keys using `*.sdt` files per language.

## 2. Asset Format (.ssc & .spl)
- **.spl:** 1024-byte files (1020 bytes of payload). Contains 255 colors (BGRA), likely acting as a color palette.
- **.ssc:** The main sprite binary. Analysis shows a 32-byte header, with the first word likely indicating frames/layers (e.g. 15 or 12).
- **Design:** By using palettized index color formats, the game can easily swap palettes for different variants (e.g., `ver_01`, `ver_02` share the exact same `.ssc` structure but different `.spl`).

## 3. Essences for Squad Tactics Integration
1. **Decal-based Organic Terrain (Overcoming 1-hex = 1-object limit):**
   Instead of forcing assets to fit within a single hex geometry, Squad Tactics should use the base hex merely as a logical grid and render trees, fences, craters, and roads as free-floating sprite decals (overlays).
2. **SSC Extraction (T1):**
   Build an extractor (`ssc_decode.py`) to convert `.ssc/.spl` into transparent PNGs, giving Squad Tactics access to authentic, high-fidelity WW2 environment assets (especially Trees and Craters).
3. **Data-Driven Catalogs:**
   Adopt the `sdt` philosophy by fully moving unit/building properties out of hardcoded JS logic into strict, declarative JSON catalogs (`parts_catalog.json` equivalent for logic).

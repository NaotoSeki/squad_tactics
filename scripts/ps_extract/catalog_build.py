"""Build a catalog (manifest + contact sheets) for the re-extracted PS sprites.

Reads the game's SSC headers (authoritative slot metadata: format_id, origin,
w/h) and pairs them with the driver-rendered PNGs in scratch/ps_sprites_v2.

Outputs:
  scratch/ps_sprites_v2/catalog.json       full manifest (per sprite -> slots)
  scratch/ps_map_decode/catalog/<cat>.jpg  per-category contact sheet (body slot)

Slot semantics (observed): body slots carry format_id 723/715 and are the
largest-area frame; shadow slots carry format_id 934 and are wide/flat. The
manifest records every slot's format_id so downstream can pick body vs shadow;
contact sheets show the largest-area (body) slot per sprite.
"""
from __future__ import annotations
import json, sys
from pathlib import Path
from collections import defaultdict
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ssc_format import read_ssc

PS = Path(r"C:\Program Files (x86)\Steam\steamapps\common\Panzer Strike Demo")
MEDIA = PS / "Data" / "Game" / "Common" / "Media"
V2 = Path(r"C:\Projects\squad_tactics\scratch\ps_sprites_v2")
SHEETS = Path(r"C:\Projects\squad_tactics\scratch\ps_map_decode\catalog")
SHADOW_FMT = 934  # observed shadow format


def build():
    from reextract_all import find_spl  # reuse the corrected palette matcher
    manifest = {}
    cat_sprites = defaultdict(list)   # category -> [(name, body_png, w, h)]
    n_sprites = n_slots = 0
    for ssc in sorted(MEDIA.rglob("*.ssc")):
        rel = ssc.relative_to(MEDIA).with_suffix("")
        category = rel.parts[0] if len(rel.parts) > 1 else "root"
        try:
            f = read_ssc(ssc)
        except Exception:
            continue
        spl = find_spl(ssc)
        slots = []
        for fr in f.frames:
            if fr.is_empty:
                continue
            png = V2 / rel.parent / f"{rel.name}_s{fr.slot}.png"
            if not png.exists():
                continue
            w, h = Image.open(png).size
            slots.append({
                "slot": fr.slot, "format_id": fr.format_id,
                "origin_x": fr.origin_x, "origin_y": fr.origin_y,
                "src_w": fr.width, "src_h": fr.height,
                "png_w": w, "png_h": h,
                "is_shadow": fr.format_id == SHADOW_FMT,
                "png": str(png.relative_to(V2)).replace("\\", "/"),
            })
            n_slots += 1
        if not slots:
            continue
        # primary = largest-area non-shadow slot (fallback: largest)
        bodies = [s for s in slots if not s["is_shadow"]] or slots
        primary = max(bodies, key=lambda s: s["png_w"] * s["png_h"])
        manifest[str(rel).replace("\\", "/")] = {
            "category": category, "name": rel.name,
            "palette": spl.name if spl else None,
            "primary_slot": primary["slot"], "slot_count": len(slots),
            "slots": slots,
        }
        cat_sprites[category].append((rel.name, V2 / primary["png"], primary["png_w"], primary["png_h"]))
        n_sprites += 1

    V2.mkdir(parents=True, exist_ok=True)
    (V2 / "catalog.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")

    # per-category contact sheets (one primary/body slot per sprite family)
    SHEETS.mkdir(parents=True, exist_ok=True)
    summary = []
    for cat, sprites in sorted(cat_sprites.items()):
        cell = 96
        cols = 12
        rows = (len(sprites) + cols - 1) // cols
        sheet = Image.new("RGBA", (cols * cell, rows * cell), (60, 66, 52, 255))
        for i, (name, png, w, h) in enumerate(sprites):
            im = Image.open(png).convert("RGBA")
            if max(im.size) > cell - 10:
                im.thumbnail((cell - 10, cell - 10))
            elif max(im.size) < 26:
                im = im.resize((im.size[0] * 3, im.size[1] * 3), Image.NEAREST)
            x = (i % cols) * cell + (cell - im.size[0]) // 2
            y = (i // cols) * cell + (cell - im.size[1])   # foot-align
            sheet.alpha_composite(im, (x, max(0, y)))
        sheet.convert("RGB").save(SHEETS / f"{cat}.jpg", "JPEG", quality=85)
        summary.append((cat, len(sprites)))

    print(f"catalog: {n_sprites} sprites, {n_slots} slots")
    print("per-category (sprite families):")
    for cat, n in summary:
        print(f"  {cat:14} {n}")
    print(f"manifest: {V2/'catalog.json'}")
    print(f"sheets:   {SHEETS}")


if __name__ == "__main__":
    build()

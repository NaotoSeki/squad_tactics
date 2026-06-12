# -*- coding: utf-8 -*-
"""
GUNIW / ILIST の等分割プレビュー + ITEML セグメントへのパレット適用（複数パレット試行）。

出力:
  asset/pl_weapons/_atlas_grid_probe/GUNIW_01/cols{c}_rows{r}/cell_XX.png
  asset/pl_weapons/_atlas_grid_probe/...
  asset/pl_weapons/_iteml_segment_paletted/{pal_name}/seg{nn}_256x240.png
  scripts/pl_decoded/guniw_ilist_iteml_probe_meta.json
"""
from __future__ import annotations

import json
import os
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from extract_pl_cbe_weapon_icons import (  # noqa: E402
    dib_to_image,
    find_pl_dir,
    get_rt_bitmap_by_name,
    slice_atlas_row_major,
)
from extract_ne_resources import parse_ne_resources  # noqa: E402

try:
    from PIL import Image
except ImportError:
    print("ERROR: pip install Pillow")
    sys.exit(1)

OUT_ATLAS = ROOT / "asset" / "pl_weapons" / "_atlas_grid_probe"
OUT_ITEML = ROOT / "asset" / "pl_weapons" / "_iteml_segment_paletted"
META = ROOT / "scripts" / "pl_decoded" / "guniw_ilist_iteml_probe_meta.json"

ATLAS_CONFIG: list[dict] = [
    {
        "name": "IDB_GUNIW_01",
        "suggested_grids": [
            (2, 2),
            (4, 4),
            (5, 4),
            (8, 4),
            (10, 4),
            (20, 4),
            (20, 8),
            (25, 7),
        ],
        "max_cells": 200,
    },
    {
        "name": "IDB_GUNIW_10",
        "suggested_grids": [
            (1, 1),
            (2, 1),
            (4, 1),
            (5, 1),
            (8, 1),
            (10, 1),
            (10, 2),
            (20, 1),
            (20, 2),
            (25, 2),
        ],
        "max_cells": 200,
    },
    {
        "name": "IDB_ILIST_00",
        "suggested_grids": [
            (2, 2),
            (4, 4),
            (4, 16),
            (5, 4),
            (10, 4),
            (20, 4),
            (31, 4),
            (31, 16),
        ],
        "max_cells": 200,
    },
]


def ne_segments(d: bytes, ne: int) -> list[tuple[int, int, int]]:
    nseg = struct.unpack_from("<H", d, ne + 0x1C)[0]
    st_off = struct.unpack_from("<H", d, ne + 0x22)[0]
    al = struct.unpack_from("<H", d, ne + 0x32)[0]
    segs: list[tuple[int, int, int]] = []
    base = ne + st_off
    for i in range(nseg):
        o = base + i * 8
        if o + 8 > len(d):
            break
        ro = struct.unpack_from("<H", d, o)[0] << al
        sl = struct.unpack_from("<H", d, o + 2)[0] or 65536
        segs.append((i + 1, ro, min(ro + sl, len(d))))
    return segs


def pil_to_palette_rgb256(im: Image.Image) -> bytes:
    """256x3 RGB for PUTPALETTE style."""
    if im.mode != "P":
        im = im.convert("P", palette=Image.ADAPTIVE, colors=256)
    pal = im.getpalette()
    if not pal or len(pal) < 768:
        return bytes(768)
    return bytes(pal[:768])


def apply_palette_8bit(buf: bytes, w: int, h: int, pal_rgb: bytes) -> Image.Image:
    if len(buf) < w * h:
        return Image.new("RGB", (w, h), (0, 0, 0))
    b = buf[: w * h]
    pal = list(pal_rgb[:768]) + [0] * (768 - min(len(pal_rgb), 768))
    im = Image.frombytes("P", (w, h), b)
    im.putpalette(pal)
    return im.convert("RGB")


def export_atlases(p_intermis: dict) -> list[dict]:
    rows: list[dict] = []
    for ac in ATLAS_CONFIG:
        name = ac["name"]
        im = get_rt_bitmap_by_name(p_intermis, name)
        if im is None:
            rows.append({"atlas": name, "error": "missing"})
            continue
        im = im.convert("RGBA")
        iw, ih = im.size
        rec: dict = {"atlas": name, "size": [iw, ih], "grids": []}
        for cols, rws in ac["suggested_grids"]:
            if cols < 1 or rws < 1:
                continue
            cells = slice_atlas_row_major(im, cols, rws, ac["max_cells"])
            if not cells:
                continue
            cw, ch = cells[0].size
            sub = OUT_ATLAS / name / f"cols{cols}_rows{rws}"
            sub.mkdir(parents=True, exist_ok=True)
            for i, cim in enumerate(cells):
                cim.save(sub / f"cell_{i:03d}.png", "PNG")
            rec["grids"].append(
                {
                    "cols": cols,
                    "rows": rws,
                    "n": len(cells),
                    "cell_wh": [cw, ch],
                    "dir": str(sub.relative_to(ROOT)),
                }
            )
        rows.append(rec)
    return rows


def export_iteml_paletted(
    pl: Path, palettes: dict[str, bytes], wh_list: list[tuple[int, int, str]]
) -> list[dict]:
    path = pl / "ITEML.DLL"
    d = path.read_bytes()
    ne = struct.unpack_from("<I", d, 0x3C)[0]
    if d[ne : ne + 2] != b"NE":
        return [{"error": "not NE"}]
    segs = ne_segments(d, ne)
    out: list[dict] = []
    for pal_name, pal in palettes.items():
        pdir = OUT_ITEML / pal_name.replace("/", "_")
        pdir.mkdir(parents=True, exist_ok=True)
        n = 0
        for seg_i, s, e in segs:
            chunk = d[s:e]
            for w, h, label in wh_list:
                need = w * h
                if len(chunk) < need:
                    continue
                raw = chunk[:need]
                try:
                    im = apply_palette_8bit(raw, w, h, pal)
                except Exception:
                    continue
                fn = f"seg{seg_i:02d}_{w}x{h}_{label}.png"
                im.save(pdir / fn, "PNG")
                n += 1
                if n >= 120:
                    break
            if n >= 120:
                break
        out.append(
            {
                "palette": pal_name,
                "wrote": n,
                "dir": str(pdir.relative_to(ROOT)),
            }
        )
    return out


def main() -> int:
    pl = find_pl_dir()
    if not pl:
        print("PL_DIR / D:/PL なし")
        return 1
    inter = pl / "INTERMIS.DLL"
    if not inter.is_file():
        print("INTERMIS なし")
        return 1
    p = parse_ne_resources(str(inter))
    if p.get("error"):
        print(p["error"])
        return 1

    data = p["data"]
    palettes: dict[str, bytes] = {}
    for nm in (
        "IDB_GUNIW_10",
        "IDB_GUNIW_01",
        "IDB_ILIST_00",
        "IDB_ITEM_01",
    ):
        for rtype in p.get("resource_types", []):
            if rtype.get("type_id") != 0x8002:
                continue
            for e in rtype.get("entries", []):
                if str(e.get("name", "")) != nm:
                    continue
                off, ln = e["offset"], e["length"]
                if off + ln > len(data):
                    continue
                im = dib_to_image(data[off : off + ln])
                if im:
                    palettes["from_" + nm] = pil_to_palette_rgb256(im)
                break

    if not palettes:
        palettes["gray_ramp_256"] = bytes([i % 256 for i in range(768)])

    if "from_IDB_GUNIW_10" not in palettes and palettes:
        palettes["first_available"] = next(iter(palettes.values()))
    if "gray_ramp_256" not in palettes:
        palettes["gray_ramp_256"] = bytes([i % 256 for i in range(768)])

    # ITEML: 主な 61440=256*240, 他候補
    wh_list = [
        (256, 240, "256x240"),
        (320, 192, "320x192"),
        (160, 384, "160x384"),
        (128, 480, "128x480"),
        (200, 307, "200x307"),
    ]

    iteml_res = export_iteml_paletted(pl, palettes, wh_list) if (pl / "ITEML.DLL").is_file() else []

    atlas_res = export_atlases(p)

    doc = {
        "_meta": {
            "pl": str(pl),
            "palettes_tried": list(palettes.keys()),
        },
        "atlases": atlas_res,
        "iteml": iteml_res,
    }
    OUT_ATLAS.parent.mkdir(parents=True, exist_ok=True)
    META.parent.mkdir(parents=True, exist_ok=True)
    META.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    print("WROTE", OUT_ATLAS, OUT_ITEML, META)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

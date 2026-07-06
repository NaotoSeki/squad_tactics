# -*- coding: utf-8 -*-
"""
ITEML 精査（価値順の入口）: 8bpp DIB で 61440B にピッタリ合う (w,h) 系統は主に2つ
  - row=256 → 256×240（従来）
  - row=240 → 240×256（縦横入替。ストライドは同じ 61440）
GUNIW_10 256 色で PNG を両方出し、scripts/pl_decoded/iteml_families_8bpp_61440.json に記録。

  python scripts\\pl_iteml_refine_todo.py
"""
from __future__ import annotations

import io
import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from extract_pl_cbe_weapon_icons import dib_to_image
from extract_ne_resources import build_bmp_file, parse_ne_resources  # noqa: E402
from probe_iteml_stride_decode import (  # noqa: E402
    ne_segments,
    extract_bgr_256_parsed,
    unpack_8_dib,
    build_dib8,
)

from PIL import Image

PL = Path("D:/PL")
OUT = ROOT / "asset" / "pl_weapons" / "_iteml_refine"
JSON = ROOT / "scripts" / "pl_decoded" / "iteml_families_8bpp_61440.json"


def row8(w: int) -> int:
    return ((w * 8 + 31) // 32) * 4


def main() -> int:
    if not (PL / "ITEML.DLL").is_file():
        print("D:/PL/ITEML.DLL なし")
        return 1
    d = (PL / "ITEML.DLL").read_bytes()
    ne = struct.unpack_from("<I", d, 0x3C)[0]
    segs = ne_segments(d, ne)
    # seg2 = index 1 in 1-based
    s2 = next(s for s in segs if s[0] == 2)
    buf = d[s2[1] : s2[2]]
    if len(buf) != 61440:
        print("seg2 len", len(buf), "expected 61440")
        return 1
    p_in = parse_ne_resources(str(PL / "INTERMIS.DLL"))
    bgr256, rgb3 = extract_bgr_256_parsed(p_in)

    fams: list[dict] = []
    # 61440=8×w×h の DIB 厳密解は、行 256B→h240 と行 240B→h256 の2系統が主
    for w in (256, 240):
        r = row8(w)
        h = 61440 // r
        if r * h != 61440:
            continue
        inds = unpack_8_dib(buf, w, h)
        if not inds:
            continue
        dib = build_dib8(inds, w, h, bgr256)
        bmp = build_bmp_file(dib)
        im = Image.open(io.BytesIO(bmp)).convert("RGB")
        OUT.mkdir(parents=True, exist_ok=True)
        fn = f"seg2_8bpp_GUNIW10_{w}x{h}_rowbytes{r}.png"
        im.save(OUT / fn, "PNG")
        fams.append(
            {
                "w": w,
                "h": h,
                "row_bytes": r,
                "out": str((OUT / fn).relative_to(ROOT)),
            }
        )
    (JSON).parent.mkdir(parents=True, exist_ok=True)
    JSON.write_text(
        json.dumps(
            {
                "_meta": {
                    "note": "61440=8bpp DIB 完全消費の主な幅。256x240 以外に 240x256(実寸 w×h)系あり",
                },
                "variants": fams,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print("WROTE", OUT, JSON)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

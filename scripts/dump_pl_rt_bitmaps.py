# -*- coding: utf-8 -*-
"""
D:\\PL 内の NE モジュールから RT_BITMAP をすべて PNG 化する（人間が目視して用途を判別する用）。

ITEML.DLL / ITEMS.DLL 等はリソース表がこのリポの parse と相性が悪く RT_BITMAP 0 件になり得る。
INTERMIS.DLL は 100 件台のビットマップが取れるが、多くは UI（一次調査結果）。

使用:
  set PL_DIR=D:\\PL
  python scripts/dump_pl_rt_bitmaps.py
  python scripts/dump_pl_rt_bitmaps.py INTERMIS.DLL
"""
from __future__ import annotations

import io
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from extract_ne_resources import build_bmp_file, parse_ne_resources  # noqa: E402

try:
    from PIL import Image
except ImportError:
    print("ERROR: pip install Pillow")
    sys.exit(1)

SAFE = re.compile(r"[^0-9A-Za-z._-]+")


def find_pl() -> Path | None:
    for k in ("PL_DIR", "PL_ROOT"):
        v = os.environ.get(k)
        if v:
            p = Path(v)
            if p.is_dir():
                return p
    for p in (Path("D:/PL"), Path("C:/PL")):
        if p.is_dir():
            return p
    return None


def dib_to_rgba(dib: bytes) -> Image.Image | None:
    bmp = build_bmp_file(dib)
    if not bmp:
        return None
    try:
        return Image.open(io.BytesIO(bmp)).convert("RGBA")
    except Exception:
        return None


def dump_dll(path: Path, out_dir: Path) -> tuple[int, int]:
    p = parse_ne_resources(str(path))
    if p.get("error"):
        print(path.name, "error:", p["error"])
        return 0, 0
    data = p["data"]
    ok, skip = 0, 0
    seen: dict[str, int] = {}
    out_dir.mkdir(parents=True, exist_ok=True)
    for rtype in p.get("resource_types", []):
        if rtype.get("type_id") != 0x8002:
            continue
        for ei, entry in enumerate(rtype.get("entries", [])):
            name = str(entry.get("name", "")) or f"num_{ei}"
            off = entry.get("offset", 0)
            ln = entry.get("length", 0)
            if off + ln > len(data) or ln < 40:
                skip += 1
                continue
            dib = data[off : off + ln]
            im = dib_to_rgba(dib)
            if im is None:
                skip += 1
                continue
            w, h = im.size
            key = f"{name}_{w}x{h}"
            seen[key] = seen.get(key, 0) + 1
            n = seen[key]
            base = f"{SAFE.sub('_', name)}_{w}x{h}"
            if n > 1:
                base = f"{base}_{n:02d}"
            im.save(out_dir / f"{base}.png", "PNG")
            ok += 1
    return ok, skip


def main() -> int:
    pl = find_pl()
    if not pl:
        print("PL_DIR / D:/PL がありません。")
        return 1
    dllname = (sys.argv[1] if len(sys.argv) > 1 else "INTERMIS.DLL").strip()
    path = pl / dllname
    if not path.is_file():
        print("not found:", path)
        return 1
    out = ROOT / "asset" / "pl_weapons" / f"_rt_bitmap_{path.stem.lower()}"
    o, s = dump_dll(path, out)
    index = {
        "plDir": str(pl),
        "dll": dllname,
        "outDir": str(out),
        "savedPng": o,
        "skippedEntries": s,
    }
    idxp = ROOT / "scripts" / "pl_decoded" / f"pl_rt_bitmap_dump_{path.stem.lower()}.json"
    import json

    idxp.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Wrote", o, "PNG ->", out, "skipped", s, "index", idxp)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

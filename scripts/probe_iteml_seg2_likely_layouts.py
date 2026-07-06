# -*- coding: utf-8 -*-
"""
ITEML seg2==61440B の「確からしい」8bpp DIB 解（横長アトラス含む）を一括で PNG 化し、
粗いフォーカス指標で sort。主副付スロット向け**横長**は 512x120, 480x128, 384x160 等。

  python scripts\\probe_iteml_seg2_likely_layouts.py

  asset/pl_weapons/_iteml_seg2_likely/ + scripts/pl_decoded/iteml_seg2_likely_layouts.json
"""
from __future__ import annotations

import io
import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from extract_ne_resources import build_bmp_file, parse_ne_resources
from probe_iteml_stride_decode import (
    build_dib4,
    build_dib8,
    extract_bgr_256_parsed,
    luma_from_idx4,
    luma_from_idx8,
    ne_segments,
    unpack_4_dib,
    unpack_8_dib,
)

OUT = ROOT / "asset" / "pl_weapons" / "_iteml_seg2_likely"
REPORT = ROOT / "scripts" / "pl_decoded" / "iteml_seg2_likely_layouts.json"
PL = Path("D:/PL")

try:
    import numpy as np
except ImportError:
    print("需要 numpy: pip install numpy")
    np = None


def focus_var(g: "np.ndarray") -> float:
    """ラプラシアン分散（大きいほど輪郭がはっきり）。"""
    if np is None or g.size < 9:
        return 0.0
    t = g.astype(np.float32)
    lap = (
        4 * t[1:-1, 1:-1]
        - t[:-2, 1:-1]
        - t[2:, 1:-1]
        - t[1:-1, :-2]
        - t[1:-1, 2:]
    )
    return float(np.var(lap))


def stripe_penalty(g: "np.ndarray") -> float:
    """横縞（行差分がデカい鋸波）のペナルティ。"""
    if np is None or g.shape[0] < 3:
        return 0.0
    m = g.mean(axis=1)
    d = np.abs(np.diff(m))
    return float(np.mean(d) / (1e-6 + np.std(g)))


def deinterlace_maxpair(inds: bytes, w: int, h: int) -> bytes:
    """隣行ペアの max を1行に畳む（h 偶数想定、高さ1/2）。"""
    a = np.frombuffer(inds, dtype=np.uint8).reshape((h, w))
    h2 = h // 2
    if h2 * 2 != h:
        return inds
    b = np.maximum(a[0::2, :], a[1::2, :]).astype(np.uint8)
    return b.tobytes()


def main() -> int:
    if not (PL / "ITEML.DLL").is_file():
        print("D:/PL/ITEML.DLL なし")
        return 1
    if np is None:
        return 1
    d = (PL / "ITEML.DLL").read_bytes()
    ne = struct.unpack_from("<I", d, 0x3C)[0]
    s2 = next(s for s in ne_segments(d, ne) if s[0] == 2)
    buf = d[s2[1] : s2[2]]
    if len(buf) != 61440:
        print("seg2 len", len(buf))
        return 1
    p = parse_ne_resources(str(PL / "INTERMIS.DLL"))
    bgr256, rgb3 = extract_bgr_256_parsed(p)
    rgb16 = bytes([rgb3[i] for i in range(16 * 3)])
    bgr16 = bgr256[: 16 * 4]

    def row8(w: int) -> int:
        return ((w * 8 + 31) // 32) * 4

    def row4(w: int) -> int:
        return ((w * 4 + 31) // 32) * 4

    L = 61440
    exact_wh: list[tuple[int, int]] = []
    for w in range(8, 2000):
        r = row8(w)
        if r <= 0 or L % r:
            continue
        hh = L // r
        if r * hh != L or hh < 4 or w < 8:
            continue
        exact_wh.append((w, hh))

    def plausible_ui(wh: tuple[int, int]) -> bool:
        w, h = wh
        if w < 100 or h < 48 or w > 1200 or h > 400:
            return False
        ar = w / h
        if ar < 0.4 or ar > 10.0:
            return False
        return True

    exact_ui = [t for t in exact_wh if plausible_ui(t)]
    if not exact_ui:
        exact_ui = exact_wh

    rows: list[dict] = []
    OUT.mkdir(parents=True, exist_ok=True)

    def save_png(name: str, w: int, h: int, inds: bytes) -> dict:
        if len(inds) != w * h:
            return {"error": "len"}
        dib = build_dib8(inds, w, h, bgr256)
        bmp = build_bmp_file(dib)
        from PIL import Image

        im = Image.open(io.BytesIO(bmp))
        path = OUT / name
        im.save(path, "PNG")
        lum = luma_from_idx8(inds, w, h, rgb3)
        fv = focus_var(lum)
        sp = stripe_penalty(lum)
        score = fv / (1.0 + 2.0 * sp)
        return {
            "w": w,
            "h": h,
            "file": str(path.relative_to(ROOT)),
            "focus_lap_var": round(fv, 3),
            "stripe_pen": round(sp, 3),
            "score": round(score, 3),
        }

    for w, h in exact_ui[: 40]:
        inds = unpack_8_dib(buf, w, h)
        if not inds:
            continue
        name = f"8bpp_dib_w{w}_h{h}.png"
        r = save_png(name, w, h, inds)
        r["label"] = "8_dib"
        rows.append(r)

    w, h = 256, 240
    ind0 = unpack_8_dib(buf, w, h)
    if ind0 and h % 2 == 0:
        ind_di = deinterlace_maxpair(ind0, w, h)
        rw, rh = w, h // 2
        r = save_png(f"8bpp_256x240_deint_maxpair_w{w}_h{rh}.png", rw, rh, ind_di)
        r["label"] = "deint_maxpair"
        rows.append(r)

    two_w, two_h = 256, 120
    if two_w * two_h * 2 == 61440:
        a0 = np.frombuffer(buf[0:30720], dtype=np.uint8).reshape((two_h, two_w))
        a1 = np.frombuffer(buf[30720:61440], dtype=np.uint8).reshape((two_h, two_w))
        merged = np.maximum(a0, a1).astype(np.uint8).tobytes()
        r = save_png(
            f"8bpp_twoPlane256x120_max_{two_w}x{two_h}.png", two_w, two_h, merged
        )
        r["label"] = "2plane_256x120_max"
        rows.append(r)
        side = np.hstack((a0, a1))
        bts = side.astype(np.uint8).tobytes()
        r2 = save_png(f"8bpp_twoPlane512x120_sidebyside.png", 512, two_h, bts)
        r2["label"] = "2plane_512x120_h"
        rows.append(r2)

    exact4: list[tuple[int, int]] = []
    for w in range(40, 800):
        r = row4(w)
        if r <= 0 or L % r:
            continue
        hh = L // r
        if r * hh != L:
            continue
        if plausible_ui((w, hh)):
            exact4.append((w, hh))
    for w, h in exact4[: 12]:
        ind4 = unpack_4_dib(buf, w, h)
        if not ind4:
            continue
        dib = build_dib4(ind4, w, h, bgr16)
        bmp = build_bmp_file(dib)
        from PIL import Image

        im = Image.open(io.BytesIO(bmp))
        name = f"4bpp_dib_w{w}_h{h}.png"
        path = OUT / name
        im.save(path, "PNG")
        lum = luma_from_idx4(ind4, w, h, rgb16)
        fv = focus_var(lum)
        sp = stripe_penalty(lum)
        score = fv / (1.0 + 2.0 * sp)
        rows.append(
            {
                "label": "4_dib",
                "w": w,
                "h": h,
                "file": str(path.relative_to(ROOT)),
                "focus_lap_var": round(fv, 3),
                "stripe_pen": round(sp, 3),
                "score": round(score, 3),
            }
        )

    rows.sort(key=lambda x: -x.get("score", 0.0))
    want = [
        ("8bpp 横長 主副枠想定 (512x120)", "8bpp_dib_w512_h120.png"),
        ("8bpp 横長 近傍 (480x128)", "8bpp_dib_w480_h128.png"),
        ("8bpp 従来 256x240 (グリッド)", "8bpp_dib_w256_h240.png"),
        ("8bpp 縦 240x256 (行ストライド別解)", "8bpp_dib_w240_h256.png"),
        ("2x 256x120 左右連結 512x120 (二面仮)", "8bpp_twoPlane512x120_sidebyside.png"),
        ("4bpp 比較的無難な縦 320x384 (16c)", "4bpp_dib_w320_h384.png"),
    ]
    read_order: list[dict] = []
    for why, fn in want:
        pth = OUT / fn
        if pth.is_file():
            read_order.append({"note": why, "file": str(pth.relative_to(ROOT))})
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(
        json.dumps(
            {
                "_meta": {
                    "pl": str(PL),
                    "seg2_bytes": 61440,
                    "candidates_8bpp_all": len(exact_wh),
                    "candidates_8bpp_ui_filter": len(exact_ui),
                    "candidates_4bpp_plausible": len(exact4),
                    "filter": "w 100-1200, h 48-400, aspect 1-10",
                    "score_caveat": "by_score の先頭は高周波に有利な解が乗ることがある。鮮明さは human_suggested_read_order を優先目視。",
                },
                "human_suggested_read_order": read_order,
                "by_score": rows,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print("WROTE", OUT, REPORT, "n", len(rows))
    for x in rows[:5]:
        print(" top", x.get("label"), x.get("w"), x.get("h"), "score", x.get("score"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

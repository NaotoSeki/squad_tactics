# -*- coding: utf-8 -*-
"""
ITEML.DLL セグメント生データの幅×bpp×行形式（DIB 4/8 または 4bpp 密詰）の候補を列挙し、
簡易スコアで上位候補を PNG 化。合成は **DIB バイナリ → build_bmp_file** で既存解と揃える。

  set PL_DIR=D:\\PL
  python scripts\\probe_iteml_stride_decode.py

asset\\pl_weapons\\_iteml_stride_probe\\…
scripts\\pl_decoded\\iteml_stride_decode_report.json
"""
from __future__ import annotations

import io
import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from extract_pl_cbe_weapon_icons import dib_to_image  # noqa: E402
from extract_ne_resources import build_bmp_file, parse_ne_resources  # noqa: E402

try:
    from PIL import Image
except ImportError:
    print("ERROR: pip install Pillow")
    sys.exit(1)

try:
    import numpy as np
except ImportError:
    np = None

OUT_TOP = ROOT / "asset" / "pl_weapons" / "_iteml_stride_probe" / "top_by_segment"
REPORT = ROOT / "scripts" / "pl_decoded" / "iteml_stride_decode_report.json"


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


def row_4_dib(w: int) -> int:
    return ((w * 4 + 31) // 32) * 4


def row_8_dib(w: int) -> int:
    return ((w * 8 + 31) // 32) * 4


def row_4_tight(w: int) -> int:
    return (w + 1) // 2


def extract_bgr_256_parsed(p: dict) -> tuple[bytes, bytes]:
    """(BGR 256*4, RGB 256*3) from IDB_GUNIW_10."""
    d = p["data"]
    for rtype in p.get("resource_types", []):
        if rtype.get("type_id") != 0x8002:
            continue
        for e in rtype.get("entries", []):
            if str(e.get("name", "")) != "IDB_GUNIW_10":
                continue
            im = dib_to_image(d[e["offset"] : e["offset"] + e["length"]])
            if not im:
                return bytes(256 * 4), bytes(256 * 3)
            if im.mode != "P":
                im = im.convert("P", palette=Image.ADAPTIVE, colors=256)
            pl = im.getpalette() or [0] * 768
            bgr4 = bytearray(256 * 4)
            rgb3 = bytearray(256 * 3)
            for i in range(256):
                r, g, b = int(pl[i * 3]), int(pl[i * 3 + 1]), int(pl[i * 3 + 2])
                rgb3[i * 3 : i * 3 + 3] = bytes([r, g, b])
                bgr4[i * 4 : i * 4 + 4] = bytes([b, g, r, 0])
            return bytes(bgr4), bytes(rgb3)
    return bytes(256 * 4), bytes(256 * 3)


def unpack_4_dib(b: bytes, w: int, h: int) -> bytes | None:
    r = row_4_dib(w)
    if len(b) < r * h:
        return None
    b = b[: r * h]
    out = bytearray(w * h)
    for y in range(h):
        yy = h - 1 - y
        line = b[y * r : y * r + r]
        for x in range(0, w, 2):
            bi = x // 2
            if bi >= len(line):
                break
            v = line[bi]
            out[yy * w + x] = (v >> 4) & 0x0F
            if x + 1 < w:
                out[yy * w + x + 1] = v & 0x0F
    return bytes(out)


def unpack_4_tight(b: bytes, w: int, h: int) -> bytes | None:
    r = row_4_tight(w)
    if len(b) < r * h:
        return None
    b = b[: r * h]
    out = bytearray(w * h)
    for y in range(h):
        yy = h - 1 - y
        line = b[y * r : y * r + r]
        for x in range(0, w, 2):
            bi = x // 2
            if bi >= len(line):
                break
            v = line[bi]
            out[yy * w + x] = (v >> 4) & 0x0F
            if x + 1 < w:
                out[yy * w + x + 1] = v & 0x0F
    return bytes(out)


def unpack_8_dib(b: bytes, w: int, h: int) -> bytes | None:
    r = row_8_dib(w)
    if len(b) < r * h:
        return None
    b = b[: r * h]
    out = bytearray(w * h)
    for y in range(h):
        yy = h - 1 - y
        line = b[y * r : y * r + w]
        out[yy * w : (yy + 1) * w] = line[:w]
    return bytes(out)


def build_dib4(idx: bytes, w: int, h: int, bgr16: bytes) -> bytes:
    bih = struct.pack("<IIIHHIIIIII", 40, w, h, 1, 4, 0, 0, 0, 0, 0, 0)
    pal = bgr16[: 16 * 4].ljust(16 * 4, b"\x00")
    r = row_4_dib(w)
    rows = bytearray()
    for y in range(h):
        line = bytearray(r)
        for x in range(0, w, 2):
            lo = idx[(h - 1 - y) * w + x] & 0x0F
            hi = idx[(h - 1 - y) * w + x + 1] & 0x0F if x + 1 < w else 0
            line[x // 2] = (lo << 4) | hi
        rows += line
    return bih + pal + bytes(rows)


def build_dib8(idx: bytes, w: int, h: int, bgr256: bytes) -> bytes:
    bih = struct.pack("<IIIHHIIIIII", 40, w, h, 1, 8, 0, 0, 0, 0, 0, 0)
    pal = bgr256.ljust(256 * 4, b"\x00")
    r = row_8_dib(w)
    rows = bytearray()
    for y in range(h):
        line = bytearray(r)
        for x in range(w):
            line[x] = idx[(h - 1 - y) * w + x] & 0xFF
        rows += line
    return bih + pal + bytes(rows)


def score_luma(gray) -> float:
    if np is None:
        return 0.0
    g = np.asarray(gray, dtype=np.float32)
    if g.size < 8:
        return 0.0
    ex = float(np.abs(g[:, 1:] - g[:, :-1]).mean())
    ey = float(np.abs(g[1:, :] - g[:-1, :]).mean())
    row_m = g.mean(axis=1)
    rf = float(np.std(np.diff(row_m))) if len(row_m) > 1 else 0.0
    return (ex + ey) * 1.0 - min(rf, 12.0) * 0.25


def luma_from_idx8(inds: bytes, w: int, h: int, rgb256: bytes) -> "np.ndarray":
    a = np.frombuffer(inds, dtype=np.uint8).reshape((h, w))
    pl = (
        np.frombuffer(rgb256[: 256 * 3], dtype=np.uint8)
        .reshape(256, 3)
        .astype(np.float32)
    )
    return pl[a].mean(axis=2)


def luma_from_idx4(inds: bytes, w: int, h: int, rgb16: bytes) -> "np.ndarray":
    a = np.frombuffer(inds, dtype=np.uint8).reshape((h, w))
    pal = np.zeros((16, 3), dtype=np.float32)
    for i in range(16):
        pal[i] = [
            rgb16[i * 3],
            rgb16[i * 3 + 1],
            rgb16[i * 3 + 2],
        ]
    return pal[a].mean(axis=2)


def enum_variants(
    buf: bytes, bgr16: bytes, bgr256: bytes, rgb3_256: bytes, rgb3_16: bytes
) -> list[dict]:
    L = len(buf)
    out: list[dict] = []
    if np is None:
        return out

    def add(kind: str, w: int, h: int, inds: bytes, bpp8: bool):
        if inds is None or len(inds) != w * h:
            return
        if bpp8:
            luma = luma_from_idx8(inds, w, h, rgb3_256)
            dib = build_dib8(inds, w, h, bgr256)
        else:
            luma = luma_from_idx4(inds, w, h, rgb3_16)
            dib = build_dib4(inds, w, h, bgr16)
        sc = score_luma(luma)
        out.append(
            {
                "kind": kind,
                "w": w,
                "h": h,
                "score": sc,
                "dib": dib,
            }
        )

    # バッファを**隙なく**使い切る必要あり（行×高さ=バッファ長）。切り捨て短縮は偽陽性になる。

    def exact_ok(row_bytes: int, h: int) -> bool:
        return row_bytes * h == L

    # 8bpp DIB
    for w in range(4, min(1800, L + 1)):
        r = row_8_dib(w)
        if r <= 0 or L % r:
            continue
        hh = L // r
        if not exact_ok(r, hh):
            continue
        if 4 <= hh <= 2000 and 4 <= w <= 2000:
            u = unpack_8_dib(buf, w, hh)
            if u:
                add("8_dib", w, hh, u, True)
    # 4bpp DIB
    for w in range(4, min(2000, L + 1)):
        r = row_4_dib(w)
        if r <= 0 or L % r:
            continue
        hh = L // r
        if not exact_ok(r, hh):
            continue
        if 4 <= hh <= 2000 and 4 <= w <= 2000:
            u = unpack_4_dib(buf, w, hh)
            if u:
                add("4_dib", w, hh, u, False)
    # 4bpp tight
    for w in range(4, min(2000, L + 1)):
        r = row_4_tight(w)
        if r <= 0 or L % r:
            continue
        hh = L // r
        if not exact_ok(r, hh):
            continue
        if 4 <= hh <= 2000 and 4 <= w <= 2000:
            u = unpack_4_tight(buf, w, hh)
            if u:
                add("4_tight", w, hh, u, False)
    return out


def dib_to_png_bytes(dib: bytes) -> bytes | None:
    b = build_bmp_file(dib)
    if not b:
        return None
    im = Image.open(io.BytesIO(b))
    bio = io.BytesIO()
    im.save(bio, "PNG")
    return bio.getvalue()


def top_k(items: list[dict], k: int) -> list[dict]:
    return sorted(items, key=lambda x: -x.get("score", 0.0))[:k]


def main() -> int:
    from extract_pl_cbe_weapon_icons import find_pl_dir

    pl = find_pl_dir()
    if not pl or not (pl / "ITEML.DLL").is_file():
        print("PL_DIR または ITEML.DLL なし")
        return 1
    iteml_p = pl / "ITEML.DLL"
    d = iteml_p.read_bytes()
    ne = struct.unpack_from("<I", d, 0x3C)[0]
    if d[ne : ne + 2] != b"NE":
        print("not NE")
        return 1
    p_int = parse_ne_resources(str(pl / "INTERMIS.DLL"))
    bgr256, rgb3_256 = extract_bgr_256_parsed(p_int)
    rgb3_16 = bytes([rgb3_256[i] for i in range(16 * 3)])
    bgr16 = bgr256[: 16 * 4]

    segs = ne_segments(d, ne)
    report: dict = {"_meta": {"pl": str(pl), "segs": len(segs)}, "segments": []}
    OUT_TOP.mkdir(parents=True, exist_ok=True)

    for seg_i, s, e in segs:
        buf = d[s:e]
        if len(buf) < 2000:
            continue
        cands = enum_variants(buf, bgr16, bgr256, rgb3_256, rgb3_16)
        by_sk = [x for x in cands if "dib" in x]
        best = top_k(by_sk, 10)
        seg_entry = {
            "seg": seg_i,
            "len": len(buf),
            "top10": [
                {k2: v2 for k2, v2 in t.items() if k2 != "dib"} for t in best
            ],
        }
        for rank, t in enumerate(best):
            if "dib" not in t:
                continue
            pngb = dib_to_png_bytes(t["dib"])
            if not pngb:
                continue
            name = f"seg{seg_i:02d}_rank{rank:02d}_{t['kind']}_w{t['w']}_h{t['h']}_s{t['score']:.1f}.png"
            pth = OUT_TOP / name
            pth.write_bytes(pngb)
        if best:
            report["segments"].append(seg_entry)
        if len(report["segments"]) >= 18:
            break

    # オフセット付き: 先頭 64, 104(40+16*4) 等を飛ばして最長セグメントだけ再挑戦
    big: tuple | None = None
    for seg_i, s, e in segs:
        L = e - s
        if not big or L > (big[1] - big[0]):
            big = (s, e, seg_i)
    if big and np is not None:
        s, e, si = big
        for skip, lab in ((0, "none"), (64, "skip64"), (40 + 16 * 4, "skip_40+16*4_pal?")):
            off = s + min(skip, e - s - 1)
            buf = d[off:e]
            if len(buf) < 2000:
                continue
            c2 = enum_variants(buf, bgr16, bgr256, rgb3_256, rgb3_16)
            best2 = top_k(c2, 5)
            for rank, t in enumerate(best2):
                if "dib" not in t:
                    continue
                pngb = dib_to_png_bytes(t["dib"])
                if not pngb:
                    continue
                name = f"big_seg{si:02d}_{lab}_rank{rank:02d}_{t['kind']}_w{t['w']}_h{t['h']}.png"
                (OUT_TOP.parent / "offset_probe").mkdir(parents=True, exist_ok=True)
                (OUT_TOP.parent / "offset_probe" / name).write_bytes(pngb)
        report["biggest_segment_id"] = si

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("WROTE", OUT_TOP, REPORT, "n_seg_in_report", len(report["segments"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

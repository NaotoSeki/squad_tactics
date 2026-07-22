"""Re-extract ALL Panzer Strike SSC sprites via the game's own D3D9 driver.

The earlier self-decoded scanline codec (ssc_decoder.py) botched most sprite
formats (e.g. fmt=723 tree bodies came out as tiny fragments; only simple
formats like shadows survived).  The game's driver renders every format
correctly, so this batch loads Driver.Direct3D9.dll ONCE and renders every
non-empty slot of every SSC with its matching SPL palette.

Usage:
    python -B scripts/ps_extract/reextract_all.py --only Trees      # subset
    python -B scripts/ps_extract/reextract_all.py                   # everything
"""
from __future__ import annotations
import argparse, ctypes, os, struct, sys
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ssc_format import read_ssc, SscFormatError

PS = Path(r"C:\Program Files (x86)\Steam\steamapps\common\Panzer Strike Demo")
DRIVER = PS / "Drivers" / "Driver.Direct3D9.dll"
MEDIA = PS / "Data" / "Game" / "Common" / "Media"
OUT = Path(r"C:\Projects\squad_tactics\scratch\ps_sprites_v2")


class Size(ctypes.Structure):
    _fields_ = [("width", ctypes.c_int32), ("height", ctypes.c_int32)]
class Point(ctypes.Structure):
    _fields_ = [("x", ctypes.c_int32), ("y", ctypes.c_int32)]
class Rect(ctypes.Structure):
    _fields_ = [("x", ctypes.c_int32), ("y", ctypes.c_int32),
                ("width", ctypes.c_int32), ("height", ctypes.c_int32)]
class Sprite(ctypes.Structure):
    _fields_ = [("format_id", ctypes.c_uint32), ("depth", ctypes.c_uint32),
                ("origin_x", ctypes.c_int16), ("origin_y", ctypes.c_int16),
                ("width", ctypes.c_uint16), ("height", ctypes.c_uint16),
                ("data", ctypes.c_void_p)]


def load_driver():
    os.add_dll_directory(str(DRIVER.parent))
    d = ctypes.WinDLL(str(DRIVER))
    d.PixelBufferCreate.argtypes = [ctypes.POINTER(Size)]; d.PixelBufferCreate.restype = ctypes.c_void_p
    d.PixelBufferDelete.argtypes = [ctypes.c_void_p]
    d.PixelBufferGetDataPtr.argtypes = [ctypes.c_void_p]; d.PixelBufferGetDataPtr.restype = ctypes.c_void_p
    d.PixelBufferGetPitch.argtypes = [ctypes.c_void_p]; d.PixelBufferGetPitch.restype = ctypes.c_int32
    d.PixelBufferSpriteDraw8Bpp.argtypes = [ctypes.c_void_p, ctypes.POINTER(Sprite),
        ctypes.POINTER(ctypes.c_uint32), ctypes.POINTER(Point), ctypes.POINTER(Rect)]
    d.PixelBufferSpriteDraw8Bpp.restype = None
    return d


def read_palette(path: Path):
    data = path.read_bytes()
    if len(data) != 1024 or struct.unpack_from("<I", data, 0)[0] != 1020:
        raise ValueError(f"bad SPL layout: {path}")
    pal = (ctypes.c_uint32 * 256)(); pal[0] = 0
    for i, v in enumerate(struct.unpack_from("<255I", data, 4), start=1):
        pal[i] = v
    return pal


def find_spl(ssc: Path) -> Path | None:
    """Match the SPL palette. Many sprites share a FAMILY palette (e.g.
    bush_medium_01.ssc -> bush_medium.spl, no per-variant .spl). Try the
    same-name palette first, then progressively strip trailing _<suffix>
    segments to find the family palette. NEVER fall back to the alphabetically
    first .spl in the folder -- that silently gave 284/984 sprites the wrong
    colors (e.g. every plant got bush_big.spl). Skip if no family match."""
    same = ssc.with_suffix(".spl")
    if same.exists():
        return same
    parts = ssc.stem.split("_")
    for k in range(len(parts) - 1, 0, -1):
        cand = ssc.parent / ("_".join(parts[:k]) + ".spl")
        if cand.exists():
            return cand
    # prefix fallback (recovers e.g. grave_001 -> graves_01, plural/variant naming):
    # the folder .spl sharing the LONGEST common prefix, requiring >=4 shared chars
    # so unrelated palettes are never grabbed (that stays skipped).
    best, best_len = None, 3
    for spl in ssc.parent.glob("*.spl"):
        a, b, n = ssc.stem, spl.stem, 0
        while n < len(a) and n < len(b) and a[n] == b[n]:
            n += 1
        if n > best_len:
            best, best_len = spl, n
    return best


def render_slot(driver, frame, palette, margin=4):
    payload = ctypes.create_string_buffer(frame.payload)
    sprite = Sprite(frame.format_id, frame.depth, frame.origin_x, frame.origin_y,
                    frame.width, frame.height, ctypes.cast(payload, ctypes.c_void_p))
    cw, ch = frame.width + margin * 2, frame.height + margin * 2
    point = Point(margin - frame.origin_x, margin - frame.origin_y)
    clip = Rect(0, 0, cw, ch)
    pb = driver.PixelBufferCreate(Size(cw, ch))
    if not pb:
        return None
    try:
        driver.PixelBufferSpriteDraw8Bpp(pb, ctypes.byref(sprite), palette,
                                         ctypes.byref(point), ctypes.byref(clip))
        pitch = driver.PixelBufferGetPitch(pb)
        ptr = driver.PixelBufferGetDataPtr(pb)
        if not ptr or pitch < cw:
            return None
        raw = ctypes.string_at(ptr, pitch * ch * 4)
        img = Image.frombytes("RGBA", (pitch, ch), raw, "raw", "BGRA")
        if pitch != cw:
            img = img.crop((0, 0, cw, ch))
        bb = img.getbbox()
        return img.crop(bb) if bb else None
    finally:
        driver.PixelBufferDelete(pb)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=None, help="limit to a subfolder name, e.g. Trees")
    ap.add_argument("--root", default=str(MEDIA), help="media root to walk")
    args = ap.parse_args()
    driver = load_driver()
    root = Path(args.root)
    sscs = sorted(root.rglob("*.ssc"))
    if args.only:
        sscs = [s for s in sscs if args.only.lower() in str(s).lower()]
    print(f"SSC files: {len(sscs)}  driver: {DRIVER.name}")
    n_ok = n_slot = n_nospl = n_fail = 0
    for ssc in sscs:
        spl = find_spl(ssc)
        if spl is None:
            n_nospl += 1; continue
        try:
            f = read_ssc(ssc); pal = read_palette(spl)
        except Exception as e:
            n_fail += 1; continue
        rel = ssc.relative_to(root).with_suffix("")
        outdir = OUT / rel.parent
        for fr in f.frames:
            if fr.is_empty:
                continue
            img = render_slot(driver, fr, pal)
            if img is None:
                n_fail += 1; continue
            outdir.mkdir(parents=True, exist_ok=True)
            img.save(outdir / f"{rel.name}_s{fr.slot}.png")
            n_slot += 1
        n_ok += 1
    print(f"done: ssc_ok={n_ok} slots_written={n_slot} no_spl={n_nospl} fails={n_fail}")
    print(f"output: {OUT}")


if __name__ == "__main__":
    raise SystemExit(main())

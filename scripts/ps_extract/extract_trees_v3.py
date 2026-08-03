# Differential-blit tree extraction (v3). Blit each frame over black and white
# via the game's own driver DLL, solve per-pixel for TRUE coverage and straight
# color. v2's alpha channel was wrong (drastically undercovered); this is ground
# truth. Generated via GPT-5.6 lane from a verified core, reviewed.
# See memory: ps-render-pipeline.
import ctypes
import json
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ssc_format import read_ssc
from ssc_driver_render import Size, Sprite, Point, Rect, read_palette

driver_path = Path(r'C:\Program Files (x86)\Steam\steamapps\common\Panzer Strike Demo\Drivers\Driver.Direct3D9.dll')
os.add_dll_directory(str(driver_path.parent))
drv = ctypes.WinDLL(str(driver_path))
drv.PixelBufferCreate.argtypes=[ctypes.POINTER(Size)]; drv.PixelBufferCreate.restype=ctypes.c_void_p
drv.PixelBufferGetDataPtr.argtypes=[ctypes.c_void_p]; drv.PixelBufferGetDataPtr.restype=ctypes.c_void_p
drv.PixelBufferGetPitch.argtypes=[ctypes.c_void_p]; drv.PixelBufferGetPitch.restype=ctypes.c_int32
drv.PixelBufferDelete.argtypes=[ctypes.c_void_p]
drv.PixelBufferFill.argtypes=[ctypes.c_void_p, ctypes.c_uint32]
drv.PixelBufferSpriteDraw8Bpp.argtypes=[ctypes.c_void_p, ctypes.POINTER(Sprite), ctypes.POINTER(ctypes.c_uint32), ctypes.POINTER(Point), ctypes.POINTER(Rect)]

def blit_over(frame, pal, fill):
    W,H = frame.width, frame.height
    pb = drv.PixelBufferCreate(Size(W,H))
    drv.PixelBufferFill(pb, fill)
    buf = ctypes.create_string_buffer(frame.payload)
    spr = Sprite(frame.format_id, frame.depth, frame.origin_x, frame.origin_y, W, H, ctypes.cast(buf, ctypes.c_void_p))
    pt = Point(-frame.origin_x, -frame.origin_y)
    drv.PixelBufferSpriteDraw8Bpp(pb, ctypes.byref(spr), pal, ctypes.byref(pt), ctypes.byref(Rect(0,0,W,H)))
    ptr = drv.PixelBufferGetDataPtr(pb); pitch = drv.PixelBufferGetPitch(pb)
    raw = ctypes.string_at(ptr, pitch*H*4)
    a = np.frombuffer(raw, np.uint8).reshape(H, pitch, 4)[:, :W, :].astype(np.int32)  # BGRA rows
    drv.PixelBufferDelete(pb)
    return a


TREE_DIR = Path(
    r"C:\Program Files (x86)\Steam\steamapps\common\Panzer Strike Demo"
    r"\Data\Game\Common\Media\Objects\Trees"
)
REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = REPO_ROOT / "scratch" / "ps_trees_v3"


def is_nonempty(frame):
    if frame is None:
        return False
    try:
        width = int(frame.width)
        height = int(frame.height)
        payload = frame.payload
    except (AttributeError, TypeError, ValueError):
        return False
    return width > 0 and height > 0 and payload is not None and len(payload) > 0


def render_rgba(frame, pal):
    A = blit_over(frame, pal, 0x00000000)   # over black -> S = straight*cov (premultiplied)
    B = blit_over(frame, pal, 0x00FFFFFF)   # over white
    k = (B - A)[...,:3].mean(-1)/255.0      # surviving background fraction
    cov = np.clip(1.0-k, 0.0, 1.0)
    S = A[...,:3].astype(np.float32)
    straight = np.zeros_like(S)
    m = cov > 1/255
    straight[m] = np.clip(S[m]/cov[m,None], 0, 255)

    rgb = np.rint(straight).astype(np.uint8)
    alpha = np.rint(cov * 255).astype(np.uint8)

    rgba = np.empty((frame.height, frame.width, 4), dtype=np.uint8)
    rgba[..., 0] = rgb[..., 2]
    rgba[..., 1] = rgb[..., 1]
    rgba[..., 2] = rgb[..., 0]
    rgba[..., 3] = alpha
    return rgba, cov, m


def process_frame(frame, pal, output_path, kind):
    rgba, cov, touched_mask = render_rgba(frame, pal)
    Image.fromarray(rgba, "RGBA").save(output_path)

    touched = int(touched_mask.sum())
    touched_cov = cov[touched_mask]

    return {
        "name": output_path.name,
        "kind": kind,
        "w": int(frame.width),
        "h": int(frame.height),
        "origin_x": int(frame.origin_x),
        "origin_y": int(frame.origin_y),
        "cov_mean": float(cov.mean()),
        "cov_median": float(np.median(touched_cov)) if touched else 0.0,
        "touched": touched,
    }


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    ssc_paths = sorted(TREE_DIR.glob("*.ssc"))
    catalog = []
    files = 0
    frames = 0
    errors = 0

    for file_index, ssc_path in enumerate(ssc_paths, start=1):
        files += 1
        print(f"[{file_index}/{len(ssc_paths)}] {ssc_path.name}")

        palette_path = ssc_path.with_suffix(".spl")
        try:
            ssc = read_ssc(ssc_path)
            pal = read_palette(palette_path)
        except Exception as exc:
            errors += 1
            print(f"  ERROR loading SSC/palette: {exc}")
            continue

        by_slot = {f.slot: f for f in ssc.frames}
        for slot_index, kind, suffix in (
            (2, "body", ""),
            (4, "shadow", "_shadow"),
        ):
            frame = by_slot.get(slot_index)
            if not is_nonempty(frame):
                continue

            output_path = OUTPUT_DIR / f"{ssc_path.stem}{suffix}.png"
            try:
                metadata = process_frame(frame, pal, output_path, kind)
                catalog.append(metadata)
                frames += 1
                print(
                    f"  {kind}: {metadata['w']}x{metadata['h']}, "
                    f"touched={metadata['touched']}, cov_med={metadata['cov_median']:.3f}"
                )
            except Exception as exc:
                errors += 1
                print(f"  ERROR {kind} slot {slot_index}: {exc}")

    catalog_path = OUTPUT_DIR / "catalog_v3.json"
    with catalog_path.open("w", encoding="utf-8") as handle:
        json.dump(catalog, handle, indent=2)
        handle.write("\n")

    body_medians = [entry["cov_median"] for entry in catalog if entry["kind"] == "body"]
    mean_body_median = float(np.mean(body_medians)) if body_medians else 0.0

    print(
        f"Done: files={files}, frames={frames}, errors={errors}, "
        f"mean_body_cov_median={mean_body_median:.6f}"
    )


if __name__ == "__main__":
    main()

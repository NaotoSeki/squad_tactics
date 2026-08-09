#!/usr/bin/env python3
"""Build the versioned, original-derived infantry muzzle-smoke prototype."""

from __future__ import annotations

import hashlib
import json
import copy
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
CANONICAL = ROOT / "scratch/ps_sprites_canonical_v1"
OUT = ROOT / "asset/ps_fx/candidates/muzzle_smoke_v2_original_derived"
SSC = "Animations/Guns/gun_light_shot_smoke.ssc"
SLOTS = list(range(1, 33))
# Slots 1-32 span x=-1..62 and y=-8..45 relative to the SSC origin.
# Four transparent pixels on every side prevent resampling from touching a
# cell boundary while retaining the exact source anchor.
FRAME_W, FRAME_H = 72, 64
ANCHOR_X, ANCHOR_Y = 5, 12
COLS = 8


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    manifest_path = CANONICAL / "canonical_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    by_slot = {int(e["slot"]): e for e in manifest["sprites"] if e["ssc"] == SSC}
    entries = [by_slot[s] for s in SLOTS]
    OUT.mkdir(parents=True, exist_ok=True)

    rows = (len(entries) + COLS - 1) // COLS
    sheet = Image.new("RGBA", (COLS * FRAME_W, rows * FRAME_H), (0, 0, 0, 0))
    for i, entry in enumerate(entries):
        src = Image.open(CANONICAL / entry["png"]).convert("RGBA")
        x = (i % COLS) * FRAME_W + ANCHOR_X + int(entry["origin_x"])
        y = (i // COLS) * FRAME_H + ANCHOR_Y + int(entry["origin_y"])
        sheet.alpha_composite(src, (x, y))
    sheet_path = OUT / "muzzle_smoke_v2.png"
    sheet.save(sheet_path, optimize=True)

    source_ssc = Path(manifest["source_root"]) / SSC
    metadata = {
        "schema": "ps-muzzle-smoke-variant/v2",
        "status": "prototype-feature-gated",
        "frames": len(entries),
        "fps": 30,
        "frameWidth": FRAME_W,
        "frameHeight": FRAME_H,
        "columns": COLS,
        "anchor": {"x": ANCHOR_X, "y": ANCHOR_Y},
        "source": {
            "product": "Panzer Strike Demo",
            "ssc": str(source_ssc),
            "spl": str(source_ssc.with_suffix(".spl")),
            "slots": SLOTS,
            "sscSha256": sha256(source_ssc),
            "splSha256": sha256(source_ssc.with_suffix(".spl")),
            "pixelLayer": "100% original canonical RGBA; no generated pixels",
        },
        "runtime": {
            "scale": 0.55,
            "alpha": 0.34,
            "durationSeconds": len(entries) / 30,
            "breezeWorldPxPerSecond": {"x": 7, "y": -3},
            "rapidFire": "one puff per burst; alpha reduced for 2-4 rounds; disabled at >=5 rounds",
        },
        "rejectedCandidate": "../impact_smoke_v1_source.png (generated monolithic plume; not integrated)",
    }
    (OUT / "muzzle_smoke_v2.json").write_text(
        json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    # Contact sheet: exact source frames versus the actual runtime transform.
    samples = list(range(0, 32, 4))
    cell_w, cell_h = 108, 86
    contact = Image.new("RGBA", (cell_w * len(samples), 2 * cell_h + 44), (32, 34, 32, 255))
    draw = ImageDraw.Draw(contact)
    draw.text((6, 5), "TOP: ORIGINAL PANZER STRIKE RGBA  |  BOTTOM: V2 ORIGINAL-DERIVED (0.55 scale, alpha 0.34, deterministic breeze)", fill=(235, 225, 205, 255))
    for col, idx in enumerate(samples):
        frame = sheet.crop(((idx % COLS) * FRAME_W, (idx // COLS) * FRAME_H,
                            (idx % COLS + 1) * FRAME_W, (idx // COLS + 1) * FRAME_H))
        x = col * cell_w + (cell_w - FRAME_W) // 2
        contact.alpha_composite(frame, (x, 30))
        scaled = frame.resize((round(FRAME_W * 0.55), round(FRAME_H * 0.55)), Image.Resampling.LANCZOS)
        alpha = scaled.getchannel("A").point(lambda a: round(a * 0.34))
        scaled.putalpha(alpha)
        drift_x = round((idx / 30) * 7)
        drift_y = round((idx / 30) * -3)
        bx = col * cell_w + (cell_w - scaled.width) // 2 + drift_x
        by = 30 + cell_h + (cell_h - scaled.height) // 2 + drift_y
        contact.alpha_composite(scaled, (bx, by))
        draw.text((col * cell_w + 4, 30 + cell_h * 2 - 10), f"f{idx + 1:02}", fill=(190, 190, 180, 255))
    contact.save(OUT / "muzzle_smoke_v2_contact.png", optimize=True)

    # V3 changes only gameplay readability; source pixels and frame order stay
    # byte-for-byte equivalent to V2.
    out3 = ROOT / "asset/ps_fx/candidates/muzzle_smoke_v3_original_derived"
    out3.mkdir(parents=True, exist_ok=True)
    sheet.save(out3 / "muzzle_smoke_v3.png", optimize=True)
    metadata3 = copy.deepcopy(metadata)
    metadata3["schema"] = "ps-muzzle-smoke-variant/v3"
    metadata3["runtime"]["scale"] = 0.62
    metadata3["runtime"]["alpha"] = 0.46
    metadata3["runtime"]["rapidFire"] = "one puff per burst; alpha 0.18 for 2-4 rounds; disabled at >=5 rounds"
    metadata3["previousCandidate"] = "../muzzle_smoke_v2_original_derived (rejected: too faint at normal zoom)"
    (out3 / "muzzle_smoke_v3.json").write_text(
        json.dumps(metadata3, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    contact3 = Image.new("RGBA", (cell_w * len(samples), 3 * cell_h + 44), (32, 34, 32, 255))
    draw3 = ImageDraw.Draw(contact3)
    draw3.text((6, 5), "TOP ORIGINAL PS | MIDDLE V2 REJECTED (too faint) | BOTTOM V3 SELECTED (same PS pixels, readable transform)", fill=(235, 225, 205, 255))
    for col, idx in enumerate(samples):
        frame = sheet.crop(((idx % COLS) * FRAME_W, (idx // COLS) * FRAME_H,
                            (idx % COLS + 1) * FRAME_W, (idx // COLS + 1) * FRAME_H))
        contact3.alpha_composite(frame, (col * cell_w + (cell_w - FRAME_W) // 2, 30))
        for row, (sc, opacity) in enumerate(((0.55, 0.34), (0.62, 0.46)), start=1):
            scaled = frame.resize((round(FRAME_W * sc), round(FRAME_H * sc)), Image.Resampling.LANCZOS)
            scaled.putalpha(scaled.getchannel("A").point(lambda a, op=opacity: round(a * op)))
            drift_x = round((idx / 30) * 7)
            drift_y = round((idx / 30) * -3)
            x = col * cell_w + (cell_w - scaled.width) // 2 + drift_x
            y = 30 + row * cell_h + (cell_h - scaled.height) // 2 + drift_y
            contact3.alpha_composite(scaled, (x, y))
        draw3.text((col * cell_w + 4, 30 + cell_h * 3 - 10), f"f{idx + 1:02}", fill=(190, 190, 180, 255))
    contact3.save(out3 / "muzzle_smoke_v3_contact.png", optimize=True)
    print(f"wrote {sheet_path} and comparison contact sheet")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

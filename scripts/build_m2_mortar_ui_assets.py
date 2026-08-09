"""Build fixed-size UI/map derivatives from the generated transparent M2 art."""
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ASSET = ROOT / "asset" / "mortar"

# Phaser sidebar at the normal 340px width: main slot 304x90, 6px between
# slots, and the image is fitted into a 4px inset (296x82).  A 600x180 slice is
# therefore displayed at 82/180 scale.  The undrawn screen distance between
# two visible image regions is 4 + 6 + 4 = 14px, or about 31 source pixels.
# Sampling every 180+31 pixels from one virtual canvas preserves the mortar's
# geometry across that distance while leaving the actual UI gap untouched.
M2_SLICE_SIZE = (600, 180)
M2_SLOT_H = 90
M2_SLOT_GAP = 6
M2_ICON_INSET = 4
M2_RENDER_SCALE = (M2_SLOT_H - M2_ICON_INSET * 2) / M2_SLICE_SIZE[1]
M2_VISIBLE_GAP = M2_SLOT_GAP + M2_ICON_INSET * 2
M2_VIRTUAL_GAP = round(M2_VISIBLE_GAP / M2_RENDER_SCALE)


def contain(src_name: str, out_name: str, size: tuple[int, int], padding: int = 8) -> None:
    src = Image.open(ASSET / src_name).convert("RGBA")
    box = src.getbbox()
    if box:
        src = src.crop(box)
    max_w, max_h = size[0] - padding * 2, size[1] - padding * 2
    scale = min(max_w / src.width, max_h / src.height)
    resized = src.resize((max(1, round(src.width * scale)), max(1, round(src.height * scale))), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    canvas.alpha_composite(resized, ((size[0] - resized.width) // 2, (size[1] - resized.height) // 2))
    canvas.save(ASSET / out_name, optimize=True)


def main() -> None:
    contain("m2_tube.png", "m2_tube_slot.png", (600, 180))
    contain("m2_bipod.png", "m2_bipod_slot.png", (600, 180))
    contain("m2_baseplate.png", "m2_baseplate_slot.png", (600, 180))
    contain("m2_ammo_box.png", "m2_ammo_box_slot.png", (300, 150))

    # Fit once on a continuous virtual canvas. Each exported slice skips the
    # source-space distance represented by the real slot gap; no gap pixels are
    # exported or drawn by the game UI.
    src = Image.open(ASSET / "m2_mortar_assembled.png").convert("RGBA")
    box = src.getbbox()
    if box:
        src = src.crop(box)
    virtual_h = M2_SLICE_SIZE[1] * 3 + M2_VIRTUAL_GAP * 2
    canvas = Image.new("RGBA", (M2_SLICE_SIZE[0], virtual_h), (0, 0, 0, 0))
    scale = min(560 / src.width, (virtual_h - 20) / src.height)
    resized = src.resize((round(src.width * scale), round(src.height * scale)), Image.Resampling.LANCZOS)
    canvas.alpha_composite(resized, ((M2_SLICE_SIZE[0] - resized.width) // 2, (virtual_h - resized.height) // 2))
    for index, name in enumerate(("top", "mid", "bottom")):
        top = index * (M2_SLICE_SIZE[1] + M2_VIRTUAL_GAP)
        canvas.crop((0, top, M2_SLICE_SIZE[0], top + M2_SLICE_SIZE[1])).save(
            ASSET / f"m2_mortar_slot_{name}.png", optimize=True
        )

    contain("m2_mortar_assembled.png", "m2_mortar_map.png", (256, 256), padding=12)


if __name__ == "__main__":
    main()

"""Render a seeded NextGen battlefield to PNG for visual review."""
from __future__ import annotations

import json
import math
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
COLORS = {
    "GRASS": "#71865a", "FOREST": "#284d31", "ROAD": "#9c8560",
    "FIELD": "#a89b57", "RUIN": "#685f58", "BLDG": "#373636",
}


def load(seed: str) -> dict:
    code = (
        "const g=require('./logic_map_nextgen');"
        "const r=g.create(process.argv[1]);"
        "process.stdout.write(JSON.stringify(r));"
    )
    raw = subprocess.check_output(["node", "-e", code, seed], cwd=ROOT, text=True)
    return json.loads(raw)


def render(seed: str, output: Path) -> None:
    result = load(seed)
    image = Image.new("RGB", (1000, 850), "#171a17")
    draw = ImageDraw.Draw(image)
    size, ox, oy = 20, 100, 55
    player = {(p["q"], p["r"]) for p in result["spawns"]["player"]}
    enemy = {(p["q"], p["r"]) for p in result["spawns"]["enemy"]}
    for q, column in enumerate(result["map"]):
        for r, cell in enumerate(column):
            x = ox + q * size * 1.52
            y = oy + r * size * 1.72 + q * size * 0.86
            points = [(x + math.cos(math.pi * i / 3) * size,
                       y + math.sin(math.pi * i / 3) * size) for i in range(6)]
            outline = "#59bfff" if (q, r) in player else "#ff665c" if (q, r) in enemy else "#1b211b"
            draw.polygon(points, fill=COLORS[cell["base"]], outline=outline,
                         width=3 if (q, r) in player or (q, r) in enemy else 1)
            if cell["elevation"] >= 3:
                draw.text((x - 7, y - 6), str(cell["elevation"]), fill="#f3e8a6")
    metrics = result["validation"]["metrics"]
    draw.text((20, 15), f"seed {result['seed']}  {metrics}", fill="#e9e4d2")
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output)


if __name__ == "__main__":
    render(sys.argv[1] if len(sys.argv) > 1 else "41027",
           Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "scratch" / "nextgen_map_review.png")

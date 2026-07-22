"""Print structural facts about Panzer Strike SSC sprites."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

try:
    from .ssc_format import parse_scanlines, read_ssc
except ImportError:  # Direct script execution.
    from ssc_format import parse_scanlines, read_ssc


def probe(path: Path) -> dict[str, object]:
    sprite = read_ssc(path)
    frames: list[dict[str, object]] = []
    single_chunk_headers: dict[str, int] = {}
    for frame in sprite.frames:
        item: dict[str, object] = {
            "slot": frame.slot,
            "data_size": frame.data_size,
            "empty": frame.is_empty,
        }
        if not frame.is_empty:
            rows = parse_scanlines(frame)
            item.update(
                {
                    "format_id": frame.format_id,
                    "depth": frame.depth,
                    "origin": [frame.origin_x, frame.origin_y],
                    "size": [frame.width, frame.height],
                    "rows": len(rows),
                    "chunks_min": min(row.chunk_count for row in rows),
                    "chunks_max": max(row.chunk_count for row in rows),
                }
            )
            for row in rows:
                if row.chunk_count == 1 and len(row.body) >= 4:
                    header = row.body[:4].hex(" ")
                    key = f"{header} -> {len(row.body) - 4} data bytes"
                    single_chunk_headers[key] = single_chunk_headers.get(key, 0) + 1
        frames.append(item)
    return {
        "source": str(path),
        "slot_count": len(sprite.frames),
        "nonempty_count": len(sprite.nonempty_frames),
        "trailer_size": len(sprite.trailer),
        "frames": frames,
        "single_chunk_headers": dict(
            sorted(single_chunk_headers.items(), key=lambda pair: (-pair[1], pair[0]))
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("paths", nargs="+", type=Path)
    args = parser.parse_args()
    for path in args.paths:
        print(json.dumps(probe(path), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

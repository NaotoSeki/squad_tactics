"""Read-only inspector for confirmed Panzer Strike PSM map records.

The earlier 512x384 / 29-layer experiment sliced across serialized record
boundaries. This inspector follows the actual tagged blocks and decodes only
layouts confirmed against both installed demo maps.
"""

from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import re
import struct
import zlib


ZLIB_HEADER = re.compile(rb"\x78[\x01\x5e\x9c\xda]")


def decompress_members(data: bytes) -> list[bytes]:
    """Return valid zlib members found in a PSM container."""
    members: list[bytes] = []
    for match in ZLIB_HEADER.finditer(data):
        try:
            decoder = zlib.decompressobj()
            payload = decoder.decompress(data[match.start() :])
            payload += decoder.flush()
        except zlib.error:
            continue
        if payload and all(payload != known for known in members):
            members.append(payload)
    return members


def find_member(members: list[bytes], tag: str) -> bytes:
    needle = tag.encode("utf-16le")
    for member in members:
        if needle in member:
            return member
    raise ValueError(f"PSM member containing {tag!r} was not found")


def after_tag(data: bytes, tag: str) -> int:
    needle = tag.encode("utf-16le")
    offset = data.find(needle)
    if offset < 0:
        raise ValueError(f"tag {tag!r} was not found")
    return offset + len(needle)


def sized_block(data: bytes, tag: str) -> bytes:
    """Return the uint32-sized payload immediately following a UTF-16LE tag."""
    offset = after_tag(data, tag)
    size = struct.unpack_from("<I", data, offset)[0]
    start = offset + 4
    end = start + size
    if end > len(data):
        raise ValueError(
            f"{tag} block overruns member: start={start}, size={size}, "
            f"member={len(data)}"
        )
    return data[start:end]


def parse_map_info(info_member: bytes) -> tuple[int, int, int]:
    payload = sized_block(info_member, "MAP_INFO")
    if len(payload) != 5:
        raise ValueError(f"unexpected MAP_INFO size: {len(payload)}")
    version, width, height = struct.unpack("<BHH", payload)
    return version, width, height


def parse_assets(map_member: bytes) -> list[list[str]]:
    payload = sized_block(map_member, "MAP_ASSETS")
    position = 0
    group_count = struct.unpack_from("<H", payload, position)[0]
    position += 2
    groups: list[list[str]] = []

    for group_index in range(group_count):
        if group_index == 0:
            asset_count = struct.unpack_from("<H", payload, position)[0]
            position += 2
        else:
            stored_group = payload[position]
            asset_count = struct.unpack_from("<H", payload, position + 1)[0]
            position += 3
            if stored_group != group_index:
                raise ValueError(
                    f"asset group mismatch: expected {group_index}, "
                    f"found {stored_group}"
                )

        group: list[str] = []
        for _ in range(asset_count):
            byte_count = payload[position]
            position += 1
            raw = payload[position : position + byte_count]
            position += byte_count
            group.append(raw.decode("utf-16le"))
        groups.append(group)

    if position != len(payload):
        raise ValueError(f"MAP_ASSETS has {len(payload) - position} trailing bytes")
    return groups


def parse_records(data: bytes, record: struct.Struct) -> list[tuple[int, ...]]:
    if len(data) % record.size:
        raise ValueError(
            f"record block size {len(data)} is not divisible by {record.size}"
        )
    return [
        record.unpack_from(data, offset)
        for offset in range(0, len(data), record.size)
    ]


def range_of(records: list[tuple[int, ...]], index: int) -> list[int]:
    values = [record[index] for record in records]
    return [min(values), max(values)] if values else []


def resolved_samples(
    records: list[tuple[int, ...]],
    assets: list[list[str]],
    *,
    implicit_catalog: int | None = None,
    limit: int = 5,
) -> list[dict[str, object]]:
    samples: list[dict[str, object]] = []
    for record in records[:limit]:
        if implicit_catalog is None:
            catalog, asset_index = record[0], record[1]
        else:
            catalog, asset_index = implicit_catalog, record[0]
        samples.append(
            {
                "record": list(record),
                "asset": assets[catalog][asset_index],
            }
        )
    return samples


def inspect(path: Path) -> dict[str, object]:
    members = decompress_members(path.read_bytes())
    info_member = find_member(members, "MAP_INFO")
    map_member = find_member(members, "MAP_CELLS")
    version, width, height = parse_map_info(info_member)
    assets = parse_assets(map_member)

    decors = parse_records(
        sized_block(map_member, "MAP_DECORS"),
        struct.Struct("<BHII"),
    )
    objects = parse_records(
        sized_block(map_member, "MAP_OBJECTS"),
        struct.Struct("<BHIII"),
    )
    buildings = parse_records(
        sized_block(map_member, "MAP_BUILDINGS"),
        struct.Struct("<HIII"),
    )
    depth = sized_block(map_member, "MAP_DEPTH")

    expected_depth_size = width * height * 8
    if len(depth) != expected_depth_size:
        raise ValueError(
            f"MAP_DEPTH size {len(depth)} != {width}x{height}x8 "
            f"({expected_depth_size})"
        )

    return {
        "source": str(path),
        "map_info_version": version,
        "declared_grid": [width, height],
        "inferred_world_extent": [width * 40, height * 40],
        "asset_catalog_counts": [len(group) for group in assets],
        "asset_catalogs": assets,
        "blocks": {
            "MAP_CELLS": {
                "bytes": len(sized_block(map_member, "MAP_CELLS")),
                "observed_layout": "fixed 256*256*3 byte storage",
            },
            "MAP_BRIGHTNESS": {
                "bytes": len(sized_block(map_member, "MAP_BRIGHTNESS")),
            },
            "MAP_TILES": {
                "bytes": len(sized_block(map_member, "MAP_TILES")),
            },
            "MAP_DEPTH": {
                "bytes": len(depth),
                "bytes_per_declared_sample": 8,
                "observed_layout": (
                    "4 little-endian uint16 values per declared grid sample; "
                    "semantic meaning unconfirmed"
                ),
            },
        },
        "placements": {
            "MAP_DECORS": {
                "record": ["catalog:u8", "asset:u16", "x:u32", "y:u32"],
                "count": len(decors),
                "catalog_counts": dict(sorted(Counter(row[0] for row in decors).items())),
                "x_range": range_of(decors, 2),
                "y_range": range_of(decors, 3),
                "samples": resolved_samples(decors, assets),
            },
            "MAP_OBJECTS": {
                "record": [
                    "catalog:u8",
                    "asset:u16",
                    "x:u32",
                    "y:u32",
                    "extra:u32",
                ],
                "count": len(objects),
                "catalog_counts": dict(
                    sorted(Counter(row[0] for row in objects).items())
                ),
                "extra_values": dict(
                    sorted(Counter(row[4] for row in objects).items())
                ),
                "x_range": range_of(objects, 2),
                "y_range": range_of(objects, 3),
                "samples": resolved_samples(objects, assets),
            },
            "MAP_BUILDINGS": {
                "record": [
                    "asset:u16",
                    "x:u32",
                    "y:u32",
                    "orientation:u32",
                ],
                "count": len(buildings),
                "orientation_values": dict(
                    sorted(Counter(row[3] for row in buildings).items())
                ),
                "x_range": range_of(buildings, 1),
                "y_range": range_of(buildings, 2),
                "samples": resolved_samples(
                    buildings,
                    assets,
                    implicit_catalog=7,
                ),
            },
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("psm", type=Path, nargs="+")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    report = {
        "schema": "psm-structure-confirmed-v1",
        "warning": (
            "Supersedes the disproven 512x384 / 29-layer slicing hypothesis."
        ),
        "maps": [inspect(path) for path in args.psm],
    }
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n", encoding="utf-8")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


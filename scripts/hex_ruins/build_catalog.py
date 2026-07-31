#!/usr/bin/env python3
"""Build and verify the hex_tiles_v7 catalog from the rendered PNG set.

The filenames are the source of truth for variants, rotations, damage states,
and family membership. PNG IHDR data is the source of truth for canvas size.

Usage:
  python scripts/hex_ruins/build_catalog.py
  python scripts/hex_ruins/build_catalog.py --check
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import itertools
import json
import re
import struct
import sys
from pathlib import Path
from typing import Iterable, Sequence


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_TILE_DIR = ROOT / "asset" / "environment" / "hex_tiles_v7"

HEX_RADIUS_METERS = 9.0
VIEW_WIDTH_METERS = 20.25
# Runtime rendering uses (144, 234.5) on the current 288x384 canvas. Keep the
# ratios so a future uniform resolution change scales the contract exactly.
HEX_RADIUS_X_RATIO = 128.0 / 288.0
ANCHOR_Y_RATIO = 234.5 / 384.0
PROJECTION = "military: elev 55deg, vertical shear preserves plan shape"

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
SCAR_MASKS = {
    "e1": [0],
    "e2a": [0, 1],
    "e2o": [0, 3],
    "e3": [0, 1, 2],
    "e4": [0, 1, 2, 3],
    "full": [0, 1, 2, 3, 4, 5],
}
CRATER_PAIR_AXES = {
    "variant": [0, 1, 2, 3],
    "tile": ["a", "b"],
    "rot": [0, 60, 120],
}


class CatalogError(RuntimeError):
    """The rendered tile set violates the catalog contract."""


def png_dimensions(path: Path) -> tuple[int, int]:
    """Read a PNG's dimensions from IHDR without an image-library dependency."""
    with path.open("rb") as handle:
        header = handle.read(24)
    if len(header) != 24 or header[:8] != PNG_SIGNATURE or header[12:16] != b"IHDR":
        raise CatalogError(f"not a valid PNG with an IHDR header: {path}")
    return struct.unpack(">II", header[16:24])


def normalized_number(value: float) -> int | float:
    """Prefer clean integers in JSON while retaining required half pixels."""
    rounded = round(value)
    if abs(value - rounded) < 1e-9:
        return int(rounded)
    return round(value, 6)


def collect(
    names: Sequence[str],
    classified: set[str],
    pattern: str,
    integer_fields: Iterable[str] = (),
) -> list[dict]:
    regex = re.compile(pattern)
    integer_fields = set(integer_fields)
    rows: list[dict] = []
    for name in names:
        match = regex.fullmatch(name)
        if not match:
            continue
        if name in classified:
            raise CatalogError(f"filename matched more than one family: {name}")
        classified.add(name)
        row: dict[str, object] = {"file": name}
        for key, value in match.groupdict().items():
            if value is None:
                continue
            row[key] = int(value) if key in integer_fields else value
        rows.append(row)
    return rows


def require_nonempty(label: str, rows: Sequence[dict]) -> None:
    if not rows:
        raise CatalogError(f"no PNGs found for required family: {label}")


def axis_values(rows: Sequence[dict], axis: str) -> list:
    return sorted({row[axis] for row in rows})


def require_complete(label: str, rows: Sequence[dict], axes: Sequence[str]) -> dict[str, list]:
    """Ensure a family contains the full cartesian product of its axes."""
    require_nonempty(label, rows)
    values = {axis: axis_values(rows, axis) for axis in axes}
    actual = {tuple(row[axis] for axis in axes) for row in rows}
    expected = set(itertools.product(*(values[axis] for axis in axes)))
    if len(actual) != len(rows):
        raise CatalogError(f"duplicate axis combination in {label}")
    if actual != expected:
        missing = sorted(expected - actual)
        extra = sorted(actual - expected)
        raise CatalogError(
            f"incomplete {label} matrix; missing={missing[:12]}, extra={extra[:12]}"
        )
    return values


def files_sorted(rows: Sequence[dict], axes: Sequence[str]) -> list[str]:
    return [row["file"] for row in sorted(rows, key=lambda row: tuple(row[a] for a in axes))]


def simple_summary(label: str, rows: Sequence[dict]) -> dict:
    values = require_complete(label, rows, ("variant", "rot"))
    return {
        "variants": len(values["variant"]),
        "variant_ids": values["variant"],
        "rots": values["rot"],
        "files": files_sorted(rows, ("variant", "rot")),
    }


def pattern_summary(label: str, rows: Sequence[dict]) -> dict:
    values = require_complete(label, rows, ("variant", "rot"))
    return {
        "variants": len(values["variant"]),
        "variant_ids": values["variant"],
        "rots": values["rot"],
        "files": files_sorted(rows, ("variant", "rot")),
    }


def road_summary(label: str, rows: Sequence[dict]) -> dict:
    values = require_complete(label, rows, ("variant", "damage", "rot"))
    return {
        "variants": len(values["variant"]),
        "variant_ids": values["variant"],
        "damages": values["damage"],
        "rots": values["rot"],
        "files": files_sorted(rows, ("variant", "damage", "rot")),
    }


def content_digest(tile_dir: Path, names: Sequence[str]) -> tuple[str, int]:
    digest = hashlib.sha256()
    total_bytes = 0
    for name in names:
        data = (tile_dir / name).read_bytes()
        total_bytes += len(data)
        digest.update(name.encode("utf-8"))
        digest.update(b"\0")
        digest.update(data)
    return digest.hexdigest(), total_bytes


def build_catalog(tile_dir: Path) -> dict:
    names = sorted(path.name for path in tile_dir.glob("*.png"))
    if not names:
        raise CatalogError(f"no PNG files found in {tile_dir}")

    dimensions: dict[tuple[int, int], list[str]] = {}
    for name in names:
        dimensions.setdefault(png_dimensions(tile_dir / name), []).append(name)
    if len(dimensions) != 1:
        detail = ", ".join(f"{size}: {len(files)}" for size, files in dimensions.items())
        raise CatalogError(f"mixed PNG canvas dimensions: {detail}")
    width, height = next(iter(dimensions))

    classified: set[str] = set()
    grounds = collect(
        names,
        classified,
        r"gnd_(?P<kind>cobble|street|grass|crater)_v(?P<variant>\d+)\.png",
        ("variant",),
    )
    buildings = collect(
        names,
        classified,
        r"bldg_s(?P<seed>\d+)_d(?P<damage>\d+)_rot(?P<rot>\d+)\.png",
        ("seed", "damage", "rot"),
    )
    rubble = collect(
        names,
        classified,
        r"rubble_v(?P<variant>\d+)_rot(?P<rot>\d+)\.png",
        ("variant", "rot"),
    )
    roads = collect(
        names,
        classified,
        r"road_(?P<pattern>straight|corner|tee|cross)_v(?P<variant>\d+)"
        r"(?:_d(?P<damage>\d+))?_rot(?P<rot>\d+)\.png",
        ("variant", "damage", "rot"),
    )
    for row in roads:
        row.setdefault("damage", 0)
    trenches = collect(
        names,
        classified,
        r"trench_(?P<pattern>straight|corner|end)_v(?P<variant>\d+)_rot(?P<rot>\d+)\.png",
        ("variant", "rot"),
    )
    bocage = collect(
        names,
        classified,
        r"bocage_(?P<pattern>straight|corner|end)_v(?P<variant>\d+)_rot(?P<rot>\d+)\.png",
        ("variant", "rot"),
    )
    foxholes = collect(
        names,
        classified,
        r"foxhole_v(?P<variant>\d+)_rot(?P<rot>\d+)\.png",
        ("variant", "rot"),
    )
    wires = collect(
        names,
        classified,
        r"wire_v(?P<variant>\d+)_rot(?P<rot>\d+)\.png",
        ("variant", "rot"),
    )
    props = collect(
        names,
        classified,
        r"prop_(?P<kind>hedgehog|sandbag|barrels)_v(?P<variant>\d+)_rot(?P<rot>\d+)\.png",
        ("variant", "rot"),
    )
    trees = collect(
        names,
        classified,
        r"tree_v(?P<variant>\d+)_rot(?P<rot>\d+)\.png",
        ("variant", "rot"),
    )
    vegetation = collect(
        names,
        classified,
        r"veg_v(?P<variant>\d+)_rot(?P<rot>\d+)\.png",
        ("variant", "rot"),
    )
    scars = collect(
        names,
        classified,
        r"scar_(?P<pattern>e1|e2a|e2o|e3|e4|full)_v(?P<variant>\d+)_rot(?P<rot>\d+)\.png",
        ("variant", "rot"),
    )
    green = collect(
        names,
        classified,
        r"grn_(?P<pattern>e1|e2a|e2o|e3|e4)_v(?P<variant>\d+)_rot(?P<rot>\d+)\.png",
        ("variant", "rot"),
    )
    crater_pairs = collect(
        names,
        classified,
        r"cpair_v(?P<variant>\d+)_(?P<tile>a|b)_rot(?P<rot>\d+)\.png",
        ("variant", "rot"),
    )
    specials = collect(
        names,
        classified,
        r"(?P<kind>church|factory)_d(?P<damage>\d+)_rot(?P<rot>\d+)\.png",
        ("damage", "rot"),
    )
    dirtpatches = collect(
        names,
        classified,
        r"dirtpatch_v(?P<variant>\d+)\.png",
        ("variant",),
    )
    tracks = collect(
        names,
        classified,
        r"track_v(?P<variant>\d+)_rot(?P<rot>\d+)\.png",
        ("variant", "rot"),
    )
    field_rows = collect(
        names,
        classified,
        r"fieldrows_v(?P<variant>\d+)_rot(?P<rot>\d+)\.png",
        ("variant", "rot"),
    )
    cobble_details = collect(
        names,
        classified,
        r"cobble_detail_v(?P<variant>\d+)\.png",
        ("variant",),
    )

    unclassified = sorted(set(names) - classified)
    if unclassified:
        raise CatalogError(f"unclassified PNG filenames: {', '.join(unclassified)}")

    ground_catalog: dict[str, list[str]] = {}
    for kind in ("cobble", "street", "grass", "crater"):
        rows = [row for row in grounds if row["kind"] == kind]
        require_complete(f"ground.{kind}", rows, ("variant",))
        ground_catalog[kind] = files_sorted(rows, ("variant",))

    require_complete("overlays.buildings", buildings, ("seed", "damage", "rot"))
    require_complete("overlays.rubble", rubble, ("variant", "rot"))

    road_catalog = {
        pattern: road_summary(
            f"extras.road.{pattern}", [row for row in roads if row["pattern"] == pattern]
        )
        for pattern in ("straight", "corner", "tee", "cross")
    }
    trench_catalog = {
        pattern: pattern_summary(
            f"extras.trench.{pattern}",
            [row for row in trenches if row["pattern"] == pattern],
        )
        for pattern in ("straight", "corner", "end")
    }
    bocage_catalog = {
        pattern: pattern_summary(
            f"extras.bocage.{pattern}",
            [row for row in bocage if row["pattern"] == pattern],
        )
        for pattern in ("straight", "corner", "end")
    }
    prop_catalog = {
        kind: simple_summary(
            f"extras.prop.{kind}", [row for row in props if row["kind"] == kind]
        )
        for kind in ("hedgehog", "sandbag", "barrels")
    }

    scar_catalog = {}
    for pattern, mask in SCAR_MASKS.items():
        rows = [row for row in scars if row["pattern"] == pattern]
        scar_catalog[pattern] = {
            "mask": mask,
            **pattern_summary(f"scar.patterns.{pattern}", rows),
        }

    green_catalog = {}
    for pattern in ("e1", "e2a", "e2o", "e3", "e4"):
        rows = [row for row in green if row["pattern"] == pattern]
        green_catalog[pattern] = {
            "mask": SCAR_MASKS[pattern],
            **pattern_summary(f"green.patterns.{pattern}", rows),
        }

    pair_values = require_complete(
        "scar.crater_pair", crater_pairs, ("variant", "tile", "rot")
    )
    for axis, expected in CRATER_PAIR_AXES.items():
        if pair_values[axis] != expected:
            raise CatalogError(
                f"scar.crater_pair {axis} values {pair_values[axis]} != {expected}"
            )

    special_catalog = {}
    for kind in ("church", "factory"):
        rows = [row for row in specials if row["kind"] == kind]
        values = require_complete(f"specials.{kind}", rows, ("damage", "rot"))
        special_catalog[kind] = {
            "damages": values["damage"],
            "rots": values["rot"],
            "files": files_sorted(rows, ("damage", "rot")),
        }

    patch_values = require_complete("decals.dirtpatch", dirtpatches, ("variant",))
    track_summary = simple_summary("extras.track", tracks)
    fieldrow_summary = simple_summary("extras.fieldrows", field_rows)
    cobble_values = require_complete("decals.cobble_detail", cobble_details, ("variant",))
    digest, total_bytes = content_digest(tile_dir, names)

    return {
        "meta": {
            "schema_version": 2,
            "generated_by": "scripts/hex_ruins/build_catalog.py",
            "canvas": [width, height],
            "px_per_m": normalized_number(width / VIEW_WIDTH_METERS),
            "hex_R_m": HEX_RADIUS_METERS,
            "hex_R_px": normalized_number(width * HEX_RADIUS_X_RATIO),
            "anchor_px": [
                normalized_number(width / 2.0),
                normalized_number(height * ANCHOR_Y_RATIO),
            ],
            "projection": PROJECTION,
            "tile_count": len(names),
        },
        "grounds": ground_catalog,
        "overlays": {
            "buildings": [
                {
                    "file": row["file"],
                    "seed": row["seed"],
                    "damage": row["damage"],
                    "rot": row["rot"],
                }
                for row in sorted(
                    buildings, key=lambda row: (row["seed"], row["damage"], row["rot"])
                )
            ],
            "rubble": [
                {
                    "file": row["file"],
                    "variant": row["variant"],
                    "rot": row["rot"],
                }
                for row in sorted(rubble, key=lambda row: (row["variant"], row["rot"]))
            ],
        },
        "extras": {
            "road": road_catalog,
            "trench": trench_catalog,
            "foxhole": simple_summary("extras.foxhole", foxholes),
            "bocage": bocage_catalog,
            "wire": simple_summary("extras.wire", wires),
            "prop": prop_catalog,
            "tree": simple_summary("extras.tree", trees),
            "veg": simple_summary("extras.veg", vegetation),
            "track": track_summary,
            "fieldrows": fieldrow_summary,
        },
        "scar": {
            "patterns": scar_catalog,
            "crater_pair": {
                "variants": len(pair_values["variant"]),
                "variant_ids": pair_values["variant"],
                "rots": pair_values["rot"],
                "tiles": pair_values["tile"],
                "files": files_sorted(crater_pairs, ("variant", "tile", "rot")),
            },
        },
        "green": {"patterns": green_catalog},
        "decals": {
            "dirtpatch": {
                "variants": len(patch_values["variant"]),
                "variant_ids": patch_values["variant"],
                "files": files_sorted(dirtpatches, ("variant",)),
            },
            "cobble_detail": {
                "variants": len(cobble_values["variant"]),
                "variant_ids": cobble_values["variant"],
                "files": files_sorted(cobble_details, ("variant",)),
            }
        },
        "specials": special_catalog,
        "inventory": {
            "png_count": len(names),
            "classified_count": len(classified),
            "total_bytes": total_bytes,
            "content_sha256": digest,
            "unclassified": [],
        },
    }


def serialize(catalog: dict) -> str:
    return json.dumps(catalog, ensure_ascii=False, indent=2) + "\n"


def check_catalog(path: Path, expected: str) -> int:
    if not path.exists():
        print(f"STALE: catalog is missing: {path}", file=sys.stderr)
        return 1
    current = path.read_text(encoding="utf-8")
    if current == expected:
        data = json.loads(expected)
        meta = data["meta"]
        print(
            f"OK: {path} matches {meta['tile_count']} PNGs "
            f"({meta['canvas'][0]}x{meta['canvas'][1]})"
        )
        return 0

    print(f"STALE: {path} does not match the rendered PNG set", file=sys.stderr)
    diff = difflib.unified_diff(
        current.splitlines(),
        expected.splitlines(),
        fromfile=str(path),
        tofile="generated catalog",
        lineterm="",
    )
    for line in itertools.islice(diff, 80):
        print(line, file=sys.stderr)
    print("Regenerate with: python scripts/hex_ruins/build_catalog.py", file=sys.stderr)
    return 1


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if catalog.json is stale")
    parser.add_argument(
        "--tiles",
        type=Path,
        default=DEFAULT_TILE_DIR,
        help="directory containing rendered PNG tiles",
    )
    parser.add_argument(
        "--catalog",
        type=Path,
        help="catalog path (default: <tiles>/catalog.json)",
    )
    args = parser.parse_args(argv)

    tile_dir = args.tiles.resolve()
    catalog_path = (args.catalog or (tile_dir / "catalog.json")).resolve()
    try:
        expected = serialize(build_catalog(tile_dir))
    except (CatalogError, OSError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    if args.check:
        return check_catalog(catalog_path, expected)

    catalog_path.write_text(expected, encoding="utf-8", newline="\n")
    meta = json.loads(expected)["meta"]
    print(
        f"WROTE: {catalog_path} -- {meta['tile_count']} PNGs, "
        f"{meta['canvas'][0]}x{meta['canvas'][1]}, "
        f"R{meta['hex_R_px']}, anchor={meta['anchor_px']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

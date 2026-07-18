# -*- coding: utf-8 -*-
"""Build the v8 tile catalog and a lightweight visual index."""

import argparse
import datetime
import html
import json
import re
import struct
from collections import defaultdict
from pathlib import Path

TILE_WIDTH = 288
TILE_HEIGHT = 384
MULTIHEX_MANIFEST_NAME = "multihex_assets.json"


BUILDING_RE = re.compile(
    r"^kbldg_(?P<seed>[^_]+)_(?P<abbr>.+)_d(?P<dmg>\d+)_rot(?P<rot>\d+)\.png$",
    re.IGNORECASE,
)
TREE_RE = re.compile(
    r"^tree_(?P<species>.+)_v(?P<variant>\d+)_rot(?P<rot>\d+)\.png$",
    re.IGNORECASE,
)
VIGNETTE_RE = re.compile(
    r"^vig_(?P<name>.+)_v(?P<variant>\d+)_rot(?P<rot>\d+)\.png$",
    re.IGNORECASE,
)


def ascii_text(value):
    return str(value).encode("ascii", "replace").decode("ascii")


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--v8-dir",
        default="C:/Projects/squad_tactics/asset/environment/hex_tiles_v8",
    )
    parser.add_argument("--out", default=None)
    parser.add_argument(
        "--multihex-manifest",
        default=None,
        help=(
            "Optional JSON list (or object with multihex_assets) to merge into "
            "the catalog. Defaults to <v8-dir>/multihex_assets.json; when that "
            "file is absent, an existing output catalog is preserved."
        ),
    )
    return parser.parse_args()


def _coordinate(value, label):
    if not isinstance(value, dict):
        raise ValueError("%s must be an object with integer q/r" % label)
    if "q" not in value or "r" not in value:
        raise ValueError("%s must contain q and r" % label)

    q = value["q"]
    r = value["r"]
    if isinstance(q, bool) or not isinstance(q, int):
        raise ValueError("%s.q must be an integer" % label)
    if isinstance(r, bool) or not isinstance(r, int):
        raise ValueError("%s.r must be an integer" % label)
    return q, r


def _piece_file(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("%s.file must be a non-empty relative path" % label)

    path = Path(value.strip())
    if path.is_absolute() or path.drive or path.root or ".." in path.parts:
        raise ValueError("%s.file must stay inside the v8 tile directory" % label)
    normalized = path.as_posix()
    if normalized in ("", "."):
        raise ValueError("%s.file must name a file" % label)
    if path.suffix.lower() != ".png":
        raise ValueError("%s.file must name a PNG" % label)
    return normalized


def png_dimensions(path):
    """Read PNG dimensions without adding an image-library dependency."""
    with path.open("rb") as handle:
        header = handle.read(24)
    if len(header) < 24 or header[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("multihex piece is not a PNG: %s" % path)
    if header[12:16] != b"IHDR":
        raise ValueError("multihex PNG has no leading IHDR: %s" % path)
    return struct.unpack(">II", header[16:24])


def validate_multihex_assets(assets, v8_dir):
    """Validate and normalize the optional multi-hex catalog extension."""
    if assets is None:
        return []
    if not isinstance(assets, list):
        raise ValueError("multihex_assets must be a list")

    v8_dir = Path(v8_dir)
    normalized_assets = []
    seen_ids = set()
    seen_files = set()
    required = {
        "id",
        "kind",
        "world_scale",
        "origin",
        "pieces",
        "occupied_cells",
    }

    for asset_index, source_asset in enumerate(assets):
        label = "multihex_assets[%d]" % asset_index
        if not isinstance(source_asset, dict):
            raise ValueError("%s must be an object" % label)

        missing = sorted(required.difference(source_asset))
        if missing:
            raise ValueError("%s missing required fields: %s" % (label, ", ".join(missing)))

        asset_id = source_asset["id"]
        if not isinstance(asset_id, str) or not asset_id.strip():
            raise ValueError("%s.id must be a non-empty string" % label)
        asset_id = asset_id.strip()
        if asset_id in seen_ids:
            raise ValueError("duplicate multihex asset id: %s" % asset_id)
        seen_ids.add(asset_id)

        kind = source_asset["kind"]
        if not isinstance(kind, str) or not kind.strip():
            raise ValueError("%s.kind must be a non-empty string" % label)
        kind = kind.strip()

        world_scale = source_asset["world_scale"]
        if (
            isinstance(world_scale, bool)
            or not isinstance(world_scale, (int, float))
            or float(world_scale) != 1.0
        ):
            raise ValueError("%s.world_scale must be exactly 1.0" % label)

        origin = _coordinate(source_asset["origin"], label + ".origin")
        pieces = source_asset["pieces"]
        occupied_cells = source_asset["occupied_cells"]
        if not isinstance(pieces, list) or not pieces:
            raise ValueError("%s.pieces must be a non-empty list" % label)
        if not isinstance(occupied_cells, list) or not occupied_cells:
            raise ValueError("%s.occupied_cells must be a non-empty list" % label)

        piece_cells = set()
        local_files = set()
        normalized_pieces = []
        for piece_index, source_piece in enumerate(pieces):
            piece_label = "%s.pieces[%d]" % (label, piece_index)
            if not isinstance(source_piece, dict):
                raise ValueError("%s must be an object" % piece_label)
            cell = _coordinate(source_piece, piece_label)
            if cell in piece_cells:
                raise ValueError("%s has duplicate piece cell %s" % (label, cell))
            piece_cells.add(cell)

            filename = _piece_file(source_piece.get("file"), piece_label)
            file_key = filename.casefold()
            if file_key in local_files:
                raise ValueError("%s has duplicate piece file %s" % (label, filename))
            if file_key in seen_files:
                raise ValueError("multihex piece file is claimed more than once: %s" % filename)
            local_files.add(file_key)
            seen_files.add(file_key)

            piece_path = v8_dir / Path(filename)
            if piece_path.exists():
                if not piece_path.is_file():
                    raise ValueError("multihex piece is not a file: %s" % piece_path)
                width, height = png_dimensions(piece_path)
                if (width, height) != (TILE_WIDTH, TILE_HEIGHT):
                    raise ValueError(
                        "%s must be %dx%d, got %dx%d"
                        % (filename, TILE_WIDTH, TILE_HEIGHT, width, height)
                    )

            normalized_piece = dict(source_piece)
            normalized_piece["q"], normalized_piece["r"] = cell
            normalized_piece["file"] = filename
            normalized_pieces.append(normalized_piece)

        occupied_set = set()
        normalized_occupied = []
        for cell_index, source_cell in enumerate(occupied_cells):
            cell_label = "%s.occupied_cells[%d]" % (label, cell_index)
            cell = _coordinate(source_cell, cell_label)
            if cell in occupied_set:
                raise ValueError("%s has duplicate occupied cell %s" % (label, cell))
            occupied_set.add(cell)
            normalized_occupied.append({"q": cell[0], "r": cell[1]})

        if piece_cells != occupied_set:
            missing_pieces = sorted(occupied_set.difference(piece_cells))
            missing_occupancy = sorted(piece_cells.difference(occupied_set))
            raise ValueError(
                "%s piece/occupied cells differ (without pieces=%s, without occupancy=%s)"
                % (label, missing_pieces, missing_occupancy)
            )
        if origin not in occupied_set:
            raise ValueError("%s.origin must be one of occupied_cells" % label)

        damage_stage = source_asset.get("damage_stage")
        if "damage_stage" in source_asset and (
            isinstance(damage_stage, bool)
            or not isinstance(damage_stage, int)
            or damage_stage < 0
        ):
            raise ValueError("%s.damage_stage must be a non-negative integer" % label)

        normalized_asset = dict(source_asset)
        normalized_asset["id"] = asset_id
        normalized_asset["kind"] = kind
        normalized_asset["world_scale"] = 1.0
        normalized_asset["origin"] = {"q": origin[0], "r": origin[1]}
        normalized_asset["pieces"] = normalized_pieces
        normalized_asset["occupied_cells"] = normalized_occupied
        normalized_assets.append(normalized_asset)

    return normalized_assets


def _read_multihex_source(path):
    with Path(path).open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if isinstance(payload, dict):
        if "multihex_assets" not in payload:
            raise ValueError("%s does not contain multihex_assets" % path)
        payload = payload["multihex_assets"]
    return payload


def load_multihex_assets(v8_dir, out_path, manifest_path=None):
    """Load explicit/default definitions, or preserve an existing catalog list."""
    v8_dir = Path(v8_dir)
    out_path = Path(out_path)

    if manifest_path is not None:
        source_path = Path(manifest_path)
        if not source_path.exists():
            raise ValueError("multihex manifest does not exist: %s" % source_path)
        assets = _read_multihex_source(source_path)
    else:
        default_manifest = v8_dir / MULTIHEX_MANIFEST_NAME
        if default_manifest.exists():
            assets = _read_multihex_source(default_manifest)
        elif out_path.exists():
            with out_path.open("r", encoding="utf-8") as handle:
                existing = json.load(handle)
            assets = existing.get("multihex_assets", []) if isinstance(existing, dict) else []
        else:
            assets = []

    return validate_multihex_assets(assets, v8_dir)


def parse_tile(filename):
    match = BUILDING_RE.match(filename)
    if match:
        data = match.groupdict()
        base = "kbldg_%s_%s" % (data["seed"], data["abbr"])
        return {
            "kind": "building",
            "file": filename,
            "base": base,
            "seed": data["seed"],
            "dmg": int(data["dmg"]),
            "rot": int(data["rot"]),
        }

    match = TREE_RE.match(filename)
    if match:
        data = match.groupdict()
        return {
            "kind": "tree",
            "file": filename,
            "base": "tree_" + data["species"],
            "species": data["species"],
            "variant": int(data["variant"]),
            "rot": int(data["rot"]),
        }

    match = VIGNETTE_RE.match(filename)
    if match:
        data = match.groupdict()
        return {
            "kind": "vignette",
            "file": filename,
            "base": "vig_" + data["name"],
            "name": data["name"],
            "variant": int(data["variant"]),
            "rot": int(data["rot"]),
        }

    return {"kind": "unknown", "file": filename}


def build_bases(tiles):
    grouped = defaultdict(list)
    for tile in tiles:
        if tile["kind"] != "unknown":
            grouped[tile["base"]].append(tile)

    bases = {}
    for base in sorted(grouped):
        entries = grouped[base]
        kind = entries[0]["kind"]
        result = {
            "kind": kind,
            "rotations": sorted({entry["rot"] for entry in entries}),
        }
        if kind == "building":
            result["dmgs"] = sorted({entry["dmg"] for entry in entries})
        bases[base] = result
    return bases


def tile_for(entries, variant=None, dmg=None):
    for entry in entries:
        if entry["rot"] != 0:
            continue
        if variant is not None and entry.get("variant") != variant:
            continue
        if dmg is not None and entry.get("dmg") != dmg:
            continue
        return entry
    return None


def make_index_html(tiles, bases):
    by_base = defaultdict(list)
    for tile in tiles:
        if tile["kind"] != "unknown":
            by_base[tile["base"]].append(tile)

    rows = []
    for base in sorted(bases):
        entries = by_base[base]
        kind = bases[base]["kind"]
        thumbs = []

        if kind == "building":
            for dmg in bases[base]["dmgs"]:
                entry = tile_for(entries, dmg=dmg)
                if entry:
                    thumbs.append(
                        '<div class="tile"><span>d%d</span><img src="%s" width="180"></div>'
                        % (dmg, html.escape(entry["file"], quote=True))
                    )
        else:
            variants = sorted({entry["variant"] for entry in entries})
            for variant in variants:
                entry = tile_for(entries, variant=variant)
                if entry:
                    thumbs.append(
                        '<div class="tile"><span>v%d</span><img src="%s" width="180"></div>'
                        % (variant, html.escape(entry["file"], quote=True))
                    )

        rows.append(
            '<section><h2>%s <small>%s</small></h2><div class="tiles">%s</div></section>'
            % (
                html.escape(base),
                html.escape(kind),
                "".join(thumbs) or '<span class="missing">No rot0 tile</span>',
            )
        )

    return """<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Hex Tiles V8 Catalog</title>
<style>
body { background:#171a1f; color:#d7dbe0; font-family:Arial,sans-serif; margin:24px; }
h1 { color:#f0f2f4; }
section { border-top:1px solid #3a4049; padding:14px 0 20px; }
h2 { font-size:16px; margin:0 0 10px; }
small { color:#8da0b2; font-weight:normal; margin-left:8px; }
.tiles { display:flex; flex-wrap:wrap; gap:12px; }
.tile { background:#242a32; border:1px solid #3d4652; padding:7px; display:flex; flex-direction:column; gap:5px; }
.tile span { color:#aebaca; font-size:12px; }
img { background:#080a0c; image-rendering:auto; }
.missing { color:#d69a75; }
</style>
</head>
<body>
<h1>Hex Tiles V8 Catalog</h1>
%s
</body>
</html>
""" % "\n".join(rows)


def main():
    args = parse_args()
    v8_dir = Path(args.v8_dir)
    out_path = Path(args.out) if args.out else v8_dir / "catalog.json"
    multihex_assets = load_multihex_assets(
        v8_dir,
        out_path,
        manifest_path=args.multihex_manifest,
    )
    multihex_files = {
        piece["file"].casefold()
        for asset in multihex_assets
        for piece in asset["pieces"]
    }

    tiles = []
    unknown_count = 0
    for image_path in sorted(v8_dir.glob("*.png")):
        # Explicit multi-hex pieces live in their own catalog namespace. This
        # leaves every pre-existing legacy tile entry unchanged while keeping
        # new piece files out of the legacy/unknown list.
        if image_path.name.casefold() in multihex_files:
            continue
        tile = parse_tile(image_path.name)
        tiles.append(tile)
        if tile["kind"] == "unknown":
            unknown_count += 1
            print("WARN unknown tile %s" % ascii_text(image_path.name))

    bases = build_bases(tiles)
    catalog = {
        "meta": {
            "generated": datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
            "count": len(tiles),
            "multihex_count": len(multihex_assets),
        },
        "tiles": tiles,
        "bases": bases,
        "multihex_assets": multihex_assets,
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(catalog, handle, indent=2, ensure_ascii=False)
        handle.write("\n")

    index_path = v8_dir / "index.html"
    with open(index_path, "w", encoding="utf-8") as handle:
        handle.write(make_index_html(tiles, bases))

    print(
        "CATALOG OK tiles=%d bases=%d multihex=%d unknown=%d"
        % (len(tiles), len(bases), len(multihex_assets), unknown_count)
    )


if __name__ == "__main__":
    main()

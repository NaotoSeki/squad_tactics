#!/usr/bin/env python3
"""Render PS-object ledgers with canonical, raised-HD, and tree-HD catalogs."""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SEED_RE = re.compile(r"^ps_seed_(\d+)_ground_hd_x(\d+)\.png$")


@dataclass(frozen=True)
class MapRecord:
    seed: int
    ratio: int
    canonical_background: Path
    hd_background: Path
    ledger: Path


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _font(size: int) -> ImageFont.ImageFont:
    for candidate in (
        Path("C:/Windows/Fonts/meiryo.ttc"),
        Path("C:/Windows/Fonts/arial.ttf"),
    ):
        if candidate.is_file():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def _fit_rgb(path: Path, size: tuple[int, int]) -> Image.Image:
    with Image.open(path) as source:
        image = source.convert("RGB")
        image.thumbnail(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", size, (24, 27, 23))
    canvas.paste(
        image,
        ((size[0] - image.width) // 2, (size[1] - image.height) // 2),
    )
    return canvas


def _records(
    hd_dir: Path,
    canonical_dir: Path,
) -> list[MapRecord]:
    records: list[MapRecord] = []
    for hd_path in hd_dir.glob("ps_seed_*_ground_hd_x*.png"):
        match = SEED_RE.match(hd_path.name)
        if not match:
            continue
        seed = int(match.group(1))
        ratio = int(match.group(2))
        canonical = canonical_dir / f"ps_seed_{seed}.png"
        ledger = canonical_dir / f"ps_seed_{seed}_objects.json"
        if canonical.is_file() and ledger.is_file():
            records.append(
                MapRecord(seed, ratio, canonical, hd_path, ledger)
            )
    records.sort(key=lambda item: item.seed)
    return records


def _slot_draws(
    ledger: dict[str, Any],
) -> tuple[list[tuple[int, int, int, str, int, str]], ...]:
    shadows: list[tuple[int, int, int, str, int, str]] = []
    bodies: list[tuple[int, int, int, str, int, str]] = []
    for order, spec in enumerate(ledger.get("objects", [])):
        asset = str(spec["asset"])
        family = str(spec["family"])
        x = int(spec["x"])
        y = int(spec["y"])
        if spec.get("composite"):
            shadow_slots = spec.get("shadow_slots", [])
            body_slots = spec.get("body_slots", [])
        else:
            shadow_slots = (
                [spec["shadow_slot"]]
                if spec.get("shadow_slot") is not None
                else []
            )
            body_slots = (
                [spec["body_slot"]]
                if spec.get("body_slot") is not None
                else []
            )
        for local_order, slot in enumerate(shadow_slots):
            shadows.append(
                (
                    order * 100 + local_order,
                    y,
                    x,
                    asset,
                    int(slot),
                    family,
                )
            )
        for local_order, slot in enumerate(body_slots):
            bodies.append(
                (
                    order * 100 + local_order,
                    y,
                    x,
                    asset,
                    int(slot),
                    family,
                )
            )
    bodies.sort(key=lambda item: (item[1], item[0]))
    return shadows, bodies


def _composite_at(
    canvas: Image.Image,
    sprite: Image.Image,
    left: int,
    top: int,
) -> None:
    right = left + sprite.width
    bottom = top + sprite.height
    clip_left = max(0, left)
    clip_top = max(0, top)
    clip_right = min(canvas.width, right)
    clip_bottom = min(canvas.height, bottom)
    if clip_left >= clip_right or clip_top >= clip_bottom:
        return
    crop = sprite.crop(
        (
            clip_left - left,
            clip_top - top,
            clip_right - left,
            clip_bottom - top,
        )
    )
    canvas.alpha_composite(crop, (clip_left, clip_top))


class CatalogRenderer:
    def __init__(
        self,
        canonical_manifest: Path,
        raised_manifest: Path,
        tree_manifest: Path,
    ) -> None:
        self.canonical_manifest_path = canonical_manifest.resolve()
        self.canonical = _read_json(self.canonical_manifest_path)
        self.raised_catalogs = [
            (raised_manifest.resolve(), _read_json(raised_manifest.resolve())),
            (tree_manifest.resolve(), _read_json(tree_manifest.resolve())),
        ]
        self._canonical_cache: dict[str, Image.Image] = {}
        self._raised_cache: dict[str, Image.Image] = {}

        if self.canonical.get("schema") != "ps_object_assets/v1":
            raise ValueError("unsupported canonical object manifest")
        for manifest_path, manifest in self.raised_catalogs:
            if manifest.get("schema") != "raised-hd-manifest/v1":
                raise ValueError(
                    f"unsupported raised-HD manifest: {manifest_path}"
                )
            if manifest.get("status") != "production-complete":
                raise ValueError(
                    f"raised-HD manifest is not production-complete: "
                    f"{manifest_path}"
                )

    def close(self) -> None:
        for image in (*self._canonical_cache.values(), *self._raised_cache.values()):
            image.close()

    def _canonical_sprite(
        self,
        key: str,
    ) -> tuple[dict[str, Any], Image.Image]:
        meta = self.canonical["sprites"].get(key)
        if not meta:
            raise KeyError(f"canonical sprite missing: {key}")
        if key not in self._canonical_cache:
            path = self.canonical_manifest_path.parent / meta["file"]
            self._canonical_cache[key] = Image.open(path).convert("RGBA")
        return meta, self._canonical_cache[key]

    def _raised_sprite(
        self,
        key: str,
        canonical_meta: dict[str, Any],
    ) -> tuple[dict[str, Any], Image.Image] | None:
        for manifest_path, manifest in self.raised_catalogs:
            meta = manifest["sprites"].get(key)
            if not meta:
                continue
            if int(meta.get("pixelRatio", manifest["pixelRatio"])) != 2:
                raise ValueError(f"raised-HD pixel ratio mismatch: {key}")
            if (meta.get("ox"), meta.get("oy")) != (
                canonical_meta.get("ox"),
                canonical_meta.get("oy"),
            ):
                raise ValueError(f"raised-HD origin mismatch: {key}")
            if key not in self._raised_cache:
                path = manifest_path.parent / meta["file"]
                self._raised_cache[key] = Image.open(path).convert("RGBA")
            return meta, self._raised_cache[key]
        return None

    def render(
        self,
        background: Path,
        ledger_path: Path,
        *,
        raised: bool,
    ) -> tuple[Image.Image, dict[str, int]]:
        ledger = _read_json(ledger_path)
        with Image.open(background) as source:
            canvas = source.convert("RGBA")
        ratio = 2 if raised else 1
        expected = (
            int(ledger["image_width"]) * ratio,
            int(ledger["image_height"]) * ratio,
        )
        if canvas.size != expected:
            raise ValueError(
                f"{background.name}: expected {expected}, found {canvas.size}"
            )

        audit = {
            "draws": 0,
            "raisedHdDraws": 0,
            "canonicalFallbackDraws": 0,
            "treeFallbackDraws": 0,
        }
        shadows, bodies = _slot_draws(ledger)
        for _order, y, x, asset, slot, family in (*shadows, *bodies):
            key = f"{asset}_s{slot}"
            canonical_meta, canonical_sprite = self._canonical_sprite(key)
            sprite = canonical_sprite
            meta = canonical_meta
            if raised:
                override = self._raised_sprite(key, canonical_meta)
                if override:
                    meta, sprite = override
                    audit["raisedHdDraws"] += 1
                else:
                    sprite = canonical_sprite.resize(
                        (
                            canonical_sprite.width * ratio,
                            canonical_sprite.height * ratio,
                        ),
                        Image.Resampling.LANCZOS,
                    )
                    audit["canonicalFallbackDraws"] += 1
                    if family == "tree":
                        audit["treeFallbackDraws"] += 1
            left = ratio * (x + int(meta["ox"]))
            top = ratio * (y + int(meta["oy"]))
            _composite_at(canvas, sprite, left, top)
            if raised and sprite is not canonical_sprite and key not in self._raised_cache:
                sprite.close()
            audit["draws"] += 1
        return canvas, audit


def build_maps(
    records: list[MapRecord],
    renderer: CatalogRenderer,
    output_dir: Path,
) -> list[tuple[MapRecord, Path, Path, dict[str, int]]]:
    output_dir.mkdir(parents=True, exist_ok=True)
    outputs: list[tuple[MapRecord, Path, Path, dict[str, int]]] = []
    for record in records:
        canonical, _canonical_audit = renderer.render(
            record.canonical_background,
            record.ledger,
            raised=False,
        )
        hd, audit = renderer.render(
            record.hd_background,
            record.ledger,
            raised=True,
        )
        original_path = output_dir / f"ps_seed_{record.seed}_objects_ps.png"
        hd_path = (
            output_dir
            / f"ps_seed_{record.seed}_ground_raised_hd_x{record.ratio}.png"
        )
        canonical.convert("RGB").save(original_path)
        hd.convert("RGB").save(hd_path)
        canonical.close()
        hd.close()
        audit_path = hd_path.with_suffix(".json")
        audit_path.write_text(
            json.dumps(
                {
                    "schema": "raised-hd-map-review/v1",
                    "seed": record.seed,
                    "pixelRatio": record.ratio,
                    "audit": audit,
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        outputs.append((record, original_path, hd_path, audit))
    return outputs


def build_contact(
    outputs: list[tuple[MapRecord, Path, Path, dict[str, int]]],
    output: Path,
    *,
    columns: int = 2,
    preview_size: int = 300,
) -> Path:
    columns = max(1, columns)
    rows = (len(outputs) + columns - 1) // columns
    margin = 18
    gap = 10
    header = 72
    cell_width = preview_size * 2 + gap + margin * 2
    cell_height = preview_size + header + margin
    sheet = Image.new(
        "RGB",
        (cell_width * columns, cell_height * rows),
        (31, 35, 29),
    )
    draw = ImageDraw.Draw(sheet)
    title_font = _font(18)
    label_font = _font(13)
    note_font = _font(11)

    for index, (record, original_path, hd_path, audit) in enumerate(outputs):
        column = index % columns
        row = index // columns
        left = column * cell_width
        top = row * cell_height
        draw.rounded_rectangle(
            (left + 5, top + 5, left + cell_width - 5, top + cell_height - 5),
            radius=12,
            fill=(42, 47, 38),
            outline=(102, 111, 86),
            width=2,
        )
        draw.text(
            (left + margin, top + 13),
            f"seed {record.seed} | complete ground + raised HD placement",
            font=title_font,
            fill=(229, 232, 214),
        )
        draw.text(
            (left + margin, top + 39),
            "PS original",
            font=label_font,
            fill=(181, 190, 164),
        )
        draw.text(
            (left + margin + preview_size + gap, top + 39),
            "HD ground + raised HD",
            font=label_font,
            fill=(198, 215, 166),
        )
        draw.text(
            (left + margin + preview_size + gap, top + 56),
            (
                f"HD draws {audit['raisedHdDraws']} | "
                f"tree fallbacks {audit['treeFallbackDraws']}"
            ),
            font=note_font,
            fill=(177, 184, 160),
        )
        image_top = top + header
        sheet.paste(
            _fit_rgb(original_path, (preview_size, preview_size)),
            (left + margin, image_top),
        )
        sheet.paste(
            _fit_rgb(hd_path, (preview_size, preview_size)),
            (left + margin + preview_size + gap, image_top),
        )

    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output)
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--hd-dir",
        type=Path,
        default=ROOT / "output" / "ground_hd_maps",
    )
    parser.add_argument(
        "--canonical-dir",
        type=Path,
        default=ROOT / "asset" / "environment" / "maps",
    )
    parser.add_argument(
        "--canonical-manifest",
        type=Path,
        default=ROOT / "asset" / "environment" / "ps_objects" / "manifest.json",
    )
    parser.add_argument(
        "--raised-manifest",
        type=Path,
        default=ROOT / "asset" / "environment" / "raised_hd" / "manifest.json",
    )
    parser.add_argument(
        "--tree-manifest",
        type=Path,
        default=(
            ROOT
            / "asset"
            / "environment"
            / "trees_hd"
            / "production"
            / "runtime_ps_manifest.json"
        ),
    )
    parser.add_argument(
        "--map-output",
        type=Path,
        default=ROOT / "output" / "raised_hd_maps",
    )
    parser.add_argument(
        "--contact-output",
        type=Path,
        default=(
            ROOT
            / "output"
            / "raised_hd_review"
            / "all_maps_original_vs_raised_hd.png"
        ),
    )
    parser.add_argument("--columns", type=int, default=2)
    parser.add_argument("--preview-size", type=int, default=300)
    args = parser.parse_args()

    records = _records(args.hd_dir.resolve(), args.canonical_dir.resolve())
    if not records:
        raise SystemExit("no matching PS/HD map records")
    renderer = CatalogRenderer(
        args.canonical_manifest,
        args.raised_manifest,
        args.tree_manifest,
    )
    try:
        outputs = build_maps(records, renderer, args.map_output.resolve())
    finally:
        renderer.close()
    contact = build_contact(
        outputs,
        args.contact_output.resolve(),
        columns=args.columns,
        preview_size=args.preview_size,
    )
    summary = {
        "status": "ok",
        "maps": len(outputs),
        "raisedHdDraws": sum(item[3]["raisedHdDraws"] for item in outputs),
        "treeFallbackDraws": sum(
            item[3]["treeFallbackDraws"] for item in outputs
        ),
        "contact": str(contact),
    }
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()

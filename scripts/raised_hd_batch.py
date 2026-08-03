#!/usr/bin/env python3
"""List and visually inspect deterministic ImageGen jobs for raised assets.

This script prepares one body-only ImageGen edit job per canonical body/state
slot.  It does not invoke ImageGen.  A paired canonical shadow may be supplied
as Image 2, but only as geometric calibration; the final HD shadow is produced
later from the accepted generated HD body.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
HD_DIR = ROOT / "asset" / "environment" / "raised_hd"
DEFAULT_INVENTORY = HD_DIR / "inventory.json"
DEFAULT_CONTACT = (
    ROOT / "output" / "raised_hd_review" / "batch_contact.png"
)
PIXEL_RATIO = 2

FAMILY_SUBJECT = {
    "building": (
        "the exact rural civilian building and the exact intact or damage "
        "state depicted by this body slot"
    ),
    "fence": (
        "the exact fence segment/orientation or crushed segment depicted by "
        "this body slot, including every connection endpoint"
    ),
    "large_prop": (
        "the exact isolated battlefield/environment prop depicted by this "
        "body slot, preserving identity, quantity, and arrangement"
    ),
    "shrub": (
        "the exact shrub or flattened vegetation state depicted by this body "
        "slot, preserving species cues, branching masses, gaps, and footprint"
    ),
    "tree": (
        "the exact tree species and individual crown depicted by this body "
        "slot, preserving trunk, branching masses, negative gaps, and footprint"
    ),
}

FAMILY_AVOID = {
    "building": (
        "changed roofline, extra chimney, changed window or door count, "
        "modern materials, new debris, repaired damage"
    ),
    "fence": (
        "connection drift, extra posts, missing rails, changed orientation, "
        "new gate, repaired crushed parts"
    ),
    "large_prop": (
        "substitute object identity, changed object count, new accessories, "
        "modern design, altered arrangement"
    ),
    "shrub": (
        "tree form, changed species, oversized leaves, new blossoms, pot, "
        "extra plants, dense circular topiary"
    ),
    "tree": (
        "changed species, taller or thicker trunk, redesigned crown, oversized "
        "leaves, extra tree, ground patch, wind-bent pose, or motion blur"
    ),
}

LIGHTING_INVARIANT = (
    "Lighting/mood: use only the shared ps-overcast-upper-left-v1 lighting: "
    "one large soft neutral key arriving from screen upper-left, high "
    "overcast ambient fill, highlights on upper-left-facing relief, and "
    "every micro-shadow or cast shadow toward screen lower-right. No second "
    "light, front flash, rim light, hard sun, HDR, or cinematic grading."
)


def read_inventory(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def resolve_reference(inventory_path: Path, value: str) -> Path:
    return (inventory_path.parent / value).resolve()


def slot_index(asset: dict[str, Any]) -> dict[int, dict[str, Any]]:
    return {
        int(record["slot"]): record
        for record in asset["canonicalSlots"]
    }


def variant_kind(roles: list[str]) -> str:
    if "crushedBody" in roles:
        return "crushed"
    if "body" in roles:
        return "standing"
    return "alternate-state"


def prompt_for(
    asset: dict[str, Any],
    variant: dict[str, Any],
    *,
    has_shadow_reference: bool,
) -> str:
    family = asset["family"]
    body_slot = int(variant["bodySlot"])
    kind = variant_kind(variant["roles"])
    if has_shadow_reference:
        inputs = (
            "Image 1 is the edit target and absolute body silhouette, "
            "footprint, orientation, camera, material/state, base contact, and "
            "anchor authority. Image 2 is canonical-shadow geometry "
            "calibration only for contact point, direction, footprint, extent, "
            "penumbra, and density; never copy its pixels and do not render it "
            "in the body output."
        )
    else:
        inputs = (
            "Image 1 is the edit target and absolute body silhouette, "
            "footprint, orientation, camera, material/state, base contact, and "
            "anchor authority. This state is intentionally shadowless."
        )

    return "\n".join(
        (
            "Use case: precise-object-edit",
            (
                "Asset type: production 2D isometric raised-object BODY cutout "
                "for a photorealistic WWII tactical game"
            ),
            f"Input images: {inputs}",
            (
                "Primary request: faithfully reconstruct and upscale exactly "
                f"{asset['id']} body slot {body_slot} ({kind}) at substantially "
                "higher photographic detail. This is not a redesign."
            ),
            f"Subject: {FAMILY_SUBJECT[family]}.",
            (
                "Composition/framing: centered with generous padding; preserve "
                "the exact PS-native silhouette, footprint proportions, "
                "long-axis direction, internal mass distribution, holes/gaps, "
                "ground-contact point, anchor relationship, damage state, and "
                "elevated 2:1 isometric/top-down viewpoint."
            ),
            (
                "Style/medium: restrained photorealistic reconstruction with "
                "physically plausible bark, foliage, timber, masonry, metal, "
                "or fabric as applicable, while retaining the muted "
                "low-contrast PS-era battlefield palette."
            ),
            LIGHTING_INVARIANT,
            (
                "Scene/backdrop: perfectly flat uniform solid #ff00ff "
                "chroma-key background for local removal."
            ),
            (
                "Body-output constraint: output the BODY ONLY. No cast shadow, "
                "contact shadow, ambient-occlusion blob outside the silhouette, "
                "floor plane, ground patch, reflection, smoke, text, border, "
                "watermark, or extra object. Keep #ff00ff perfectly uniform and "
                "never use it in the subject."
            ),
            (
                "Invariants: change only resolution and plausible sub-pixel "
                "material detail; preserve semantic identity and exact state. "
                f"Avoid {FAMILY_AVOID[family]}; no perspective change, rotation, "
                "mirroring, footprint enlargement, cropping, or anchor drift."
            ),
            (
                "Tree animation contract: when this is a tree, render one "
                "static neutral-rest body with naturally separable secondary "
                "branch and leaf masses and narrow negative gaps. Runtime, not "
                "this image, applies a restrained whole-body sway of 0.42 "
                "degrees and scaleX 0.0035 over 4200 ms. Do not render motion "
                "blur, a wind-bent pose, or multiple animation frames."
            ),
            (
                "Downstream shadow contract: after this generated body is "
                "accepted and keyed, synthesize its HD shadow from this "
                "generated body's own alpha and height/mass cues along screen "
                "vector (0.72, 0.69). The canonical shadow is calibration only. "
                "Never copy, trace, paste, recolor, scale, or reuse canonical "
                "shadow pixels as the HD shadow."
            ),
        )
    )


def pending_jobs(
    inventory_path: Path,
    families: set[str] | None,
    output_root: Path | None = None,
) -> list[dict[str, Any]]:
    inventory = read_inventory(inventory_path)
    output_root = (output_root or HD_DIR).resolve()
    jobs: list[dict[str, Any]] = []
    for asset in inventory["assets"]:
        family = asset["family"]
        if families and family not in families:
            continue
        canonical = slot_index(asset)
        for variant in asset["bodyVariants"]:
            body_slot = int(variant["bodySlot"])
            shadow_slot = variant["pairedShadowSlot"]
            body_record = canonical[body_slot]
            shadow_record = (
                canonical[int(shadow_slot)]
                if shadow_slot is not None
                else None
            )
            job_id = f"{asset['id']}_s{body_slot}"
            body_output = (
                output_root
                / "body"
                / f"{asset['id']}_s{body_slot}_body_hd_v1.png"
            )
            body_reference = resolve_reference(
                inventory_path,
                body_record["reference"],
            )
            shadow_reference = (
                resolve_reference(
                    inventory_path,
                    shadow_record["reference"],
                )
                if shadow_record is not None
                else None
            )
            shadow_output = (
                output_root
                / "shadow"
                / f"{asset['id']}_s{int(shadow_slot)}_shadow_hd_v1.png"
                if shadow_slot is not None
                else None
            )
            metadata_output = (
                output_root / "metadata" / f"{asset['id']}_s{body_slot}.json"
            )
            if (
                body_output.is_file()
                and metadata_output.is_file()
                and (
                    shadow_output is None
                    or shadow_output.is_file()
                )
            ):
                continue
            referenced_paths = [str(body_reference)]
            if shadow_reference is not None:
                referenced_paths.append(str(shadow_reference))
            jobs.append(
                {
                    "jobId": job_id,
                    "id": asset["id"],
                    "family": family,
                    "usageCount": int(asset["usageCount"]),
                    "usageByMap": asset["usageByMap"],
                    "variantKind": variant_kind(variant["roles"]),
                    "roles": variant["roles"],
                    "bodySlot": body_slot,
                    "pairedShadowSlot": shadow_slot,
                    "reference": body_record["reference"],
                    "referenceAbsolute": str(body_reference),
                    "referenceSize": body_record["referenceSize"],
                    "origin": body_record["origin"],
                    "shadowReference": (
                        shadow_record["reference"]
                        if shadow_record is not None
                        else None
                    ),
                    "shadowReferenceAbsolute": (
                        str(shadow_reference)
                        if shadow_reference is not None
                        else None
                    ),
                    "shadowReferenceSize": (
                        shadow_record["referenceSize"]
                        if shadow_record is not None
                        else None
                    ),
                    "shadowOrigin": (
                        shadow_record["origin"]
                        if shadow_record is not None
                        else None
                    ),
                    "referencedImagePaths": referenced_paths,
                    "pixelRatio": PIXEL_RATIO,
                    "outputSize": [
                        int(value) * PIXEL_RATIO
                        for value in body_record["referenceSize"]
                    ],
                    "sourceAbsolute": str(
                        (
                            ROOT
                            / "tmp"
                            / "raised_hd"
                            / f"{job_id}_source.png"
                        ).resolve()
                    ),
                    "cutoutAbsolute": str(
                        (
                            ROOT
                            / "tmp"
                            / "raised_hd"
                            / f"{job_id}_cutout.png"
                        ).resolve()
                    ),
                    "outputAbsolute": str(body_output.resolve()),
                    "shadowOutputAbsolute": (
                        str(shadow_output.resolve())
                        if shadow_output is not None
                        else None
                    ),
                    "metadataOutputAbsolute": str(
                        metadata_output.resolve()
                    ),
                    "shadowOutputSize": (
                        [
                            int(value) * PIXEL_RATIO
                            for value in shadow_record["referenceSize"]
                        ]
                        if shadow_record is not None
                        else None
                    ),
                    "lightingContract": "ps-overcast-upper-left-v1",
                    "shadowMethod": "generated-body-derived",
                    "prompt": prompt_for(
                        asset,
                        variant,
                        has_shadow_reference=shadow_record is not None,
                    ),
                }
            )

    family_rank = {
        family: index
        for index, family in enumerate(
            ("building", "fence", "large_prop", "shrub", "tree")
        )
    }
    kind_rank = {
        "standing": 0,
        "alternate-state": 1,
        "crushed": 2,
    }
    jobs.sort(
        key=lambda item: (
            -int(item["usageCount"]),
            family_rank[item["family"]],
            item["id"],
            kind_rank[item["variantKind"]],
            int(item["bodySlot"]),
        )
    )
    return jobs


def checkerboard(width: int, height: int, cell: int = 12) -> Image.Image:
    canvas = Image.new("RGBA", (width, height), (74, 76, 70, 255))
    draw = ImageDraw.Draw(canvas)
    colors = ((78, 80, 74, 255), (104, 106, 98, 255))
    for y in range(0, height, cell):
        for x in range(0, width, cell):
            draw.rectangle(
                (x, y, min(width, x + cell), min(height, y + cell)),
                fill=colors[((x // cell) + (y // cell)) % 2],
            )
    return canvas


def composed_reference(job: dict[str, Any]) -> Image.Image:
    layers: list[tuple[Image.Image, list[int]]] = []
    if job["shadowReferenceAbsolute"] is not None:
        layers.append(
            (
                Image.open(job["shadowReferenceAbsolute"]).convert("RGBA"),
                job["shadowOrigin"],
            )
        )
    layers.append(
        (
            Image.open(job["referenceAbsolute"]).convert("RGBA"),
            job["origin"],
        )
    )
    min_x = min(origin[0] for _image, origin in layers)
    min_y = min(origin[1] for _image, origin in layers)
    max_x = max(
        origin[0] + image.width
        for image, origin in layers
    )
    max_y = max(
        origin[1] + image.height
        for image, origin in layers
    )
    result = Image.new(
        "RGBA",
        (max(1, max_x - min_x), max(1, max_y - min_y)),
        (0, 0, 0, 0),
    )
    for image, origin in layers:
        result.alpha_composite(
            image,
            (origin[0] - min_x, origin[1] - min_y),
        )
        image.close()
    return result


def make_contact(
    jobs: list[dict[str, Any]],
    output: Path,
) -> None:
    if not jobs:
        canvas = checkerboard(720, 180)
        draw = ImageDraw.Draw(canvas)
        draw.rounded_rectangle(
            (16, 16, canvas.width - 16, canvas.height - 16),
            radius=12,
            fill=(45, 49, 42, 235),
            outline=(151, 155, 139, 255),
            width=2,
        )
        draw.text(
            (36, 70),
            "No pending raised HD body jobs.",
            fill=(245, 242, 220, 255),
        )
        output.parent.mkdir(parents=True, exist_ok=True)
        canvas.convert("RGB").save(output)
        return

    columns = min(4, max(1, len(jobs)))
    rows = (len(jobs) + columns - 1) // columns
    card_width = 400
    card_height = 330
    canvas = Image.new(
        "RGBA",
        (columns * card_width, rows * card_height),
        (63, 67, 58, 255),
    )
    draw = ImageDraw.Draw(canvas)
    for index, job in enumerate(jobs):
        column = index % columns
        row = index // columns
        left = column * card_width
        top = row * card_height
        draw.rounded_rectangle(
            (left + 8, top + 8, left + card_width - 8, top + card_height - 8),
            radius=12,
            fill=(45, 49, 42, 255),
            outline=(151, 155, 139, 255),
            width=2,
        )
        draw.text(
            (left + 18, top + 18),
            f"{job['family']} | {job['id']}",
            fill=(245, 242, 220, 255),
        )
        shadow_label = (
            f"s{job['pairedShadowSlot']}"
            if job["pairedShadowSlot"] is not None
            else "none"
        )
        draw.text(
            (left + 18, top + 38),
            (
                f"body s{job['bodySlot']} -> shadow {shadow_label} | "
                f"{job['variantKind']}"
            ),
            fill=(204, 211, 188, 255),
        )

        preview_left = left + 20
        preview_top = top + 66
        preview_width = 360
        preview_height = 220
        board = checkerboard(preview_width, preview_height)
        reference = composed_reference(job)
        scale = min(
            (preview_width - 24) / reference.width,
            (preview_height - 24) / reference.height,
            4.0,
        )
        size = (
            max(1, round(reference.width * scale)),
            max(1, round(reference.height * scale)),
        )
        resampling = (
            Image.Resampling.NEAREST
            if scale >= 1.0
            else Image.Resampling.LANCZOS
        )
        reference = reference.resize(size, resampling)
        board.alpha_composite(
            reference,
            (
                (preview_width - reference.width) // 2,
                (preview_height - reference.height) // 2,
            ),
        )
        canvas.alpha_composite(board, (preview_left, preview_top))
        draw.rectangle(
            (
                preview_left,
                preview_top,
                preview_left + preview_width - 1,
                preview_top + preview_height - 1,
            ),
            outline=(127, 132, 117, 255),
            width=1,
        )
        draw.text(
            (left + 18, top + card_height - 30),
            (
                f"uses {job['usageCount']} | body "
                f"{job['referenceSize'][0]}x{job['referenceSize'][1]}"
            ),
            fill=(220, 216, 194, 255),
        )

    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(output)


def parse_families(value: str | None) -> set[str] | None:
    if not value:
        return None
    families = {part.strip() for part in value.split(",") if part.strip()}
    unknown = families - set(FAMILY_SUBJECT)
    if unknown:
        raise ValueError(f"unknown families: {sorted(unknown)}")
    return families


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", type=Path, default=DEFAULT_INVENTORY)
    parser.add_argument("--output-root", type=Path, default=HD_DIR)
    parser.add_argument("--families")
    parser.add_argument("--limit", type=int, default=4)
    parser.add_argument("--contact", type=Path)
    args = parser.parse_args()

    if args.limit < 0:
        raise ValueError("--limit must be non-negative")
    jobs = pending_jobs(
        args.inventory.resolve(),
        parse_families(args.families),
        args.output_root.resolve(),
    )[: args.limit]
    if args.contact:
        make_contact(jobs, args.contact.resolve())
    print(json.dumps(jobs, ensure_ascii=False))


if __name__ == "__main__":
    main()

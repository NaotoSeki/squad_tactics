#!/usr/bin/env python3
"""Persist, extract, normalize, and validate one built-in ImageGen ground asset."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys

import numpy as np
from PIL import Image

try:
    from .ground_hd_quality import conspicuous_magenta_spill
    from .normalize_ground_hd import normalize
except ImportError:
    from ground_hd_quality import conspicuous_magenta_spill
    from normalize_ground_hd import normalize


ROOT = Path(__file__).resolve().parents[1]
TMP_DIR = ROOT / "tmp" / "ground_hd"
HD_DIR = ROOT / "asset" / "environment" / "ground_hd"


def default_chroma_helper() -> Path:
    codex_root = Path(
        os.environ.get("CODEX_HOME", Path.home() / ".codex")
    )
    return (
        codex_root
        / "skills"
        / ".system"
        / "imagegen"
        / "scripts"
        / "remove_chroma_key.py"
    )


def validate(result: Image.Image, reference: Image.Image) -> None:
    if result.size != (reference.width * 2, reference.height * 2):
        raise ValueError(
            f"output {result.size} is not 2x reference {reference.size}"
        )
    rgba = np.asarray(result.convert("RGBA"))
    visible = rgba[:, :, 3] > 16
    if not visible.any():
        raise ValueError("normalized output is fully transparent")
    canonical = np.asarray(
        reference.convert("RGBA").resize(
            result.size,
            Image.Resampling.LANCZOS,
        )
    )
    magenta = conspicuous_magenta_spill(rgba, canonical)
    if magenta.any():
        raise ValueError(
            f"normalized output retains {int(magenta.sum())} magenta pixels"
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--id", required=True)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--generated", type=Path, required=True)
    parser.add_argument(
        "--chroma-helper",
        type=Path,
        default=default_chroma_helper(),
    )
    parser.add_argument("--detail-contrast", type=float, default=1.08)
    args = parser.parse_args()

    if not args.generated.is_file():
        raise FileNotFoundError(args.generated)
    if not args.reference.is_file():
        raise FileNotFoundError(args.reference)
    if not args.chroma_helper.is_file():
        raise FileNotFoundError(args.chroma_helper)

    TMP_DIR.mkdir(parents=True, exist_ok=True)
    HD_DIR.mkdir(parents=True, exist_ok=True)
    source = TMP_DIR / f"{args.id}_source.png"
    cutout = TMP_DIR / f"{args.id}_cutout.png"
    output = HD_DIR / f"{args.id}_hd_v1.png"

    shutil.copy2(args.generated, source)
    subprocess.run(
        (
            sys.executable,
            str(args.chroma_helper),
            "--input",
            str(source),
            "--out",
            str(cutout),
            "--auto-key",
            "border",
            "--soft-matte",
            "--transparent-threshold",
            "12",
            "--opaque-threshold",
            "220",
            "--despill",
        ),
        check=True,
    )
    reference = Image.open(args.reference).convert("RGBA")
    result = normalize(
        reference,
        Image.open(cutout).convert("RGBA"),
        scale=2,
        detail_contrast=args.detail_contrast,
    )
    validate(result, reference)
    result.save(output, optimize=True)
    print(
        f"wrote {output}; size={result.size}; "
        f"bbox={result.getchannel('A').getbbox()}"
    )


if __name__ == "__main__":
    main()

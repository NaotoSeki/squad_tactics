"""Extract the curated Panzer Strike visual-language reference set."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

try:
    from .ssc_decode import DEFAULT_DRIVER, decode_file
except ImportError:  # Direct script execution.
    from ssc_decode import DEFAULT_DRIVER, decode_file


DEFAULT_OBJECT_ROOT = Path(
    r"C:\Program Files (x86)\Steam\steamapps\common\Panzer Strike Demo"
    r"\Data\Game\Common\Media\Objects"
)
DEFAULT_MANIFEST = Path(__file__).with_name("reference_manifest.json")


def extract_reference_set(
    manifest_path: Path,
    object_root: Path,
    output_root: Path,
    *,
    driver_path: Path = DEFAULT_DRIVER,
) -> list[Path]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schema") != "squad-tactics.panzer-strike-reference/v1":
        raise ValueError("unsupported reference manifest schema")
    items = manifest.get("items")
    if not isinstance(items, list):
        raise ValueError("reference manifest items must be a list")

    metadata_paths: list[Path] = []
    seen_ids: set[str] = set()
    for item in items:
        item_id = item["id"]
        if item_id in seen_ids:
            raise ValueError("duplicate reference item id: %s" % item_id)
        seen_ids.add(item_id)
        category_dir = object_root / item["category"]
        ssc_path = category_dir / item["ssc"]
        spl_path = category_dir / item["spl"]
        if not ssc_path.is_file() or not spl_path.is_file():
            raise FileNotFoundError("missing source for %s" % item_id)
        slots = item.get("slots")
        try:
            metadata_paths.append(
                decode_file(
                    ssc_path,
                    spl_path,
                    output_root / item_id,
                    slots=slots,
                    driver_path=driver_path,
                )
            )
        except (OSError, ValueError) as exc:
            raise type(exc)("reference item %s: %s" % (item_id, exc)) from exc
    return metadata_paths


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--object-root", type=Path, default=DEFAULT_OBJECT_ROOT)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--driver", type=Path, default=DEFAULT_DRIVER)
    args = parser.parse_args()
    metadata = extract_reference_set(
        args.manifest,
        args.object_root,
        args.output_root,
        driver_path=args.driver,
    )
    print(
        "PS_REFERENCE_EXTRACT OK items=%d output=%s"
        % (len(metadata), args.output_root.resolve())
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""立体物台帳が参照するスプライトだけを本編アセットとして書き出す。

`gen_ps_seed_map.py` は建物・木・柵・低木を背景PNGへ焼き込まず
`*_objects.json`(ps_objects/v1) の台帳へ出す。本編はそれを読んで生きたスプライトを
作り、破壊状態のスロットへ差し替える。そのため「台帳が参照しうる全スロット」の
PNGが要る — が、正本の全SSC(8万枚超)を出すのは論外なので、実際に参照される
(asset, slot) の組だけに絞る。

原案は GPT-5.6 レーン生成。監督官がマニフェスト形式を実物に合わせて修正。

出力: asset/environment/ps_objects/<asset>_s<slot>.png + manifest.json
貼付規約は正本レンダラと同じ: left = x + ox, top = y + oy。
リサンプリング・色調補正は一切かけない(無加工コピー)。
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any

# 台帳がスロット番号を持ちうるキー。null は無視する。
SCALAR_SLOT_KEYS = ("body_slot", "shadow_slot")
LIST_SLOT_KEYS = ("body_slots", "shadow_slots", "crushed_slots", "crushed_shadow_slots")


def int_slots(value: Any) -> set[int]:
    if not isinstance(value, list):
        return set()
    return {int(s) for s in value if isinstance(s, int) and not isinstance(s, bool)}


def collect_references(path: Path) -> set[tuple[str, int]]:
    """1つの台帳が参照する (asset, slot) を全部集める。"""
    record = json.loads(path.read_text(encoding="utf-8"))
    if record.get("schema") != "ps_objects/v1":
        return set()

    refs: set[tuple[str, int]] = set()
    for obj in record.get("objects", []):
        asset = obj.get("asset")
        if not isinstance(asset, str) or not asset:
            continue

        slots: set[int] = set()
        for key in SCALAR_SLOT_KEYS:
            value = obj.get(key)
            if isinstance(value, int) and not isinstance(value, bool):
                slots.add(value)
        for key in LIST_SLOT_KEYS:
            slots |= int_slots(obj.get(key))

        states = obj.get("states")
        if isinstance(states, dict):
            slots |= int_slots(states.get("body"))
            slots |= int_slots(states.get("shadow"))

        refs |= {(asset, slot) for slot in slots}

    return refs


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--maps-dir", type=Path, default=repo_root / "asset" / "environment" / "maps")
    parser.add_argument(
        "--canonical-root", type=Path, default=repo_root / "scratch" / "ps_sprites_canonical_v1"
    )
    parser.add_argument(
        "--out-dir", type=Path, default=repo_root / "asset" / "environment" / "ps_objects"
    )
    args = parser.parse_args()

    manifest = json.loads(
        (args.canonical_root / "canonical_manifest.json").read_text(encoding="utf-8")
    )
    # canonical_manifest の sprites は list。キーは (SSCのstem, slot)。
    canonical: dict[tuple[str, int], dict[str, Any]] = {
        (Path(r["ssc"]).stem, int(r["slot"])): r for r in manifest["sprites"]
    }

    refs: set[tuple[str, int]] = set()
    ledgers = sorted(args.maps_dir.glob("*_objects.json"))
    for path in ledgers:
        refs |= collect_references(path)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    for old in args.out_dir.glob("*.png"):
        old.unlink()

    sprites: dict[str, dict[str, Any]] = {}
    missing: list[str] = []
    total_bytes = 0

    for asset, slot in sorted(refs):
        entry = canonical.get((asset, slot))
        source = args.canonical_root / entry["png"] if entry else None
        if entry is None or not source.is_file():
            missing.append(f"{asset}_s{slot}")
            continue

        name = f"{asset}_s{slot}"
        dest = args.out_dir / f"{name}.png"
        shutil.copyfile(source, dest)  # 無加工コピー(PS原寸)
        total_bytes += dest.stat().st_size

        sprites[name] = {
            "file": dest.name,
            "w": int(entry["width"]),
            "h": int(entry["height"]),
            "ox": int(entry["origin_x"]),
            "oy": int(entry["origin_y"]),
        }

    out: dict[str, Any] = {
        "schema": "ps_object_assets/v1",
        "note": "貼付規約: left = x + ox, top = y + oy（正本レンダラと同じ）",
        "sprites": dict(sorted(sprites.items())),
    }
    if missing:
        out["missing"] = sorted(missing)

    (args.out_dir / "manifest.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    print(f"台帳 {len(ledgers)}件 -> ユニークasset {len({a for a, _ in refs})} / スプライト {len(sprites)}")
    print(f"合計 {total_bytes / 1024 / 1024:.1f} MiB -> {args.out_dir}")
    if missing:
        print(f"missing {len(missing)}: {missing[:8]}")


if __name__ == "__main__":
    main()

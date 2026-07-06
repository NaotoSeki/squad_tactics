# -*- coding: utf-8 -*-
"""
PL ITEML.DLL には CG 396 件（item_0000..item_0395）のみ実データがある。
CBE 名チェーン 484 件のうち index>=395 は同名の先行エントリへスプライトをエイリアスする。

  python scripts/export_iteml_cbe_aliases.py
  -> data/sprites/iteml/item_0396.png .. （不足分を先行同名 PNG からコピー）

同名が無い場合は接頭辞ベースのフォールバック（M1919A5 -> M1919A4 等）。
"""
from __future__ import annotations

import csv
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PL = Path("D:/PL")
SPRITE_DIR = ROOT / "data" / "sprites" / "iteml"
CHAIN_CSV = ROOT / "data" / "cbe_name_chain_table.csv"
SUMMARY_JSON = ROOT / "scripts" / "pl_decoded" / "iteml_alias_export_summary.json"

# 先行同名が無いときの接頭辞 -> 既知の canonical cbeNameIndex
PREFIX_CANON: list[tuple[str, int]] = [
    ("M1919A5", 23),   # M1919A4 MMG (pl_23)
    ("M1919A4", 23),
    ("M1917A1", 22),
    ("sMG42", 94),     # MG42
    ("sMG34", 91),     # MG34
    ("MG37", 95),
    ("FR mod", 96),
    ("Breda", 97),
    ("MAC1931", 98),
    ("Vickers", 179),
    ("Besa", 180),
]


def item_path(cbe_idx: int) -> Path:
    return SPRITE_DIR / f"item_{cbe_idx + 1:04d}.png"


def load_chain() -> list[tuple[int, str]]:
    rows = list(csv.DictReader(CHAIN_CSV.open(encoding="utf-8-sig")))
    key = "cbeNameIndex" if "cbeNameIndex" in rows[0] else list(rows[0].keys())[0]
    out: list[tuple[int, str]] = []
    for r in rows:
        out.append((int(r[key]), (r.get("name") or "").strip()))
    return out


def normalize_name(name: str) -> str:
    return re.sub(r"\s+", " ", name.strip())


def find_canonical(cbe_idx: int, name: str, chain: list[tuple[int, str]]) -> int | None:
    norm = normalize_name(name)
    for j, n in chain:
        if j >= cbe_idx:
            break
        if normalize_name(n) == norm and item_path(j).exists():
            return j
    for prefix, canon_idx in PREFIX_CANON:
        if name.startswith(prefix) and item_path(canon_idx).exists():
            return canon_idx
    # 部分一致: 先頭トークン（例: "75mm KwK40" -> 他の KwK 系は無理なのでスキップ）
    return None


def verify_iteml_max() -> int:
    """ITEML CG 解決済み件数（PL 実データ上限）。"""
    resolved = ROOT / "scripts" / "pl_decoded" / "iteml_cg_resolved.json"
    if resolved.is_file():
        doc = json.loads(resolved.read_text(encoding="utf-8"))
        return int(doc.get("resolved_entries", 396))
    return 396


def main() -> int:
    if not (PL / "ITEML.DLL").is_file():
        print("ERROR: D:/PL/ITEML.DLL がありません")
        return 1
    if not CHAIN_CSV.is_file():
        print("ERROR:", CHAIN_CSV)
        return 1

    chain = load_chain()
    max_resolved = verify_iteml_max()
    print(f"ITEML resolved CG entries: {max_resolved} (indices 0..{max_resolved - 1})")
    print(f"CBE name chain length: {len(chain)}")

    created: list[dict] = []
    skipped: list[dict] = []

    for cbe_idx, name in chain:
        if cbe_idx < max_resolved - 1:
            continue
        dst = item_path(cbe_idx)
        if dst.exists():
            continue
        canon = find_canonical(cbe_idx, name, chain)
        if canon is None:
            skipped.append({"cbeNameIndex": cbe_idx, "name": name, "reason": "no_canonical"})
            continue
        src = item_path(canon)
        if not src.is_file():
            skipped.append({"cbeNameIndex": cbe_idx, "name": name, "reason": "canonical_missing", "canon": canon})
            continue
        shutil.copy2(src, dst)
        created.append({
            "cbeNameIndex": cbe_idx,
            "name": name,
            "file": dst.name,
            "from_cbeNameIndex": canon,
            "from_file": src.name,
        })
        print(f"  {dst.name} <- {src.name}  ({name})")

    SPRITE_DIR.mkdir(parents=True, exist_ok=True)
    summary = {
        "source": "PL CBE name chain alias (ITEML has no CG data beyond index 395)",
        "iteml_resolved_max_index": max_resolved - 1,
        "created_count": len(created),
        "skipped_count": len(skipped),
        "created": created,
        "skipped": skipped,
    }
    SUMMARY_JSON.parent.mkdir(parents=True, exist_ok=True)
    SUMMARY_JSON.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\nCreated {len(created)} alias sprites, skipped {len(skipped)}")
    print(f"WROTE {SUMMARY_JSON}")
    if skipped:
        print("Skipped (no canonical sprite):")
        for s in skipped[:20]:
            print(f"  [{s['cbeNameIndex']:3d}] {s['name']}")
        if len(skipped) > 20:
            print(f"  ... and {len(skipped) - 20} more")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

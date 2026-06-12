# -*- coding: utf-8 -*-
"""
CBE 正本ペア（weapon_ammo_map.json + wpns_pl_stats_decoded ammo_indices）を
data/pl_cbe_weapon_ammo_canonical.js にエクスポートする。

併せて docs/PL_AMMO_AUDIT.md を生成 — ST マスタとの差分を一括可視化。

実行: python scripts/export_pl_weapon_ammo_canonical.py
"""
from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAP_JSON = ROOT / "data" / "weapon_ammo_map.json"
STATS_JSON = ROOT / "data" / "wpns_pl_stats_decoded.json"
EXPLICIT_JSON = ROOT / "scripts" / "pl_decoded" / "cbe_weapon_ammo_explicit.json"
MASTER_JS = ROOT / "data" / "wpns_pl_master.js"
OUT_JS = ROOT / "data" / "pl_cbe_weapon_ammo_canonical.js"
OUT_MD = ROOT / "docs" / "PL_AMMO_AUDIT.md"

# PL 内部名が紛らわしい弾（表示用ヒント）
CRYPTIC_AMMO = {
    355: {
        "displayName": ".303Br clip",
        "note": "CBE 名称 9Pb-32R は .303 Lee-Enfield クリップ（9mm Para ではない）",
    },
    356: {
        "displayName": "9mm Sten drum",
        "note": "CBE 名称 303Br-47 は Sten 系 9mm ドラム",
    },
}


def load_map_canonical() -> dict[int, list[int]]:
    rows = json.loads(MAP_JSON.read_text(encoding="utf-8"))
    out: dict[int, list[int]] = {}
    for w in rows:
        wi = w.get("cbeNameIndex")
        if wi is None:
            continue
        picked: list[int] = []
        for d in w.get("ammo_details") or []:
            ai = d.get("cbeNameIndex")
            nm = (d.get("name") or "").strip()
            if ai is None or nm.startswith("ammo_"):
                continue
            if ai not in picked:
                picked.append(ai)
        if picked:
            out[int(wi)] = picked
    return out


def load_stats_canonical() -> dict[int, list[int]]:
    rows = json.loads(STATS_JSON.read_text(encoding="utf-8"))
    out: dict[int, list[int]] = {}
    for w in rows:
        wi = w.get("cbeNameIndex")
        if wi is None:
            continue
        cat = w.get("category_name") or ""
        if cat == "ammo":
            continue
        if w.get("wpns_code") == "":
            continue
        indices = [int(x) for x in (w.get("ammo_indices") or []) if x is not None]
        if indices:
            out[int(wi)] = indices
    return out


def load_explicit_canonical() -> dict[int, list[int]]:
    if not EXPLICIT_JSON.exists():
        return {}
    doc = json.loads(EXPLICIT_JSON.read_text(encoding="utf-8"))
    out: dict[int, list[int]] = {}
    for e in doc.get("edges") or []:
        wi = e.get("cbeWeaponIndex")
        if wi is None:
            continue
        out[int(wi)] = [int(x) for x in (e.get("acceptsAmmoPlIndices") or [])]
    for key in ("mg42",):
        block = doc.get(key)
        if block and block.get("cbeWeaponIndex") is not None:
            out[int(block["cbeWeaponIndex"])] = [
                int(x) for x in (block.get("acceptsAmmoPlIndices") or [])
            ]
    return out


WEAPON_CATS = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11}


def weapon_indices(stats_by_cbe: dict[int, dict]) -> set[int]:
    out: set[int] = set()
    for wi, rec in stats_by_cbe.items():
        cat = int(rec.get("category_code") or 99)
        if cat not in WEAPON_CATS:
            continue
        if not (rec.get("name") or "").strip():
            continue
        out.add(wi)
    return out


def load_category_map() -> dict[int, int]:
    rows = json.loads(STATS_JSON.read_text(encoding="utf-8"))
    return {int(r["cbeNameIndex"]): int(r.get("category_code") or 0) for r in rows}


def filter_loadable_ammo(indices: list[int], cat_map: dict[int, int]) -> list[int]:
    """第2フィルタ: category_code==18 のみ正本に残す（銃剣・擲弾等を除外）。"""
    out: list[int] = []
    for ai in indices:
        if cat_map.get(ai) == 18 and ai not in out:
            out.append(ai)
    return out


def merge_canonical(
    map_c: dict[int, list[int]],
    stats_c: dict[int, list[int]],
    explicit_c: dict[int, list[int]],
) -> dict[int, list[int]]:
    """explicit（手検証）> stats（CBE バイナリ）> map（抽出 JSON）。"""
    out: dict[int, list[int]] = {}
    out.update(map_c)
    out.update(stats_c)
    out.update(explicit_c)
    return out


def parse_master_accepts() -> dict[int, list[int]]:
    text = MASTER_JS.read_text(encoding="utf-8")
    out: dict[int, list[int]] = {}
    for m in re.finditer(
        r"cbeNameIndex:(\d+).*?acceptsAmmo:\[([^\]]*)\]",
        text,
    ):
        wi = int(m.group(1))
        raw = m.group(2).strip()
        if not raw:
            out[wi] = []
        else:
            out[wi] = [int(x.strip()) for x in raw.split(",") if x.strip()]
    return out


def ammo_name(idx: int, ammo_rows: dict) -> str:
    row = ammo_rows.get(str(idx)) or ammo_rows.get(idx)
    return (row or {}).get("cbe_name") or f"#{idx}"


def load_ammo_rows() -> dict:
    p = ROOT / "data" / "ammo_compat_full.json"
    if not p.exists():
        return {}
    return json.loads(p.read_text(encoding="utf-8")).get("ammo") or {}


def weapon_name(wi: int, stats: list) -> str:
    for w in stats:
        if w.get("cbeNameIndex") == wi:
            return w.get("name") or f"#{wi}"
    return f"#{wi}"


def write_js(canonical: dict[int, list[int]], cryptic: dict) -> None:
    lines = [
        "/** CBE 正本 weapon↔ammo（自動生成 — 手編集しない）",
        " *  source: weapon_ammo_map.json + wpns_pl_stats_decoded.json",
        " *  regen: python scripts/export_pl_weapon_ammo_canonical.py",
        " */",
        "(function () {",
        "    'use strict';",
        "    window.PL_CBE_WEAPON_AMMO_CANONICAL = " + json.dumps(
            {str(k): v for k, v in sorted(canonical.items())}, indent=2
        ) + ";",
        "    window.PL_AMMO_DISPLAY_HINTS = " + json.dumps(cryptic, indent=2) + ";",
        "})();",
        "",
    ]
    OUT_JS.write_text("\n".join(lines), encoding="utf-8")


def write_audit(
    canonical: dict[int, list[int]],
    master: dict[int, list[int]],
    stats: list,
    ammo_rows: dict,
) -> None:
    drift: list[tuple] = []
    cryptic_hits: list[tuple] = []
    ok = 0

    all_weapons = sorted(set(canonical) | set(master))
    for wi in all_weapons:
        c_set = set(canonical.get(wi) or [])
        m_set = set(master.get(wi) or [])
        wn = weapon_name(wi, stats)
        if not c_set and not m_set:
            continue
        if c_set == m_set:
            ok += 1
            continue
        extra = sorted(m_set - c_set)
        missing = sorted(c_set - m_set)
        if extra or missing:
            drift.append((wi, wn, sorted(c_set), extra, missing))
        for ai in c_set & m_set:
            if ai in CRYPTIC_AMMO:
                cryptic_hits.append((wi, wn, ai, ammo_name(ai, ammo_rows)))

    lines = [
        "# PL 装填監査レポート",
        "",
        f"**生成**: {date.today().isoformat()} — `python scripts/export_pl_weapon_ammo_canonical.py`",
        "",
        "## 読み方",
        "",
        "| 区分 | 意味 |",
        "|------|------|",
        "| **CBE 正本** | explicit（手検証）> stats バイナリ > weapon_ammo_map |",
        "| **ST マスタ** | `wpns_pl_master.js` の `acceptsAmmo`（ビルド時 explicit/ヒューリスティクス混入可） |",
        "| **差分 extra** | ST にだけある弾 — **要修正候補**（古い 9mm クラスタ等） |",
        "| **差分 missing** | CBE にあるが ST に無い — ビルド漏れ |",
        "",
        "※ **No4 Mk1\\* + 9Pb-32R** は CBE 上正しいリンク。名称が 9mm 風なだけ（`.303Br clip` 相当）。",
        "※ 正本は **category==18 のみ**（銃剣・擲弾等は `pl_cbe_weapon_slots.js` 側）。",
        "",
        f"## サマリー",
        "",
        f"- 照合火器: {len(all_weapons)}",
        f"- 一致: {ok}",
        f"- 差分あり: {len(drift)}",
        f"- 紛らわしい弾名（正リンク）: {len(cryptic_hits)}",
        "",
        "## 差分一覧（extra / missing）",
        "",
        "| cbeIdx | 武器 | CBE 正本 | ST extra | ST missing |",
        "|--------|------|----------|----------|------------|",
    ]

    for wi, wn, c_list, extra, missing in drift[:120]:
        c_str = ", ".join(ammo_name(i, ammo_rows) for i in c_list[:4])
        if len(c_list) > 4:
            c_str += "…"
        ex_str = ", ".join(ammo_name(i, ammo_rows) for i in extra[:3]) if extra else "—"
        if len(extra) > 3:
            ex_str += "…"
        mi_str = ", ".join(ammo_name(i, ammo_rows) for i in missing[:3]) if missing else "—"
        lines.append(f"| {wi} | {wn} | {c_str or '—'} | {ex_str} | {mi_str} |")

    if len(drift) > 120:
        lines.append(f"| … | （他 {len(drift) - 120} 件） | | | |")

    lines.extend(
        [
            "",
            "## 紛らわしい PL 弾名（リンクは CBE 正本どおり）",
            "",
            "| 武器 | 弾 index | CBE 名 | 表示ヒント |",
            "|------|----------|--------|------------|",
        ]
    )
    for wi, wn, ai, an in cryptic_hits:
        hint = CRYPTIC_AMMO.get(ai, {}).get("displayName", "")
        lines.append(f"| {wn} | {ai} | {an} | {hint} |")

    lines.extend(
        [
            "",
            "## 対処",
            "",
            "1. **ランタイム**: `FEATURE_PL_CANONICAL_AMMO_FILTER` で CBE 正本に intersect",
            "2. **ビルド**: 差分 extra を `weapon_ammo_overrides.json` / explicit 修正",
            "3. **表示**: `PL_AMMO_DISPLAY_HINTS` で紛らわしい名称を補足",
            "",
        ]
    )
    OUT_MD.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    import sys

    sys.path.insert(0, str(ROOT))
    from scripts.pl_ammo_cbe_filters import (
        effective_ammo_for_weapon,
        load_category_map,
        load_json_from_js,
        load_stats_by_cbe,
        MAG_SHAPE_JS,
    )

    map_c = load_map_canonical()
    stats_c = load_stats_canonical()
    explicit_c = load_explicit_canonical()
    merged = merge_canonical(map_c, stats_c, explicit_c)
    cat_map = load_category_map()
    stats_by_cbe = load_stats_by_cbe()
    w_shape = load_json_from_js(MAG_SHAPE_JS, "PL_CBE_MAG_SHAPE_WEAPONS")
    a_shape = load_json_from_js(MAG_SHAPE_JS, "PL_CBE_MAG_SHAPE_AMMO")

    canonical: dict[int, list[int]] = {}
    for wi in sorted(set(merged) | weapon_indices(stats_by_cbe)):
        explicit = {wi: merged[wi]} if wi in merged else None
        eff = effective_ammo_for_weapon(
            wi,
            explicit=explicit,
            stats_by_cbe=stats_by_cbe,
            cat_map=cat_map,
            w_shape=w_shape,
            a_shape=a_shape,
            include_composite=True,
        )
        if eff:
            canonical[wi] = eff
    stats = json.loads(STATS_JSON.read_text(encoding="utf-8"))
    master = parse_master_accepts()
    ammo_rows = load_ammo_rows()

    write_js(canonical, CRYPTIC_AMMO)
    write_audit(canonical, master, stats, ammo_rows)

    drift_n = sum(
        1
        for wi in set(canonical) | set(master)
        if set(canonical.get(wi) or []) != set(master.get(wi) or [])
    )
    print(f"canonical weapons: {len(canonical)}")
    print(f"written: {OUT_JS.relative_to(ROOT)}")
    print(f"written: {OUT_MD.relative_to(ROOT)}")
    print(f"drift vs master: {drift_n}")


if __name__ == "__main__":
    main()

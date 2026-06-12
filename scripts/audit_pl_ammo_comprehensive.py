# -*- coding: utf-8 -*-
"""
PL 装填 包括監査 — 全火器の CBE → フィルタパイプライン → ST マスタ差分。

override 不要を目指すため、差分を根本原因カテゴリに分類する。

実行:
  python scripts/audit_pl_ammo_comprehensive.py
  python scripts/audit_pl_ammo_comprehensive.py --json  # data/pl_ammo_comprehensive_audit.json

出力:
  docs/PL_AMMO_COMPREHENSIVE_AUDIT.md
"""
from __future__ import annotations

import argparse
import json
import re
import struct
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATS_JSON = ROOT / "data" / "wpns_pl_stats_decoded.json"
MASTER_JS = ROOT / "data" / "wpns_pl_master.js"
NAMES_JSON = ROOT / "data" / "cbe_name_table.json"
MAG_SHAPE_JS = ROOT / "data" / "pl_cbe_mag_shape.js"
MAG_TYPE_JS = ROOT / "data" / "pl_cbe_mag_type.js"
EXPLICIT_JSON = ROOT / "scripts" / "pl_decoded" / "cbe_weapon_ammo_explicit.json"
CBE_PATH = Path("D:/PL/CBE.EXE")
OUT_MD = ROOT / "docs" / "PL_AMMO_COMPREHENSIVE_AUDIT.md"
OUT_JSON = ROOT / "data" / "pl_ammo_comprehensive_audit.json"

TABLE, STRIDE = 0x1DDF00, 64
LOADABLE_CAT = 18
DRUM_RECEIVER = 65

# build_wpns_pl_master.py と同期 — ヒューリスティクスクラスタ
HEURISTIC_CLUSTERS: dict[str, list[int]] = {
    "AMMO_792": [272, 273, 274, 275, 276, 277, 288, 289, 290, 295, 296, 389],
    "AMMO_3006": [229, 230, 231, 238, 239, 240],
    "AMMO_9": [258, 265, 278, 279, 280, 281, 282, 283, 284, 285, 286, 320, 321, 322, 323, 378, 379, 384, 388, 390],
    "AMMO_30CBN": [232, 233],
    "AMMO_303BR": [353, 354, 355, 356, 357, 358],
    "AMMO_45": [225, 226, 234, 235, 236, 237],
    "AMMO_27": [266, 267],
    "STG_KURZ_277": [277],
}

# 弾薬として扱う category
WEAPON_CATS = frozenset(range(1, 18))


def load_json_map_from_js(path: Path, var_name: str) -> dict:
    if not path.exists():
        return {}
    text = path.read_text(encoding="utf-8")
    m = re.search(rf"window\.{re.escape(var_name)}\s*=\s*(\{{[\s\S]*?\}})\s*;", text)
    if not m:
        return {}
    return json.loads(m.group(1))


def load_names() -> dict[str, str]:
    return json.loads(NAMES_JSON.read_text(encoding="utf-8"))


def load_stats() -> list[dict]:
    return json.loads(STATS_JSON.read_text(encoding="utf-8"))


def load_explicit() -> dict[int, list[int]]:
    if not EXPLICIT_JSON.exists():
        return {}
    doc = json.loads(EXPLICIT_JSON.read_text(encoding="utf-8"))
    out: dict[int, list[int]] = {}
    for e in doc.get("edges") or []:
        wi = e.get("cbeWeaponIndex")
        if wi is not None:
            out[int(wi)] = [int(x) for x in (e.get("acceptsAmmoPlIndices") or [])]
    for key in ("mg42",):
        block = doc.get(key)
        if block and block.get("cbeWeaponIndex") is not None:
            out[int(block["cbeWeaponIndex"])] = [
                int(x) for x in (block.get("acceptsAmmoPlIndices") or [])
            ]
    return out


def parse_master() -> dict[int, list[int]]:
    text = MASTER_JS.read_text(encoding="utf-8")
    out: dict[int, list[int]] = {}
    for m in re.finditer(r"cbeNameIndex:(\d+).*?acceptsAmmo:\[([^\]]*)\]", text):
        wi = int(m.group(1))
        raw = m.group(2).strip()
        out[wi] = [] if not raw else [int(x.strip()) for x in raw.split(",") if x.strip()]
    return out


def u16s_from_cbe(cbe: bytes, idx: int) -> list[int] | None:
    off = TABLE + idx * STRIDE
    if off + 64 > len(cbe):
        return None
    return [struct.unpack_from("<H", cbe, off + i)[0] for i in range(0, 64, 2)]


def n(names: dict[str, str], idx: int) -> str:
    return names.get(str(idx), f"#{idx}")


def passes_category(cat_map: dict[int, int], ai: int) -> bool:
    return cat_map.get(ai) == LOADABLE_CAT


def passes_u27(
    wi: int,
    ai: int,
    w_shape: dict[str, int],
    a_shape: dict[str, int],
) -> bool:
    ws = w_shape.get(str(wi))
    if ws is None:
        ws = w_shape.get(wi)
    aa = a_shape.get(str(ai))
    if aa is None:
        aa = a_shape.get(ai)
    if ws is None or aa is None:
        return True
    if ws == DRUM_RECEIVER:
        return True
    return ws == aa


def filter_pipeline(
    wi: int,
    raw: list[int],
    cat_map: dict[int, int],
    w_shape: dict,
    a_shape: dict,
) -> tuple[list[int], list[int], list[int]]:
    """raw → cat18 → u27。各段階のリストを返す。"""
    after_cat = [ai for ai in raw if passes_category(cat_map, ai)]
    after_u27 = [ai for ai in after_cat if passes_u27(wi, ai, w_shape, a_shape)]
    return raw, after_cat, after_u27


def cluster_for_ammo(ai: int) -> list[str]:
    hits = []
    for name, cluster in HEURISTIC_CLUSTERS.items():
        if ai in cluster:
            hits.append(name)
    return hits


def classify_extra(wi: int, ai: int, effective: set[int], raw: list[int]) -> str:
    if ai in effective:
        return "IN_EFFECTIVE"
    clusters = cluster_for_ammo(ai)
    if clusters:
        return "HEURISTIC_" + clusters[0]
    if ai not in raw:
        return "NOT_IN_CBE_RAW"
    if not passes_category({}, ai):  # placeholder
        pass
    return "UNEXPLAINED"


def classify_st_extra(
    wi: int,
    ai: int,
    raw: list[int],
    after_cat: list[int],
    effective: list[int],
    cat_map: dict[int, int],
    w_shape: dict,
    a_shape: dict,
) -> str:
    """ST にだけある弾の根本原因。"""
    if ai in effective:
        return "RUNTIME_ALREADY_OK"  # マスタ古い、ランタイムで正しい
    clusters = cluster_for_ammo(ai)
    if clusters and ai not in raw:
        return f"BUILD_HEURISTIC:{clusters[0]}"
    if ai in raw and ai not in after_cat:
        return "CBE_AUX_IN_RAW"  # 銃剣等 — category で除外済
    if ai in after_cat and ai not in effective:
        return "U27_SHAPE_FILTER"
    if ai in raw and ai not in effective:
        return "FILTERED_UNKNOWN"
    if ai not in raw:
        if clusters:
            return f"BUILD_HEURISTIC:{clusters[0]}"
        return "BUILD_HEURISTIC:OTHER"
    return "UNEXPLAINED"


def mag_type_delta(w21: int, a21: int) -> int | None:
    if w21 == 0:
        return None
    return a21 - w21


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", help="JSON も出力")
    args = parser.parse_args()

    names = load_names()
    stats = load_stats()
    master = parse_master()
    explicit = load_explicit()
    w_shape = load_json_map_from_js(MAG_SHAPE_JS, "PL_CBE_MAG_SHAPE_WEAPONS")
    a_shape = load_json_map_from_js(MAG_SHAPE_JS, "PL_CBE_MAG_SHAPE_AMMO")
    mag_type_w = load_json_map_from_js(MAG_TYPE_JS, "PL_CBE_MAG_TYPE_WEAPONS")
    mag_type_a = load_json_map_from_js(MAG_TYPE_JS, "PL_CBE_MAG_TYPE_AMMO")

    cbe = CBE_PATH.read_bytes() if CBE_PATH.exists() else b""

    by_idx = {int(r["cbeNameIndex"]): r for r in stats}
    cat_map = {int(r["cbeNameIndex"]): int(r.get("category_code") or 0) for r in stats}

    weapons: list[dict] = []
    cause_counter: Counter[str] = Counter()
    extra_by_cause: dict[str, list[tuple]] = defaultdict(list)
    missing_all: list[tuple] = []

    for r in stats:
        wi = int(r["cbeNameIndex"])
        cat = int(r.get("category_code") or 99)
        if cat not in WEAPON_CATS:
            continue
        if not (r.get("wpns_code") or "").strip() and cat == LOADABLE_CAT:
            continue

        raw = [int(x) for x in (r.get("ammo_indices") or [])]
        if wi in explicit:
            raw = explicit[wi][:]
        _, after_cat, effective = filter_pipeline(wi, raw, cat_map, w_shape, a_shape)
        eff_set = set(effective)
        st = set(master.get(wi, []))

        st_extra = sorted(st - eff_set)
        st_missing = sorted(eff_set - st)

        aux_in_raw = sorted(ai for ai in raw if not passes_category(cat_map, ai))
        u27_dropped = sorted(ai for ai in after_cat if ai not in effective)

        row_causes: dict[str, list[int]] = defaultdict(list)
        for ai in st_extra:
            cause = classify_st_extra(wi, ai, raw, after_cat, effective, cat_map, w_shape, a_shape)
            cause_counter[cause] += 1
            row_causes[cause].append(ai)
            extra_by_cause[cause].append((wi, r["name"], ai, n(names, ai)))

        for ai in st_missing:
            missing_all.append((wi, r["name"], ai, n(names, ai)))

        w21 = int(mag_type_w.get(str(wi), mag_type_w.get(wi, 0)) or 0)

        weapons.append(
            {
                "cbeIdx": wi,
                "name": r["name"],
                "category": r.get("category_name", ""),
                "raw": raw,
                "afterCat18": after_cat,
                "effective": effective,
                "auxInRaw": aux_in_raw,
                "u27Dropped": u27_dropped,
                "stMaster": sorted(st),
                "stExtra": st_extra,
                "stMissing": st_missing,
                "causes": {k: v for k, v in row_causes.items()},
                "w21": w21,
                "matchEffective": not st_extra and not st_missing,
                "matchRaw": set(raw) == st if raw else not st,
            }
        )

    total = len(weapons)
    match_eff = sum(1 for w in weapons if w["matchEffective"])
    match_raw = sum(1 for w in weapons if w["matchRaw"])
    with_drift = total - match_eff

    # mag_type: w21!=0 武器の delta 分布
    delta_counter: Counter[int] = Counter()
    mag_pairs: list[dict] = []
    for w in weapons:
        wi = w["cbeIdx"]
        w21 = w["w21"]
        if w21 == 0:
            continue
        for ai in w["afterCat18"]:
            a21 = int(mag_type_a.get(str(ai), mag_type_a.get(ai, 0)) or 0)
            d = mag_type_delta(w21, a21)
            if d is not None:
                delta_counter[d] += 1
            mag_pairs.append(
                {
                    "weapon": w["name"],
                    "wi": wi,
                    "ammo": n(names, ai),
                    "ai": ai,
                    "w21": w21,
                    "a21": a21,
                    "delta": d,
                }
            )

    # 7.92-5 (272) — CBE raw に無いが sub_link / 書面で Kar98 系
    kar98_family = [55, 56, 57, 58, 59, 60, 61, 64, 68, 69]
    kar98_272_gap = []
    for wi in kar98_family:
        w = by_idx.get(wi)
        if not w:
            continue
        raw = w.get("ammo_indices") or []
        kar98_272_gap.append(
            {
                "wi": wi,
                "name": w["name"],
                "has272": 272 in raw,
                "rawAmmo": [n(names, x) for x in raw],
                "effective273": 273 in filter_pipeline(wi, raw, cat_map, w_shape, a_shape)[2],
            }
        )

    # レポート生成
    lines = [
        "# PL 装填 包括監査",
        "",
        f"**生成**: {date.today().isoformat()} — `python scripts/audit_pl_ammo_comprehensive.py`",
        "",
        "## 方針",
        "",
        "CBE `ammo_indices` + 解明済みフィルタ（cat18 → u27）を **Effective** とし、",
        "`wpns_pl_master.js` の `acceptsAmmo`（ビルドヒューリスティクス混入）との差分を分類する。",
        "**override 不要**のため、差分はビルド修正 or 未解明フィルタ RE で潰す。",
        "",
        "## サマリー",
        "",
        f"| 指標 | 値 |",
        f"|------|-----|",
        f"| 照合火器 | {total} |",
        f"| Effective == ST マスタ | **{match_eff}** ({100*match_eff/total:.1f}%) |",
        f"| Raw CBE == ST マスタ | {match_raw} ({100*match_raw/total:.1f}%) |",
        f"| 差分あり（要対応） | **{with_drift}** |",
        f"| ST extra 弾（件数） | {sum(len(w['stExtra']) for w in weapons)} |",
        f"| ST missing 弾（件数） | {sum(len(w['stMissing']) for w in weapons)} |",
        "",
        "## ST extra の根本原因（件数）",
        "",
        "| カテゴリ | 件数 | 対処 |",
        "|----------|------|------|",
    ]

    cause_fix = {
        "RUNTIME_ALREADY_OK": "マスタ再ビルド（ランタイムは既に正しい）",
        "BUILD_HEURISTIC:AMMO_792": "`build_wpns_pl_master.py` mg42→AMMO_792 撤去、CBE effective 使用",
        "BUILD_HEURISTIC:AMMO_3006": "同上 AMMO_3006 クラスタ撤去",
        "BUILD_HEURISTIC:AMMO_9": "同上 AMMO_9 クラスタ撤去",
        "BUILD_HEURISTIC:AMMO_30CBN": "同上 AMMO_30CBN 撤去",
        "BUILD_HEURISTIC:AMMO_303BR": "同上 AMMO_303BR クラスタ撤去",
        "BUILD_HEURISTIC:AMMO_45": "同上 AMMO_45 クラスタ撤去",
        "BUILD_HEURISTIC:AMMO_27": "同上 AMMO_27 クラスタ撤去",
        "BUILD_HEURISTIC:STG_KURZ_277": "StG 系 277 固定ヒューリスティクス撤去",
        "BUILD_HEURISTIC:OTHER": "ビルド fallback 見直し",
        "U27_SHAPE_FILTER": "マスタ再ビルド（u27 フィルタ後を正本化）",
        "CBE_AUX_IN_RAW": "category 除外済 — マスタから除去",
        "FILTERED_UNKNOWN": "第3フィルタ RE 候補",
        "UNEXPLAINED": "個別 RE",
    }

    for cause, count in cause_counter.most_common():
        fix = cause_fix.get(cause, "調査")
        lines.append(f"| `{cause}` | {count} | {fix} |")

    lines.extend(
        [
            "",
            "## ビルドヒューリスティクスが主因の武器（extra ≥2）",
            "",
            "| cbeIdx | 武器 | Effective | ST extra（原因） |",
            "|--------|------|-----------|------------------|",
        ]
    )

    heuristic_weapons = [
        w for w in weapons
        if w["stExtra"] and any(k.startswith("BUILD_HEURISTIC") for k in w["causes"])
    ]
    heuristic_weapons.sort(key=lambda x: -len(x["stExtra"]))
    for w in heuristic_weapons[:40]:
        extra_desc = []
        for cause, ais in w["causes"].items():
            if cause == "RUNTIME_ALREADY_OK":
                continue
            ammo_names = ", ".join(n(names, ai) for ai in ais[:4])
            if len(ais) > 4:
                ammo_names += f" +{len(ais)-4}"
            extra_desc.append(f"{cause}: {ammo_names}")
        eff = ", ".join(n(names, ai) for ai in w["effective"][:5]) or "—"
        if len(w["effective"]) > 5:
            eff += "…"
        lines.append(
            f"| {w['cbeIdx']} | {w['name']} | {eff} | {'; '.join(extra_desc) or '—'} |"
        )

    lines.extend(
        [
            "",
            "## u27 形状フィルタで落ちる弾（CBE raw にあるが Effective 外）",
            "",
            "| cbeIdx | 武器 | u27 で除外 | Effective 残 |",
            "|--------|------|------------|----------------|",
        ]
    )

    u27_weapons = [w for w in weapons if w["u27Dropped"]]
    for w in u27_weapons[:30]:
        dropped = ", ".join(f"{n(names, ai)}" for ai in w["u27Dropped"])
        eff = ", ".join(n(names, ai) for ai in w["effective"][:4]) or "—"
        lines.append(f"| {w['cbeIdx']} | {w['name']} | {dropped} | {eff} |")

    lines.extend(
        [
            "",
            "## ST missing（Effective にあるがマスタ未反映）",
            "",
            "| cbeIdx | 武器 | missing 弾 |",
            "|--------|------|------------|",
        ]
    )

    for wi, wn, ai, an in sorted(missing_all, key=lambda x: (x[0], x[2]))[:50]:
        lines.append(f"| {wi} | {wn} | {an} ({ai}) |")
    if len(missing_all) > 50:
        lines.append(f"| … | +{len(missing_all)-50} 件 | |")

    lines.extend(
        [
            "",
            "## mag_type (u21) — w21≠0 武器のみ",
            "",
            f"武器 u21≠0: {sum(1 for w in weapons if w['w21'])} 件。",
            "武器側 u21 は `sub_action_items[0]`、弾側は `mag_type_group`（同一オフセット・意味別）。",
            "",
            "### delta = a21 − w21 分布",
            "",
            "| delta | 件数 |",
            "|-------|------|",
        ]
    )

    for d, c in sorted(delta_counter.items(), key=lambda x: x[0]):
        lines.append(f"| {d:+d} | {c} |")

    lines.extend(["", "### 全ペア", "", "| 武器 | w21 | 弾 | a21 | delta |", "|------|-----|-----|-----|-------|"])
    for p in mag_pairs:
        d = p["delta"]
        ds = f"{d:+d}" if d is not None else "—"
        lines.append(f"| {p['weapon']} | {p['w21']} | {p['ammo']} | {p['a21']} | {ds} |")

    lines.extend(
        [
            "",
            "## Kar98 / Kar43 系 — 7.92-5 (272) ギャップ",
            "",
            "CBE `ammo_indices` 4 スロットに 272 が無い武器（第3フィルタ or 拡張テーブル疑い）:",
            "",
            "| cbeIdx | 武器 | raw に 272 | effective 273 |",
            "|--------|------|------------|---------------|",
        ]
    )

    for g in kar98_272_gap:
        lines.append(
            f"| {g['wi']} | {g['name']} | {'✓' if g['has272'] else '**—**'} | "
            f"{'✓' if g['effective273'] else '—'} |"
        )

    lines.extend(
        [
            "",
            "## override 不要ロードマップ",
            "",
            "1. **`build_wpns_pl_master.py`**: `plcompat_for_index` の AMMO_* クラスタ fallback を廃止し、",
            "   `stats.ammo_indices` → cat18 → u27 の Effective を `acceptsAmmo` に焼く",
            "2. **ランタイム**: 既存 `finalizeWeaponAmmoIndices` はマスタノイズ除去の安全網として維持",
            "3. **第3フィルタ**: mag_type RE 完了後 `FEATURE_PL_MAG_TYPE_FILTER` 追加",
            "4. **272 問題**: PL 実機 or CBE コード — override 禁止",
            "",
            "## 再実行",
            "",
            "```bash",
            "python scripts/audit_pl_ammo_comprehensive.py",
            "python scripts/export_pl_weapon_ammo_canonical.py",
            "```",
            "",
        ]
    )

    OUT_MD.write_text("\n".join(lines), encoding="utf-8")

    if args.json:
        doc = {
            "generated": date.today().isoformat(),
            "summary": {
                "total": total,
                "matchEffective": match_eff,
                "matchRaw": match_raw,
                "withDrift": with_drift,
            },
            "causeCounts": dict(cause_counter),
            "weapons": weapons,
            "magTypePairs": mag_pairs,
            "kar98_272_gap": kar98_272_gap,
        }
        OUT_JSON.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Wrote {OUT_MD.relative_to(ROOT)}")
    print(f"  weapons: {total}, match effective: {match_eff}, drift: {with_drift}")
    print(f"  top causes: {cause_counter.most_common(5)}")
    if args.json:
        print(f"Wrote {OUT_JSON.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

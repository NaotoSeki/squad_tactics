# -*- coding: utf-8 -*-
"""
CBE 正本装填リスト — PL バイナリ + 解明済みフィルタのみ。

各段を分離出力: raw → cat18 → u27 → mag_type（メタのみ、ルール未確定）

史実/Wikipedia 提案は出力しない（docs/PL_AMMO_TRUTH.md）。

入力: data/wpns_pl_stats_decoded.json, pl_cbe_mag_shape.js, pl_cbe_mag_type.js
出力:
  docs/PL_CBE_AMMO_TRUTH.md
  data/pl_cbe_ammo_truth.json

実行: python scripts/export_pl_cbe_ammo_truth.py
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATS_JSON = ROOT / "data" / "wpns_pl_stats_decoded.json"
NAMES_JSON = ROOT / "data" / "cbe_name_table.json"
MASTER_JS = ROOT / "data" / "wpns_pl_master.js"
OUT_MD = ROOT / "docs" / "PL_CBE_AMMO_TRUTH.md"
OUT_JSON = ROOT / "data" / "pl_cbe_ammo_truth.json"

WEAPON_CATS = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11}


def load_names() -> dict[str, str]:
    return json.loads(NAMES_JSON.read_text(encoding="utf-8"))


def n(names: dict[str, str], idx: int) -> str:
    return names.get(str(idx), f"#{idx}")


def parse_master_accepts() -> dict[int, list[int]]:
    import re

    if not MASTER_JS.exists():
        return {}
    text = MASTER_JS.read_text(encoding="utf-8")
    out: dict[int, list[int]] = {}
    for m in re.finditer(
        r"cbeNameIndex:(\d+).*?acceptsAmmo:\[([^\]]*)\]",
        text,
    ):
        wi = int(m.group(1))
        raw = m.group(2).strip()
        out[wi] = [] if not raw else [int(x.strip()) for x in raw.split(",") if x.strip()]
    return out


def ammo_meta(
    wi: int,
    ai: int,
    names: dict[str, str],
    cat_map: dict[int, int],
    w_shape: dict,
    a_shape: dict,
    mag_w: dict,
    mag_a: dict,
) -> dict:
    from scripts.pl_ammo_cbe_filters import (
        mag_type_a21,
        mag_type_w21,
        passes_category,
        passes_u27,
    )

    w21 = mag_type_w21(wi, mag_w)
    a21 = mag_type_a21(ai, mag_a)
    return {
        "idx": ai,
        "name": n(names, ai),
        "cat18": passes_category(cat_map, ai),
        "u27": passes_u27(wi, ai, w_shape, a_shape),
        "w21": w21,
        "a21": a21,
        "delta": (a21 - w21) if w21 else None,
    }


def main() -> None:
    import sys

    sys.path.insert(0, str(ROOT))
    from scripts.pl_ammo_cbe_filters import (
        expand_composite_ammo,
        filter_pipeline_stages,
        load_category_map,
        load_mag_type_maps,
        load_stats_by_cbe,
        u26_ammo_box_inner_indices,
    )
    from scripts.pl_ammo_cbe_filters import load_json_from_js
    from scripts.pl_ammo_cbe_filters import MAG_SHAPE_JS

    names = load_names()
    stats = load_stats_by_cbe()
    master = parse_master_accepts()
    cat_map = load_category_map()
    w_shape = load_json_from_js(MAG_SHAPE_JS, "PL_CBE_MAG_SHAPE_WEAPONS")
    a_shape = load_json_from_js(MAG_SHAPE_JS, "PL_CBE_MAG_SHAPE_AMMO")
    mag_w, mag_a = load_mag_type_maps()

    rows: list[dict] = []
    w21_nz = 0
    drift_u27 = 0
    empty_u27 = 0

    for wi, rec in sorted(stats.items(), key=lambda x: x[0]):
        cat = int(rec.get("category_code") or 99)
        if cat not in WEAPON_CATS:
            continue
        if not (rec.get("name") or "").strip():
            continue

        raw = [int(x) for x in (rec.get("ammo_indices") or [])]
        stages = filter_pipeline_stages(
            wi, raw, cat_map=cat_map, w_shape=w_shape, a_shape=a_shape, mag_w=mag_w, mag_a=mag_a,
            apply_mag_type=True,
        )
        st = master.get(wi, [])
        eff = stages["afterMagCap"]
        box_raw = u26_ammo_box_inner_indices(wi, stats_by_cbe=stats)
        after_composite = expand_composite_ammo(
            wi,
            eff,
            cat_map=cat_map,
            w_shape=w_shape,
            a_shape=a_shape,
            mag_w=mag_w,
            mag_a=mag_a,
            stats_by_cbe=stats,
        )
        composite_added = [ai for ai in after_composite if ai not in eff]
        st_set = set(st)
        eff_set = set(eff)
        composite_set = set(after_composite)
        match = st_set == eff_set
        match_composite = st_set == composite_set

        w21 = int(mag_w.get(str(wi), mag_w.get(wi, 0)) or 0)
        if w21:
            w21_nz += 1
        if not eff:
            empty_u27 += 1
        if not match:
            drift_u27 += 1

        slot_meta = [ammo_meta(wi, ai, names, cat_map, w_shape, a_shape, mag_w, mag_a) for ai in raw]

        rows.append(
            {
                "cbeIdx": wi,
                "name": rec["name"],
                "category": rec.get("category_name", ""),
                "w21": w21,
                "pipeline": {
                    "raw": stages["raw"],
                    "rawNames": [n(names, i) for i in stages["raw"]],
                    "aux": stages["aux"],
                    "auxNames": [n(names, i) for i in stages["aux"]],
                    "afterCat18": stages["afterCat18"],
                    "afterCat18Names": [n(names, i) for i in stages["afterCat18"]],
                    "u27Dropped": stages["u27Dropped"],
                    "u27DroppedNames": [n(names, i) for i in stages["u27Dropped"]],
                    "afterU27": stages["afterU27"],
                    "afterU27Names": [n(names, i) for i in stages["afterU27"]],
                    "magTypeDropped": stages["magTypeDropped"],
                    "magTypeDroppedNames": [n(names, i) for i in stages["magTypeDropped"]],
                    "afterMagType": stages["afterMagType"],
                    "afterMagTypeNames": [n(names, i) for i in stages["afterMagType"]],
                    "boxInnerRaw": box_raw,
                    "boxInnerRawNames": [n(names, i) for i in box_raw],
                    "compositeAdded": composite_added,
                    "compositeAddedNames": [n(names, i) for i in composite_added],
                    "afterComposite": after_composite,
                    "afterCompositeNames": [n(names, i) for i in after_composite],
                    "magTypeNote": (
                        "w21≠0 — exact a21==w21 @ CBE 0x18BF3"
                        if w21
                        else "w21=0 — mag_type 不適用"
                    ),
                },
                "slots": slot_meta,
                "stMaster": st,
                "stMasterNames": [n(names, i) for i in st],
                "matchMasterU27": match,
                "matchMasterComposite": match_composite,
                "stExtra": sorted(st_set - eff_set),
                "stMissing": sorted(eff_set - st_set),
                "stExtraVsComposite": sorted(st_set - composite_set),
                "stMissingVsComposite": sorted(composite_set - st_set),
            }
        )

    summary = {
        "generated": date.today().isoformat(),
        "weapons": len(rows),
        "w21NonZero": w21_nz,
        "matchMasterU27": sum(1 for r in rows if r["matchMasterU27"]),
        "driftVsMaster": drift_u27,
        "emptyAfterU27": empty_u27,
        "magTypeFilterStatus": "PARTIAL — exact match @ CBE 0x18BF3; indirect table @ 0x46CA0 TBD",
    }

    OUT_JSON.write_text(
        json.dumps({"summary": summary, "weapons": rows}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    lines = [
        "# PL 装填正本 — CBE + 解明済みフィルタ",
        "",
        f"**生成**: {summary['generated']} — `python scripts/export_pl_cbe_ammo_truth.py`",
        "",
        "> **正本は PL（CBE.EXE）のみ。** 史実/Wikipedia 提案リストは廃止。",
        "",
        "## パイプライン（各段を分離出力）",
        "",
        "```",
        "① raw          weapon.ammo_indices（CBE +44..+50 全4スロット）",
        "② aux          category≠18（銃剣・擲弾・付属装備）",
        "③ afterCat18   category==18 のみ",
        "④ afterU27     u16[27] 形状一致 — **実装済**",
        "⑤ afterMagType u16[21] — **CBE 0x18BF3: w21=0 skip / else a21==w21**（Bren 等は間接テーブル要追跡）",
        "```",
        "",
        f"第3フィルタ RE: [PL_MAG_TYPE_FILTER.md](./PL_MAG_TYPE_FILTER.md) / CBE 逆引き: [PL_CBE_AMMO_FILTER_RE.md](./PL_CBE_AMMO_FILTER_RE.md)",
        "",
        "## サマリー",
        "",
        "| 指標 | 値 |",
        "|------|-----|",
        f"| 火器数 | {summary['weapons']} |",
        f"| w21≠0（mag_type 候補） | {summary['w21NonZero']} |",
        f"| afterU27 == ST マスタ | {summary['matchMasterU27']} |",
        f"| ST マスタ差分 | {summary['driftVsMaster']} |",
        f"| afterU27 空 | {summary['emptyAfterU27']} |",
        f"| mag_type | {summary['magTypeFilterStatus']} |",
        "",
        "## ST マスタ差分（afterU27 vs acceptsAmmo）",
        "",
        "| cbeIdx | 武器 | w21 | ①raw | ③cat18 | ④afterU27 | ST |",
        "|--------|------|-----|------|--------|-----------|-----|",
    ]

    for r in rows:
        if r["matchMasterU27"]:
            continue
        p = r["pipeline"]
        raw_s = ", ".join(p["rawNames"]) or "—"
        cat_s = ", ".join(p["afterCat18Names"]) or "—"
        u27_s = ", ".join(p["afterU27Names"]) or "—"
        st_s = ", ".join(r["stMasterNames"]) or "—"
        lines.append(
            f"| {r['cbeIdx']} | {r['name']} | {r['w21']} | {raw_s} | {cat_s} | {u27_s} | {st_s} |"
        )

    lines.extend(
        [
            "",
            "## 全火器 — パイプライン各段",
            "",
            "| cbeIdx | 武器 | w21 | ①raw | ②aux | ④afterU27 | u27除外 | mag_type |",
            "|--------|------|-----|------|------|-----------|---------|----------|",
        ]
    )

    for r in rows:
        p = r["pipeline"]
        raw_s = ", ".join(p["rawNames"]) or "—"
        aux_s = ", ".join(p["auxNames"]) or ""
        u27_s = ", ".join(p["afterU27Names"]) or "—"
        drop_s = ", ".join(p["u27DroppedNames"]) or ""
        mag_note = "—" if not r["w21"] else p["magTypeNote"]
        lines.append(
            f"| {r['cbeIdx']} | {r['name']} | {r['w21']} | {raw_s} | {aux_s} | {u27_s} | {drop_s} | {mag_note} |"
        )

    lines.extend(
        [
            "",
            "## w21≠0 武器 — 弾ごと mag_type メタ",
            "",
        ]
    )

    for r in rows:
        if not r["w21"]:
            continue
        lines.append(f"### {r['name']} (cbeIdx={r['cbeIdx']}, w21={r['w21']})")
        lines.append("")
        lines.append("| 弾 | a21 | delta | cat18 | u27 | ST |")
        lines.append("|-----|-----|-------|-------|-----|-----|")
        for s in r["slots"]:
            if not s["cat18"]:
                continue
            d = f"{s['delta']:+d}" if s["delta"] is not None else "—"
            in_st = "✓" if s["idx"] in r["stMaster"] else ""
            u27 = "✓" if s["u27"] else "✗"
            lines.append(f"| {s['name']} | {s['a21']} | {d} | ✓ | {u27} | {in_st} |")
        lines.append("")

    lines.extend(
        [
            "## 関連",
            "",
            "- [PL_CBE_AMMO_FILTER_RE.md](./PL_CBE_AMMO_FILTER_RE.md) — CBE 逆アセンブル",
            "- [PL_AMMO_TRUTH.md](./PL_AMMO_TRUTH.md) — 方針",
            "- [PL_AMMO_UI_FILTER.md](./PL_AMMO_UI_FILTER.md) — u27",
            "",
            "**再生成**:",
            "```bash",
            "python scripts/research_mag_type_filter.py",
            "python scripts/export_pl_cbe_ammo_truth.py",
            "```",
        ]
    )

    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT_MD.relative_to(ROOT)}")
    print(f"Wrote {OUT_JSON.relative_to(ROOT)}")
    print(
        f"  weapons={summary['weapons']} w21nz={summary['w21NonZero']} "
        f"match={summary['matchMasterU27']} drift={summary['driftVsMaster']}"
    )


if __name__ == "__main__":
    main()

# -*- coding: utf-8 -*-
"""
第3フィルタ mag_type (u16[21]) RE — ST マスタ・CBE 生スロットとの突合。

実行: python scripts/research_mag_type_filter.py
出力: docs/PL_MAG_TYPE_FILTER.md, data/pl_mag_type_research.json
"""
from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATS_JSON = ROOT / "data" / "wpns_pl_stats_decoded.json"
NAMES_JSON = ROOT / "data" / "cbe_name_table.json"
MASTER_JS = ROOT / "data" / "wpns_pl_master.js"
MAG_SHAPE_JS = ROOT / "data" / "pl_cbe_mag_shape.js"
MAG_TYPE_JS = ROOT / "data" / "pl_cbe_mag_type.js"
OUT_MD = ROOT / "docs" / "PL_MAG_TYPE_FILTER.md"
OUT_JSON = ROOT / "data" / "pl_mag_type_research.json"

WEAPON_CATS = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11}
LOADABLE_CAT = 18


def load_json_from_js(path: Path, var_name: str) -> dict:
    if not path.exists():
        return {}
    text = path.read_text(encoding="utf-8")
    m = re.search(rf"window\.{re.escape(var_name)}\s*=\s*(\{{[\s\S]*?\}})\s*;", text)
    return json.loads(m.group(1)) if m else {}


def parse_master() -> dict[int, list[int]]:
    if not MASTER_JS.exists():
        return {}
    text = MASTER_JS.read_text(encoding="utf-8")
    out: dict[int, list[int]] = {}
    for m in re.finditer(r"cbeNameIndex:(\d+).*?acceptsAmmo:\[([^\]]*)\]", text):
        wi = int(m.group(1))
        raw = m.group(2).strip()
        out[wi] = [] if not raw else [int(x.strip()) for x in raw.split(",") if x.strip()]
    return out


def main() -> None:
    import sys

    sys.path.insert(0, str(ROOT))
    from scripts.pl_ammo_cbe_filters import (
        finalize_ammo_indices,
        load_category_map,
        load_stats_by_cbe,
        passes_category,
        passes_u27,
    )

    names = json.loads(NAMES_JSON.read_text(encoding="utf-8"))
    stats = load_stats_by_cbe()
    master = parse_master()
    cat_map = load_category_map()
    w_shape = load_json_from_js(MAG_SHAPE_JS, "PL_CBE_MAG_SHAPE_WEAPONS")
    a_shape = load_json_from_js(MAG_SHAPE_JS, "PL_CBE_MAG_SHAPE_AMMO")
    mag_w = load_json_from_js(MAG_TYPE_JS, "PL_CBE_MAG_TYPE_WEAPONS")
    mag_a = load_json_from_js(MAG_TYPE_JS, "PL_CBE_MAG_TYPE_AMMO")

    def n(i: int) -> str:
        return names.get(str(i), f"#{i}")

    def w21(wi: int) -> int:
        return int(mag_w.get(str(wi), mag_w.get(wi, 0)) or 0)

    def a21(ai: int) -> int:
        return int(mag_a.get(str(ai), mag_a.get(ai, 0)) or 0)

    # --- 仮説: w21==0 → フィルタなし; w21!=0 → 要 RE ---
    hypotheses = {
        "exact": lambda wi, ai: w21(wi) == 0 or a21(ai) == w21(wi),
        "delta_pm2": lambda wi, ai: w21(wi) == 0 or abs(a21(ai) - w21(wi)) <= 2,
        "delta_pm3": lambda wi, ai: w21(wi) == 0 or abs(a21(ai) - w21(wi)) <= 3,
        "a21_ge_w21": lambda wi, ai: w21(wi) == 0 or a21(ai) >= w21(wi),
        "a21_nonzero": lambda wi, ai: w21(wi) == 0 or a21(ai) != 0,
    }

    weapons_out: list[dict] = []
    nz_weapons: list[dict] = []
    delta_by_weapon: dict[int, list[dict]] = defaultdict(list)

    for wi, rec in sorted(stats.items()):
        cat = int(rec.get("category_code") or 99)
        if cat not in WEAPON_CATS:
            continue
        if not (rec.get("name") or "").strip():
            continue

        raw = [int(x) for x in (rec.get("ammo_indices") or [])]
        after_cat = [ai for ai in raw if passes_category(cat_map, ai)]
        after_u27 = finalize_ammo_indices(
            wi, raw, cat_map=cat_map, w_shape=w_shape, a_shape=a_shape
        )
        st = master.get(wi, [])
        w21v = w21(wi)

        stages = {
            "raw": raw,
            "afterCat18": after_cat,
            "afterU27": after_u27,
        }

        mag_dropped: list[int] = []
        after_mag: list[int] = []
        for ai in after_u27:
            if w21v == 0:
                after_mag.append(ai)
            elif hypotheses["delta_pm2"](wi, ai):
                after_mag.append(ai)
            else:
                mag_dropped.append(ai)

        stages["afterMagType_pm2"] = after_mag
        stages["magTypeDropped_pm2"] = mag_dropped

        pair_rows = []
        for ai in after_cat:
            pair_rows.append(
                {
                    "ai": ai,
                    "name": n(ai),
                    "a21": a21(ai),
                    "delta": a21(ai) - w21v if w21v else None,
                    "passCat18": ai in after_cat,
                    "passU27": ai in after_u27,
                    "inMaster": ai in st,
                }
            )
            if w21v:
                delta_by_weapon[w21v].append({"wi": wi, "weapon": rec["name"], **pair_rows[-1]})

        row = {
            "cbeIdx": wi,
            "name": rec["name"],
            "w21": w21v,
            "stMaster": st,
            "stMatchU27": set(st) == set(after_u27),
            "stMatchMagPm2": set(st) == set(after_mag),
            "stExtra": sorted(set(st) - set(after_u27)),
            "stMissing": sorted(set(after_u27) - set(st)),
            "stMissingAfterMag": sorted(set(after_mag) - set(st)),
            "stExtraAfterMag": sorted(set(st) - set(after_mag)),
            "pairs": pair_rows,
            **{k: v for k, v in stages.items()},
        }
        weapons_out.append(row)
        if w21v:
            nz_weapons.append(row)

    # ST マスタ vs 各段
    total = len(weapons_out)
    match_u27 = sum(1 for w in weapons_out if w["stMatchU27"])
    match_mag = sum(1 for w in weapons_out if w["stMatchMagPm2"])

    # w21!=0 武器: delta 分布（master に含まれる弾のみ）
    master_deltas: Counter[int] = Counter()
    all_deltas: Counter[int] = Counter()
    for w in nz_weapons:
        for p in w["pairs"]:
            if p["delta"] is not None:
                all_deltas[p["delta"]] += 1
                if p["inMaster"]:
                    master_deltas[p["delta"]] += 1

    # 仮説スコア（ST マスタ一致数）
    hyp_scores: dict[str, int] = {}
    for hname, fn in hypotheses.items():
        score = 0
        for w in weapons_out:
            wi = w["cbeIdx"]
            w21v = w21(wi)
            predicted = [
                ai
                for ai in w["afterU27"]
                if fn(wi, ai)
            ]
            if set(predicted) == set(w["stMaster"]):
                score += 1
        hyp_scores[hname] = score

    summary = {
        "generated": date.today().isoformat(),
        "weapons": total,
        "w21NonZero": len(nz_weapons),
        "stMatchAfterU27": match_u27,
        "stMatchAfterMagPm2": match_mag,
        "hypothesisScores": hyp_scores,
        "masterDeltaDistribution": dict(sorted(master_deltas.items())),
        "allDeltaDistribution": dict(sorted(all_deltas.items())),
        "status": "PARTIAL",
        "conclusion": (
            "w21!=0 は 18 武器のみ。delta=a21-w21 は武器ごとにばらつき（-56〜+3）。"
            "単一ルール未確定。w21=0 武器（Kar98/M1911/HSc 等）には mag_type フィルタは適用されない。"
            "272/7.92-5 問題は ammo_indices 未収録であり mag_type では説明不可。"
        ),
    }

    OUT_JSON.write_text(
        json.dumps({"summary": summary, "w21NonZero": nz_weapons, "weapons": weapons_out}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    lines = [
        "# PL 第3フィルタ — mag_type_group (u16[21]) RE",
        "",
        f"**生成**: {summary['generated']} — `python scripts/research_mag_type_filter.py`",
        "",
        "## ステータス: **未完了（PARTIAL）**",
        "",
        summary["conclusion"],
        "",
        "## 確定事項",
        "",
        "| 項目 | 内容 |",
        "|------|------|",
        f"| w21≠0 武器数 | {len(nz_weapons)} / {total} |",
        "| w21=0 の意味 | **mag_type フィルタ不適用**（大多数の小銃・拳銃・SMG） |",
        "| 武器 u21 | `sub_action_items[0]` @ +42（弾の mag_type_group と同名オフセットだが意味別） |",
        "| 弾 a21 | `mag_type_group` @ +42 |",
        "| cat18 + u27 | 第1・第2フィルタ — **実装済** |",
        "",
        "## ST マスタ一致（各段）",
        "",
        f"| 段 | 一致数 |",
        f"|----|--------|",
        f"| afterU27 | {match_u27} / {total} |",
        f"| afterMagType (delta±2 仮説) | {match_mag} / {total} |",
        "",
        "## 仮説スコア（= ST マスタ完全一致の武器数）",
        "",
        "| 仮説 | 一致 |",
        "|------|------|",
    ]
    for h, sc in sorted(hyp_scores.items(), key=lambda x: -x[1]):
        lines.append(f"| `{h}` | {sc} |")

    lines.extend(
        [
            "",
            "## w21≠0 武器 — delta (a21−w21) 分布",
            "",
            "### raw 候補（afterCat18 全弾）",
            "",
            "| delta | 件数 |",
            "|-------|------|",
        ]
    )
    for d, c in sorted(all_deltas.items()):
        lines.append(f"| {d:+d} | {c} |")

    lines.extend(
        [
            "",
            "### ST マスタに含まれる弾のみ",
            "",
            "| delta | 件数 |",
            "|-------|------|",
        ]
    )
    for d, c in sorted(master_deltas.items()):
        lines.append(f"| {d:+d} | {c} |")

    lines.extend(
        [
            "",
            "## w21≠0 武器 詳細",
            "",
            "| cbeIdx | 武器 | w21 | CBE raw | afterU27 | ST | delta±2後 |",
            "|--------|------|-----|---------|----------|-----|-----------|",
        ]
    )
    for w in nz_weapons:
        raw = ", ".join(n(w["raw"][i]) if i < len(w["raw"]) else "" for i in range(len(w["raw"]))) or "—"
        raw = ", ".join(n(ai) for ai in w["raw"]) or "—"
        u27 = ", ".join(n(ai) for ai in w["afterU27"]) or "—"
        st = ", ".join(n(ai) for ai in w["stMaster"]) or "—"
        mag = ", ".join(n(ai) for ai in w["afterMagType_pm2"]) or "—"
        lines.append(
            f"| {w['cbeIdx']} | {w['name']} | {w['w21']} | {raw} | {u27} | {st} | {mag} |"
        )

    lines.extend(
        [
            "",
            "## mag_type では説明できないギャップ",
            "",
            "### Kar98 / 7.92-5 (272)",
            "",
            "CBE `ammo_indices` 4 スロットに **272 未収録**。w21=0 のため mag_type 第3フィルタも不発。",
            "PL UI で 272 が出るなら **拡張テーブル or 別ロジック**（CBE コード逆引き要）。",
            "",
            "### 拳銃 (M1911/HSc 等)",
            "",
            "w21=0。CBE raw 226 → u27 で落ち Effective 空 → 現 ST は explicit/ヒューリスティクス由来。",
            "mag_type では 225/226 分離 **不可**（a21=1/2, w21=0）。",
            "",
            "## 次ステップ",
            "",
            "1. CBE.EXE 逆アセンブル: u21 比較コード（w21≠0 の 18 武器に限定）",
            "2. `sub_action_items[0]` が index 参照か mag_type ID か再検証",
            "3. 272 問題: ammo_indices 外テーブル探索",
            "4. **実装保留**: 単一 passesMagType ルール確定までランタイム第3フィルタは入れない",
            "",
            "## 関連",
            "",
            "- [PL_CBE_AMMO_TRUTH.md](./PL_CBE_AMMO_TRUTH.md) — 各段パイプライン出力",
            "- [PL_AMMO_UI_FILTER.md](./PL_AMMO_UI_FILTER.md) — u27 第2フィルタ",
            "",
            "**再生成**: `python scripts/research_mag_type_filter.py`",
        ]
    )

    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT_MD.relative_to(ROOT)}")
    print(f"Wrote {OUT_JSON.relative_to(ROOT)}")
    print(f"  w21!=0={len(nz_weapons)} match_u27={match_u27} match_mag_pm2={match_mag}")
    print(f"  best hypothesis: {max(hyp_scores, key=hyp_scores.get)}={hyp_scores[max(hyp_scores, key=hyp_scores.get)]}")


if __name__ == "__main__":
    main()

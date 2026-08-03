# -*- coding: utf-8 -*-
"""
CBE 複合装備リンク — 主武器 + u26(箱/三脚) + 箱内弾帯 + cat18 主弾。

PatrK15 等 ammo_box(cat13): ammo_indices = 内包弾帯/弾薬行。
MG 等: raw 4slot にドラム/ベルト + u26→弾薬箱 → 箱内 7.92f100/7.92f250 等。

実行: python scripts/export_pl_composite_links.py
出力:
  data/pl_composite_links.json
  docs/PL_WEAPON_COMPOSITE_LINK.md
"""
from __future__ import annotations

import json
import struct
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CBE = Path(r"D:\PL\CBE.EXE")
STATS = ROOT / "data" / "wpns_pl_stats_decoded.json"
NAMES = ROOT / "data" / "cbe_name_table.json"
OUT_JSON = ROOT / "data" / "pl_composite_links.json"
OUT_JS = ROOT / "data" / "pl_composite_links.js"
OUT_MD = ROOT / "docs" / "PL_WEAPON_COMPOSITE_LINK.md"

CAT_AMMO = 18
CAT_AMMO_BOX = 13
CAT_TRIPOD_LIKE = {12, 13, 14}  # tripod, optic, box — refined per row name


def n(names: dict, i: int) -> str:
    return names.get(str(i), f"#{i}")


def read_rec(cbe: bytes, idx: int) -> list[int]:
    off = 0x1DDF00 + idx * 64
    return [struct.unpack_from("<H", cbe, off + i)[0] for i in range(0, 64, 2)]


def classify_link(names: dict, idx: int, cat: int | None) -> str:
    name = n(names, idx).lower()
    if cat == CAT_AMMO_BOX or "ammobox" in name or "patrk" in name or "pat." in name:
        return "ammo_box"
    if "tripod" in name or "lafette" in name or "laf" in name or "t." in name[:3]:
        return "tripod"
    if "binoc" in name or "ferng" in name or "optic" in name:
        return "optic"
    if cat == CAT_AMMO:
        return "ammo"
    if cat == 24:
        return "bayonet"
    if cat == 19:
        return "grenade_adapter"
    return "other"


def main() -> None:
    if not CBE.is_file():
        raise SystemExit(f"CBE not found: {CBE}")

    cbe = CBE.read_bytes()
    stats = json.loads(STATS.read_text(encoding="utf-8"))
    names = json.loads(NAMES.read_text(encoding="utf-8"))
    by = {r["cbeNameIndex"]: r for r in stats}

    boxes: dict[int, dict] = {}
    for r in stats:
        if r.get("category_code") != CAT_AMMO_BOX:
            continue
        wi = r["cbeNameIndex"]
        inner = [x for x in (r.get("ammo_indices") or []) if x]
        boxes[wi] = {
            "idx": wi,
            "name": r["name"],
            "innerAmmo": [{"idx": i, "name": n(names, i)} for i in inner],
        }

    composites = []
    for r in stats:
        wi = r["cbeNameIndex"]
        cat = r.get("category_code")
        if cat is None or cat > 17:
            continue
        u = read_rec(cbe, wi)
        slot_indices = [x for x in (r.get("ammo_indices") or []) if x]
        slots = []
        for ai in slot_indices[:4]:
            ar = by.get(ai, {})
            slots.append(
                {
                    "idx": ai,
                    "name": n(names, ai),
                    "cat": ar.get("category_code"),
                    "kind": classify_link(names, ai, ar.get("category_code")),
                }
            )

        # u16[26], like the four regular link slots, is a one-based raw item
        # ID. Convert before looking it up in zero-based cbeNameIndex tables.
        u26_raw_item_id = u[26]
        u26 = u26_raw_item_id - 1 if u26_raw_item_id else None
        u26_link = None
        if u26 is not None:
            tr = by.get(u26, {})
            kind = classify_link(names, u26, tr.get("category_code"))
            u26_link = {
                "rawItemId": u26_raw_item_id,
                "idx": u26,
                "name": n(names, u26),
                "cat": tr.get("category_code"),
                "kind": kind,
            }
            if kind == "ammo_box" and u26 in boxes:
                u26_link["innerAmmo"] = boxes[u26]["innerAmmo"]

        primary_ammo = [s for s in slots if s["kind"] == "ammo"]
        aux = [s for s in slots if s["kind"] != "ammo"]

        if not (primary_ammo or u26_link or aux):
            continue

        composites.append(
            {
                "weaponIdx": wi,
                "weaponName": r["name"],
                "category": cat,
                "w21": u[21],
                "primaryAmmo": primary_ammo,
                "auxSlots": aux,
                "u26Link": u26_link,
                "completeHmgHint": bool(
                    u26_link
                    and u26_link.get("kind") == "ammo_box"
                    and (primary_ammo or u26_link.get("innerAmmo"))
                ),
            }
        )

    # reverse: which weapons point to each box
    box_users: dict[int, list[int]] = {}
    for c in composites:
        link = c.get("u26Link")
        if link and link.get("kind") == "ammo_box":
            box_users.setdefault(link["idx"], []).append(c["weaponIdx"])

    for b in boxes.values():
        b["usedByWeapons"] = [
            {"idx": wi, "name": n(names, wi)} for wi in box_users.get(b["idx"], [])
        ]

    OUT_JSON.write_text(
        json.dumps(
            {
                "generated": date.today().isoformat(),
                "summary": {
                    "compositeWeapons": len(composites),
                    "ammoBoxes": len(boxes),
                    "hmgStyle": sum(1 for c in composites if c["completeHmgHint"]),
                },
                "ammoBoxes": list(boxes.values()),
                "weapons": composites,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    lines = [
        "# PL 複合装備リンク — 主武器 + 弾薬箱 + 内包弾帯",
        "",
        f"**生成**: {date.today().isoformat()} — `python scripts/export_pl_composite_links.py`",
        "",
        "## モデル（CBE + RE + プレイ知見）",
        "",
        "重機関銃の「完成形」は **単一行の acceptsAmmo では表現できない**:",
        "",
        "```",
        "MG 武器行",
        "  ├─ ammo_indices[4] … 主弾 cat18（Pt34-75, 7.92-50 等）— ドラム/短ベルト",
        "  ├─ u16[26] (+0x34) … 弾薬箱/三脚/観測鏡 index（4slot 外）",
        "  │     └─ ammo_box 行 → ammo_indices = 内包弾帯（7.92f100, 7.92f250）",
        "  └─ UI @0x4240C→0xF7C8→0x46CD4 … 列ごとに 8B エントリで link_index 照合",
        "```",
        "",
        "**PatrK15(116)** = ドイツ MG 弾薬箱。内包: **7.92-25, 7.92f250**（CBE）。",
        "プレイ上 **7.92f100** 等も同箱 — 本表記と整合。",
        "",
        "**M1 Ammobox(34)** → 3006-250, 50M2-110。",
        "**M2HB Ammobox(35)** → M6A1 HR（CBE 上はロケット行 — M2HB 用ベルト未リンク要 RE）。",
        "",
        f"## サマリー",
        "",
        f"| 複合リンクあり武器 | {len(composites)} |",
        f"| ammo_box 行 | {len(boxes)} |",
        f"| HMG 型（主弾+箱） | {sum(1 for c in composites if c['completeHmgHint'])} |",
        "",
        "## 弾薬箱 — 内包弾 + 参照武器",
        "",
        "| idx | 名称 | 内包弾 | u26 参照元 |",
        "|-----|------|--------|------------|",
    ]
    for b in sorted(boxes.values(), key=lambda x: x["idx"]):
        inner = ", ".join(x["name"] for x in b["innerAmmo"]) or "—"
        users = ", ".join(f"{u['name']}({u['idx']})" for u in b["usedByWeapons"][:6]) or "—"
        lines.append(f"| {b['idx']} | {b['name']} | {inner} | {users} |")

    lines.extend(
        [
            "",
            "## HMG / MG — 複合一覧",
            "",
            "| 武器 | 主弾(4slot) | u26→ | 箱内弾 |",
            "|------|-------------|------|--------|",
        ]
    )
    for c in sorted(composites, key=lambda x: x["weaponIdx"]):
        if not c["completeHmgHint"] and not c["u26Link"]:
            continue
        if c["category"] not in (5, 7, 15, 16) and not c["u26Link"]:
            continue
        prim = ", ".join(s["name"] for s in c["primaryAmmo"]) or "—"
        link = c["u26Link"]
        u26s = "—"
        inner = "—"
        if link:
            u26s = f"{link['name']}({link['idx']})"
            if link.get("innerAmmo"):
                inner = ", ".join(x["name"] for x in link["innerAmmo"])
        if prim == "—" and not link:
            continue
        lines.append(f"| {c['weaponName']} ({c['weaponIdx']}) | {prim} | {u26s} | {inner} |")

    lines.extend(
        [
            "",
            "## ST 未実装（ロードマップ）",
            "",
            "1. **入れ子解決**: `effectiveAmmo = cat18(slot) ∪ box(u26).inner`",
            "2. **三脚**: Laf34 等 — u26 または UI 別列（0x4C4..）。MG34 は u26=PatrK15 のみ確認",
            "3. **装備 UI 4 列** + `@ 0x46CD4` — 完成形はランタイムで合成",
            "",
            "正本: CBE + RE。攻略本「主弾+箱+三脚」記述と **PatrK15 入れ子** は一致。",
            "",
            "## 関連",
            "",
            "- [PL_WEAPON_LINK_TRUTH.md](./PL_WEAPON_LINK_TRUTH.md)",
            "- [PL_CBE_F7C8_RE.md](./PL_CBE_F7C8_RE.md)",
            "- [PL_CBE_AUX_UI_RE.md](./PL_CBE_AUX_UI_RE.md)",
            "",
        ]
    )

    OUT_MD.write_text("\n".join(lines), encoding="utf-8")

    u26_map: dict[str, dict] = {}
    for c in composites:
        link = c.get("u26Link")
        if not link:
            continue
        inner = [x["idx"] for x in (link.get("innerAmmo") or [])]
        u26_map[str(c["weaponIdx"])] = {
            "idx": link["idx"],
            "kind": link.get("kind"),
            "name": link.get("name"),
            "inner": inner,
        }

    boxes_js = {
        str(b["idx"]): {
            "name": b["name"],
            "inner": [x["idx"] for x in b["innerAmmo"]],
            "usedBy": [u["idx"] for u in b.get("usedByWeapons") or []],
        }
        for b in boxes.values()
    }

    js_lines = [
        "/** CBE 複合装備リンク — 主武器 + u26 弾薬箱 + 内包弾帯",
        " *  regen: python scripts/export_pl_composite_links.py",
        " */",
        "(function () {",
        "    'use strict';",
        "    window.PL_COMPOSITE_BOXES = " + json.dumps(boxes_js, ensure_ascii=False, indent=4) + ";",
        "    window.PL_COMPOSITE_U26 = " + json.dumps(u26_map, ensure_ascii=False, indent=4) + ";",
        "})();",
        "",
    ]
    OUT_JS.write_text("\n".join(js_lines), encoding="utf-8")

    print(f"Wrote {OUT_JSON.relative_to(ROOT)}")
    print(f"Wrote {OUT_JS.relative_to(ROOT)}")
    print(f"Wrote {OUT_MD.relative_to(ROOT)}")
    pk = boxes.get(116)
    if pk:
        print(f"PatrK15 inner: {[x['name'] for x in pk['innerAmmo']]}")


if __name__ == "__main__":
    main()

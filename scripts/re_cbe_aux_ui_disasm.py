# -*- coding: utf-8 -*-
"""
CBE RE: @ 0x46CD4 +0x34 ループ / @ 0x771E cat=24 分岐 / M9 RL 弾薬。

実行: python scripts/re_cbe_aux_ui_disasm.py
出力: docs/PL_CBE_AUX_UI_RE.md, scripts/pl_decoded/cbe_aux_ui_re.json
"""
from __future__ import annotations

import json
import struct
from datetime import date
from pathlib import Path

try:
    from capstone import CS_ARCH_X86, CS_MODE_16, Cs
except ImportError as e:
    raise SystemExit("pip install capstone") from e

PL = Path(r"D:\PL")
ROOT = Path(__file__).resolve().parents[1]
CBE_PATH = PL / "CBE.EXE"
STATS = ROOT / "data" / "wpns_pl_stats_decoded.json"
NAMES = ROOT / "data" / "cbe_name_table.json"
OUT_MD = ROOT / "docs" / "PL_CBE_AUX_UI_RE.md"
OUT_JSON = ROOT / "scripts" / "pl_decoded" / "cbe_aux_ui_re.json"

# 64-byte record offsets (bytes)
OFF_CAT = 2       # u16[1] category_code
OFF_AMMO0 = 44    # u16[22]
OFF_FIELD_28 = 40 # u16[20] — used in 0x46C57
OFF_FIELD_34 = 52 # u16[26] — +0x34 loop
OFF_FIELD_32 = 50 # u16[25] — cat24 cmp @ 0x77A6
OFF_U27 = 54      # u16[27]


def disasm(data: bytes, start: int, size: int) -> list[dict]:
    md = Cs(CS_ARCH_X86, CS_MODE_16)
    out = []
    for ins in md.disasm(data[start : start + size], start):
        mark = ""
        op = ins.op_str.lower()
        if "+ 0x34" in op or "+0x34" in op:
            mark = " ; +0x34 reserve?"
        elif "+ 0x32" in op or "+0x32" in op:
            mark = " ; +0x32 cat24"
        elif "+ 0x2c" in op or "+ 0x2c" in op:
            mark = " ; ammo[0]"
        elif "+ 0x28" in op:
            mark = " ; +0x28"
        elif "+ 0x48" in op:
            mark = " ; UI+0x48"
        elif "0x12" in op:
            mark = " ; cat18"
        elif "0x18" in op and "sub" in ins.mnemonic:
            mark = " ; cat-24?"
        out.append(
            {
                "addr": f"0x{ins.address:06X}",
                "mnemonic": ins.mnemonic,
                "op": ins.op_str,
                "mark": mark,
            }
        )
    return out


def scan_cmp_field_34(data: bytes) -> list[int]:
    """cmp word ptr [reg+34h] 系。"""
    hits = []
    for pat in (bytes([0x83, 0x7F, 0x34]), bytes([0x39, 0x47, 0x34]), bytes([0x3B, 0x47, 0x34])):
        p = 0
        while True:
            i = data.find(pat, p)
            if i < 0:
                break
            hits.append(i)
            p = i + 1
    return sorted(set(hits))[:30]


def main() -> None:
    if not CBE_PATH.is_file():
        raise SystemExit(f"CBE not found: {CBE_PATH}")

    cbe = CBE_PATH.read_bytes()
    stats = json.loads(STATS.read_text(encoding="utf-8"))
    names = json.loads(NAMES.read_text(encoding="utf-8"))
    by = {r["cbeNameIndex"]: r for r in stats}

    def n(i: int) -> str:
        return names.get(str(i), f"#{i}")

    # --- M9 RL ammo correction ---
    w27 = by.get(27, {})
    m9_slots = w27.get("ammo_indices") or []
    rocket_ammo = []
    for ai in [242, 243, 244, 245]:
        r = by.get(ai)
        if r:
            rocket_ammo.append(
                {
                    "idx": ai,
                    "name": r["name"],
                    "cat": r.get("category_code"),
                    "linked_weapons": [
                        x["cbeNameIndex"]
                        for x in stats
                        if ai in (x.get("ammo_indices") or []) and x.get("category_code", 99) <= 17
                    ],
                }
            )

    # +0x34 (u16[26]) non-zero — MG↔ammobox / tripod links
    field34_links = []
    for r in stats:
        wi = r["cbeNameIndex"]
        off = 0x1DDF00 + wi * 64
        if off + 64 > len(cbe):
            continue
        rec = cbe[off : off + 64]
        u = [struct.unpack_from("<H", rec, i)[0] for i in range(0, 64, 2)]
        if not u[26]:
            continue
        tgt = u[26]
        tr = by.get(tgt, {})
        field34_links.append(
            {
                "idx": wi,
                "name": r["name"],
                "cat": r.get("category_code"),
                "u26_field34": u[26],
                "target_name": n(tgt),
                "target_cat": tr.get("category_code"),
                "ammo_indices": [x for x in [u[22], u[23], u[24], u[25]] if x],
                "ammo_names": [n(x) for x in [u[22], u[23], u[24], u[25]] if x],
            }
        )
    field34_links.sort(key=lambda x: (x["cat"] or 99, x["idx"]))

    # ammo_box rows (for cross-ref)
    mg_samples = []
    for r in stats:
        if r.get("category_code") != 13:
            continue
        wi = r["cbeNameIndex"]
        off = 0x1DDF00 + wi * 64
        if off + 64 > len(cbe):
            continue
        rec = cbe[off : off + 64]
        u = [struct.unpack_from("<H", rec, i)[0] for i in range(0, 64, 2)]
        if u[22]:
            mg_samples.append(
                {
                    "idx": wi,
                    "name": r["name"],
                    "cat": r.get("category_code"),
                    "u26_field34": u[26],
                    "ammo_names": [n(x) for x in [u[22], u[23], u[24], u[25]] if x],
                }
            )

    # cat24 items in weapon slots
    cat24_in_weapons = []
    for r in stats:
        if r.get("category_code", 99) > 17:
            continue
        for ai in r.get("ammo_indices") or []:
            ar = by.get(ai)
            if ar and ar.get("category_code") == 24:
                cat24_in_weapons.append(
                    {"weapon": r["cbeNameIndex"], "weaponName": r["name"], "aux": ai, "auxName": n(ai)}
                )

    loop_34 = disasm(cbe, 0x46CC0, 0xC0)
    cat_branch = disasm(cbe, 0x771E, 0xA8)
    cmp34_hits = scan_cmp_field_34(cbe)

    summary = {
        "generated": date.today().isoformat(),
        "m9rl_slots": m9_slots,
        "m9rl_slot_names": [n(x) for x in m9_slots],
        "cmp_field_34_hits": len(cmp34_hits),
    }

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(
        json.dumps(
            {
                "summary": summary,
                "rocket_ammo_rows": rocket_ammo,
                "field34_weapon_links": field34_links,
                "ammo_box_rows": mg_samples[:25],
                "cat24_weapon_slots": cat24_in_weapons,
                "disasm_46CD4": loop_34,
                "disasm_771E": cat_branch,
                "cmp34_file_offsets": [hex(x) for x in cmp34_hits],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    lines = [
        "# CBE 副装備 UI — +0x34 ループ / cat=24 分岐",
        "",
        f"**生成**: {summary['generated']} — `python scripts/re_cbe_aux_ui_disasm.py`",
        "",
        "## M9 RL 弾薬（訂正）",
        "",
        f"| M9 RL(27) CBE slots | `{summary['m9rl_slot_names']}` |",
        "",
        "| idx | 名称 | cat | この弾をスロットに持つ武器 |",
        "|-----|------|-----|---------------------------|",
    ]
    for row in rocket_ammo:
        hosts = ", ".join(f"{h}={n(h)}" for h in row["linked_weapons"][:6]) or "—"
        lines.append(f"| {row['idx']} | {row['name']} | {row['cat']} | {hosts} |")

    lines.extend(
        [
            "",
            "**史実**: M9 RL（バズーカ）→ **M6A1 HR / M6A5 HR**（PL 表記。M6A3 は CBE 上 **M6A5 HR(243)**）。",
            "",
            "CBE 上 M9 RL(27) スロットは **`[244 M9A1 RfG, 243 M6A5 HR]`** — 244 はライフルグレネード行で **データ上の異常候補**（243/242 がロケット正本）。",
            "242 M6A1 HR 行は逆リンク `[27=M9 RL, …]` を持つ。",
            "",
            "## `@ 0x46CD4` — +0x34 走査（MG 予備弾/弾薬箱候補）",
            "",
            "装備関数 `@ 0x46C00` 内。**条件**: 武器コピー `[bp-8]` で **`+0x34 ≠ 0` かつ `+0x28 == 0`** のときのみ。",
            "UI 構造体 `[bp+6]+0x48` から **8 バイト stride × 最大 3 エントリ**（di=1..2）を走査し、",
            "各エントリ u16 を `[si+0x34]` と照合 → 一致列を `[bp+6]+0x40+di×8` に反映、`[si+0x28]` を更新。",
            "",
            "```asm",
        ]
    )
    for ins in loop_34:
        if ins["mark"] or ins["mnemonic"] in ("cmp", "je", "jne", "loop", "jl", "jle"):
            lines.append(f"{ins['addr']}  {ins['mnemonic']:6s} {ins['op']}{ins['mark']}")

    lines.extend(
        [
            "```",
            "",
            "**解釈**: レコード **+0x34 (u16[26])** = **予備リンク index**（MG→弾薬箱、三脚、観測鏡等）。",
            "CBE 4 スロット外。`@ 0x46CD4` は UI 側 `[+0x48]` 列と照合して装備 UI に反映。",
            "",
            "### u16[26] ≠ 0 の武器（+0x34 リンク先）",
            "",
            "| 武器 | cat | u26→ | 先 cat | CBE ammo 4スロット |",
            "|------|-----|------|--------|-------------------|",
        ]
    )
    for s in field34_links:
        lines.append(
            f"| {s['name']} ({s['idx']}) | {s['cat']} | {s['u26_field34']}={s['target_name']} | "
            f"{s['target_cat']} | {', '.join(s['ammo_names']) or '—'} |"
        )

    lines.extend(
        [
            "",
            "### ammo_box 行（cat=13）— 内包弾",
            "",
            "| idx | 名称 | u26 | 内包弾 |",
            "|-----|------|-----|--------|",
        ]
    )
    for s in mg_samples[:12]:
        lines.append(
            f"| {s['idx']} | {s['name']} | {s['u26_field34']} | {', '.join(s['ammo_names']) or '—'} |"
        )

    lines.extend(
        [
            "",
            f"バイナリ内 `cmp [+0x34]` パターン: **{len(cmp34_hits)}** 箇所（先頭: {', '.join(hex(x) for x in cmp34_hits[:5]) or '—'}）",
            "",
            "## `@ 0x771E` — category 分岐（cat18 vs cat24）",
            "",
            "```",
            "target_index → shl 6 → レコード取得",
            "category - 0x12 == 0  → cat 18: ammo_indices[+0x2C..+0x32] **4スロット**ループ",
            "category - 0x18 == 0  → cat 24: **cmp [record+0x32], target** のみ（第4 u16 単独）",
            "else → skip",
            "```",
            "",
            "```asm",
        ]
    )
    for ins in cat_branch:
        if ins["mark"] or "0x77" in ins["addr"]:
            lines.append(f"{ins['addr']}  {ins['mnemonic']:6s} {ins['op']}{ins['mark']}")

    lines.extend(
        [
            "```",
            "",
            "**cat=24**: 主装填 UI とは **別分岐**（`+0x32` フィールド照合）。Messer/S84/92 等の付属スロット。",
            "cat18 は **4 u16 ループ**（+0x2C..+0x32）、cat24 は **+0x32 単独 cmp** — 銃剣は第4スロット専用。",
            "",
            "### 武器 ammo_indices 内の cat=24 行",
            "",
            "| 武器 | 付属 (cat=24) |",
            "|------|---------------|",
        ]
    )
    for row in cat24_in_weapons[:20]:
        lines.append(f"| {row['weaponName']} ({row['weapon']}) | {row['auxName']} ({row['aux']}) |")
    if len(cat24_in_weapons) > 20:
        lines.append(f"| … | +{len(cat24_in_weapons) - 20} more |")

    lines.extend(
        [
            "",
            "## 関連",
            "",
            "- [PL_CBE_UI_TABLE_RE.md](./PL_CBE_UI_TABLE_RE.md) — +0x48 列構築 / equip_ui 構造体",
            "- [PL_AUX_EQUIPMENT.md](./PL_AUX_EQUIPMENT.md)",
            "- [PL_CBE_AMMO_FILTER_RE.md](./PL_CBE_AMMO_FILTER_RE.md)",
            "",
        ]
    )

    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT_MD.relative_to(ROOT)}")
    print(f"M9 RL slots: {summary['m9rl_slot_names']}")


if __name__ == "__main__":
    main()

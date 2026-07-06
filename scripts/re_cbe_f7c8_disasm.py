# -*- coding: utf-8 -*-
"""
CBE RE: 0xF7C8 UI リスト列構築 / 0x4240C 小隊候補走査 / 名称プール。

実行: python scripts/re_cbe_f7c8_disasm.py
出力:
  docs/PL_CBE_F7C8_RE.md
  scripts/pl_decoded/cbe_f7c8_re.json
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
CBE = PL / "CBE.EXE"
OUT_MD = ROOT / "docs" / "PL_CBE_F7C8_RE.md"
OUT_JSON = ROOT / "scripts" / "pl_decoded" / "cbe_f7c8_re.json"
NAME_POOL_LO = 0x2170EC  # M1911A1 = cbe0 — pool_idx == cbe_idx
NAME_POOL_HI = 0x218800

COL_IDS = [
    ("0x4C4", 0x40, "col0 — ui+0x40"),
    ("0x4C6", 0x48, "col1 — ui+0x48 (+0x34 走査入力)"),
    ("0x4C7", 0x50, "col2 — ui+0x50"),
    ("0x4C8", 0x58, "col3 — ui+0x58"),
]
COL_LABEL_OFF = [0x4DB, 0x4DD, 0x4DF, 0x4E1]  # push before each F7C8 @ 0xECCF


def disasm(data: bytes, start: int, size: int) -> list[dict]:
    md = Cs(CS_ARCH_X86, CS_MODE_16)
    out = []
    for ins in md.disasm(data[start : start + size], start):
        op = ins.op_str.lower()
        mark = ""
        for key, tag in (
            ("+ 0xa4", "+0xA4 mask"),
            ("+ 0xba", "+0xBA ctr"),
            ("+ 0x3e", "+0x3E idx"),
            ("+ 0x8a", "+0x8A"),
            ("+ 0x28", "+0x28"),
            ("+ 0x48", "+0x48"),
            ("+ 0x40", "+0x40"),
            ("0x8c00", "type"),
            ("call", "call"),
            ("lcall", "lcall"),
        ):
            if key in op or (key == "call" and ins.mnemonic == "call"):
                mark = f" ; {tag}"
                break
        out.append(
            {
                "addr": f"0x{ins.address:06X}",
                "mnemonic": ins.mnemonic,
                "op": ins.op_str,
                "mark": mark,
            }
        )
    return out


def parse_name_pool(data: bytes) -> list[dict]:
    names: list[dict] = []
    p = NAME_POOL_LO
    idx = 0
    while p < NAME_POOL_HI:
        e = data.find(b"\x00", p, p + 80)
        if e < 0:
            p += 1
            continue
        if e > p:
            raw = data[p:e]
            try:
                t = raw.decode("ascii")
            except UnicodeDecodeError:
                t = ""
            if t and 1 <= len(t) <= 50 and all(0x20 <= ord(c) < 0x7F for c in t):
                names.append({"pool_idx": idx, "file_off": p, "name": t})
                idx += 1
        p = e + 1
    return names


def aux_pool_entries(names: list[dict]) -> list[dict]:
    keys = ("Tripod", "Ammobox", "Binocular", "PatrK", "Laf", "Messer", "Byt")
    return [n for n in names if any(k in n["name"] for k in keys)]


def main() -> None:
    if not CBE.is_file():
        raise SystemExit(f"CBE not found: {CBE}")

    data = CBE.read_bytes()
    f7c8 = disasm(data, 0xF7C8, 0x140)
    f6c6 = disasm(data, 0xF6C6, 0xA0)
    col_build = disasm(data, 0xECB0, 0x80)
    squad_scan = disasm(data, 0x4240C, 0x120)
    squad_filter = disasm(data, 0x424B0, 0x60)
    validate = disasm(data, 0x422B8, 0x80)
    name_pool = parse_name_pool(data)
    aux = aux_pool_entries(name_pool)

    summary = {
        "generated": date.today().isoformat(),
        "name_pool_count": len(name_pool),
        "aux_pool_count": len(aux),
    }

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(
        json.dumps(
            {
                "summary": summary,
                "column_ids": COL_IDS,
                "column_label_offsets": [hex(x) for x in COL_LABEL_OFF],
                "disasm_f7c8": f7c8,
                "disasm_f6c6": f6c6,
                "disasm_col_build": col_build,
                "disasm_squad_scan": squad_scan,
                "disasm_squad_filter": squad_filter,
                "disasm_422b8": validate,
                "aux_name_pool": aux[:40],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    lines = [
        "# CBE `@ 0xF7C8` — UI リスト列 / 小隊候補走査",
        "",
        f"**生成**: {summary['generated']} — `python scripts/re_cbe_f7c8_disasm.py`",
        "",
        "**正本**: CBE RE。攻略本 [PL_MANUAL_WEAPON_LIST_REF.md](./PL_MANUAL_WEAPON_LIST_REF.md) は一致時の安心材料のみ。",
        "",
        "## 概要",
        "",
        "装備画面で `equip_ui` の **+0x40/+0x48/+0x50/+0x58** 列（8B stride エントリ）を構築する。",
        "`@ 0x46CD4` の +0x34 走査は **ui+0x48 列**（col1）を読む。",
        "",
        "### 列ビルド `@ 0xECCF`（4 回 `call 0xF7C8`）",
        "",
        "| リソース ID | ui オフセット | 役割 |",
        "|-------------|---------------|------|",
    ]
    for cid, off, note in COL_IDS:
        lines.append(f"| `{cid}` | +0x{off:02X} | {note} |")

    lines.extend(
        [
            "",
            "各呼び出し: `push label_id; push ds; push fmt_ptr; push ui+col; push equip_ui; call 0xF7C8`",
            "",
            "## `@ 0xF7C8` — リスト列ポインタ `[bp+0xA]`",
            "",
            "```c",
            "// retf 0xE — 7 words args",
            "void ui_build_column(equip_ui *ui, void *col_base /*ui+0x40|0x48|…*/,",
            "                     fmt_desc *desc /*ds:0x4DB etc*/, u16 resource_id);",
            "if (desc->enabled == 0) { empty_column(); return; }",
            "type = desc->word_at_2;",
            "if (type == 0x8C00) { /* 特殊: 固定文字列 @ ds:0x56E */ }",
            "else {",
            "  compose_label(desc, flags);  // ds:0x577/0x57C/0x581…",
            "  sprintf(buf, fmt[desc->index_at_6], …);  // fmt @ 0x590|0x592|0x596",
            "  lcall … populate list → col_base 8B entries",
            "}",
            "lcall … merge into ui widget",
            "```",
            "",
            "**8B エントリ**（`@ 0x46CD4` 側）:",
            "",
            "```",
            "[+0] u16 link_index  — weapon.u16[26]; cmp @ 0x46D01",
            "[+4] u16 state_value — → weapon.+0x28 @ 0x46D37",
            "```",
            "",
            "F7C8 自身は **表示文字列＋リスト UI** を組み立て、link_index の直接書込は下位 lcall（`0x105A` / `0xD47` 系、seg:off 実行時解決）側。",
            "",
            "### 主要逆アセンブル",
            "",
            "```asm",
        ]
    )
    for ins in f7c8:
        if ins["mark"] or ins["mnemonic"] in ("cmp", "je", "jne", "call", "lcall", "mov"):
            lines.append(f"{ins['addr']}  {ins['mnemonic']:6s} {ins['op']}{ins['mark']}")

    lines.extend(
        [
            "```",
            "",
            "## `@ 0x4240C` — 小隊ロスター → 候補 index 列",
            "",
            "ミッション小隊 `es:[0xAD20]` + `(member_index << 9)` で各員レコードを走査。",
            "",
            "```c",
            "mask = (roster_slot + 1);  // lea ax,[si+1]",
            "for each candidate_item_index in mission_table:",
            "  member = squad[member_index];",
            "  if (member.u16[20] == roster_slot) skip;     // +0x28",
            "  if (!(member.u16[0xA4] & mask)) skip;        // スロット bitmask",
            "  if (member.u16[0xBA] != 0) skip;             // 割当済みカウンタ",
            "  if (!validate_422B8(member, ui)) skip;",
            "  output_list.push(member.u16[0x3E]);           // cbe item index",
            "  member.u16[0xBA]++;",
            "output_list.push(0xFFFF);",
            "```",
            "",
            "### フィルタ `@ 0x424B1`",
            "",
            "```asm",
        ]
    )
    for ins in squad_filter:
        if ins["mark"] or ins["mnemonic"] in ("cmp", "test", "je", "jne", "call"):
            lines.append(f"{ins['addr']}  {ins['mnemonic']:6s} {ins['op']}{ins['mark']}")

    lines.extend(
        [
            "```",
            "",
            "**+0xA4**: 装備スロット可用 **bitmask**（`test [member+0xA4], (slot+1)`）。",
            "**+0xBA**: 列ごとの割当 **カウンタ**（重複防止）。",
            "**+0x3E**: 出力する **cbe item index**（名称は別プール参照）。",
            "",
            "## 名称プール `@ 0x217000`（表示用）",
            "",
            f"連続 null 終端 ASCII 文字列 **{len(name_pool)}** 件。",
            "**pool_idx == cbeNameIndex** @ 0x2170EC（旧 0x216E00 誤パースを訂正）。",
            "",
            "### 副装備関連（攻略本と一致 — 安心材料）",
            "",
            "| pool# | 名称 |",
            "|-------|------|",
        ]
    )
    for n in aux[:25]:
        lines.append(f"| {n['pool_idx']} | {n['name']} |")

    lines.extend(
        [
            "",
            "攻略本: M1919→M1 Ammobox+M1917 Tripod、M2 HB→M2 Ammobox+M3 Tripod。",
            "CBE u16[26]: M1919→35 M2HB Ammobox、M2 HB→36 **M3 Binocular**（表記/リンク差 — CBE 正本）。",
            "",
            "## 未完了",
            "",
            "1. **pool_idx → cbe index** 変換テーブル — [PL_CBE_EQUIP_CHAIN_RE.md](./PL_CBE_EQUIP_CHAIN_RE.md)",
            "2. `ds:0x4DB` 等 **列ラベル文字列** の CP932 デコード（フォーマット記述子）",
            "",
            "**確定済み** → [PL_CBE_EQUIP_CHAIN_RE.md](./PL_CBE_EQUIP_CHAIN_RE.md):",
            "- +0xA4 bitmask = (roster_slot+1)",
            "- `@ 0x46866` 8B 書込",
            "- 三脚 = col2 (ui+0x50), 弾薬箱 = col1 (ui+0x48)",
            "",
            "## 関連",
            "",
            "- [PL_CBE_UI_TABLE_RE.md](./PL_CBE_UI_TABLE_RE.md)",
            "- [PL_CBE_AUX_UI_RE.md](./PL_CBE_AUX_UI_RE.md)",
            "- [PL_MANUAL_WEAPON_LIST_REF.md](./PL_MANUAL_WEAPON_LIST_REF.md)",
            "",
        ]
    )

    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT_MD.relative_to(ROOT)}")
    print(f"name pool: {len(name_pool)}, aux: {len(aux)}")


if __name__ == "__main__":
    main()

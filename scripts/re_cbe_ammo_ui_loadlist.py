# -*- coding: utf-8 -*-
"""
CBE RE: 装填 UI リスト — @ 0x1805A からのトレース。

0x1805A は「リスト構築」ではなく mag_type ゲート付き **スロット検索** の入口。
リスト本体は +0xCE/+0xD0 先（+0x40 基準・8B stride）— 構築は 0xF7C8 / 0xECCF 系。

実行: python scripts/re_cbe_ammo_ui_loadlist.py
出力:
  docs/PL_CBE_AMMO_UI_LOADLIST_RE.md
  scripts/pl_decoded/cbe_ammo_ui_loadlist_re.json
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
OUT_MD = ROOT / "docs" / "PL_CBE_AMMO_UI_LOADLIST_RE.md"
OUT_JSON = ROOT / "scripts" / "pl_decoded" / "cbe_ammo_ui_loadlist_re.json"

FUNCTIONS = [
    {
        "id": "ammo_ui_find_slot_by_list",
        "file_off": 0x1804E,
        "name": "ammo_ui_find_slot_by_list",
        "summary": "装填リスト（+0xCE 先 +0x40）を 8B×最大7 走査。0x1805A=w21==0 なら 0xFFFF",
    },
    {
        "id": "ammo_ui_find_slot_by_column",
        "file_off": 0x180B4,
        "name": "ammo_ui_find_slot_by_column",
        "summary": "列 index 0..6 を 0x180FA+lcall で直接試行（リスト中身未参照）",
    },
    {
        "id": "ammo_ui_column_string",
        "file_off": 0x180FA,
        "name": "ammo_ui_column_string",
        "summary": "列 index → 文字列/リソース ptr（dx<3 vs >=3 で si ベース切替）",
    },
    {
        "id": "ammo_ui_precheck",
        "file_off": 0x18166,
        "name": "ammo_ui_precheck",
        "summary": "0x1804E 直前 — es:[0xa264]+0x32 と weapon ptr 照合 + lcall 検証",
    },
    {
        "id": "equip_ui_ammo_refresh",
        "file_off": 0x178A0,
        "name": "equip_ui_ammo_refresh",
        "summary": "装備 UI 更新 — 18166→1804E→+0xE6 書込→選択行表示",
    },
    {
        "id": "ui_list_populate_f7c8",
        "file_off": 0xF7C8,
        "name": "ui_list_populate_f7c8",
        "summary": "文字列 ID → UI 列バッファ（equip_ui +0x40/+0x48…）— リスト構築正本候補",
    },
]

XREF_CALLS = [
    (0x179A0, 0x18166, "equip_ui_ammo_refresh → precheck"),
    (0x179B2, 0x1804E, "equip_ui_ammo_refresh → find_slot_by_list"),
    (0x17C3E, 0x180B4, "ammo picker handler → find_slot_by_column"),
    (0x17EAF, 0x180B4, "secondary equip path → find_slot_by_column"),
    (0x185BD, 0x180B4, "list row iterator → find_slot_by_column"),
]


def parse_ne(data: bytes) -> list[dict]:
    ne = struct.unpack_from("<I", data, 0x3C)[0]
    align = 1 << struct.unpack_from("<H", data, ne + 0x32)[0]
    n = struct.unpack_from("<H", data, ne + 0x1C)[0]
    sa = ne + struct.unpack_from("<H", data, ne + 0x22)[0]
    segs = []
    for i in range(n):
        o = sa + i * 8
        raw, ln, fl, _ = struct.unpack_from("<HHHH", data, o)
        start = raw * align
        segs.append(
            {
                "seg_num": i + 1,
                "file_start": start,
                "file_end": start + (ln if ln else 65536),
                "is_code": (fl & 1) == 0,
            }
        )
    return segs


def file_to_seg(segs: list[dict], file_off: int) -> str:
    for s in segs:
        if s["file_start"] <= file_off < s["file_end"]:
            return f"seg{s['seg_num']}:+{file_off - s['file_start']:X}"
    return "?"


def disasm(data: bytes, start: int, size: int) -> list[dict]:
    md = Cs(CS_ARCH_X86, CS_MODE_16)
    out = []
    for ins in md.disasm(data[start : start + size], start):
        op = ins.op_str.lower()
        mark = ""
        for key, tag in (
            ("+ 0x2a", "w21/mag_type"),
            ("+ 0x36", "u27"),
            ("+ 0x28", "+0x28"),
            ("+ 0x2c", "ammo_slot"),
            ("+ 0xce", "list_ptr"),
            ("+ 0xd0", "list_ptr_hi"),
            ("+ 0xe6", "slot_idx"),
            ("+ 0xcc", "+0xCC"),
        ):
            if key in op:
                mark = f" ; {tag}"
                break
        if ins.mnemonic in ("call", "lcall", "retf", "enter", "leave"):
            mark = (mark or "") + " ; **"
        out.append(
            {
                "addr": f"0x{ins.address:06X}",
                "mnemonic": ins.mnemonic,
                "op": ins.op_str,
                "mark": mark.strip(),
            }
        )
    return out


def find_near_calls(data: bytes, target: int, lo: int = 0x8000, hi: int = 0x60000) -> list[int]:
    refs = []
    for addr in range(lo, hi):
        if data[addr] != 0xE8:
            continue
        rel = struct.unpack_from("<h", data, addr + 1)[0]
        if addr + 3 + rel == target:
            refs.append(addr)
    return refs


def pseudo_find_slot_by_list() -> str:
    return """\
// @ 0x1804E — retf 8 — weapon_row @ (es:bp+6), ctx @ bp+0xA
if (weapon_row[+0x2A] == 0)          // @ 0x1805A
    return 0xFFFF;                   // mag_type 無制限（全スロット可?）
list = weapon_row[+0xCE];            // far ptr
es   = weapon_row[+0xD0];
si   = list + 0x40;                  // 第1エントリ
for (di = 0; di < 7; di++) {
    if ([es:si] == 0) { si += 8; continue; }
    ax,dx = ammo_ui_column_string(ctx, di);   // call 0x180FA
    if (lcall_match(0x9858, weapon, ax,dx, ctx))  // 要 fixup 解決
        return di;
    si += 8;
}
return 0xFFFF;"""


def pseudo_find_slot_by_column() -> str:
    return """\
// @ 0x180B4 — リスト中身を見ず列 0..6 を試す
if (weapon_row[+0x2A] == 0)
    return 0xFFFF;
for (si = 0; si < 7; si++) {
    ax,dx = ammo_ui_column_string(ctx, si);
    if (lcall_match(0x9698, weapon, ax,dx, ctx))
        return si;
}
return 0xFFFF;"""


def pseudo_equip_refresh() -> str:
    return """\
// @ 0x178A0 enter 0x26 — 装備 UI 行更新（game state gate @ 0x1796A）
if (es:[0xAD32]!=4 || es:[0x178]!=1) goto fail;
if (weapon[+0xCE]==0 && weapon[+0xD0]==0) goto fail;
if (!ammo_ui_precheck(weapon)) goto fail;          // 0x18166
slot = ammo_ui_find_slot_by_list(weapon, ctx);     // 0x1804E @ 0x179B2
weapon[+0xE6] = slot;
if (slot < 0) goto fail;                           // 0xFFFF → jl
// slot → UI 行アドレス: (slot<<3) + weapon[+0xCE] + 0x40  @ 0x179EF
// → 名称表示 lcall 0x9198 / 0x91BC / 0x923D"""


def main() -> None:
    if not CBE_PATH.is_file():
        raise SystemExit(f"CBE not found: {CBE_PATH}")

    data = CBE_PATH.read_bytes()
    segs = parse_ne(data)

    fn_docs = []
    for fn in FUNCTIONS:
        size = 0x120 if fn["file_off"] == 0x178A0 else 0xB0
        fn_docs.append(
            {
                **fn,
                "seg": file_to_seg(segs, fn["file_off"]),
                "xrefs": [
                    {"from": hex(a), "note": n}
                    for a, t, n in XREF_CALLS
                    if t == fn["file_off"]
                ]
                or [{"from": hex(a)} for a in find_near_calls(data, fn["file_off"])],
                "disasm": disasm(data, fn["file_off"], size),
            }
        )

    payload = {
        "generated": date.today().isoformat(),
        "anchor": "0x1805A",
        "conclusion": (
            "0x1805A is mag_type gate inside ammo_ui_find_slot_by_list; "
            "list BUILD is upstream (0xF7C8/0xECCF). "
            "Match fns lcall 0x9858/0x9698 need NE fixup resolution."
        ),
        "weapon_row_offsets": {
            "+0x2A": "mag_type w21 — gate @ 0x1805A",
            "+0xCE/+0xD0": "far ptr → loadout list blob",
            "+0xE6": "selected slot index (written @ 0x179B8)",
            "+0xCC": "from table[0x16]+0x42 @ 0x179DA",
            "+0x14": "cbe index (push to resolve)",
            "list_entry": "+0x40 + slot*8: [+0]=link?, [+4]=state?",
        },
        "functions": fn_docs,
        "xrefs": [
            {"from": hex(a), "to": hex(t), "note": n} for a, t, n in XREF_CALLS
        ],
        "open_questions": [
            "lcall 0,0x9858 / 0,0x9698 の実アドレス（NE fixup / ITEML）",
            "weapon_row +0xCE リストを誰が構築するか（0xECCF→0xF7C8 との接続）",
            "lcall_match 内部 — mag_type 0x18BF3 / u27 / cap 照合の有無",
            "272 (7.92-5) が ammo_indices 無しで UI に出る経路",
        ],
    }

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# CBE 装填 UI リスト — `@ 0x1805A` トレース",
        "",
        f"**生成**: {payload['generated']} — `python scripts/re_cbe_ammo_ui_loadlist.py`",
        "",
        "## 結論（このセッション）",
        "",
        "**0x1805A は装填リスト構築の入口ではない。**",
        "",
        "```",
        "if (weapon_row[+0x2A] == 0)  // w21 / mag_type",
        "    return 0xFFFF;            // → 「制限なし」側へ",
        "else",
        "    walk list at weapon[+0xCE] + 0x40  (8 bytes × max 7)",
        "```",
        "",
        "| フェーズ | 関数 (file) | 役割 |",
        "|---------|-------------|------|",
        "| **リスト構築** | `0xF7C8` ← `0xECCF` | 文字列 ID 0x4C4/4C6/4C7… → UI 列 |",
        "| **スロット検索 A** | `0x1804E` (**0x1805A** 内) | 構築済みリスト走査 + `lcall 0x9858` |",
        "| **スロット検索 B** | `0x180B4` | 列 0..6 直試行 + `lcall 0x9698` |",
        "| **装備 UI 反映** | `0x178A0` | precheck → find → `weapon[+0xE6]` → 名称描画 |",
        "",
        "→ **cap 照合・272 問題の本体は `lcall 0x9858` / `0x9698` 先**（未解決）。",
        "",
        "## ランタイム `weapon_row` オフセット（装填 UI 行）",
        "",
        "> 64B CBE テーブル行そのものではない（+0xCE=206 byte）。`equip_ui` 拡張ワーク。",
        "",
        "| オフセット | 役割 | 根拠 |",
        "|-----------|------|------|",
        "| +0x2A | mag_type (w21) | @ 0x1805A cmp |",
        "| +0xCE / +0xD0 | 装填リスト far ptr | @ 0x18061, 0x17997 |",
        "| +0xE6 | 選択スロット index | @ 0x179B8 書込 |",
        "| +0xCC | 表示用フィールド | @ 0x179DA |",
        "| +0x14 | cbe index | push @ 0x17945 |",
        "",
        "### リストエントリ（`list + 0x40 + slot×8`）",
        "",
        "```",
        "[+0] u16 link_index   // 0 ならスキップ @ 0x18078",
        "[+4] u16 state_value // @ 0x185D9 参照",
        "```",
        "",
        "## コールグラフ",
        "",
        "```",
        "0xECCF / 0xF126",
        "  └─ call 0xF7C8          … 列バッファ構築（正本候補）",
        "",
        "0x178A0 equip_ui_ammo_refresh",
        "  ├─ call 0x18166         … precheck",
        "  ├─ call 0x1804E         … find_slot_by_list  ← 0x1805A",
        "  └─ lcall 表示系         … 0x9198 / 0x91BC",
        "",
        "0x17C3E / 0x17EAF / 0x185BD",
        "  └─ call 0x180B4         … find_slot_by_column",
        "```",
        "",
        "## 偽コード",
        "",
        "### `ammo_ui_find_slot_by_list` @ 0x1804E",
        "",
        "```c",
        pseudo_find_slot_by_list().rstrip(),
        "```",
        "",
        "### `ammo_ui_find_slot_by_column` @ 0x180B4",
        "",
        "```c",
        pseudo_find_slot_by_column().rstrip(),
        "```",
        "",
        "### `equip_ui_ammo_refresh` @ 0x178A0（抜粋）",
        "",
        "```c",
        pseudo_equip_refresh().rstrip(),
        "```",
        "",
        "## 逆アセンブル — `@ 0x1805A` 核心",
        "",
        "```asm",
    ]
    for ins in disasm(data, 0x1804E, 0x68):
        lines.append(f"{ins['addr']}  {ins['mnemonic']:6s} {ins['op']}{(' ' + ins['mark']) if ins['mark'] else ''}")
    lines.append("```")
    lines.append("")
    lines.append("## 未確定（次の RE）")
    lines.append("")
    for i, q in enumerate(payload["open_questions"], 1):
        lines.append(f"{i}. {q}")
    lines.append("")
    lines.append("## 関連")
    lines.append("")
    lines.append("- [PL_CBE_UI_TABLE_RE.md](./PL_CBE_UI_TABLE_RE.md) — 0xF7C8 / equip_ui")
    lines.append("- [PL_CBE_AMMO_FILTER_RE.md](./PL_CBE_AMMO_FILTER_RE.md) — cat18 / 0x18BF3")
    lines.append("- [PL_CBE_EQUIP_CHAIN_RE.md](./PL_CBE_EQUIP_CHAIN_RE.md) — 0x4240C ロスター")
    lines.append("- `scripts/pl_decoded/cbe_ammo_ui_loadlist_re.json`")
    lines.append("")

    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT_MD.relative_to(ROOT)}")
    print(f"Wrote {OUT_JSON.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

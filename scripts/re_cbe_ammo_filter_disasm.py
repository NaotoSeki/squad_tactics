# -*- coding: utf-8 -*-
"""
CBE.EXE 装填フィルタ逆引き — Capstone x86-16 部分逆アセンブル。

確定パターン:
  - mag_type +0x2A: weapon == ammo（完全一致）@ file 0x18BF3
  - w21==0: フィルタスキップ @ 0x46C5B, 0x1805A, 0xB440
  - ammo_indices 走査 + category==18 @ 0x771E
  - stride*64: shl reg, 6 @ 複数箇所

実行: python scripts/re_cbe_ammo_filter_disasm.py
出力:
  scripts/pl_decoded/cbe_ammo_filter_re.json
  docs/PL_CBE_AMMO_FILTER_RE.md
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
OUT_JSON = ROOT / "scripts" / "pl_decoded" / "cbe_ammo_filter_re.json"
OUT_MD = ROOT / "docs" / "PL_CBE_AMMO_FILTER_RE.md"

TABLE_FILE = 0x1DDF00

# 命令バイト列（誤検出少）— mod=01 rm=111 → [bx+disp8]
PRECISE_PATTERNS: dict[str, bytes] = {
    "mov_ax_bx_mag42": bytes([0x8B, 0x47, 0x2A]),
    "mov_ax_bx_u27_54": bytes([0x8B, 0x47, 0x36]),
    "mov_ax_bx_ammo44": bytes([0x8B, 0x47, 0x2C]),
    "mov_ax_bx_cat02": bytes([0x8B, 0x47, 0x02]),
    "cmp_bx_mag42_ax": bytes([0x39, 0x47, 0x2A]),
    "cmp_bx_mag42_zero": bytes([0x83, 0x7F, 0x2A, 0x00]),
    "shl_ax_6": bytes([0xC1, 0xE0, 0x06]),
    "shl_di_6": bytes([0xC1, 0xE7, 0x06]),
    "shl_bx_6": bytes([0xC1, 0xE3, 0x06]),
}

# 手動特定のアンカー（逆アセンブル済み）
ANCHORS: list[dict] = [
    {
        "id": "mag_type_pair_cmp",
        "file_off": 0x18BF3,
        "seg_note": "code",
        "summary": "weapon[+0x2A] == ammo[+0x2A] — 不一致なら lcall 0x9DF6 で拒否",
        "pseudo": (
            "ammo = resolve_record(arg_weapon);  // lcall 0x90CC\n"
            "if (weapon->u16[21] != ammo->u16[21]) reject_loadout();"
        ),
        "status": "CONFIRMED",
    },
    {
        "id": "mag_type_zero_skip",
        "file_off": 0x46C5B,
        "summary": "if (record[+0x2A] == 0) je skip — w21=0 なら mag_type ブロック省略",
        "pseudo": "if (weapon_mag_type == 0) goto after_mag_filter;",
        "status": "CONFIRMED",
    },
    {
        "id": "mag_type_zero_skip_ui",
        "file_off": 0x1805A,
        "summary": "UI 装填リスト構築 — w21=0 なら 0xFFFF 返却（制限なし）",
        "status": "CONFIRMED",
    },
    {
        "id": "ammo_index_cat18_scan",
        "file_off": 0x771E,
        "summary": "index<<6; category-0x12==0 → ammo_indices[+0x2C..+0x32] 4スロット走査",
        "pseudo": (
            "rec = table[index << 6];\n"
            "if (rec.category == 18) {\n"
            "  for (slot = 0; slot < 4; slot++)\n"
            "    if (rec.ammo_indices[slot] == target) return slot;\n"
            "} else if (rec.category == 24) { ... +0x32 cmp ... }"
        ),
        "status": "CONFIRMED",
    },
    {
        "id": "record_copy_shl6",
        "file_off": 0x46C31,
        "summary": "shl di,6; rep movsd 16 — CBE 64byte レコード丸ごとコピー",
        "status": "CONFIRMED",
    },
    {
        "id": "mag_type_indirect_table",
        "file_off": 0x46CA0,
        "summary": "w21!=0: di=record[+0x2A]; shl di,6 — 間接テーブル参照（Bren +2 差の説明候補）",
        "pseudo": (
            "if (record.u21 == 0) skip;\n"
            "ext = item_table[record.u21 << 6];  // NOT ammo.mag_type\n"
            "merge ext[+0x12..+0x19] into weapon buffer;"
        ),
        "status": "HYPOTHESIS",
    },
]


def parse_ne(data: bytes) -> tuple[dict, list[dict]]:
    ne = struct.unpack_from("<I", data, 0x3C)[0]
    align = 1 << struct.unpack_from("<H", data, ne + 0x32)[0]
    n = struct.unpack_from("<H", data, ne + 0x1C)[0]
    sa = ne + struct.unpack_from("<H", data, ne + 0x22)[0]
    segs = []
    for i in range(n):
        o = sa + i * 8
        raw, ln, fl, _ = struct.unpack_from("<HHHH", data, o)
        start = raw * align
        length = ln if ln else 65536
        segs.append(
            {
                "seg_num": i + 1,
                "file_start": start,
                "file_end": start + length,
                "is_code": (fl & 1) == 0,
            }
        )
    hdr = {"ne_offset": ne, "align_shift": struct.unpack_from("<H", data, ne + 0x32)[0]}
    return hdr, segs


def file_to_seg_off(segs: list[dict], file_off: int) -> tuple[int, int] | None:
    for s in segs:
        if s["file_start"] <= file_off < s["file_end"]:
            return s["seg_num"], file_off - s["file_start"]
    return None


def disasm_window(data: bytes, file_off: int, before: int = 48, after: int = 64) -> list[dict]:
    lo = max(0, file_off - before)
    md = Cs(CS_ARCH_X86, CS_MODE_16)
    out = []
    for ins in md.disasm(data[lo : file_off + after], lo):
        mark = ""
        if "+ 0x2a" in ins.op_str.lower():
            mark = " ; +42 mag_type"
        elif "+ 0x36" in ins.op_str.lower():
            mark = " ; +54 u27"
        elif "+ 0x2c" in ins.op_str.lower():
            mark = " ; +44 ammo[0]"
        out.append(
            {
                "addr": f"0x{ins.address:06X}",
                "mnemonic": ins.mnemonic,
                "op": ins.op_str,
                "mark": mark,
            }
        )
    return out


def scan_precise(data: bytes, segs: list[dict]) -> dict[str, list[int]]:
    hits: dict[str, list[int]] = {k: [] for k in PRECISE_PATTERNS}
    for s in segs:
        if not s["is_code"]:
            continue
        chunk = data[s["file_start"] : s["file_end"]]
        base = s["file_start"]
        for name, pat in PRECISE_PATTERNS.items():
            p = 0
            while True:
                i = chunk.find(pat, p)
                if i < 0:
                    break
                hits[name].append(base + i)
                p = i + 1
    return hits


def main() -> None:
    if not CBE_PATH.is_file():
        raise SystemExit(f"CBE not found: {CBE_PATH}")

    data = CBE_PATH.read_bytes()
    hdr, segs = parse_ne(data)
    ts = file_to_seg_off(segs, TABLE_FILE)
    hits = scan_precise(data, segs)

    anchor_docs = []
    for a in ANCHORS:
        anchor_docs.append(
            {
                **a,
                "disasm": disasm_window(data, a["file_off"]),
            }
        )

    summary = {
        "generated": date.today().isoformat(),
        "table_file": f"0x{TABLE_FILE:X}",
        "table_seg_off": {"seg": ts[0], "offset": ts[1]} if ts else None,
        "precise_hits": {k: len(v) for k, v in hits.items()},
        "mag_type_rule": "w21==0 → skip; else weapon.u21 == ammo.a21 @ 0x18BF3 (exact)",
        "mag_type_open": "Bren w21=184 vs a21=186 — 0x46CA0 間接テーブル要追跡",
        "u27_rule": "ST 仮説 (wu27==65 || wu27==au27) — CBE 単一 cmp 未特定",
    }

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(
        json.dumps(
            {
                "summary": summary,
                "anchors": anchor_docs,
                "precise_hit_offsets": {k: [hex(x) for x in v[:40]] for k, v in hits.items()},
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    lines = [
        "# CBE.EXE 装填フィルタ逆引き",
        "",
        f"**生成**: {summary['generated']} — `python scripts/re_cbe_ammo_filter_disasm.py`",
        "",
        "## 確定ルール",
        "",
        "### 第3フィルタ mag_type (+0x2A / u16[21])",
        "",
        "```",
        "if (weapon.u21 == 0)",
        "    → mag_type フィルタ適用しない（0x46C5B / 0x1805A / 0xB440）",
        "else",
        "    → weapon.u21 == ammo.a21 必須（0x18BF3 — cmp [bx+2Ah], ax）",
        "       不一致 → lcall 0x9DF6（拒否）",
        "```",
        "",
        "**CBE 逆アセンブル根拠** — `@ file 0x18BF3`:",
        "",
        "```asm",
        "mov     ax, word ptr es:[bx + 0x2a]   ; ammo mag_type",
        "cmp     word ptr es:[bx + 0x2a], ax   ; weapon mag_type",
        "je      pass",
        "lcall   reject_handler                ; 0x9DF6",
        "```",
        "",
        "### 第1フィルタ category (+0x02)",
        "",
        "`@ 0x771E`: `category - 0x12 == 0` → cat **18**（装填候補）のみ ammo_indices 走査。",
        "",
        "### ammo_indices 走査",
        "",
        "`@ 0x771E`: `shl ax, 6` → レコード先頭 + **0x2C..0x32**（4×u16）を target index と照合。",
        "",
        "### stride",
        "",
        "`shl reg, 6` = index × **64** — テーブル @ file `0x1DDF00`（seg "
        f"{ts[0] if ts else '?'}:+{ts[1] if ts else '?'})",
        "",
        "## 未確定 / 要追跡",
        "",
        "| 項目 | 状態 |",
        "|------|------|",
        "| **u27 形状フィルタ** | Thompson 仮説はデータと整合するが、CBE 内単一 cmp 未特定 |",
        "| **Bren w21=184 vs a21=186** | 0x18BF3 完全一致と矛盾 → `@ 0x46CA0` 間接テーブル (`shl di,6` after u21) 要追跡 |",
        "| **7.92-5 (272)** | ammo_indices 未収録 — 別関数/拡張テーブル |",
        "",
        "## アンカー一覧",
        "",
    ]

    for a in ANCHORS:
        so = file_to_seg_off(segs, a["file_off"])
        seg_s = f"seg{so[0]}:+{so[1]:X}" if so else "?"
        lines.append(f"### `{a['id']}` — file `0x{a['file_off']:X}` ({seg_s}) — **{a['status']}**")
        lines.append("")
        lines.append(a["summary"])
        if a.get("pseudo"):
            lines.append("")
            lines.append("```c")
            lines.append(a["pseudo"])
            lines.append("```")
        lines.append("")
        lines.append("```asm")
        for ins in disasm_window(data, a["file_off"], 24, 32):
            lines.append(f"{ins['addr']}  {ins['mnemonic']:6s} {ins['op']}{ins['mark']}")
        lines.append("```")
        lines.append("")

    lines.extend(
        [
            "## 精密パターン出現数",
            "",
            "| パターン | ヒット |",
            "|----------|--------|",
        ]
    )
    for k, v in sorted(hits.items(), key=lambda x: -len(x[1])):
        lines.append(f"| `{k}` | {len(v)} |")

    lines.extend(
        [
            "",
            "## ST への反映",
            "",
            "1. `passes_mag_type`: **w21=0 → True**; else **a21==w21**（0x18BF3 準拠）",
            "2. Bren/MG 等の +2 差 — 間接テーブル解明まで `FEATURE_PL_MAG_TYPE_FILTER` はオフ",
            "3. u27 — 現行 `pl_cbe_mag_shape.js` 仮説を維持",
            "",
            "## 関連",
            "",
            "- [PL_MAG_TYPE_FILTER.md](./PL_MAG_TYPE_FILTER.md)",
            "- [PL_CBE_AMMO_TRUTH.md](./PL_CBE_AMMO_TRUTH.md)",
            "- `scripts/pl_decoded/cbe_ammo_filter_re.json`",
            "",
        ]
    )

    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT_MD.relative_to(ROOT)}")
    print(f"Wrote {OUT_JSON.relative_to(ROOT)}")
    print(f"  mag_type_cmp @ 0x18BF3, zero_skip @ 0x46C5B, cat18_scan @ 0x771E")


if __name__ == "__main__":
    main()

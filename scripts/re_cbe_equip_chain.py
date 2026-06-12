# -*- coding: utf-8 -*-
"""
CBE RE: 装備 UI 連鎖 — F7C8 / 0x46866 8B 書込 / +0xA4 bitmask / 三脚列。

確定アンカー:
  @ 0x4240C — roster_slot → mask=(slot+1); test [member+0xA4]
  @ 0x46866 — 8B エントリ書込 [+0]=link_index, [+4]=state; ret ptr+8
  @ 0x105A (seg5+0x4308) — ui+0x40 列走査, stride 8, cbe index shl 6
  @ 0x46CD4 — ui+0x48 / ui+0x50 の 2 エントリと weapon.u26 照合

実行: python scripts/re_cbe_equip_chain.py
出力:
  docs/PL_CBE_EQUIP_CHAIN_RE.md
  data/pl_cbe_equip_columns.js
  scripts/pl_decoded/cbe_equip_chain_re.json
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
OUT_MD = ROOT / "docs" / "PL_CBE_EQUIP_CHAIN_RE.md"
OUT_JS = ROOT / "data" / "pl_cbe_equip_columns.js"
OUT_JSON = ROOT / "scripts" / "pl_decoded" / "cbe_equip_chain_re.json"

SEG5_BASE = 0x3B4C0
ANCHOR_WRITE_8B = 0x46866
ANCHOR_POPULATE = SEG5_BASE + 0x105A  # file 0x3C51A
ANCHOR_SQUAD = 0x4240C
ANCHOR_U26_SCAN = 0x46CD4

COLS = [
    {"col": 0, "resource_id": 0x4C4, "ui_off": 0x40, "mask_bit": 1, "mask": 0x0001, "kind": "weapon", "note": "主武器 cbe index（スカラー）"},
    {"col": 1, "resource_id": 0x4C6, "ui_off": 0x48, "mask_bit": 2, "mask": 0x0002, "kind": "ammo_box", "note": "弾薬箱 / u26 リンク — 46CD4 entry[0]"},
    {"col": 2, "resource_id": 0x4C7, "ui_off": 0x50, "mask_bit": 3, "mask": 0x0004, "kind": "tripod", "note": "三脚 Laf34 等 — 46CD4 entry[1]"},
    {"col": 3, "resource_id": 0x4C8, "ui_off": 0x58, "mask_bit": 4, "mask": 0x0008, "kind": "optic", "note": "観測鏡 / その他副装備"},
]
COL_LABEL_DS = [0x4DB, 0x4DD, 0x4DF, 0x4E1]

F7C8_CALLEES = [
    (0x105A, "ui_populate_column", "F7C8→lcall — 列項目追加・8B 検証"),
    (0xD47, "ui_list_merge", "リスト表示マージ @ seg5+0xD47"),
    (0xD74, "ui_widget_refresh", "ウィジェット更新"),
]


def parse_ne(data: bytes) -> tuple[dict, list[dict]]:
    ne = struct.unpack_from("<I", data, 0x3C)[0]
    align = 1 << struct.unpack_from("<H", data, ne + 0x32)[0]
    n = struct.unpack_from("<H", data, ne + 0x1C)[0]
    sa = ne + struct.unpack_from("<H", data, ne + 0x22)[0]
    auto_data = struct.unpack_from("<H", data, ne + 0x0E)[0]
    segs = []
    for i in range(n):
        o = sa + i * 8
        raw, ln, fl, _ = struct.unpack_from("<HHHH", data, o)
        start = raw * align
        length = ln if ln else 65536
        segs.append({"seg_num": i + 1, "file_start": start, "file_end": start + length, "is_code": (fl & 1) == 0})
    return {"auto_data_seg": auto_data, "align": align}, segs


def seg5_file(off: int) -> int:
    return SEG5_BASE + off


def disasm(data: bytes, start: int, size: int, *, filter_mark: bool = False) -> list[dict]:
    md = Cs(CS_ARCH_X86, CS_MODE_16)
    tags = (
        ("+ 0xa4", "+0xA4"),
        ("+ 0xba", "+0xBA"),
        ("+ 0x3e", "+0x3E"),
        ("+ 0x34", "+0x34/u26"),
        ("+ 0x28", "+0x28"),
        ("+ 0x48", "+0x48"),
        ("+ 0x50", "+0x50"),
        ("+ 0x40", "+0x40"),
        ("+ 0x4", "+4 state"),
        ("+ 0x8a", "+0x8A"),
    )
    out = []
    for ins in md.disasm(data[start : start + size], start):
        op = ins.op_str.lower()
        mark = ""
        for key, tag in tags:
            if key in op:
                mark = f" ; {tag}"
                break
        if ins.mnemonic in ("call", "lcall", "ret", "retf") and not mark:
            mark = " ; call"
        row = {"addr": f"0x{ins.address:06X}", "mnemonic": ins.mnemonic, "op": ins.op_str, "mark": mark}
        if not filter_mark or mark:
            out.append(row)
    return out


def read_ds_strings(data: bytes, segs: list[dict], auto_data_seg: int) -> list[dict]:
    dseg = None
    for s in segs:
        if s["seg_num"] == auto_data_seg:
            dseg = data[s["file_start"] : s["file_end"]]
            break
    if not dseg:
        return []
    out = []
    for off in COL_LABEL_DS:
        if off >= len(dseg):
            continue
        end = dseg.find(b"\x00", off, off + 64)
        if end < 0:
            end = min(off + 32, len(dseg))
        raw = dseg[off:end]
        try:
            text = raw.decode("cp932")
        except UnicodeDecodeError:
            text = raw.decode("latin-1", errors="replace")
        words = [struct.unpack_from("<H", dseg, off + i)[0] for i in range(0, 8, 2)] if off + 8 <= len(dseg) else []
        out.append({"ds_off": f"0x{off:04X}", "label": text, "header_u16": words})
    return out


def find_callers(data: bytes, target: int) -> list[str]:
    hits = []
    p = 0
    while True:
        i = data.find(bytes([0xE8]), p)
        if i < 0:
            break
        if i + 3 <= len(data):
            rel = struct.unpack_from("<h", data, i + 1)[0]
            t = i + 3 + rel
            if t == target:
                hits.append(f"0x{i:06X}")
        p = i + 1
    return hits


def tripod_audit() -> list[dict]:
    comp_path = ROOT / "data" / "pl_composite_links.json"
    if not comp_path.exists():
        return []
    comp = json.loads(comp_path.read_text(encoding="utf-8"))
    rows = []
    mg_tripod = {91: 112, 92: 112, 93: 112, 94: 113, 22: 32, 23: 32, 24: 31}
    for w in comp.get("weapons") or []:
        wi = w["weaponIdx"]
        if wi not in mg_tripod and not w.get("u26Link"):
            continue
        link = w.get("u26Link") or {}
        rows.append(
            {
                "weaponIdx": wi,
                "weaponName": w.get("weaponName"),
                "u26Idx": link.get("idx"),
                "u26Name": link.get("name"),
                "u26Kind": link.get("kind"),
                "tripodCbeIdx": mg_tripod.get(wi),
                "tripodCol": 2,
            }
        )
    return rows


def write_js(cols: list[dict], anchors: dict) -> None:
    payload = {
        "columns": cols,
        "anchors": anchors,
        "entry8": {"stride": 8, "linkAt": 0, "stateAt": 4, "u26ScanCols": [1, 2]},
        "memberFields": {
            "slotMask": {"off": "0xA4", "rule": "test(mask, roster_slot+1)"},
            "assignCtr": {"off": "0xBA", "rule": "per-column duplicate guard"},
            "itemIdx": {"off": "0x3E", "rule": "cbe index output @ 4240C"},
        },
    }
    lines = [
        "/** CBE 装備 UI 4 列 — 自動生成（手編集しない）",
        " *  regen: python scripts/re_cbe_equip_chain.py",
        " */",
        "(function () {",
        "    'use strict';",
        "    window.PL_CBE_EQUIP_COLUMNS = " + json.dumps(payload, ensure_ascii=False, indent=4) + ";",
        "})();",
        "",
    ]
    OUT_JS.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    if not CBE.is_file():
        raise SystemExit(f"CBE not found: {CBE}")

    data = CBE.read_bytes()
    hdr, segs = parse_ne(data)
    col_labels = read_ds_strings(data, segs, hdr["auto_data_seg"])

    d4240 = disasm(data, ANCHOR_SQUAD, 0x130)
    d_write = disasm(data, ANCHOR_WRITE_8B, 0x30)
    d_u26 = disasm(data, ANCHOR_U26_SCAN, 0x80)
    d_pop = disasm(data, ANCHOR_POPULATE, 0x100, filter_mark=True)
    d467 = disasm(data, 0x46760, 0x60, filter_mark=True)

    callers_46866 = find_callers(data, ANCHOR_WRITE_8B)
    tripod = tripod_audit()

    anchors = {
        "squadScan": f"0x{ANCHOR_SQUAD:06X}",
        "write8B": f"0x{ANCHOR_WRITE_8B:06X}",
        "populate": f"0x{ANCHOR_POPULATE:06X}",
        "u26Scan": f"0x{ANCHOR_U26_SCAN:06X}",
        "f7c8": "0x00F7C8",
        "colBuild": "0x00ECCF",
    }

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(
        json.dumps(
            {
                "generated": date.today().isoformat(),
                "anchors": anchors,
                "columns": COLS,
                "column_labels": col_labels,
                "callers_write8b": callers_46866,
                "tripod_audit": tripod,
                "disasm_4240c": d4240,
                "disasm_write8b": d_write,
                "disasm_u26_scan": d_u26,
                "disasm_populate": d_pop,
                "disasm_467a1": d467,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    write_js(COLS, anchors)

    lines = [
        "# CBE 装備 UI 連鎖 RE — F7C8 / 8B 書込 / +0xA4 / 三脚列",
        "",
        f"**生成**: {date.today().isoformat()} — `python scripts/re_cbe_equip_chain.py`",
        "",
        "## 連鎖（確定）",
        "",
        "```",
        "open 装備画面",
        "  @ 0xECCF  call 0xF7C8 ×4  → ui+0x40/48/50/58",
        "  @ 0x4252C call 0x4240C    → 小隊員候補 ( +0xA4 mask, +0x3E 出力 )",
        "  @ 0x467A1 call 0x46866     → 8B エントリ append",
        "  @ 0x46C00 装備確定",
        "      @ 0x46CD4  weapon.u26 ↔ ui+0x48/+0x50 列照合",
        "```",
        "",
        "## equip_ui レイアウト（修正版）",
        "",
        "| ui+ | 列 | resource | +0xA4 bit | 内容 |",
        "|-----|-----|----------|-----------|------|",
    ]
    for c in COLS:
        lines.append(
            f"| `0x{c['ui_off']:02X}` | {c['col']} | `0x{c['resource_id']:04X}` | bit{c['mask_bit']} | {c['note']} |"
        )

    lines.extend(
        [
            "",
            "**8B エントリ**（col1/col2 — `@ 0x46CD4` が走査）:",
            "",
            "```",
            "[+0] u16 link_index  — weapon.u16[26] (+0x34) と cmp",
            "[+4] u16 state_value  — 一致時 weapon.+0x28 へ",
            "stride 8; entry[0]@+0x48, entry[1]@+0x50",
            "```",
            "",
            "三脚 **Laf34(112)** は u26 ではなく **col2 (ui+0x50)**。",
            "弾薬箱 **PatrK15(116)** は **col1 (ui+0x48)** + weapon.u26。",
            "",
            "## `@ 0x4240C` — +0xA4 bitmask（確定）",
            "",
            "```asm",
            "0x042418  mov    si, word ptr es:[di + 0x28]   ; roster_slot",
            "0x04241C  lea    ax, [si + 1]                  ; mask = slot+1",
            "0x0424BA  test   word ptr es:[si + 0xa4], ax   ; member slot mask",
            "0x0424FC  mov    ax, word ptr [si + 0x3e]      ; cbe index 出力",
            "```",
            "",
            "## `@ 0x46866` — 8B エントリ書込（確定）",
            "",
            f"呼び出し元: `{', '.join(callers_46866) or '—'}`",
            "",
            "```asm",
        ]
    )
    for ins in d_write:
        lines.append(f"{ins['addr']}  {ins['mnemonic']:6s} {ins['op']}{ins['mark']}")

    lines.extend(
        [
            "```",
            "",
            "次エントリ pointer = `bx + 8` (@ 0x468885)。",
            "",
            "## `@ 0x46CD4` — u26 ↔ col1/col2",
            "",
            "```asm",
        ]
    )
    for ins in d_u26:
        if ins["mark"] or ins["mnemonic"] in ("cmp", "je", "add", "mov"):
            lines.append(f"{ins['addr']}  {ins['mnemonic']:6s} {ins['op']}{ins['mark']}")

    lines.extend(
        [
            "```",
            "",
            "ループは **ui+0x48 から最大 2 エントリ** → col1(弾薬箱) + col2(三脚)。",
            "",
            "## `@ 0x105A` (seg5) — populate / 検証",
            "",
            "```asm",
        ]
    )
    for ins in d_pop[:30]:
        lines.append(f"{ins['addr']}  {ins['mnemonic']:6s} {ins['op']}{ins['mark']}")

    lines.extend(
        [
            "```",
            "",
            "`[ui+0x40+n×8]` の word を cbe index として `shl 6` 参照。",
            "",
            "## F7C8 下位 lcall（seg5 解決）",
            "",
            "| seg5+off | file | 役割 |",
            "|---------|------|------|",
        ]
    )
    for off, name, role in F7C8_CALLEES:
        lines.append(f"| `0x{off:04X}` | `0x{seg5_file(off):06X}` | {role} |")

    lines.extend(
        [
            "",
            "列ラベル（DGROUP）:",
            "",
            "| ds:off | label | enabled/type words |",
            "|--------|-------|---------------------|",
        ]
    )
    for cl in col_labels:
        hdr_s = ", ".join(f"0x{w:04X}" for w in cl.get("header_u16") or [])
        lines.append(f"| `{cl['ds_off']}` | {cl.get('label', '')} | {hdr_s} |")

    lines.extend(
        [
            "",
            "## MG 完成形 — CBE マッピング",
            "",
            "| 武器 | col0 主武器 | col1 u26/箱 | col2 三脚(cbe) |",
            "|------|-------------|-------------|----------------|",
        ]
    )
    for tr in tripod[:10]:
        lines.append(
            f"| {tr['weaponName']} ({tr['weaponIdx']}) | — | {tr.get('u26Name')} ({tr.get('u26Idx')}) | "
            f"Laf* ({tr.get('tripodCbeIdx')}) |"
        )

    lines.extend(
        [
            "",
            "## 未完了",
            "",
            "1. **pool_idx → cbe index** — **確定: identity** @ 0x2170EC → [PL_CBE_POOL_CBE_RE.md](./PL_CBE_POOL_CBE_RE.md)",
            "2. `@ 0x422B8` validate — 武器↔副装備互換の完全疑似コード",
            "3. ST ランタイム — `pl_cbe_equip_columns.js` 参照で三脚列合成",
            "",
            "## 関連",
            "",
            "- [PL_CBE_F7C8_RE.md](./PL_CBE_F7C8_RE.md)",
            "- [PL_CBE_UI_TABLE_RE.md](./PL_CBE_UI_TABLE_RE.md)",
            "- [PL_WEAPON_COMPOSITE_LINK.md](./PL_WEAPON_COMPOSITE_LINK.md)",
            "",
        ]
    )

    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT_MD.relative_to(ROOT)}")
    print(f"Wrote {OUT_JS.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

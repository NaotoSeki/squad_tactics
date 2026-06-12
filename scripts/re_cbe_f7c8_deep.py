# -*- coding: utf-8 -*-
"""
CBE RE: 0xF7C8 深掘り — populate / +0xCE 接続 / loadout builder。

実行: python scripts/re_cbe_f7c8_deep.py
出力:
  docs/PL_CBE_F7C8_DEEP_RE.md
  scripts/pl_decoded/cbe_f7c8_deep_re.json
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
OUT_MD = ROOT / "docs" / "PL_CBE_F7C8_DEEP_RE.md"
OUT_JSON = ROOT / "scripts" / "pl_decoded" / "cbe_f7c8_deep_re.json"

SEG5_BASE = 0x3B4C0
F7C8 = 0xF7C8
POPULATE = SEG5_BASE + 0x105A
MERGE = SEG5_BASE + 0xD47

ANCHORS = [
    {
        "id": "f7c8_column_builder",
        "file_off": F7C8,
        "name": "ui_build_column",
        "summary": "fmt_desc チェック → ラベル合成 → lcall populate/merge/refresh",
        "status": "CONFIRMED",
    },
    {
        "id": "populate_seg5",
        "file_off": POPULATE,
        "name": "ui_populate_column",
        "summary": "列エントリ追加 — call 0x3C652 ループ or 単行 CBE 検証 (shl 6, cat+2)",
        "status": "CONFIRMED",
    },
    {
        "id": "populate_cat_check",
        "file_off": 0x3C5A5,
        "name": "populate_cbe_cat_gate",
        "summary": "list[+0x40]+entry → shl 6; cmp word [rec+2], 9 — cat≠9 なら skip",
        "status": "CONFIRMED",
    },
    {
        "id": "weapon_row_ui_init",
        "file_off": 0x2CD00,
        "name": "weapon_row_init_loadout_ui",
        "summary": "+0xCE=0; +0xD2=arg; lcall UI widget create (layout 0x17900c8 等)",
        "status": "CONFIRMED",
    },
    {
        "id": "loadout_list_builder",
        "file_off": 0x3D42A,
        "name": "loadout_ui_build_and_link",
        "summary": "候補 index 列 → mag_type(+0x2A) 照合 → 8B 行構築 → widget ptr を weapon_row へ",
        "status": "CONFIRMED",
    },
    {
        "id": "weapon_row_ptr_copy",
        "file_off": 0x3D68F,
        "name": "weapon_row_link_ui_blob",
        "summary": "widget[+0x20/+0x1e/+0x22] → weapon_row[+0xCE/+0xD0/+0xD2]",
        "status": "CONFIRMED",
    },
    {
        "id": "loadout_orchestrator",
        "file_off": 0x3D1BA,
        "name": "open_loadout_ui_session",
        "summary": "call 0x3D72A → call 0x3D42A — 装填 UI セッション開始",
        "status": "CONFIRMED",
    },
]

OFF_TAGS = (
    ("+ 0xce", "+0xCE"),
    ("+ 0xd0", "+0xD0"),
    ("+ 0xd2", "+0xD2"),
    ("+ 0x2a", "+0x2A"),
    ("+ 0x28", "+0x28"),
    ("+ 0x2c", "+0x2C"),
    ("+ 0x40", "+0x40"),
    ("+ 0x48", "+0x48"),
    ("+ 0x42ea", "+0x42EA"),
)


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
        segs.append(
            {
                "seg_num": i + 1,
                "file_start": start,
                "file_end": start + (ln if ln else 65536),
                "is_code": (fl & 1) == 0,
            }
        )
    return {"auto_data_seg": auto_data}, segs


def tag_op(mnemonic: str, op: str) -> str:
    low = op.lower()
    for key, label in OFF_TAGS:
        if key in low:
            return label
    if mnemonic in ("call", "lcall", "retf"):
        return "call"
    if mnemonic in ("cmp", "test"):
        return "cmp"
    if "shl" in low:
        return "shl"
    return ""


def disasm_range(data: bytes, start: int, size: int, *, marked_only: bool = False) -> list[dict]:
    md = Cs(CS_ARCH_X86, CS_MODE_16)
    out = []
    for ins in md.disasm(data[start : start + size], start):
        mark = tag_op(ins.mnemonic, ins.op_str)
        if marked_only and not mark:
            continue
        out.append(
            {
                "addr": f"0x{ins.address:06X}",
                "mnemonic": ins.mnemonic,
                "op": ins.op_str,
                "mark": f" ; {mark}" if mark else "",
            }
        )
    return out


def scan_field_in_code(data: bytes, segs: list[dict], disp: str) -> list[dict]:
    needle = f"+ 0x{disp}"
    md = Cs(CS_ARCH_X86, CS_MODE_16)
    hits = []
    for s in segs:
        if not s["is_code"]:
            continue
        for ins in md.disasm(data[s["file_start"] : s["file_end"]], s["file_start"]):
            if needle in ins.op_str.lower():
                hits.append(
                    {
                        "addr": f"0x{ins.address:06X}",
                        "mnemonic": ins.mnemonic,
                        "op": ins.op_str,
                    }
                )
    return hits


def find_near_calls(data: bytes, target: int) -> list[str]:
    hits = []
    p = 0
    while True:
        i = data.find(bytes([0xE8]), p)
        if i < 0:
            break
        if i + 3 <= len(data):
            rel = struct.unpack_from("<h", data, i + 1)[0]
            if i + 3 + rel == target:
                hits.append(f"0x{i:06X}")
        p = i + 1
    return hits


def asm_block(rows: list[dict]) -> list[str]:
    return [f"{r['addr']}  {r['mnemonic']:6s} {r['op']}{r['mark']}" for r in rows]


def main() -> None:
    if not CBE_PATH.is_file():
        raise SystemExit(f"CBE not found: {CBE_PATH}")

    data = CBE_PATH.read_bytes()
    _, segs = parse_ne(data)

    ce_refs = scan_field_in_code(data, segs, "ce")
    ce_writes = [r for r in ce_refs if r["mnemonic"] == "mov" and "ptr" in r["op"] and "+ 0xce" in r["op"].lower()]
    f7c8_callers = find_near_calls(data, F7C8)

    payload = {
        "generated": date.today().isoformat(),
        "anchors": ANCHORS,
        "f7c8_callers": f7c8_callers,
        "ce_writes": ce_writes,
        "ce_read_sample": [r for r in ce_refs if r not in ce_writes][:20],
        "disasm_f7c8": disasm_range(data, F7C8, 0x140, marked_only=True),
        "disasm_populate_cat": disasm_range(data, 0x3C580, 0x90, marked_only=True),
        "disasm_ptr_copy": disasm_range(data, 0x3D670, 0x50, marked_only=True),
        "disasm_weapon_init": disasm_range(data, 0x2CD00, 0x80, marked_only=True),
        "disasm_loadout_open": disasm_range(data, 0x3D200, 0x50, marked_only=True),
    }

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# CBE `@ 0xF7C8` 深掘り — populate / +0xCE 接続",
        "",
        f"**生成**: {payload['generated']} — `python scripts/re_cbe_f7c8_deep.py`",
        "",
        "## 結論",
        "",
        "### 1. F7C8 は薄い「列ビルダー」",
        "",
        "`0xECCF` から 4 回呼ばれ、`equip_ui` の **+0x40/+0x48/+0x50/+0x58** を初期化する。",
        "本体ロジックは **`seg5+0x105A` (`0x3C51A`)** の populate — F7C8 はラベル文字列と lcall 3 発のラッパ。",
        "",
        "### 2. 装填リスト (+0xCE) は F7C8 とは別パイプライン",
        "",
        "| パイプライン | 入口 | 出力 |",
        "|-------------|------|------|",
        "| **装備 composite 列** | `0xECCF` → `0xF7C8` | `equip_ui` 8B 列（武器/弾箱/三脚） |",
        "| **装填 UI リスト** | `0x3D1BA` → `0x3D42A` | `weapon_row` **+0xCE/+0xD0/+0xD2** far ptr |",
        "",
        "装填 refresh (`0x178A0`) は **構築済み +0xCE** を読むだけ — **F7C8 を呼ばない**。",
        "",
        "### 3. +0xCE 確定アンカー — `@ 0x3D68F`",
        "",
        "```asm",
        "lcall  … → si = UI widget blob",
        "mov    ax, word ptr es:[si + 0x20]",
        "mov    word ptr es:[bx + 0xce], ax   ; list offset",
        "mov    ax, word ptr es:[si + 0x1e]",
        "mov    word ptr es:[bx + 0xd0], ax   ; list segment",
        "mov    ax, word ptr es:[si + 0x22]",
        "mov    word ptr es:[bx + 0xd2], ax   ; match 用副 ptr",
        "```",
        "",
        "widget 自体は `@ 0x2CD00` で生成（+0xCE ゼロクリア → lcall UI create）。",
        "",
        "### 4. populate 内 CBE ゲート（cat18 ではない）",
        "",
        "`@ 0x3C5A5` — 列エントリ `list+0x40` 走査中:",
        "",
        "```asm",
        "mov    bx, word ptr es:[si]     ; cbe index",
        "shl    bx, 6",
        "cmp    word ptr es:[bx + 2], 9  ; category == 9 のみ通過",
        "cmp    word ptr es:[si + 6], 2  ; entry type >= 2",
        "```",
        "",
        "**cat18 / ammo_indices (`0x771E`) は populate 直 call 無し** — 装填候補の絞り込みは",
        "`0x3D42A` 上流（候補 index 列）か外部 lcall 側。272/cap はここにも cmp 無し。",
        "",
        "### 5. loadout builder `@ 0x3D42A` — mag_type 確定",
        "",
        "```asm",
        "0x03D540  cmp    word ptr es:[di + 0x2a], cx   ; member mag_type 一致",
        "0x03D546  cmp    word ptr es:[di + 0xba], 0    ; 割当カウンタ",
        "… 8B stride ループ @ 0x3D614..672 …",
        "0x03D674  lcall  → widget ptr",
        "0x03D68F  → weapon_row +0xCE/+0xD0/+0xD2",
        "```",
        "",
        "## 呼び出しグラフ（確定）",
        "",
        "```",
        "装備画面 open",
        "  0xECCF  call 0xF7C8 ×4",
        "    └─ lcall 0x105A  populate (cat==9 gate @ 3C5A5)",
        "    └─ lcall 0xD47   merge widget",
        "    └─ lcall 0xD74   refresh",
        "  0x4240C 小隊員候補 index",
        "  0x46866 8B append (composite 列)",
        "",
        "装填 UI open / refresh",
        "  0x3D1BA  open_loadout_ui_session",
        "    call 0x3D72A",
        "    call 0x3D42A  loadout_ui_build_and_link",
        "      mag_type @ 3D540",
        "      widget → +0xCE/+0xD0/+0xD2 @ 3D68F",
        "  0x178A0  equip_ui_ammo_refresh",
        "    call 0x18166 precheck",
        "    call 0x1804E  walk weapon[+0xCE]+0x40",
        "    mov weapon[+0xE6], slot",
        "```",
        "",
        f"**call 0xF7C8**: `{', '.join(f7c8_callers)}`",
        "",
        "### +0xCE mov 書込（コードセグメント走査）",
        "",
    ]
    if ce_writes:
        lines.append("| file | 命令 |")
        lines.append("|------|------|")
        for w in ce_writes:
            lines.append(f"| `{w['addr']}` | `{w['mnemonic']} {w['op']}` |")
    else:
        lines.append("（なし — 上記 `@ 0x3D68F` が代表）")

    lines.extend(
        [
            "",
            f"+0xCE 参照総数（code seg）: **{len(ce_refs)}**",
            "",
            "## `@ 0x2CD00` weapon_row UI init",
            "",
            "```asm",
            *asm_block(payload["disasm_weapon_init"]),
            "```",
            "",
            "## populate cat gate `@ 0x3C580`",
            "",
            "```asm",
            *asm_block(payload["disasm_populate_cat"]),
            "```",
            "",
            "## `@ 0x3D68F` ptr copy",
            "",
            "```asm",
            *asm_block(payload["disasm_ptr_copy"]),
            "```",
            "",
            "## `@ 0x3D200` loadout session → 3D42A",
            "",
            "```asm",
            *asm_block(payload["disasm_loadout_open"]),
            "```",
            "",
            "## ST 再現への示唆",
            "",
            "CBE から抽出すべき「良いところ」:",
            "",
            "- **段階的ゲート**: 候補列挙 → mag_type → UI 確定（データとロジックの分離）",
            "- **composite 装備**: 主武器 + 弾箱 + 三脚を独立 CBE 行で束ねる発想",
            "- **別ベクトルで**: UI blob far ptr / 矩形マッチ / DOS セグメント演算は ST では不要",
            "",
            "272 / cap: **F7C8 も 3D42A も cap cmp 無し** — 候補 index 列の upstream（データ or 41BD8）が正本。",
            "",
            "## 次の RE",
            "",
            "1. `0x3D42A` の **候補 index 列**の供給元（誰が Kar98k に 272 を入れるか）",
            "2. `0x771E` cat18 — populate/loadout からの **間接 lcall** トレース",
            "3. widget `+0x20/+0x1e/+0x22` と list blob `+0x40` 8B 列の同一性",
            "",
            "## 関連",
            "",
            "- [PL_CBE_F7C8_RE.md](./PL_CBE_F7C8_RE.md)",
            "- [PL_CBE_EQUIP_CHAIN_RE.md](./PL_CBE_EQUIP_CHAIN_RE.md)",
            "- [PL_CBE_AMMO_UI_LOADLIST_RE.md](./PL_CBE_AMMO_UI_LOADLIST_RE.md)",
            "- [PL_CBE_AMMO_FILTER_RE.md](./PL_CBE_AMMO_FILTER_RE.md)",
            "",
        ]
    )

    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT_MD.relative_to(ROOT)}")
    print(f"+0xCE refs: {len(ce_refs)}, writes: {len(ce_writes)}")


if __name__ == "__main__":
    main()

# -*- coding: utf-8 -*-
"""
CBE RE: @ 0x46CD4 UI テーブル追跡 — equip_ui 構造体 / +0x48 列の構築元。

実行: python scripts/re_cbe_ui_table_trace.py
出力:
  docs/PL_CBE_UI_TABLE_RE.md
  scripts/pl_decoded/cbe_ui_table_re.json
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
OUT_MD = ROOT / "docs" / "PL_CBE_UI_TABLE_RE.md"
OUT_JSON = ROOT / "scripts" / "pl_decoded" / "cbe_ui_table_re.json"

EQUIP_FN = 0x46C00
EQUIP_SEG_OFF = 0xB740  # seg5: 0x3B4C0 + 0xB740 = 0x46C00

ANCHORS = [
    {
        "id": "equip_fn_entry",
        "file_off": EQUIP_FN,
        "summary": "装備コピー + mag_type + 間接マージ + +0x34 UI 走査",
    },
    {
        "id": "ui_field_init",
        "file_off": 0x19A0E,
        "summary": "equip_ui +0x40..+0x4A 初期化。+0x48 = mag_type シード",
    },
    {
        "id": "ui_col_build_ec",
        "file_off": 0xECCF,
        "summary": "ui+0x40/+0x48/+0x50 列を call 0xF7C8 で構築（文字列 ID 0x4C4/0x4C6/0x4C7）",
    },
    {
        "id": "ui_col_build_f1",
        "file_off": 0xF126,
        "summary": "同上 — call 0xF6C6 経路（別画面）",
    },
    {
        "id": "ui_clear",
        "file_off": 0x57950,
        "summary": "equip_ui 全フィールドクリア（+0x48 含む）",
    },
    {
        "id": "squad_table_scan",
        "file_off": 0x4240C,
        "summary": "小隊ロスター走査 → 装備候補テーブル構築（+0x28/+0x8A/+0xA4）",
    },
    {
        "id": "list_populate",
        "file_off": 0xF7C8,
        "summary": "UI リスト列ポインタ [bp+0xA] 先頭 word≠0 なら項目追加",
    },
]

BYTE_PATTERNS: dict[str, bytes] = {
    "mov_w48_ax": bytes([0x89, 0x47, 0x48]),
    "mov_w48_cx": bytes([0x89, 0x4F, 0x48]),
    "mov_r48_ax": bytes([0x8B, 0x47, 0x48]),
    "add_ax_48": bytes([0x05, 0x48, 0x00]),
}


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
        length = ln if ln else 65536
        segs.append(
            {
                "seg_num": i + 1,
                "file_start": start,
                "file_end": start + length,
                "is_code": (fl & 1) == 0,
            }
        )
    return segs


def disasm(data: bytes, start: int, size: int) -> list[dict]:
    md = Cs(CS_ARCH_X86, CS_MODE_16)
    out = []
    for ins in md.disasm(data[start : start + size], start):
        op = ins.op_str.lower()
        mark = ""
        for key, tag in (
            ("+ 0x48", "+0x48"),
            ("+ 0x40", "+0x40"),
            ("+ 0x50", "+0x50"),
            ("+ 0x34", "+0x34"),
            ("+ 0x28", "+0x28"),
            ("+ 0x8a", "+0x8A"),
            ("+ 0x120", "+0x120 copy"),
            ("0xb740", "equip fn"),
        ):
            if key in op:
                mark = f" ; {tag}"
                break
        if ins.mnemonic in ("call", "lcall"):
            mark = (mark or "") + " ; call"
        out.append(
            {
                "addr": f"0x{ins.address:06X}",
                "mnemonic": ins.mnemonic,
                "op": ins.op_str,
                "mark": mark,
            }
        )
    return out


def scan_bytes(data: bytes) -> dict[str, list[int]]:
    out: dict[str, list[int]] = {}
    for name, pat in BYTE_PATTERNS.items():
        hits = []
        p = 0
        while True:
            i = data.find(pat, p)
            if i < 0:
                break
            hits.append(i)
            p = i + 1
        out[name] = hits
    return out


def find_lcall_equip(data: bytes) -> list[dict]:
    pat = bytes([0x9A]) + struct.pack("<H", EQUIP_SEG_OFF)
    hits = []
    p = 0
    while True:
        i = data.find(pat, p)
        if i < 0:
            break
        seg = struct.unpack_from("<H", data, i + 3)[0]
        hits.append({"file_off": i, "seg": seg, "ip": EQUIP_SEG_OFF})
        p = i + 1
    return hits


def pseudo_ui_struct() -> str:
    return """\
// equip_ui — 装備画面ワーク（[bp+6]:offset, [bp+8]:seg）
struct equip_ui {
  u16 field_04;           // +0x04 → 武器コピー +0x28 へ
  u16 weapon_index;       // +0x40  選択武器 cbe index（装填時に shl 6 コピー元）
  u16 field_42;           // +0x42
  u16 field_44;           // +0x44
  u16 field_46;           // +0x46
  u16 mag_type_seed;      // +0x48  word — mag_type 照合 @ 0x46C65
  u16 field_4A;           // +0x4A
  // col0 @+0x40 = 武器 index（スカラー）
  // col1 @+0x48, col2 @+0x50 = 8B エントリ — @ 0x46CD4 が u26 照合（最大2件）
  struct { u16 link_index; u16 pad; u16 state_value; u16 pad2; } aux_col[2];  // +0x48,+0x50
  u16 roster_slot;        // +0x11E  走査中スロット index
  u16 field_8A;           // +0x8A  小隊員バッファ内 offset（ランタイム）
  weapon_rec copy;        // +0x120 64B CBE レコードコピー
};"""


def main() -> None:
    if not CBE_PATH.is_file():
        raise SystemExit(f"CBE not found: {CBE_PATH}")

    data = CBE_PATH.read_bytes()
    segs = parse_ne(data)
    bp = scan_bytes(data)
    lcalls = find_lcall_equip(data)

    windows = {}
    for a in ANCHORS:
        fo = a["file_off"]
        windows[a["id"]] = disasm(data, max(0, fo - 24), 120)

    equip_full = disasm(data, EQUIP_FN, 0x170)
    loop_34 = disasm(data, 0x46CD0, 0x90)

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(
        json.dumps(
            {
                "summary": {
                    "generated": date.today().isoformat(),
                    "equip_fn": f"0x{EQUIP_FN:06X}",
                    "equip_lcall_sites": len(lcalls),
                },
                "anchors": ANCHORS,
                "byte_patterns": {k: [hex(x) for x in v] for k, v in bp.items()},
                "lcall_equip_sites": lcalls,
                "disasm_windows": windows,
                "equip_fn": equip_full,
                "loop_34": loop_34,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    lines = [
        "# CBE UI テーブル追跡 — `@ 0x46CD4` / `equip_ui`",
        "",
        f"**生成**: {date.today().isoformat()} — `python scripts/re_cbe_ui_table_trace.py`",
        "",
        "## 回答メモ",
        "",
        "- **ランタイム反映**（`pl_ammo_resolve.js` 等）は RE 確定後で問題なし。",
        "- **資料写真** — 装備画面スクショ・マニュアル画像は解析可能（UI ラベル・スロット対応の補助に使う）。",
        "",
        "## `equip_ui` 構造体（逆アセンブル確定分）",
        "",
        "```c",
        pseudo_ui_struct().rstrip(),
        "```",
        "",
        "### フィールド対応",
        "",
        "| オフセット | 役割 | 根拠 |",
        "|-----------|------|------|",
        "| +0x40 | 武器 **cbe index**（`shl 6` コピー元） | @ 0x46C17 `add cx,0x40`; `mov di,[si]` |",
        "| +0x48 (word) | **mag_type シード** | @ 0x46C65; 書込 @ 0x19A41 |",
        "| +0x48,+0x50,+0x58… | **8B×N 予備リンク列** | @ 0xECCF `add ax,0x48/0x50`; loop @ 0x46CEB |",
        "| +0x120 | **64B 武器レコード** コピー先 | @ 0x46C0D `add ax,0x120` |",
        "| +0x8A | 小隊員レコード **ランタイム offset** | @ 0x46C75; 0x4240C 走査 |",
        "",
        "### 8B 列エントリ（+0x34 走査）",
        "",
        "```",
        "[+0] u16 link_index  — weapon.u16[26] (+0x34) と cmp @ 0x46D01",
        "[+4] u16 state_value — 一致時 weapon.+0x28 へ @ 0x46D37",
        "stride 8; di=1..2 → ui+0x48, ui+0x50 の2列",
        "```",
        "",
        "## +0x48 列の構築経路",
        "",
        "### 1. `@ 0x19A0E` — スカラー初期化",
        "",
        "引数から +0x40..+0x4A を直接書込。`w21≠0` なら `[ui+0x48]=cx`、否则 `[ui+0x48]=di`（武器 index）。",
        "",
        "```asm",
    ]
    for ins in windows["ui_field_init"]:
        if ins["mark"] or "0x19A" in ins["addr"]:
            lines.append(f"{ins['addr']}  {ins['mnemonic']:6s} {ins['op']}{ins['mark']}")

    lines.extend(
        [
            "```",
            "",
            "### 2. `@ 0xECCF` / `@ 0xF126` — リスト列構築（**正本候補**）",
            "",
            "`call 0xF7C8` / `call 0xF6C6` に **列先頭アドレス**（ui+0x40, +0x48, +0x50…）と",
            "文字列リソース ID（**0x4C4**, **0x4C6**, **0x4C7**…）を渡して UI リストを埋める。",
            "",
            "```asm",
        ]
    )
    for ins in windows["ui_col_build_ec"]:
        if ins["mark"] or ins["mnemonic"] in ("call", "push", "add"):
            lines.append(f"{ins['addr']}  {ins['mnemonic']:6s} {ins['op']}{ins['mark']}")

    lines.extend(
        [
            "```",
            "",
            "### 3. `@ 0x4240C` — 小隊ロスター走査（候補フィルタ）",
            "",
            "ミッション小隊バッファ `es:[0xAD20]` 基準。各員 `+0x28`, `+0x8A`, `+0xA4`, `+0xBA` を参照し",
            "装備可能 index 列を構築 → `[ui+0x8A]` 更新。@ 0x4252C から `call 0x4240C`。",
            "",
            "### 4. `@ 0x57950` — クリア",
            "",
            "新規装備 UI 前に +0x40..+0x4C 等を 0 初期化。",
            "",
            "## `@ 0x46CD4` ループ ↔ UI 列",
            "",
            "```asm",
        ]
    )
    for ins in loop_34:
        if ins["mark"] or ins["mnemonic"] in ("cmp", "je", "jne", "mov", "add", "inc"):
            lines.append(f"{ins['addr']}  {ins['mnemonic']:6s} {ins['op']}{ins['mark']}")

    lines.extend(
        [
            "```",
            "",
            "1. `weapon[+0x34] ≠ 0` かつ `weapon[+0x28] == 0`",
            "2. `bx = ui + 0x48`; loop: `ax=[bx]`, cmp `weapon[+0x34]`; `bx+=8`",
            "3. 一致列の `[entry+4]` → `weapon[+0x28]`; `[ui+0x40+di*8]` にも反映",
            "",
            "**MG 例**: 武器 u16[26]=35 (M2HB Ammobox) → ui+0x48 列に `{35, …}` エントリが",
            "0xF7C8 経路で入っている前提。",
            "",
            f"## 装備関数 caller — `lcall …, 0x{EQUIP_SEG_OFF:04X}`（**{len(lcalls)}** 箇所）",
            "",
            "| file | seg |",
            "|------|-----|",
        ]
    )
    for h in lcalls[:12]:
        lines.append(f"| 0x{h['file_off']:06X} | 0x{h['seg']:04X} |")
    if len(lcalls) > 12:
        lines.append(f"| … | +{len(lcalls)-12} |")

    lines.extend(
        [
            "",
            "代表: `0x494D6`（小隊員装備確定）, `0x39EB8`, `0x3AE4E`。",
            "",
            "## 未追跡",
            "",
            "1. `0xF7C8` 内部 — 文字列 ID → 8B エントリ（link_index）の変換規則",
            "2. 0x4C4/0x4C6/0x4C7 文字列 → 実 item index 対応（DATA セグ）",
            "3. 小隊バッファ **`+0xA4`** bitmask — **確定** → [PL_CBE_EQUIP_CHAIN_RE.md](./PL_CBE_EQUIP_CHAIN_RE.md)",
            "4. **8B 書込 `@ 0x46866`** — link_index @ [+0], state @ [+4]",
            "",
            "## 関連",
            "",
            "- [PL_CBE_AUX_UI_RE.md](./PL_CBE_AUX_UI_RE.md)",
            "- [PL_CBE_AMMO_FILTER_RE.md](./PL_CBE_AMMO_FILTER_RE.md)",
            "- [PL_AUX_EQUIPMENT.md](./PL_AUX_EQUIPMENT.md)",
            "",
        ]
    )

    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT_MD.relative_to(ROOT)}")
    print(f"lcall equip: {len(lcalls)} sites")


if __name__ == "__main__":
    main()

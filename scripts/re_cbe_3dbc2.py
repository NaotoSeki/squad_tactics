# -*- coding: utf-8 -*-
"""
CBE RE: call 0x3DBC2 — loadout descriptor blob 構築（ad18 → ad1c+0x46）。

実行: python scripts/re_cbe_3dbc2.py
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

MARK = (
    ("+ 0x46", "+46"),
    ("+ 0x48", "+48"),
    ("+ 0x56", "+56"),
    ("+ 0x58", "+58"),
    ("0xad18", "ad18"),
    ("0xad1c", "ad1c"),
    ("0x40", "+64"),
)


def disasm(data: bytes, start: int, size: int) -> list[str]:
    md = Cs(CS_ARCH_X86, CS_MODE_16)
    lines = []
    for ins in md.disasm(data[start : start + size], start):
        op = ins.op_str.lower()
        tag = next((t for k, t in MARK if k in op), "")
        lines.append(f"{ins.address:06X}  {ins.mnemonic:6s} {ins.op_str}" + (f" ; {tag}" if tag else ""))
    return lines


def find_near_calls(data: bytes, target: int) -> list[str]:
    return [
        f"0x{p:06X}"
        for p in range(len(data) - 3)
        if data[p] == 0xE8 and p + 3 + struct.unpack_from("<h", data, p + 1)[0] == target
    ]


def main() -> None:
    if not CBE_PATH.is_file():
        raise SystemExit(f"CBE not found: {CBE_PATH}")

    data = CBE_PATH.read_bytes()
    payload = {
        "generated": date.today().isoformat(),
        "anchors": {
            "prepare_loadout": "0x03D72A",
            "blob_builder": "0x03DBC2",
            "populate_list": "0x03DC50",
        },
        "callers_3dbc2": find_near_calls(data, 0x03DBC2),
        "prepare_3D72A": disasm(data, 0x03D72A, 0xA0),
        "builder_3DBC2": disasm(data, 0x03DBC2, 0x90),
        "populate_head": disasm(data, 0x03DC50, 0x80),
    }

    out_json = ROOT / "scripts" / "pl_decoded" / "cbe_3dbc2_re.json"
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# CBE `call 0x3DBC2` — loadout descriptor blob 構築 RE",
        "",
        f"**生成**: {payload['generated']} — `python scripts/re_cbe_3dbc2.py`",
        "",
        "## 結論",
        "",
        "### 役割 — **ad18 テンプレ → ad1c セッション内 blob 2 本**",
        "",
        "`prepare_loadout_ad1c` @ **`0x3D72A`** が `3DBC2` を **2 回** call:",
        "",
        "| # | caller | 出力先 (推定) | ソース |",
        "|---|--------|---------------|--------|",
        "| 1 | `0x3D797` | ad1c **`+0x46/+0x48`** far ptr | `es:[ad1c+0xF2]` + dest `0x1CCA:0x22ED` |",
        "| 2 | `0x3D7B3` | 第 2 buffer | `es:[ad1c+0xF6]` + dest `0x24CA:0x2304` |",
        "",
        "この blob が @ `0x3D42A` → **`3D540` mag_type ゲート** の入力。",
        "",
        "### `3DBC2` 本体 @ `0x03DBC2`",
        "",
        "```asm",
        *payload["builder_3DBC2"],
        "```",
        "",
        "疑似コード:",
        "",
        "```",
        "template = ES:0xAD18",
        "pair_count = template[+0x56]   // 1 セクションあたり u16 ペア数",
        "section_count = template[+0x58]",
        "",
        "for section in 0 .. section_count-1:",
        "    for i in 0 .. pair_count-1:",
        "        dest[i] = src[i]         // word copy",
        "    dest += 0x40               // 次セクション (+64B stride)",
        "```",
        "",
        "- **header word（mag_type 期待値）** は template 先頭から **そのままコピー**",
        "- @ `3D540` の `cx = header & 0x800F` は **テンプレ静的データ** 由来",
        "",
        "### テンプレ武器インデックス — @ `3D72A` 先頭",
        "",
        "```asm",
        *[ln for ln in payload["prepare_3D72A"] if "03D73" in ln or "03D74" in ln or "03D75" in ln or "03D76" in ln or "03D77" in ln or "03D78" in ln or "03D79" in ln or "03D7B" in ln],
        "```",
        "",
        "```",
        "weapon_key = es:[ad1c+0xF0]",
        "template_off = weapon_key * 12 + 0x2CE   // rep movsd ×3",
        "copy from DS:0x13BD + template_off → ad18+0x52",
        "```",
        "",
        "→ **武器種別ごとの descriptor テンプレ** が file 内 DS セグ（seg `0x13BD` 相当）に存在。",
        "Kar98k の mag58/mag68 行は **このテーブル行** に埋込。",
        "",
        "### 関連 runtime ポインタ",
        "",
        "| ES:off | 用途 |",
        "|--------|------|",
        "| **`0xAD18`** | loadout テンプレ workspace |",
        "| **`0xAD1C`** | loadout セッション（+0x46 blob far ptr, +0xF0 weapon key） |",
        "| `0xAD24` | フラグ（bit5=pool直walk @ 3D441） |",
        "",
        f"### callers — **`{', '.join(payload['callers_3dbc2'])}`**（いずれも `3D72A` 内）",
        "",
        "## ST 再現指針",
        "",
        "1. 武器 `weapon_key`（ad1c+0xF0）→ テンプレ table lookup",
        "2. `3DBC2` 相当: テンプレを blob buffer に section×pair コピー",
        "3. `3D42A` / `3D540` — [PL_CBE_MAG_TYPE_3D540_RE.md](./PL_CBE_MAG_TYPE_3D540_RE.md) 参照",
        "",
        "ST 暫定: テーブル未抽出のため **mission pool + cap** のみ。",
        "",
        "## 未完了",
        "",
        "1. **DS:0x13BD + 0x2CE** テーブルの file offset マップ（Kar98k 行ダンプ）",
        "2. template `+0x56/+0x58` と packed 記述子 group class の対応",
        "3. 第 2 buffer（0x24CA:0x2304）→ @ `3D59C` 第 2 パスとの接続",
        "",
        "## 関連",
        "",
        "- [PL_CBE_MAG_TYPE_3D540_RE.md](./PL_CBE_MAG_TYPE_3D540_RE.md)",
        "- [PL_CBE_LOADOUT_CANDIDATE_RE.md](./PL_CBE_LOADOUT_CANDIDATE_RE.md)",
        "- [PL_CBE_RE_INDEX.md](./PL_CBE_RE_INDEX.md)",
        "",
    ]

    out_md = ROOT / "docs" / "PL_CBE_3DBC2_RE.md"
    out_md.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {out_md.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

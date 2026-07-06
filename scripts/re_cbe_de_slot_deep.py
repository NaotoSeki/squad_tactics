# -*- coding: utf-8 -*-
"""
CBE RE: DE4A slot dispatch — lcall DE85 / DE9A / DE5E 内部。

lcall 生バイト: 9A ip_lo ip_hi cs_lo cs_hi（Capstone 表示順は逆のことが多い）
DE4A 系スタブ解決: caller_seg_base + cs_imm（第2 word）— DBD7 と同族。

実行: python scripts/re_cbe_de_slot_deep.py
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
SEG5_BASE = 0x03B4C0
DE4A_FILE = 0x0492AE
OUT_MD = ROOT / "docs" / "PL_CBE_DE_SLOT_RE.md"
OUT_JSON = ROOT / "scripts" / "pl_decoded" / "cbe_de_slot_re.json"

SLOTS = (
    {"name": "Slot 6 (DE5E)", "slot_si": 6, "call_file": 0x049307, "cs_imm": "0xDE5E", "return_offset": 0xDE4C},
    {"name": "Slot 5 (DE85)", "slot_si": 5, "call_file": 0x04931B, "cs_imm": "0xDE85", "return_offset": 0xDE60},
    {"name": "Slot 3-4 (DE9A)", "slot_si": 3, "call_file": 0x049342, "cs_imm": "0xDE9A", "return_offset": 0xDE87},
    {"name": "Slot 1-2 (DBD7)", "slot_si": 1, "call_file": 0x049357, "cs_imm": "0xDBD7", "return_offset": 0xDE9C},
)

MARK = (
    ("+ 0x0a", "u16_5"),
    ("+ 0x28", "cap"),
    ("0x64", "div100"),
    ("0xffff", "term"),
    ("4936f", "merge"),
    ("4930f", "si=ax"),
)


def read_ne(data: bytes) -> list[dict]:
    ne = struct.unpack_from("<I", data, 0x3C)[0]
    align = 1 << struct.unpack_from("<H", data, ne + 0x32)[0]
    n = struct.unpack_from("<H", data, ne + 0x1C)[0]
    sa = ne + struct.unpack_from("<H", data, ne + 0x22)[0]
    segs = []
    for i in range(n):
        o = sa + i * 8
        raw, ln, fl, _ = struct.unpack_from("<HHHH", data, o)
        segs.append({"num": i + 1, "start": raw * align, "len": ln if ln else 65536})
    return segs


def disasm(data: bytes, start: int, size: int) -> list[str]:
    md = Cs(CS_ARCH_X86, CS_MODE_16)
    lines = []
    for ins in md.disasm(data[start : start + size], start):
        op = ins.op_str.lower()
        mark = next((t for k, t in MARK if k in op or k in f"{ins.address:06x}"), "")
        lines.append(f"{ins.address:06X}  {ins.mnemonic:6s} {ins.op_str}" + (f" ; {mark}" if mark else ""))
    return lines


def parse_lcall(data: bytes, file_off: int) -> dict:
    raw = data[file_off : file_off + 5]
    ip_imm, cs_imm = struct.unpack_from("<HH", raw, 1)
    return {
        "file_off": f"0x{file_off:06X}",
        "raw": raw.hex(),
        "ip_imm": f"0x{ip_imm:04X}",
        "cs_imm": f"0x{cs_imm:04X}",
        "target_file": f"0x{SEG5_BASE + cs_imm:06X}",
        "target_ip_style": f"0x{SEG5_BASE + ip_imm:06X}",
    }


def main() -> None:
    if not CBE_PATH.is_file():
        raise SystemExit(f"CBE not found: {CBE_PATH}")

    data = CBE_PATH.read_bytes()
    de4a = disasm(data, DE4A_FILE, 0x110)

    stubs = {}
    for slot in SLOTS:
        lc = parse_lcall(data, slot["call_file"])
        ret_file = SEG5_BASE + slot["return_offset"]
        stubs[slot["name"]] = {
            **slot,
            **lc,
            "disasm": disasm(data, ret_file, 0x18),
        }

    payload = {
        "generated": date.today().isoformat(),
        "encoding": "9A ip cs — landing DE4A stubs = seg5_base + cs_imm (2nd u16) overwritten by Loader",
        "flag_gate": "es:[0xAD25] bit3 @ DE4A+0x4A",
        "de4a_dispatch": de4a,
        "stubs": stubs,
    }

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# CBE DE4A slot dispatch — DE85 / DE9A / DE5E RE",
        "",
        f"**生成**: {payload['generated']} — `python scripts/re_cbe_de_slot_deep.py`",
        "",
        "## 結論：再配置チェーンと「ゴーストスタブ」の解決",
        "",
        "静的解析時に見つかった `DE5E` (`0x04931E`), `DE85` (`0x049345`), `DE9A` (`0x04935A`) のスタブ命令列は、**実在する関数ではなく、NEフォーマットの再配置チェーンデータ（Relocation Chain Pointer）を逆アセンブルした結果生じた「ゴースト」**であることが確定しました。",
        "",
        "### 再配置チェーンの構造",
        "",
        "Segment 5 の末尾に定義されている内部参照再配置（Reloc 6: TargetSeg=5）は、`DE4A` 分岐ループ内の各 `lcall` 命令のセグメントセレクタ領域を単一の片方向リストとして繋いでいます。",
        "",
        "```",
        "再配置チェーン: ",
        "0xEA02 -> ... -> 0xE0FC -> 0xDE4A -> 0xDE5E -> 0xDE85 -> 0xDE9A -> 0xDBD7 -> ... -> 0xFFFF",
        "```",
        "",
        "- `0xDE4A` は `lcall` @ `0x049307` のセグメントセレクタ領域（`0x04930A`）",
        "- `0xDE5E` は `lcall` @ `0x04931B` のセグメントセレクタ領域（`0x04931E`）",
        "- `0xDE85` は `lcall` @ `0x049342` のセグメントセレクタ領域（`0x049345`）",
        "- `0xDE9A` は `lcall` @ `0x049357` のセグメントセレクタ領域（`0x04935A`）",
        "",
        "ローダーはこのチェーンを走査し、すべてのプレースホルダーを実際の **Segment 5 の実効セレクタ** に書き換えます。",
        "",
        "### 実際の実行フロー",
        "",
        "したがって、分岐内のすべての `lcall` は、実行時には **同一の関数 `DBD7` 本体 (`0x04859A`)** を呼び出します。",
        "それぞれの分岐は、`lcall` からリターンした直後の実行ストリーム（スタック調整やレジスタ設定）のみが異なります。",
        "",
        "| 分岐 | コール命令 | 実効ターゲット | リターン先 (戻り位置) | リターン後の処理 |",
        "|------|-----------|--------------|-------------------|----------------|",
        "| **Slot 6** | `lcall 0xde5e, 0xd0da` | `DBD7` (`0x04859A`) | `0x04930C` | `add sp, 2` / `si = ax` |",
        "| **Slot 5** | `lcall 0xde85, 0xd0da` | `DBD7` (`0x04859A`) | `0x049320` | `add sp, 2` / `dec ax` / `si = ax` |",
        "| **Slot 3-4** | `lcall 0xde9a, 0xd0da` | `DBD7` (`0x04859A`) | `0x049347` | `add sp, 2` / `si = ax` / `dec si` |",
        "| **Slot 1-2** | `lcall 0xdbd7, 0xd0da` | `DBD7` (`0x04859A`) | `0x04935C` | `add sp, 2` / `les bx, [bp-4]` / `cmp es:[bx+0xa], ax` |",
        "",
        "### DE4A @ `0x0492AE` — シナリオ word1 の slot type (`si`) で分岐",
        "",
        "`si = (scenario_word1 & 0xDFFF)` — [PL_CBE_MISSION_POOL_RE.md](./PL_CBE_MISSION_POOL_RE.md) 確定。",
        "",
        "**分岐フラグ** `byte es:[0xAD25] & 8`:",
        "",
        "| 条件 | `si` | 処理 | 実効着地 offset |",
        "|------|------|------|-----------|",
        "| flag **set** | ≥6 | `lcall DBD7` (Slot 6 経由) | `0x04930C` (si=ax) |",
        "| flag **set** | 5 | `lcall DBD7` (Slot 5 経由) | `0x049320` (dec ax->si) |",
        "| flag **set** | 0–4 | `ax=0xFFFF` reject | — |",
        "| flag **clear** | 6 | `si=1` 固定 | — |",
        "| flag **clear** | 5 | `jmp` Slot 6 経路 (`0x049305`) | — |",
        "| flag **clear** | 3–4 | `lcall DBD7` (Slot 3-4 経由) | `0x049347` (si=ax-1) |",
        "| flag **clear** | 1–2 | `lcall DBD7` (Slot 1-2 経由) | `0x04935C` (u16_5 gate) |",
        "",
        "### 各分岐の戻り先コード詳細",
        "",
        "#### Slot 6 戻り先 @ `0x04930C` (Slot >= 6)",
        "```asm",
        *stubs["Slot 6 (DE5E)"]["disasm"][:4],
        "```",
        "- `push 2` 引数を `add sp,2` で捨てる",
        "- `si = ax` とし、そのままマージへ移行",
        "",
        "#### Slot 5 戻り先 @ `0x049320` (Slot == 5)",
        "```asm",
        *stubs["Slot 5 (DE85)"]["disasm"][:4],
        "```",
        "- `push 2` 引数を `add sp,2` で捨てる",
        "- **`dec ax`** して `si = ax` へ移行（数量調整）",
        "",
        "#### Slot 3-4 戻り先 @ `0x049347` (Slot == 3, 4)",
        "```asm",
        *stubs["Slot 3-4 (DE9A)"]["disasm"][:5],
        "```",
        "- `push 2` 引数を `add sp,2` で捨てる",
        "- `si = ax` とし、さらに **`dec si`** してマージへ移行",
        "",
        "#### Slot 1-2 戻り先 @ `0x04935C` (Slot == 1, 2)",
        "```asm",
        *stubs["Slot 1-2 (DBD7)"]["disasm"][:8],
        "```",
        "- `push 0x64` (100) 引数を `add sp,2` で捨てる",
        "- `es:[bx + 0x0a]` （弾薬 u16_5）が `ax`（武器 u16_5 % 100）未満なら `si=0` (Pass) 、それ以上なら `si=0xFFFF` (Reject)",
        "",
        "## ST 再現指針",
        "",
        "```",
        "slot = scenario_word1 & 0xDFFF",
        "if es_ad25_bit3:",
        "  if slot >= 6:",
        "    si = dbd7_gate_mod2(weapon)  # weapon.u16_5 % 2",
        "  elif slot == 5:",
        "    si = dbd7_gate_mod2(weapon) - 1",
        "  else:",
        "    reject",
        "else:",
        "  if slot >= 6:",
        "    si = 1",
        "  elif slot == 5:",
        "    si = dbd7_gate_mod2(weapon) # slot 6 と同じ経路",
        "  elif slot >= 3:",
        "    si = dbd7_gate_mod2(weapon) - 1",
        "  elif slot >= 1:",
        "    # weapon.u16_5 % 100 に基づき判定",
        "    si = (ammo.u16_5 < weapon.u16_5 % 100) ? 0 : -1",
        "merge: write pool row or FFFF",
        "```",
        "",
        "## 未完了",
        "",
        "1. **`lcall D0F0` @ 0x04859D** — 被除数 `ax` の厳密ソース（武器 `ES:[si+?]` 取得ロジック）",
        "2. **E02C 入力 ptr 同一性** (DOSBox)",
        "3. **`lcall D0F0` (DBD7被除数)** の調査",
        "",
        "## 関連",
        "",
        "- [PL_CBE_MISSION_POOL_RE.md](./PL_CBE_MISSION_POOL_RE.md)",
        "- [PL_CBE_DBD7_RE.md](./PL_CBE_DBD7_RE.md)",
        "- [PL_CBE_RE_INDEX.md](./PL_CBE_RE_INDEX.md)",
        "",
    ]

    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT_MD.relative_to(ROOT)}")
    print(f"Wrote {OUT_JSON.relative_to(ROOT)}")


if __name__ == "__main__":
    main()


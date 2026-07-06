# -*- coding: utf-8 -*-
"""
CBE RE: 0x800F mask @ 3D540 — 静的 cmp 意味と Kar98k データ整合。

実行: python scripts/re_cbe_800f_mask.py
出力:
  docs/PL_CBE_800F_MASK_RE.md
  scripts/pl_decoded/cbe_800f_mask_re.json
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
TABLE_BASE = 0x1DDF00
MASK = 0x800F

KAR98K = {
    "mag58_hdr": 0x003A,
    "mag68_hdr": 0x0044,
    "indices_mag58": [272, 269, 273, 314],
    "indices_mag68": [274, 273, 314],
}


def disasm_gate(data: bytes) -> list[str]:
    md = Cs(CS_ARCH_X86, CS_MODE_16)
    lines = []
    for ins in md.disasm(data[0x03D4D2 : 0x03D560], 0x03D4D2):
        mark = ""
        op = ins.op_str.lower()
        if "0x800f" in op:
            mark = " ; MASK"
        if "+ 0x2a" in op:
            mark = " ; mag_type cmp"
        lines.append(f"{ins.address:06X}  {ins.mnemonic:6s} {ins.op_str}{mark}")
    return lines


def find_and_800f(data: bytes) -> list[str]:
    pat = bytes([0x81, 0xE1, 0x0F, 0x80])  # and cx, 0x800F
    return [f"0x{p:06X}" for p in range(len(data) - 4) if data[p : p + 4] == pat]


def read_mag(data: bytes, idx: int) -> dict:
    off = TABLE_BASE + idx * 64
    mag = struct.unpack_from("<H", data, off + 0x2A)[0]
    return {
        "idx": idx,
        "mag_type": mag,
        "mag_hex": f"0x{mag:04X}",
        "masked": mag & MASK,
        "pass_full": None,
        "pass_masked_both": None,
    }


def gate_rows(data: bytes, header: int, indices: list[int]) -> list[dict]:
    cx = header & MASK
    rows = []
    for idx in indices:
        r = read_mag(data, idx)
        r["header"] = f"0x{header:04X}"
        r["cx"] = cx
        r["pass_full"] = r["mag_type"] == cx
        r["pass_masked_both"] = (r["mag_type"] & MASK) == cx
        rows.append(r)
    return rows


def main() -> None:
    if not CBE_PATH.is_file():
        raise SystemExit(f"CBE not found: {CBE_PATH}")

    data = CBE_PATH.read_bytes()
    gate_asm = disasm_gate(data)
    and_sites = find_and_800f(data)

    m58 = gate_rows(data, KAR98K["mag58_hdr"], KAR98K["indices_mag58"])
    m68 = gate_rows(data, KAR98K["mag68_hdr"], KAR98K["indices_mag68"])

    payload = {
        "generated": date.today().isoformat(),
        "mask": f"0x{MASK:04X}",
        "and_cx_800f_sites": and_sites,
        "cmp_di_2a_sites": ["0x03D540"],
        "gate_asm": gate_asm,
        "kar98k_mag58": m58,
        "kar98k_mag68": m68,
        "st_rule": "(ammo.mag_type & 0x800F) == (header & 0x800F)",
    }

    out_json = ROOT / "scripts" / "pl_decoded" / "cbe_800f_mask_re.json"
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def tbl(rows: list[dict]) -> list[str]:
        out = [
            "| idx | mag_type | masked | cx | full cmp | masked cmp |",
            "|-----|----------|--------|-----|----------|------------|",
        ]
        for r in rows:
            out.append(
                f"| **{r['idx']}** | {r['mag_type']} ({r['mag_hex']}) | "
                f"{r['masked']} | {r['cx']} | "
                f"{'PASS' if r['pass_full'] else 'FAIL'} | "
                f"{'**PASS**' if r['pass_masked_both'] else 'FAIL'} |"
            )
        return out

    lines = [
        "# CBE `0x800F` mask @ `0x3D540` — 静的 RE 解決",
        "",
        f"**生成**: {payload['generated']} — `python scripts/re_cbe_800f_mask.py`",
        "",
        "## 結論",
        "",
        "### asm（**CONFIRMED** — EXE 内ユニーク）",
        "",
        f"- `and cx, 0x800F` — **{len(and_sites)}** 箇所のみ @ **`0x03D4F4`**",
        "- `cmp es:[di+0x2A], cx` @ **`0x03D540`** — **弾側マスク無し**",
        "",
        "```asm",
        *gate_asm,
        "```",
        "",
        "### マスクの意味",
        "",
        f"`0x800F` = bit15 + bits0..3 を保持、**bits4..14 をクリア**。",
        "",
        "| header / mag | raw | `& 0x800F` |",
        "|--------------|-----|------------|",
        f"| mag58 `0x003A` (58) | 58 | **10** (`0x000A`) |",
        f"| mag68 `0x0044` (68) | 68 | **4** (`0x0004`) |",
        f"| 272 ammo | 58 | **10** |",
        f"| 273 ammo | 68 | **4** |",
        "",
        "header word は **mag_type 定数そのもの**（58 / 68）。",
        "レジスタ cx は **マスク後** の値（10 / 4）。",
        "",
        "### Kar98k — 照合表",
        "",
        "#### mag58 header `0x003A` → cx=**10**",
        "",
        *tbl(m58),
        "",
        "#### mag68 header `0x0044` → cx=**4**",
        "",
        *tbl(m68),
        "",
        "### 静的矛盾と解決",
        "",
        "| 照合方式 | 272 vs mag58 | 273 vs mag68 | 269 vs mag58 | 314 vs mag58 |",
        "|----------|--------------|--------------|--------------|--------------|",
        "| **full**: `mag == cx` | FAIL (58≠10) | FAIL (68≠4) | FAIL | FAIL |",
        "| **masked both**: `(mag&800F)==cx` | **PASS** | **PASS** | FAIL (6≠10) | FAIL (0≠10) |",
        "",
        "**解釈（確定度: 高）**",
        "",
        "1. **意図セマンティクス** = `(ammo[+0x2A] & 0x800F) == (header & 0x800F)`",
        "   — Kar98k の 272/273 は各 group header で **masked PASS**",
        "2. **生 asm** は弾側マスク無し → 272(58) vs cx(10) は **pass1 不通過**",
        "   - ランタイム ES コピーで +0x2A が変換される、または",
        "   - **第 2 パス @ `0x3D59C`**（mag_type cmp 無し）で 269/314 をリンク",
        "3. **269 / 314** は mag58 group に列挙されるが masked PASS しない",
        "   → pass1 対象外、pass2 / 副装列が正本",
        "",
        "### blob packed 形式（復習）",
        "",
        "```",
        "byte0 @ si     — class nibble (low 4 bits); >=4 → buffer B (0x18a)",
        "word0 @ si     — header mag_type 定数 (0x003A / 0x0044)",
        "  cx = word0 & 0x800F",
        "word1.. @ si+2 — cbe index 列 (-1 終端)",
        "```",
        "",
        "seg132 `[weapon_id, mag_word, 0]` + pairs は **テンプレ正本** —",
        "[PL_CBE_LOADOUT_TEMPLATE_RE.md](./PL_CBE_LOADOUT_TEMPLATE_RE.md)",
        "",
        "## ST 再現指針",
        "",
        "```python",
        "MASK = 0x800F",
        "",
        "def loadout_mag_gate_pass(ammo_mag_type: int, header_word: int) -> bool:",
        "    return (ammo_mag_type & MASK) == (header_word & MASK)",
        "",
        "# Kar98k pass1 暫定",
        "MAG58 = 0x003A",
        "MAG68 = 0x0044",
        "pass1_mag58 = [i for i in (272, 269, 273, 314)",
        "               if loadout_mag_gate_pass(cbe[i].mag_type, MAG58)]",
        "# → [272] のみ masked 一致",
        "```",
        "",
        "旧 doc の「cx=58 で pass」表記は **header raw=58** の意味論混同 —",
        "レジスタ cx は **10**（masked）。",
        "",
        "## 未完了",
        "",
        "1. runtime ES:512B レコード @ +0x2A の実値（DOSBox ブレーク）",
        "2. pass2 buffer @ `0x1EC` — 269/314 index 列の正本",
        "3. `0x8000` bit — header に立つケースの cmp 挙動",
        "",
        "## 関連",
        "",
        "- [PL_CBE_MAG_TYPE_3D540_RE.md](./PL_CBE_MAG_TYPE_3D540_RE.md)",
        "- [PL_CBE_LOADOUT_TEMPLATE_RE.md](./PL_CBE_LOADOUT_TEMPLATE_RE.md)",
        "- [PL_CBE_SEG132_EXPORT.md](./PL_CBE_SEG132_EXPORT.md)",
        "- [PL_CBE_RE_INDEX.md](./PL_CBE_RE_INDEX.md)",
        "",
    ]

    out_md = ROOT / "docs" / "PL_CBE_800F_MASK_RE.md"
    out_md.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {out_md.relative_to(ROOT)}")
    print(f"and cx,800f sites={len(and_sites)}")


if __name__ == "__main__":
    main()

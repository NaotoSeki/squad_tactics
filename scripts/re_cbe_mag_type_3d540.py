# -*- coding: utf-8 -*-
"""
CBE RE: loadout mag_type gate @ 0x3D540 — cx 由来 / packed 記述子 / +0xBA。

実行: python scripts/re_cbe_mag_type_3d540.py
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

MARK = (
    ("+ 0x2a", "mag_type"),
    ("+ 0x28", "cap"),
    ("+ 0xba", "+0xBA"),
    ("+ 0xae", "+0xAE"),
    ("+ 0xce", "+0xCE"),
    ("+ 0x46", "blob+46"),
    (" cx", "cx"),
    ("0xffff", "term"),
)


def disasm(data: bytes, start: int, size: int) -> list[str]:
    md = Cs(CS_ARCH_X86, CS_MODE_16)
    lines = []
    for ins in md.disasm(data[start : start + size], start):
        op = ins.op_str.lower()
        mark = next((t for k, t in MARK if k in op), "")
        lines.append(f"{ins.address:06X}  {ins.mnemonic:6s} {ins.op_str}" + (f" ; {mark}" if mark else ""))
    return lines


def find_near_calls(data: bytes, target: int) -> list[str]:
    hits = []
    p = 0
    while p < len(data) - 3:
        if data[p] == 0xE8:
            rel = struct.unpack_from("<h", data, p + 1)[0]
            if p + 3 + rel == target:
                hits.append(f"0x{p:06X}")
        p += 1
    return hits


def read_cbe(data: bytes, idx: int) -> dict:
    off = TABLE_BASE + idx * 64
    rec = data[off : off + 64]
    mag = struct.unpack_from("<H", rec, 0x2A)[0]
    return {
        "idx": idx,
        "mag_type": mag,
        "mag_masked": mag & 0x800F,
        "mag_cap": struct.unpack_from("<H", rec, 0x28)[0],
    }


def main() -> None:
    if not CBE_PATH.is_file():
        raise SystemExit(f"CBE not found: {CBE_PATH}")

    data = CBE_PATH.read_bytes()
    builder = disasm(data, 0x03D42A, 0x2E0)
    gate_core = disasm(data, 0x03D4D2, 0xD0)
    pass2 = disasm(data, 0x03D59C, 0x70)
    widget = disasm(data, 0x03D680, 0x60)

    payload = {
        "generated": date.today().isoformat(),
        "callers_3D42A": find_near_calls(data, 0x03D42A),
        "builder": builder,
        "gate_core": gate_core,
        "pass2_no_mag_cmp": pass2,
        "widget_link": widget,
        "cbe": {str(k): read_cbe(data, k) for k in (57, 272, 273, 314, 37, 353)},
    }

    out_json = ROOT / "scripts" / "pl_decoded" / "cbe_mag_type_3d540_re.json"
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    k57, a272, a273 = payload["cbe"]["57"], payload["cbe"]["272"], payload["cbe"]["273"]

    lines = [
        "# CBE loadout mag_type ゲート @ `0x3D540` RE",
        "",
        f"**生成**: {payload['generated']} — `python scripts/re_cbe_mag_type_3d540.py`",
        "",
        "## 結論",
        "",
        "### `@ 0x3D540` — **弾 CBE `+0x2A` == 記述子 `cx`（`header & 0x800F`）**",
        "",
        "```asm",
        *[
            ln
            for ln in gate_core
            if any(x in ln[:6] for x in ("03D4D", "03D4E", "03D4F", "03D50", "03D51", "03D52", "03D53", "03D54", "03D55"))
        ],
        "```",
        "",
        "**packed 記述子 1 グループ**（`[ad1c+0x46]` blob 内）:",
        "",
        "```",
        "byte0 & 0x0F  — group class (<4 → index buffer A, ≥4 → buffer B)",
        "word0 @ si    — header",
        "  cx = header & 0x800F     ← @ 3D540 cmp 右辺",
        "  group = (header & 0xF0)>>4 → リンク後 ammo[+0xAE]",
        "word1.. @ si+2 — u16 cbe index 列（-1 終端）",
        "```",
        "",
        "内側ループ @ `3D514`: index 列を walk → CBE ロード →",
        "",
        "| 命令 | 意味 |",
        "|------|------|",
        "| `cmp es:[di+0x2A], cx` | **弾 mag_type 完全一致**（マスク済み cx） |",
        "| `cmp es:[di+0xBA], 0` | ランタイム **未リンク** のみ |",
        "| `inc es:[di+0xBA]` | 採用マーク（二重リンク防止） |",
        "| `jne 3D514` | 不一致 → 次 index |",
        "",
        "### Kar98k — **w21=0 でも skip 無し**",
        "",
        "装備経路 `0x046C5B` / UI `0x1805A` とは異なり、",
        "**loadout 構築は武器 mag_type=0 でもゲート発火**する。",
        "",
        "期待 mag_type は **武器 CBE からではなく記述子 header** が持つ:",
        "",
        f"| | Kar98k (57) | 272 | 273 |",
        f"|--|-------------|-----|-----|",
        f"| mag_type (+0x2A) | **{k57['mag_type']}** | **{a272['mag_type']}** | **{a273['mag_type']}** |",
        f"| `& 0x800F` | {k57['mag_masked']} | {a272['mag_masked']} | {a273['mag_masked']} |",
        "",
        "- 272 は **header `0x003A`（raw=58, cx=10）** の記述子行で masked PASS",
        "- 273 は **header `0x0044`（raw=68, cx=4）** の記述子行で masked PASS",
        "- 269/314 は mag58 列に居るが masked PASS しない → pass2 等",
        "- 詳細: [PL_CBE_800F_MASK_RE.md](./PL_CBE_800F_MASK_RE.md)",
        "- **273→272 差替は 3D540 では起きない** — 別 group 行の問題",
        "",
        "### 第 2 パス @ `3D59C` — **mag_type cmp 無し**",
        "",
        "```asm",
        *pass2,
        "```",
        "",
        "blob 走査後、別 buffer（`bp-0x1E` / `0x1EC` 系）を **mag_type 照合なし** でリンク。",
        "+0xBA==0 と `+0x3E` 書込のみ — **フォールバック列** の可能性。",
        "",
        "### mission pool 直 walk（フラグ経路）",
        "",
        "`es:[0xAD24] & 0x20` が立つと @ `3D441` から **DS:0x270 を直接 walk**",
        "（記述子 mag_type ループを bypass）。通常 loadout UI は @ `3D484` 側。",
        "",
        f"### caller — `call 3D42A` @ **`{payload['callers_3D42A'][0]}`**",
        "",
        "## 他経路対比",
        "",
        "| 経路 | file | w21=0 | 照合 |",
        "|------|------|-------|------|",
        "| equip | `0x046C5B` | skip | — |",
        "| UI slot | `0x1805A` | skip | — |",
        "| loadout 確定 | `0x018BF3` | exact weapon↔ammo |",
        "| **loadout 構築** | **`0x03D540`** | **no skip** | **descriptor cx ↔ ammo** |",
        "",
        "## ST 再現指針",
        "",
        "```python",
        "def loadout_link_pass1(descriptor_groups, index_lists):",
        "    MASK = 0x800F",
        "    for hdr, indices in zip(descriptor_groups, index_lists):",
        "        expected = hdr & MASK",
        "        for cbe_idx in indices:",
        "            ammo = load_cbe(cbe_idx)",
        "            if (ammo.mag_type & MASK) != expected:",
        "                continue",
        "            if ammo.runtime.linked:  # +0xBA",
        "                continue",
        "            link(ammo, group=(hdr & 0xF0) >> 4)",
        "```",
        "",
        "Kar98k: ST は **descriptor blob**（`3DBC2` 生成）を持たないため、",
        "暫定は mission pool + cap フィルタ。mag_type 列は **データ待ち**。",
        "",
        "## 未完了",
        "",
        "1. **`3DBC2`** — header word 生成表（58/68 行の静的ソース）",
        "2. `0x8000` bit in header — cx に残るが cmp 意味（要 runtime）",
        "3. 第 2 パス buffer @ `0x1EC` の index 列ソース",
        "",
        "## 関連",
        "",
        "- [PL_CBE_LOADOUT_CANDIDATE_RE.md](./PL_CBE_LOADOUT_CANDIDATE_RE.md)",
        "- [PL_CBE_AMMO_FILTER_RE.md](./PL_CBE_AMMO_FILTER_RE.md)",
        "- [PL_CBE_273_272_PATH_RE.md](./PL_CBE_273_272_PATH_RE.md)",
        "",
    ]

    out_md = ROOT / "docs" / "PL_CBE_MAG_TYPE_3D540_RE.md"
    out_md.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {out_md.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

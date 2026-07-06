# -*- coding: utf-8 -*-
"""
CBE RE: 273→272 実経路 — mission pool DS:0x270 / loadout @ 0x3D42A / cap 置換。

実行: python scripts/re_cbe_273_272_path.py
出力:
  docs/PL_CBE_273_272_PATH_RE.md
  scripts/pl_decoded/cbe_273_272_path_re.json
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
OUT_MD = ROOT / "docs" / "PL_CBE_273_272_PATH_RE.md"
OUT_JSON = ROOT / "scripts" / "pl_decoded" / "cbe_273_272_path_re.json"

SCENARIO_BLOCK = 0x1DCAB2  # seg132 内 272 出現点

ANCHORS = [
    {
        "id": "pool_builder",
        "file_off": 0x0494EC,
        "name": "mission_pool_build_lcall_E02C",
        "summary": "42566 lcall E02C — scenario→DS:0x270 列構築; cap push @ 495B5 → lcall DE4A",
        "status": "CONFIRMED",
    },
    {
        "id": "squad_scan",
        "file_off": 0x04240C,
        "name": "squad_roster_pool_scan",
        "summary": "4240C — pool walk; cap cmp @ 424B1; mismatch→422B8 validate / +0xA4",
        "status": "CONFIRMED",
    },
    {
        "id": "cap_subst_pool",
        "file_off": 0x042654,
        "name": "pool_cap_mismatch_substitute",
        "summary": "42654 — pool cap≠weapon → lcall DF20(493E0) + call 41914",
        "status": "CONFIRMED",
    },
    {
        "id": "loadout_cap_flag",
        "file_off": 0x03D410,
        "name": "loadout_prep_cap_flag",
        "summary": "3D3DB — pool walk; cap≠→ or [rec+0xA4]; 3D42A 直前",
        "status": "CONFIRMED",
    },
    {
        "id": "loadout_builder",
        "file_off": 0x03D42A,
        "name": "loadout_ui_build_and_link",
        "summary": "記述子 walk; mag_type @ 3D540; +0xCE @ 3D68F — cap/index 差替なし",
        "status": "CONFIRMED",
    },
    {
        "id": "gather_pool",
        "file_off": 0x03D042,
        "name": "gather_mission_candidates",
        "summary": "DS:0x270 → 6B 列; member+0x8A/+0x84 フィルタ; cap/771E 未使用",
        "status": "CONFIRMED",
    },
    {
        "id": "cat18_scan",
        "file_off": 0x00771E,
        "name": "ammo_index_cat18_scan",
        "summary": "weapon cat18 → ammo_indices[+0x2C] walk — 静的 caller 0",
        "status": "UNREACHABLE_STATIC",
    },
]


def read_ne(data: bytes) -> list[dict]:
    ne = struct.unpack_from("<I", data, 0x3C)[0]
    align = 1 << struct.unpack_from("<H", data, ne + 0x32)[0]
    n = struct.unpack_from("<H", data, ne + 0x1C)[0]
    sa = ne + struct.unpack_from("<H", data, ne + 0x22)[0]
    segs = []
    for i in range(n):
        o = sa + i * 8
        raw, ln, fl, _ = struct.unpack_from("<HHHH", data, o)
        start = raw * align
        segs.append({"num": i + 1, "start": start, "len": ln if ln else 65536})
    return segs


def read_cbe(data: bytes, idx: int) -> dict:
    off = TABLE_BASE + idx * 64
    rec = data[off : off + 64]
    return {
        "idx": idx,
        "category": struct.unpack_from("<H", rec, 2)[0],
        "mag_type": struct.unpack_from("<H", rec, 0x2A)[0],
        "mag_cap": struct.unpack_from("<H", rec, 0x28)[0],
        "u27": struct.unpack_from("<H", rec, 0x36)[0],
        "ammo_indices": [struct.unpack_from("<H", rec, 0x2C + i * 2)[0] for i in range(4)],
    }


def disasm(data: bytes, start: int, size: int, tags: tuple[tuple[str, str], ...]) -> list[str]:
    md = Cs(CS_ARCH_X86, CS_MODE_16)
    lines = []
    for ins in md.disasm(data[start : start + size], start):
        op = ins.op_str.lower()
        mark = ""
        for key, tag in tags:
            if key in op:
                mark = f" ; {tag}"
                break
        if mark or ins.mnemonic in ("cmp", "call", "lcall", "retf", "enter", "je", "jne", "test"):
            lines.append(f"{ins.address:06X}  {ins.mnemonic:6s} {ins.op_str}{mark}")
    return lines


def find_near_calls(data: bytes, target: int) -> list[str]:
    out = []
    p = 0
    while True:
        i = data.find(bytes([0xE8]), p)
        if i < 0:
            break
        if i + 3 <= len(data):
            rel = struct.unpack_from("<h", data, i + 1)[0]
            if i + 3 + rel == target:
                out.append(f"0x{i:06X}")
        p = i + 1
    return out


def scan_seg_u16(data: bytes, seg: dict, val: int) -> list[str]:
    st, en = seg["start"], seg["start"] + seg["len"]
    chunk = data[st:en]
    hits = []
    for i in range(0, len(chunk) - 1, 2):
        if struct.unpack_from("<H", chunk, i)[0] == val:
            hits.append(f"0x{st + i:06X}")
    return hits


def scenario_context(data: bytes, off: int) -> dict:
    """272 出現点の前後 u16 を表示。"""
    words = [struct.unpack_from("<H", data, off - 16 + i * 2)[0] for i in range(16)]
    labels = []
    for i, w in enumerate(words):
        pos = off - 16 + i * 2
        labels.append({"file": f"0x{pos:06X}", "u16": w})
    return {"center_file": f"0x{off:06X}", "u16_window": labels}


def scenario_pairs(data: bytes, off: int, n: int = 4) -> list[dict]:
    pairs = []
    for i in range(n):
        base = off + i * 4
        if base + 4 > len(data):
            break
        idx, qty = struct.unpack_from("<HH", data, base)
        pairs.append({"idx": idx, "qty": qty, "file": f"0x{base:06X}"})
    return pairs


def main() -> None:
    if not CBE_PATH.is_file():
        raise SystemExit(f"CBE not found: {CBE_PATH}")

    data = CBE_PATH.read_bytes()
    segs = read_ne(data)
    kar98k = read_cbe(data, 57)
    a272 = read_cbe(data, 272)
    a273 = read_cbe(data, 273)

    seg132 = segs[131]
    hits272 = scan_seg_u16(data, seg132, 272)
    hits273 = scan_seg_u16(data, seg132, 273)

    tags = (
        ("+ 0x28", "cap"),
        ("+ 0x2a", "mag_type"),
        ("+ 0x2c", "ammo"),
        ("+ 0xa4", "+0xA4"),
        ("+ 0x8a", "+0x8A"),
        ("0x270", "pool"),
        ("+ 0xce", "+0xCE"),
        ("call", "call"),
        ("lcall", "call"),
    )

    payload = {
        "generated": date.today().isoformat(),
        "anchors": ANCHORS,
        "kar98k": kar98k,
        "ammo_272": a272,
        "ammo_273": a273,
        "scenario_block": {
            "file_off": f"0x{SCENARIO_BLOCK:06X}",
            "seg": 132,
            "seg_rel": f"0x{SCENARIO_BLOCK - seg132['start']:06X}",
            "pairs_at_272": scenario_pairs(data, SCENARIO_BLOCK, 4),
            "context_window": scenario_context(data, SCENARIO_BLOCK),
            "u16_272_in_seg": hits272[:20],
            "u16_273_in_seg": hits273[:20],
        },
        "xrefs": {
            "42654": find_near_calls(data, 0x42654),
            "4240C": find_near_calls(data, 0x4240C),
            "771E": find_near_calls(data, 0x771E),
        },
        "disasm_cap_subst_42654": disasm(data, 0x042654, 0x90, tags),
        "disasm_squad_424B1": disasm(data, 0x042475, 0xB0, tags),
        "disasm_loadout_cap_3D3F0": disasm(data, 0x3D3F0, 0x40, tags),
        "disasm_loadout_mag_3D530": disasm(data, 0x3D530, 0x20, tags),
        "disasm_pool_build_495B0": disasm(data, 0x495B0, 0x60, tags),
    }

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    pairs = payload["scenario_block"]["pairs_at_272"]
    ctx = payload["scenario_block"]["context_window"]["u16_window"]
    lines = [
        "# CBE 273→272 実経路 RE",
        "",
        f"**生成**: {payload['generated']} — `python scripts/re_cbe_273_272_path.py`",
        "",
        "## 結論",
        "",
        "### 273→272 は **単一命令の差替ではない** — 3 段パイプライン",
        "",
        "| 段 | 関数 (file) | 役割 |",
        "|----|-------------|------|",
        "| **1. 在庫供給** | `mission_pool_build` @ **`0x0494EC`** (lcall E02C) | シナリオ/小隊データ → **`DS:0x270`** u16 列。272/273 **両方** 載るデータあり |",
        "| **2. cap フィルタ** | `squad_roster_pool_scan` @ **`0x04240C`** | `cmp pool_cap, weapon_cap` @ **424B1** — 不一致→422B8 / **+0xA4** |",
        "| **2b. 差替試行** | `pool_cap_mismatch_substitute` @ **`0x042654`** | cap 不一致 → **lcall 493E0** + **41914**（4240C 空時） |",
        "| **2c. UI 準備** | loadout prep @ **`0x03D410`** | cap 不一致 → **`or [rec+0xA4]`**（3D42A 直前） |",
        "| **3. リスト化** | `loadout_ui_build` @ **`0x03D42A`** | **mag_type @ 3D540** のみ — **cap cmp / index 差替なし** |",
        "",
        "> **Kar98k 静的 `ammo_indices`** = `[273,…]` だが、**mission pool に 272 が独立 entry として存在**すれば",
        "> cap 不一致の 273 は **+0xA4 フラグ** / validate 落ち、**272 が採用**される。",
        "> **build_ui_ammo_list の lcall D3B0** は cap **一致**時のみ — 273→272 本体 **ではない**（[PL_CBE_D3B0_SUBSTITUTE_RE.md](./PL_CBE_D3B0_SUBSTITUTE_RE.md)）。",
        "",
        "### 静的 CBE データ",
        "",
        f"| | Kar98k (57) | 272 (7.92-5) | 273 (7.92-10G) |",
        f"|--|-------------|--------------|----------------|",
        f"| ammo_indices | `{kar98k['ammo_indices']}` | **indices 外** | `[0]` |",
        f"| mag_cap | **{kar98k['mag_cap']}** | **{a272['mag_cap']}** | **{a273['mag_cap']}** |",
        f"| mag_type (+0x2A) | **{kar98k['mag_type']}** | **{a272['mag_type']}** | **{a273['mag_type']}** |",
        f"| u27 | **{kar98k['u27']}** | **{a272['u27']}** | **{a273['u27']}** |",
        "",
        "### シナリオ埋込データ（seg132）",
        "",
        f"file **`0x{SCENARIO_BLOCK:06X}`** — 単位装備テーブル内に **272(qty4) と 273(qty6) が共存**:",
        "",
        "**前後 u16 ウィンドウ** (272 @ center):",
        "",
        "| file | u16 | 注 |",
        "|------|-----|-----|",
    ]
    for row in ctx:
        note = ""
        if row["u16"] == 272:
            note = "7.92-5"
        elif row["u16"] == 273:
            note = "7.92-10G"
        elif row["u16"] == 55:
            note = "Gew98?"
        lines.append(f"| `{row['file']}` | **{row['u16']}** | {note} |")

    lines.extend(
        [
            "",
            "**272 地点を (idx,qty) と解釈**:",
            "",
            "| idx | qty |",
            "|-----|-----|",
        ]
    )
    for p in pairs:
        lines.append(f"| **{p['idx']}** | {p['qty']} |")

    lines.extend(
        [
            "",
            f"- seg132 内 u16=**272**: {len(hits272)} 件 (`{hits272[0] if hits272 else '—'}` …)",
            f"- seg132 内 u16=**273**: {len(hits273)} 件",
            "",
            "## パイプライン詳細",
            "",
            "```",
            "scenario / unit table (seg132 等)",
            "  └─ lcall E02C @ 0x0494EC  ← 42566 から",
            "       push weapon_cap → lcall DE4A @ 0x04930A",
            "       → DS:0x270[] = { cbe index, …, -1 }",
            "",
            "装備/小隊 UI @ 0x4240C",
            "  weapon_cap = member[+0x28]",
            "  for idx in pool:",
            "    if pool[idx].cap == weapon_cap → accept",
            "    else test [rec+0xA4] & (slot+1); call 422B8 validate",
            "  if empty → call 0x42654 (cap mismatch substitute)",
            "",
            "装填 UI open (3D1BA)",
            "  3D3DB: pool walk → cap≠ → or [rec+0xA4]",
            "  3D42A: [ad1c+0x46] 記述子 → nested index",
            "         cmp [cbe+0x2A], cx @ 3D540  (mag_type gate)",
            "         → weapon_row +0xCE/+0xD0/+0xD2",
            "",
            "gather @ 0x3D042 (別経路)",
            "  pool → 6B entry; filter member+0x8A/+0x84 — cap 未使用",
            "```",
            "",
            "## 確定アンカー",
            "",
            "### cap 不一致 @ squad scan — `0x0424B1`",
            "",
            "```asm",
            *payload["disasm_squad_424B1"],
            "```",
            "",
            "### cap 不一致 → substitute 試行 — `0x042654`",
            "",
            "```asm",
            *payload["disasm_cap_subst_42654"],
            "```",
            "",
            "### loadout 準備 cap フラグ — `0x03D410`",
            "",
            "```asm",
            *payload["disasm_loadout_cap_3D3F0"],
            "```",
            "",
            "### mag_type ゲート（差替なし）— `0x03D540`",
            "",
            "```asm",
            *payload["disasm_loadout_mag_3D530"],
            "```",
            "",
            "### pool 構築 cap push — `0x0495B5`",
            "",
            "```asm",
            *payload["disasm_pool_build_495B0"],
            "```",
            "",
            "## `@ 0x771E` cat18 / ammo_indices",
            "",
            f"near `call 0x771E`: **{len(payload['xrefs']['771E'])} 件** — 装填 UI 候補列とは **静的に未接続**。",
            "cat18 時 `add ax,0x2C` → ammo_indices[0..3] と cmp — **別バイナリ/動的**の可能性。",
            "",
            "## ST 再現指針",
            "",
            "1. **正本**: mission pool に **272 と 273 が別 entry** → cap/mag_type/+0xA4 で 273 落ち 272 残る",
            "2. **暫定 `applyMagCapSubstitute`**: pool 構築 + cap フィルタの **データ側圧縮** — 方向性は整合",
            "3. **3D42A 単体**では 273→272 **起きない** — upstream pool が正本",
            "4. **771E / ammo_indices 静的走査**は本 EXE では装填 UI に未接続",
            "",
            "## 未完了",
            "",
            "1. seg132 テーブル → runtime `DS:0x270` コピーの **完全マップ**（シナリオファイル形式）",
            "2. `lcall DE4A` @ 0x4930A 返値 — 272 即値化の有無",
            "3. packed 記述子 `cx` nibble と Kar98k mag_type=0 の対応",
            "",
            "## 関連",
            "",
            "- [PL_CBE_LOADOUT_CANDIDATE_RE.md](./PL_CBE_LOADOUT_CANDIDATE_RE.md)",
            "- [PL_CBE_D3B0_SUBSTITUTE_RE.md](./PL_CBE_D3B0_SUBSTITUTE_RE.md)",
            "- [PL_CBE_CAP_SUBSTITUTE_RE.md](./PL_CBE_CAP_SUBSTITUTE_RE.md)",
            "- [PL_CBE_EQUIP_CHAIN_RE.md](./PL_CBE_EQUIP_CHAIN_RE.md)",
            "- [PL_CBE_VALIDATE_422B8_RE.md](./PL_CBE_VALIDATE_422B8_RE.md)",
            "",
        ]
    )

    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT_MD.relative_to(ROOT)}")
    print(f"272 hits seg132: {len(hits272)}, 273: {len(hits273)}")


if __name__ == "__main__":
    main()

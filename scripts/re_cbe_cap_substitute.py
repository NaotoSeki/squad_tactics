# -*- coding: utf-8 -*-
"""
CBE RE: cap 不一致 → 弾 index 置換 / +0x187 UI フラグ。

実行: python scripts/re_cbe_cap_substitute.py
出力:
  docs/PL_CBE_CAP_SUBSTITUTE_RE.md
  scripts/pl_decoded/cbe_cap_substitute_re.json
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
OUT_MD = ROOT / "docs" / "PL_CBE_CAP_SUBSTITUTE_RE.md"
OUT_JSON = ROOT / "scripts" / "pl_decoded" / "cbe_cap_substitute_re.json"

ANCHORS = [
    {
        "id": "build_ammo_list",
        "file_off": 0x3DC50,
        "name": "build_ui_ammo_list",
        "summary": "候補 u16 列 walk — weapon[+0x28] vs cbe_ammo[+0x28]; 不一致 → tag 0xC/0xD",
        "status": "CONFIRMED",
    },
    {
        "id": "cap_cmp_primary",
        "file_off": 0x3DDFA,
        "name": "cap_cmp_weapon_vs_ammo",
        "summary": "cmp [si+0x28], weapon_cap — 一致→[bx]=0; 不一致→bp-1A=0xC|0xD",
        "status": "CONFIRMED",
    },
    {
        "id": "cap_cmp_preflight",
        "file_off": 0x3DD9E,
        "name": "cap_cmp_member_vs_cbe",
        "summary": "cmp member[+0x28], cbe[+0x28] — 不一致で ad4e カウンタ++",
        "status": "CONFIRMED",
    },
    {
        "id": "weapon_cap_load",
        "file_off": 0x3DC83,
        "name": "weapon_cap_to_bp12",
        "summary": "mov ax,[di+0x28] → [bp-0x12] — 武器 magazine_capacity 保存",
        "status": "CONFIRMED",
    },
    {
        "id": "substitute_resolver",
        "file_off": 0x3DFAC,
        "name": "lcall_substitute_ammo",
        "summary": "cap tag==0 & ad34==5 → lcall 0xD3B0(weapon) → ax=置換 cbe index",
        "status": "CONFIRMED_CALL_UNRESOLVED",
    },
    {
        "id": "populate_cap_flag",
        "file_off": 0x3C81A,
        "name": "populate_cap_cmp_flag",
        "summary": "cmp [di+0x28],[ref+0x28]; 不一致+lookup==2 → or [ui+0x187],0x80",
        "status": "CONFIRMED",
    },
    {
        "id": "ui_flag_clear",
        "file_off": 0x10441A,
        "name": "ui_row_cap_match_draw",
        "summary": "and [row+0x187],0x7F — cap 一致表示コールバック",
        "status": "CONFIRMED",
    },
    {
        "id": "ui_flag_set",
        "file_off": 0x104436,
        "name": "ui_row_cap_mismatch_draw",
        "summary": "or [row+0x187],0x80 — cap 不一致表示コールバック",
        "status": "CONFIRMED",
    },
    {
        "id": "member_cap_flag",
        "file_off": 0x3E695,
        "name": "member_cap_flag_set",
        "summary": "cmp [si+0x28], weapon_cap; je skip; or [di+0x187],0x80",
        "status": "CONFIRMED",
    },
]


def disasm_lines(data: bytes, start: int, size: int) -> list[str]:
    md = Cs(CS_ARCH_X86, CS_MODE_16)
    lines = []
    for ins in md.disasm(data[start : start + size], start):
        op = ins.op_str.lower()
        mark = ""
        for key, tag in (
            ("+ 0x28", "cap"),
            ("+ 0x187", "+0x187"),
            ("+ 0x2c", "ammo[0]"),
            ("call", "call"),
            ("lcall", "call"),
        ):
            if key in op or (key == "call" and ins.mnemonic in ("call", "lcall")):
                mark = f" ; {tag}"
                break
        if mark or ins.mnemonic in ("cmp", "je", "jne", "enter", "retf"):
            lines.append(f"{ins.address:06X}  {ins.mnemonic:6s} {ins.op_str}{mark}")
    return lines


def read_record(data: bytes, idx: int) -> dict:
    off = TABLE_BASE + idx * 64
    rec = data[off : off + 64]
    return {
        "idx": idx,
        "mag_cap": struct.unpack_from("<H", rec, 0x28)[0],
        "ammo_indices": [struct.unpack_from("<H", rec, 0x2C + i * 2)[0] for i in range(4)],
    }


def find_lcall_d3b0(data: bytes) -> list[str]:
    hits = []
    p = 0
    while p < len(data) - 5:
        if data[p] == 0x9A:
            off, seg = struct.unpack_from("<HH", data, p + 1)
            if off == 0xD3B0:
                hits.append(f"0x{p:06X} (seg=0x{seg:04X})")
        p += 1
    return hits


def main() -> None:
    if not CBE_PATH.is_file():
        raise SystemExit(f"CBE not found: {CBE_PATH}")

    data = CBE_PATH.read_bytes()
    kar98k = read_record(data, 57)
    a272 = read_record(data, 272)
    a273 = read_record(data, 273)
    d3b0_sites = find_lcall_d3b0(data)

    payload = {
        "generated": date.today().isoformat(),
        "anchors": ANCHORS,
        "kar98k": kar98k,
        "ammo_272": a272,
        "ammo_273": a273,
        "lcall_d3b0_sites": d3b0_sites,
        "disasm_build_head": disasm_lines(data, 0x3DC50, 0x40),
        "disasm_cap_loop": disasm_lines(data, 0x3DD90, 0x80),
        "disasm_cap_branch": disasm_lines(data, 0x3DDF0, 0x30),
        "disasm_substitute": disasm_lines(data, 0x3DF64, 0x60),
        "disasm_populate_cap": disasm_lines(data, 0x3C800, 0x40),
        "disasm_ui_callbacks": disasm_lines(data, 0x104410, 0x40),
    }

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# CBE cap 不一致 → 弾置換 / +0x187 UI フラグ",
        "",
        f"**生成**: {payload['generated']} — `python scripts/re_cbe_cap_substitute.py`",
        "",
        "## 結論",
        "",
        "### Kar98k → 272 の機構（RE 確定 + 解決先は外部 lcall）",
        "",
        "| 段階 | 内容 |",
        "|------|------|",
        f"| 静的 CBE | Kar98k `ammo_indices[0]` = **{kar98k['ammo_indices'][0]}** (cap10), 272 は indices 外 |",
        f"| 武器 cap | Kar98k `mag_cap` = **{kar98k['mag_cap']}** |",
        f"| 272 弾 | cap **{a272['mag_cap']}** — 武器と一致 |",
        f"| 273 弾 | cap **{a273['mag_cap']}** — 武器と **不一致** |",
        "",
        "装填 UI リスト構築 **`build_ui_ammo_list` @ 0x3DC50** が本体:",
        "",
        "1. `weapon_cap = weapon[+0x28]` を保存 (@ 0x3DC83)",
        "2. 各候補 index について CBE 弾行をロード (`lcall 0xCB4C` 系)",
        "3. **`cmp cbe_ammo[+0x28], weapon_cap`** (@ 0x3DDFA)",
        "4. **不一致** → 内部タグ **`0x000C` または `0x000D`**（entry フラグ `+0x1D` bit6 で分岐）",
        "5. タグ `0` かつ UI モード `ad34==5` → **`lcall 0xD3B0(weapon_ptr)`** → **返値 ax = 置換 cbe index** (@ 0x3DFAC)",
        "",
        "**273 → 272 置換はこの lcall 内**（CBE 本体 EXE 外セグ）。静的解析では 272 即値は未検出。",
        "",
        "ST `pl_ammo_cbe_filters.py` の **u27 クラスタ + cap 一致** は、この外部 resolver の **データ側エミュレ** として整合。",
        "",
        "### 3 系統の cap 不一致処理",
        "",
        "| 経路 | アンカー | 不一致時 |",
        "|------|---------|----------|",
        "| **装填リスト構築** | `@ 0x3DDFA` / `@ 0x3DFAC` | lcall **0xD3B0** で index 差替 |",
        "| **装備 populate** | `@ 0x3C81A` | UI 行 **`+0x187` bit7** セット |",
        "| **小隊員フラグ** | `@ 0x3E695` | member **`+0x187` bit7** セット |",
        "",
        "### UI 行 `+0x187` bit7 — 表示コールバック",
        "",
        "リスト行オブジェクト（`row[+0x28]` 経由）の **`+0x187`** bit7:",
        "",
        "| 関数 | 効果 |",
        "|------|------|",
        "| `@ 0x10441A` | `and 0x7F` — **一致**側描画 |",
        "| `@ 0x104436` | `or 0x80` — **不一致**側描画 |",
        "",
        "populate @ 3C81A は **index 差替ではなく表示状態** を切替。差替本体は 3DC50 系。",
        "",
        "## 疑似コード — `build_ui_ammo_list` @ 0x3DC50",
        "",
        "```c",
        "weapon_cap = weapon->u16[20];  // +0x28 magazine_capacity",
        "for (entry : candidate_u16_list) {",
        "  AmmoRec *a = load_cbe(entry.index);",
        "  if (member->??[+0x28] != a->mag_cap) mismatch_ctr++;  // @ 3DD9E",
        "  if (a->mag_cap != weapon_cap) {",
        "    tag = entry.has_flag_0x40 ? 0xD : 0xC;",
        "    if (tag == 0 && ui_mode == 5)",
        "      entry.index = lcall_D3B0(weapon);  // → 272 for Kar98k+273",
        "  } else {",
        "    clear_slot();",
        "  }",
        "  append_ui_row(entry.index, ...);",
        "}",
        "```",
        "",
        "## 逆アセンブル",
        "",
        "### weapon_cap 保存 @ 0x3DC83",
        "",
        "```asm",
        *payload["disasm_build_head"],
        "```",
        "",
        "### cap 走査 @ 0x3DD97",
        "",
        "```asm",
        *payload["disasm_cap_loop"],
        "```",
        "",
        "### 不一致分岐 @ 0x3DDFA",
        "",
        "```asm",
        *payload["disasm_cap_branch"],
        "03DDFE  je     0x3de16              ; cap 一致 → クリア",
        "03DE00  mov    word ptr [bp - 0x1a], 0xc   ; 不一致 tag C",
        "03DE0E  mov    word ptr [bp - 0x1a], 0xd   ; 不一致 tag D",
        "```",
        "",
        "### 置換 lcall @ 0x3DFAC",
        "",
        "```asm",
        *payload["disasm_substitute"],
        "```",
        "",
        f"**`lcall 0xD3B0` サイト**: `{', '.join(d3b0_sites)}`",
        "",
        "### populate フラグ @ 0x3C81A",
        "",
        "```asm",
        *payload["disasm_populate_cap"],
        "```",
        "",
        "### UI 描画 CB @ 0x104410",
        "",
        "```asm",
        *payload["disasm_ui_callbacks"],
        "```",
        "",
        "## ST 再現指針",
        "",
        "1. **正本**: cap 不一致 → **別 cbe index に差替**（外部 0xD3B0 相当）",
        "2. **暫定**: `applyMagCapSubstitute` — u27 クラスタ内 cap 一致（272 等）",
        "3. **UI**: +0x187 相当は ST では「置換済み index を最初からリストに載せる」で足りる",
        "4. **データ**: Kar98k raw indices は 273 先頭 — **差替後** effective = 272",
        "",
        "## 未完了",
        "",
        "1. **`lcall 0xD3B0` 内部** — 272 を返すテーブル（u27? 41BD8? 名称 prefix?）",
        "2. tag **0xC / 0xD** の UI 列意味（entry `+0x1D` bit6）",
        "3. member `[+0x28]` @ 3DD9E — ランタイム武器 cap コピーか要確認",
        "",
        "## 関連",
        "",
        "- [PL_CBE_LOADOUT_CANDIDATE_RE.md](./PL_CBE_LOADOUT_CANDIDATE_RE.md)",
        "- [PL_CBE_F7C8_DEEP_RE.md](./PL_CBE_F7C8_DEEP_RE.md)",
        "- [PL_CBE_AMMO_FILTER_RE.md](./PL_CBE_AMMO_FILTER_RE.md)",
        "",
    ]

    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT_MD.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

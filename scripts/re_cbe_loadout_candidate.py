# -*- coding: utf-8 -*-
"""
CBE RE: 装填 UI 候補 index 列 — 0x3D42A 上流 / mission pool / cap @ 3C81A。

実行: python scripts/re_cbe_loadout_candidate.py
出力:
  docs/PL_CBE_LOADOUT_CANDIDATE_RE.md
  scripts/pl_decoded/cbe_loadout_candidate_re.json
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
OUT_MD = ROOT / "docs" / "PL_CBE_LOADOUT_CANDIDATE_RE.md"
OUT_JSON = ROOT / "scripts" / "pl_decoded" / "cbe_loadout_candidate_re.json"

ANCHORS = [
    {
        "id": "mission_pool_walk",
        "file_off": 0x3CC79,
        "name": "mission_pool_iterate",
        "summary": "DS:0x270 終端<0 まで u16 index — 小隊員 +0x8A/+0x83 フィルタ",
        "status": "CONFIRMED",
    },
    {
        "id": "gather_candidates",
        "file_off": 0x3D042,
        "name": "gather_mission_candidates",
        "summary": "mission pool → 6B 作業 → u16 index 列 + 0xFFFF（cat18/ammo_indices 無し）",
        "status": "CONFIRMED",
    },
    {
        "id": "attach_list",
        "file_off": 0x3BFFE,
        "name": "attach_candidate_list",
        "summary": "weapon_row 引数 → call 3D042 → call 3B758 検証",
        "status": "CONFIRMED",
    },
    {
        "id": "prepare_session",
        "file_off": 0x3D72A,
        "name": "prepare_loadout_ad1c",
        "summary": "ad18 テンプレ → ad1c; call 3DBC2 ×2 で +0x46 列 blob 構築",
        "status": "CONFIRMED",
    },
    {
        "id": "loadout_builder",
        "file_off": 0x3D42A,
        "name": "loadout_ui_build_and_link",
        "summary": "[ad1c+0x46] packed 記述子 walk → mag_type @ 3D540 → +0xCE @ 3D68F",
        "status": "CONFIRMED",
    },
    {
        "id": "mag_type_member_gate",
        "file_off": 0x3D540,
        "name": "loadout_mag_type_gate",
        "summary": "cmp word ptr es:[di+0x2A], cx — 小隊員 mag_type 一致",
        "status": "CONFIRMED",
    },
    {
        "id": "cap_cmp_populate",
        "file_off": 0x3C81A,
        "name": "populate_cap_cmp",
        "summary": "cmp word ptr es:[di+0x28], ax — 静的 CBE +0x28 magazine_capacity 照合（populate 経路）",
        "status": "CONFIRMED",
    },
    {
        "id": "cat18_scan",
        "file_off": 0x771E,
        "name": "ammo_index_cat18_scan",
        "summary": "category-0x12 → ammo_indices[+0x2C..] — **本 EXE 内 near/lcall 呼び出し 0 件**",
        "status": "UNREACHABLE_OR_DYNAMIC",
    },
]


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
        segs.append({"file_start": start, "file_end": start + (ln if ln else 65536), "is_code": (fl & 1) == 0})
    return segs


def disasm(data: bytes, start: int, size: int) -> list[str]:
    md = Cs(CS_ARCH_X86, CS_MODE_16)
    lines = []
    for ins in md.disasm(data[start : start + size], start):
        op = ins.op_str.lower()
        mark = ""
        for key, tag in (
            ("+ 0x28", "cap/+0x28"),
            ("+ 0x2a", "mag"),
            ("+ 0x2c", "ammo[0]"),
            ("+ 0x46", "+0x46"),
            ("+ 0x8a", "+0x8A"),
            ("+ 0x84", "+0x84"),
            ("0x270", "pool"),
            ("ad1c", "ad1c"),
            ("call", "call"),
            ("lcall", "call"),
        ):
            if key in op or (key == "call" and ins.mnemonic in ("call", "lcall")):
                mark = f" ; {tag}"
                break
        if mark or ins.mnemonic in ("cmp", "call", "lcall", "enter", "retf"):
            lines.append(f"{ins.address:06X}  {ins.mnemonic:6s} {ins.op_str}{mark}")
    return lines


def read_cbe_record(data: bytes, idx: int) -> dict:
    off = TABLE_BASE + idx * 64
    rec = data[off : off + 64]
    if len(rec) < 64:
        return {}
    ammo = [struct.unpack_from("<H", rec, 0x2C + i * 2)[0] for i in range(4)]
    return {
        "idx": idx,
        "category": struct.unpack_from("<H", rec, 2)[0],
        "mag_type": struct.unpack_from("<H", rec, 0x2A)[0],
        "mag_cap": struct.unpack_from("<H", rec, 0x28)[0],
        "ammo_indices": ammo,
    }


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


def main() -> None:
    if not CBE_PATH.is_file():
        raise SystemExit(f"CBE not found: {CBE_PATH}")

    data = CBE_PATH.read_bytes()
    segs = parse_ne(data)

    kar98k = read_cbe_record(data, 57)
    ammo272 = read_cbe_record(data, 272)
    ammo273 = read_cbe_record(data, 273)

    xrefs = {
        "gather_3D042": find_near_calls(data, 0x3D042),
        "attach_3BFFE": find_near_calls(data, 0x3BFFE),
        "mission_iter_3CC54": find_near_calls(data, 0x3CC54),
        "prepare_3D72A": find_near_calls(data, 0x3D72A),
        "loadout_3D42A": find_near_calls(data, 0x3D42A),
        "cat18_771E": find_near_calls(data, 0x771E),
        "mag_type_18BF3": find_near_calls(data, 0x18BF3),
    }

    payload = {
        "generated": date.today().isoformat(),
        "anchors": ANCHORS,
        "xrefs_near_call": xrefs,
        "kar98k_cbe": kar98k,
        "ammo_272": ammo272,
        "ammo_273": ammo273,
        "disasm_gather": disasm(data, 0x3D048, 0xE0),
        "disasm_mission_iter": disasm(data, 0x3CC79, 0x90),
        "disasm_cap_cmp": disasm(data, 0x3C800, 0x40),
        "disasm_loadout_list_read": disasm(data, 0x3D4B0, 0x80),
    }

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# CBE 装填 UI — 候補 index 列 RE（0x3D42A 上流）",
        "",
        f"**生成**: {payload['generated']} — `python scripts/re_cbe_loadout_candidate.py`",
        "",
        "## 結論",
        "",
        "### 272 / Kar98k — データ vs UI 経路",
        "",
        "| 項目 | 値 |",
        "|------|-----|",
        f"| Kar98k (cbe **57**) `ammo_indices` | `{kar98k.get('ammo_indices')}` |",
        f"| Kar98k `mag_cap` (+0x28) | **{kar98k.get('mag_cap')}** |",
        f"| 7.92-5 (**272**) cat / cap | cat **{ammo272.get('category')}**, cap **{ammo272.get('mag_cap')}** |",
        f"| 7.92-10G (**273**) cat / cap | cat **{ammo273.get('category')}**, cap **{ammo273.get('mag_cap')}** |",
        "",
        "**静的 CBE テーブルに 272 は Kar98k の ammo_indices に無い（先頭は 273）。**",
        "UI に 272 が出るなら、**mission pool（0x270 列）** か **populate cap 置換** が経路。",
        "",
        "### パイプライン（確定）",
        "",
        "```",
        "mission pool  DS:0x270  (u16[] until <0)",
        "  @ 0x3CC54  mission_pool_iterate",
        "  @ 0x3D042  gather_mission_candidates",
        "      filter: member[+0x8A], member[+0x84/+0x8E]",
        "      output: u16 cbe index[] + 0xFFFF",
        "      ※ cat18 / ammo_indices / 771E 未使用",
        "",
        "  @ 0x3BFFE  attach_candidate_list → 3B758 互換検証",
        "",
        "open loadout UI",
        "  @ 0x3D1BA  open_loadout_ui_session",
        "  @ 0x3D72A  prepare_loadout_ad1c",
        "      ad18 テンプレ copy → es:[ad1c]",
        "      call 0x3DBC2 ×2  … +0x46/+0x48 列 blob",
        "  @ 0x3D42A  loadout_ui_build_and_link",
        "      read far ptr [ad1c+0x46]",
        "      walk packed 記述子 → nested u16 index",
        "      @ 0x3D540  mag_type gate",
        "      @ 0x3D68F  widget → weapon_row +0xCE/+0xD0/+0xD2",
        "",
        "装備 composite 列（別系統）",
        "  @ 0xF7C8 / populate 0x3C652",
        "      @ 0x3C81A  cmp [di+0x28] magazine_capacity  ← cap 照合はここ",
        "```",
        "",
        "### cap 照合 — **初の確定 cmp**",
        "",
        "`@ 0x3C81A`（populate / `call 0x3C652` 経路 — F7C8 装備列）:",
        "",
        "```asm",
        "mov    ax, word ptr es:[si + 0x28]",
        "cmp    word ptr es:[di + 0x28], ax   ; weapon cap vs ref cap",
        "je     skip_flag",
        "... or byte ptr es:[bx + 0x187], 0x80",
        "```",
        "",
        "**3D42A 装填リスト構築本体に cap cmp は無し。** mag_type @ 0x3D540 のみ。",
        "",
        "### `@ 0x771E` cat18 / ammo_indices",
        "",
        f"near `call 0x771E`: **{len(xrefs['cat18_771E'])} 件** — 本 EXE 静的解析では呼び出し元不明。",
        "装填 UI 候補列（3D042）とは **別経路** の可能性大（loadout 確定 / 未使用コード）。",
        "",
        "## near call  xref",
        "",
        "| 関数 | 呼び出し元 |",
        "|------|-----------|",
    ]
    for k, v in xrefs.items():
        name = k.split("_", 1)[-1]
        lines.append(f"| `{name}` | `{', '.join(v) or '—'}` |")

    lines.extend(
        [
            "",
            "## `@ 0x3D042` gather（mission pool → index 列）",
            "",
            "```asm",
            *payload["disasm_gather"],
            "```",
            "",
            "## `@ 0x3CC79` mission pool iterate",
            "",
            "```asm",
            *payload["disasm_mission_iter"],
            "```",
            "",
            "## `@ 0x3C81A` populate cap cmp",
            "",
            "```asm",
            *payload["disasm_cap_cmp"],
            "```",
            "",
            "## `@ 0x3D4B4` loadout 記述子 read",
            "",
            "```asm",
            *payload["disasm_loadout_list_read"],
            "```",
            "",
            "## ST 暫定 magCap フィルタとの関係",
            "",
            "- CBE 静的: Kar98k → **273**（cap10）、272（cap5）は indices 外",
            "- ST 仮説「272 置換」は **データ整合 + 攻略本** — populate @ 3C81A が UI 側 cap ゲートの正本候補",
            "- 装填 **候補列そのもの** は mission pool 由来 — **シナリオ/ミッション在庫** が 272 を含むかが次のデータ RE",
            "",
            "## 次の RE",
            "",
            "1. **mission pool `DS:0x270`** の静的初期値 / シナリオファイルからのロード",
            "2. populate @ 3C81A — cap 不一致時 `+0x187` フラグ → **272 表示への接続**",
            "3. packed 記述子（3D4D2）の group nibble — 列ごとの候補束ね",
            "4. `@ 0x771E` — 動的呼び出し or 別バイナリ（loadout 確定のみ？）",
            "",
            "## 関連",
            "",
            "- [PL_CBE_F7C8_DEEP_RE.md](./PL_CBE_F7C8_DEEP_RE.md)",
            "- [PL_CBE_AMMO_FILTER_RE.md](./PL_CBE_AMMO_FILTER_RE.md)",
            "- [PL_CBE_AMMO_UI_LOADLIST_RE.md](./PL_CBE_AMMO_UI_LOADLIST_RE.md)",
            "",
        ]
    )

    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT_MD.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

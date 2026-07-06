# -*- coding: utf-8 -*-
"""
CBE RE: loadout pass2 @ 3D59C — buffer 0x1EC 列 + E02C 構築。

実行: python scripts/re_cbe_pass2_1ec.py
出力:
  docs/PL_CBE_PASS2_1EC_RE.md
  scripts/pl_decoded/cbe_pass2_1ec_re.json
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
    ("+ 0xba", "+0xBA"),
    ("+ 0x3e", "+0x3E"),
    ("+ 0x80", "+0x80"),
    ("+ 0x2a", "mag_type"),
    ("0x1ec", "pool1EC"),
    ("0x270", "pool270"),
    ("0x128", "bufA"),
    ("0x18a", "bufB"),
    ("0xe02c", "E02C"),
)


def disasm(data: bytes, start: int, size: int) -> list[str]:
    md = Cs(CS_ARCH_X86, CS_MODE_16)
    lines = []
    for ins in md.disasm(data[start : start + size], start):
        op = ins.op_str.lower()
        tag = next((t for k, t in MARK if k in op), "")
        lines.append(f"{ins.address:06X}  {ins.mnemonic:6s} {ins.op_str}" + (f" ; {tag}" if tag else ""))
    return lines


def find_push_imm(data: bytes, imm: int) -> list[str]:
    b = struct.pack("<H", imm)
    hits = []
    p = 0
    while p < len(data) - 2:
        if data[p : p + 2] == b and p > 0 and data[p - 1] in (0x68, 0xB8):  # push / mov ax
            hits.append(f"0x{p:06X}")
        p += 1
    return hits[:40]


def scan_near_call(data: bytes, target: int) -> list[str]:
    out = []
    for p in range(len(data) - 3):
        if data[p] == 0xE8:
            rel = struct.unpack_from("<h", data, p + 1)[0]
            if p + 3 + rel == target:
                out.append(f"0x{p:06X}")
    return out


def main() -> None:
    if not CBE_PATH.is_file():
        raise SystemExit(f"CBE not found: {CBE_PATH}")

    data = CBE_PATH.read_bytes()

    init_e02c = disasm(data, 0x03D484, 0x30)
    pass1_tail = disasm(data, 0x03D580, 0x20)
    pass2 = disasm(data, 0x03D59C, 0x70)
    insert_45c0c = disasm(data, 0x045C0C, 0x40)
    insert_callers = disasm(data, 0x045BD0, 0x40)

    payload = {
        "generated": date.today().isoformat(),
        "anchors": {
            "loadout_build": "0x03D42A",
            "pass2_init_e02c": "0x03D49A",
            "pass2_loop": "0x03D59C",
            "list_insert": "0x045C0C",
            "prepare_loadout": "0x03D72A",
        },
        "pool_offsets": {
            "mission_pool_primary": "0x0270",
            "pass2_walk": "0x01EC",
            "pass1_buf_a": "0x0128",
            "pass1_buf_b": "0x018A",
            "equip_alt": "0x024E",
        },
        "e02c_sites": [
            {"file": "0x0387DC", "pool_push": "0x0270", "note": "init alt + cap38814"},
            {"file": "0x03D4A8", "pool_push": "0x01EC", "seg_push": "0x201F", "note": "loadout pass2 直前"},
            {"file": "0x042566", "pool_push": "0x0270", "scenario_push": "0x70B2", "note": "squad init"},
        ],
        "insert_1ec_callers": find_push_imm(data, 0x01EC),
        "callers_3D42A": scan_near_call(data, 0x03D42A),
        "disasm": {
            "init_e02c": init_e02c,
            "pass1_tail": pass1_tail,
            "pass2": pass2,
            "insert_45c0c": insert_45c0c,
            "insert_callers": insert_callers,
        },
        "kar98k_272_verdict": {
            "mechanism": "mission pool DS:0x270 + cap/+0xA4 — NOT pass2",
            "pass2_role": "pass1 後の +0x3E / +0x80 確定 — 273→272 差替ではない",
            "doc": "PL_CBE_273_272_PATH_RE.md",
        },
    }

    out_json = ROOT / "scripts" / "pl_decoded" / "cbe_pass2_1ec_re.json"
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# CBE loadout pass2 — buffer @ `0x1EC` RE",
        "",
        f"**生成**: {payload['generated']} — `python scripts/re_cbe_pass2_1ec.py`",
        "",
        "## 結論",
        "",
        "### pass2 @ **`0x03D59C`** — **mag_type cmp 無し**、**+0xBA 状態で +0x3E / +0x80 更新**",
        "",
        "装填 UI 構築 `3D42A` の **第 2 ループ**。",
        "入力列は **直前の `lcall E02C` が書いた u16[] @ `0x201F:0x1EC`**（`DS:0x270` とは別オフセット）。",
        "",
        "```",
        "3D42A open",
        "  3D49A  mov ax,0x1EC; mov cx,0x201F",
        "  3D4A8  lcall E02C          ← pool 構築（0x270 版と同系）",
        "  3D4CA  pass1: blob [ad1c+0x46] → mag_type @ 3D540",
        "  3D59C  pass2: walk 0x201F:0x1EC until -1",
        "```",
        "",
        "### pass2 本体",
        "",
        "```asm",
        *pass2,
        "```",
        "",
        "| 条件 | 動作 |",
        "|------|------|",
        "| `es:[rec+0xBA] == 0` | `dword [rec+0x80] ← 0`（未リンク行クリア） |",
        "| `es:[rec+0xBA] != 0` | `word [rec+0x3E] ← cbe index`（pass1 でリンク済み行の確定） |",
        "",
        "**mag_type / cap 照合なし。** index 列を walk してランタイム CBE 行のフラグだけ触る。",
        "",
        "### `0x1EC` 列の供給元",
        "",
        "| 経路 | file | 内容 |",
        "|------|------|------|",
        "| **E02C @ 3D4A8** | push `0x201F`, push **`0x1EC`** | loadout 開始時の pass2 用 pool（DE4A 系と同族） |",
        "| **45C0C 挿入** | `0x045BD8` 等 push **`0x1EC`** | 装備チェーンから u16 列へ index **挿入** |",
        "| pass1 descriptor | buffer **`0x128` / `0x18a`** | blob 内 index 列 — **pass2 とは別** |",
        "| 3DBC2 第2出力 | `0x24CA:0x2304` | テンプレ blob — `3D7DA` ループで **別表** を生成 |",
        "",
        "E02C サイト 3 件:",
        "",
        "| file | pool offset | 用途 |",
        "|------|-------------|------|",
        "| `0x042566` | **0x270** | 小隊 init / squad scan 正本 |",
        "| `0x0387DC` | **0x270** | 別 init + cap38814 |",
        "| **`0x03D4A8`** | **`0x1EC`** | **loadout pass2 専用** |",
        "",
        "runtime の **`0x201F:0x1EC` 中身**（272/273/269/314 の並び）は静的 file からは未ダンプ —",
        "E02C 入力シナリオ ptr が `0x270` 版と同一なら **同一 index 集合**の可能性大。",
        "",
        "### Kar98k → **7.92-5 (272)** — **もう明らか（pass2 外）**",
        "",
        "| 問い | 答え | 確度 |",
        "|------|------|------|",
        "| UI に 272 が出る正本は？ | **mission pool `0x270` + cap/+0xA4** — 273(cap10) 落ち・272(cap5) 残り | **CONFIRMED** |",
        "| pass2 が 273→272 する？ | **No** — mag/cap 見ない。+0xBA 済み行の +0x3E 書込のみ | **CONFIRMED** |",
        "| 3D540 が 273→272 する？ | **No** — 272/273 は別 mag 行（58 vs 68） | **CONFIRMED** |",
        "| seg132 データ | `[272×4, 269×4, 273×6, 314×1]` @ `0x1DCAAC` — **272/273 両方供給** | **CONFIRMED** |",
        "",
        "詳細: [PL_CBE_273_272_PATH_RE.md](./PL_CBE_273_272_PATH_RE.md)",
        "",
        "pass2 が Kar98k で触るのは **pass1 後の確定処理**（例: 272 は +0xBA 済み → +0x3E 設定）。",
        "**269 / 314** は pass1 masked gate 不一致 → pass2 で +0x80 クリア側の候補。",
        "",
        "### 45C0C — index 列挿入ユーティリティ",
        "",
        "```asm",
        *insert_45c0c,
        "```",
        "",
        "装備経路 @ `0x045BD8`: `push …; push 0xA731; push 0x1EC; call 0x45C0C` —",
        "既存 u16 列に **単一 index をソート挿入**（`0x18A` / `0x128` / `0x24E` も同型）。",
        "",
        "## ST 再現指針",
        "",
        "```python",
        "# 273→272 — pass2 不要",
        "candidates = mission_pool_filter_cap(pool_270, weapon_cap=5)",
        "",
        "# pass2 相当 — mag 確定後のメタデータのみ",
        "for idx in pool_1ec:",
        "    rec = runtime_cbe[idx]",
        "    if rec.linked_ba:  # +0xBA",
        "        rec.slot_3e = idx",
        "    else:",
        "        rec.flag_80 = 0",
        "```",
        "",
        "## 未完了",
        "",
        "1. runtime **`0x201F:0x1EC`** の実 index 列ダンプ（DOSBox）",
        "2. E02C(0x1EC) と E02C(0x270) の **入力シナリオ ptr 同一性**",
        "3. `3D7DA` テンプレ loop → `0x230E`/`0x14CA` 表と pass2 列の差",
        "",
        "## 関連",
        "",
        "- [PL_CBE_273_272_PATH_RE.md](./PL_CBE_273_272_PATH_RE.md)",
        "- [PL_CBE_MAG_TYPE_3D540_RE.md](./PL_CBE_MAG_TYPE_3D540_RE.md)",
        "- [PL_CBE_MISSION_POOL_RE.md](./PL_CBE_MISSION_POOL_RE.md)",
        "- [PL_CBE_800F_MASK_RE.md](./PL_CBE_800F_MASK_RE.md)",
        "- [PL_CBE_RE_INDEX.md](./PL_CBE_RE_INDEX.md)",
        "",
    ]

    out_md = ROOT / "docs" / "PL_CBE_PASS2_1EC_RE.md"
    out_md.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {out_md.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

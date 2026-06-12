# -*- coding: utf-8 -*-
"""
CBE RE: lcall DBD7 — DE4A 弾 slot フィルタ内部。

注意: Capstone は lcall を `0xdbd7, 0xd0da` と表示するが、
      エンコード順は offset=0xD0DA, seg=0xDBD7。
      着地 = caller_NE_seg + 0xD0DA → file **0x04859A**（≠ seg+0xDBD7=0x49097）。

実行: python scripts/re_cbe_dbd7_deep.py
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
SEG5_BASE = 0x03B4C0
DBD7_IP = 0xD0DA
DBD7_CS = 0xDBD7
DBD7_FILE = SEG5_BASE + DBD7_IP  # 0x04859A
THUNK_FILE = SEG5_BASE + 0xDBD7  # 0x049097 — 別 thunk 群（混同注意）

MARK = (
    ("+ 0x28", "cap"),
    ("+ 0x0a", "u16_5"),
    ("0x64", "div100"),
    ("0xffff", "term"),
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
        mark = next((t for k, t in MARK if k in op), "")
        lines.append(f"{ins.address:06X}  {ins.mnemonic:6s} {ins.op_str}" + (f" ; {mark}" if mark else ""))
    return lines


def find_lcall_dbd7(data: bytes) -> list[dict]:
    pat = bytes([0x9A, DBD7_IP & 0xFF, (DBD7_IP >> 8) & 0xFF, DBD7_CS & 0xFF, (DBD7_CS >> 8) & 0xFF])
    hits = []
    p = 0
    while True:
        p = data.find(pat, p)
        if p < 0:
            break
        hits.append({"file_off": f"0x{p:06X}", "raw": data[p : p + 5].hex()})
        p += 1
    return hits


def read_cbe(data: bytes, idx: int) -> dict:
    off = TABLE_BASE + idx * 64
    rec = data[off : off + 64]
    return {
        "idx": idx,
        "u16_5": struct.unpack_from("<H", rec, 0x0A)[0],
        "mag_cap": struct.unpack_from("<H", rec, 0x28)[0],
    }


def main() -> None:
    if not CBE_PATH.is_file():
        raise SystemExit(f"CBE not found: {CBE_PATH}")

    data = CBE_PATH.read_bytes()
    callers = find_lcall_dbd7(data)

    de4a_iter = disasm(data, 0x0492AE, 0x100)
    dbd7_fn = disasm(data, DBD7_FILE, 0x30)
    thunk_49082 = disasm(data, 0x049082, 0x45)
    helper_49524 = disasm(data, 0x049524, 0x90)

    payload = {
        "generated": date.today().isoformat(),
        "encoding_note": "bytes 9A ip_lo ip_hi cs_lo cs_hi — Capstone operand order reversed",
        "dbd7": {
            "ip_imm": f"0x{DBD7_IP:04X}",
            "cs_imm": f"0x{DBD7_CS:04X}",
            "file_entry": f"0x{DBD7_FILE:06X}",
            "thunk_confusion": f"0x{THUNK_FILE:06X}",
            "callers": callers,
        },
        "de4a_dbd7_site": de4a_iter,
        "dbd7_function": dbd7_fn,
        "thunk_49082": thunk_49082,
        "helper_49524": helper_49524,
        "cbe_samples": {str(k): read_cbe(data, k) for k in (57, 272, 273)},
    }

    out_json = ROOT / "scripts" / "pl_decoded" / "cbe_dbd7_re.json"
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# CBE lcall DBD7 — DE4A 弾 u16_5 天井フィルタ RE",
        "",
        f"**生成**: {payload['generated']} — `python scripts/re_cbe_dbd7_deep.py`",
        "",
        "## 結論",
        "",
        "### エンコード訂正（重要）",
        "",
        "DE4A @ `49357` の生バイト: **`9A DA D0 D7 DB`**",
        "",
        "| フィールド | 値 | file 着地 |",
        "|------------|-----|-----------|",
        f"| IP imm | **`0x{DBD7_IP:04X}`** | seg5+0xD0DA = **`0x{DBD7_FILE:06X}`** ← **DBD7 本体** |",
        f"| CS imm | `0x{DBD7_CS:04X}` | seg5+0xDBD7 = `0x{THUNK_FILE:06X}` — **別 thunk** |",
        "",
        "Capstone 表示 `lcall 0xdbd7, 0xd0da` は **オペランド順が逆**。",
        "",
        "### DBD7 本体 @ `0x04859A` — **`weapon_u16_5 mod 100`**",
        "",
        "```asm",
        *dbd7_fn,
        "```",
        "",
        "DE4A 直前 `push 0x64` → `[bp+6]` = **除数 100**。",
        "内部 `lcall D0F0` が武器コンテキストから被除数を `ax` に載せ、",
        "**`ax % 100` の余り** を返す（`idiv` → `mov ax, dx`）。",
        "",
        "Kar98k 武器 `+0x0A` = **3** → DBD7 返値 **ax ≈ 3**。",
        "",
        "### DE4A 側判定 @ `49335F`（符号付き si）",
        "",
        "```asm",
        *[ln for ln in de4a_iter if "4933" in ln or "4934" in ln or "4935" in ln or "4936" in ln or "4937" in ln],
        "```",
        "",
        "| 条件 | 結果 |",
        "|------|------|",
        "| `ammo[+0x0A] >= ax` | **reject** — `si=0xFFFF`（-1）→ pool 行 `FFFF` |",
        "| `ammo[+0x0A] < ax` | **pass** — `si=0` → 後段 49386 へ |",
        "",
        "**弾 u16_5 は武器 u16_5 未満であること** が DBD7 ゲート。",
        "",
        "| CBE | u16_5 | DBD7 vs Kar98k(ax≈3) |",
        "|-----|-------|----------------------|",
        "| Kar98k (57) | 3 | — |",
        "| 272 7.92-5 | 0 | **pass** (0 < 3) |",
        "| 273 7.92-10G | 0 | **pass** (0 < 3) |",
        "",
        "> 273→272 分岐は DBD7 **では起きない**（両方 pass）。",
        "> 273 落ちは downstream **cap 不一致** (+0xA4 / 38814 / 4240C) が正本。",
        "",
        "### 混同していた `0x49082` 領域",
        "",
        "file `0x049097`（seg+0xDBD7）付近は **別 thunk 群**（DC12/DB9C/49524）。",
        "DE4A から直接 lcall される DBD7 **ではない**。",
        "",
        "```asm",
        *thunk_49082[:20],
        "```",
        "",
        f"### caller — **{len(callers)}** 件",
        "",
        "| file | raw |",
        "|------|-----|",
    ]
    for c in callers:
        lines.append(f"| `{c['file_off']}` | `{c['raw']}` |")

    lines.extend(
        [
            "",
            "## ST 再現指針",
            "",
            "```",
            "if ammo.u16_5 >= weapon.u16_5:  # DBD7 ceiling",
            "    reject_from_pool()",
            "```",
            "",
            "Kar98k: 272/273 は u16_5=0 < 3 → **pool に残る** → cap 段で 273 のみ落ち。",
            "",
            "## 未完了",
            "",
            "1. **`lcall D0F0` @ 4859D** — 被除数 `ax` の厳密ソース（武器 ES:[si+?]）",
            "2. DE85 / DE9A / DE5E — slot type 5/6/3 経路",
            "3. `0x49082` thunk 群の呼び出し元",
            "",
            "## 関連",
            "",
            "- [PL_CBE_MISSION_POOL_RE.md](./PL_CBE_MISSION_POOL_RE.md)",
            "- [PL_CBE_273_272_PATH_RE.md](./PL_CBE_273_272_PATH_RE.md)",
            "",
        ]
    )

    out_md = ROOT / "docs" / "PL_CBE_DBD7_RE.md"
    out_md.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {out_md.relative_to(ROOT)}")
    print(f"DBD7=0x{DBD7_FILE:06X} callers={len(callers)}")


if __name__ == "__main__":
    main()

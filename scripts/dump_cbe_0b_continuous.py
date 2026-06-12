# -*- coding: utf-8 -*-
"""
Wave 0b: アンカオフセットから「固定 stride バイト = 1 行」と仮定し、連続 N 行を u16 列でダンプする。
- 0x1DD460: (0,225) 先頭の拳銃系
- 0x1DC0B4: [7,0,0,230…] BAR 系仮説

Output: scripts/pl_decoded/cbe_0b_continuous_dump.json

  set PL_CBE_EXE=path\\to\\CBE.EXE
  python scripts/dump_cbe_0b_continuous.py
"""
from __future__ import annotations

import json
import os
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "pl_decoded" / "cbe_0b_continuous_dump.json"
CBE = Path(os.environ.get("PL_CBE_EXE", r"D:\PL\CBE.EXE"))

ANCHORS = [
    {
        "id": "m1911_0_225",
        "file_offset": 0x1DD460,
        "note": "<HH> (0,225) pistol-like sentinel",
    },
    {
        "id": "bar_like_7_0_0_230",
        "file_offset": 0x1DC0B4,
        "note": "u16[7,0,0,230,…] long-arm / different layout hypothesis",
    },
]

# 1 行が stride 未満のとき表示する最大 u16 数（1 行 = stride/2 語が正）
U16_MAX_ROW_DISPLAY = 16
# アンカから読む連続バイト（等間隔行の本数を確保）
WINDOW_BYTES = 1024
STRIDES = (8, 10, 12, 16, 20, 24, 28, 32, 40, 48, 64)
MAX_ROWS = 16


def u16_window(data: bytes, off: int, n_words: int) -> list[int]:
    w = []
    for i in range(n_words):
        p = off + 2 * i
        if p + 2 > len(data):
            break
        w.append(struct.unpack_from("<H", data, p)[0])
    return w


def hexdump(data: bytes, off: int, nbytes: int) -> list[str]:
    lo = off
    hi = min(len(data), off + nbytes)
    chunk = data[lo:hi]
    lines = []
    for i in range(0, len(chunk), 16):
        sl = chunk[i : i + 16]
        hx = " ".join(f"{b:02x}" for b in sl)
        lines.append(f"{lo+i:08x}  {hx}")
    return lines


def rows_for_stride(words: list[int], stride_bytes: int, max_rows: int, u16_max_display: int) -> list[list[int]]:
    """1 行 = 連続 stride_bytes: u16 語数は stride/2。行は r*step から step 語。"""
    step = stride_bytes // 2
    if step < 1:
        return []
    rows = []
    for r in range(max_rows):
        start = r * step
        if start + step > len(words):
            break
        row = words[start : start + step]
        rows.append(row if len(row) <= u16_max_display else row[:u16_max_display])
    return rows


def main() -> None:
    if not CBE.is_file():
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(
            json.dumps(
                {"_meta": {"error": "CBE not found", "path": str(CBE), "hint": "set PL_CBE_EXE"}},
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        print("SKIP", OUT)
        return

    data = CBE.read_bytes()
    out = {
        "_meta": {
            "cbe": str(CBE),
            "size": len(data),
            "script": "dump_cbe_0b_continuous.py",
            "window_bytes": WINDOW_BYTES,
            "strides_bytes": list(STRIDES),
            "max_rows": MAX_ROWS,
            "u16_max_per_row_in_json": U16_MAX_ROW_DISPLAY,
        },
        "anchors": [],
    }

    for a in ANCHORS:
        off = a["file_offset"]
        if off < 0 or off + WINDOW_BYTES > len(data):
            out["anchors"].append({**a, "error": "offset out of range"})
            continue

        n_words = WINDOW_BYTES // 2
        words = u16_window(data, off, n_words)
        first_u16 = words[0] if words else None
        block = {
            **a,
            "first_u16_at_anchor": first_u16,
            "hexdump_256": hexdump(data, off, 256),
            "u16_first_32": words[:32],
            "rows_by_stride": {},
        }
        for sb in STRIDES:
            if sb % 2:
                continue
            rs = rows_for_stride(words, sb, MAX_ROWS, U16_MAX_ROW_DISPLAY)
            npu = sb // 2
            block["rows_by_stride"][str(sb)] = {
                "stride_bytes": sb,
                "u16_per_full_row": npu,
                "row_count": len(rs),
                "rows_u16": rs,
            }
        out["anchors"].append(block)

    out["_meta"]["readme"] = (
        "Same physical bytes viewed as different row strides. "
        "If one stride shows stable small ID-like columns across rows, note it for RE; "
        "m1911 vs BAR anchors may prefer different strides (per pl plan §0.7)."
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print("WROTE", OUT)
    for an in out["anchors"]:
        fu = an.get("first_u16_at_anchor")
        print("  ", an.get("id"), "first_u16", fu, "at", hex(an.get("file_offset", 0)))


if __name__ == "__main__":
    main()

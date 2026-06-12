# -*- coding: utf-8 -*-
"""
Dump u16 / hex around known PL CBE 'item' anchors to infer record stride.
Output: scripts/pl_decoded/cbe_item_row_study.json

Run: python scripts/dump_cbe_item_rows.py
"""
import json
import os
import struct
from pathlib import Path

CBE = Path(os.environ.get("PL_CBE_EXE", r"D:\PL\CBE.EXE"))
OUT = Path(__file__).resolve().parent / "pl_decoded" / "cbe_item_row_study.json"

ANCHORS = [
    {
        "id": "m1911_lead_0_225",
        "file_offset": 0x1DD460,
        "context": "First <HH> (0,225) hit — pistol-like",
    },
    {
        "id": "bar_like_7_0_0_230",
        "file_offset": 0x1DC0B4,
        "context": "u16[7,0,0,230] — squad weapon / long arm hypothesis",
    },
]


def u16s(data: bytes, off: int, n_words: int) -> list:
    w = []
    for i in range(n_words):
        p = off + 2 * i
        if p + 2 > len(data):
            break
        w.append(struct.unpack_from("<H", data, p)[0])
    return w


def hexdump(data: bytes, off: int, nbytes: int) -> str:
    lo = off
    hi = min(len(data), off + nbytes)
    chunk = data[lo:hi]
    lines = []
    for i in range(0, len(chunk), 16):
        sl = chunk[i : i + 16]
        hx = " ".join(f"{b:02x}" for b in sl)
        lines.append(f"{lo+i:08x}  {hx}")
    return "\n".join(lines)


def stride_score(words: list, stride: int) -> float:
    """Heuristic: how often u16[0] and u16[stride/2] correlate as small ID-like (<=600)."""
    if stride < 4 or len(words) * 2 < stride * 2:
        return 0.0
    step = stride // 2
    pairs = 0
    good = 0
    for i in range(0, min(len(words) - step, 80), step):
        a, b = words[i], words[i + step]
        pairs += 1
        if a <= 800 and b <= 800 and (a > 0 or b > 0):
            good += 1
    return good / pairs if pairs else 0.0


def main() -> None:
    if not CBE.is_file():
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(
            json.dumps(
                {
                    "_meta": {
                        "error": "CBE not found; set PL_CBE_EXE",
                        "path": str(CBE),
                        "script": "dump_cbe_item_rows.py",
                    }
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        print("SKIP", OUT, CBE, "set PL_CBE_EXE")
        return
    d = CBE.read_bytes()
    out = {
        "_meta": {
            "file": str(CBE),
            "size": len(d),
            "script": "dump_cbe_item_rows.py",
        },
        "anchors": [],
    }
    for a in ANCHORS:
        off = a["file_offset"]
        n_bytes = 512
        words = u16s(d, off, n_bytes // 2)
        scores = {str(s): round(stride_score(words, s), 4) for s in (8, 12, 16, 20, 24, 32, 40, 48, 64)}
        block = {
            **a,
            "hex_128": hexdump(d, off, 128),
            "u16_first_64": words[:64],
            "stride_id_like_scores": scores,
        }
        out["anchors"].append(block)

    out["_meta"]["interpretation"] = (
        "High stride_id_like_scores are weak heuristics only. "
        "Compare m1911_lead vs bar_like: if best strides differ, separate record types likely."
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print("WROTE", OUT)
    for an in out["anchors"]:
        print("---", an["id"], "best stride", max(an["stride_id_like_scores"], key=lambda k: an["stride_id_like_scores"][k]))


if __name__ == "__main__":
    main()

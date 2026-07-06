# -*- coding: utf-8 -*-
"""
CBE.EXE 内を 16 ビット x86 として逆アセし、
ITEML の ITEMPAL / ITEMLCG スロット（import fixup 先の POINTER32 置き場）を
直接参照する命令を列挙する。Ghidra の Xref の静的近似。

  python scripts\\trace_iteml_iat_xrefs.py

  -> scripts/pl_decoded/cbe_iteml_pal_lcg_xrefs.json
     （手動メモ: cbe_iteml_pal_lcg_xref_chains_ja.md ※本スクリプトは上書きしない）
"""
from __future__ import annotations

import json
import struct
from pathlib import Path

try:
    from capstone import CS_ARCH_X86, CS_MODE_16, CS_OP_MEM, Cs
except ImportError as e:
    raise SystemExit("pip install capstone") from e

PL = Path("D:/PL")
CBE = PL / "CBE.EXE"
OUT_JSON = Path(__file__).resolve().parents[1] / "scripts" / "pl_decoded" / "cbe_iteml_pal_lcg_xrefs.json"
MD_MEMO = "scripts/pl_decoded/cbe_iteml_pal_lcg_xref_chains_ja.md"

# parse_cbe_ne_import_fixups.py 出力と同じ二点（in_seg_offset）
SLOTS = {
    "ITEMPAL__DLLGET_ITEMPAL_PTR": {"segment": 1, "in_seg": 0x3D22, "file_data_ref": 0x4DE2},
    "ITEMLCG__DLLGET_ITEMLCG_PTR": {"segment": 4, "in_seg": 0x583D, "file_data_ref": 0x3253D},
}

# 注: 生バイナリで FF1E/FF16 直後の disp が 0x3D22/0x583D になる形は 0 件
#     （Ghidra の再配置・Xref を正にする）


def ne_segments(d: bytes, ne: int) -> list[dict]:
    a = 1 << struct.unpack_from("<H", d, ne + 0x32)[0]
    nseg = struct.unpack_from("<H", d, ne + 0x1C)[0]
    segto = ne + struct.unpack_from("<H", d, ne + 0x22)[0]
    out = []
    for i in range(nseg):
        o = segto + 8 * i
        raw, ln, fl, m = struct.unpack_from("<HHHH", d, o)
        fo = raw * a
        act = 65536 if ln == 0 else ln
        out.append({"i": i + 1, "fo": fo, "len": act, "flags": fl})
    return out


def is_code_seg(fl: int) -> bool:
    return (fl & 0x0001) == 0  # 0=code, 1=data in NE convention used elsewhere


def main() -> int:
    if not CBE.is_file():
        print("missing", CBE)
        return 1
    d = CBE.read_bytes()
    ne = struct.unpack_from("<I", d, 0x3C)[0]
    if d[ne : ne + 2] != b"NE":
        return 1
    segs = ne_segments(d, ne)
    target_offs = {s["in_seg"] for s in SLOTS.values()}

    md = Cs(CS_ARCH_X86, CS_MODE_16)
    md.detail = True

    hits: list[dict] = []
    for seg in segs:
        if seg["fo"] == 0 or seg["len"] < 4:
            continue
        if not is_code_seg(seg["flags"]):
            continue
        seg_base = seg["fo"]
        chunk = d[seg_base : seg_base + seg["len"]]
        for insn in md.disasm(chunk, seg_base):
            in_seg_off = insn.address - seg_base
            for op in insn.operands:
                if op.type != CS_OP_MEM:
                    continue
                m = op.mem
                if m.disp is None:
                    continue
                disp = m.disp & 0xFFFF
                if disp not in target_offs:
                    continue
                which = [k for k, v in SLOTS.items() if v["in_seg"] == disp]
                if not which:
                    continue
                # Capstone: base/index reg ids; 0 か X86_REG_INVALID(=0) の両方あり得る
                addr_mode = f"base={m.base} index={m.index} scale={m.scale} disp=0x{disp:04X}"
                hits.append(
                    {
                        "slot_key": which[0],
                        "segment": seg["i"],
                        "file_offset_insn": insn.address,
                        "in_segment_offset": in_seg_off,
                        "mnemonic": insn.mnemonic,
                        "op_str": insn.op_str,
                        "bytes": insn.bytes.hex(),
                        "disp16": f"0x{disp:04X}",
                        "addr_detail": addr_mode,
                    }
                )

    # 同一 sloto に複数ヒット可能（別パスで同 IAT 参照）
    hits.sort(key=lambda h: (h["slot_key"], h["file_offset_insn"]))

    # 粗い「チェーン」: 同一セグメント内で、当該命令より直前の call のターゲット追跡は難;
    # 代わりに、ヒット命令前後のバックトレース用アンカー（±32 バイト）を出す
    chains: list[dict] = []
    for h in hits:
        o = h["file_offset_insn"]
        pre = d[max(0, o - 32) : o]
        post = d[o : o + 16]
        chains.append(
            {
                "slot": h["slot_key"],
                "ref_insn_file_offset": f"0x{o:X}",
                "ref_segment": h["segment"],
                "instruction": f"{h['mnemonic']}\t{h['op_str']}",
                "raw": h["bytes"],
                "context_before_32": pre.hex(),
                "context_after_16": post.hex(),
            }
        )

    doc = {
        "_meta": {
            "cbe": str(CBE),
            "method": "Capstone x86-16, 全 code セグ: メモリオペの disp==0x3D22|0x583D",
            "static_grep_note": "生バイナリで FF1E+223Dh / FF1E+583Dh は該当なし（Ghidra Xref 必須）",
            "md_memo": MD_MEMO,
            "limits": "間接レジスタ・fixup 付き等は未捕獲。呼び出しチェーンは Ghidra 手順メモを参照。",
        },
        "slots": SLOTS,
        "xrefs": hits,
        "call_chain_notes": chains,
    }
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")

    print("WROTE", OUT_JSON, "hits", len(hits))
    print("memo (manual)", MD_MEMO)
    for h in hits:
        print(f"  {h['slot_key']}: {h['mnemonic']}\t{h['op_str']}\t@0x{h['file_offset_insn']:X}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

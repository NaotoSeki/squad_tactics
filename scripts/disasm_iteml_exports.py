# -*- coding: utf-8 -*-
"""
ITEML.DLL / ITEMS.DLL の NE エントリテーブルを完全パースし、
エクスポート関数のエントリポイント (seg:off) を特定、
Capstone x86-16 で逆アセンブルしてパレット/CG データの位置を特定する。

Phase 1 — Wave 1 成果物

  python scripts\\disasm_iteml_exports.py
  -> scripts/pl_decoded/iteml_items_entry_points.json
  -> scripts/pl_decoded/iteml_items_disasm.json
  -> scripts/pl_decoded/iteml_items_disasm_report_ja.md
"""
from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

try:
    from capstone import (
        CS_ARCH_X86,
        CS_MODE_16,
        CS_GRP_CALL,
        CS_GRP_RET,
        CS_GRP_JUMP,
        CS_OP_MEM,
        CS_OP_IMM,
        CS_OP_REG,
        Cs,
    )
except ImportError as e:
    raise SystemExit("pip install capstone") from e

PL = Path("D:/PL")
ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "scripts" / "pl_decoded"
OUT_ENTRY = OUT_DIR / "iteml_items_entry_points.json"
OUT_DISASM = OUT_DIR / "iteml_items_disasm.json"
OUT_REPORT = OUT_DIR / "iteml_items_disasm_report_ja.md"


# ── NE header parsing ─────────────────────────────────────────


def parse_ne_header(d: bytes, ne: int) -> dict:
    """Extract key NE header fields."""
    fields = {}
    fields["ne_offset"] = ne
    fields["linker_ver"] = (d[ne + 2], d[ne + 3])
    fields["entry_table_off"] = struct.unpack_from("<H", d, ne + 0x04)[0]
    fields["entry_table_len"] = struct.unpack_from("<H", d, ne + 0x06)[0]
    fields["flags"] = struct.unpack_from("<H", d, ne + 0x0C)[0]
    fields["auto_data_seg"] = struct.unpack_from("<H", d, ne + 0x0E)[0]
    fields["init_heap"] = struct.unpack_from("<H", d, ne + 0x10)[0]
    fields["init_stack"] = struct.unpack_from("<H", d, ne + 0x12)[0]
    fields["cs_ip"] = struct.unpack_from("<I", d, ne + 0x14)[0]
    fields["ss_sp"] = struct.unpack_from("<I", d, ne + 0x18)[0]
    fields["n_segments"] = struct.unpack_from("<H", d, ne + 0x1C)[0]
    fields["n_module_refs"] = struct.unpack_from("<H", d, ne + 0x1E)[0]
    fields["nonresident_name_size"] = struct.unpack_from("<H", d, ne + 0x20)[0]
    fields["seg_table_off"] = struct.unpack_from("<H", d, ne + 0x22)[0]
    fields["resource_table_off"] = struct.unpack_from("<H", d, ne + 0x24)[0]
    fields["resident_name_off"] = struct.unpack_from("<H", d, ne + 0x26)[0]
    fields["module_ref_off"] = struct.unpack_from("<H", d, ne + 0x28)[0]
    fields["imported_names_off"] = struct.unpack_from("<H", d, ne + 0x2A)[0]
    fields["nonresident_name_off"] = struct.unpack_from("<I", d, ne + 0x2C)[0]
    fields["n_moveable_entries"] = struct.unpack_from("<H", d, ne + 0x30)[0]
    fields["sector_align_shift"] = struct.unpack_from("<H", d, ne + 0x32)[0]
    return fields


def parse_segments(d: bytes, ne: int, hdr: dict) -> list[dict]:
    """Parse segment table; returns list of {seg_num, file_offset, length, flags, min_alloc}."""
    align = 1 << hdr["sector_align_shift"]
    n = hdr["n_segments"]
    base = ne + hdr["seg_table_off"]
    segs = []
    for i in range(n):
        o = base + 8 * i
        raw_sector, length, flags, min_alloc = struct.unpack_from("<HHHH", d, o)
        file_offset = raw_sector * align
        actual_len = 65536 if length == 0 else length
        is_code = (flags & 0x0001) == 0
        is_data = (flags & 0x0001) == 1
        is_moveable = (flags & 0x0010) != 0
        segs.append({
            "seg_num": i + 1,
            "raw_sector": raw_sector,
            "file_offset": file_offset,
            "length": actual_len,
            "flags": flags,
            "flags_hex": f"0x{flags:04X}",
            "is_code": is_code,
            "is_data": is_data,
            "is_moveable": is_moveable,
            "min_alloc": min_alloc,
        })
    return segs


def parse_entry_table(d: bytes, ne: int, hdr: dict) -> list[dict]:
    """Parse the NE entry table into a list of {ordinal, seg_num, offset, type}."""
    abs_off = ne + hdr["entry_table_off"]
    end = abs_off + hdr["entry_table_len"]
    entries = []
    ordinal = 1

    p = abs_off
    while p < end:
        count = d[p]
        seg_indicator = d[p + 1]
        p += 2
        if count == 0:
            break
        if seg_indicator == 0x00:
            ordinal += count
            continue
        if seg_indicator == 0xFF:
            for _ in range(count):
                if p + 6 > end:
                    break
                flags = d[p]
                # int3h (0xCC) at p+1, p+2 (2 bytes reserved)
                seg_num = struct.unpack_from("<B", d, p + 3)[0]
                offset = struct.unpack_from("<H", d, p + 4)[0]
                entries.append({
                    "ordinal": ordinal,
                    "seg_num": seg_num,
                    "offset": offset,
                    "offset_hex": f"0x{offset:04X}",
                    "entry_flags": flags,
                    "type": "moveable",
                })
                ordinal += 1
                p += 6
        else:
            seg_num = seg_indicator
            for _ in range(count):
                if p + 3 > end:
                    break
                flags = d[p]
                offset = struct.unpack_from("<H", d, p + 1)[0]
                entries.append({
                    "ordinal": ordinal,
                    "seg_num": seg_num,
                    "offset": offset,
                    "offset_hex": f"0x{offset:04X}",
                    "entry_flags": flags,
                    "type": "fixed",
                })
                ordinal += 1
                p += 3
    return entries


def walk_resident_names(d: bytes, ne: int) -> list[dict]:
    off = struct.unpack_from("<H", d, ne + 0x26)[0]
    p = ne + off
    out = []
    while p < len(d) - 3:
        ln = d[p]
        if ln == 0:
            break
        name = d[p + 1: p + 1 + ln].decode("ascii", errors="replace")
        ord_ = struct.unpack_from("<H", d, p + 1 + ln)[0]
        out.append({"ordinal": ord_, "name": name})
        p += 1 + ln + 2
    return out


def walk_nonresident_names(d: bytes, hdr: dict) -> list[dict]:
    p = hdr["nonresident_name_off"]
    size = hdr["nonresident_name_size"]
    end = p + size
    out = []
    while p < end and p < len(d) - 3:
        ln = d[p]
        if ln == 0:
            break
        name = d[p + 1: p + 1 + ln].decode("ascii", errors="replace")
        ord_ = struct.unpack_from("<H", d, p + 1 + ln)[0]
        out.append({"ordinal": ord_, "name": name})
        p += 1 + ln + 2
    return out


# ── Disassembly ────────────────────────────────────────────────


def disasm_function(d: bytes, seg: dict, entry_offset: int,
                    max_bytes: int = 512) -> list[dict]:
    """Disassemble from entry_offset within segment, stopping at RET or max_bytes."""
    seg_start = seg["file_offset"]
    seg_len = seg["length"]
    start_file = seg_start + entry_offset
    avail = min(max_bytes, seg_len - entry_offset)
    if avail <= 0:
        return []

    chunk = d[start_file: start_file + avail]
    md = Cs(CS_ARCH_X86, CS_MODE_16)
    md.detail = True

    insns = []
    for insn in md.disasm(chunk, entry_offset):
        groups = list(insn.groups)
        is_ret = CS_GRP_RET in groups
        is_jump = CS_GRP_JUMP in groups
        is_call = CS_GRP_CALL in groups

        operands_detail = []
        for op in insn.operands:
            if op.type == CS_OP_REG:
                operands_detail.append({"type": "reg", "reg": insn.reg_name(op.reg)})
            elif op.type == CS_OP_IMM:
                operands_detail.append({"type": "imm", "val": op.imm})
            elif op.type == CS_OP_MEM:
                m = op.mem
                mem_info = {}
                if m.segment != 0:
                    mem_info["seg"] = insn.reg_name(m.segment)
                if m.base != 0:
                    mem_info["base"] = insn.reg_name(m.base)
                if m.index != 0:
                    mem_info["index"] = insn.reg_name(m.index)
                mem_info["disp"] = m.disp
                operands_detail.append({"type": "mem", **mem_info})

        entry = {
            "addr": insn.address,
            "addr_hex": f"0x{insn.address:04X}",
            "file_offset": seg_start + insn.address,
            "file_offset_hex": f"0x{seg_start + insn.address:X}",
            "bytes": insn.bytes.hex(),
            "mnemonic": insn.mnemonic,
            "op_str": insn.op_str,
            "is_ret": is_ret,
            "is_call": is_call,
            "is_jump": is_jump,
            "operands": operands_detail,
        }
        insns.append(entry)

        if is_ret:
            break
        if is_jump and not is_call:
            jmp_target = None
            for op in insn.operands:
                if op.type == CS_OP_IMM:
                    jmp_target = op.imm
            if jmp_target is not None and jmp_target < entry_offset:
                break

    return insns


def analyze_function(insns: list[dict], seg: dict) -> dict:
    """Extract high-level observations from disassembled instructions."""
    analysis = {
        "total_instructions": len(insns),
        "has_ret": any(i["is_ret"] for i in insns),
        "calls": [],
        "memory_refs": [],
        "immediate_loads": [],
        "observations": [],
    }

    for insn in insns:
        if insn["is_call"]:
            for op in insn["operands"]:
                if op["type"] == "imm":
                    analysis["calls"].append({
                        "from": insn["addr_hex"],
                        "target_hex": f"0x{op['val'] & 0xFFFF:04X}",
                        "mnemonic": f"{insn['mnemonic']} {insn['op_str']}",
                    })

        for op in insn["operands"]:
            if op.get("type") == "mem" and "disp" in op:
                analysis["memory_refs"].append({
                    "addr": insn["addr_hex"],
                    "mnemonic": f"{insn['mnemonic']} {insn['op_str']}",
                    "disp": op["disp"],
                    "disp_hex": f"0x{op['disp'] & 0xFFFF:04X}",
                    "base": op.get("base", ""),
                    "seg_reg": op.get("seg", ""),
                })

        if insn["mnemonic"] in ("mov", "lea") and insn["operands"]:
            for op in insn["operands"]:
                if op["type"] == "imm":
                    analysis["immediate_loads"].append({
                        "addr": insn["addr_hex"],
                        "instruction": f"{insn['mnemonic']} {insn['op_str']}",
                        "value": op["val"],
                        "value_hex": f"0x{op['val'] & 0xFFFF:04X}",
                    })

    if analysis["total_instructions"] <= 5 and analysis["has_ret"]:
        analysis["observations"].append("非常に短い関数 — DS/セグメントベースのポインタを返すスタブの可能性")

    for ref in analysis["memory_refs"]:
        if ref["base"] == "" and ref["seg_reg"] in ("", "ds"):
            analysis["observations"].append(
                f"DS 相対メモリ参照 disp={ref['disp_hex']} @ {ref['addr']} — "
                "データセグメント内のテーブル/ポインタの可能性"
            )

    return analysis


# ── Main ──────────────────────────────────────────────────────


def process_dll(dll_path: Path) -> dict:
    d = dll_path.read_bytes()
    if d[:2] != b"MZ":
        return {"error": "not MZ"}
    ne = struct.unpack_from("<I", d, 0x3C)[0]
    if d[ne: ne + 2] != b"NE":
        return {"error": "not NE"}

    hdr = parse_ne_header(d, ne)
    segs = parse_segments(d, ne, hdr)
    entries = parse_entry_table(d, ne, hdr)
    res_names = walk_resident_names(d, ne)
    nonres_names = walk_nonresident_names(d, hdr)

    all_names = {n["ordinal"]: n["name"] for n in res_names + nonres_names}

    for e in entries:
        e["name"] = all_names.get(e["ordinal"], None)

    exports_with_disasm = []
    for e in entries:
        seg_num = e["seg_num"]
        seg = next((s for s in segs if s["seg_num"] == seg_num), None)
        if seg is None:
            e["disasm_error"] = f"segment {seg_num} not found"
            exports_with_disasm.append(e)
            continue

        e["file_offset_entry"] = seg["file_offset"] + e["offset"]
        e["file_offset_entry_hex"] = f"0x{e['file_offset_entry']:X}"

        insns = disasm_function(d, seg, e["offset"], max_bytes=1024)
        e["disasm"] = insns
        e["analysis"] = analyze_function(insns, seg)
        exports_with_disasm.append(e)

    return {
        "file": str(dll_path),
        "size": len(d),
        "ne_header": hdr,
        "segments": segs,
        "entry_table": entries,
        "resident_names": res_names,
        "nonresident_names": nonres_names,
        "exports_disasm": exports_with_disasm,
    }


def format_report(results: dict) -> str:
    lines = [
        "# ITEML.DLL / ITEMS.DLL — NE エントリテーブル解析 & エクスポート逆アセンブル",
        "",
        "Phase 1 / Wave 1 成果物（自動生成）",
        "",
    ]

    for dll_name, info in results.items():
        if "error" in info:
            lines.append(f"## {dll_name}: エラー — {info['error']}")
            continue

        lines.append(f"## {dll_name}")
        lines.append("")
        lines.append(f"- サイズ: {info['size']:,} bytes")
        lines.append(f"- NE オフセット: {info['ne_header']['ne_offset']}")
        lines.append(f"- セグメント数: {info['ne_header']['n_segments']}")
        lines.append(f"- セクタアラインシフト: {info['ne_header']['sector_align_shift']}")
        lines.append("")

        lines.append("### セグメントテーブル")
        lines.append("")
        lines.append("| Seg# | ファイルオフセット | 長さ | フラグ | コード/データ | 可動 |")
        lines.append("|------|-------------------|------|--------|--------------|------|")
        for s in info["segments"]:
            kind = "CODE" if s["is_code"] else "DATA"
            mov = "Y" if s["is_moveable"] else "N"
            lines.append(
                f"| {s['seg_num']} | 0x{s['file_offset']:X} ({s['file_offset']:,}) "
                f"| {s['length']:,} | {s['flags_hex']} | {kind} | {mov} |"
            )
        lines.append("")

        lines.append("### エントリテーブル（エクスポート）")
        lines.append("")
        lines.append("| 序数 | 名前 | Seg# | オフセット | ファイルオフセット | 型 |")
        lines.append("|------|------|------|-----------|-------------------|-----|")
        for e in info["entry_table"]:
            name = e.get("name") or "—"
            fo = e.get("file_offset_entry_hex", "?")
            lines.append(
                f"| {e['ordinal']} | `{name}` | {e['seg_num']} "
                f"| {e['offset_hex']} | {fo} | {e['type']} |"
            )
        lines.append("")

        target_exports = [
            e for e in info["exports_disasm"]
            if e.get("name") and "DLLGET" in e["name"]
        ]
        if not target_exports:
            target_exports = [
                e for e in info["exports_disasm"]
                if e.get("name") and e["name"] not in ("WEP", dll_name.split(".")[0], "___EXPORTEDSTUB")
            ]

        for e in info["exports_disasm"]:
            if not e.get("disasm"):
                continue
            name = e.get("name") or f"ord_{e['ordinal']}"
            lines.append(f"### `{name}` (序数 {e['ordinal']}, seg {e['seg_num']}:{e['offset_hex']})")
            lines.append("")
            fo = e.get("file_offset_entry_hex", "?")
            lines.append(f"ファイルオフセット: {fo}")
            lines.append("")
            lines.append("```x86asm")
            for insn in e["disasm"]:
                lines.append(
                    f"  {insn['addr_hex']:>8s}:  {insn['bytes']:<16s}  "
                    f"{insn['mnemonic']:<8s} {insn['op_str']}"
                )
            lines.append("```")
            lines.append("")

            a = e.get("analysis", {})
            if a.get("observations"):
                lines.append("**解析メモ:**")
                for obs in a["observations"]:
                    lines.append(f"- {obs}")
                lines.append("")

            if a.get("memory_refs"):
                lines.append("**メモリ参照:**")
                lines.append("")
                lines.append("| アドレス | 命令 | disp | ベース | セグレジスタ |")
                lines.append("|---------|------|------|--------|-------------|")
                for ref in a["memory_refs"]:
                    lines.append(
                        f"| {ref['addr']} | `{ref['mnemonic']}` "
                        f"| {ref['disp_hex']} | {ref['base']} | {ref['seg_reg']} |"
                    )
                lines.append("")

            if a.get("calls"):
                lines.append("**CALL 先:**")
                lines.append("")
                for c in a["calls"]:
                    lines.append(f"- `{c['mnemonic']}` @ {c['from']} → {c['target_hex']}")
                lines.append("")

            if a.get("immediate_loads"):
                lines.append("**即値ロード:**")
                lines.append("")
                for il in a["immediate_loads"]:
                    lines.append(f"- `{il['instruction']}` @ {il['addr']} → {il['value_hex']} ({il['value']})")
                lines.append("")

    return "\n".join(lines)


def main() -> int:
    results = {}
    for dll_name in ("ITEML.DLL", "ITEMS.DLL"):
        path = PL / dll_name
        if not path.is_file():
            results[dll_name] = {"error": "file not found"}
            continue
        print(f"Parsing {dll_name} ...")
        results[dll_name] = process_dll(path)
        n_entries = len(results[dll_name].get("entry_table", []))
        n_segs = len(results[dll_name].get("segments", []))
        print(f"  segments={n_segs}  entries={n_entries}")
        for e in results[dll_name].get("entry_table", []):
            name = e.get("name") or f"ord_{e['ordinal']}"
            n_insns = len(e.get("disasm", []))
            print(f"  ord {e['ordinal']:2d} {name:30s} seg{e['seg_num']}:{e['offset_hex']}  → {n_insns} insns")

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    entry_summary = {}
    for dll_name, info in results.items():
        if "error" in info:
            entry_summary[dll_name] = info
            continue
        entry_summary[dll_name] = {
            "file": info["file"],
            "size": info["size"],
            "ne_header": info["ne_header"],
            "segments": info["segments"],
            "entry_table": [
                {k: v for k, v in e.items() if k != "disasm"}
                for e in info["entry_table"]
            ],
            "resident_names": info["resident_names"],
            "nonresident_names": info["nonresident_names"],
        }
    OUT_ENTRY.write_text(
        json.dumps(entry_summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\nWROTE {OUT_ENTRY}")

    disasm_summary = {}
    for dll_name, info in results.items():
        if "error" in info:
            disasm_summary[dll_name] = info
            continue
        disasm_summary[dll_name] = {
            "file": info["file"],
            "exports": [
                {
                    "ordinal": e["ordinal"],
                    "name": e.get("name"),
                    "seg_num": e["seg_num"],
                    "offset_hex": e["offset_hex"],
                    "file_offset_entry_hex": e.get("file_offset_entry_hex"),
                    "disasm": e.get("disasm", []),
                    "analysis": e.get("analysis", {}),
                }
                for e in info.get("exports_disasm", [])
                if e.get("disasm")
            ],
        }
    OUT_DISASM.write_text(
        json.dumps(disasm_summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"WROTE {OUT_DISASM}")

    report = format_report(results)
    OUT_REPORT.write_text(report, encoding="utf-8")
    print(f"WROTE {OUT_REPORT}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

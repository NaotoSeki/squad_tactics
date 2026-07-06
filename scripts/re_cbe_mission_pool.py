# -*- coding: utf-8 -*-
"""
CBE RE: mission pool DS:0x270 — 構築 (E02C/DE4A) + seg132 シナリオ表。

実行: python scripts/re_cbe_mission_pool.py
出力:
  docs/PL_CBE_MISSION_POOL_RE.md
  scripts/pl_decoded/cbe_mission_pool_re.json
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
SEG132_START = 0x1DBF80
OUT_MD = ROOT / "docs" / "PL_CBE_MISSION_POOL_RE.md"
OUT_JSON = ROOT / "scripts" / "pl_decoded" / "cbe_mission_pool_re.json"

ANCHORS = [
    {
        "file_off": 0x0494EC,
        "name": "pool_build_dispatch",
        "summary": "lcall E02C 着地 — シナリオ ptr + pool ptr(0x270) を受け取り DE4A/走査",
        "status": "CONFIRMED",
    },
    {
        "file_off": 0x0492AE,
        "name": "pool_transform_DE4A",
        "summary": "4B 列 walk — cbe index + slot flags → u16 pool 列; weapon_cap 引数",
        "status": "CONFIRMED",
    },
    {
        "file_off": 0x049406,
        "name": "pool_entry_validate",
        "summary": "call 49406 — CBE 行ロード後の可否チェック",
        "status": "CONFIRMED",
    },
    {
        "file_off": 0x042556,
        "name": "pool_init_squad",
        "summary": "42530 — push 0x70B2, push 0x270 → lcall E02C; pool[0]=FFFF",
        "status": "CONFIRMED",
    },
    {
        "file_off": 0x0387DC,
        "name": "pool_init_alt",
        "summary": "387DC — push 0xB979, push 0x270 → E02C → call 38814(cap filter?)",
        "status": "CONFIRMED",
    },
    {
        "file_off": 0x038814,
        "name": "pool_cap_filter_post",
        "summary": "38814 — pool walk + weapon_cap; 不一致行スキップ/終端",
        "status": "CONFIRMED",
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
        segs.append(
            {
                "num": i + 1,
                "start": raw * align,
                "len": ln if ln else 65536,
                "is_code": (fl & 1) == 0,
            }
        )
    return segs


def read_cbe(data: bytes, idx: int) -> dict:
    off = TABLE_BASE + idx * 64
    rec = data[off : off + 64]
    return {
        "idx": idx,
        "u16_5": struct.unpack_from("<H", rec, 0x0A)[0],
        "mag_cap": struct.unpack_from("<H", rec, 0x28)[0],
        "mag_type": struct.unpack_from("<H", rec, 0x2A)[0],
    }


def disasm(data: bytes, start: int, size: int) -> list[str]:
    md = Cs(CS_ARCH_X86, CS_MODE_16)
    tags = (
        ("+ 0x28", "cap"),
        ("+ 0x2a", "mag"),
        ("+ 0x8a", "+0x8A"),
        ("+ 0x26", "+0x26"),
        ("+ 0x0a", "+0x0A"),
        ("0x270", "pool"),
        ("0xffff", "term"),
    )
    lines = []
    for ins in md.disasm(data[start : start + size], start):
        op = ins.op_str.lower()
        mark = next((t for k, t in tags if k in op), "")
        if mark or ins.mnemonic in ("cmp", "call", "lcall", "retf", "enter", "je", "jne", "test", "push"):
            lines.append(f"{ins.address:06X}  {ins.mnemonic:6s} {ins.op_str}" + (f" ; {mark}" if mark else ""))
    return lines


def find_lcall_e02c(data: bytes) -> list[dict]:
    hits = []
    p = 0
    while p < len(data) - 5:
        if data[p] == 0x9A and struct.unpack_from("<H", data, p + 1)[0] == 0xE02C:
            seg = struct.unpack_from("<H", data, p + 3)[0]
            hits.append({"file_off": f"0x{p:06X}", "seg_word": f"0x{seg:04X}"})
        p += 1
    return hits


def scan_ammo_pairs(data: bytes, start: int, end: int) -> list[dict]:
    """seg132 内 (idx,qty) 候補 — idx 250..320, qty<200。"""
    out = []
    for off in range(start, min(end, len(data) - 3), 2):
        idx, qty = struct.unpack_from("<HH", data, off)
        if 250 <= idx <= 320 and qty < 200:
            out.append({"file": f"0x{off:06X}", "idx": idx, "qty": qty})
    return out


def resolve_lcall_far(segs: list[dict], caller_file: int, seg_imm: int) -> dict | None:
    """NE 同一 seg 内 far call — target = caller_seg.start + seg_word（E02C/D3B0 実績）。"""
    for s in segs:
        if s["start"] <= caller_file < s["start"] + s["len"]:
            return {"seg_num": s["num"], "file_off": s["start"] + seg_imm}
    return None


def resolve_lcall_in_caller_seg(segs: list[dict], caller_file: int, off_imm: int) -> dict | None:
    for s in segs:
        if s["start"] <= caller_file < s["start"] + s["len"]:
            return {"seg_num": s["num"], "file_off": s["start"] + off_imm}
    return None


def hunt_data_ptrs(data: bytes, segs: list[dict], ptr: int) -> list[dict]:
    out = []
    for s in segs:
        if s.get("is_code"):
            continue
        fo = s["start"] + ptr
        if fo + 16 > len(data):
            continue
        words = struct.unpack_from("<8H", data, fo)
        out.append({"seg": s["num"], "file": f"0x{fo:06X}", "u16": list(words)})
    return out


def find_scenario_ptr_seg(data: bytes, segs: list[dict], ptr: int) -> list[dict]:
    """runtime ES:ptr が指すシナリオ列 — Kar98k 窓 (55,58,0,272,4) 等で同定。"""
    sig_a = struct.pack("<HHHHH", 55, 58, 0, 272, 4)
    sig_b = struct.pack("<HHHH", 273, 6, 314, 1)
    hits = []
    for s in segs:
        if s.get("is_code"):
            continue
        base = s["start"] + ptr
        if base + 64 > len(data):
            continue
        chunk = data[base : base + 512]
        for sig, tag in ((sig_a, "kar98k_header"), (sig_b, "ammo_tail")):
            pos = chunk.find(sig)
            if pos >= 0:
                words = struct.unpack_from("<16H", chunk, max(0, pos - 8))
                hits.append(
                    {
                        "seg": s["num"],
                        "file": f"0x{base + pos:06X}",
                        "runtime_ptr": f"0x{ptr + pos:04X}",
                        "tag": tag,
                        "u16": list(words),
                    }
                )
    return hits


def parse_unit_loadout_at(data: bytes, off: int) -> dict | None:
    """0x1DCAAC 付近 — weapon hdr + (idx,qty)*。"""
    if off + 32 > len(data):
        return None
    w = struct.unpack_from("<16H", data, off)
    # expect weapon id, meta..., then pairs
    pairs = []
    p = off + 6  # skip weapon + 2 meta words → 272 start at +6 from 1DCAAC
    for _ in range(8):
        if p + 4 > len(data):
            break
        idx, qty = struct.unpack_from("<HH", data, p)
        if idx == 0xFFFF or idx == 0 or idx > 400:
            break
        pairs.append({"idx": idx, "qty": qty})
        p += 4
    return {"off": f"0x{off:06X}", "header": list(w[:3]), "pairs": pairs}


def parse_seg132_blocks(data: bytes, start: int, end: int) -> list[dict]:
    """可変長 unit ブロック — 0xFFFF 終端 + weapon id ヘッダを探索。"""
    blocks = []
    off = start
    while off + 8 < end:
        w0, w1 = struct.unpack_from("<HH", data, off)
        if w0 == 0xFFFF:
            off += 2
            continue
        # weapon-ish header: id 1..400, next word small count/flags
        if 1 <= w0 <= 400 and w1 < 20:
            pairs = []
            p = off + 4
            while p + 4 <= end and len(pairs) < 24:
                idx, qty = struct.unpack_from("<HH", data, p)
                if idx == 0xFFFF or idx == 0:
                    break
                if idx > 400 or qty > 500:
                    break
                pairs.append({"idx": idx, "qty": qty, "file": f"0x{p:06X}"})
                p += 4
            if pairs:
                blocks.append({"header_off": f"0x{off:06X}", "weapon_id": w0, "hdr1": w1, "pairs": pairs})
                off = p
                continue
        off += 2
    return blocks[:40]


def kar98k_loadout_window(data: bytes) -> list[dict]:
    """1DCAB2 中心の (idx,qty) 4 組。"""
    base = 0x1DCAB2
    return [
        {"idx": struct.unpack_from("<H", data, base + i * 4)[0],
         "qty": struct.unpack_from("<H", data, base + i * 4 + 2)[0],
         "file": f"0x{base + i * 4:06X}"}
        for i in range(4)
    ]


def main() -> None:
    if not CBE_PATH.is_file():
        raise SystemExit(f"CBE not found: {CBE_PATH}")

    data = CBE_PATH.read_bytes()
    segs = read_ne(data)
    seg132 = segs[131]

    lcall_sites = find_lcall_e02c(data)
    ammo_pairs = scan_ammo_pairs(data, SEG132_START, seg132["start"] + seg132["len"])
    kar98k_win = kar98k_loadout_window(data)
    seg132_end = seg132["start"] + seg132["len"]

    lcall_targets = {}
    for name, off_imm, seg_imm, caller in (
        ("E02C_pool_build", 0x68DB, 0xE02C, 0x042566),
        ("E02C_alt", 0xBAFD, 0xE02C, 0x0387DC),
        ("DBD7", 0xDBD7, 0xD0DA, 0x049357),
        ("DE85", 0xDE85, 0xD0DA, 0x04931B),
        ("DE9A", 0xDE9A, 0xD0DA, 0x049342),
        ("DE5E", 0xDE5E, 0xD0DA, 0x049307),
    ):
        by_off = resolve_lcall_in_caller_seg(segs, caller, off_imm)
        by_seg = resolve_lcall_far(segs, caller, seg_imm)
        lcall_targets[name] = {
            "by_offset": by_off,
            "by_seg_word": by_seg,
            "file_off": (by_seg if name.startswith("E02C") else by_off)["file_off"],
        }
    data_ptrs = {f"0x{p:04X}": hunt_data_ptrs(data, segs, p) for p in (0x70B2, 0xB979, 0x270)}
    scenario_ptr_hits = {
        f"0x{p:04X}": find_scenario_ptr_seg(data, segs, p) for p in (0x70B2, 0xB979)
    }
    unit_loadout_1DCAAC = parse_unit_loadout_at(data, 0x1DCAAC)
    seg132_blocks = parse_seg132_blocks(data, seg132["start"], seg132_end)
    kar98k_block = next(
        (b for b in seg132_blocks if any(p["idx"] == 272 for p in b["pairs"])),
        None,
    )

    payload = {
        "generated": date.today().isoformat(),
        "anchors": ANCHORS,
        "lcall_e02c_sites": lcall_sites,
        "seg132": {
            "file_start": f"0x{seg132['start']:06X}",
            "file_end": f"0x{seg132['start'] + seg132['len']:06X}",
            "ammo_pair_count": len(ammo_pairs),
            "kar98k_window": kar98k_win,
        },
        "cbe_fields": {
            str(k): read_cbe(data, k) for k in (57, 55, 272, 273, 269, 314)
        },
        "disasm_de4a_loop": disasm(data, 0x0492AE, 0x160),
        "disasm_pool_init_42530": disasm(data, 0x042530, 0x45),
        "disasm_pool_init_387DC": disasm(data, 0x0387D0, 0x50),
        "disasm_post_filter_38814": disasm(data, 0x038814, 0x70),
        "disasm_pool_append_49616": disasm(data, 0x049616, 0x70),
        "disasm_validate_49406": disasm(data, 0x049406, 0x90),
        "lcall_targets": {
            k: {
                "file_off": f"0x{v['file_off']:06X}",
                "by_offset": (
                    f"0x{v['by_offset']['file_off']:06X}" if v.get("by_offset") else None
                ),
                "by_seg_word": (
                    f"0x{v['by_seg_word']['file_off']:06X}" if v.get("by_seg_word") else None
                ),
            }
            for k, v in lcall_targets.items()
        },
        "data_ptr_hunt": data_ptrs,
        "scenario_ptr_hits": scenario_ptr_hits,
        "unit_loadout_1DCAAC": unit_loadout_1DCAAC,
        "seg132_blocks_sample": seg132_blocks[:15],
        "kar98k_block": kar98k_block,
    }

    if lcall_targets.get("DBD7"):
        fo = lcall_targets["DBD7"]["file_off"]
        payload["disasm_DBD7"] = disasm(data, fo, 0xA0)
    if lcall_targets.get("DE85"):
        fo = lcall_targets["DE85"]["file_off"]
        payload["disasm_DE85"] = disasm(data, fo, 0xA0)
    if lcall_targets.get("DE9A"):
        fo = lcall_targets["DE9A"]["file_off"]
        payload["disasm_DE9A"] = disasm(data, fo, 0x80)
    if lcall_targets.get("DE5E"):
        fo = lcall_targets["DE5E"]["file_off"]
        payload["disasm_DE5E"] = disasm(data, fo, 0x60)

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# CBE mission pool `DS:0x270` — 構築 RE",
        "",
        f"**生成**: {payload['generated']} — `python scripts/re_cbe_mission_pool.py`",
        "",
        "## 結論",
        "",
        "### runtime `DS:0x270` = **u16 cbe index 列**（`<0` 終端）",
        "",
        "file 上の `0x270` は PE ヘッダ域 — **DATA セグロード後** ES:0x270 が正本。",
        "",
        "### 構築パイプライン",
        "",
        "```",
        "init (42530 / 387DC):",
        "  pool[0] = 0xFFFF                    ; 空プール",
        "  push scenario_ptr                   ; 例 0x70B2 / 0xB979",
        "  push 0x270                          ; pool offset",
        "  lcall E02C → 0x0494EC",
        "",
        "DE4A @ 0x0492AE (weapon_cap 引数):",
        "  walk 4-byte シナリオ列 [di]:",
        "    word0 = cbe index (→ shl 9 CBE load)",
        "    word1 = slot/type flags (0x2000, 0x4000, si=1..6)",
        "  call 49406 検証",
        "  si 別 slot: lcall DE85/DE9A/DBD7 — cap/slot 依存",
        "  出力: u16 index を pool に append; 失敗 → FFFF",
        "",
        "post @ 0x038814:",
        "  weapon_cap = [bp+6]",
        "  pool walk — cap 不一致行を除去/スキップ",
        "```",
        "",
        "### `lcall DE4A` — slot / cap 分岐（確定）",
        "",
        "| `si` (slot type) | 処理 |",
        "|------------------|------|",
        "| **5** | `lcall DE85` @ **`0x049345`** |",
        "| **6** | `lcall DE5E` @ **`0x04931E`** |",
        "| **3** | `lcall DE9A` @ **`0x04935A`** |",
        "| **≥1** | `lcall DBD7(0x64)` @ **`0x04859A`** (IP=0xD0DA) → **`cmp cbe[+0x0A], ax`** @ 493362 |",
        "",
        "詳細: [PL_CBE_DBD7_RE.md](./PL_CBE_DBD7_RE.md) — 返値 = **weapon u16_5 mod 100**、",
        "`ammo.u16_5 >= ax` で reject。272/273(u16_5=0) は Kar98k(ax≈3) で **pass**。",
        "",
        "### seg132 unit レコード形式（部分確定）",
        "",
        "```",
        "weapon_id, meta_a, meta_b, (cbe_idx, qty)*, …",
        "```",
        "",
        f"file **`0x{seg132['start']:06X}`..`0x{seg132['start'] + seg132['len']:06X}`** — NE seg132。",
        "",
        "**Kar98k 窓** @ file `0x1DCAAC` header `[55, 58, 0]`:",
        "",
        "| idx | qty | 名称 | cap |",
        "|-----|-----|------|-----|",
    ]
    names = {57: "Kar98k", 272: "7.92-5", 273: "7.92-10G", 269: "?", 314: "Messer"}
    for row in kar98k_win:
        idx = row["idx"]
        cbe = payload["cbe_fields"].get(str(idx), {})
        cap = cbe.get("mag_cap", "—")
        lines.append(f"| **{idx}** | {row['qty']} | {names.get(idx, '?')} | {cap} |")

    lines.extend(
        [
            "",
            "> **273→272 正本**: シナリオが **272 と 273 を別 (idx,qty) で供給** →",
            "> pool 構築 (DE4A) + post cap filter (38814) + downstream +0xA4 @ 4240C/3D410",
            "> で cap10 の 273 が落ち、cap5 の 272 が残る。",
            "",
            "### E02C 呼び出しサイト",
            "",
            "| file | seg word |",
            "|------|----------|",
        ]
    )
    for site in lcall_sites:
        lines.append(f"| `{site['file_off']}` | `{site['seg_word']}` |")

    lines.extend(["", "### lcall 解決（E02C=seg word、他=offset word）", ""])
    for name, res in lcall_targets.items():
        lines.append(
            f"- **{name}** → **`0x{res['file_off']:06X}`**"
            f" (off=`{res['by_offset']['file_off']:06X}` seg=`{res['by_seg_word']['file_off']:06X}`)"
        )

    lines.extend(["", "### runtime DATA オフセット探索", ""])
    for ptr, hits in scenario_ptr_hits.items():
        lines.append(f"**ES:{ptr}** シナリオ署名 — {len(hits)} ヒット")
        for h in hits:
            lines.append(
                f"  - seg{h['seg']} `{h['file']}` ({h['tag']}) runtime **`ES:{h['runtime_ptr']}`**"
            )
    if unit_loadout_1DCAAC:
        lines.extend(
            [
                "",
                "### seg132 unit loadout @ `0x1DCAAC`（確定サンプル）",
                "",
                f"- header: `{unit_loadout_1DCAAC['header']}`",
                "",
                "| idx | qty |",
                "|-----|-----|",
            ]
        )
        for p in unit_loadout_1DCAAC["pairs"]:
            lines.append(f"| {p['idx']} | {p['qty']} |")

    if kar98k_block:
        lines.extend(
            [
                "",
                "### seg132 パース — Kar98k 装備ブロック",
                "",
                f"- header @ `{kar98k_block['header_off']}` weapon_id=**{kar98k_block['weapon_id']}** hdr1={kar98k_block['hdr1']}",
                "",
                "| idx | qty |",
                "|-----|-----|",
            ]
        )
        for p in kar98k_block["pairs"]:
            lines.append(f"| {p['idx']} | {p['qty']} |")

    sections = [
        ("DE4A 変換ループ @ 0x0492AE", "disasm_de4a_loop"),
        ("pool init @ 0x042530", "disasm_pool_init_42530"),
        ("pool init @ 0x0387DC + post 38814", "disasm_pool_init_387DC"),
        ("post cap filter @ 0x038814", "disasm_post_filter_38814"),
        ("pool append @ 0x049616", "disasm_pool_append_49616"),
        ("entry validate @ 0x049406", "disasm_validate_49406"),
    ]
    for title, key in sections:
        lines.extend(["", f"## {title}", "", "```asm", *payload[key], "```"])

    for extra in ("disasm_DBD7", "disasm_DE85", "disasm_DE9A", "disasm_DE5E"):
        if extra in payload:
            title = extra.replace("disasm_", "")
            lines.extend(["", f"## {title} @ resolved", "", "```asm", *payload[extra], "```"])

    lines.extend(
        [
            "",
            "## ST 再現指針",
            "",
            "1. **mission pool** = シナリオ (idx,qty)[] → DE4A → u16 index[] + cap post-filter",
            "2. Kar98k: シナリオに **272** が載っていれば ST は raw 273 から **置換不要**（pool 段階で分岐）",
            "3. シナリオ無し ST 暫定: `applyMagCapSubstitute` — pool+filter の圧縮",
            "",
            "## 未完了",
            "",
            "1. seg132 **レコード境界** — 可変長ヘッダ / ネスト (weapon 55→ammo 列)",
            "2. `0x70B2` / `0xB979` → file offset マップ（runtime DATA セグ）",
            "3. ~~DBD7~~ → [PL_CBE_DBD7_RE.md](./PL_CBE_DBD7_RE.md)",
            "4. DE9A / DE85 返値テーブル",
            "5. packed 記述子 `cx` @ 3D540 と mag_type=0",
            "",
            "## 関連",
            "",
            "- [PL_CBE_DBD7_RE.md](./PL_CBE_DBD7_RE.md)",
            "- [PL_CBE_273_272_PATH_RE.md](./PL_CBE_273_272_PATH_RE.md)",
            "",
        ]
    )

    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT_MD.relative_to(ROOT)}")
    print(f"E02C sites: {len(lcall_sites)}, seg132 pairs: {len(ammo_pairs)}")


if __name__ == "__main__":
    main()

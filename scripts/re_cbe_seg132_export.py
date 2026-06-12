# -*- coding: utf-8 -*-
"""
CBE RE: seg132 全 unit loadout descriptor export + 0x800F gate 整合表。

実行: python scripts/re_cbe_seg132_export.py
出力:
  scripts/pl_decoded/cbe_seg132_units.json
  docs/PL_CBE_SEG132_EXPORT.md
"""
from __future__ import annotations

import json
import struct
from collections import Counter
from datetime import date
from pathlib import Path

PL = Path(r"D:\PL")
ROOT = Path(__file__).resolve().parents[1]
CBE_PATH = PL / "CBE.EXE"
TABLE_BASE = 0x1DDF00
SEG132_START = 0x1DBF80
SEG132_END = 0x1DD9B6
MASK = 0x800F
MAX_PAIR_QTY = 20


def read_cbe(data: bytes, idx: int) -> dict | None:
    if idx <= 0 or idx > 400:
        return None
    off = TABLE_BASE + idx * 64
    if off + 64 > len(data):
        return None
    rec = data[off : off + 64]
    mag = struct.unpack_from("<H", rec, 0x2A)[0]
    cap = struct.unpack_from("<H", rec, 0x28)[0]
    return {
        "idx": idx,
        "mag_type": mag,
        "mag_masked": mag & MASK,
        "mag_cap": cap,
    }


def parse_pairs(data: bytes, off: int, end: int, limit: int = 16) -> tuple[list[dict], int]:
    pairs = []
    p = off
    while p + 4 <= end and len(pairs) < limit:
        idx, qty = struct.unpack_from("<HH", data, p)
        if idx in (0, 0xFFFF) or idx > 400 or qty == 0 or qty > MAX_PAIR_QTY:
            break
        pairs.append({"idx": idx, "qty": qty, "file": f"0x{p:06X}"})
        p += 4
    return pairs, p


def scan_descriptors(data: bytes, start: int, end: int) -> list[dict]:
    blocks = []
    off = start
    seen = set()
    while off + 6 < end:
        weapon_id, mag_word, pad = struct.unpack_from("<3H", data, off)
        if not (1 <= weapon_id <= 400 and pad == 0 and 0x0030 <= mag_word <= 0x00FF):
            off += 2
            continue
        pairs, next_off = parse_pairs(data, off + 6, end)
        if len(pairs) < 2:
            off += 2
            continue
        key = off
        if key in seen:
            off += 2
            continue
        seen.add(key)
        hdr_masked = mag_word & MASK
        enriched = []
        for p in pairs:
            cbe = read_cbe(data, p["idx"])
            gate = None
            if cbe:
                gate = (cbe["mag_masked"] == hdr_masked) if cbe["mag_type"] else None
            enriched.append({**p, "cbe": cbe, "gate_pass1_masked": gate})
        blocks.append(
            {
                "file_off": f"0x{off:06X}",
                "weapon_id": weapon_id,
                "mag_word": mag_word,
                "mag_hex": f"0x{mag_word:04X}",
                "cx_gate": hdr_masked,
                "class_nibble": mag_word & 0xF,
                "buffer": "B" if (mag_word & 0xF) >= 4 else "A",
                "pairs": enriched,
                "pass1_hits": [p["idx"] for p in enriched if p.get("gate_pass1_masked")],
            }
        )
        off = next_off if next_off > off else off + 2
    return blocks


def scan_mag68_standalone(data: bytes, start: int, end: int) -> list[dict]:
    """mag_word=0x0044 単独 + 可変 prefix の行（Kar98k mag68 等）。"""
    hits = []
    for mag in (0x0044, 0x0048, 0x0071, 0x0072, 0x0074, 0x0075):
        p = start
        while p < end - 8:
            p = data.find(struct.pack("<H", mag), p, end)
            if p < 0:
                break
            w0, w1 = struct.unpack_from("<HH", data, p - 4 if p >= start + 4 else p)
            pairs, _ = parse_pairs(data, p + 4, end)
            if not pairs:
                pairs, _ = parse_pairs(data, p + 8, end)
            if len(pairs) >= 2 and all(250 <= x["idx"] <= 320 or x["idx"] == 314 for x in pairs[:3]):
                hits.append(
                    {
                        "file_off": f"0x{p:06X}",
                        "mag_word": mag,
                        "mag_hex": f"0x{mag:04X}",
                        "cx_gate": mag & MASK,
                        "pairs": pairs,
                    }
                )
            p += 2
    return hits


def weapon_name(data: bytes, weapon_id: int) -> str:
    cbe = read_cbe(data, weapon_id)
    if not cbe:
        return f"weapon_{weapon_id}"
    return f"cbe_{weapon_id}"


def main() -> None:
    if not CBE_PATH.is_file():
        raise SystemExit(f"CBE not found: {CBE_PATH}")

    data = CBE_PATH.read_bytes()
    descriptors = scan_descriptors(data, SEG132_START, SEG132_END)
    mag68_extra = scan_mag68_standalone(data, SEG132_START, SEG132_END)

    mag_counter = Counter(d["mag_hex"] for d in descriptors)
    weapon_counter = Counter(d["weapon_id"] for d in descriptors)

    kar98k = next((d for d in descriptors if d["weapon_id"] == 55 and d["mag_hex"] == "0x003A"), None)

    payload = {
        "generated": date.today().isoformat(),
        "seg132": {"start": f"0x{SEG132_START:06X}", "end": f"0x{SEG132_END:06X}"},
        "summary": {
            "descriptor_blocks": len(descriptors),
            "unique_weapons": len(weapon_counter),
            "mag_word_counts": dict(mag_counter.most_common()),
        },
        "descriptors": descriptors,
        "mag68_standalone_hits": mag68_extra[:10],
        "kar98k": kar98k,
        "gate_rule": "(ammo.mag_type & 0x800F) == (header & 0x800F)",
    }

    out_json = ROOT / "scripts" / "pl_decoded" / "cbe_seg132_units.json"
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# CBE seg132 — unit loadout descriptor 全 export",
        "",
        f"**生成**: {payload['generated']} — `python scripts/re_cbe_seg132_export.py`",
        "",
        "## 結論",
        "",
        f"- seg132 file `0x{SEG132_START:06X}`..`0x{SEG132_END:06X}`",
        f"- **loadout descriptor ブロック: {len(descriptors)}** 件",
        f"- 形式: `[weapon_id, mag_word, 0]` + `(cbe_idx, qty)*`",
        f"- pass1 gate（masked）: `(ammo.mag_type & 0x800F) == (mag_word & 0x800F)`",
        "",
        "### mag_word 分布",
        "",
        "| mag_word | 件数 | cx_gate |",
        "|----------|------|---------|",
    ]
    for mag, cnt in mag_counter.most_common():
        cx = int(mag, 16) & MASK
        lines.append(f"| `{mag}` | {cnt} | {cx} |")

    if kar98k:
        lines.extend(
            [
                "",
                "### Kar98k @ `0x1DCAAC`（weapon_id=55）",
                "",
                f"- mag_word `{kar98k['mag_hex']}` cx_gate=**{kar98k['cx_gate']}**",
                "",
                "| idx | qty | mag_type | masked | pass1 |",
                "|-----|-----|----------|--------|-------|",
            ]
        )
        for p in kar98k["pairs"]:
            c = p.get("cbe") or {}
            gp = p.get("gate_pass1_masked")
            lines.append(
                f"| **{p['idx']}** | {p['qty']} | {c.get('mag_type', '—')} | "
                f"{c.get('mag_masked', '—')} | {'PASS' if gp else 'pass2/other'} |"
            )
        lines.append(f"- pass1 masked hits: **{kar98k['pass1_hits']}**")

    lines.extend(
        [
            "",
            "### 全 descriptor 一覧（weapon_id 順）",
            "",
            "| file | weapon | mag | pairs | pass1 |",
            "|------|--------|-----|-------|-------|",
        ]
    )
    for d in sorted(descriptors, key=lambda x: (x["weapon_id"], x["file_off"])):
        pair_s = ", ".join(f"{p['idx']}×{p['qty']}" for p in d["pairs"][:5])
        if len(d["pairs"]) > 5:
            pair_s += ", …"
        lines.append(
            f"| `{d['file_off']}` | **{d['weapon_id']}** | `{d['mag_hex']}` | "
            f"{pair_s} | {d['pass1_hits'] or '—'} |"
        )

    lines.extend(
        [
            "",
            "## JSON",
            "",
            f"機械可読: [`scripts/pl_decoded/cbe_seg132_units.json`](../scripts/pl_decoded/cbe_seg132_units.json)",
            "",
            "## ST 再現指針",
            "",
            "1. JSON `descriptors[]` を ST loadout テンプレ seed に流用",
            "2. `pass1_hits` のみ mag_type gate; 残りは cap / pass2 / 副装",
            "3. mag68 行は weapon 55 窓に **別 mag_word `0x0044`** 行あり（`0x1DC752` 付近）",
            "",
            "## 関連",
            "",
            "- [PL_CBE_800F_MASK_RE.md](./PL_CBE_800F_MASK_RE.md)",
            "- [PL_CBE_LOADOUT_TEMPLATE_RE.md](./PL_CBE_LOADOUT_TEMPLATE_RE.md)",
            "- [PL_CBE_RE_INDEX.md](./PL_CBE_RE_INDEX.md)",
            "",
        ]
    )

    out_md = ROOT / "docs" / "PL_CBE_SEG132_EXPORT.md"
    out_md.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {out_md.relative_to(ROOT)}")
    print(f"descriptors={len(descriptors)} json={out_json.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

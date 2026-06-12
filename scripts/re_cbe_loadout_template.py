# -*- coding: utf-8 -*-
"""
CBE RE: loadout descriptor テンプレ — seg132 静的 dump + DS:0x13BD 探索。

実行: python scripts/re_cbe_loadout_template.py
出力:
  docs/PL_CBE_LOADOUT_TEMPLATE_RE.md
  scripts/pl_decoded/cbe_loadout_template_re.json
"""
from __future__ import annotations

import json
import struct
from datetime import date
from pathlib import Path

PL = Path(r"D:\PL")
ROOT = Path(__file__).resolve().parents[1]
CBE_PATH = PL / "CBE.EXE"
TABLE_BASE = 0x1DDF00
SEG132_START = 0x1DBF80
SEG132_END = 0x1DD9B6

# 確定サンプル（prior RE + 本 scan）
KAR98K_MAG58_OFF = 0x1DCAAC  # header [55, 58, 0] → pairs @ +6
MAG68_PAIR_OFF = 0x1DC75C  # 274×2, 273×6, 314×1 — header word 0x0044 @ 0x1DC752
KAR98K_BLOCKS = (
    KAR98K_MAG58_OFF,
    0x1DCA98,  # mag58 alt（別 weapon 窓）
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
        segs.append(
            {
                "num": i + 1,
                "start": raw * align,
                "len": ln if ln else 65536,
                "para": raw * 16,
                "is_code": (fl & 1) == 0,
            }
        )
    return segs


def read_cbe(data: bytes, idx: int) -> dict:
    off = TABLE_BASE + idx * 64
    rec = data[off : off + 64]
    return {
        "idx": idx,
        "mag_type": struct.unpack_from("<H", rec, 0x2A)[0],
        "mag_cap": struct.unpack_from("<H", rec, 0x28)[0],
    }


def parse_header_at(data: bytes, off: int) -> dict:
    if off + 4 > len(data):
        return {}
    word = struct.unpack_from("<H", data, off)[0]
    lo = word & 0xFF
    return {
        "file": f"0x{off:06X}",
        "word": word,
        "hex": f"0x{word:04X}",
        "cx_gate": word & 0x800F,
        "group_nibble": (word & 0xF0) >> 4,
        "class_nibble": lo & 0xF,
        "buffer": "B (0x18a)" if (lo & 0xF) >= 4 else "A (0x128)",
    }


def parse_descriptor_block(data: bytes, off: int, pair_off: int | None = None) -> dict:
    """seg132 loadout descriptor — [weapon_id, mag_word, 0] + (idx,qty)*。"""
    if off + 6 > len(data):
        return {}
    weapon_id, mag_word, pad = struct.unpack_from("<3H", data, off)
    hdr = parse_header_at(data, off + 2)  # mag_word drives cx_gate / buffer
    hdr["weapon_id"] = weapon_id
    hdr["pad"] = pad
    hdr["block_off"] = f"0x{off:06X}"
    poff = pair_off if pair_off is not None else off + 6
    pairs = parse_index_pairs(data, poff)
    return {"header": hdr, "pairs": pairs, "pairs_off": f"0x{poff:06X}"}


def parse_index_pairs(data: bytes, off: int, limit: int = 8) -> list[dict]:
    pairs = []
    p = off
    for _ in range(limit):
        if p + 4 > len(data):
            break
        idx, qty = struct.unpack_from("<HH", data, p)
        if idx in (0, 0xFFFF) or idx > 400 or qty == 0 or qty > 20:
            break
        pairs.append({"idx": idx, "qty": qty})
        p += 4
    return pairs


def scan_mag_headers(data: bytes, start: int, end: int) -> list[dict]:
    hits = []
    for mag, tag in ((0x003A, "mag58"), (0x0044, "mag68"), (0x803A, "mag58_flag"), (0x8044, "mag68_flag")):
        p = start
        while p < end - 4:
            p = data.find(struct.pack("<H", mag), p, end)
            if p < 0:
                break
            hdr = parse_header_at(data, p)
            pairs = parse_index_pairs(data, p + 6)
            if pairs:
                hits.append({"tag": tag, "header": hdr, "pairs": pairs})
            p += 2
    return hits


def scan_key_table(data: bytes, segs: list[dict], base_off: int = 0x2CE) -> list[dict]:
    """weapon_key*12+0x2CE 候補 — pc/sc 妥当行。"""
    rows = []
    for s in segs:
        if s["is_code"]:
            continue
        for key in range(400):
            fo = s["start"] + base_off + key * 12
            if fo + 12 > s["start"] + s["len"]:
                break
            w = struct.unpack_from("<6H", data, fo)
            if 1 <= w[2] <= 12 and 1 <= w[3] <= 4:
                rows.append(
                    {
                        "seg": s["num"],
                        "key": key,
                        "file": f"0x{fo:06X}",
                        "words": list(w),
                        "para": f"0x{s['para']:04X}",
                    }
                )
    return rows


def resolve_ds_13bd(segs: list[dict]) -> list[dict]:
    """DS=0x13BD paragraph 候補 — para 一致 or 名前付き seg103。"""
    target = 0x13BD
    hits = []
    for s in segs:
        if s["para"] == target * 16:
            hits.append({"seg": s["num"], "match": "para*16", **s})
        if s["start"] == 0x13B280:
            hits.append({"seg": s["num"], "match": "file~0x13Bxxx", **s})
    return hits


def main() -> None:
    if not CBE_PATH.is_file():
        raise SystemExit(f"CBE not found: {CBE_PATH}")

    data = CBE_PATH.read_bytes()
    segs = read_ne(data)

    kar98k_samples = []
    for off in KAR98K_BLOCKS:
        kar98k_samples.append(parse_descriptor_block(data, off))

    mag68_hdr = parse_header_at(data, 0x1DC752)
    mag68_pairs = parse_index_pairs(data, MAG68_PAIR_OFF)
    mag68_block = {
        "header": {**mag68_hdr, "block_off": "0x1DC752", "weapon_id": None, "pad": None},
        "pairs": mag68_pairs,
        "pairs_off": f"0x{MAG68_PAIR_OFF:06X}",
        "prefix_u16": list(struct.unpack_from("<2H", data, 0x1DC758)),
    }
    kar98k_samples.append(mag68_block)

    mag_scan = scan_mag_headers(data, SEG132_START, SEG132_END)
    key_rows = [r for r in scan_key_table(data, segs) if r["seg"] == 132][:5]
    ds_hits = resolve_ds_13bd(segs)

    payload = {
        "generated": date.today().isoformat(),
        "seg132": {"start": f"0x{SEG132_START:06X}", "end": f"0x{SEG132_END:06X}"},
        "ds_13bd_candidates": [
            {k: v for k, v in h.items() if k != "is_code"} for h in ds_hits
        ],
        "weapon_key_table_rows": key_rows,
        "kar98k_confirmed_samples": kar98k_samples,
        "mag68": mag68_block,
        "seg132_mag_header_hits": mag_scan[:30],
        "cbe_refs": {
            str(k): read_cbe(data, k) for k in (57, 55, 272, 273, 269, 274, 314)
        },
    }

    out_json = ROOT / "scripts" / "pl_decoded" / "cbe_loadout_template_re.json"
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    k0 = kar98k_samples[0]
    h0 = k0["header"]
    lines = [
        "# CBE loadout descriptor テンプレ — seg132 静的 dump RE",
        "",
        f"**生成**: {payload['generated']} — `python scripts/re_cbe_loadout_template.py`",
        "",
        "## 結論",
        "",
        "### 静的 descriptor 正本 = **NE seg132**（file `0x1DBF80`..`0x1DD9B6`）",
        "",
        "runtime `DS:0x13BD` の **file マップはロード時パッチ依存**で単一確定できず。",
        "しかし **Kar98k 装填 descriptor** は seg132 内に **明示的に存在**（mission/unit テーブルと同所）。",
        "",
        f"### Kar98k 確定ブロック @ `{h0['block_off']}`",
        "",
        "```",
        f"header = [weapon_id={h0['weapon_id']}, mag_word={h0['hex']}, pad={h0['pad']}]",
        f"mag_word & 0x800F = cx_gate **{h0['cx_gate']}**",
        f"  (raw mag_type 58 → masked **0x000A** = 10 — cmp 挙動要 runtime 確認)",
        f"class nibble = {h0['class_nibble']}  →  buffer **{h0['buffer']}**",
        f"index pairs @ {k0['pairs_off']}",
        "```",
        "",
        "| idx | qty | CBE 名称 | mag_type | cap |",
        "|-----|-----|----------|----------|-----|",
    ]
    names = {272: "7.92-5", 273: "7.92-10G", 269: "?", 314: "Messer", 274: "?"}
    for p in k0["pairs"]:
        c = payload["cbe_refs"].get(str(p["idx"]), {})
        lines.append(
            f"| **{p['idx']}** | {p['qty']} | {names.get(p['idx'],'?')} | "
            f"{c.get('mag_type','—')} | {c.get('mag_cap','—')} |"
        )

    lines.extend(
        [
            "",
            "**272 と 273 が同一 mag58 グループ内に共存** — 3D540 では別 header 行（58 vs 68）で分岐。",
            "",
            "### mag68 行 @ `0x1DC752`（参考）",
            "",
        ]
    )
    k68 = kar98k_samples[-1]
    h68 = k68["header"]
    lines.append(f"- header mag_word `{h68['hex']}` cx_gate=**{h68['cx_gate']}** @ `{h68['file']}`")
    if k68.get("prefix_u16"):
        lines.append(f"- pairs 直前 u16: `{k68['prefix_u16']}`（308×2 — 用途未確定、pairs は `{k68['pairs_off']}` から）")
    lines.append("- pairs: " + ", ".join(f"{p['idx']}×{p['qty']}" for p in k68["pairs"]))

    lines.extend(
        [
            "",
            "### `weapon_key` 12B テーブル（`key*12+0x2CE`）",
            "",
            f"全 DATA seg 走査で pc/sc 妥当行: **{len(key_rows)}** 件。",
            "",
        ]
    )
    if key_rows:
        r = key_rows[0]
        lines.append(f"- 例: seg{r['seg']} key={r['key']} @ `{r['file']}` words=`{r['words']}`")
    else:
        lines.append("- seg132 内 **0 件** — 12B 行は **別 seg（runtime DS）** の可能性大")

    lines.extend(
        [
            "",
            "### 3D42A との接続（復習）",
            "",
            "```",
            "3D72A: weapon_key = ad1c[+0xF0] → DS:+key*12+0x2CE → ad18+0x52 (12B)",
            "3DBC2: ad18 テンプレ → ad1c+0x46 blob",
            "3D42A: blob header → cx=&0x800F → cmp ammo[+0x2A] @ 3D540",
            "         index 列は buffer A(0x128)/B(0x18a) — 3D4D7 class nibble",
            "```",
            "",
            "seg132 の (idx,qty) 列は **index buffer 内容**と整合 — header `0x003A`/`0x0044` は",
            "`3D540` の cx 期待値そのもの。",
            "",
            "### DS:0x13BD 探索",
            "",
        ]
    )
    if ds_hits:
        for h in ds_hits:
            lines.append(f"- seg{h['seg']} `{h['match']}` file=`0x{h['start']:06X}` para=`0x{h['para']:04X}`")
    else:
        lines.append("- file `0x13B280` 付近 seg103 を **候補**とするが、中身は cp932 文字列域が主")

    lines.extend(
        [
            "",
            f"seg132 mag58/68 ヘッダ scan: **{len(mag_scan)}** 件（先頭30件を JSON）",
            "",
            "## ST 再現指針",
            "",
            "1. **短期**: seg132 から unit 別 `(header, [(idx,qty)...])` を JSON export",
            "2. **中期**: `3DBC2` 相当 — header stream + index buffer を blob 合成",
            "3. **3D540**: `cx = header & 0x800F` — [PL_CBE_MAG_TYPE_3D540_RE.md](./PL_CBE_MAG_TYPE_3D540_RE.md)",
            "",
            "Kar98k ST 暫定:",
            "```json",
            json.dumps(
                {
                    "groups": [
                        {"cx": 58, "indices": [272, 269, 273, 314]},
                        {"cx": 68, "indices": [274, 273, 314]},
                    ]
                },
                indent=2,
            ),
            "```",
            "",
            "## 未完了",
            "",
            "1. runtime **DS:0x13BD → file seg** reloc / ローダマップ",
            "2. **ad1c+0xF0** 書込箇所 — weapon_key と cbe 57 の対応",
            "3. buffer **0x128/0x18a** の file/runtime ダンプ",
            "",
            "## 関連",
            "",
            "- [PL_CBE_3DBC2_RE.md](./PL_CBE_3DBC2_RE.md)",
            "- [PL_CBE_MAG_TYPE_3D540_RE.md](./PL_CBE_MAG_TYPE_3D540_RE.md)",
            "- [PL_CBE_MISSION_POOL_RE.md](./PL_CBE_MISSION_POOL_RE.md)",
            "- [PL_CBE_RE_INDEX.md](./PL_CBE_RE_INDEX.md)",
            "",
        ]
    )

    out_md = ROOT / "docs" / "PL_CBE_LOADOUT_TEMPLATE_RE.md"
    out_md.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {out_md.relative_to(ROOT)}")
    print(f"mag headers={len(mag_scan)} key_rows={len(key_rows)}")


if __name__ == "__main__":
    main()

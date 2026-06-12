# -*- coding: utf-8 -*-
"""
CBE RE: 表示名称プール (pool_idx) ↔ cbe index 変換表 — DATA セグ走査。

3 系統の名称:
  A) cbe_name_table @ M1911 連鎖 — index == cbeNameIndex（stats/装填正本）
  B) 0x2170D0 連鎖 — table_index = cbeNameIndex + 3（先頭3件プレフィックス）
  C) 0x216E00 表示プール — pool_idx ≠ cbe（装備 UI @ 0x4240C 表示用）

実行: python scripts/re_cbe_pool_cbe_scan.py
出力:
  docs/PL_CBE_POOL_CBE_RE.md
  data/pl_cbe_pool_map.js
  scripts/pl_decoded/cbe_pool_cbe_re.json
"""
from __future__ import annotations

import json
import struct
from collections import Counter
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CBE = Path(r"D:\PL\CBE.EXE")
OUT_MD = ROOT / "docs" / "PL_CBE_POOL_CBE_RE.md"
OUT_JS = ROOT / "data" / "pl_cbe_pool_map.js"
OUT_JSON = ROOT / "scripts" / "pl_decoded" / "cbe_pool_cbe_re.json"
NAMES_JSON = ROOT / "data" / "cbe_name_table.json"
STATS_JSON = ROOT / "data" / "wpns_pl_stats_decoded.json"

POOL_LO = 0x2170D0  # 先頭に (none)/バイナリ — ASCII 厳密で M1911A1@0x2170EC = cbe0
POOL_HI = 0x218800
POOL_CBE0_OFF = 0x2170EC  # M1911A1 — pool_idx==cbe_idx の原点
TABLE_CBE_PLUS3 = 0x2170D0
RECORD_BASE = 0x1DDF00
RECORD_STRIDE = 64
MISSION_TABLE_OFF = 0x270  # candidate index list @ 4240C


def parse_ne(data: bytes) -> tuple[dict, list[dict]]:
    ne = struct.unpack_from("<I", data, 0x3C)[0]
    align = 1 << struct.unpack_from("<H", data, ne + 0x32)[0]
    n = struct.unpack_from("<H", data, ne + 0x1C)[0]
    sa = ne + struct.unpack_from("<H", data, ne + 0x22)[0]
    auto_data = struct.unpack_from("<H", data, ne + 0x0E)[0]
    segs = []
    for i in range(n):
        o = sa + i * 8
        raw, ln, fl, _ = struct.unpack_from("<HHHH", data, o)
        start = raw * align
        length = ln if ln else 65536
        segs.append(
            {
                "seg_num": i + 1,
                "file_start": start,
                "file_end": start + length,
                "is_code": (fl & 1) == 0,
            }
        )
    return {"auto_data_seg": auto_data, "align": align}, segs


def parse_string_chain(data: bytes, start: int, end: int, *, cp932: bool = False, ascii_only: bool = True) -> list[dict]:
    out: list[dict] = []
    p = start
    idx = 0
    while p < end:
        e = data.find(b"\x00", p, min(p + 96, len(data)))
        if e < 0:
            break
        if e > p:
            raw = data[p:e]
            try:
                text = raw.decode("cp932" if cp932 else "ascii")
            except UnicodeDecodeError:
                text = ""
            printable = text and 1 <= len(text) <= 64
            if ascii_only and printable:
                printable = all(0x20 <= ord(c) < 0x7F for c in text)
            if printable:
                out.append({"idx": idx, "file_off": p, "name": text})
                idx += 1
        p = e + 1
    return out


def parse_display_pool(data: bytes) -> list[dict]:
    """装備 UI 名称列 — cbe0 @ 0x2170EC, pool_idx == cbe_idx。"""
    chain = parse_string_chain(data, POOL_CBE0_OFF, POOL_HI, ascii_only=True)
    for i, row in enumerate(chain):
        row["idx"] = i  # force cbe-aligned index
    return chain


def parse_extended_table(data: bytes) -> list[dict]:
    """0x2170D0 から — (none) 等プレフィックス含む拡張テーブル。"""
    return parse_string_chain(data, TABLE_CBE_PLUS3, POOL_HI, ascii_only=True)


def detect_cbe_chain_start(data: bytes) -> int:
    hit = data.find(b"M1911A1\x00")
    if hit < 0:
        return 0x2170D0
    return hit


def load_cbe_names() -> dict[int, str]:
    if not NAMES_JSON.exists():
        return {}
    raw = json.loads(NAMES_JSON.read_text(encoding="utf-8"))
    return {int(k): v for k, v in raw.items()}


def normalize_name(s: str) -> str:
    return "".join(s.split()).lower()


def match_pool_to_cbe(pool: list[dict], cbe_names: dict[int, str]) -> list[dict]:
    by_norm = {normalize_name(v): int(k) for k, v in cbe_names.items()}
    rows = []
    for p in pool:
        pn = p["name"]
        pi = p["idx"]
        # primary rule: pool_idx == cbe_idx when chain starts at M1911A1
        cbe = pi if cbe_names.get(pi) == pn else cbe_names.get(pn)
        if cbe is None:
            cbe = by_norm.get(normalize_name(pn))
        rows.append(
            {
                "poolIdx": pi,
                "poolOff": f"0x{p['file_off']:06X}",
                "name": pn,
                "cbeIdx": cbe,
                "delta": (pi - cbe) if cbe is not None else None,
                "identity": cbe == pi if cbe is not None else None,
            }
        )
    return rows


def read_record_u16(data: bytes, cbe_idx: int) -> list[int]:
    off = RECORD_BASE + cbe_idx * RECORD_STRIDE
    return [struct.unpack_from("<H", data, off + i)[0] for i in range(0, 64, 2)]


def scan_u16_tables(data: bytes, segs: list[dict], target: dict[int, int], *, window: int = 0x220000) -> list[dict]:
    """pool_idx 順の u16 列が cbe index 列と一致する DATA 領域を探索。"""
    if not target:
        return []
    max_pool = max(target)
    need_len = (max_pool + 1) * 2
    hits = []
    # DATA-ish: high file offsets + non-code segs
    regions = [(POOL_LO - 0x2000, POOL_HI + 0x8000), (0x1A0000, 0x220000)]
    for lo, hi in regions:
        lo = max(0, lo)
        hi = min(len(data), hi)
        for base in range(lo, hi - need_len, 2):
            ok = 0
            checked = 0
            for pi, cbe in sorted(target.items()):
                if pi * 2 + 2 > need_len:
                    break
                val = struct.unpack_from("<H", data, base + pi * 2)[0]
                if val == cbe:
                    ok += 1
                checked += 1
                if checked >= 80:
                    break
            if checked >= 40 and ok / checked >= 0.85:
                hits.append({"file_off": base, "match_rate": round(ok / checked, 3), "checked": checked})
    hits.sort(key=lambda x: (-x["match_rate"], -x["checked"]))
    return hits[:20]


def scan_mission_table(data: bytes, cbe_names: dict[int, str]) -> list[dict]:
    """4240C が参照する候補 index 列 — es:[0x270] 相当を file 内で探索。"""
    # 既知: 先頭付近 0x270 は PE ヘッダ域。ランタイム DATA にコピーされる別列。
    # MG34(91), PatrK15(116), Laf34(112) 等が連続する u16 列を探索。
    needles = [91, 116, 112, 34, 35, 32, 31]
    rows = []
    for base in range(0x1A0000, min(len(data) - 200, 0x220000), 2):
        ok = 0
        for i, n in enumerate(needles):
            if struct.unpack_from("<H", data, base + i * 2)[0] == n:
                ok += 1
        if ok >= 4:
            for i in range(40):
                val = struct.unpack_from("<H", data, base + i * 2)[0]
                if val == 0xFFFF or val > 400:
                    break
                rows.append({"slot": i, "file_off": base + i * 2, "cbeIdx": val, "name": cbe_names.get(val, "")})
            if rows:
                break
    return rows


def scan_pool_order_in_data(data: bytes, mapping: list[dict]) -> list[dict]:
    """pool 順に cbe index が並ぶ u16 配列（部分一致）。"""
    known = [(r["poolIdx"], r["cbeIdx"]) for r in mapping if r["cbeIdx"] is not None]
    if len(known) < 20:
        return []
    hits = []
    # sliding window on u16 sequences
    seq = [cbe for _, cbe in sorted(known) if cbe is not None][:120]
    pat = struct.pack(f"<{len(seq)}H", *seq)
    p = 0
    while True:
        i = data.find(pat[: min(40, len(pat))], p, 0x220000)
        if i < 0:
            break
        hits.append({"file_off": i, "pattern_len": min(40, len(pat)) // 2})
        p = i + 1
        if len(hits) >= 15:
            break
    return hits


def analyze_record_name_field(data: bytes, cbe_names: dict[int, str], pool_map: dict[int, int]) -> list[dict]:
    """64B レコード u16[0] と各名称系の対応。"""
    samples = []
    for cbe in sorted(cbe_names)[:120]:
        u = read_record_u16(data, cbe)
        samples.append(
            {
                "cbeIdx": cbe,
                "name": cbe_names[cbe],
                "u0_nameIdx": u[0],
                "u0_minus1": u[0] - 1,
                "u0_minus3": u[0] - 3,
                "poolForCbe": next((pi for pi, ci in pool_map.items() if ci == cbe), None),
            }
        )
    return samples


def infer_rules(mapping: list[dict], record_samples: list[dict]) -> dict:
    deltas = [r["delta"] for r in mapping if r["delta"] is not None]
    ctr = Counter(deltas)
    # u16[0] vs cbe
    u0_eq_cbe = sum(1 for s in record_samples if s["u0_nameIdx"] == s["cbeIdx"] + 1)
    u0_eq_pool = sum(
        1
        for s in record_samples
        if s["poolForCbe"] is not None and s["u0_nameIdx"] == s["poolForCbe"] + 1
    )
    plus3_hits = sum(
        1
        for s in record_samples
        if s["name"] and s["u0_nameIdx"] == s["cbeIdx"] + 3
    )
    identity = sum(1 for r in mapping if r.get("identity"))
    return {
        "poolMatched": sum(1 for r in mapping if r["cbeIdx"] is not None),
        "poolTotal": len(mapping),
        "poolIdentity": identity,
        "deltaTop": ctr.most_common(8),
        "recordU0_eq_cbePlus1": u0_eq_cbe,
        "recordU0_eq_poolPlus1": u0_eq_pool,
        "recordU0_eq_cbePlus3": plus3_hits,
        "recordSamples": len(record_samples),
    }


def write_js(mapping: list[dict], rules: dict, ext_cbe0_idx: int | None) -> None:
    pool_to_cbe = {str(r["poolIdx"]): r["cbeIdx"] for r in mapping if r["cbeIdx"] is not None}
    cbe_to_pool = {}
    for r in mapping:
        if r["cbeIdx"] is not None and r["cbeIdx"] not in cbe_to_pool:
            cbe_to_pool[str(r["cbeIdx"])] = r["poolIdx"]
    payload = {
        "generated": date.today().isoformat(),
        "rules": {
            "primary": "pool_idx == cbe_idx @ 0x2170EC",
            "displayPool": {"cbe0": f"0x{POOL_CBE0_OFF:X}", "end": f"0x{POOL_HI:X}"},
            "extendedTable": {"start": f"0x{TABLE_CBE_PLUS3:X}", "cbe0_ext_idx": ext_cbe0_idx},
            "cbeChain": "index == cbeNameIndex — cbe_name_table.json",
            "recordU16_0": "cbeNameIndex + 1 (1-indexed name ref)",
        },
        "stats": rules,
        "poolToCbe": pool_to_cbe,
        "cbeToPool": cbe_to_pool,
    }
    lines = [
        "/** CBE 表示プール ↔ cbe index — 自動生成",
        " *  regen: python scripts/re_cbe_pool_cbe_scan.py",
        " */",
        "(function () {",
        "    'use strict';",
        "    window.PL_CBE_POOL_TO_CBE = " + json.dumps(pool_to_cbe, indent=4) + ";",
        "    window.PL_CBE_CBE_TO_POOL = " + json.dumps(cbe_to_pool, indent=4) + ";",
        "    window.PL_CBE_POOL_MAP_META = " + json.dumps(payload["rules"], ensure_ascii=False, indent=4) + ";",
        "})();",
        "",
    ]
    OUT_JS.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    if not CBE.is_file():
        raise SystemExit(f"CBE not found: {CBE}")

    data = CBE.read_bytes()
    hdr, segs = parse_ne(data)
    cbe_names = load_cbe_names()

    chain_start = detect_cbe_chain_start(data)
    pool = parse_display_pool(data)
    table_ext = parse_extended_table(data)
    table_chain = parse_display_pool(data)  # same as pool when aligned at cbe0

    mapping = match_pool_to_cbe(pool, cbe_names)
    pool_to_cbe = {r["poolIdx"]: r["cbeIdx"] for r in mapping if r["cbeIdx"] is not None}

    record_samples = analyze_record_name_field(data, cbe_names, pool_to_cbe)
    rules = infer_rules(mapping, record_samples)

    table_hits = scan_u16_tables(data, segs, pool_to_cbe)
    seq_hits = scan_pool_order_in_data(data, mapping)
    mission = scan_mission_table(data, cbe_names)

    # extended table: find offset of cbe0 name in ext table
    ext_cbe0_idx = next((r["idx"] for r in table_ext if r["name"] == "M1911A1"), None)

    plus3_checks = []
    for cbe, name in list(cbe_names.items())[:40]:
        ext_i = (ext_cbe0_idx + cbe) if ext_cbe0_idx is not None else cbe + 3
        got = table_ext[ext_i]["name"] if ext_i < len(table_ext) else ""
        plus3_checks.append({"cbe": cbe, "expected": name, "extIdx": ext_i, "got": got, "ok": got == name})

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(
        json.dumps(
            {
                "generated": date.today().isoformat(),
                "rules": rules,
                "chain_start": f"0x{chain_start:X}",
                "pool_count": len(pool),
                "table_ext_count": len(table_ext),
                "ext_cbe0_idx": ext_cbe0_idx,
                "table_chain_count": len(table_chain),
                "mapping": mapping,
                "table_hits": table_hits,
                "seq_hits": seq_hits,
                "mission_table_sample": mission[:60],
                "plus3_checks": plus3_checks,
                "record_samples_head": record_samples[:25],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    write_js(mapping, rules, ext_cbe0_idx)

    identity_pct = (
        f"{rules['poolIdentity']}/{rules['poolTotal']}"
        if rules["poolTotal"]
        else "—"
    )
    unmatched = [r for r in mapping if r["cbeIdx"] is None and r["name"].strip()][:30]
    aux_matched = [
        r
        for r in mapping
        if r["cbeIdx"] is not None
        and any(k in r["name"] for k in ("Tripod", "Ammobox", "PatrK", "Laf", "Binoc", "Ferng", "Byt", "Messer"))
    ]

    lines = [
        "# CBE 名称系統 RE — 表示プール / cbe index / DATA 走査",
        "",
        f"**生成**: {date.today().isoformat()} — `python scripts/re_cbe_pool_cbe_scan.py`",
        "",
        "## 全体像（確定）",
        "",
        "```",
        "CBE 名称 @ file 0x2170xx",
        "  ├─ 拡張テーブル @ 0x2170D0 … (none) 等プレフィックス → M1911A1",
        "  ├─ 正本チェーン @ 0x2170EC … pool_idx == cbeNameIndex",
        "  │     M1911A1(0), M1917 S&W(1), … Laf34(112), PatrK15(116)",
        "  └─ 64B レコード u16[0] = cbeNameIndex + 1（1-indexed 名称参照）",
        "",
        "装備 UI @ 0x4240C 出力 member+0x3E = cbe index 直値（pool 変換不要）",
        "```",
        "",
        "> **訂正**: 旧「pool#67=M1 Ammobox, cbe=34」は **0x216E00 からの誤パース**（0xFF 域を",
        "> cp932 カウント）。正しくは **pool#34 = cbe#34** @ 0x217224。",
        "",
        f"| 系統 | 件数 | ルール |",
        f"|------|------|--------|",
        f"| 正本 name chain | {len(pool)} | **pool_idx == cbe_idx** @ 0x2170EC |",
        f"| 拡張テーブル | {len(table_ext)} | cbe0 @ ext_idx **{ext_cbe0_idx}** |",
        f"| identity 一致 | {identity_pct} | 名称も cbe_name_table と一致 |",
        "",
        f"**DATA u16 変換表**: 別途 **不要** — 名称列自体が cbe 順。",
        "",
        "## 3 系統の使い分け",
        "",
        "| 用途 | 参照 |",
        "|------|------|",
        "| stats / acceptsAmmo / 装填 | `cbeNameIndex` → cbe_name_table.json |",
        "| 64B レコード名称 | u16[0] = cbe + 1 |",
        "| 装備 UI リスト / 4240C | cbe index 直値 — 名称は chain[cbe] |",
        "",
        "## 64B レコード u16[0]",
        "",
        f"| 検証 | 件数 |",
        f"|------|------|",
        f"| u16[0] == cbe+1 | {rules['recordU0_eq_cbePlus1']}/{rules['recordSamples']} |",
        f"| u16[0] == pool+1 | {rules['recordU0_eq_poolPlus1']}/{rules['recordSamples']} |",
        "",
        "**結論**: u16[0] は **1-indexed cbe chain** 参照。pool 変換表は存在しない。",
        "",
        "## 副装備 — index 一覧（pool==cbe）",
        "",
        "| cbe | 名称 |",
        "|-----|------|",
    ]
    for r in aux_matched[:25]:
        lines.append(f"| {r['cbeIdx']} | {r['name']} |")

    lines.extend(["", "## DATA セグ走査", ""])
    if table_hits:
        lines.append("連続 u16 完全一致候補:")
        lines.append("")
        lines.append("| file_off | match_rate | checked |")
        lines.append("|----------|------------|---------|")
        for h in table_hits[:8]:
            lines.append(f"| 0x{h['file_off']:X} | {h['match_rate']} | {h['checked']} |")
    else:
        lines.append("pool→cbe **別表は未検出**（同一チェーンのため不要）。")

    if seq_hits:
        lines.extend(["", "名称順 cbe 列の部分一致:", ""])
        for h in seq_hits[:6]:
            lines.append(f"- 0x{h['file_off']:X}")

    lines.extend(
        [
            "",
            "## 4240C 候補 index 列",
            "",
        ]
    )
    if mission:
        lines.append("| slot | cbe | 名称 |")
        lines.append("|------|-----|------|")
        for m in mission[:30]:
            if m.get("name"):
                lines.append(f"| {m['slot']} | {m['cbeIdx']} | {m['name']} |")
    else:
        lines.append("ランタイム DATA 列 — file 0x270 は PE ヘッダ域（別セグにロード）。")

    if unmatched:
        lines.extend(["", "## 未突合行", ""])
        for r in unmatched[:10]:
            lines.append(f"- #{r['poolIdx']}: `{r['name']}`")

    lines.extend(
        [
            "",
            "## ST 利用",
            "",
            "- 名称解決: 既存 `cbe_name_table.json` / `PL_AMMO_DATA` で十分",
            "- `pl_cbe_pool_map.js`: identity マップ（冗長だが明示用）",
            "- pool→cbe 変換ロジック **不要**",
            "",
            "## 関連",
            "",
            "- [PL_CBE_EQUIP_CHAIN_RE.md](./PL_CBE_EQUIP_CHAIN_RE.md)",
            "- [PL_CBE_F7C8_RE.md](./PL_CBE_F7C8_RE.md)",
            "",
        ]
    )

    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT_MD.relative_to(ROOT)}")
    print(f"Wrote {OUT_JS.relative_to(ROOT)}")
    print(f"pool identity: {identity_pct}")


if __name__ == "__main__":
    main()

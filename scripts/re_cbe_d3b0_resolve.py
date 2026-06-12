# -*- coding: utf-8 -*-
"""
CBE RE: lcall 0xD3B0 — 弾 index 置換 resolver 解決 + 逆アセンブル。

実行: python scripts/re_cbe_d3b0_resolve.py
出力:
  docs/PL_CBE_D3B0_SUBSTITUTE_RE.md
  scripts/pl_decoded/cbe_d3b0_substitute_re.json
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
OUT_MD = ROOT / "docs" / "PL_CBE_D3B0_SUBSTITUTE_RE.md"
OUT_JSON = ROOT / "scripts" / "pl_decoded" / "cbe_d3b0_substitute_re.json"

LCALL_OFF = 0xD3B0
RESOLVED_SEG = 5
RESOLVED_FILE = 0x048870  # seg5 @ 0x03B4C0 + 0xD3B0

SITES = [
    {
        "file_off": 0x03DFAC,
        "caller_seg": 5,
        "note": "build_ui_ammo_list epilogue @ 0x3DF64 — tag==0 のときのみ",
    },
    {
        "file_off": 0x037F03,
        "caller_seg": 4,
        "note": "ui_refresh fallback @ 0x37EF4",
    },
    {
        "file_off": 0x00DE37,
        "caller_seg": 1,
        "note": "equip_early — weapon+0x83&0x80",
    },
    {
        "file_off": 0x00DF39,
        "caller_seg": 1,
        "note": "equip_early — weapon+0x83&0x80",
    },
]

MARK_TAGS = (
    ("+ 0x28", "cap"),
    ("+ 0x2a", "mag_type"),
    ("+ 0x36", "u27"),
    ("+ 0x22", "rank"),
    ("+ 0xae", "id_ae"),
    ("+ 0x42bc", "tbl_42BC"),
    ("+ 0x2c", "ammo"),
    ("shl", "scale"),
)


def read_ne(d: bytes) -> tuple[list[dict], list[str]]:
    ne = struct.unpack_from("<I", d, 0x3C)[0]
    align = 1 << struct.unpack_from("<H", d, ne + 0x32)[0]
    n = struct.unpack_from("<H", d, ne + 0x1C)[0]
    sa = ne + struct.unpack_from("<H", d, ne + 0x22)[0]
    segs = []
    for i in range(n):
        o = sa + i * 8
        raw, ln, fl, _ = struct.unpack_from("<HHHH", d, o)
        segs.append(
            {
                "num": i + 1,
                "start": raw * align,
                "len": ln if ln else 65536,
                "is_code": (fl & 1) == 0,
            }
        )
    imptab = ne + struct.unpack_from("<H", d, ne + 0x2A)[0]
    modref = ne + struct.unpack_from("<H", d, ne + 0x28)[0]
    modc = struct.unpack_from("<H", d, ne + 0x1E)[0]
    mods = []
    for i in range(modc):
        w = struct.unpack_from("<H", d, modref + 2 * i)[0]
        p = imptab + w
        mods.append(d[p + 1 : p + 1 + d[p]].decode("ascii", errors="replace"))
    return segs, mods


def seg_relocs_at(d: bytes, seg: dict, mods: list[str], rel_off: int) -> list[dict]:
    end = seg["start"] + seg["len"]
    if end + 2 > len(d):
        return []
    nrel = struct.unpack_from("<H", d, end)[0]
    hits = []
    p = end + 2
    for _ in range(nrel):
        if p + 8 > len(d):
            break
        at, rt, off, _, _ = struct.unpack_from("<BBHHH", d, p)
        if rel_off <= off <= rel_off + 4:
            kind = rt & 3
            rec = {"offset_in_seg": off, "kind": kind, "addr_type": at}
            if kind == 2:
                mi = d[p + 4]
                rec["module"] = mods[mi - 1] if 0 < mi <= len(mods) else mi
            hits.append(rec)
        p += 8
    return hits


def find_seg(segs: list[dict], file_off: int) -> dict | None:
    for s in segs:
        if s["start"] <= file_off < s["start"] + s["len"]:
            return s
    return None


def disasm_marked(data: bytes, start: int, size: int) -> list[dict]:
    md = Cs(CS_ARCH_X86, CS_MODE_16)
    out = []
    for ins in md.disasm(data[start : start + size], start):
        op = ins.op_str.lower()
        marks = []
        for key, tag in MARK_TAGS:
            if key == "shl" and ins.mnemonic == "shl":
                marks.append(tag)
            elif key in op:
                marks.append(tag)
        if ins.mnemonic == "sub" and "0x12" in op:
            marks.append("cat18")
        if ins.mnemonic in ("call", "lcall", "enter", "retf", "leave", "jmp"):
            marks.append("flow")
        if marks or ins.mnemonic in ("cmp", "test", "je", "jne"):
            out.append(
                {
                    "addr": f"0x{ins.address:06X}",
                    "mnemonic": ins.mnemonic,
                    "op": ins.op_str,
                    "mark": ",".join(dict.fromkeys(marks)),
                }
            )
    return out


def read_rec(data: bytes, idx: int) -> dict:
    off = TABLE_BASE + idx * 64
    rec = data[off : off + 64]
    return {
        "idx": idx,
        "cat": struct.unpack_from("<H", rec, 2)[0],
        "mag_cap": struct.unpack_from("<H", rec, 0x28)[0],
        "u27": struct.unpack_from("<H", rec, 0x36)[0],
        "mag_type": struct.unpack_from("<H", rec, 0x2A)[0],
        "ammo": [struct.unpack_from("<H", rec, 0x2C + i * 2)[0] for i in range(4)],
    }


def scan_imm16(data: bytes, start: int, size: int, vals: set[int]) -> list[str]:
    hits = []
    for i in range(size - 1):
        w = struct.unpack_from("<H", data, start + i)[0]
        if w in vals:
            hits.append(f"0x{start + i:06X} word {w}")
    return hits


def main() -> None:
    if not CBE_PATH.is_file():
        raise SystemExit(f"CBE not found: {CBE_PATH}")

    data = CBE_PATH.read_bytes()
    segs, mods = read_ne(data)

    candidates = []
    for s in segs:
        if not s["is_code"]:
            continue
        fo = s["start"] + LCALL_OFF
        if fo >= s["start"] + s["len"]:
            continue
        md = Cs(CS_ARCH_X86, CS_MODE_16)
        ins = next(iter(md.disasm(data[fo : fo + 8], fo)), None)
        if ins:
            candidates.append(
                {
                    "seg": s["num"],
                    "file_off": fo,
                    "first": f"{ins.mnemonic} {ins.op_str}",
                }
            )

    site_info = []
    for site in SITES:
        fo = site["file_off"]
        sg = find_seg(segs, fo)
        rel = fo - sg["start"] if sg else -1
        raw = data[fo : fo + 5].hex() if fo + 5 <= len(data) else ""
        off, segw = struct.unpack_from("<HH", data, fo + 1) if data[fo] == 0x9A else (0, 0)
        relocs = seg_relocs_at(data, sg, mods, rel) if sg else []
        site_info.append(
            {
                **site,
                "raw": raw,
                "imm_off": f"0x{off:04X}",
                "imm_seg": f"0x{segw:04X}",
                "relocs": relocs,
            }
        )

    regions = {
        "entry_D3B0": (RESOLVED_FILE, 0x90),
        "alt_D390": (RESOLVED_FILE - 0x20, 0x22),
        "search_489AE": (0x0489AE, 0xF8),
        "search_48C5C": (0x048C5C, 0x90),
        "validator_493E0": (0x0493E0, 0x60),
        "cap_side_48CE8": (0x048CE8, 0x18),
    }
    disasm = {k: disasm_marked(data, s, n) for k, (s, n) in regions.items()}

    imm_hits = scan_imm16(data, RESOLVED_FILE, 0x800, {272, 273, 57})

    payload = {
        "generated": date.today().isoformat(),
        "resolution": {
            "model": "NE seg5 + 0xD3B0; lcall seg word = runtime CS (no reloc, same as 0x9858)",
            "file_off": f"0x{RESOLVED_FILE:06X}",
            "ne_seg": RESOLVED_SEG,
        },
        "call_sites": site_info,
        "seg_candidates_d3b0": candidates,
        "kar98k": read_rec(data, 57),
        "ammo_272": read_rec(data, 272),
        "ammo_273": read_rec(data, 273),
        "disasm": disasm,
        "imm272_in_body": imm_hits,
        "build_ui_ammo_list_gate": {
            "tag_zero_required": True,
            "cap_mismatch_sets_tag_C_or_D": True,
            "correction": "lcall @ 3DFAC runs when cap MATCHED (tag 0), not on mismatch",
        },
    }

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# CBE `lcall 0xD3B0` — 弾 index resolver 内部 RE",
        "",
        f"**生成**: {payload['generated']} — `python scripts/re_cbe_d3b0_resolve.py`",
        "",
        "## 解決",
        "",
        "| 項目 | 値 |",
        "|------|-----|",
        f"| **本体 (file)** | **`0x{RESOLVED_FILE:06X}`** |",
        f"| NE セグ | **seg{RESOLVED_SEG}** @ `0x{segs[RESOLVED_SEG - 1]['start']:06X}` + `0x{LCALL_OFF:04X}` |",
        "| fixup | 各コールサイト **reloc なし** — `0x9858` 同様、**seg word = ロード時 CS** |",
        "",
        "4 サイトは seg word が異なる (`0x256D` / `0xAF2A` / `0xCDC5` / `0xC133`) が、",
        "いずれも **seg5+0xD3B0** に着地する同一関数。",
        "",
        "## 呼び出しサイト",
        "",
        "| file | 呼び出し元 seg | 文脈 |",
        "|------|---------------|------|",
    ]
    for s in site_info:
        lines.append(f"| `0x{s['file_off']:06X}` | seg{s['caller_seg']} | {s['note']} |")

    lines.extend(
        [
            "",
            "### `build_ui_ammo_list` @ 0x3DFAC — **条件修正**",
            "",
            "```asm",
            "3DF64  mov    si, [bp-0x1a]     ; ループ全体の tag",
            "3DF67  cmp    si, 9",
            "3DF90  cmp    es:[0xad34], 5    ; UI モード",
            "3DFA6  or     si, si",
            "3DFA8  jne    3dfb6             ; tag!=0 → lcall スキップ",
            "3DFAC  lcall  0x????, 0xd3b0",
            "3DFB4  mov    si, ax            ; 返値 → 出力 index",
            "```",
            "",
            "| cap cmp @ 0x3DDFA | `[bp-0x1a]` | lcall |",
            "|-------------------|-------------|-------|",
            "| **一致** | **0**（初期値のまま） | **実行** |",
            "| **不一致** | **0xC / 0xD** | **スキップ** |",
            "",
            "> **訂正**: 以前の「cap 不一致 → lcall 置換」は **逆**。",
            "> 273(cap10) vs Kar98k(cap5) の **不一致では lcall は走らない**。",
            "> 272 問題の差替は **別経路**（mission pool / loadout builder / equip @ DE37）が正本候補。",
            "",
            "## 関数 `@ 0x048870` — `ammo_substitute_resolver`（仮称）",
            "",
            "**引数**: far ptr → ランタイム weapon/member 行（`[bp+6]` = ES:DI）",
            "",
            "### 早期 return",
            "",
            "| 条件 | 返値 ax |",
            "|------|---------|",
            "| `[+0x83] & 0x80 == 0` | **0** |",
            "| bit 0x80 あり、`[+0x1a] < 4` | **0x1A (26)** |",
            "| bit 0x80 あり、`[+0x1a] >= 4` | **0x1B (27)** |",
            "",
            "equip_early @ DE37/DF39 は **tag ガード無し**で常に呼ぶ → 26/27 は slot/type id の可能性。",
            "続く `lcall 0x6F0E` が cbe index へ変換。",
            "",
            "### 本体 @ 0x048898 — テーブルスキャン",
            "",
            "- 512B stride (`+0x200`) で最大 0x40 件 walk",
            "- `lcall 0xDF20` で行検証",
            "- スコア `di` vs `[+0xBE]` 加算で分岐",
            "- 返値: **`es:[tbl+0x42BC]`** または **`es:[si+0x1E]`** から index 読出",
            "",
            "### 副次関数",
            "",
            "| file | 役割 |",
            "|------|------|",
            "| `@ 0x048960` | `[bx+0xAE]` vs weapon id — 一致レコード ptr を ax で返す |",
            "| `@ 0x0489AE` | weapon の u16 候補列 walk — **`[+0x2a]` mag_type** + **`call 0x493E0`** |",
            "| `@ 0x048C5C` | 同上だが **`cmp [bx+0x2a], weapon_mag_type`** 明示 |",
            "| `@ 0x0493E0` | 行フラグ validator（`[+0x83]`, `[+0x26]`, `[+0x1a]`） |",
            "| `@ 0x048CE8` | `[weapon+0x28]` cap → 別テーブル bit セット（index 返却ではない） |",
            "",
            "### alt entry `@ 0x048850` (seg+0xD390)",
            "",
            "```asm",
            "48858  mov    bx, es:[di+0x40]",
            "4885C  shl    bx, 6          ; CBE 64B stride",
            "48864  mov    bx, es:[bx+0x38]",
            "48869  mov    ax, bx         ; index 返却",
            "```",
            "",
            "D3B0 本体とは別入口。`jmp 0x48869` で合流。",
            "",
            "## 静的 CBE データ",
            "",
            f"| | Kar98k (57) | 273 | 272 |",
            f"|--|-------------|-----|-----|",
            f"| cap | **{payload['kar98k']['mag_cap']}** | **{payload['ammo_273']['mag_cap']}** | **{payload['ammo_272']['mag_cap']}** |",
            f"| u27 | **{payload['kar98k']['u27']}** | **{payload['ammo_273']['u27']}** | **{payload['ammo_272']['u27']}** |",
            f"| mag_type | **{payload['kar98k']['mag_type']}** | **{payload['ammo_273']['mag_type']}** | **{payload['ammo_272']['mag_type']}** |",
            f"| ammo_indices | {payload['kar98k']['ammo']} | — | indices 外 |",
            "",
        ]
    )

    if imm_hits:
        lines.extend(["## 即値 272/273", ""])
        for h in imm_hits:
            lines.append(f"- `{h}`")
        lines.append("")
    else:
        lines.extend(
            [
                "## 即値 272/273",
                "",
                "resolver 本体 (`0x048870`..`+0x800`) に **272/273 即値なし**。",
                "ランタイムテーブル (`+0x42BC`, `shl 6/9` 先) 参照型。",
                "",
            ]
        )

    for key, title in (
        ("entry_D3B0", "`@ 0x048870` 入口"),
        ("search_48C5C", "`@ 0x048C5C` mag_type 走査"),
        ("validator_493E0", "`@ 0x0493E0` validator"),
    ):
        rows = disasm[key]
        if rows:
            lines.extend([f"## {title}", "", "```asm"])
            for row in rows:
                m = f" ; {row['mark']}" if row["mark"] else ""
                lines.append(f"{row['addr'][2:]}  {row['mnemonic']:6s} {row['op']}{m}")
            lines.append("```")
            lines.append("")

    lines.extend(
        [
            "## ST 再現指針",
            "",
            "1. **`applyMagCapSubstitute`** — データ側エミュレ（u27 クラスタ + cap）。CBE 1:1 未確定のまま有効。",
            "2. **正本 resolver** — mag_type (+0x2a) + rank (+0x22) + 493E0 フラグ + 42BC テーブル。",
            "3. **build_ui_ammo_list の lcall** — cap 一致時の canonical index 確定用。**不一致差替ではない**。",
            "",
            "## 未完了",
            "",
            "1. `lcall 0x6F0E` / `0x6F00` — ax=26/27 → cbe index 変換",
            "2. `+0x42BC` / `+0xAE` ランタイムテーブル静的抽出",
            "3. 273→272 の **実経路** — loadout @ 0x3D42A / mission pool / equip DE37",
            "",
            "## 関連",
            "",
            "- [PL_CBE_CAP_SUBSTITUTE_RE.md](./PL_CBE_CAP_SUBSTITUTE_RE.md)",
            "- [PL_CBE_LOADOUT_CANDIDATE_RE.md](./PL_CBE_LOADOUT_CANDIDATE_RE.md)",
            "- [PL_CBE_AMMO_FILTER_RE.md](./PL_CBE_AMMO_FILTER_RE.md)",
            "",
        ]
    )

    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT_MD.relative_to(ROOT)}")
    print(f"resolved: 0x{RESOLVED_FILE:06X}, imm272: {len(imm_hits)}")


if __name__ == "__main__":
    main()

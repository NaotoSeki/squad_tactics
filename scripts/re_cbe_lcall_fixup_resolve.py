# -*- coding: utf-8 -*-
"""
CBE RE: lcall 0,0x9858 / 0,0x9698 — fixup 解決 + マッチ関数逆アセンブル。

結論:
  - seg2 コールサイトに reloc 無し（seg word=0）
  - ターゲット = seg1 内オフセット（ロード時 CS パッチ想定）
  - 0x9698 → ammo_ui_match_main @ 0xA6EA（副入口 +0x6E @ 0xA758）
  - 0x9858 → ammo_ui_match_helper @ 0xA908（副入口 +0x10 @ 0xA918）

実行: python scripts/re_cbe_lcall_fixup_resolve.py
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
OUT_MD = ROOT / "docs" / "PL_CBE_AMMO_UI_MATCH_RE.md"
OUT_JSON = ROOT / "scripts" / "pl_decoded" / "cbe_ammo_ui_match_re.json"

LCALL_SITES = [
    {
        "id": "match_list_entry",
        "file_off": 0x1808D,
        "offset_imm": 0x9858,
        "caller": "ammo_ui_find_slot_by_list @ 0x1804E",
        "resolved_entry": 0xA908,
        "resolved_mid": 0xA918,
        "name": "ammo_ui_match_helper",
    },
    {
        "id": "match_column_index",
        "file_off": 0x180D7,
        "offset_imm": 0x9698,
        "caller": "ammo_ui_find_slot_by_column @ 0x180B4",
        "resolved_entry": 0xA6EA,
        "resolved_mid": 0xA758,
        "name": "ammo_ui_match_main",
    },
]

MAG_TYPE_CMP = 0x18BF3


def read_ne(d: bytes) -> tuple[list[dict], list[str]]:
    ne = struct.unpack_from("<I", d, 0x3C)[0]
    align = 1 << struct.unpack_from("<H", d, ne + 0x32)[0]
    n = struct.unpack_from("<H", d, ne + 0x1C)[0]
    sa = ne + struct.unpack_from("<H", d, ne + 0x22)[0]
    segs = []
    for i in range(n):
        o = sa + i * 8
        raw, ln, fl, _ = struct.unpack_from("<HHHH", d, o)
        segs.append({"num": i + 1, "start": raw * align, "len": ln if ln else 65536})
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
    nrel = struct.unpack_from("<H", d, end)[0]
    hits = []
    p = end + 2
    for _ in range(nrel):
        at, rt, off, w3, w4 = struct.unpack_from("<BBHHH", d, p)
        if rel_off <= off <= rel_off + 4:
            kind = rt & 3
            rec = {"offset_in_seg": off, "kind": kind, "addr_type": at}
            if kind == 2:
                mi = d[p + 4]
                rec["module"] = mods[mi - 1] if 0 < mi <= len(mods) else mi
            hits.append(rec)
        p += 8
    return hits


def disasm(data: bytes, start: int, size: int) -> list[dict]:
    md = Cs(CS_ARCH_X86, CS_MODE_16)
    rows = []
    for ins in md.disasm(data[start : start + size], start):
        op = ins.op_str.lower()
        mark = ""
        for key, tag in (
            ("+ 0x2a", "mag_type"),
            ("+ 0x36", "u27"),
            ("+ 0x28", "cap"),
            ("+ 0x02", "category"),
            ("+ 0xd2", "list@+D2"),
            ("+ 0x8e", "ctx+8E"),
            ("+ 0x82", "ctx+82"),
        ):
            if key in op:
                mark = tag
                break
        if ins.mnemonic == "shl" and ", 6" in op:
            mark = "shl*64"
        if ins.mnemonic in ("call", "lcall", "retf", "enter", "leave"):
            mark = (mark + " CALL").strip() if mark else "CALL"
        rows.append({"addr": f"0x{ins.address:06X}", "mnemonic": ins.mnemonic, "op": ins.op_str, "mark": mark})
    return rows


def main() -> None:
    if not CBE_PATH.is_file():
        raise SystemExit(f"CBE not found: {CBE_PATH}")

    d = CBE_PATH.read_bytes()
    segs, mods = read_ne(d)
    seg1 = segs[0]
    seg2 = segs[1]

    site_results = []
    for site in LCALL_SITES:
        fo = site["file_off"]
        rel_off = fo - seg2["start"]
        site_results.append(
            {
                **site,
                "seg2_rel_off": rel_off,
                "raw_bytes": d[fo : fo + 5].hex(),
                "fixups_at_callsite": seg_relocs_at(d, seg2, mods, rel_off),
                "seg1_entry_file": site["resolved_entry"],
                "seg1_mid_file": site["resolved_mid"],
                "disasm_entry": disasm(d, site["resolved_entry"], 0x50),
                "disasm_main": disasm(d, site["resolved_entry"], 0x220)
                if site["name"] == "ammo_ui_match_main"
                else None,
            }
        )

    payload = {
        "generated": date.today().isoformat(),
        "fixup_status": "NO reloc at seg2 callsite; seg word=0 → runtime CS=seg1 assumed",
        "sites": site_results,
        "mag_type_gate": {"file": "0x1805A", "note": "w21==0 before lcall; not repeated inside match fn"},
        "mag_type_loadout": {"file": "0x18BF3", "note": "separate loadout validate path"},
    }

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# CBE 装填 UI マッチ関数 — `lcall 0x9858` / `0x9698`",
        "",
        f"**生成**: {payload['generated']} — `python scripts/re_cbe_lcall_fixup_resolve.py`",
        "",
        "## fixup 結論",
        "",
        "| 項目 | 結果 |",
        "|------|------|",
        "| seg2 @ 0x980D / 0x9857 の reloc | **なし** |",
        "| lcall 生バイト | `9A 58 98 00 00` / `9A 98 96 00 00` |",
        "| 推定 | ロード時 **CS=seg1** パッチ。オフセットは seg1 内 byte |",
        "",
        "## 解決した関数",
        "",
        "| lcall off | 呼び出し元 | 関数 (file) | 副入口 (lcall 着地) |",
        "|-----------|-----------|-------------|---------------------|",
        "| `0x9698` | `0x180B4` | **`ammo_ui_match_main` @ `0xA6EA`** | `0xA758` (+0x6E) |",
        "| `0x9858` | `0x1804E` | **`ammo_ui_match_helper` @ `0xA908`** | `0xA918` (+0x10) |",
        "",
        "> 副入口着地は手書き asm 慣行。同一関数内で BP 前提が合う。",
        "",
        "## `ammo_ui_match_main` @ 0xA6EA — 核心ロジック",
        "",
        "**mag_type / u27 / cap の cmp は見つかっていない。** UI 矩形・エントリ種別。",
        "",
        "```c",
        "// retf 8 — args: weapon_row, es, ctx",
        "if (ctx[+0x83] & 0x80) { ... fast path via +0x21D4 table ... }",
        "",
        "si = weapon_row + 0xD2;   // 8B リスト（+0xCE ではない）",
        "loop entries:",
        "  if (entry[0]==0 || entry[0]==3 || entry[4]==-1) skip;",
        "  if (entry[0]==1 || entry[0]==0x14)   // 0x14=20=cat?",
        "    id = ammo_ui_match_helper(ctx, weapon);  // call 0xA908",
        "  else",
        "    id = ammo_ui_match_helper_alt(...);      // call 0xA934",
        "  // 選択 id → weapon[+0x21C2] テーブル → 8B 行",
        "  // 座標比較: +0x219E, +0x21A0, +0x217C — UI レイアウト",
        "  return ax!=0 on success;",
        "```",
        "",
        "### エントリ種別 cmp（確定）",
        "",
        "```asm",
        "0xA77D  cmp  es:[si], 0",
        "0xA783  cmp  es:[si], 3",
        "0xA799  cmp  es:[si], 1",
        "0xA79F  cmp  es:[si], 0x14    ; 20 dec",
        "```",
        "",
        "## `ammo_ui_match_helper` @ 0xA908",
        "",
        "```asm",
        "0xA90F  mov  bx, es:[di+0x8E]",
        "0xA914  mov  cx, es:[di+0x82]",
        "0xA91E  test ah, 1",
        "0xA923  xor  cx, 1",
        "0xA92A  add  bx, 4",
        "0xA92D  mov  ax, bx",
        "0xA931  retf 8",
        "```",
        "",
        "→ ctx フラグ (+0x8E/+0x82) から **インデックス算出**。弾種 cap ではない。",
        "",
        "## パイプライン全体（更新）",
        "",
        "```",
        "0x1805A  w21==0? → skip mag gate",
        "0x1804E  walk weapon[+0xCE]+0x40 list",
        "  └─ lcall ammo_ui_match_*  ← 今回",
        "       ├─ entry type 1/0x14 vs other",
        "       ├─ helper 0xA908 / 0xA934",
        "       └─ UI rect compare (+0x219E…)",
        "0x18BF3  別経路: loadout 確定時 mag_type 完全一致",
        "```",
        "",
        "**cap / 272 問題**: マッチ関数内に cap cmp 無し。",
        "候補: (a) リスト構築 0xF7C8 段階 (b) entry type 0x14 分岐 (c) 別テーブル walk",
        "",
        "## 次（順番 2）: `0xF7C8`",
        "",
        "文字列 ID 0x4C4/4C6/4C7 → 8B link_index。272 の注入点。",
        "",
        "## 関連",
        "",
        "- [PL_CBE_AMMO_UI_LOADLIST_RE.md](./PL_CBE_AMMO_UI_LOADLIST_RE.md)",
        "- [PL_CBE_AMMO_FILTER_RE.md](./PL_CBE_AMMO_FILTER_RE.md)",
        "",
    ]

    lines.append("## 逆アセンブル — `ammo_ui_match_main`")
    lines.append("")
    lines.append("```asm")
    for row in site_results[1]["disasm_main"] or []:
        if row["addr"] >= "0x00A770":
            m = f" ; {row['mark']}" if row["mark"] else ""
            lines.append(f"{row['addr']}  {row['mnemonic']:6s} {row['op']}{m}")
        if row["addr"] >= "0x00A900":
            break
    lines.append("```")
    lines.append("")

    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT_MD.relative_to(ROOT)}")
    print(f"Wrote {OUT_JSON.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

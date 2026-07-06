# -*- coding: utf-8 -*-
"""
CBE RE: @ 0x422B8 — 小隊装備候補 validate（4240C から call）

実行: python scripts/re_cbe_validate_422b8.py
出力:
  docs/PL_CBE_VALIDATE_422B8_RE.md
  scripts/pl_decoded/cbe_validate_422b8_re.json
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

try:
    from capstone import CS_ARCH_X86, CS_MODE_16, Cs
except ImportError as e:
    raise SystemExit("pip install capstone") from e

ROOT = Path(__file__).resolve().parents[1]
CBE = Path(r"D:\PL\CBE.EXE")
OUT_MD = ROOT / "docs" / "PL_CBE_VALIDATE_422B8_RE.md"
OUT_JSON = ROOT / "scripts" / "pl_decoded" / "cbe_validate_422b8_re.json"

FUNCS = [
    (0x422B8, "validate_422B8", 0xB8),
    (0x41914, "slot_col_flags", 0x30),
    (0x41942, "weapon_col_type", 0x30),
    (0x41970, "u26_aux_check", 0x70),
    (0x41764, "weapon_u26_req", 0x50),
    (0x41BD8, "cross_compat_table", 0x120),
]


def disasm(data: bytes, start: int, size: int) -> list[dict]:
    md = Cs(CS_ARCH_X86, CS_MODE_16)
    tags = (
        ("+ 0x8a", "+0x8A equipOff"),
        ("+ 0x8e", "+0x8E col"),
        ("+ 0x81", "+0x81 flags"),
        ("+ 0x34", "+0x34 u26"),
        ("+ 0x26", "+0x26 cat?"),
        ("+ 0x28", "+0x28 slot"),
        ("+ 0x3e", "+0x3E itemIdx"),
        ("+ 0xa4", "+0xA4 mask"),
        ("+ 0xcca", "+0xCCA slotBit"),
        ("+ 0x24ca", "compatTbl"),
    )
    out = []
    for ins in md.disasm(data[start : start + size], start):
        op = ins.op_str.lower()
        mark = ""
        for k, t in tags:
            if k in op:
                mark = f" ; {t}"
                break
        if ins.mnemonic in ("call", "lcall", "ret", "retf", "cmp", "test", "je", "jne") and not mark:
            mark = " ; *"
        out.append({"addr": f"0x{ins.address:06X}", "m": ins.mnemonic, "op": ins.op_str, "mark": mark})
    return out


def main() -> None:
    if not CBE.is_file():
        raise SystemExit(f"CBE not found: {CBE}")

    data = CBE.read_bytes()
    blocks = {name: disasm(data, off, sz) for off, name, sz in FUNCS}

    pseudo = """\
// retf — validate_422B8(equip_ui *ui, member *m, ui_ds, member_es)
// 4240C: push ui; push member; call 422B8 → ax!=0 で候補採用
bool validate_422B8(ui, member) {
  if (ui->equipOff (+0x8A) == member->equipOff (+0x8A))
    return true;                          // @ 0x422CC 同一スロット

  if (member->flags (+0x81) & 0x18)       // @ 0x422DC
    return false;

  if (slot_col_flags(ui) || slot_col_flags(ui_ds))  // 41914 ×2
    return false;

  req = lcall_compat(ui->equipOff, member->equipOff);  // 0xA452
  u26 = weapon_u26_req(member_weapon);    // 41764
  if (u26 < req) return false;            // @ 0x42328

  col_ui   = weapon_col_type(ui);         // 41942
  col_mem  = weapon_col_type(member);     // 41942
  return cross_compat_table(col_mem, col_ui, member->equipOff);  // 41BD8
}

// 41970 — u26 副装備一致（MG 系）
bool u26_aux_check(weapon_rec *w, candidate_type ax) {
  if (w[+0x26] >= 5) return false;        // カテゴリ閾値（LMG未満）
  if (slot_col_flags(w)) return false;
  if (w->u26 (+0x34) == ax) return true;  // **u26 リンク一致**
  if (w->flags (+0x81) & 0x18) return false;
  ...
}
"""

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(
        json.dumps({"generated": date.today().isoformat(), "blocks": blocks}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    lines = [
        "# CBE `@ 0x422B8` — 装備候補 validate",
        "",
        f"**生成**: {date.today().isoformat()} — `python scripts/re_cbe_validate_422b8.py`",
        "",
        "## 呼び出し元",
        "",
        "`@ 0x4240C` 小隊走査 — 各候補で `call 0x422B8`。",
        "`ax != 0` なら `member+0x3E`（cbe index）を出力列へ。",
        "",
        "## 疑似コード",
        "",
        "```c",
        pseudo.rstrip(),
        "```",
        "",
        "## ST 実装ルール（422B8 から抽出）",
        "",
        "| 列 kind | 422B8 / 41970 根拠 | ST ルール |",
        "|---------|-------------------|-----------|",
        "| `ammo_box` col1 | u26 @ +0x34 一致 | `PL_COMPOSITE_U26[weapon].idx` |",
        "| `tripod` col2 | 41BD8 交差表 + 非 u26 | `TRIPOD_CODE_FOR_MAIN` / cbe map |",
        "| `optic` col3 | u26 観測鏡行 | composite u26 kind=optic |",
        "| 主弾 col0 | cat18 パイプライン | `finalizeWeaponAmmoIndices` |",
        "",
        "## `@ 0x422B8` 逆アセンブル",
        "",
        "```asm",
    ]
    for row in blocks["validate_422B8"]:
        if row["mark"]:
            lines.append(f"{row['addr']}  {row['m']:6s} {row['op']}{row['mark']}")
    lines.extend(["```", "", "## `@ 0x41970` u26 副装備チェック", "", "```asm"])
    for row in blocks["u26_aux_check"]:
        if row["mark"]:
            lines.append(f"{row['addr']}  {row['m']:6s} {row['op']}{row['mark']}")
    lines.extend(
        [
            "```",
            "",
            "## `@ 0x41BD8` — 交差互換（三脚等）",
            "",
            "固定テーブル `@ 0x4CA` + `es:[rec+0x24CA]` ビットマスク — 全件 ST 移植は",
            "`pl_cbe_aux_compat.js`（u26 + tripod cbe map）で近似。",
            "",
            "## 関連",
            "",
            "- [PL_CBE_EQUIP_CHAIN_RE.md](./PL_CBE_EQUIP_CHAIN_RE.md)",
            "- [PL_CBE_POOL_CBE_RE.md](./PL_CBE_POOL_CBE_RE.md)",
            "",
        ]
    )
    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT_MD.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

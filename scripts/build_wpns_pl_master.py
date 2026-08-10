# -*- coding: utf-8 -*-
"""
CBE 名チェーン（484 行: 装備名・弾名を含む）+ cbe_weapon_ammo_explicit.json から
WPNS['pl_*'] とランダム装備用コード配列を生成する。
弾薬専用行・壊れ行を除いた**火器エントリ数**は 300 台台（実行時ログ entries 参照）で、
「484 行まるごと武器」ではない。

- plCategory: 人間可読の部門。statTemplate は**数値雛形キー**（m1, smg_45, smg_9mm 等。ミリタリー俗称ではない）。

出力: data/wpns_pl_master.js, data/*_table.csv
再生成: python scripts/build_wpns_pl_master.py
"""
from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from pl_ammo_cbe_filters import (  # noqa: E402
    effective_ammo_for_weapon,
    load_category_map,
    load_json_from_js,
    load_stats_by_cbe,
)
PL_JSON = ROOT / "scripts" / "pl_decoded" / "pl_item_compatibility.json"
EXPLICIT = ROOT / "scripts" / "pl_decoded" / "cbe_weapon_ammo_explicit.json"
OUT = ROOT / "data" / "wpns_pl_master.js"
OUT_AMMO = ROOT / "data" / "pl_ammo_data.js"
OUT_LOADOUT = ROOT / "data" / "pl_loadout_templates.js"
CSV_CBE_CHAIN = ROOT / "data" / "cbe_name_chain_table.csv"
CSV_WPNS_TABLE = ROOT / "data" / "wpns_pl_master_table.csv"
STATS_JSON = ROOT / "data" / "wpns_pl_stats_decoded.json"
AMMO_COMPAT_JSON = ROOT / "data" / "ammo_compat_full.json"
WEAPON_AMMO_MAP_JSON = ROOT / "data" / "weapon_ammo_map.json"
WEAPON_AMMO_OVERRIDES_JSON = ROOT / "data" / "weapon_ammo_overrides.json"
LOADOUT_TEMPLATES_JSON = ROOT / "data" / "loadout_templates.json"
MAG_SHAPE_JS = ROOT / "data" / "pl_cbe_mag_shape.js"

# --- テンプレ（data.js WPNS から。ATTR はランタイム参照）---
T = {
    "m1": dict(
        name="_", rng=7, acc=85, acc_drop=3, dmg=76, cap=8, mag=6, ap=2, rld=1, wgt=4,
        type="bullet", burst=2, overRangePenalty=10, desc="小銃（PLマスタ雛形）。", weight=9.5,
    ),
    "thompson": dict(
        name="_", rng=5, acc=60, acc_drop=4, dmg=41, cap=30, mag=4, ap=2, rld=1, wgt=5,
        type="bullet", burst=3, modes=[3, 7], overRangePenalty=22, desc="SMG 雛形。", weight=10,
    ),
    "smg_45": dict(
        name="_", rng=5, acc=60, acc_drop=4, dmg=41, cap=30, mag=4, ap=2, rld=1, wgt=5,
        type="bullet", burst=3, modes=[3, 7], overRangePenalty=22, desc="SMG 雛形（.45）", weight=10,
    ),
    "smg_9mm": dict(
        name="_", rng=5, acc=60, acc_drop=4, dmg=41, cap=30, mag=4, ap=2, rld=1, wgt=5,
        type="bullet", burst=3, modes=[3, 7], overRangePenalty=22, desc="SMG 雛形（9mm）", weight=10,
    ),
    "k98_scope": dict(
        name="_", rng=9, acc=95, acc_drop=3, dmg=72, cap=5, mag=5, ap=2, rld=2, wgt=5,
        type="bullet", burst=1, overRangePenalty=10, desc="狙撃 雛形。", weight=9,
    ),
    "bar": dict(
        name="_", rng=7, acc=55, acc_drop=3, dmg=45, cap=20, mag=5, ap=2, rld=2, wgt=9,
        type="bullet", burst=2, modes=[2, 5], overRangePenalty=10, desc="BAR 雛形。", weight=19,
    ),
    "m1911": dict(
        name="_", rng=3, acc=70, acc_drop=10, dmg=30, cap=7, mag=3, ap=2, rld=1, wgt=1,
        type="bullet", burst=1, overRangePenalty=25, desc="拳銃 雛形。", weight=2.4,
    ),
    "luger": dict(
        name="_", rng=3, acc=75, acc_drop=10, dmg=25, cap=8, mag=2, ap=2, rld=1, wgt=1,
        type="bullet", burst=1, overRangePenalty=25, desc="9mm 雛形。", weight=1.9,
    ),
    "mg42": dict(
        name="_", rng=8, acc=45, acc_drop=4, dmg=25, cap=50, mag=99, ap=2, rld=3, wgt=12,
        type="bullet", burst=15, overRangePenalty=15, desc="MG 雛形。", weight=25,
    ),
    "nade": dict(
        name="_", rng=4, acc=60, dmg=80, cap=1, mag=2, ap=2, rld=0, wgt=1,
        type="shell", area=True, desc="手榴弾/発煙 雛形。", weight=1.3,
    ),
    "m8_rocket": dict(
        name="_", rng=12, acc=50, dmg=45, penetration=55, cap=3, current=3, mag=3, ap=3, rld=0, wgt=0,
        type="rocket", area=True, areaHexes=5, desc="擲弾/ロケット 雛形。", weight=4,
    ),
    "mortarish": dict(
        name="_", type="shell", rng=8, minRng=1, dmg=120, ap=3, acc=50, cap=1, burst=1, area=True, indirect=True,
        desc="曲射/迫撃 雛形。", weight=15,
    ),
    "flame": dict(
        name="_", rng=3, acc=55, acc_drop=5, dmg=55, cap=3, mag=1, ap=2, rld=0, wgt=8,
        type="shell", area=True, areaHexes=2, desc="噴火 雛形。", weight=18,
    ),
    "melee": dict(
        name="_", rng=1, acc=90, dmg=35, cap=0, mag=0, ap=1, rld=0, wgt=0, type="melee", burst=1, desc="白兵。", weight=1,
    ),
    "at_rifle": dict(
        name="_", rng=5, acc=60, acc_drop=3, dmg=90, cap=4, mag=2, ap=2, rld=2, wgt=6,
        type="bullet", burst=1, penetration=45, overRangePenalty=8, desc="対戦車/AT 歩兵 雛形。", weight=12,
    ),
    "part_gear": dict(
        name="_", type="part", partType="other", desc="装備/部件（主兵装不適）", weight=1,
    ),
    "shell_27": dict(
        name="_", rng=8, acc=50, acc_drop=2, dmg=100, cap=1, mag=1, ap=2, rld=1, wgt=2,
        type="shell", area=True, areaHexes=3, desc="砲/27mm 雛形。", weight=3,
    ),
}

# 厳密 / 仮: 7.92 帯, 9mm 帯, 30-06, 30 カービン, 45, 7.63 等
AMMO_792 = [272, 273, 274, 275, 276, 277, 288, 289, 290, 295, 296, 389]  # mg42 block
AMMO_303BR = [353, 354, 355, 356, 357, 358]
AMMO_9 = [258, 265, 278, 279, 280, 281, 282, 283, 284, 285, 286, 320, 321, 322, 323, 378, 379, 384, 388, 390]  # 9mm Para（355=Enfield専用は AMMO_303BR）
AMMO_3006 = [229, 230, 231, 238, 239, 240]  # 弾行（クリップ+ボール）
AMMO_30CBN = [232, 233]
AMMO_45 = [225, 226, 234, 235, 236, 237]
AMMO_45_PISTOL = [225, 226]
AMMO_763 = [255, 256, 257]
AMMO_27 = [266, 267]  # 27mm
AMMO_32 = [258, 259, 260, 261, 262, 263, 264, 265]  # 近傍（仮）


# 弾行のみ（主兵装化しない）— 厳格なプレフィックス/パターン
_RE_PURE_AMMO = re.compile(
    r"^(?:(?:45|32|380)ACP|3006|30Cbn|7\.63|7\.92|7\.5-|7\.65-|6\.5-|7\.35-"
    r"|7\.35|8Brd|7\.85|303Br|7\.62N|7\.62T|7\.62-1|7\.62-5|7\.62-10|7\.62-47|7\.62-250|12\.7-"
    r"|9Pb-|8M86|8M92|8Aut|8Mrzk|8Brd-"
    r"|20LS|20SS|FLeut|Wkor|Wgrp|SprGr\.?Z|GPz|GSpr|StiGr|RPzB4322|RPzB4992"
    r"|Pk16|Pt13|Pt34|Dt15|Gt34|Pa318|20LS|Wgrp"
    r"|303Br|55Boys|9BLg|9Largo|10\.35-1|9Gli-7|380Mk2-1|355Web-1|6\.5-20|6\.5-50"
    r"|455Web-1|7\.5-5|7\.5-25|very-1)$",
    re.I,
)
_RE_AMMO_TIGHT = re.compile(
    r"^(?:(?:9|6|7)Pb-|50M2-|7\.92[fmk]?-|50M2)",
    re.I,
)


def is_garbage_chain_name(name: str) -> bool:
    if not name or len(name.strip()) < 2:
        return True
    if "\x00" in name or "\ufffd" in name or "\x04" in name:
        return True
    if any(ord(c) < 32 and c not in "\t\n\r" for c in name):
        return True
    # プライベート利用面・制御系のみ（名チェーン末の壊れ行）
    if not re.search(
        r"[A-Za-z0-9\u3040-\u30ff\u4e00-\u9fff]",
        name,
    ):
        return True
    return False


def is_pure_ammo_name(name: str) -> bool:
    n = (name or "").strip()
    if not n:
        return True
    if _RE_PURE_AMMO.search(n) or _RE_AMMO_TIGHT.search(n):
        return True
    if re.match(r"^[\d.]+[A-Za-z]*-", n) and "mm" not in n and "Mle" not in n and "Mk" not in n and "Boys" not in n:
        # 数字始まりの薬莢名（"41 CONON" 等を残す）
        if n[0].isdigit() and "-" in n and "CONON" not in n:
            return True
    return False


# メイン抽選から除外: 三脚/弾薬箱/補助装備/通信
_RE_MAIN_SKIP = re.compile(
    r"(?i)tripod|ammbox|ammobox|binocular|binocolo|fernglas|ferng|scr536|"
    r"med bag|map case|film|jumelle|sani|mkt35|feldfu|sani|note\b|laf34|laf42|obr\.|"
    r"^oss$",
)


def is_main_skip_name(name: str) -> bool:
    return bool(_RE_MAIN_SKIP.search(name or ""))


def is_vehicle_or_towed_gun_name(name: str) -> bool:
    """車載砲・対戦車砲・榴弾砲・高射砲など（歩兵主装備プールから除外）。"""
    n = (name or "").strip()
    if not n:
        return True
    if re.search(r"\bKwK\s*\d|\bKwK\d", n, re.I):
        return True
    if re.search(r"\bPaK\s*\d|\bPaK\d", n, re.I):
        return True
    if re.search(r"\bStK\s*\d|\bStH\s*\d|\bGrW\s*\d", n, re.I):
        return True
    if re.search(r"\bFla?K\s*\d", n, re.I):
        return True
    if re.search(
        r"\d+\s*mm\s*(KwK|PaK|Gun|How|Cann|Obice|GrW)|\d+inGun|\d+/\d+\s*Cann|\d+mm\s+Gun|\d+mm\s+How|\bObice\b|\bCann\.\b",
        n,
        re.I,
    ):
        return True
    return False


def is_pistolish(name: str) -> bool:
    n = (name or "").upper()
    if "PISTOL" in n or re.search(
        r"(?:(?<![A-Z/])P38(?![0-9/])|P08|1911|1917 S&W|1917 COLT|C/96|LUGER|"
        r"WALTHER|MAUSER|ASTRA|BODEO|GLISENTI|BERETTA|UNIQUE|TT33|HSC|PPK|"
        r"WEBLEY|S\.W No2|NO2 MK|BAYARD|ASTRA|VIS WZ|CZ VZ|BHP|HSc|GP35)",
        n,
    ):
        return True
    if n.startswith("M1911A1") or n == "M1911A1":
        return True
    if n in ("PP", "PPK", "M1934", "BEHOLLA", "M38H", "MAS38", "GLOSSENTI"):
        return True
    if re.search(r"^\s*(PP|PPK|P38)\s*$", name, re.I):
        return True
    return False


def is_meleeish(name: str) -> bool:
    n = (name or "").upper()
    if "Knf" in n or "TKnf" in n or "KNIFE" in n or n == "MESSER" or "BAYT" in n or n.endswith("S84/92"):
        return True
    if re.search(r"(^|\b)(BAYT|Byt|MESSER|KNF)(\b|$)", n, re.I):
        return True
    return False


def is_smgish(name: str) -> bool:
    """|3\\b| のように末尾単独の数字にマッチするパターンは Kar43 / No1Mk3 等を SMG 誤判定する。"""
    s = (name or "").upper().replace(" ", "")
    s2 = (name or "").upper().replace(" ", "").replace("-", "")
    if "SMG" in (name or "") or "STEN" in (name or "").upper():
        return True
    if re.search(
        r"\bMP(28|35|34|40|38|41|18|19|20|12|8|1)\b|MP3008|MP34|MP35|MP36|"
        r"PPSh|PPD|PPS(43|H|40)|Lanchester",
        s2,
    ) or re.search(
        r"THOMPSON|UMP|Sten|PPSh|MAB|MAB\w|OTTER|EMP(?!L)",
        s,
    ):
        return True
    if re.search(r"^\s*MAC24\s*$", (name or ""), re.I) or re.search(
        r"^\s*Lewis\s*$",
        (name or ""),
        re.I,
    ):
        return True
    return False


def is_mgish(name: str) -> bool:
    n = (name or "").upper()
    return re.search(
        r"(LMG|MMG|HMG|\/15|/15|/18|MG\w|BREN|Lewis|VICKERS|DP\b|DShK|PM1910|DShK|MAC24)",
        n,
    ) or n.startswith("M1917A1") or n.startswith("M1919A") or n.startswith("M2 HB")


def is_rifle_sniperish(name: str) -> bool:
    n = (name or "")
    u = n.upper()
    if "Cbn" in n or re.search(
        r"(Gew|Kar98|Gew98|Gew29|Gew33|Gew41|Gew43|StG|MP44|Zf | \(T\)|"
        r"RIFLE|KAR\w|K98|NO4|ENFIELD|RIF\.)",
        u,
    ):
        return True
    if n.startswith("M") and re.search(
        r"M1\d0|3A4|1941|1903A",
        n,
    ) and "SMG" not in n and "Amm" not in n and "Ammobox" not in n:
        return True
    return False


def is_atish(name: str) -> bool:
    u = (name or "").upper()
    return bool(
        re.search(
            r"(S-18/100|PIAT|BOYS|RPZ|PZB|PZ\w|BAZOOKA|RL\b|BAZOOKA|"
            r"Wz\.?35|50M2)",
            u,
        )
        or "GRENADE" in u
    )


def is_rocketish(name: str) -> bool:
    u = (name or "").upper()
    if " RL" in u or u.endswith(" RL") or re.search(
        r"\bM1\s*RL|\bM9\s*RL|BAZOO|FAUST",
        u,
    ):
        return True
    return u.startswith("M1 RL") or u.startswith("M1A1 RL") or u.startswith("M9 RL")


def is_flamish(name: str) -> bool:
    return "Fl" in (name or "") and re.search(
        r"(E1R1|FM\w|M1A1|Fl|M2A1)",
        name or "",
        re.I,
    )


def is_27ish(name: str) -> bool:
    return "27mm" in (name or "")


def is_mortarish(name: str) -> bool:
    n = name or ""
    return "M2 Tube" in n or "MORTAR" in n.upper() or "8 Mk1" in n


def is_classify_support_gear(name: str) -> bool:
    """is_main_skip と同系: 主兵装ではなく補助装備に分類（三脚・弾薬箱・偵察用等）。"""
    return bool(_RE_MAIN_SKIP.search(name or ""))


def nade_granish(name: str) -> bool:
    return re.search(
        r"(GREN|GRD|GPA|NADE|N36|NBK|SRCM|OTO|VERYPE|Very)",
        name,
        re.I,
    ) is not None


def is_45_smg_name(name: str) -> bool:
    """.45 系とみなす米軍 SMG（9mm 列と分岐するため）。"""
    n = (name or "").upper()
    if re.search(
        r"M1928A1|THOMPSON|GREASE|GREAS|"
        r"M1A1\s*SMG|^\s*M1\s*SMG\s*$|M1\s*SMG\s*$|M3A1\s*SMG|M3\s*SMG",
        n,
    ):
        return True
    t = n.strip()
    if t in (
        "M3A1",
        "M3",
        "M1928A1 SMG",
    ):
        return True
    if re.search(
        r"^M1928A1\s",
        t,
    ):
        return True
    return False


def is_9mm_smg_ammo_name(name: str) -> bool:
    """9mm 系 SMG。is_45_smg_name が偽のとき、独英伊・ソ等のパターンを真にする。"""
    t = (name or "").strip().upper()
    if t in (
        "EMP",
        "EMP/35",
    ):
        return True
    if is_45_smg_name(
        name,
    ):
        return False
    s = t.replace(" ", "").replace(
        "-",
        "",
    )
    if re.search(
        r"MP(38|40|28|35|34|41)|MP40/2|STEN|PPSh|PPD|PPS(43|H|4|40)|LANCE|OTTER|KRI|"
        r"MP3008|F\.?MLE|PPD40|MAB(?!$)|BERETTAM",
        s,
    ):
        return True
    if re.search(
        r"STEN|PPD(40|38)|PPSh",
        (name or "").upper(),
    ):
        return True
    return False


def wclass_from_cbe_category(category_name: str | None) -> str | None:
    """CBE category_name → stat 雛形。名称ヒューリスティクスより優先。"""
    m = {
        "pistol": "m1911",
        "rifle": "m1",
        "smg": "smg_9mm",
        "lmg": "bar",
        "mmg": "mg42",
        "rocket_launcher": "m8_rocket",
        "flamethrower": "flame",
        "bayonet_knife": "melee",
        "hand_grenade": "nade",
        "rifle_grenade": "m8_rocket",
    }
    return m.get(category_name or "")


def pl_category_from_cbe(category_name: str | None) -> str | None:
    m = {
        "pistol": "pistol",
        "rifle": "rifle",
        "smg": "smg",
        "lmg": "lmg",
        "mmg": "mg",
        "rocket_launcher": "rocket",
        "flamethrower": "flamethrower",
        "bayonet_knife": "melee",
        "hand_grenade": "grenade",
        "rifle_grenade": "rocket",
        "ammo_box": "ammo_box",
    }
    return m.get(category_name or "")


def pl_display_category(
    wclass: str,
    name: str,
) -> str:
    """
    人間可読の部門。stat 雛形名（m1, smg_45, smg_9mm 等）とは別。
    値は固定語彙: rifle, smg, mg, pistol, sniper, lmg, gear, …
    """
    m = {
        "m1": "rifle",
        "thompson": "smg",
        "smg_45": "smg",
        "smg_9mm": "smg",
        "k98_scope": "sniper",
        "bar": "auto_rifle",
        "m1911": "pistol",
        "luger": "pistol",
        "mg42": "mg",
        "nade": "grenade",
        "m8_rocket": "rocket",
        "flame": "flamethrower",
        "mortarish": "mortar",
        "shell_27": "launcher_27",
        "at_rifle": "anti_tank",
        "melee": "melee",
        "part_gear": "gear",
    }
    c = m.get(
        wclass,
        "other",
    )
    if wclass in (
        "m1",
        "k98_scope",
    ) and re.search(
        r"Cbn|Carb",
        name or "",
        re.I,
    ):
        return "carbine" if c == "rifle" else c
    return c


def wclassify(name: str) -> str:
    if is_meleeish(name):
        return "melee"
    if is_flamish(name):
        return "flame"
    if is_classify_support_gear(name):
        return "part_gear"
    if is_27ish(name) or re.search(
        r"leup|p42|kpf|stup|27mm",
        name,
        re.I,
    ):
        return "shell_27"
    if is_rocketish(name) or re.search(
        r"M6A1|M6A5|M9A1 RfG|GPA|Grd|WP M15|Haft|NbK",
        name,
    ):
        return "m8_rocket" if is_rocketish(name) else "m8_rocket"
    if is_mortarish(name):
        return "mortarish"
    if re.search(
        r"^P08$|^P38$|Luger",
        name,
        re.I,
    ):
        return "luger"
    if re.search(
        r"^C/96",
        name,
    ):
        return "m1911"
    if is_mgish(name):
        return "mg42"
    if is_smgish(name):
        return "smg_9mm" if is_9mm_smg_ammo_name(
            name,
        ) else "smg_45"
    if is_pistolish(name):
        return "m1911"
    if re.search(
        r"BAR|FG42|A6 LMG|1941   LMG",
        name,
        re.I,
    ):
        return "bar"
    if re.search(
        r"Scope|A4|\(T\)|Zf |svw|PU\b",
        name,
        re.I,
    ) or re.search(
        r"M1903A4|Zf|NO4|ENFIELD|NO1 MK4",
        (name or "").upper(),
    ):
        return "k98_scope"
    if is_rifle_sniperish(name) or re.search(
        r"Cbn|Gew|Kar|K98|Gew|StG|Rifle",
        name,
        re.I,
    ) or re.search(
        r"NO\d|BREN|Boys",
        (name or "").upper(),
    ):
        if "BREN" in (name or "").upper():
            return "bar"
        if "BOYS" in (name or "").upper():
            return "at_rifle"
        if "Cbn" in (name or "") and "SMG" not in (name or ""):
            return "m1"  # カービン
        return "m1"
    if is_atish(name):
        return "at_rifle"
    if re.search(
        r"AN-M8|GREN|GRD|SRCM|OTO|Breda 35|SB\.mod|Very|r36",
        name,
        re.I,
    ) or nade_granish(
        name,
    ):
        return "nade"
    if "Amm" in (name or "") and "Ammobox" in (name or ""):
        return "part_gear"
    if "OIL" in (name or "").upper() or "FILM" in (name,):
        return "part_gear"
    if "CDB" in (name,):
        return "m1"
    return "m1"  # 既定


def load_valid_ammo_pl_indices() -> set[int]:
    """PL_AMMO_DATA / ammo_compat の弾薬行インデックスのみ装填候補にする。"""
    if not AMMO_COMPAT_JSON.exists():
        return set()
    doc = json.loads(AMMO_COMPAT_JSON.read_text(encoding="utf-8"))
    ammo = doc.get("ammo") or {}
    return {int(k) for k in ammo.keys()}


def build_weapon_ammo_map_indices(valid_ammo: set[int]) -> dict[int, list[int]]:
    """CBE weapon_ammo_map.json から弾薬インデックスを抽出（プレースホルダ・非弾薬行を除外）。"""
    if not WEAPON_AMMO_MAP_JSON.exists():
        return {}
    rows = json.loads(WEAPON_AMMO_MAP_JSON.read_text(encoding="utf-8"))
    out: dict[int, list[int]] = {}
    for w in rows:
        wi = w.get("cbeNameIndex")
        if wi is None:
            continue
        picked: list[int] = []
        for d in w.get("ammo_details") or []:
            ai = d.get("cbeNameIndex")
            nm = (d.get("name") or "").strip()
            if ai is None:
                continue
            if nm.startswith("ammo_"):
                continue
            if ai not in valid_ammo:
                continue
            if ai not in picked:
                picked.append(ai)
        if picked:
            out[int(wi)] = picked
    return out


def load_weapon_ammo_overrides() -> dict[int, dict]:
    if not WEAPON_AMMO_OVERRIDES_JSON.exists():
        return {}
    doc = json.loads(WEAPON_AMMO_OVERRIDES_JSON.read_text(encoding="utf-8"))
    raw = doc.get("byCbeWeaponIndex") or {}
    out: dict[int, dict] = {}
    for k, v in raw.items():
        idx = int(k)
        out[idx] = {
            "plCbeWeaponIndex": idx,
            "plWeaponName": v.get("plWeaponName", ""),
            "acceptsAmmoPlIndices": list(v.get("acceptsAmmoPlIndices") or []),
            "plAmmoLabel": v.get("plAmmoLabel", ""),
        }
    return out


def format_ammo_label_from_indices(indices: list[int], valid_ammo: set[int]) -> str:
    if not indices:
        return "弾種未設定"
    names: list[str] = []
    if AMMO_COMPAT_JSON.exists():
        doc = json.loads(AMMO_COMPAT_JSON.read_text(encoding="utf-8"))
        ammo = doc.get("ammo") or {}
        for i in indices:
            row = ammo.get(str(i)) or ammo.get(i)
            if row and row.get("cbe_name"):
                names.append(str(row["cbe_name"]))
    if names:
        return " / ".join(names[:4]) + (" 他" if len(names) > 4 else "")
    return f"CBE 弾行 {indices[:3]}" + ("…" if len(indices) > 3 else "")


def is_us_machine_gun(name: str) -> bool:
    return bool(
        re.search(
            r"M1919|M1917A1|M2\s*HB|M1941\s+LMG",
            name or "",
            re.I,
        ),
    )


def is_sturmgewehr_kurz(name: str) -> bool:
    return bool(re.search(r"^MKb42|^MP43$|^StG44$|^VG1-5$", (name or "").strip()))


def build_cbe_to_plcompat(
    ex: dict,
) -> dict[int, dict]:
    out: dict[int, dict] = {}
    for e in ex.get("edges", []):
        idx = e["cbeWeaponIndex"]
        out[idx] = {
            "plCbeWeaponIndex": idx,
            "plWeaponName": e["plWeaponName"],
            "acceptsAmmoPlIndices": list(e["acceptsAmmoPlIndices"]),
            "plAmmoLabel": e.get("label", ""),
        }
    m = ex.get("mg42")
    if m and "cbeWeaponIndex" in m:
        out[m["cbeWeaponIndex"]] = {
            "plCbeWeaponIndex": m["cbeWeaponIndex"],
            "plWeaponName": "MG42",
            "acceptsAmmoPlIndices": list(m["acceptsAmmoPlIndices"]),
            "plAmmoLabel": m.get("note", "7.92 帯"),
        }
    m = ex.get("luger")
    if m and "cbeWeaponIndex" in m:
        out[m["cbeWeaponIndex"]] = {
            "plCbeWeaponIndex": m["cbeWeaponIndex"],
            "plWeaponName": m.get("plWeaponName", "P08"),
            "acceptsAmmoPlIndices": list(m["acceptsAmmoPlIndices"]),
            "plAmmoLabel": m.get("note", "9mm 帯"),
        }
    return out


def plcompat_for_index(
    i: int,
    name: str,
    cbe_to_pc: dict[int, dict],
    wclass: str,
    map_ammo: dict[int, list[int]],
    overrides: dict[int, dict],
    valid_ammo: set[int],
    filter_ctx: dict | None = None,
) -> dict:
    n = (name or "").strip()

    # 0. 実機確認済み例外（CBE 静的 ammo_indices より優先）
    if i in overrides and overrides[i].get("acceptsAmmoPlIndices"):
        row = overrides[i].copy()
        row["plWeaponName"] = n or row.get("plWeaponName", "")
        row["plCbeWeaponIndex"] = i
        eff = [x for x in row["acceptsAmmoPlIndices"] if x in valid_ammo]
        if eff:
            row["acceptsAmmoPlIndices"] = eff
            row["plAmmoLabel"] = row.get("plAmmoLabel") or format_ammo_label_from_indices(eff, valid_ammo)
            return row

    # 1. CBE stats ammo_indices + cat18 + u27（正本）
    if filter_ctx is not None and wclass not in (
        "nade",
        "m8_rocket",
        "flame",
        "mortarish",
        "melee",
        "part_gear",
    ):
        eff = effective_ammo_for_weapon(
            i,
            explicit=filter_ctx.get("explicit_raw"),
            stats_by_cbe=filter_ctx.get("stats_by_cbe"),
            cat_map=filter_ctx.get("cat_map"),
            w_shape=filter_ctx.get("w_shape"),
            a_shape=filter_ctx.get("a_shape"),
            include_composite=True,
        )
        eff = [x for x in eff if x in valid_ammo]
        if eff:
            return {
                "plCbeWeaponIndex": i,
                "plWeaponName": n,
                "acceptsAmmoPlIndices": eff,
                "plAmmoLabel": format_ammo_label_from_indices(eff, valid_ammo),
            }

    # 2. 手検証 explicit（CBE 空の武器のみ — mg42 クラスタ等は使わない）
    if i in cbe_to_pc:
        return cbe_to_pc[i].copy()

    # 3. weapon_ammo_overrides.json（CBE 空の米国 MG 等）
    if i in overrides:
        row = overrides[i].copy()
        row["plWeaponName"] = n or row.get("plWeaponName", "")
        row["plCbeWeaponIndex"] = i
        return row

    if i in map_ammo:
        indices = [x for x in map_ammo[i] if x in valid_ammo]
        if indices:
            return {
                "plCbeWeaponIndex": i,
                "plWeaponName": n,
                "acceptsAmmoPlIndices": indices,
                "plAmmoLabel": format_ammo_label_from_indices(indices, valid_ammo),
            }
    if wclass in (
        "m1",
        "k98_scope",
        "bar",
        "at_rifle",
    ) and re.search(
        r"Cbn\s*$",
        n.strip(),
    ):
        return {
            "plCbeWeaponIndex": i,
            "plWeaponName": n,
            "acceptsAmmoPlIndices": AMMO_30CBN,
            "plAmmoLabel": "30Cbn 仮: build_wpns_pl_master ヒューリスティクス",
        }
    if wclass == "mg42":
        if is_us_machine_gun(n):
            indices = [230, 238, 239, 240]
            return {
                "plCbeWeaponIndex": i,
                "plWeaponName": n,
                "acceptsAmmoPlIndices": indices,
                "plAmmoLabel": ".30-06 ベルト仮（米国 MG）",
            }
        st = (filter_ctx or {}).get("stats_by_cbe", {}).get(i) or {}
        raw_slots = [int(x) for x in (st.get("ammo_indices") or []) if x]
        if raw_slots:
            return {
                "plCbeWeaponIndex": i,
                "plWeaponName": n,
                "acceptsAmmoPlIndices": [],
                "plAmmoLabel": "CBE 行あり・フィルタ後空 — mag_type RE 待ち",
            }
        return {
            "plCbeWeaponIndex": i,
            "plWeaponName": n,
            "acceptsAmmoPlIndices": AMMO_792[:],
            "plAmmoLabel": "7.92 帯仮",
        }
    if is_sturmgewehr_kurz(n):
        st = (filter_ctx or {}).get("stats_by_cbe", {}).get(i) or {}
        kurz = [int(x) for x in (st.get("ammo_indices") or []) if x]
        if kurz:
            eff_k = effective_ammo_for_weapon(
                i,
                explicit=filter_ctx.get("explicit_raw") if filter_ctx else None,
                stats_by_cbe=filter_ctx.get("stats_by_cbe") if filter_ctx else None,
                cat_map=filter_ctx.get("cat_map") if filter_ctx else None,
                w_shape=filter_ctx.get("w_shape") if filter_ctx else None,
                a_shape=filter_ctx.get("a_shape") if filter_ctx else None,
                include_composite=False,
                use_mission_pool=True,
            )
            if eff_k:
                return {
                    "plCbeWeaponIndex": i,
                    "plWeaponName": n,
                    "acceptsAmmoPlIndices": eff_k,
                    "plAmmoLabel": format_ammo_label_from_indices(eff_k, valid_ammo),
                }
        return {
            "plCbeWeaponIndex": i,
            "plWeaponName": n,
            "acceptsAmmoPlIndices": [277],
            "plAmmoLabel": "7.92x33 Kurz — 7.92k-30",
        }
    if re.search(
        r"^C/96",
        n,
    ):
        return {
            "plCbeWeaponIndex": i,
            "plWeaponName": n,
            "acceptsAmmoPlIndices": AMMO_763,
            "plAmmoLabel": "7.63 仮 (C/96)",
        }
    if wclass in (
        "luger",
    ) or re.search(
        r"^P08$|^P38$|Luger",
        n,
        re.I,
    ):
        return {
            "plCbeWeaponIndex": i,
            "plWeaponName": n,
            "acceptsAmmoPlIndices": AMMO_9[:20],
            "plAmmoLabel": "9mm 帯仮",
        }
    if wclass in (
        "m1911",
    ) or is_pistolish(
        n,
    ):
        return {
            "plCbeWeaponIndex": i,
            "plWeaponName": n,
            "acceptsAmmoPlIndices": AMMO_45_PISTOL,
            "plAmmoLabel": "45/拳銃 仮",
        }
    if wclass == "smg_9mm":
        return {
            "plCbeWeaponIndex": i,
            "plWeaponName": n,
            "acceptsAmmoPlIndices": AMMO_9[:32],
            "plAmmoLabel": "9mm SMG 帯仮（要 explicit / cbe_weapon_ammo で確定）",
        }
    if wclass == "smg_45":
        return {
            "plCbeWeaponIndex": i,
            "plWeaponName": n,
            "acceptsAmmoPlIndices": [234, 235, 236, 237],
            "plAmmoLabel": "45ACP 箱 仮（米 .45 SMG: M1928 / M1・M3 SMG 等。要 explicit）",
        }
    if wclass == "m1" and is_smgish(
        n,
    ):
        return {
            "plCbeWeaponIndex": i,
            "plWeaponName": n,
            "acceptsAmmoPlIndices": [234, 235, 236, 237],
            "plAmmoLabel": "45ACP 箱 仮（SMG+小銃分類衝突。要 explicit）",
        }
    if wclass == "shell_27" or is_27ish(
        n,
    ):
        return {
            "plCbeWeaponIndex": i,
            "plWeaponName": n,
            "acceptsAmmoPlIndices": AMMO_27,
            "plAmmoLabel": "27mm 仮",
        }
    if wclass == "part_gear":
        return {
            "plCbeWeaponIndex": i,
            "plWeaponName": n,
            "acceptsAmmoPlIndices": [],
            "plAmmoLabel": "補助装備（主兵装弾なし。装填正本: explicit のみ）",
        }
    if wclass in (
        "nade",
        "m8_rocket",
        "flame",
        "mortarish",
        "melee",
        "at_rifle",
    ):
        return {
            "plCbeWeaponIndex": i,
            "plWeaponName": n,
            "acceptsAmmoPlIndices": AMMO_3006[:1],
            "plAmmoLabel": f"{wclass} 非装填/ダミ行（1件。explicit で上書き）",
        }
    if wclass in ("k98_scope", "m1", "bar") and re.search(
        r"^(M1|M190|M191|BAR|M1941|Enfield|Springfield)",
        n,
        re.I,
    ):
        return {
            "plCbeWeaponIndex": i,
            "plWeaponName": n,
            "acceptsAmmoPlIndices": AMMO_3006,
            "plAmmoLabel": "30-06 仮（米系小銃）",
        }
    return {
        "plCbeWeaponIndex": i,
        "plWeaponName": n,
        "acceptsAmmoPlIndices": [],
        "plAmmoLabel": "弾種未設定（map / overrides / explicit で要定義）",
    }


def js_escape(s: str) -> str:
    return json.dumps(s, ensure_ascii=False)


def write_cbe_name_chain_csv(names: list[str]) -> None:
    CSV_CBE_CHAIN.parent.mkdir(parents=True, exist_ok=True)
    with CSV_CBE_CHAIN.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["cbeNameIndex", "name"])
        for i, n in enumerate(names):
            w.writerow([i, n])
    print("Wrote", CSV_CBE_CHAIN, "rows", len(names))


def write_wpns_master_table_csv(wpn_objects: list[tuple[str, dict, str]]) -> None:
    CSV_WPNS_TABLE.parent.mkdir(parents=True, exist_ok=True)
    with CSV_WPNS_TABLE.open("w", newline="", encoding="utf-8-sig") as f:
        wo = csv.writer(f)
        wo.writerow(
            [
                "wpns_code",
                "cbeNameIndex",
                "plCategory",
                "statTemplate",
                "name",
                "type",
                "rng",
                "acc",
                "dmg",
                "cap",
                "mag",
                "ap",
                "rld",
                "wgt",
                "plAmmoLabel",
                "acceptsAmmoPlIndices",
            ],
        )
        for code, wbase, wc in wpn_objects:
            pc = wbase.get("plCompat") or {}
            am = pc.get("acceptsAmmoPlIndices")
            ams = "" if am is None else json.dumps(am, ensure_ascii=False)
            wo.writerow(
                [
                    code,
                    wbase.get("cbeNameIndex", ""),
                    wbase.get("plCategory", ""),
                    wbase.get("statTemplate", wc),
                    wbase.get("name", ""),
                    wbase.get("type", ""),
                    wbase.get("rng", ""),
                    wbase.get("acc", ""),
                    wbase.get("dmg", ""),
                    wbase.get("cap", ""),
                    wbase.get("mag", ""),
                    wbase.get("ap", ""),
                    wbase.get("rld", ""),
                    wbase.get("wgt", ""),
                    pc.get("plAmmoLabel", ""),
                    ams,
                ],
            )
    print("Wrote", CSV_WPNS_TABLE, "rows", len(wpn_objects))


def wpn_to_js_obj(d: dict) -> str:
    """WPNS 1 行用。attr は JS の ATTR 参照。plCompat は JSON 化でそのまま埋め込み可。"""
    parts: list[str] = []
    t = d.get("type", "")
    parts.append("attr:ATTR.RECOVERY" if t == "part" else "attr:ATTR.WEAPON")
    for k, v in d.items():
        if v is None:
            continue
        if k == "plCompat" and isinstance(v, dict):
            parts.append("plCompat:" + json.dumps(v, ensure_ascii=False))
            continue
        if isinstance(
            v,
            bool,
        ):
            parts.append(
                f"{k}:{str(v).lower()}",
            )
        elif isinstance(
            v,
            (int, float),
        ):
            parts.append(f"{k}:{v}")
        elif isinstance(
            v,
            str,
        ):
            parts.append(f"{k}:{js_escape(v)}")
        elif isinstance(
            v,
            list,
        ):
            if k == "modes":
                parts.append(
                    f"{k}:{json.dumps(v)}",
                )
            else:
                parts.append(
                    f"{k}:{json.dumps(v, ensure_ascii=False)}",
                )
        elif isinstance(
            v,
            dict,
        ):
            parts.append(
                f"{k}:{json.dumps(v, ensure_ascii=False)}",
            )
        else:
            parts.append(
                f"{k}:{json.dumps(v, ensure_ascii=False)}",
            )
    return "{" + ",".join(parts) + "}"


def load_stats_by_code() -> dict[str, dict]:
    """wpns_pl_stats_decoded.json を wpns_code でインデックス化して返す。"""
    if not STATS_JSON.exists():
        print("WARNING: wpns_pl_stats_decoded.json not found, skipping stats fields")
        return {}
    entries = json.loads(STATS_JSON.read_text(encoding="utf-8"))
    return {e["wpns_code"]: e for e in entries if "wpns_code" in e}


def write_ammo_data_js(ammo_compat: dict) -> None:
    """ammo_compat_full.json の ammo セクションから window.PL_AMMO_DATA を生成する。"""
    ammo_section = ammo_compat.get("ammo", {})
    lines = [
        "/** 自動生成: python scripts/build_wpns_pl_master.py — 手編集禁止 */",
        "window.PL_AMMO_DATA = {",
    ]
    items = sorted(ammo_section.items(), key=lambda kv: int(kv[0]))
    for idx_str, info in items:
        idx = int(idx_str)
        name = info.get("display_name") or info.get("cbe_name") or f"ammo_{idx}"
        malf_mod = info.get("malfunction_modifier", 0)
        mag_cap = info.get("magazine_capacity", 1)
        line = (
            f"  {idx}: {{"
            f"name:{json.dumps(name, ensure_ascii=False)},"
            f"malfMod:{malf_mod},"
            f"magCap:{mag_cap},"
            f"cbeIdx:{idx}"
            f"}},"
        )
        lines.append(line)
    lines.append("};")
    text = "\n".join(lines) + "\n"
    OUT_AMMO.parent.mkdir(parents=True, exist_ok=True)
    OUT_AMMO.write_text(text, encoding="utf-8")
    print("Wrote", OUT_AMMO, "entries", len(items))


def write_loadout_templates_js(loadout_data: dict) -> None:
    """loadout_templates.json をそのまま window.PL_LOADOUT_TEMPLATES として出力する。"""
    lines = [
        "/** 自動生成: python scripts/build_wpns_pl_master.py — 手編集禁止 */",
        "window.PL_LOADOUT_TEMPLATES = " + json.dumps(loadout_data, ensure_ascii=False, indent=2) + ";",
    ]
    text = "\n".join(lines) + "\n"
    OUT_LOADOUT.parent.mkdir(parents=True, exist_ok=True)
    OUT_LOADOUT.write_text(text, encoding="utf-8")
    print("Wrote", OUT_LOADOUT, "nations", len(loadout_data))


def main() -> int:
    doc = json.loads(PL_JSON.read_text(encoding="utf-8"))
    names = doc["weapon_name_tables"]["cbe_us_m1911a1_chain"]["names"]
    entries = doc.get("entries_index") or {}
    ex = json.loads(EXPLICIT.read_text(encoding="utf-8"))
    cbe_to_pc = build_cbe_to_plcompat(
        ex,
    )
    valid_ammo = load_valid_ammo_pl_indices()
    map_ammo = build_weapon_ammo_map_indices(valid_ammo)
    overrides = load_weapon_ammo_overrides()
    stats_by_code = load_stats_by_code()

    explicit_raw: dict[int, list[int]] = {}
    for e in ex.get("edges") or []:
        wi = e.get("cbeWeaponIndex")
        if wi is not None:
            explicit_raw[int(wi)] = [int(x) for x in (e.get("acceptsAmmoPlIndices") or [])]
    for key in ("mg42", "luger"):
        block = ex.get(key)
        if block and block.get("cbeWeaponIndex") is not None:
            explicit_raw[int(block["cbeWeaponIndex"])] = [
                int(x) for x in (block.get("acceptsAmmoPlIndices") or [])
            ]

    filter_ctx = {
        "explicit_raw": explicit_raw,
        "stats_by_cbe": load_stats_by_cbe(),
        "cat_map": load_category_map(),
        "w_shape": load_json_from_js(MAG_SHAPE_JS, "PL_CBE_MAG_SHAPE_WEAPONS"),
        "a_shape": load_json_from_js(MAG_SHAPE_JS, "PL_CBE_MAG_SHAPE_AMMO"),
    }

    # 弾薬 JS と ロードアウトテンプレート JS を先に生成
    if AMMO_COMPAT_JSON.exists():
        ammo_compat = json.loads(AMMO_COMPAT_JSON.read_text(encoding="utf-8"))
        write_ammo_data_js(ammo_compat)
    else:
        print("WARNING: ammo_compat_full.json not found, skipping pl_ammo_data.js")
    if LOADOUT_TEMPLATES_JSON.exists():
        loadout_data = json.loads(LOADOUT_TEMPLATES_JSON.read_text(encoding="utf-8"))
        write_loadout_templates_js(loadout_data)
    else:
        print("WARNING: loadout_templates.json not found, skipping pl_loadout_templates.js")

    wpn_objects: list[tuple[str, dict, str]] = []
    main_codes: list[str] = []
    sub_codes: list[str] = []
    for i, raw_name in enumerate(
        names,
    ):
        if is_garbage_chain_name(
            raw_name,
        ) or is_pure_ammo_name(
            raw_name,
        ):
            continue
        name = raw_name.strip() or f"pl_{i}"
        code = f"pl_{i}"
        st = stats_by_code.get(code) or filter_ctx["stats_by_cbe"].get(i) or {}
        category_code = st.get("category_code")
        cbe_cat = None
        code_to_name = {
            1: "pistol",
            4: "rifle",
            5: "lmg",
            6: "smg",
            7: "mmg",
            8: "at_rifle",
            9: "flamethrower",
            10: "rocket_launcher",
            11: "panzerfaust",
            12: "tripod",
            13: "ammo_box",
        }
        if category_code in code_to_name:
            cbe_cat = code_to_name[category_code]
        else:
            cbe_cat = st.get("category_name")

        # Category-13 entries are ammunition containers.  Their decoded
        # numeric fields resemble firearms, but they must never enter the
        # primary weapon pool or become fireable in-game.
        wc = "part_gear" if cbe_cat == "ammo_box" else (wclass_from_cbe_category(cbe_cat) or wclassify(
            name,
        ))
        wtemplate = T.get(
            wc,
            T["m1"],
        ).copy()
        wbase = wtemplate
        wbase["name"] = name
        wbase["cbeNameIndex"] = i
        plc = plcompat_for_index(
            i,
            name,
            cbe_to_pc,
            wc,
            map_ammo,
            overrides,
            valid_ammo,
            filter_ctx,
        )
        accepts_ammo = plc.get("acceptsAmmoPlIndices") or []
        wbase["plCompat"] = {
            "plCbeWeaponIndex": plc.get(
                "plCbeWeaponIndex",
                i,
            ),
            "plWeaponName": plc.get(
                "plWeaponName",
                name,
            ),
            "acceptsAmmoPlIndices": accepts_ammo,
            "plAmmoLabel": plc.get(
                "plAmmoLabel",
                "",
            ),
        }
        wbase["plCbeWeaponIndex"] = i
        wbase["statTemplate"] = wc
        wbase["plCategory"] = (
            pl_category_from_cbe(cbe_cat)
            or pl_display_category(
                wc,
                name,
            )
        )
        # CBE 解析ステータスフィールド（wpns_pl_stats_decoded.json から）
        wbase["malfRate"] = st.get("malfunction_rate", 0)
        wbase["magCap"] = st.get("magazine_capacity", wbase.get("cap", 1))
        wbase["autoFire"] = bool(st.get("auto_fire", False))

        # shots_per_action からバースト値 (burst) を決定（0x8000 フラグをマスク）
        raw_burst = st.get("shots_per_action")
        if raw_burst is not None and raw_burst > 0:
            real_burst = raw_burst & 0x7FFF
            if 0 < real_burst < 100:
                wbase["burst"] = real_burst
                # 拳銃かつマシンピストル（Astra 903, C/96M712）以外なら強制的に 1 にする
                if category_code == 1 and not re.search(r"M712|903|Astra", name, re.I):
                    wbase["burst"] = 1
        wh = st.get("weight_100g")
        if wh is not None and wh > 0:
            wbase["weight"] = round(wh / 10, 1)
            wbase["wgt"] = round(wh / 10, 1)
        mc = st.get("magazine_capacity")
        if (
            mc is not None
            and wbase.get("type") == "bullet"
            and wc in ("m1", "k98_scope", "bar", "at_rifle", "carbine", "smg_9mm", "mg42")
        ):
            wbase["cap"] = mc
        # acceptsAmmo: plCompat.acceptsAmmoPlIndices のショートハンド
        wbase["acceptsAmmo"] = accepts_ammo
        wpn_objects.append(
            (
                code,
                wbase,
                wc,
            ),
        )
    # プール
    for code, wbase, wc in wpn_objects:
        name = wbase["name"]
        t = wbase.get("type", "")
        if t == "part":
            continue
        if is_main_skip_name(
            name,
        ):
            continue
        if is_vehicle_or_towed_gun_name(
            name,
        ):
            continue
        if is_meleeish(
            name,
        ) and not is_pistolish(
            name,
        ):
            if code not in sub_codes:
                sub_codes.append(
                    code,
                )
            continue
        if is_pistolish(
            name,
        ):
            if code not in sub_codes:
                sub_codes.append(
                    code,
                )
            continue
        if wc in ("mortarish",) or wbase.get("indirect") is True and "GREN" in name.upper() and t == "part":
            continue
        if t in (
            "melee",
        ) and not is_rocketish(
            name,
        ) and is_meleeish(
            name,
        ):
            if code not in sub_codes and code not in sub_codes:
                sub_codes.append(
                    code,
                )
            continue
        # メイン: 有効弾/戦闘
        if t not in (
            "part",
        ) and (wbase.get("dmg") is not None or t in (
            "bullet",
            "shell",
            "rocket",
            "shell_fast",
        )):
            if code not in main_codes and not (is_pistolish(
                name,
            )):
                main_codes.append(
                    code,
                )
    for code, wbase, wc in wpn_objects:
        n = wbase["name"]
        if (is_pistolish(
            n,
        ) or (is_meleeish(
            n,
        ) and not is_smgish(
            n,
        ))) and code not in sub_codes:
            sub_codes.append(
                code,
            )
    if "pl_0" not in sub_codes and any(
        c == "pl_0" for c, _, __ in wpn_objects
    ):
        sub_codes.insert(
            0,
            "pl_0",
        )
    if "pl_40" in [c for c, _, __ in wpn_objects] and "pl_40" not in sub_codes:
        sub_codes.append(
            "pl_40",
        )
    if "pl_42" in [c for c, _, __ in wpn_objects] and "pl_42" not in sub_codes:
        sub_codes.append(
            "pl_42",
        )
    if not sub_codes:
        sub_codes = [c for c, _, _ in wpn_objects[:3]]
    out_lines: list[str] = [
        "/** 自動生成: python scripts/build_wpns_pl_master.py — 手編集禁止 */",
        "(function () {",
        "  'use strict';",
        "  if (typeof WPNS === 'undefined' || typeof ATTR === 'undefined') return;",
        "  const M = {",
    ]
    for j, (code, w, wc) in enumerate(
        wpn_objects,
    ):
        comma = ","
        if j == len(
            wpn_objects,
        ) - 1:
            comma = ""
        out_lines.append(
            f"    {js_escape(code)}: {wpn_to_js_obj(w)}{',' if comma else ''}",
        )
    out_lines.append(
        "  };",
    )
    out_lines.append(
        "  for (const k of Object.keys(M)) { WPNS[k] = M[k]; }",
    )
    out_lines.append(
        "  window.WPNS_PL_MASTER_VERSION = 1;",
    )
    out_lines.append(
        f"  window.WPNS_PL_INFANTRY_MAIN_CODES = {json.dumps(main_codes, ensure_ascii=False)};",
    )
    out_lines.append(
        f"  window.WPNS_PL_INFANTRY_SUB_CODES = {json.dumps(sub_codes, ensure_ascii=False)};",
    )
    out_lines.append(
        "  if (window.WPNS_PL_INFANTRY_MAIN_CODES && window.WPNS_PL_INFANTRY_MAIN_CODES.length) {"
        " window.PL_INFANTRY_MAIN_CODES = window.WPNS_PL_INFANTRY_MAIN_CODES; }",
    )
    out_lines.append(
        "  if (window.WPNS_PL_INFANTRY_SUB_CODES && window.WPNS_PL_INFANTRY_SUB_CODES.length) {"
        " window.PL_INFANTRY_SUB_CODES = window.WPNS_PL_INFANTRY_SUB_CODES; }",
    )
    out_lines.append(
        "})();",
    )
    text = "\n".join(
        out_lines,
    ) + "\n"
    write_cbe_name_chain_csv(
        names,
    )
    write_wpns_master_table_csv(
        wpn_objects,
    )
    OUT.parent.mkdir(
        parents=True,
        exist_ok=True,
    )
    OUT.write_text(
        text,
        encoding="utf-8",
    )
    print(
        "Wrote",
        OUT,
        "entries",
        len(
            wpn_objects,
        ),
        "main",
        len(
            main_codes,
        ),
        "sub",
        len(
            sub_codes,
        ),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(
        main(),
    )

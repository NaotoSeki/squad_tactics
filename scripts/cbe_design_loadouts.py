# -*- coding: utf-8 -*-
"""
Phase 3: 国別装備セット設計
- 武器名の接頭辞/語源で国籍グループに分類
- 分隊役割ごとのロードアウトテンプレートを設計
- data/loadout_templates.json を出力
"""
import json
from pathlib import Path
from collections import defaultdict

decoded = json.loads(Path("data/wpns_pl_stats_decoded.json").read_text(encoding="utf-8"))
ammo_map = {r["cbeNameIndex"]: r for r in decoded if r["category_code"] == 18}
weapons = [r for r in decoded if 1 <= r["category_code"] <= 17]
weapons_map = {r["cbeNameIndex"]: r for r in weapons}

# ====================================================
# 3-A: 国籍別武器グルーピング
# ====================================================

# 名前ベースの国籍判定ルール
NATION_RULES = [
    # 米軍 (US)
    ("US", ["M1911", "M1917", "OSS", "AN-M", "M1903", "M1918", "M1 Rifle", "M1C Rifle",
            "M1D Rifle", "M1941 Rifle", "M1 Cbn", "M1A1 Cbn", "M2 Cbn",
            "M1928", "M1 SMG", "M1A1 SMG", "M3 SMG", "M3A1 SMG",
            "M1919", "M1917A1", "M2 HB", "M1 RL", "M1A1 RL", "M9 RL",
            "E1R1", "M1A1 Fl", "M2A1", "M2 Tripod", "M1917 Tripod", "M3 Tripod",
            "M1 Ammo", "M2HB Ammo", "M3 Bino", "SCR536", "Med Bag",
            "Film", "Map Case", "M9A1", "Mk2 G", "Mk3A1",
            "M1905Byt", "M1 CDB", "WP M15", "Mk1 TKnf", "M3 T.Knf",
            "M2 Cbn", "Astra"]),  # Astra903はスペイン製だが米軍使用

    # ドイツ軍 (GER)
    ("GER", ["P08", "M1934", "Beholla", "M38H", "PP", "PPK", "HSc", "P38",
             "Gew98", "Kar98", "Zf Kar98", "Gew41", "Gew43", "VG-1", "VG-2",
             "MP18", "MP28", "MP34", "MP38", "MP40", "MP3008", "Ger Pots",
             "MKb42", "MP43", "MP44", "StG44",
             "FG42", "MG08", "MG15", "MG17", "MG26", "MG34", "MG42",
             "PzB38", "PzB39", "GrB39", "PzBSS41", "PzB41",
             "FmW35", "FmW40", "FmW42", "FmW43",
             "RPzB43", "RPzB54", "PF30", "PF60", "PF100",
             "Laf34", "Laf42", "Sch08",
             "PatrK", "Fernglas", "Feldfu",
             "StiGr24", "StiGr39", "StiGr43", "Haft-Hl3", "NbK39",
             "GebLad", "27mm", "Wkor", "Wgrp", "FLeut",
             "M3 Byt",  # German bayonet
             "7.92", "9Pb", "Pk16", "Pzwk"]),

    # イタリア軍 (ITA)
    ("ITA", ["M38 Carcano", "Carcano", "Breda", "Beretta", "M07", "M1891",
             "T. Breda", "Binocolo", "Mkt35"]),

    # フランス軍 (FR)
    ("FR", ["MAS38", "FR mod", "Mle1914", "T. Mle", "Lebel", "Berthier",
            "Chauchat", "Jumelles"]),

    # ソ連軍 (SOV)
    ("SOV", ["TT33", "Nagan", "SVT40", "obr18", "obr19",
             "PPD40", "PPSh41", "PPS43",
             "DP", "DShK", "PM1910", "PTRD", "PTRS",
             "Note"]),  # Note = ソ連軍書類

    # イギリス軍 (UK)
    ("UK", ["Enfield", "Bren", "Sten", "Lewis", "Vickers", "PIAT",
            "Binocular", "Mk2 GPA"]),

    # チェコスロバキア/ポーランド等 (OTHER)
    ("OTHER", ["ZB vz", "vz.", "CZ", "Wz.", "SMLE"]),
]

def classify_weapon(name):
    # パス1: 完全一致
    for nation, keywords in NATION_RULES:
        for kw in keywords:
            if name == kw:
                return nation
    # パス2: startswith（キーワード4文字以上のみ）
    for nation, keywords in NATION_RULES:
        for kw in keywords:
            if len(kw) >= 4 and name.startswith(kw):
                return nation
    # パス3: substring（キーワード5文字以上のみ）
    for nation, keywords in NATION_RULES:
        for kw in keywords:
            if len(kw) >= 5 and kw in name:
                return nation
    return "OTHER"

# 武器を国籍別に分類
nation_weapons = defaultdict(list)
for w in weapons:
    if w["category_code"] > 12:
        continue  # 装備品は除外
    nation = classify_weapon(w["name"])
    nation_weapons[nation].append(w)

print("=== 国籍別武器数 ===")
for nation, wlist in sorted(nation_weapons.items()):
    cats = defaultdict(list)
    for w in wlist:
        cats[w["category_name"]].append(w["name"])
    print(f"\n  {nation}: {len(wlist)} 武器")
    for cat, names in sorted(cats.items()):
        print(f"    {cat:15s}: {', '.join(names[:5])}" + (f" +{len(names)-5}" if len(names)>5 else ""))

# ====================================================
# 3-B: ロードアウトテンプレート設計
# ====================================================

def find_weapon(name_fragment, nation=None):
    """名前部分一致で武器を検索"""
    candidates = []
    for w in weapons:
        if name_fragment.lower() in w["name"].lower():
            if nation is None or classify_weapon(w["name"]) == nation:
                candidates.append(w)
    return candidates[0] if candidates else None

def make_slot(weapon_name, qty_ammo=None, comment=""):
    """ロードアウトスロットを作成"""
    w = find_weapon(weapon_name)
    if not w:
        return {"weapon": weapon_name, "cbeIdx": None, "note": f"NOT FOUND: {weapon_name}"}
    ammo_slots = []
    if qty_ammo and w["ammo_indices"]:
        primary_ammo_idx = w["ammo_indices"][0]
        a = ammo_map.get(primary_ammo_idx, {})
        ammo_slots = [{
            "cbeIdx": primary_ammo_idx,
            "name": a.get("name", f"ammo_{primary_ammo_idx}"),
            "qty": qty_ammo,
        }]
    return {
        "weapon_cbeIdx": w["cbeNameIndex"],
        "weapon_name": w["name"],
        "ammo": ammo_slots,
        "comment": comment,
    }

# ロードアウトテンプレート定義
loadout_templates = {
    "metadata": {
        "description": "国籍別・役割別ロードアウトテンプレート",
        "source": "CBE.EXE 逆解析データ",
        "version": "1.0",
    },
    "templates": {

        # ====== 米軍 ======
        "us_rifleman": {
            "nation": "US",
            "role": "rifleman",
            "role_ja": "ライフルマン",
            "primary": make_slot("M1 Rifle", qty_ammo=3, comment="M1 Garand + 8連クリップ×3"),
            "secondary": make_slot("M1911A1", qty_ammo=1),
            "grenades": [make_slot("Mk2 Grd", comment="パイナップル手榴弾")],
            "equipment": [],
        },

        "us_bar_man": {
            "nation": "US",
            "role": "bar_man",
            "role_ja": "BAR 射手",
            "primary": make_slot("M1918A2 BAR", qty_ammo=4),
            "secondary": make_slot("M1911A1", qty_ammo=1),
            "grenades": [],
            "equipment": [],
        },

        "us_smg": {
            "nation": "US",
            "role": "smg",
            "role_ja": "SMG 射手",
            "primary": make_slot("M1A1 SMG", qty_ammo=3, comment="M1A1 トンプソン"),
            "secondary": make_slot("M1911A1", qty_ammo=1),
            "grenades": [make_slot("Mk2 Grd")],
            "equipment": [],
        },

        "us_sniper": {
            "nation": "US",
            "role": "sniper",
            "role_ja": "スナイパー",
            "primary": make_slot("M1903A4", qty_ammo=3, comment="スプリングフィールドスコープ付き"),
            "secondary": make_slot("M1911A1", qty_ammo=1),
            "grenades": [],
            "equipment": [make_slot("M3 Bino", comment="双眼鏡")],
        },

        "us_mg": {
            "nation": "US",
            "role": "mg",
            "role_ja": "機関銃射手",
            "primary": make_slot("M1919A4 MMG", qty_ammo=2),
            "secondary": make_slot("M1911A1", qty_ammo=1),
            "grenades": [],
            "equipment": [make_slot("M1917 Tripod")],
        },

        "us_at": {
            "nation": "US",
            "role": "at",
            "role_ja": "対戦車",
            "primary": make_slot("M9 RL", qty_ammo=3, comment="バズーカ"),
            "secondary": make_slot("M1A1 Cbn", qty_ammo=2),
            "grenades": [],
            "equipment": [],
        },

        # ====== ドイツ軍 ======
        "ger_rifleman": {
            "nation": "GER",
            "role": "rifleman",
            "role_ja": "ライフルマン",
            "primary": make_slot("Kar98k", qty_ammo=3, comment="Kar98k ボルトアクション"),
            "secondary": make_slot("P08", qty_ammo=1),
            "grenades": [make_slot("StiGr24", comment="棒手榴弾")],
            "equipment": [],
        },

        "ger_smg": {
            "nation": "GER",
            "role": "smg",
            "role_ja": "SMG 射手",
            "primary": make_slot("MP40", qty_ammo=3),
            "secondary": make_slot("P08", qty_ammo=1),
            "grenades": [make_slot("StiGr24")],
            "equipment": [],
        },

        "ger_mg": {
            "nation": "GER",
            "role": "mg",
            "role_ja": "機関銃射手",
            "primary": make_slot("MG42", qty_ammo=2, comment="MG42"),
            "secondary": make_slot("P08", qty_ammo=1),
            "grenades": [],
            "equipment": [make_slot("Laf42")],
        },

        "ger_sniper": {
            "nation": "GER",
            "role": "sniper",
            "role_ja": "スナイパー",
            "primary": make_slot("Zf Kar98k", qty_ammo=3, comment="スコープ付き Kar98k"),
            "secondary": make_slot("P08", qty_ammo=1),
            "grenades": [],
            "equipment": [make_slot("Fernglas")],
        },

        "ger_at": {
            "nation": "GER",
            "role": "at",
            "role_ja": "対戦車",
            "primary": make_slot("RPzB54", qty_ammo=2, comment="パンツァーシュレック"),
            "secondary": make_slot("MP40", qty_ammo=2),
            "grenades": [make_slot("Haft-Hl3", comment="吸着地雷")],
            "equipment": [],
        },

        # ====== ソ連軍 ======
        "sov_rifleman": {
            "nation": "SOV",
            "role": "rifleman",
            "role_ja": "ライフルマン",
            "primary": make_slot("obr1891/30g", qty_ammo=3, comment="モシン・ナガン 1891/30年式"),
            "secondary": make_slot("TT33", qty_ammo=1),
            "grenades": [],
            "equipment": [],
        },

        "sov_smg": {
            "nation": "SOV",
            "role": "smg",
            "role_ja": "SMG 射手",
            "primary": make_slot("PPSh41", qty_ammo=3, comment="PPSh-41 ドラムマガジン"),
            "secondary": make_slot("TT33", qty_ammo=1),
            "grenades": [],
            "equipment": [],
        },

        "sov_mg": {
            "nation": "SOV",
            "role": "mg",
            "role_ja": "機関銃射手",
            "primary": make_slot("DP", qty_ammo=2, comment="DP 軽機関銃"),
            "secondary": make_slot("TT33", qty_ammo=1),
            "grenades": [],
            "equipment": [],
        },

        "ger_assault": {
            "nation": "GER",
            "role": "assault",
            "role_ja": "突撃兵",
            "primary": make_slot("StG44", qty_ammo=3, comment="Sturmgewehr 44"),
            "secondary": make_slot("P38", qty_ammo=1),
            "grenades": [make_slot("StiGr43")],
            "equipment": [],
        },
    }
}

# テンプレートの表示
print("\n=== ロードアウトテンプレート ===")
for tmpl_key, tmpl in loadout_templates["templates"].items():
    nation = tmpl["nation"]
    role_ja = tmpl["role_ja"]
    primary = tmpl.get("primary", {})
    secondary = tmpl.get("secondary", {})
    pname = primary.get("weapon_name", "?") if isinstance(primary, dict) else "?"
    sname = secondary.get("weapon_name", "?") if isinstance(secondary, dict) else "?"
    print(f"  [{nation}] {role_ja:10s}: 主={pname:20s} 副={sname}")

# JSON 出力
out_path = Path("data/loadout_templates.json")
out_path.write_text(json.dumps(loadout_templates, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"\n  → {out_path} に出力")

# 国籍別武器一覧も JSON 出力
nation_list = {}
for nation, wlist in nation_weapons.items():
    nation_list[nation] = [
        {
            "cbeNameIndex": w["cbeNameIndex"],
            "name": w["name"],
            "category_name": w["category_name"],
            "purchase_cost": w["purchase_cost"],
        }
        for w in sorted(wlist, key=lambda x: (x["category_code"], x["cbeNameIndex"]))
    ]

out_nat = Path("data/weapon_nations.json")
out_nat.write_text(json.dumps(nation_list, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"  → {out_nat} に出力")
print(f"\n  国籍別カウント:")
for n, wl in sorted(nation_list.items()):
    print(f"    {n}: {len(wl)} 武器")

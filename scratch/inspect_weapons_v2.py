import json
import re
from pathlib import Path

ROOT = Path("c:/Projects/squad_tactics")
STATS_JSON = ROOT / "data" / "wpns_pl_stats_decoded.json"
NAME_TABLE_JSON = ROOT / "data" / "cbe_name_table.json"
AMMO_TABLE_JSON = ROOT / "data" / "ammo_table.json"

stats = json.loads(STATS_JSON.read_text(encoding="utf-8"))
names = json.loads(NAME_TABLE_JSON.read_text(encoding="utf-8"))
ammo = json.loads(AMMO_TABLE_JSON.read_text(encoding="utf-8"))

ammo_by_idx = {}
for x in ammo:
    idx_val = x.get("idx") or x.get("cbeIdx")
    if idx_val is not None:
        ammo_by_idx[int(idx_val)] = x

# 国別（またはインデックス）で怪しいものを走査する
# category_code: 1=pistol, 4=rifle, 5=lmg, 6=smg, 7=mmg, 8=at_rifle

def get_ammo_name(idx):
    return ammo_by_idx.get(idx, {}).get("name", f"ammo_{idx}")

print("=== INSPECTING DECODED WEAPON STATS ===")

for w in stats:
    idx = w["cbeNameIndex"]
    name = w["name"]
    cat_code = w.get("category_code")
    burst = w.get("shots_per_action", 0)
    ammo_indices = w.get("ammo_indices", [])
    
    # 拳銃 (cat_code == 1) の監査
    if cat_code == 1:
        # 拳銃なのにバーストが2以上
        # 注: C/96M712 (42) や Astra903 (223) などのマシンピストルはバースト連射可能なので除外
        if burst > 1 and not re.search(r"M712|903|Astra", name, re.I):
            print(f"[PISTOL BURST BUG] Index {idx} ({name}): burst={burst}")
        
        # 拳銃弾ではない弾薬をロードしている
        # 拳銃弾: 45ACP, 9Pb, 32ACP, 7.63, 10.35, 9Gli, 380ACP
        for ai in ammo_indices:
            an = get_ammo_name(ai).upper()
            if not any(x in an for x in ["45ACP", "9PB", "32ACP", "7.63", "10.35", "9GLI", "380ACP", "Very"]):
                print(f"[PISTOL AMMO BUG] Index {idx} ({name}): loads {an} (idx {ai})")

    # 小銃 (cat_code == 4) の監査
    elif cat_code == 4:
        # ボルトアクションや半自動小銃なのにバーストが2以上 (StG44/MP43等はSMGやLMGカテゴリに入るか、あるいは別途除外)
        # VG1-5 (77) や MKb42 (73/74) などの突撃銃はバースト可能
        if burst > 1 and not re.search(r"StG|MP43|MKb42|VG1-5", name, re.I):
            # ただし、一部の連射可能な特殊小銃があるか？
            print(f"[RIFLE BURST] Index {idx} ({name}): burst={burst}")
            
        # 小銃なのに拳銃弾 (9mmパラなど) をロードしている
        # ただし、ルガーピストルカービン等の例外があるか？(F. mod38が9mmをロードしていた問題など)
        for ai in ammo_indices:
            an = get_ammo_name(ai).upper()
            if "9PB" in an or "45ACP" in an:
                print(f"[RIFLE AMMO BUG] Index {idx} ({name}): loads {an} (idx {ai})")

    # SMG (cat_code == 6) の監査
    elif cat_code == 6:
        # SMG なのにライフル弾 (.30-06や.303Brなど) をロードしている
        for ai in ammo_indices:
            an = get_ammo_name(ai).upper()
            if any(x in an for x in ["3006", "303BR", "7.92-5", "7.92-10G", "7.62-5", "7.62-10", "6.5-6", "7.35-6", "8M86"]):
                print(f"[SMG AMMO BUG] Index {idx} ({name}): loads {an} (idx {ai})")
                
        # バースト値がおかしい (例: 32773 のようなフラグ値)
        if burst > 100 or burst < 0:
            # 32773 = 0x8005 -> 5発バースト？
            real_burst = burst & 0x7FFF if burst > 0 else 0
            print(f"[SMG BURST FLAG] Index {idx} ({name}): raw_burst={burst} (masked: {real_burst})")

    # LMG / MMG (cat_code in (5, 7)) の監査
    elif cat_code in (5, 7):
        if burst > 100:
            real_burst = burst & 0x7FFF
            print(f"[MG BURST FLAG] Index {idx} ({name}): raw_burst={burst} (masked: {real_burst})")
            
        # 三脚や弾薬箱の適合チェック（CBE生の対応関係）
        # cbe_name_table から aux_compat や tripod などを照らし合わせる

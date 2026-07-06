import re
import json
from pathlib import Path

ROOT = Path("c:/Projects/squad_tactics")
STATS_DECODED_JSON = ROOT / "data" / "wpns_pl_stats_decoded.json"
NAME_TABLE_JSON = ROOT / "data" / "cbe_name_table.json"

# Master JS をパースして Python オブジェクトとして読み込むか、
# もしくは stats_decoded と cbe_name_table を分析する。
# wpns_pl_master.js を読み込んで怪しい部分を探す。
master_js_path = ROOT / "data" / "wpns_pl_master.js"
master_js_content = master_js_path.read_text(encoding="utf-8")

# 各行 pl_\d+ の定義を抽出する
pattern = re.compile(r'"(pl_\d+)":\s*({[^}]+})')
matches = pattern.findall(master_js_content)

print(f"Total weapon entries in master.js: {len(matches)}")

suspicious = []
for code, body_str in matches:
    # 簡易パース
    # 例: {attr:ATTR.WEAPON,name:"VG-1",rng:7,acc:85,acc_drop:3,dmg:76,cap:10,mag:6,ap:2,rld:1,wgt:3.8,type:"bullet",burst:2,overRangePenalty:10,desc:"小銃（PLマスタ雛形）。", ...}
    # name
    name_m = re.search(r'name:\s*"([^"]+)"', body_str)
    name = name_m.group(1) if name_m else ""
    
    # desc
    desc_m = re.search(r'desc:\s*"([^"]+)"', body_str)
    desc = desc_m.group(1) if desc_m else ""
    
    # plCategory
    cat_m = re.search(r'plCategory:\s*"([^"]+)"', body_str)
    plCategory = cat_m.group(1) if cat_m else ""
    
    # burst
    burst_m = re.search(r'burst:\s*(\d+)', body_str)
    burst = int(burst_m.group(1)) if burst_m else 0
    
    # acceptsAmmo
    ammo_m = re.search(r'acceptsAmmo:\s*\[([^\]]+)\]', body_str)
    acceptsAmmo = [int(x.strip()) for x in ammo_m.group(1).split(",")] if ammo_m and ammo_m.group(1).strip() else []
    
    # CBE index
    cbe_idx_m = re.search(r'cbeNameIndex:\s*(\d+)', body_str)
    cbe_idx = int(cbe_idx_m.group(1)) if cbe_idx_m else -1

    # 検証ロジック
    reasons = []
    
    # 1. 拳銃（Pistol, mod34, P08等）なのに小銃雛形で、burst=2、plCategory=rifle
    if re.search(r"pistol|rev|colt|s&w|c/96|luger|walther|mauser|bodeo|glisenti|beretta|unique|tt33|hsc|ppk|webley|nagan|tokarev|vis|cz|p08|p38|pp\b", name, re.I):
        if plCategory == "rifle" or burst > 1:
            reasons.append(f"Pistol with category '{plCategory}', burst {burst}")
            
    # 2. SMG なのに小銃雛形、あるいは弾薬が変
    if re.search(r"smg|sten|mp38|mp40|mp41|mp28|mp35|emp|potsdam|mab|mas38|ppd|ppsh|pps|zk383", name, re.I):
        if plCategory == "rifle":
            reasons.append("SMG classified as rifle")
            
    # 3. 信号弾や爆発物などの明らかにヘンテコな弾薬
    # 352: Very-1 (信号弾), 314: Messer (ナイフ), 305: StiGr24 (手榴弾)
    for a in acceptsAmmo:
        if a in (352, 314, 305, 304, 246, 245):
            # ただし、擲弾発射器や手榴弾そのものではない場合
            if not re.search(r"grenade|grd|very|leup|p42|kpf|stup|messer|byt|knf|launcher", name, re.I):
                reasons.append(f"Suspicious ammo {a} linked to non-grenade weapon")

    # 4. M3 SMG のような異常なバースト値
    if burst > 1000:
        reasons.append(f"Insane burst count: {burst}")

    if reasons:
        suspicious.append({
            "code": code,
            "cbe_idx": cbe_idx,
            "name": name,
            "plCategory": plCategory,
            "burst": burst,
            "ammo": acceptsAmmo,
            "reasons": reasons
        })

print(f"\nFound {len(suspicious)} suspicious weapon configurations:")
for s in suspicious:
    print(f"Index {s['cbe_idx']} ({s['code']}) [{s['name']}]:")
    print(f"  Category: {s['plCategory']}, Burst: {s['burst']}, Ammo: {s['ammo']}")
    print(f"  Reasons: {', '.join(s['reasons'])}")

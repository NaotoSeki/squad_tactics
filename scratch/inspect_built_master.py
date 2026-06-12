import re
from pathlib import Path

ROOT = Path("c:/Projects/squad_tactics")
master_js_path = ROOT / "data" / "wpns_pl_master.js"
master_js_content = master_js_path.read_text(encoding="utf-8")

# 各行の定義 pl_\d+ を抽出
pattern = re.compile(r'"(pl_\d+)":\s*({[^}]+(plCompat:\s*{[^}]+})?[^}]+})')
# 注: 入れ子オブジェクトを正しくマッチさせるため、正規表現ではなく簡易的な文字列スキャンで行う

entries = {}
# master.js の `window.WPNS = {` から `};` までのデータをパースする
block_match = re.search(r'window\.WPNS\s*=\s*\{(.+?)\};', master_js_content, re.S)
if block_match:
    block = block_match.group(1)
    # pl_\d+ 行を個別にスキャン
    lines = block.split("\n")
    for line in lines:
        line = line.strip()
        if not line.startswith('"pl_'):
            continue
        code_match = re.match(r'"(pl_\d+)":\s*({.+}),?\s*$', line)
        if code_match:
            code = code_match.group(1)
            body = code_match.group(2)
            entries[code] = body

# 対象武器のテスト
target_codes = ["pl_3", "pl_18", "pl_19", "pl_23", "pl_24", "pl_50", "pl_62", "pl_63", "pl_127", "pl_130", "pl_160", "pl_164"]

print("=== VERIFYING GENERATED MASTER.JS VALUES ===")
for tc in target_codes:
    if tc in entries:
        body = entries[tc]
        # name, burst, plCategory, acceptsAmmo
        name_m = re.search(r'name:\s*"([^"]+)"', body)
        name = name_m.group(1) if name_m else "N/A"
        
        burst_m = re.search(r'burst:\s*(\d+)', body)
        burst = burst_m.group(1) if burst_m else "N/A"
        
        cat_m = re.search(r'plCategory:\s*"([^"]+)"', body)
        cat = cat_m.group(1) if cat_m else "N/A"
        
        ammo_m = re.search(r'acceptsAmmo:\s*\[([^\]]+)\]', body)
        ammo = ammo_m.group(1) if ammo_m else "N/A"
        
        print(f"Code {tc} ({name}):")
        print(f"  Category: {cat}")
        print(f"  Burst: {burst}")
        print(f"  Accepts Ammo: [{ammo}]")
    else:
        print(f"Code {tc} not found in master.js")

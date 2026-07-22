import os
import json

base_dir = r"c:\Projects\squad_tactics\scratch\ps_sprites"
out_js = r"c:\Projects\squad_tactics\scratch\sprite_db.js"

db = []

for root, dirs, files in os.walk(base_dir):
    for f in files:
        if f.endswith('.png'):
            full_path = os.path.join(root, f)
            rel_path = os.path.relpath(full_path, base_dir)
            # category is the parent folders
            parts = rel_path.split(os.sep)
            category = "Uncategorized"
            if len(parts) > 1:
                category = "/".join(parts[:-1])
            
            db.append({
                "category": category,
                "file": f,
                "path": "ps_sprites/" + rel_path.replace('\\', '/')
            })

with open(out_js, 'w', encoding='utf-8') as f:
    f.write("window.SPRITE_DB = " + json.dumps(db, separators=(',', ':')) + ";")

print(f"Exported {len(db)} sprites to sprite_db.js")

"""Show key extracted strings from the COM/ADM DLL analysis JSON."""
import json
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

with open(r"c:\Projects\squad_tactics\scripts\pl_decoded\com_dll_analysis.json", "r", encoding="utf-8") as f:
    data = json.load(f)

com = data["COM_DLL"]
adm = data["ADM_DLL"]

print("=" * 80)
print("COM.DLL - KEY STRINGS FROM DATA SEGMENTS")
print("=" * 80)

print("\n--- NE Header ---")
for k, v in com["ne_header"].items():
    print(f"  {k}: {v}")

print("\n--- Segments ---")
for s in com["segments"]:
    print(f"  #{s['index']} {s['type']:5s}  offset={s['file_offset']}  len={s['raw_length']:>6}  flags={s['flags']}  moveable={s['moveable']}")

print("\n--- Exported Names (Resident) ---")
for n in com.get("resident_names", []):
    print(f"  ord {n['ordinal']:>3}: {n['name']}")

print("\n--- Exported Names (Non-Resident) ---")
for n in com.get("nonresident_names", []):
    print(f"  ord {n['ordinal']:>3}: {n['name']}")

print("\n--- Imported Modules ---")
for m in com.get("imported_modules", []):
    print(f"  {m}")

categories_of_interest = ["unit_names", "weapon_names", "menu_text", "error_messages", "file_references", "format_strings"]

for cat in categories_of_interest:
    items = com["strings_by_category"].get(cat, {}).get("items", [])
    if not items:
        continue
    print(f"\n--- {cat} ({len(items)} strings) ---")
    for s in items:
        seg_info = f"seg{s.get('segment', '?')}"
        enc = s.get("encoding", "?")
        print(f"  [{s['offset']}] ({enc}, {seg_info}) {s['text'][:120]}")

# Show the most interesting Japanese strings (from DATA segments only)
print(f"\n--- misc_japanese from DATA segments ---")
jp_items = com["strings_by_category"].get("misc_japanese", {}).get("items", [])
data_jp = [s for s in jp_items if s.get("segment_type") == "DATA" or (isinstance(s.get("segment"), int) and s["segment"] >= 2)]
for s in data_jp[:100]:
    print(f"  [{s['offset']}] seg{s.get('segment','?')} {s['text'][:120]}")

# Show numeric tables
print(f"\n--- Numeric Tables ({len(com.get('numeric_tables', []))}) ---")
for t in com.get("numeric_tables", [])[:10]:
    print(f"  [{t['offset']}] type={t['type']} count={t['count']} range=[{t['min']}-{t['max']}]")
    print(f"    values: {t['values'][:20]}")

# Data tables
print(f"\n--- Structured Data Tables ({len(com.get('data_tables', []))}) ---")
for t in com.get("data_tables", []):
    print(f"  [{t['offset']}] rec_size={t['record_size']} x {t['estimated_count']} = {t['total_bytes']} bytes (seg{t.get('segment','?')})")
    for i, rec in enumerate(t.get("sample_records", [])[:4]):
        print(f"    [{i}] {rec}")

print("\n\n" + "=" * 80)
print("ADM.DLL - KEY STRINGS AND STRUCTURES")
print("=" * 80)

print("\n--- NE Header ---")
for k, v in adm["ne_header"].items():
    print(f"  {k}: {v}")

print("\n--- Segments ---")
for s in adm["segments"]:
    print(f"  #{s['index']} {s['type']:5s}  offset={s['file_offset']}  len={s['raw_length']:>6}  flags={s['flags']}")

print("\n--- Exported Names ---")
for n in adm.get("resident_names", [])[:20]:
    print(f"  ord {n['ordinal']:>3}: {n['name']}")
for n in adm.get("nonresident_names", [])[:20]:
    print(f"  ord {n['ordinal']:>3}: {n['name']}")

print("\n--- Imported Modules ---")
for m in adm.get("imported_modules", []):
    print(f"  {m}")

print(f"\n--- Palettes ({len(adm.get('palettes', []))}) ---")
for p in adm.get("palettes", [])[:10]:
    print(f"  [{p['offset']}] {p['format']} x{p['entry_count']} ({p['byte_size']} bytes, {p['unique_colors']} unique)")
    print(f"    first: {p['first_entries'][:4]}")

print(f"\n--- Data Tables ({len(adm.get('data_tables', []))}) ---")
for t in adm.get("data_tables", []):
    print(f"  [{t['offset']}] rec_size={t['record_size']} x {t['estimated_count']} = {t['total_bytes']} bytes")
    for i, rec in enumerate(t.get("sample_records", [])[:4]):
        print(f"    [{i}] {rec}")

# Resources
print("\n--- Resources ---")
for r in adm.get("resources", []):
    print(f"  {r['type_name']} x{r['count']}")
    for e in r["entries"][:5]:
        print(f"    {e['name']}  offset={e['offset']}  len={e['length']}")

# Cross-references
print("\n\n" + "=" * 80)
print("CROSS-REFERENCES")
print("=" * 80)
xr = data.get("cross_references", {})
print(f"\nShared strings: {xr.get('shared_strings', [])}")
print(f"\nHypotheses:")
for h in xr.get("hypotheses", []):
    print(f"  - {h}")

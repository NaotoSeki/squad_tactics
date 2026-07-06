import json, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

d = json.load(open(r'c:\Projects\squad_tactics\scripts\pl_decoded\mission_structure.json', 'r', encoding='utf-8'))

inv = d['mission_inventory']
print(f"Total missions: {len(inv)}")
print(f"Sections in JSON: {list(d.keys())}")
print()

for map_id in ['MAP00', 'MAP07', 'MAP14', 'MAP32']:
    m = inv[map_id]['0_0']
    units = m.get('units', [])
    print(f"\n{map_id}: {m['size_bytes']} bytes, {m['unit_count']} units, {len(units)} parsed")
    print(f"  Map: {m['map_bitmap_ref']}")
    print(f"  Hex grid: {m.get('hex_grid_records', 'N/A')} records, {m.get('hex_grid_non_empty', 'N/A')} non-empty")
    if 'file_structure_offsets' in m:
        for k, v in m['file_structure_offsets'].items():
            print(f"  {k}: {v}")
    for u in units[:10]:
        print(f"    [A={u['field_a']:2d} B={u['field_b']:2d} C={u['field_c']:2d}] {u['designation']:12s} {u['full_name'][:40]}")

print(f"\n\nMap cross-reference:")
for bmp, info in d['map_name_cross_reference'].items():
    print(f"  {bmp}: {info['missions']} -> DMAP={info['dmap_file']}, WMAP={info['wmap_file']}")

print(f"\nTDD files:")
for name, info in d['tdd_tile_data_analysis'].items():
    print(f"  {name}: {info['original_size']} bytes - {info['description']}")

print(f"\nStatistics:")
print(json.dumps(d['statistics'], indent=2))

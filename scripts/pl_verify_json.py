"""Verify the final vehicle_specs.json output."""
import json

data = json.load(open(r"c:\Projects\squad_tactics\scripts\pl_decoded\vehicle_specs.json", encoding="utf-8"))
print("Top-level keys:", list(data.keys()))
print("Vehicles:", len(data["vehicles"]))
print()

for v in data["vehicles"]:
    vid = v["id"]
    if vid in ("M4A3", "PZKW6E", "JGDPZ6", "SPW234", "GMC_15T"):
        print(f"{vid} ({v['name_jp']}):")
        print(f"  type: {v['type']}, side: {v['side']}")
        if "raw_bytes" in v:
            print(f"  stats: {v['stats']}")
            print(f"  offset: {v['data_offset'].get('stat_record_cbe', 'N/A')}")
        else:
            note = v["stats"].get("_note", "no note")
            print(f"  stats: {note[:80]}")
        print()

print("Analysis stat_table info:")
st = data["analysis_notes"]["stat_table"]
for k, val in st.items():
    print(f"  {k}: {val}")

print()
print("Field hypotheses:")
for k, val in data["analysis_notes"]["field_hypotheses"].items():
    print(f"  {k}: {val[:60]}...")

print()
with_recs = sum(1 for v in data["vehicles"] if "raw_bytes" in v)
print(f"Vehicles with binary stat records: {with_recs}/45")
print(f"File size: {len(json.dumps(data)):,} chars")

"""
Final extraction: compile all found vehicle data from CBE.EXE into JSON.
Includes Segment 137 stat records (37 vehicles with 36-byte records).
"""
import struct
import json
import os

EXE_PATH = r"D:\PL\CBE.EXE"
PL_PATH = r"D:\PL\PL.EXE"
OUTPUT_PATH = r"c:\Projects\squad_tactics\scripts\pl_decoded\vehicle_specs.json"

VEHICLES = [
    {"id": "M3LT",    "idx": 0,  "side": "US",  "type": "light_tank",     "gun_cal": 37,  "hist_front": 44,  "hist_side": 25},
    {"id": "M5LT",    "idx": 1,  "side": "US",  "type": "light_tank",     "gun_cal": 37,  "hist_front": 44,  "hist_side": 28},
    {"id": "M8",      "idx": 2,  "side": "US",  "type": "armored_car",    "gun_cal": 37,  "hist_front": 25,  "hist_side": 12},
    {"id": "M3MT",    "idx": 3,  "side": "US",  "type": "medium_tank",    "gun_cal": 37,  "hist_front": 51,  "hist_side": 38},
    {"id": "M4MT",    "idx": 4,  "side": "US",  "type": "medium_tank",    "gun_cal": 105, "hist_front": 51,  "hist_side": 38},
    {"id": "M4A1",    "idx": 5,  "side": "US",  "type": "medium_tank",    "gun_cal": 75,  "hist_front": 51,  "hist_side": 38},
    {"id": "M4A3",    "idx": 6,  "side": "US",  "type": "medium_tank",    "gun_cal": 75,  "hist_front": 63,  "hist_side": 38},
    {"id": "M4A3E8",  "idx": 7,  "side": "US",  "type": "medium_tank",    "gun_cal": 76,  "hist_front": 63,  "hist_side": 38},
    {"id": "M4A3E2",  "idx": 8,  "side": "US",  "type": "assault_tank",   "gun_cal": 75,  "hist_front": 101, "hist_side": 76},
    {"id": "M26",     "idx": 9,  "side": "US",  "type": "heavy_tank",     "gun_cal": 90,  "hist_front": 101, "hist_side": 76},
    {"id": "M10",     "idx": 10, "side": "US",  "type": "tank_destroyer",  "gun_cal": 76,  "hist_front": 51,  "hist_side": 25},
    {"id": "M36",     "idx": 11, "side": "US",  "type": "tank_destroyer",  "gun_cal": 90,  "hist_front": 51,  "hist_side": 25},
    {"id": "M3_GMC",  "idx": 12, "side": "US",  "type": "gun_motor_carriage","gun_cal": 75,"hist_front": 13,  "hist_side": 6},
    {"id": "M3_HT1",  "idx": 13, "side": "US",  "type": "halftrack",      "gun_cal": 0,   "hist_front": 13,  "hist_side": 6},
    {"id": "GMC_15T", "idx": 14, "side": "US",  "type": "truck",          "gun_cal": 0,   "hist_front": 0,   "hist_side": 0},
    {"id": "M1ATG",   "idx": 15, "side": "US",  "type": "anti_tank_gun",  "gun_cal": 57,  "hist_front": 0,   "hist_side": 0},
    {"id": "3INM5",   "idx": 16, "side": "US",  "type": "anti_tank_gun",  "gun_cal": 76,  "hist_front": 0,   "hist_side": 0},
    {"id": "PZKW2F",  "idx": 17, "side": "GER", "type": "light_tank",     "gun_cal": 20,  "hist_front": 35,  "hist_side": 15},
    {"id": "PZKW3J",  "idx": 18, "side": "GER", "type": "medium_tank",    "gun_cal": 50,  "hist_front": 50,  "hist_side": 30},
    {"id": "PZKW3L",  "idx": 19, "side": "GER", "type": "medium_tank",    "gun_cal": 50,  "hist_front": 57,  "hist_side": 30},
    {"id": "PZKW3N",  "idx": 20, "side": "GER", "type": "medium_tank",    "gun_cal": 75,  "hist_front": 57,  "hist_side": 30},
    {"id": "PZKW4F",  "idx": 21, "side": "GER", "type": "medium_tank",    "gun_cal": 75,  "hist_front": 50,  "hist_side": 30},
    {"id": "PZKW4G",  "idx": 22, "side": "GER", "type": "medium_tank",    "gun_cal": 75,  "hist_front": 80,  "hist_side": 30},
    {"id": "PZKW4H",  "idx": 23, "side": "GER", "type": "medium_tank",    "gun_cal": 75,  "hist_front": 80,  "hist_side": 30},
    {"id": "PZKW5D",  "idx": 24, "side": "GER", "type": "medium_tank",    "gun_cal": 75,  "hist_front": 80,  "hist_side": 40},
    {"id": "PZKW5A",  "idx": 25, "side": "GER", "type": "medium_tank",    "gun_cal": 75,  "hist_front": 80,  "hist_side": 50},
    {"id": "PZKW5G",  "idx": 26, "side": "GER", "type": "medium_tank",    "gun_cal": 75,  "hist_front": 80,  "hist_side": 50},
    {"id": "PZKW6E",  "idx": 27, "side": "GER", "type": "heavy_tank",     "gun_cal": 88,  "hist_front": 100, "hist_side": 80},
    {"id": "PZKW6B",  "idx": 28, "side": "GER", "type": "heavy_tank",     "gun_cal": 88,  "hist_front": 150, "hist_side": 80},
    {"id": "STG3F",   "idx": 29, "side": "GER", "type": "assault_gun",    "gun_cal": 75,  "hist_front": 50,  "hist_side": 30},
    {"id": "STG3F8",  "idx": 30, "side": "GER", "type": "assault_gun",    "gun_cal": 75,  "hist_front": 80,  "hist_side": 30},
    {"id": "STG3G",   "idx": 31, "side": "GER", "type": "assault_gun",    "gun_cal": 75,  "hist_front": 80,  "hist_side": 30},
    {"id": "STUH42",  "idx": 32, "side": "GER", "type": "assault_gun",    "gun_cal": 105, "hist_front": 80,  "hist_side": 30},
    {"id": "STPZ4",   "idx": 33, "side": "GER", "type": "assault_gun",    "gun_cal": 150, "hist_front": 100, "hist_side": 40},
    {"id": "MARDER2", "idx": 34, "side": "GER", "type": "tank_destroyer",  "gun_cal": 75,  "hist_front": 30,  "hist_side": 14},
    {"id": "JGDPZ6",  "idx": 35, "side": "GER", "type": "tank_destroyer",  "gun_cal": 128, "hist_front": 200, "hist_side": 80},
    {"id": "SPW251",  "idx": 36, "side": "GER", "type": "halftrack",      "gun_cal": 0,   "hist_front": 14,  "hist_side": 8},
    {"id": "SPW234",  "idx": 37, "side": "GER", "type": "armored_car",    "gun_cal": 50,  "hist_front": 30,  "hist_side": 8},
    {"id": "OPEL_BT", "idx": 38, "side": "GER", "type": "truck",          "gun_cal": 0,   "hist_front": 0,   "hist_side": 0},
    {"id": "PAK40",   "idx": 39, "side": "GER", "type": "anti_tank_gun",  "gun_cal": 75,  "hist_front": 0,   "hist_side": 0},
    {"id": "FLAK36",  "idx": 40, "side": "GER", "type": "anti_aircraft",  "gun_cal": 88,  "hist_front": 0,   "hist_side": 0},
    {"id": "L5_30",   "idx": 41, "side": "GER", "type": "light_tank",     "gun_cal": 37,  "hist_front": 15,  "hist_side": 13},
    {"id": "FT17",    "idx": 42, "side": "GER", "type": "light_tank",     "gun_cal": 37,  "hist_front": 22,  "hist_side": 16},
    {"id": "STG3GL",  "idx": 43, "side": "GER", "type": "assault_gun",    "gun_cal": 75,  "hist_front": 80,  "hist_side": 30},
    {"id": "STUH42L", "idx": 44, "side": "GER", "type": "assault_gun",    "gun_cal": 105, "hist_front": 80,  "hist_side": 30},
]

DISPLAY_NAMES = {
    "M3LT": "M3 LT", "M5LT": "M5A1", "M8": "M8 HMC", "M3MT": "M3 MT",
    "M4MT": "M4(105) MT", "M4A1": "M4A1 MT", "M4A3": "M4A3 MT",
    "M4A3E8": "M4A3(76) MT", "M4A3E2": "M4A3E2 AT", "M26": "M26 HT",
    "M10": "M10 GMC", "M36": "M36 GMC", "M3_GMC": "M3 GMC",
    "M3_HT1": "M3A1 HTPC", "GMC_15T": "GMC 2.5t", "M1ATG": "57mm M1 ATG",
    "3INM5": "3in M5 ATG",
    "PZKW2F": "PzKpfw 2 F", "PZKW3J": "PzKpfw 3 J", "PZKW3L": "PzKpfw 3 L",
    "PZKW3N": "PzKpfw 3 N", "PZKW4F": "PzKpfw 4 F1", "PZKW4G": "PzKpfw 4 G",
    "PZKW4H": "PzKpfw 4 H", "PZKW5D": "PzKpfw 5 D", "PZKW5A": "PzKpfw 5 A",
    "PZKW5G": "PzKpfw 5 G", "PZKW6E": "PzKpfw 6 E", "PZKW6B": "PzKpfw 6 B",
    "STG3F": "StuG 3 F", "STG3F8": "StuG 3 F/8", "STG3G": "StuG 3 G",
    "STUH42": "StuH 42", "STPZ4": "StuPz 4", "MARDER2": "PzJag 2",
    "JGDPZ6": "JgdPz 6", "SPW251": "SdKfz 251/1", "SPW234": "SdKfz 234/2",
    "OPEL_BT": "Opel6700A", "PAK40": "75mm PaK40", "FLAK36": "88mm FlaK36",
    "L5_30": "L5/30", "FT17": "FT17", "STG3GL": "StuG 3 G", "STUH42L": "StuH 42",
}

JP_NAMES = {
    "M3LT": "M3軽戦車", "M5LT": "M5A1軽戦車", "M8": "M8自走砲",
    "M3MT": "M3中戦車", "M4MT": "M4(105mm)中戦車", "M4A1": "M4A1中戦車",
    "M4A3": "M4A3シャーマン", "M4A3E8": "M4A3E8イージーエイト",
    "M4A3E2": "M4A3E2ジャンボ", "M26": "M26パーシング",
    "M10": "M10駆逐戦車", "M36": "M36駆逐戦車",
    "M3_GMC": "M3自走砲", "M3_HT1": "M3A1ハーフトラック",
    "GMC_15T": "GMC 2.5tトラック", "M1ATG": "57mm M1対戦車砲",
    "3INM5": "3インチ M5対戦車砲",
    "PZKW2F": "II号戦車F型", "PZKW3J": "III号戦車J型",
    "PZKW3L": "III号戦車L型", "PZKW3N": "III号戦車N型",
    "PZKW4F": "IV号戦車F1型", "PZKW4G": "IV号戦車G型",
    "PZKW4H": "IV号戦車H型",
    "PZKW5D": "パンターD型", "PZKW5A": "パンターA型",
    "PZKW5G": "パンターG型",
    "PZKW6E": "ティーガーE型", "PZKW6B": "ティーガーII型",
    "STG3F": "III号突撃砲F型", "STG3F8": "III号突撃砲F/8型",
    "STG3G": "III号突撃砲G型",
    "STUH42": "StuH42突撃榴弾砲", "STPZ4": "ブルムベア",
    "MARDER2": "マルダーII", "JGDPZ6": "ヤークトパンツァーVI",
    "SPW251": "Sd.Kfz.251装甲兵員輸送車", "SPW234": "Sd.Kfz.234プーマ",
    "OPEL_BT": "オペルブリッツ", "PAK40": "75mm PaK40対戦車砲",
    "FLAK36": "88mm FlaK36高射砲", "L5_30": "L5/30軽戦車",
    "FT17": "ルノーFT-17", "STG3GL": "III号突撃砲G型(後期)",
    "STUH42L": "StuH42突撃榴弾砲(後期)",
}

FIELD_NAMES = [
    "vehicle_index", "field_01", "field_02", "field_03", "field_04",
    "field_05", "field_06", "field_07", "field_08", "field_09",
    "field_10", "field_11", "field_12", "flag", "marker",
    "internal_id", "extra_1", "extra_2",
]

FIELD_HYPOTHESES = {
    "vehicle_index": "Sequential index (0-36), matches vehicle order in name table",
    "field_01": "Unknown (range 2-9). Possibly category/class or movement type",
    "field_02": "Unknown (range 1-16). Possibly max movement points or speed rating",
    "field_03": "Unknown (range 1-4). Possibly crew actions per turn or weapon count",
    "field_04": "Unknown (range 4-17). Possibly defensive rating or terrain adaptability",
    "field_05": "Unknown (range 23-99). Large variance - possibly cost, supply, or morale value",
    "field_06": "Unknown (range 5-45). Possibly fire range or accuracy modifier",
    "field_07": "Unknown (range 12-74). Possibly a combat stat (attack/defense)",
    "field_08": "Unknown (range 11-93). Possibly a combat stat or weight class",
    "field_09": "Unknown (range 0-6). Small values - possibly weapon slot count or special ability",
    "field_10": "Unknown (range 12-99). Possibly another combat modifier",
    "field_11": "Unknown (range 1-11). Possibly weapon type or sprite variant",
    "field_12": "Unknown (range 1-128). Usually 1-10; 128 for SPW251 (special flag?)",
    "flag": "Side/behavior flag: 0=default, 1=special_US, 2=towed_gun, 3=schurzen_equipped",
    "marker": "Record type: 0x8000=standard, 0x0000=late-war_variant, 0x4000=transport",
    "internal_id": "Sequential resource ID (704-740)",
    "extra_1": "Unknown (range 1-240). May reference sprite or sound resources",
    "extra_2": "Unknown (range 0-318). May reference additional resource data",
}


def extract_segment_137_records():
    """Extract 37 vehicle records from Segment 137 (36 bytes each)."""
    data = open(EXE_PATH, "rb").read()
    seg_start = 0x1E8580

    records = {}
    for i in range(37):  # IDs 704-740 confirmed
        off = seg_start + i * 36
        rec = data[off:off+36]
        u16s = [struct.unpack_from("<H", rec, j)[0] for j in range(0, 36, 2)]

        vid = VEHICLES[i]["id"]
        records[vid] = {
            "data_offset": f"0x{off:06X}",
            "record_size": 36,
            "raw_bytes": rec.hex(),
            "fields": {FIELD_NAMES[k]: u16s[k] for k in range(18)},
        }
    return records


def extract_remaining_data():
    """Extract the remaining 992 bytes after vehicle records in Segment 137."""
    data = open(EXE_PATH, "rb").read()
    seg_start = 0x1E8580
    rem_start = seg_start + 37 * 36  # After 37 records
    rem_end = seg_start + 2612
    rem_data = data[rem_start:rem_end]

    vals = [struct.unpack_from("<H", rem_data, i)[0] for i in range(0, len(rem_data) - 1, 2)]
    return {
        "offset": f"0x{rem_start:06X}",
        "size": len(rem_data),
        "raw_hex": rem_data[:256].hex(),
        "u16_values_sample": vals[:128],
        "description": "992 bytes following the 37 vehicle records. Contains pairs of "
                       "(value, type) where type is typically 2/4/8/16. May be a "
                       "penetration-vs-range table or combat modifier lookup.",
    }


def extract_data_regions():
    """Extract key data regions from CBE.EXE."""
    data = open(EXE_PATH, "rb").read()
    regions = {}

    names_data = data[0x20FD36:0x20FE53]
    regions["vehicle_name_table"] = {
        "offset": "0x20FD36",
        "size": len(names_data),
        "raw_hex": names_data.hex(),
        "description": "45 null-terminated ASCII vehicle ID strings",
    }

    regions["range_brackets"] = {
        "offset": "0x213050",
        "values_u16": [struct.unpack_from("<H", data, 0x213050 + i*2)[0]
                       for i in range((0x21307C - 0x213050) // 2)],
        "description": "Range brackets (360-3960m in 360m steps) with code pointers",
    }

    regions["combat_data_block"] = {
        "offset": "0x21307C",
        "raw_hex": data[0x21307C:0x2130F0].hex(),
        "values_u16": [struct.unpack_from("<H", data, 0x21307C + i*2)[0]
                       for i in range((0x2130F0 - 0x21307C) // 2)],
        "description": "Structured combat data: movement costs, penetration values "
                       "(120,200,250), possible armor values (51,71,91,40,47,41)",
    }

    weapons = []
    pos = 0x210570
    while pos < 0x210800:
        try:
            null = data.index(0, pos)
            s = data[pos:null].decode("ascii", errors="replace")
            if s and len(s) > 1:
                weapons.append(s)
            pos = null + 1
        except ValueError:
            break
    regions["small_arms_database"] = {
        "offset": "0x210570",
        "weapons": weapons,
        "description": "Infantry weapon names referenced by sound effect IDs",
    }

    return regions


def build_output():
    """Build the final JSON output."""
    print("Building vehicle database...")

    stat_records = extract_segment_137_records()
    remaining = extract_remaining_data()
    data_regions = extract_data_regions()

    vehicles_out = []
    for v in VEHICLES:
        vid = v["id"]
        entry = {
            "id": vid,
            "name_en": DISPLAY_NAMES.get(vid, vid),
            "name_jp": JP_NAMES.get(vid, ""),
            "side": v["side"],
            "type": v["type"],
            "table_index": v["idx"],
            "historical_reference": {
                "gun_caliber_mm": v["gun_cal"],
                "armor_front_mm": v["hist_front"],
                "armor_side_mm": v["hist_side"],
            },
            "data_offset": {
                "name_table_cbe": "0x20FD36",
                "name_2x_cbe": "0x20FEF2",
                "name_display_pl": "0x07A650",
            },
        }

        if vid in stat_records:
            rec = stat_records[vid]
            entry["stats"] = rec["fields"]
            entry["data_offset"]["stat_record_cbe"] = rec["data_offset"]
            entry["raw_bytes"] = rec["raw_bytes"]
        else:
            entry["stats"] = {
                "_note": "Record not found in Segment 137 (IDs 741-748 missing). "
                         "May be in a different data segment or computed at runtime.",
            }

        vehicles_out.append(entry)

    output = {
        "_metadata": {
            "game": "Platoon Leader (プラトーンリーダー)",
            "developer": "TechnoBrain",
            "publisher": "SEGA",
            "year": 1997,
            "platform": "Windows 3.1/95 (16-bit NE executable)",
            "source_file": "D:\\PL\\CBE.EXE",
            "source_size": os.path.getsize(EXE_PATH),
            "extraction_date": "2026-04-25",
        },
        "analysis_notes": {
            "executable_format": "NE (New Executable) 16-bit Windows",
            "segments": "157 segments (8 CODE + 149 DATA)",
            "stat_table": {
                "location": "Segment 137, file offset 0x1E8580",
                "segment_size": 2612,
                "record_size": 36,
                "record_count": 37,
                "record_format": "18 x u16 little-endian fields per record",
                "id_range": "704-740 (sequential, confirmed by 0x8000/0x0000 delimiters)",
                "coverage": "37 of 45 vehicles (M3LT through SPW251)",
                "missing_vehicles": ["SPW234", "OPEL_BT", "PAK40", "FLAK36",
                                     "L5_30", "FT17", "STG3GL", "STUH42L"],
                "missing_note": "IDs 741-748 not found in Segment 137. These 8 vehicles "
                                "may have data in another segment or may be dynamically "
                                "generated variants of existing vehicles.",
            },
            "field_hypotheses": FIELD_HYPOTHESES,
            "vehicle_name_table": {
                "location": "Segment 157, file offset 0x20FD36",
                "count": 45,
                "format": "Null-terminated ASCII strings, consecutive",
            },
            "vehicle_name_table_2x": {
                "location": "Segment 157, file offset 0x20FEF2",
                "count": 49,
                "format": "'2' prefixed vehicle IDs for double-size sprites",
            },
            "display_names_pl_exe": {
                "location": "PL.EXE file offset 0x7A650",
                "format": "Null-terminated ASCII with type codes (MT/LT/HT/GMC/AT/HTPC)",
            },
            "japanese_names_pl_exe": {
                "location": "PL.EXE file offset 0x7A500",
                "format": "Shift-JIS encoded Japanese vehicle names",
            },
            "weapons_database": {
                "location": "Segment 157, file offset 0x210570",
                "entries": "~115 weapon entries with sound mappings",
            },
            "code_reference": {
                "mov_cx_45": "Code Segment 4 at +0x3437: MOV CX, 0x002D (loads vehicle count 45 for loop)",
            },
        },
        "vehicles": vehicles_out,
        "raw_data_regions": data_regions,
        "segment_137_remaining": remaining,
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\nOutput written to {OUTPUT_PATH}")
    print(f"Total vehicles: {len(vehicles_out)}")
    print(f"Vehicles with stat records: {sum(1 for v in vehicles_out if 'raw_bytes' in v)}")
    return output


if __name__ == "__main__":
    build_output()

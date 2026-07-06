"""Generate a clean summary of COM.DLL/ADM.DLL analysis."""
import json
import sys

out = open(r"c:\Projects\squad_tactics\scripts\pl_decoded\analysis_summary.txt", "w", encoding="utf-8")

with open(r"c:\Projects\squad_tactics\scripts\pl_decoded\com_dll_analysis.json", "r", encoding="utf-8") as f:
    data = json.load(f)

com = data["COM_DLL"]
adm = data["ADM_DLL"]

def p(s=""):
    out.write(s + "\n")

p("=" * 80)
p("Platoon Leader (1997 SEGA/TechnoBrain) - COM.DLL & ADM.DLL 解析レポート")
p("=" * 80)

p("\n■ COM.DLL (46.5 KB) - 共有データ・文字列ライブラリ")
p("-" * 60)
p(f"  フォーマット: NE (16ビット New Executable)")
p(f"  NEヘッダオフセット: {com['ne_header']['ne_offset']}")
p(f"  フラグ: {com['ne_header']['flags']} ({', '.join(com['ne_header']['flag_names'])})")
p(f"  セグメント数: {com['ne_header']['segment_count']}")
p(f"  アライメントシフト: {com['ne_header']['segment_alignment_shift']}")
p(f"  モジュール名: {com['ne_header']['module_description']}")

p(f"\n  --- セグメント ---")
for s in com["segments"]:
    p(f"  #{s['index']} {s['type']:5s}  offset={s['file_offset']}  len={s['raw_length']:>6}")

p(f"\n  --- エクスポート関数 ---")
for n in com.get("resident_names", []):
    if n["ordinal"] > 0:
        p(f"  ord {n['ordinal']:>3}: {n['name']}")

p(f"\n  --- インポートモジュール ---")
for m in com.get("imported_modules", []):
    p(f"  {m}")

# Mission names
p(f"\n  === ミッション名 ===")
cats = com["strings_by_category"]
for cat_key in ["menu_text", "unit_names"]:
    items = cats[cat_key]["items"]
    mission_items = [s for s in items if "作戦" in s["text"] or "任務" in s["text"]]
    for s in mission_items:
        p(f"  [{s['offset']}] {s['text']}")

# Now extract fresh from binary for clean display
import struct
with open(r"D:\PL\COM.DLL", "rb") as f:
    bindata = f.read()

def sjis(offset, maxlen=200):
    end = offset
    while end < min(offset + maxlen, len(bindata)) and bindata[end] != 0:
        end += 1
    return bindata[offset:end].decode("cp932", errors="replace")

ne_off = struct.unpack_from("<I", bindata, 0x3C)[0]
ne_align = struct.unpack_from("<H", bindata, ne_off + 0x32)[0]

# Parse segment table
segs = []
seg_count = struct.unpack_from("<H", bindata, ne_off + 0x1C)[0]
seg_tab = ne_off + struct.unpack_from("<H", bindata, ne_off + 0x22)[0]
for i in range(seg_count):
    so = seg_tab + i * 8
    sector = struct.unpack_from("<H", bindata, so)[0]
    slen = struct.unpack_from("<H", bindata, so + 2)[0]
    sflags = struct.unpack_from("<H", bindata, so + 4)[0]
    segs.append((sector << ne_align, slen if slen else 65536, "DATA" if sflags & 1 else "CODE"))

# Read the pointer tables from DATA segments
p(f"\n  === データセグメント解析 ===")
p(f"  DATAセグメント2-6はすべて「文字列ポインタテーブル」")
p(f"  各レコード: 4バイト = [uint16 文字列オフセット, uint16 インデックス]")
p(f"  word1 = CODEセグメント内の文字列の先頭オフセット")
p(f"  word2 = 4ずつ増加するシーケンシャルインデックス")

# Decode proper strings from each segment table
seg_names = {
    1: "ミッション説明テキスト",
    2: "シナリオ名・ミッション詳細",
    3: "階級名・部隊名・武器名・弾薬名",
    4: "武器・弾薬・装備データ",
    5: "人名（兵士・将校名）",
}

for seg_idx in range(1, 6):
    real_idx = seg_idx + 1
    if real_idx > len(segs):
        break
    foff, slen, stype = segs[real_idx - 1]
    if stype != "DATA":
        continue
    
    p(f"\n  --- セグメント {real_idx}: {seg_names.get(seg_idx, '不明')} ---")
    p(f"  ファイルオフセット: 0x{foff:X}, サイズ: {slen} バイト, レコード数: {slen//4}")
    
    records = []
    for i in range(0, slen, 4):
        if foff + i + 4 > len(bindata):
            break
        w1 = struct.unpack_from("<H", bindata, foff + i)[0]
        w2 = struct.unpack_from("<H", bindata, foff + i + 2)[0]
        records.append((w1, w2))
    
    strings_shown = 0
    for i, (w1, w2) in enumerate(records):
        s = sjis(w1)
        if len(s) >= 2 and strings_shown < 60:
            p(f"    [{i:4d}] @0x{w1:04X} idx=0x{w2:04X}: {s}")
            strings_shown += 1
    p(f"  (全 {len(records)} レコード, 表示: {strings_shown})")

# Segment 7
foff7, slen7, stype7 = segs[6]
p(f"\n  --- セグメント 7: Cランタイムデータ ---")
p(f"  ファイルオフセット: 0x{foff7:X}, サイズ: {slen7} バイト")
p(f"  内容: Borland C++ ランタイムエラーメッセージ、初期化データ")
p(f"  マーカー: 'UBLFEB' (Borland C++ ランタイムシグネチャ)")

# Weapon database summary
p(f"\n  === 武器データベース ===")
p(f"  CODEセグメント内の0x3A9E〜0x4A56に大規模な武器データベースが格納:")

weapon_regions = [
    (0x3A9E, 0x3C1E, "アメリカ軍", "US"),
    (0x3C26, 0x3E64, "ドイツ軍", "DE"),
    (0x3E66, 0x3F56, "イタリア軍", "IT"),
    (0x3F56, 0x3FEE, "フランス軍", "FR"),
    (0x4002, 0x4114, "イギリス軍", "UK"),
    (0x4116, 0x418C, "ソ連軍", "SU"),
    (0x4194, 0x4240, "その他", "OTHER"),
]

for start, end_approx, country, code in weapon_regions:
    weapons = []
    off = start
    while off < min(end_approx + 200, len(bindata)):
        s = sjis(off)
        if len(s) < 2:
            off += 1
            continue
        weapons.append((off, s))
        off += len(s.encode("cp932", errors="replace")) + 1
        if off >= end_approx + 100:
            break
    
    p(f"\n  [{country}] {country} ({len(weapons)} 件)")
    for woff, wname in weapons[:30]:
        p(f"    [0x{woff:04X}] {wname}")
    if len(weapons) > 30:
        p(f"    ... 他 {len(weapons)-30} 件")

# Battle locations
p(f"\n  === 戦場名 ===")
loc_start = 0x0D90
loc_end = 0x0EF0
off = loc_start
locations = []
while off < loc_end:
    s = sjis(off)
    if len(s) >= 2:
        locations.append((off, s))
        off += len(s.encode("cp932", errors="replace")) + 1
    else:
        off += 1

for loff, lname in locations:
    p(f"  [0x{loff:04X}] {lname}")

# Dates
p(f"\n  === ミッション日付 ===")
date_start = 0x0EEE
off = date_start
dates = []
while off < 0x1056:
    s = sjis(off)
    if len(s) >= 4 and any(c.isdigit() for c in s):
        dates.append((off, s))
        off += len(s.encode("cp932", errors="replace")) + 1
    else:
        off += 1

for doff, dtext in dates:
    p(f"  [0x{doff:04X}] {dtext}")

# Rank names
p(f"\n  === 階級名 (日本語) ===")
rank_jp_area = [(0x1930, 0x1BC0)]
for rs, re in rank_jp_area:
    off = rs
    while off < re:
        s = sjis(off)
        if len(s) >= 2:
            p(f"  [0x{off:04X}] {s}")
            off += len(s.encode("cp932", errors="replace")) + 1
        else:
            off += 1

# English ranks
p(f"\n  === 階級名 (英語) ===")
off = 0x1BC2
while off < 0x1E60:
    s = sjis(off)
    if len(s) >= 2:
        p(f"  [0x{off:04X}] {s}")
        off += len(s.encode("cp932", errors="replace")) + 1
    else:
        off += 1

# ─────────── ADM.DLL ───────────
p(f"\n\n{'='*80}")
p("■ ADM.DLL (126 KB) - 管理データ・パレットライブラリ")
p("=" * 80)

p(f"\n  --- NEヘッダ ---")
for k, v in adm["ne_header"].items():
    p(f"  {k}: {v}")

p(f"\n  --- セグメント ---")
for s in adm["segments"]:
    p(f"  #{s['index']} {s['type']:5s}  offset={s['file_offset']}  len={s['raw_length']:>6}")

p(f"\n  --- エクスポート名 ---")
for n in adm.get("resident_names", []):
    p(f"  ord {n['ordinal']:>3}: {n['name']}")

p(f"\n  --- リソース ---")
for r in adm.get("resources", []):
    p(f"  {r['type_name']} x{r['count']}")
    for e in r["entries"]:
        p(f"    {e['name']}  offset={e['offset']}  len={e['length']}")

p(f"\n  --- パレットデータ ({len(adm.get('palettes', []))}) ---")
p(f"  DATAセグメント8 (0x11C00) の先頭にパレットデータが格納")
p(f"  256色パレット (RGB x 256 = 768バイト)")
for i, pal in enumerate(adm.get("palettes", [])[:5]):
    p(f"  パレット {i+1}: offset={pal['offset']}, format={pal['format']}, unique_colors={pal['unique_colors']}")

# Cross references
p(f"\n\n{'='*80}")
p("■ 相互参照・仮説")
p("=" * 80)
xr = data.get("cross_references", {})
p(f"\n共通文字列: {len(xr.get('shared_strings', []))} 件")
for h in xr.get("hypotheses", []):
    p(f"\n  仮説: {h}")

p(f"\n\n{'='*80}")
p("■ COM.DLL 構造仮説")
p("=" * 80)
p("""
COM.DLLの構造:

1. CODEセグメント (0x560, 32352バイト):
   - DLLのコード (API関数実装)
   - 埋め込み文字列データ (コード内にインライン配置):
     * 0x0D90-0x0EE6: 戦場名 (Arzew, Omaha, Hurtgen, Remagen等)
     * 0x0EEE-0x1050: ミッション日付 (WW2: 1942-1945)
     * 0x1056-0x14D0: ミッション名 (日本語)
     * 0x1930-0x1BC0: 階級名 (日本語)
     * 0x1BC2-0x1E60: 階級名 (英語/各国語)
     * 0x3A9E-0x4A56: 武器・弾薬名 (米/独/伊/仏/英/ソ)
     * 0x7DD0-0x80F0: 部隊名・シナリオ名

2. DATAセグメント2 (0x84C0, 444バイト = 111レコード):
   - 文字列ポインタテーブル (ミッション説明用)
   - フォーマット: [uint16 offset, uint16 index] x 111

3. DATAセグメント3 (0x86A0, 2560バイト = 640レコード):
   - 文字列ポインタテーブル (シナリオ詳細用)

4. DATAセグメント4 (0x90C0, 3656バイト = 914レコード):
   - 文字列ポインタテーブル (階級・部隊・武器名用)

5. DATAセグメント5 (0x9F40, 5936バイト = 1484レコード):
   - 文字列ポインタテーブル (武器・弾薬・装備用)

6. DATAセグメント6 (0xB6A0, 288バイト = 72レコード):
   - 文字列ポインタテーブル (人名用)

7. DATAセグメント7 (0xB7E0, 442バイト):
   - Borland C++ ランタイムデータ (エラーメッセージ)
   - 'UBLFEB' マーカー、Cランタイム初期化

エクスポート関数:
  - _DLLGET_UNIT_PTR: ユニットデータへのポインタ取得
  - _DLLGET_PLTN_PTR: 小隊データへのポインタ取得
  - _DLL_HELP: ヘルプテキスト取得
  - _DLLGET_SIDEFLG/_DLLSET_SIDEFLG: 陣営フラグ取得/設定
  - _DLL_SCRAMBLEDATA/_DLL_DESCRAMBLEDATA: セーブデータ暗号化/復号
  - _DLLGET_MANNAMEJ_PTR: 兵士名(日本語)ポインタ取得
  - _DLLGET_SQUADNAMEJ_PTR: 部隊名(日本語)ポインタ取得
  - _DLLGET_INSGNAMEJ_PTR: 記章名(日本語)ポインタ取得
  - _DLLSET_SCNRINDEX/_DLLGET_SCNRINDEX: シナリオインデックス設定/取得
  - _DLLGET_ITEMNAME_PTR/_DLLGET_ITEMNAMEJ_PTR: アイテム名取得
  - _DLLGET_MAPDATE_PTR: マップ日付取得
  - _DLLGET_MAPTITLE_PTR: マップタイトル取得
  - _DLLGET_MAPNAME_PTR: マップ名取得
  - _DLLSET_MAXTURN/_DLLGET_MAXTURN: 最大ターン数設定/取得
  - _DLLGET_TASK/_DLLSET_TASK: タスク取得/設定
  - _DLL_IS256COLOR: 256色モード判定
  - _DLL_ISWIN95: Win95判定
  - _DLL_CONTINUEDATAPEEP: セーブデータ確認
  - _DLL_CHECKVERSIONANDSUM/_DLL_SETVERSIONANDSUM: バージョン・チェックサム
  - _DLLSET_CBESTATUS/_DLLGET_CBESTATUS: 戦闘状態設定/取得
""")

out.close()
print(f"Summary written to analysis_summary.txt")

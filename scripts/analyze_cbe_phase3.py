"""
Phase 3: Deep game-mechanics extraction from CBE.EXE.

Builds on Phase 1 (NE resource parsing) and Phase 2 (name tables).
Adds:
  - Correct Shift-JIS re-extraction of ALL RT_STRING resources
  - Deep scan of ALL data segments for structured game tables
  - AP cost / movement cost / combat modifier table detection
  - Terrain type definition heuristics
  - Command dispatch table pattern matching in code segments
  - Byte-level struct-array detection with multiple record sizes
  - Full consolidation into a single cbe_analysis.json

Output: c:/Projects/squad_tactics/scripts/pl_decoded/cbe_analysis.json
"""

import struct, json, re, os, sys, io
from pathlib import Path
from collections import OrderedDict

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

CBE_PATH  = Path(r"D:\PL\CBE.EXE")
OUT_DIR   = Path(r"c:\Projects\squad_tactics\scripts\pl_decoded")
OUT_JSON  = OUT_DIR / "cbe_analysis.json"

# ── Primitive readers ─────────────────────────────────────────────────────────

def u8(d, o):  return d[o] if o < len(d) else 0
def u16(d, o): return struct.unpack_from('<H', d, o)[0] if o+2 <= len(d) else 0
def s16(d, o): return struct.unpack_from('<h', d, o)[0] if o+2 <= len(d) else 0
def u32(d, o): return struct.unpack_from('<I', d, o)[0] if o+4 <= len(d) else 0

def sjis(raw):
    for enc in ('cp932', 'shift_jis', 'latin-1'):
        try:    return raw.decode(enc)
        except: pass
    return raw.decode('latin-1', errors='replace')

def read_pascal(d, o):
    if o >= len(d): return ""
    n = d[o]
    return d[o+1:o+1+n].decode('ascii', errors='replace') if n else ""

def read_cstr(d, pos):
    start = pos
    while pos < len(d) and d[pos] != 0:
        b = d[pos]
        if (0x81 <= b <= 0x9F or 0xE0 <= b <= 0xFC) and pos+1 < len(d):
            pos += 2
        else:
            pos += 1
    return sjis(d[start:pos]), pos + 1 - start

# ── NE header / resource table ───────────────────────────────────────────────

NE_RT = {
    0x8001:"RT_CURSOR", 0x8002:"RT_BITMAP", 0x8003:"RT_ICON",
    0x8004:"RT_MENU",   0x8005:"RT_DIALOG", 0x8006:"RT_STRING",
    0x8007:"RT_FONTDIR", 0x8008:"RT_FONT",  0x8009:"RT_ACCELERATOR",
    0x800A:"RT_RCDATA", 0x800C:"RT_GROUP_CURSOR", 0x800E:"RT_GROUP_ICON",
    0x8010:"RT_VERSION",
}

DLGCTRL = {0x80:"BUTTON",0x81:"EDIT",0x82:"STATIC",
            0x83:"LISTBOX",0x84:"SCROLLBAR",0x85:"COMBOBOX"}

def parse_ne(data):
    assert data[:2] == b'MZ'
    ne_off = u32(data, 0x3C)
    assert data[ne_off:ne_off+2] == b'NE'
    ne = data[ne_off:]

    info = dict(
        ne_offset       = ne_off,
        linker_version  = f"{ne[2]}.{ne[3]}",
        entry_table_off = u16(ne,0x04), entry_table_len = u16(ne,0x06),
        flags           = u16(ne,0x0C), auto_data_seg   = u16(ne,0x0E),
        heap_size       = u16(ne,0x10), stack_size      = u16(ne,0x12),
        cs_ip=u32(ne,0x14), ss_sp=u32(ne,0x18),
        seg_count       = u16(ne,0x1C), mod_ref_count   = u16(ne,0x1E),
        nr_name_size    = u16(ne,0x20), seg_table_off   = u16(ne,0x22),
        res_table_off   = u16(ne,0x24), res_name_off    = u16(ne,0x26),
        mod_ref_off     = u16(ne,0x28), imp_name_off    = u16(ne,0x2A),
        nr_name_table   = u32(ne,0x2C), move_entry_cnt  = u16(ne,0x30),
        align_shift     = u16(ne,0x32), target_os       = ne[0x36] if len(ne)>0x36 else 0,
    )

    # Segments
    sa = ne_off + info['seg_table_off']
    segs = []
    for i in range(info['seg_count']):
        o = sa + i*8
        raw_off = u16(data,o); slen = u16(data,o+2)
        sf = u16(data,o+4); sa2 = u16(data,o+6)
        real_off = raw_off << info['align_shift']
        real_len = slen if slen else 65536
        segs.append(dict(
            index=i+1, offset=real_off, length=real_len,
            flags=sf, alloc=sa2 if sa2 else 65536,
            is_data=bool(sf&1),
        ))
    info['segments'] = segs

    # Resource table
    rt_abs = ne_off + info['res_table_off']
    ashift = u16(data, rt_abs)
    info['res_align_shift'] = ashift
    pos = rt_abs + 2
    rtypes = []
    while pos+8 <= len(data):
        tid = u16(data, pos)
        if tid == 0: break
        cnt = u16(data, pos+2); pos += 8
        tname = NE_RT.get(tid, f"RT_{tid:#06x}") if tid&0x8000 else read_pascal(data, rt_abs+tid)
        entries = []
        for _ in range(cnt):
            if pos+12 > len(data): break
            ro = u16(data,pos); rl = u16(data,pos+2)
            rf = u16(data,pos+4); rn = u16(data,pos+6)
            pos += 12
            ao = ro << ashift; al = rl << ashift
            nm = f"#{rn&0x7FFF}" if rn&0x8000 else read_pascal(data, rt_abs+rn)
            entries.append(dict(name=nm, name_id=rn, offset=ao, length=al, flags=rf))
        rtypes.append(dict(type_id=tid, type_name=tname, count=cnt, entries=entries))
    info['resource_types'] = rtypes
    return info

# ── RT_STRING ─────────────────────────────────────────────────────────────────

def extract_strings(data, hdr):
    strings = {}
    blocks = []
    for rt in hdr['resource_types']:
        if rt['type_id'] != 0x8006: continue
        for e in rt['entries']:
            bid = int(e['name'].replace('#','')) if e['name'].startswith('#') else 0
            base_id = (bid - 1) * 16
            off = e['offset']; end = off + e['length']
            if off >= len(data) or end > len(data): continue
            bd = data[off:end]; pos = 0; bstrs = []
            for i in range(16):
                if pos >= len(bd): break
                slen = bd[pos]; pos += 1
                if slen > 0 and pos+slen <= len(bd):
                    raw = bd[pos:pos+slen]
                    txt = sjis(raw)
                    sid = base_id + i
                    strings[sid] = txt
                    bstrs.append(dict(id=sid, text=txt, hex=raw.hex()))
                    pos += slen
                else:
                    pos += slen
            if bstrs:
                blocks.append(dict(block_id=bid, base_id=base_id,
                    res_name=e['name'], offset=hex(e['offset']),
                    length=e['length'], strings=bstrs))
    return strings, blocks

# ── RT_DIALOG ─────────────────────────────────────────────────────────────────

def parse_dialog(raw):
    if len(raw) < 13: return None
    style = u32(raw,0); nitems = u8(raw,4)
    x,y,cx,cy = u16(raw,5),u16(raw,7),u16(raw,9),u16(raw,11)
    pos = 13

    def _str():
        nonlocal pos
        if pos >= len(raw): return ""
        if raw[pos] == 0:   pos += 1; return ""
        if raw[pos] == 0xFF:
            v = u16(raw, pos+1) if pos+2 < len(raw) else 0
            pos += 3; return f"ordinal:{v}"
        t, n = read_cstr(raw, pos); pos += n; return t

    menu_s = _str(); class_s = _str(); caption = _str()
    font = None
    if style & 0x40 and pos+2 <= len(raw):
        fs = u16(raw, pos); pos += 2
        fn, n = read_cstr(raw, pos); pos += n
        font = dict(size=fs, name=fn)

    items = []
    for _ in range(nitems):
        if pos+14 > len(raw): break
        ix,iy,icx,icy = u16(raw,pos),u16(raw,pos+2),u16(raw,pos+4),u16(raw,pos+6)
        iid = u16(raw,pos+8); ist = u32(raw,pos+10); pos += 14
        if pos < len(raw):
            b = raw[pos]
            if 0x80 <= b <= 0x85: icls = DLGCTRL.get(b, f"cls_{b:#x}"); pos += 1
            else: icls, n = read_cstr(raw, pos); pos += n
        else: icls = ""
        if pos < len(raw):
            itxt, n = read_cstr(raw, pos); pos += n
        else: itxt = ""
        if pos < len(raw):
            cl = raw[pos]; pos += 1 + cl
        items.append(dict(x=ix,y=iy,cx=icx,cy=icy,id=iid,
                          style=f"{ist:#010x}", ctrl_class=icls, text=itxt))

    r = dict(style=f"{style:#010x}", item_count=nitems,
             x=x,y=y,cx=cx,cy=cy, menu=menu_s, dlg_class=class_s,
             caption=caption, items=items)
    if font: r['font'] = font
    return r

def extract_dialogs(data, hdr):
    out = []
    for rt in hdr['resource_types']:
        if rt['type_id'] != 0x8005: continue
        for e in rt['entries']:
            off = e['offset']; end = off+e['length']
            if off >= len(data) or end > len(data): continue
            p = parse_dialog(data[off:end])
            if p:
                p['resource_name'] = e['name']
                p['resource_offset'] = hex(off)
                p['resource_length'] = e['length']
                out.append(p)
    return out

# ── RT_MENU ───────────────────────────────────────────────────────────────────

def parse_menu_items(raw, pos, end):
    items = []
    while pos < end:
        if pos+2 > end: break
        fl = u16(raw, pos); pos += 2
        is_pop = bool(fl & 0x10); is_end = bool(fl & 0x80)
        mid = None
        if not is_pop:
            if pos+2 > end: break
            mid = u16(raw, pos); pos += 2
        txt, n = read_cstr(raw, pos); pos += n
        item = dict(text=txt, flags=f"{fl:#06x}")
        if mid is not None: item['id'] = mid
        if is_pop:
            sub, pos = parse_menu_items(raw, pos, end)
            item['submenu'] = sub
        items.append(item)
        if is_end: break
    return items, pos

def extract_menus(data, hdr):
    out = []
    for rt in hdr['resource_types']:
        if rt['type_id'] != 0x8004: continue
        for e in rt['entries']:
            off = e['offset']; end = off+e['length']
            if off >= len(data) or end > len(data): continue
            raw = data[off:end]
            if len(raw) < 4: continue
            ver = u16(raw,0); hs = u16(raw,2)
            items, _ = parse_menu_items(raw, 4+hs, len(raw))
            out.append(dict(resource_name=e['name'], resource_offset=hex(off),
                            resource_length=e['length'], version=ver, items=items))
    return out

# ── Name tables ───────────────────────────────────────────────────────────────

def extract_resident_names(data, ne_off, rn_off):
    pos = ne_off + rn_off; names = []
    while pos < len(data):
        n = data[pos]
        if n == 0: break
        nm = data[pos+1:pos+1+n].decode('ascii', errors='replace')
        ordinal = u16(data, pos+1+n)
        names.append(dict(name=nm, ordinal=ordinal))
        pos += 1 + n + 2
    return names

def extract_imported_names(data, ne_off, in_off):
    pos = ne_off + in_off; names = []; limit = min(len(data), pos+4096)
    while pos < limit:
        n = data[pos]
        if n == 0: pos += 1; continue
        names.append(data[pos+1:pos+1+n].decode('ascii', errors='replace'))
        pos += 1 + n
    return names

# ── Null-terminated string reader ─────────────────────────────────────────────

def read_cstrings(data, offset, max_count=2000):
    strings = []; pos = offset
    while pos < len(data) and len(strings) < max_count:
        end = data.find(b'\x00', pos)
        if end == -1 or end == pos: break
        raw = data[pos:end]
        if not all(0x20 <= b <= 0x7E or 0x80 <= b <= 0xFF for b in raw): break
        strings.append(sjis(raw))
        pos = end + 1
    return strings

# ── File reference scanning ───────────────────────────────────────────────────

def scan_file_refs(data, ext_bytes):
    results = []; pos = 0
    while True:
        idx = data.find(ext_bytes, pos)
        if idx == -1: break
        start = idx
        while start > 0 and 0x20 <= data[start-1] <= 0x7E:
            start -= 1
            if idx - start > 80: break
        if start < idx:
            nm = data[start:idx+len(ext_bytes)].decode('ascii', errors='replace')
            if len(nm) >= 3: results.append(dict(offset=hex(start), filename=nm))
        pos = idx + len(ext_bytes)
    return results

# ── Game data extractors (from Phase 2, refined) ─────────────────────────────

def extract_vehicle_names(data):
    marker = b'(end AFV)'
    idx = data.find(marker)
    if idx == -1: return dict(all_vehicles=[], count=0)
    start = idx + len(marker) + 1
    vehicles = read_cstrings(data, start, max_count=200)
    return dict(all_vehicles=vehicles, count=len(vehicles))

def extract_weapon_names(data):
    out = {}
    for label, pattern in [('us', b'M1911A1\x00M1917 S&W'),
                            ('german', b'PPK\x00HSc\x00P38'),
                            ('russian', b'PM1910\x00DShK')]:
        idx = data.find(pattern)
        out[label] = read_cstrings(data, idx, 300) if idx >= 0 else []
    return out

def extract_soldier_names(data):
    tables = []; pos = 0
    while True:
        idx = data.find(b'(EndName)', pos)
        if idx == -1: break
        start = idx + 10
        names = read_cstrings(data, start, max_count=1500)
        if len(names) > 10:
            tables.append(dict(offset=hex(idx), count=len(names), names=names))
        back = max(0, idx - 6000)
        bnames = read_cstrings(data, back, max_count=1500)
        if len(bnames) > len(names):
            bnames = [n for n in bnames if n != '(EndName)']
            if bnames:
                tables.append(dict(offset=hex(back), count=len(bnames), names=bnames))
        pos = idx + 9
    return tables

def extract_radio_messages(data):
    marker = b'US:...This is White Rook, over.'
    idx = data.find(marker)
    if idx == -1: return dict(messages=[], count=0)
    start = idx
    while start > 0:
        pn = data.rfind(b'\x00', 0, start)
        if pn == -1: break
        cand = data[pn+1:start]
        if len(cand) > 0 and all(0x20 <= b <= 0x7E for b in cand):
            start = pn + 1
        else:
            break
    msgs = read_cstrings(data, start, 500)
    return dict(count=len(msgs), messages=msgs)

def extract_command_system(data):
    r = {}
    for label, pat, cnt in [
        ('action_modes', b'Stay\x00Aslt\x00Move', 9),
        ('postures',     b'Stand\x00Kneel\x00Prone', 4),
    ]:
        idx = data.find(pat)
        if idx >= 0: r[label] = read_cstrings(data, idx, cnt)[:cnt]

    if data.find(b'JAM\x00BRK\x00') >= 0:
        r['weapon_states'] = ['JAM', 'BRK']
    if data.find(b'AXIS\x00ALLIES\x00') >= 0:
        r['sides'] = ['AXIS', 'ALLIES']

    idx = data.find(b'Dmg\x00LWA\x00WIA\x00HWA')
    if idx >= 0:
        scan = max(0, idx - 4)
        raw = read_cstrings(data, scan, 15)
        known = {'Dmg','LWA','WIA','HWA','CIA','KIA','MIA','AOL','DA','BCD','NEW',''}
        r['damage_states_en'] = [s.strip() for s in raw if s.strip() in known]

    idx_jp = data.find('カスリ傷'.encode('cp932'))
    if idx_jp >= 0:
        raw = read_cstrings(data, idx_jp, 12)
        r['damage_states_jp'] = raw

    idx = data.find(b'Med\x00Sig\x00Eng')
    if idx >= 0:
        scan = idx
        while scan > 0 and data[scan-1] != 0: scan -= 1
        specs = read_cstrings(data, scan, 5)
        r['specialist_types'] = [s for s in specs if s in ('Med','Sig','Eng','---','')]

    idx = data.find(b'PhE\x00Rfc')
    if idx >= 0:
        scan = max(0, idx - 8)
        raw = read_cstrings(data, scan, 20)
        phase_kw = {'PhE','Rfc','HtH','Spt','Bom','Flm','Turn','Phase'}
        r['phase_labels'] = [p.strip() for p in raw if p.strip() in phase_kw]

    vt_idx = data.find(b'Down \x00')
    if vt_idx >= 0:
        scan = vt_idx + 6
        vtypes = read_cstrings(data, scan, 25)
        jp = [v for v in vtypes if any(0x80 <= bb <= 0xFF for bb in v.encode('cp932', errors='ignore'))]
        if jp: r['vehicle_type_labels_jp'] = jp

    return r

def extract_tdd_models(data):
    out = {}
    for label, pat in [('infantry_models', b'MANSTY.TDD'),
                        ('explosion_models', b'2BOMGND.TDD'),
                        ('shot_models', b'2SHOTS.TDD'),
                        ('vehicle_hex_models', b'2VCHEX.TDD')]:
        idx = data.find(pat)
        if idx >= 0:
            out[label] = [m for m in read_cstrings(data, idx, 30) if '.TDD' in m]

    idx = data.find(b'M3LT\x00M5LT')
    if idx >= 0:
        scan = max(0, idx - 16)
        codes = [c for c in read_cstrings(data, scan, 100) if 2 <= len(c) <= 20]
        out['vehicle_codes_us'] = codes

    idx = data.find(b'2M3LT\x002M5LT')
    if idx >= 0:
        codes = [c for c in read_cstrings(data, idx, 100) if 2 <= len(c) <= 20]
        out['vehicle_codes_2prefix'] = codes

    return out

def extract_map_files(data):
    out = {}
    for label, pat, ext in [('plx_map_files', b'DMAP00.PLX', '.PLX'),
                             ('ipf_map_files', b'MAP00.IPF', '.IPF')]:
        idx = data.find(pat)
        if idx >= 0:
            out[label] = [f for f in read_cstrings(data, idx, 100) if ext in f]
        else:
            out[label] = []
    return out

def extract_events(data):
    idx = data.find(b'EVETAFAR\x00')
    if idx == -1: return []
    return [e for e in read_cstrings(data, idx, 50) if e.startswith('EV')]

def extract_sounds(data):
    results = set(); pos = 0
    while True:
        idx = data.find(b'.WAV', pos)
        if idx == -1: break
        start = idx
        while start > 0 and 0x20 <= data[start-1] <= 0x7E:
            start -= 1
            if idx - start > 50: break
        if start < idx:
            results.add(data[start:idx+4].decode('ascii', errors='replace'))
        pos = idx + 4
    return sorted(results)

def extract_format_strings(data):
    pats = [b'Hit: %3d', b'Prc: %3d', b'Wgt:', b'Rate %d%% Prc %d%%',
            b'Tn%2d/Ph%d', b'BF:%3d', b'Body:%d/%d', b'Amn',
            b'(X:%2d,Y:%2d)', b'AP=%d', b'Exp=%d', b'Morale=%d',
            b'AP:', b'MV:', b'Rng:', b'Acc:', b'Pen:', b'%d/%d',
            b'Dam:', b'Range:', b'Armr:']
    out = []
    for pat in pats:
        idx = data.find(pat)
        if idx >= 0:
            end = data.find(b'\x00', idx)
            if end >= 0 and end - idx < 200:
                out.append(dict(offset=hex(idx),
                    text=data[idx:end].decode('ascii', errors='replace')))
    return out

# ── Deep data segment analysis ────────────────────────────────────────────────

def scan_sjis_in_segment(data, off, length, min_len=3):
    seg = data[off:off+length]; results = []; pos = 0
    while pos < len(seg):
        start = pos; buf = bytearray(); has_jp = False; ok = True
        while pos < len(seg):
            b = seg[pos]
            if b == 0: break
            if (0x81 <= b <= 0x9F or 0xE0 <= b <= 0xFC) and pos+1 < len(seg):
                b2 = seg[pos+1]
                if 0x40 <= b2 <= 0xFC and b2 != 0x7F:
                    buf += bytes([b, b2]); has_jp = True; pos += 2; continue
                else: ok = False; break
            elif 0x20 <= b <= 0x7E or b in (0x0D, 0x0A):
                buf.append(b); pos += 1
            else: ok = False; break
        if ok and len(buf) >= min_len:
            results.append(dict(seg_off=start, abs_off=hex(off+start), text=sjis(bytes(buf)),
                                has_japanese=has_jp))
        pos = max(pos, start+1) if not ok or pos == start else pos
    return results

def scan_ascii_tables(data, off, length):
    seg = data[off:off+length]; tables = []; pos = 0; cur = []; tstart = 0
    while pos < len(seg):
        start = pos; s = bytearray()
        while pos < len(seg) and seg[pos] != 0:
            b = seg[pos]
            if 0x20 <= b <= 0x7E: s.append(b); pos += 1
            else: break
            if len(s) > 200: break
        if len(s) >= 3 and pos < len(seg) and seg[pos] == 0:
            if not cur: tstart = start
            cur.append(dict(off=start, text=s.decode('ascii', errors='replace')))
            pos += 1
        else:
            if len(cur) >= 3:
                tables.append(dict(seg_off=tstart, abs_off=hex(off+tstart),
                                   count=len(cur), entries=cur))
            cur = []; pos = start + 1
    if len(cur) >= 3:
        tables.append(dict(seg_off=tstart, abs_off=hex(off+tstart),
                           count=len(cur), entries=cur))
    return tables

# ── Structured numeric table detection ────────────────────────────────────────

def scan_struct_tables(data, off, length, label=""):
    """Detect arrays of fixed-size records with game-relevant values.
    Optimized: step by record_size to avoid redundant overlapping scans."""
    seg = data[off:off+length]
    results = []
    if length > 50000:
        return results

    for rec_sz in (4, 6, 8, 10, 12, 16, 20, 24):
        step = max(rec_sz // 2, 2)
        for start in range(0, len(seg) - rec_sz*4, step):
            recs = []
            for r in range(40):
                rs = start + r * rec_sz
                if rs + rec_sz > len(seg): break
                row = list(seg[rs:rs+rec_sz])
                if all(v == 0 for v in row): break
                if any(v > 200 for v in row): break
                recs.append(row)

            if len(recs) < 4: continue

            flat = [v for row in recs for v in row]
            uniq = len(set(flat))
            total = len(flat)
            if uniq < 2 or uniq/total > 0.85: continue

            max_val = max(flat)
            confidence = "low"
            if max_val <= 100 and len(recs) >= 6 and uniq >= 3:
                confidence = "high" if len(recs) >= 8 else "medium"
            elif max_val <= 200 and len(recs) >= 8 and 0.05 < uniq/total < 0.7:
                confidence = "medium"

            if confidence != "low":
                results.append(dict(
                    seg_off=start, abs_off=hex(off+start),
                    record_size=rec_sz, record_count=len(recs),
                    confidence=confidence,
                    value_range=[min(flat), max_val],
                    unique_values=uniq,
                    records=recs[:20],
                    segment_label=label,
                ))

    seen = set()
    deduped = []
    for r in sorted(results, key=lambda x: (-{'high':3,'medium':2,'low':1}[x['confidence']],
                                              -x['record_count'])):
        key = r['seg_off'] // 8
        if key not in seen:
            seen.add(key)
            deduped.append(r)
    return deduped[:20]


def scan_u16_tables(data, off, length):
    """Specifically scan for arrays of u16 values (AP costs, modifiers, etc.)."""
    seg = data[off:off+length]
    results = []
    if length > 50000:
        return results

    for start in range(0, len(seg) - 12, 2):
        vals = []
        for i in range(64):
            o = start + i*2
            if o+2 > len(seg): break
            v = struct.unpack_from('<H', seg, o)[0]
            if v == 0 or v >= 10000: break
            vals.append(v)

        if len(vals) >= 6 and len(set(vals)) >= 3:
            max_v = max(vals)
            is_ap_like = all(1 <= v <= 200 for v in vals)
            is_modifier = all(v <= 1000 for v in vals)

            if is_ap_like or (is_modifier and len(vals) >= 8):
                results.append(dict(
                    seg_off=start, abs_off=hex(off+start),
                    count=len(vals), values=vals[:32],
                    likely_type="ap_or_cost" if is_ap_like else "modifier_table",
                    max_value=max_v,
                ))

    seen = set()
    deduped = []
    for r in sorted(results, key=lambda x: -x['count']):
        key = r['seg_off'] // 8
        if key not in seen:
            seen.add(key)
            deduped.append(r)
    return deduped[:25]


# ── Terrain table heuristic ───────────────────────────────────────────────────

def detect_terrain_tables(data, segments):
    """
    Terrain cost tables: ~10-30 rows (terrain types) x 4-8 cols (unit categories).
    Values typically 1-10 for movement cost, 0-5 for defense.
    """
    candidates = []
    for seg in segments:
        if not seg['is_data']: continue
        off = seg['offset']; length = seg['length']
        if off == 0 or off + length > len(data) or length > 50000: continue
        sd = data[off:off+length]

        for cols in (4, 5, 6, 7, 8, 10, 12):
            for start in range(0, min(len(sd) - cols*5, len(sd))):
                rows = 0
                for r in range(40):
                    rs = start + r * cols
                    if rs + cols > len(sd): break
                    rv = list(sd[rs:rs+cols])
                    if all(0 <= v <= 99 for v in rv) and any(v > 0 for v in rv):
                        rows += 1
                    else:
                        break

                if 8 <= rows <= 35:
                    td = [list(sd[start+r*cols:start+r*cols+cols]) for r in range(rows)]
                    flat = [v for row in td for v in row]
                    ur = len(set(flat)) / max(len(flat), 1)
                    if 0.08 < ur < 0.85:
                        has_small_movement_costs = any(1 <= v <= 10 for v in flat)
                        candidates.append(dict(
                            segment=seg['index'], seg_off=start,
                            abs_off=hex(off+start), rows=rows, cols=cols,
                            data=td,
                            has_movement_costs=has_small_movement_costs,
                        ))
                        break
    seen = set()
    deduped = []
    for c in candidates:
        key = c['abs_off']
        if key not in seen:
            seen.add(key)
            deduped.append(c)
    return deduped[:25]

# ── Command dispatch table detection ──────────────────────────────────────────

def detect_dispatch_tables(data, segments):
    """
    Look for far-pointer arrays (seg:offset pairs) in DATA segments only.
    (Code segments are too large and dispatch tables live in data.)
    """
    results = []

    for seg in segments:
        if not seg['is_data']: continue
        off = seg['offset']; length = seg['length']
        if off == 0 or off + length > len(data) or length > 50000: continue
        sd = data[off:off+length]

        for start in range(0, len(sd) - 24, 4):
            ptrs = []
            ok = True
            for i in range(12):
                po = start + i*4
                if po+4 > len(sd): break
                ptr_off = u16(sd, po)
                ptr_seg = u16(sd, po+2)
                if 1 <= ptr_seg <= 20 and ptr_off > 0:
                    ptrs.append(dict(seg=ptr_seg, offset=ptr_off))
                else:
                    break

            if len(ptrs) >= 4:
                seg_nums = set(p['seg'] for p in ptrs)
                if len(seg_nums) <= 4:
                    results.append(dict(
                        type='far_ptr_table',
                        in_segment=seg['index'],
                        seg_off=start, abs_off=hex(off+start),
                        entry_count=len(ptrs), entries=ptrs,
                    ))

    seen = set()
    deduped = []
    for r in sorted(results, key=lambda x: -x['entry_count']):
        key = int(r['abs_off'], 16) // 16
        if key not in seen:
            seen.add(key)
            deduped.append(r)
    return deduped[:20]

# ── Categorize strings ────────────────────────────────────────────────────────

def categorize_strings(sdict):
    cats = dict(command_labels=[], unit_military=[], terrain_map=[],
                ui_messages=[], error_messages=[], game_mechanics=[],
                file_references=[], menu_labels=[], other=[])

    for sid, text in sorted(sdict.items()):
        tl = text.lower(); done = False
        for kw_list, cat in [
            (['移動','射撃','アイテム','パス','待機','姿勢','陣地','命令',
              'コマンド','攻撃','防御','偵察'], 'command_labels'),
            (['歩兵','戦車','車両','砲兵','部隊','分隊','小隊','中隊',
              '兵','師団','ユニット','士気','練度'], 'unit_military'),
            (['地形','森','林','草','道','川','橋','建物','市街','沼','山',
              'ヘクス','マップ','視線','射程'], 'terrain_map'),
            (['AP','HP','ポイント','ターン','命中','回避','装甲','貫通',
              'ダメージ','射程','距離'], 'game_mechanics'),
        ]:
            if any(k in text for k in kw_list):
                cats[cat].append(dict(id=sid, text=text))
                done = True; break
        if done: continue
        if any(ext in text for ext in ('.TDD','.BMP','.WAV','.DLL')):
            cats['file_references'].append(dict(id=sid, text=text))
        elif 'エラー' in text or 'error' in tl or '失敗' in text:
            cats['error_messages'].append(dict(id=sid, text=text))
        elif len(text) <= 20:
            cats['menu_labels'].append(dict(id=sid, text=text))
        elif len(text) > 5:
            cats['ui_messages'].append(dict(id=sid, text=text))
        else:
            cats['other'].append(dict(id=sid, text=text))
    return cats

# ── Comprehensive segment dump for all data segments ──────────────────────────

def deep_scan_all_data_segments(data, segments):
    """Run all scanners on every data segment, return consolidated results."""
    all_sjis = []; all_ascii = []; all_struct = []; all_u16 = []

    for seg in segments:
        if not seg['is_data']: continue
        off = seg['offset']; length = seg['length']
        if off == 0 or off + length > len(data): continue
        label = f"seg{seg['index']}_{hex(off)}"

        sj = scan_sjis_in_segment(data, off, length)
        for s in sj: s['segment'] = seg['index']
        all_sjis.extend(sj)

        at = scan_ascii_tables(data, off, length)
        for t in at: t['segment'] = seg['index']
        all_ascii.extend(at)

        if length >= 16:
            st = scan_struct_tables(data, off, length, label)
            for t in st: t['segment'] = seg['index']
            all_struct.extend(st)

            u16t = scan_u16_tables(data, off, length)
            for t in u16t: t['segment'] = seg['index']
            all_u16.extend(u16t)

    return all_sjis, all_ascii, all_struct, all_u16

# ── Scan for specific known game constant patterns ────────────────────────────

def find_known_patterns(data):
    """Look for specific known game-mechanics markers in the binary."""
    results = {}

    # Search for AP-related markers
    for marker_text in [b'AP', b'ActionPoint', b'action_point', b'actpt']:
        idx = data.find(marker_text)
        if idx >= 0:
            context = data[max(0,idx-16):idx+32]
            results.setdefault('ap_markers', []).append(dict(
                offset=hex(idx), marker=marker_text.decode('ascii', errors='replace'),
                context_hex=context.hex(),
            ))

    # Search for hex direction offset pattern only in data segments (small search)
    hex_dir_patterns = [
        bytes([0xFF,0xFF, 0x00,0x00, 0x01,0x00, 0xFF,0xFF, 0x00,0x00, 0x01,0x00]),
        bytes([0x00,0x00, 0x01,0x00, 0x01,0x00, 0x00,0x00, 0xFF,0xFF, 0xFF,0xFF]),
    ]
    for pat in hex_dir_patterns:
        idx = data.find(pat)
        if idx >= 0:
            vals = [struct.unpack_from('<h', data, idx + i*2)[0] for i in range(6)]
            results.setdefault('hex_direction_offsets', []).append(
                dict(offset=hex(idx), values=vals))

    return results

# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

def main():
    print("=" * 80)
    print("CBE.EXE Phase 3 — Deep Game Mechanics Extraction")
    print("Platoon Leader — Combat Battle Engine (1997 SEGA/TechnoBrain)")
    print("=" * 80)

    if not CBE_PATH.is_file():
        print(f"ERROR: {CBE_PATH} not found"); sys.exit(1)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(CBE_PATH, 'rb') as f:
        data = f.read()
    fsize = len(data)
    print(f"File: {CBE_PATH}  ({fsize:,} bytes)")

    # ── 1. NE header ──────────────────────────────────────────────────────────
    print("\n[1/12] Parsing NE header...")
    hdr = parse_ne(data)
    seg_data_segs = [s for s in hdr['segments'] if s['is_data']]
    seg_code_segs = [s for s in hdr['segments'] if not s['is_data']]
    print(f"  {len(hdr['segments'])} segments ({len(seg_code_segs)} code, {len(seg_data_segs)} data)")
    total_res = sum(rt['count'] for rt in hdr['resource_types'])
    print(f"  {len(hdr['resource_types'])} resource types, {total_res} total resources")
    for rt in hdr['resource_types']:
        print(f"    {rt['type_name']:25s} x {rt['count']}")

    # ── 2. RT_STRING ──────────────────────────────────────────────────────────
    print("\n[2/12] Extracting ALL RT_STRING resources...")
    strings_dict, string_blocks = extract_strings(data, hdr)
    print(f"  {len(strings_dict)} strings from {len(string_blocks)} blocks")

    # ── 3. String categorization ──────────────────────────────────────────────
    print("\n[3/12] Categorizing strings...")
    categories = categorize_strings(strings_dict)
    for cat, items in categories.items():
        if items: print(f"  {cat}: {len(items)}")

    # ── 4. RT_DIALOG ──────────────────────────────────────────────────────────
    print("\n[4/12] Extracting RT_DIALOG...")
    dialogs = extract_dialogs(data, hdr)
    print(f"  {len(dialogs)} dialogs")

    # ── 5. RT_MENU ────────────────────────────────────────────────────────────
    print("\n[5/12] Extracting RT_MENU...")
    menus = extract_menus(data, hdr)
    print(f"  {len(menus)} menus")

    # ── 6. Game data: command system ──────────────────────────────────────────
    print("\n[6/12] Extracting command system...")
    cmd_sys = extract_command_system(data)
    for k, v in cmd_sys.items(): print(f"  {k}: {v}")

    # ── 7. Game data: vehicles & weapons ──────────────────────────────────────
    print("\n[7/12] Extracting vehicles & weapons...")
    vehicles = extract_vehicle_names(data)
    weapons  = extract_weapon_names(data)
    names    = extract_soldier_names(data)
    radio    = extract_radio_messages(data)
    print(f"  Vehicles: {vehicles['count']}")
    print(f"  US weapons: {len(weapons['us'])}, German: {len(weapons['german'])}, Russian: {len(weapons['russian'])}")
    print(f"  Name tables: {len(names)}")
    print(f"  Radio msgs: {radio['count']}")

    # ── 8. TDD models, maps, events, sounds ───────────────────────────────────
    print("\n[8/12] Extracting TDD models, maps, events, sounds...")
    tdd       = extract_tdd_models(data)
    maps      = extract_map_files(data)
    events    = extract_events(data)
    sounds    = extract_sounds(data)
    fmt_strs  = extract_format_strings(data)
    print(f"  TDD model groups: {len(tdd)}")
    print(f"  Map files: PLX={len(maps.get('plx_map_files',[]))}, IPF={len(maps.get('ipf_map_files',[]))}")
    print(f"  Events: {len(events)}")
    print(f"  Sounds: {len(sounds)}")
    print(f"  Format strings: {len(fmt_strs)}")

    # ── 9. File references ────────────────────────────────────────────────────
    print("\n[9/12] Scanning file references...")
    tdd_refs = scan_file_refs(data, b'.TDD')
    print(f"  .TDD refs: {len(tdd_refs)}")
    file_refs = {}
    for ext in (b'.BMP', b'.WAV', b'.MID', b'.CG', b'.DAT', b'.DLL',
                b'.EXE', b'.IPF', b'.SCN', b'.MAP', b'.PLX'):
        refs = scan_file_refs(data, ext)
        if refs:
            ext_s = ext.decode('ascii')
            unique = list({r['filename'] for r in refs})
            file_refs[ext_s] = refs
            print(f"  {ext_s}: {len(unique)} unique")

    # ── 10. Deep data segment scan ────────────────────────────────────────────
    print("\n[10/12] Deep-scanning ALL data segments...")
    ds_sjis, ds_ascii, ds_struct, ds_u16 = deep_scan_all_data_segments(data, hdr['segments'])
    print(f"  SJIS strings:       {len(ds_sjis)}")
    print(f"  ASCII tables:       {len(ds_ascii)}")
    print(f"  Struct table cands: {len(ds_struct)}")
    print(f"  U16 table cands:    {len(ds_u16)}")

    # ── 11. Terrain & dispatch tables ─────────────────────────────────────────
    print("\n[11/12] Detecting terrain tables & dispatch tables...")
    terrain = detect_terrain_tables(data, hdr['segments'])
    dispatch = detect_dispatch_tables(data, hdr['segments'])
    print(f"  Terrain table candidates: {len(terrain)}")
    print(f"  Dispatch table candidates: {len(dispatch)}")

    for tc in terrain[:5]:
        print(f"    Terrain @ {tc['abs_off']}: {tc['rows']}x{tc['cols']}  move_costs={tc['has_movement_costs']}")
        for i, row in enumerate(tc['data'][:4]):
            print(f"      [{i:2d}] {row}")

    # ── 12. Known patterns ────────────────────────────────────────────────────
    print("\n[12/12] Searching for known game-constant patterns...")
    known = find_known_patterns(data)
    for k, v in known.items():
        print(f"  {k}: {len(v)} matches")

    # ── 13. Resident / Imported names ─────────────────────────────────────────
    res_names = extract_resident_names(data, hdr['ne_offset'], hdr['res_name_off'])
    imp_names = extract_imported_names(data, hdr['ne_offset'], hdr['imp_name_off'])

    # ══════════════════════════════════════════════════════════════════════════
    # Build final report
    # ══════════════════════════════════════════════════════════════════════════

    print("\n\nAssembling JSON report...")

    high_conf_tables = [t for t in ds_struct if t['confidence'] in ('high','medium')]
    interesting_u16 = [t for t in ds_u16 if t['count'] >= 6][:30]

    report = OrderedDict([
        ("_meta", dict(
            file=str(CBE_PATH), file_size=fsize,
            format="NE (16-bit New Executable)",
            description="Combat Battle Engine — Platoon Leader (1997 SEGA/TechnoBrain)",
            phase="Phase 3: Deep game-mechanics extraction",
        )),

        ("ne_header", {k:v for k,v in hdr.items()
                       if k not in ('segments','resource_types')}),

        ("segments", [
            dict(index=s['index'], offset=hex(s['offset']), length=s['length'],
                 type='DATA' if s['is_data'] else 'CODE',
                 flags=hex(s['flags']), alloc_size=s['alloc'])
            for s in hdr['segments']
        ]),

        ("resource_summary", [
            dict(type_id=hex(rt['type_id']), type_name=rt['type_name'],
                 count=rt['count'],
                 entries=[dict(name=e['name'], offset=hex(e['offset']),
                               length=e['length']) for e in rt['entries']])
            for rt in hdr['resource_types']
        ]),

        ("rt_strings", dict(
            total_count=len(strings_dict),
            blocks=string_blocks,
            all_strings={str(k):v for k,v in sorted(strings_dict.items())},
        )),

        ("string_categories", categories),

        ("dialogs", dialogs),
        ("menus", menus),

        ("game_data", dict(
            command_system=cmd_sys,
            vehicles=vehicles,
            weapons=dict(
                us=dict(count=len(weapons['us']), names=weapons['us']),
                german=dict(count=len(weapons['german']), names=weapons['german']),
                russian=dict(count=len(weapons['russian']), names=weapons['russian']),
            ),
            soldier_names=[
                dict(offset=t['offset'], count=t['count'],
                     sample=t['names'][:50], all_names=t['names'])
                for t in names
            ],
            radio_messages=radio,
            tdd_models=tdd,
            maps=maps,
            events=events,
            sounds=sounds,
            format_strings=fmt_strs,
        )),

        ("data_segment_analysis", dict(
            sjis_strings_count=len(ds_sjis),
            sjis_strings=ds_sjis[:500],
            ascii_tables=ds_ascii,
            structured_tables_high_medium=high_conf_tables[:40],
            u16_tables=interesting_u16,
        )),

        ("terrain_table_candidates", terrain),
        ("dispatch_table_candidates", dispatch),
        ("known_pattern_matches", known),

        ("file_references", dict(
            tdd_vehicle_files=tdd_refs,
            by_extension={ext: [dict(filename=r['filename'], offset=r['offset'])
                                for r in refs]
                          for ext, refs in file_refs.items()},
        )),

        ("resident_names", res_names),
        ("imported_names", imp_names),
    ])

    with open(OUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    out_size = os.path.getsize(OUT_JSON)
    print(f"\n{'='*80}")
    print(f"Report: {OUT_JSON}")
    print(f"Size:   {out_size:,} bytes")
    print(f"{'='*80}")

    print(f"\n=== FINAL SUMMARY ===")
    print(f"  RT_STRING:         {len(strings_dict)} strings / {len(string_blocks)} blocks")
    print(f"  RT_DIALOG:         {len(dialogs)}")
    print(f"  RT_MENU:           {len(menus)}")
    print(f"  Command system:    {list(cmd_sys.keys())}")
    print(f"  Vehicles (AFV):    {vehicles['count']}")
    print(f"  Weapons:           US={len(weapons['us'])} DE={len(weapons['german'])} RU={len(weapons['russian'])}")
    print(f"  Soldier names:     {sum(t['count'] for t in names)} across {len(names)} tables")
    print(f"  Radio messages:    {radio['count']}")
    print(f"  TDD model groups:  {len(tdd)}")
    print(f"  Sounds (.WAV):     {len(sounds)}")
    print(f"  Format strings:    {len(fmt_strs)}")
    print(f"  Data seg SJIS:     {len(ds_sjis)}")
    print(f"  ASCII tables:      {len(ds_ascii)}")
    print(f"  Struct tables:     {len(high_conf_tables)} high/med confidence")
    print(f"  U16 tables:        {len(interesting_u16)}")
    print(f"  Terrain cands:     {len(terrain)}")
    print(f"  Dispatch cands:    {len(dispatch)}")
    print(f"  .TDD refs:         {len(tdd_refs)}")


if __name__ == '__main__':
    main()

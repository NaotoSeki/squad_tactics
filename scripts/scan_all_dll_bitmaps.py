#!/usr/bin/env python3
import struct, os, glob

RT_BITMAP = 0x8002

def scan_ne_bitmaps(filepath):
    with open(filepath, 'rb') as f:
        data = f.read()
    if len(data) < 0x40:
        return None, 'too small for MZ'
    if data[0:2] != b'MZ':
        return None, 'no MZ header'
    ne_offset = struct.unpack_from('<H', data, 0x3C)[0]
    if ne_offset + 2 > len(data):
        return None, 'NE offset out of range'
    if data[ne_offset:ne_offset+2] != b'NE':
        return None, 'not NE format'
    if ne_offset + 0x26 > len(data):
        return None, 'NE header truncated'
    res_table_rel = struct.unpack_from('<H', data, ne_offset + 0x24)[0]
    if res_table_rel == 0:
        return [], 'no resource table'
    res_table_abs = ne_offset + res_table_rel
    if res_table_abs + 2 > len(data):
        return None, 'resource table offset out of range'
    rsc_align_shift = struct.unpack_from('<H', data, res_table_abs)[0]
    pos = res_table_abs + 2
    bitmap_entries = []
    while pos + 8 <= len(data):
        type_id = struct.unpack_from('<H', data, pos)[0]
        if type_id == 0:
            break
        count = struct.unpack_from('<H', data, pos + 2)[0]
        pos += 8
        for i in range(count):
            if pos + 12 > len(data):
                break
            r_offset = struct.unpack_from('<H', data, pos)[0]
            r_length = struct.unpack_from('<H', data, pos + 2)[0]
            r_flags  = struct.unpack_from('<H', data, pos + 4)[0]
            r_id     = struct.unpack_from('<H', data, pos + 6)[0]
            pos += 12
            if type_id == RT_BITMAP:
                if r_id & 0x8000:
                    id_str = str(r_id & 0x7FFF)
                else:
                    name_abs = res_table_abs + r_id
                    if name_abs < len(data):
                        name_len = data[name_abs]
                        name_bytes = data[name_abs+1:name_abs+1+name_len]
                        id_str = name_bytes.decode('ascii', errors='replace')
                    else:
                        id_str = 'name@0x%04X' % r_id
                actual_offset = r_offset << rsc_align_shift
                actual_length = r_length << rsc_align_shift
                bitmap_entries.append({'id': id_str, 'offset': actual_offset, 'length': actual_length, 'flags': r_flags})
    return bitmap_entries, 'ok'

def main():
    pl_dir = r'D:\PL'
    dll_files = sorted(glob.glob(os.path.join(pl_dir, '*.DLL')))
    dll_files += sorted(glob.glob(os.path.join(pl_dir, '*.dll')))
    seen = set()
    unique_dlls = []
    for p in dll_files:
        key = p.upper()
        if key not in seen:
            seen.add(key)
            unique_dlls.append(p)
    print('Scanning %d DLL files in %s ...\n' % (len(unique_dlls), pl_dir))
    print('=' * 70)
    total_bitmaps = 0
    files_with_bitmaps = 0
    for dll_path in unique_dlls:
        fname = os.path.basename(dll_path)
        entries, status = scan_ne_bitmaps(dll_path)
        if entries is None:
            print('  %-30s  -- skipped (%s)' % (fname, status))
            continue
        count = len(entries)
        total_bitmaps += count
        if count > 0:
            files_with_bitmaps += 1
            print('  %-30s  RT_BITMAP count: %d' % (fname, count))
            for e in entries:
                print('      ID=%-12s  offset=0x%08X  length=0x%06X  flags=0x%04X' % (e['id'], e['offset'], e['length'], e['flags']))
        else:
            print('  %-30s  RT_BITMAP count: 0' % fname)
    print('=' * 70)
    print('\nSummary: %d file(s) with RT_BITMAP, %d total bitmap resource(s) across %d DLLs.' % (files_with_bitmaps, total_bitmaps, len(unique_dlls)))

if __name__ == '__main__':
    main()

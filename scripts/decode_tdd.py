"""
TDD Sprite Decoder
TechnoBrain / SEGA "Platoon Leader" (1997)

Headerless raw 8-bit indexed pixel data.
- No magic number, no compression
- Dimensions determined from file size + lookup table
- Palette from external IPF file
- Pixel 0x02 = transparent
"""

import struct, sys, os, pathlib, glob
from PIL import Image

TRANSPARENT_INDEX = 0x02

KNOWN_SIZES = {
    82944:  (48, 48, 36),
    331776: (96, 96, 36),
    13824:  (48, 48, 6),
    55296:  (96, 96, 6),
    9471:   (33, 41, 7),
    4059:   (33, 41, 3),
    37884:  (66, 82, 7),
    16236:  (66, 82, 3),
    36:     (6, 6, 1),
    100:    (10, 10, 1),
    169:    (13, 13, 1),
    128:    (16, 8, 1),
    1536:   (16, 16, 6),
    3072:   (32, 32, 3),
    4096:   (16, 256, 1),
    9216:   (48, 48, 4),
    20480:  (64, 320, 1),
    896:    (16, 56, 1),
    800:    (20, 40, 1),
    17862:  (78, 229, 1),
}

MAN_SIZES = {
    "MANSTY":   (16, 16, 6),
    "MANACT":   (16, 16, None),
    "MANMOV":   (16, 16, None),
    "MANMOV0":  (16, 16, None),
    "MANMOV2":  (12, 12, None),
    "MANFIR0":  (13, 13, None),
    "MANFIR1":  (12, 12, None),
    "MANFIR2":  (31, 31, None),
    "MANHTH":   (14, 14, None),
    "MANTROW":  (13, 13, None),
    "2MANSTY":  (32, 32, 6),
    "2MANACT":  (32, 32, None),
    "2MANMOV":  (32, 32, None),
    "2MANMOV0": (32, 32, None),
    "2MANMOV2": (24, 24, None),
    "2MANFIR0": (26, 26, None),
    "2MANFIR1": (24, 24, None),
    "2MANFIR2": (62, 62, None),
    "2MANHTH":  (28, 28, None),
    "2MANTROW": (26, 26, None),
}


def load_palette(ipf_path: str) -> list:
    data = open(ipf_path, "rb").read()
    pos = 12
    chunks = {}
    while pos < len(data) - 8:
        tag = data[pos:pos+4]
        size = struct.unpack_from('<I', data, pos+4)[0]
        chunks[tag] = data[pos+8:pos+8+size]
        pos += 8 + size
        if pos % 2:
            pos += 1
    pal_data = chunks[b'pal ']
    palette = [(0, 0, 0)] * 256
    hdr = 6
    n = (len(pal_data) - hdr) // 3
    for i in range(min(n, 256)):
        off = hdr + i * 3
        palette[i] = (pal_data[off], pal_data[off+1], pal_data[off+2])
    return palette


def guess_dimensions(data_len: int, name: str):
    upper = name.upper()
    if upper in MAN_SIZES:
        w, h, nf = MAN_SIZES[upper]
        if nf is None:
            nf = data_len // (w * h)
            if nf * w * h != data_len:
                nf = max(1, nf)
        return w, h, nf

    if data_len in KNOWN_SIZES:
        return KNOWN_SIZES[data_len]

    for w_try in [48, 96, 32, 16, 64, 33, 66, 13, 10, 6, 20, 78]:
        if data_len % w_try == 0:
            total_h = data_len // w_try
            for h_try in [w_try, 48, 96, 32, 16, 41, 82]:
                if total_h % h_try == 0:
                    nf = total_h // h_try
                    if nf >= 1:
                        return w_try, h_try, nf

    for w_try in [48, 32, 16, 64, 96]:
        if data_len % w_try == 0:
            h = data_len // w_try
            return w_try, h, 1

    return data_len, 1, 1


def decode_tdd(filepath: str, palette: list, out_dir: str) -> bool:
    data = pathlib.Path(filepath).read_bytes()
    name = pathlib.Path(filepath).stem
    data_len = len(data)

    w, h, num_frames = guess_dimensions(data_len, name)

    frame_size = w * h
    actual_frames = data_len // frame_size if frame_size > 0 else 0
    if actual_frames == 0:
        print(f"  SKIP {name}: cannot determine dimensions ({data_len} bytes)")
        return False

    if actual_frames * frame_size != data_len:
        leftover = data_len - actual_frames * frame_size
        print(f"  WARN {name}: {leftover} bytes leftover")

    num_frames = min(num_frames, actual_frames)

    if num_frames <= 6:
        cols = num_frames
        rows = 1
    elif num_frames <= 36:
        cols = 6
        rows = (num_frames + 5) // 6
    else:
        cols = 8
        rows = (num_frames + 7) // 8

    sheet_w = cols * w
    sheet_h = rows * h
    sheet = Image.new('RGBA', (sheet_w, sheet_h), (0, 0, 0, 0))

    for f in range(num_frames):
        col = f % cols
        row = f // cols
        frame_data = data[f * frame_size:(f + 1) * frame_size]

        for py in range(h):
            for px in range(w):
                idx = frame_data[py * w + px]
                if idx == TRANSPARENT_INDEX:
                    continue
                r, g, b = palette[idx]
                sheet.putpixel((col * w + px, row * h + py), (r, g, b, 255))

    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"{name}.png")
    sheet.save(out_path)
    print(f"  {name}: {w}x{h} x{num_frames}f -> {cols}x{rows} sheet ({sheet_w}x{sheet_h})")
    return True


if __name__ == '__main__':
    src_dir = sys.argv[1] if len(sys.argv) > 1 else r"D:\PL"
    out_dir = sys.argv[2] if len(sys.argv) > 2 else r"c:\Projects\squad_tactics\scripts\pl_decoded\tdd"
    pal_ipf = sys.argv[3] if len(sys.argv) > 3 else r"D:\PL\DMAP00.IPF"

    print(f"Loading palette from {pal_ipf}...")
    palette = load_palette(pal_ipf)

    files = sorted(glob.glob(os.path.join(src_dir, "*.TDD")))
    if not files:
        print(f"No TDD files found in {src_dir}")
        sys.exit(1)

    print(f"\nDecoding {len(files)} TDD files...\n")
    ok = 0
    for f in files:
        try:
            if decode_tdd(f, palette, out_dir):
                ok += 1
        except Exception as e:
            print(f"  FAIL {pathlib.Path(f).name}: {e}")
    print(f"\nDone: {ok}/{len(files)}")

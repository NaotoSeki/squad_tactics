"""
IPF (Intelligent Picture Format) Decoder
TechnoBrain / SEGA "Platoon Leader" (1997)

RIFF-based 8-bit indexed color image format with custom LZSS+RLE compression.
Compression scheme (reverse-engineered from IPF.DLL 0x046E):
  0x0F          → end of stream
  0x0E          → literal pixel value 14
  0x00-0x0D B C → RLE run: write pixel C repeated (opcode*256 + B + 1) times
  0x10-0x1F B C → LZ back-reference: dist = (opcode-0x10)*256 + B + 1, count = C + 1
  0x20-0xFF     → literal pixel value (byte - 0x10)
"""

import struct, sys, os, pathlib, glob
from PIL import Image


def read_chunks(data: bytes) -> dict:
    assert data[:4] == b'RIFF'
    assert data[8:12] == b'IPF '
    chunks = {}
    pos = 12
    while pos < len(data) - 8:
        tag = data[pos:pos+4].decode('ascii', errors='replace').strip()
        size = struct.unpack_from('<I', data, pos+4)[0]
        chunks[tag] = data[pos+8:pos+8+size]
        pos += 8 + size
        if pos % 2:
            pos += 1
    return chunks


def decode_palette(pal_data: bytes) -> list:
    num_colors = struct.unpack_from('<H', pal_data, 0)[0]
    palette = [(0, 0, 0)] * 256
    hdr_size = 6
    num_entries = (len(pal_data) - hdr_size) // 3
    for i in range(min(num_entries, 256)):
        off = hdr_size + i * 3
        palette[i] = (pal_data[off], pal_data[off+1], pal_data[off+2])
    return palette, num_colors


def decompress_ipf(data: bytes) -> bytearray:
    """Decompress TechnoBrain LZSS+RLE variant (IPF.DLL 0x046E)."""
    out = bytearray()
    i = 0
    dlen = len(data)

    while i < dlen:
        b = data[i]; i += 1

        if b == 0x0F:
            break
        elif b == 0x0E:
            out.append(0x0E)
        elif b <= 0x0D:
            if i + 1 >= dlen:
                break
            run_count = b * 256 + data[i] + 1; i += 1
            pixel = data[i]; i += 1
            out.extend(bytes([pixel]) * run_count)
        elif b <= 0x1F:
            if i + 1 >= dlen:
                break
            dist = (b - 0x10) * 256 + data[i] + 1; i += 1
            count = data[i] + 1; i += 1
            start = len(out) - dist
            for j in range(count):
                if start + j >= 0 and start + j < len(out):
                    out.append(out[start + j])
                else:
                    out.append(0)
        else:
            out.append(b - 0x10)

    return out


def decode_ipf(filepath: str, out_dir: str = None) -> Image.Image:
    data = pathlib.Path(filepath).read_bytes()
    chunks = read_chunks(data)

    fmt = chunks['fmt']
    total_pixels = struct.unpack_from('<I', fmt, 24)[0]

    pal_data = chunks['pal']
    palette, num_colors = decode_palette(pal_data)

    bmp = chunks['bmp']
    width = struct.unpack_from('<H', bmp, 0)[0]
    height = struct.unpack_from('<H', bmp, 2)[0]
    pixel_data = bmp[24:]

    name = pathlib.Path(filepath).stem
    pixels = decompress_ipf(pixel_data)

    expected = width * height
    actual = len(pixels)
    status = "OK" if actual == expected else f"off by {abs(actual - expected)}"
    print(f"  {name}: {width}x{height}, {num_colors}col, {actual}/{expected}px [{status}]")

    if actual < expected:
        pixels.extend([0] * (expected - actual))
    pixels = pixels[:expected]

    raw_rgb = bytearray(expected * 3)
    for idx in range(expected):
        c = palette[pixels[idx] % 256]
        raw_rgb[idx*3] = c[0]
        raw_rgb[idx*3+1] = c[1]
        raw_rgb[idx*3+2] = c[2]
    img = Image.frombytes('RGB', (width, height), bytes(raw_rgb))

    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
        out_path = os.path.join(out_dir, f"{name}.png")
        img.save(out_path, optimize=True)
        print(f"  -> {out_path}")

    return img


if __name__ == '__main__':
    src_dir = sys.argv[1] if len(sys.argv) > 1 else r"D:\PL"
    out_dir = sys.argv[2] if len(sys.argv) > 2 else r"c:\Projects\squad_tactics\scripts\pl_decoded\ipf"

    patterns = ["*.IPF"]
    files = []
    for pat in patterns:
        files.extend(glob.glob(os.path.join(src_dir, pat)))
    files.sort()

    if not files:
        print(f"No IPF files found in {src_dir}")
        sys.exit(1)

    print(f"Decoding {len(files)} IPF files...\n")
    ok = 0
    for f in files:
        try:
            decode_ipf(f, out_dir)
            ok += 1
        except Exception as e:
            print(f"  FAIL {pathlib.Path(f).name}: {e}")
    print(f"\nDone: {ok}/{len(files)}")

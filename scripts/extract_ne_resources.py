"""
Extract bitmap (RT_BITMAP) and custom resources from 16-bit NE format DLLs/EXEs.
Target: D:\PL\ (Platoon Leader, 1997 SEGA/TechnoBrain)

RT_BITMAP resources are stored as raw DIBs without the 14-byte BITMAPFILEHEADER.
This script prepends the header to produce valid .bmp files, then converts to .png.
"""
import struct
import os
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow is required. Install with: pip install Pillow")
    sys.exit(1)

# ── NE resource type IDs ──────────────────────────────────────────────────────

NE_RT_NAMES = {
    0x8001: "RT_CURSOR",
    0x8002: "RT_BITMAP",
    0x8003: "RT_ICON",
    0x8004: "RT_MENU",
    0x8005: "RT_DIALOG",
    0x8006: "RT_STRING",
    0x8007: "RT_FONTDIR",
    0x8008: "RT_FONT",
    0x8009: "RT_ACCELERATOR",
    0x800A: "RT_RCDATA",
    0x800C: "RT_GROUP_CURSOR",
    0x800E: "RT_GROUP_ICON",
    0x8010: "RT_VERSION",
}

RT_BITMAP = 0x8002

# ── NE parsing ────────────────────────────────────────────────────────────────

def read_ne_string(data: bytes, offset: int) -> str:
    """Read a Pascal-style (length-prefixed) string from the resource table area."""
    if offset < 0 or offset >= len(data):
        return "<out_of_bounds>"
    length = data[offset]
    if length == 0:
        return ""
    end = min(offset + 1 + length, len(data))
    return data[offset + 1 : end].decode("ascii", errors="replace")


def parse_ne_resources(filepath: str) -> dict:
    """
    Parse an NE file and return a dict with:
      'data': bytes  (entire file contents)
      'align_shift': int
      'resource_types': [ { 'type_id', 'type_name', 'entries': [ { 'name', 'offset', 'length' } ] } ]
      'error': str or None
    """
    result = {"data": b"", "align_shift": 0, "resource_types": [], "error": None}

    try:
        with open(filepath, "rb") as f:
            data = f.read()
    except Exception as e:
        result["error"] = f"Cannot read file: {e}"
        return result

    result["data"] = data

    if len(data) < 64 or data[:2] != b"MZ":
        result["error"] = "Not a valid MZ executable"
        return result

    ne_offset = struct.unpack_from("<H", data, 0x3C)[0]
    if ne_offset + 64 > len(data):
        result["error"] = f"NE header offset {ne_offset:#x} beyond file"
        return result

    if data[ne_offset : ne_offset + 2] != b"NE":
        result["error"] = f"Not NE format (magic: {data[ne_offset:ne_offset+2]!r})"
        return result

    res_table_off = struct.unpack_from("<H", data, ne_offset + 0x24)[0]
    rt_abs = ne_offset + res_table_off

    if rt_abs + 2 > len(data):
        result["error"] = "Resource table offset beyond file"
        return result

    align_shift = struct.unpack_from("<H", data, rt_abs)[0]
    result["align_shift"] = align_shift

    pos = rt_abs + 2

    while pos + 8 <= len(data):
        type_id = struct.unpack_from("<H", data, pos)[0]
        if type_id == 0:
            break

        count = struct.unpack_from("<H", data, pos + 2)[0]
        pos += 8  # skip type_id(2) + count(2) + reserved(4)

        if type_id & 0x8000:
            type_name = NE_RT_NAMES.get(type_id, f"RT_UNKNOWN_{type_id:#06x}")
        else:
            type_name = read_ne_string(data, rt_abs + type_id)

        entries = []
        for _ in range(count):
            if pos + 12 > len(data):
                break
            res_offset_raw = struct.unpack_from("<H", data, pos)[0]
            res_length_raw = struct.unpack_from("<H", data, pos + 2)[0]
            _flags = struct.unpack_from("<H", data, pos + 4)[0]
            res_name_id = struct.unpack_from("<H", data, pos + 6)[0]
            pos += 12  # 6 fields x 2 bytes = 12

            abs_offset = res_offset_raw << align_shift
            abs_length = res_length_raw << align_shift

            if res_name_id & 0x8000:
                name = str(res_name_id & 0x7FFF)
            else:
                name = read_ne_string(data, rt_abs + res_name_id)

            entries.append(
                {"name": name, "offset": abs_offset, "length": abs_length}
            )

        result["resource_types"].append(
            {"type_id": type_id, "type_name": type_name, "entries": entries}
        )

    return result


# ── BMP reconstruction ────────────────────────────────────────────────────────

def build_bmp_file(dib_data: bytes) -> bytes | None:
    """
    Prepend a BITMAPFILEHEADER to a raw DIB (BITMAPINFOHEADER + palette + pixels)
    to produce a complete .bmp file.  Returns None on parse error.
    """
    if len(dib_data) < 40:
        return None

    bih_size = struct.unpack_from("<I", dib_data, 0)[0]
    if bih_size < 12:
        return None

    width = struct.unpack_from("<i", dib_data, 4)[0]
    height = struct.unpack_from("<i", dib_data, 8)[0]
    bpp = struct.unpack_from("<H", dib_data, 14)[0]
    compression = struct.unpack_from("<I", dib_data, 16)[0] if bih_size >= 20 else 0
    colors_used = struct.unpack_from("<I", dib_data, 32)[0] if bih_size >= 36 else 0

    if bpp <= 8:
        palette_entries = colors_used if colors_used > 0 else (1 << bpp)
        palette_size = palette_entries * 4  # RGBQUAD
    else:
        palette_size = 0
        if compression == 3 and bih_size == 40:
            palette_size = 12  # BI_BITFIELDS colour masks

    pixel_data_offset = 14 + bih_size + palette_size
    file_size = 14 + len(dib_data)

    header = struct.pack(
        "<2sIHHI",
        b"BM",
        file_size,
        0,
        0,
        pixel_data_offset,
    )
    return header + dib_data


def bmp_info_str(dib_data: bytes) -> str:
    """Return a human-readable summary of BITMAPINFOHEADER fields."""
    if len(dib_data) < 16:
        return "??"
    w = struct.unpack_from("<i", dib_data, 4)[0]
    h = struct.unpack_from("<i", dib_data, 8)[0]
    bpp = struct.unpack_from("<H", dib_data, 14)[0]
    return f"{abs(w)}x{abs(h)} {bpp}bpp"


# ── Extraction logic ──────────────────────────────────────────────────────────

def extract_bitmaps(parsed: dict, dll_name: str, out_dir: Path) -> int:
    """Extract all RT_BITMAP resources. Returns count of successfully saved files."""
    data = parsed["data"]
    saved = 0

    for rtype in parsed["resource_types"]:
        if rtype["type_id"] != RT_BITMAP:
            continue

        for entry in rtype["entries"]:
            name = entry["name"]
            offset = entry["offset"]
            length = entry["length"]

            if offset + length > len(data):
                print(f"    WARN: {name} data extends beyond file "
                      f"(offset={offset:#x}, len={length:#x}, file={len(data):#x}) - skipping")
                continue
            if length == 0:
                print(f"    WARN: {name} has zero length - skipping")
                continue

            dib_data = data[offset : offset + length]
            bmp_bytes = build_bmp_file(dib_data)
            if bmp_bytes is None:
                print(f"    WARN: {name} - failed to reconstruct BMP header - skipping")
                continue

            safe_name = name.replace("\\", "_").replace("/", "_").replace(":", "_")
            bmp_path = out_dir / f"{safe_name}.bmp"
            png_path = out_dir / f"{safe_name}.png"

            try:
                bmp_path.write_bytes(bmp_bytes)
            except Exception as e:
                print(f"    ERROR writing {bmp_path.name}: {e}")
                continue

            info = bmp_info_str(dib_data)

            try:
                img = Image.open(bmp_path)
                img.save(png_path)
                print(f"    OK  {safe_name:30s}  {info:20s}  {length:>8,} bytes")
                saved += 1
            except Exception as e:
                print(f"    BMP saved but PNG conversion failed for {safe_name} ({info}): {e}")
                saved += 1  # BMP was still saved

    return saved


def extract_custom_resources(
    parsed: dict, type_name_filter: str, dll_name: str, out_dir: Path, ext: str = ".bin"
) -> int:
    """Extract custom (non-standard) resources by type name. Returns count saved."""
    data = parsed["data"]
    saved = 0

    for rtype in parsed["resource_types"]:
        if rtype["type_name"] != type_name_filter:
            continue

        for entry in rtype["entries"]:
            name = entry["name"]
            offset = entry["offset"]
            length = entry["length"]

            if offset + length > len(data):
                print(f"    WARN: {name} data beyond file - skipping")
                continue
            if length == 0:
                print(f"    WARN: {name} zero length - skipping")
                continue

            raw = data[offset : offset + length]
            safe_name = name.replace("\\", "_").replace("/", "_").replace(":", "_")
            out_path = out_dir / f"{safe_name}{ext}"

            try:
                out_path.write_bytes(raw)
                print(f"    OK  {safe_name:30s}  {length:>8,} bytes")
                saved += 1
            except Exception as e:
                print(f"    ERROR writing {out_path.name}: {e}")

    return saved


# ── Summary helpers ───────────────────────────────────────────────────────────

def print_resource_summary(parsed: dict, filename: str):
    """Print a table of all resource types found in the file."""
    if parsed["error"]:
        print(f"  ERROR: {parsed['error']}")
        return

    total = sum(len(rt["entries"]) for rt in parsed["resource_types"])
    print(f"  Alignment shift: {parsed['align_shift']}")
    print(f"  Resource types:  {len(parsed['resource_types'])}")
    print(f"  Total resources: {total}")

    for rt in parsed["resource_types"]:
        tid = rt["type_id"]
        tname = rt["type_name"]
        count = len(rt["entries"])
        if tid & 0x8000:
            label = tname
        else:
            label = f'Custom "{tname}"'
        print(f"    {label:30s}  x {count}")


def format_size(n: int) -> str:
    if n < 1024:
        return f"{n} B"
    elif n < 1024 * 1024:
        return f"{n / 1024:.1f} KB"
    else:
        return f"{n / (1024 * 1024):.1f} MB"


# ── Main ──────────────────────────────────────────────────────────────────────

TARGETS = [
    # (filename, extract bitmaps?, custom resource type name or None)
    ("INTERMIS.DLL", True, None),
    ("MISSCG.DLL", True, None),
    ("MAPCG.DLL", True, None),
    ("CBE.EXE", True, None),
    ("PL.EXE", True, None),
    ("MISSDATA.DLL", False, "MISSDATA"),
]

BASE_OUTPUT = Path(r"c:\Projects\squad_tactics\scripts\pl_decoded\ne_resources")
PL_DIR = Path(r"D:\PL")


def main():
    print("=" * 80)
    print("NE Resource Extractor - D:\\PL\\ (Platoon Leader)")
    print("=" * 80)

    if not PL_DIR.is_dir():
        print(f"\nERROR: Source directory not found: {PL_DIR}")
        sys.exit(1)

    grand_total = 0

    for filename, do_bitmaps, custom_type in TARGETS:
        filepath = PL_DIR / filename
        stem = Path(filename).stem

        print(f"\n{'─' * 80}")
        print(f"  {filename}")
        print(f"{'─' * 80}")

        if not filepath.is_file():
            print(f"  FILE NOT FOUND: {filepath}")
            continue

        fsize = filepath.stat().st_size
        print(f"  Size: {format_size(fsize)}")

        parsed = parse_ne_resources(str(filepath))

        if parsed["error"]:
            print(f"  PARSE ERROR: {parsed['error']}")
            continue

        print_resource_summary(parsed, filename)

        out_dir = BASE_OUTPUT / stem
        out_dir.mkdir(parents=True, exist_ok=True)
        print(f"\n  Output: {out_dir}")

        count = 0

        if do_bitmaps:
            print(f"\n  Extracting RT_BITMAP resources...")
            count += extract_bitmaps(parsed, stem, out_dir)

        if custom_type:
            print(f'\n  Extracting custom "{custom_type}" resources...')
            count += extract_custom_resources(parsed, custom_type, stem, out_dir)

        print(f"\n  => {count} resources extracted from {filename}")
        grand_total += count

    print(f"\n{'=' * 80}")
    print(f"  TOTAL: {grand_total} resources extracted across all files")
    print(f"  Output root: {BASE_OUTPUT}")
    print(f"{'=' * 80}")


if __name__ == "__main__":
    main()

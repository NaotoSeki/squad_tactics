# -*- coding: utf-8 -*-
"""
CG データブロックの先頭バイトを調べて、
ヘッダの有無・画像寸法・bpp を推定する。

  python scripts\\probe_cg_format.py
  -> scripts/pl_decoded/cg_format_probe.json
"""
from __future__ import annotations

import json
import struct
from pathlib import Path
from collections import Counter

PL = Path("D:/PL")
ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "scripts" / "pl_decoded"


def read_resolved_table(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return data.get("entries", [])


def probe_cg_blocks(dll_path: Path, entries: list[dict],
                    sample_indices: list[int] | None = None) -> dict:
    d = dll_path.read_bytes()
    probes = []

    if sample_indices is None:
        non_null = [e for e in entries if e.get("target_seg") is not None]
        sample_indices = list(range(min(20, len(non_null))))
        if len(non_null) > 20:
            sample_indices.extend([50, 100, 150, 200, 300, len(non_null) - 1])

    sizes = []
    for idx in sample_indices:
        if idx >= len(entries):
            continue
        e = entries[idx]
        if e.get("file_offset_cg") is None:
            continue

        fo = e["file_offset_cg"]
        seg_fo = e.get("seg_file_offset", 0)
        seg_len = e.get("seg_length", 0)

        read_len = min(128, len(d) - fo)
        header = d[fo:fo + read_len]

        next_entry = None
        for ne in entries:
            if ne["index"] == idx + 1 and ne.get("file_offset_cg") is not None:
                next_entry = ne
                break

        block_size = None
        if next_entry:
            if next_entry["target_seg"] == e["target_seg"]:
                block_size = next_entry["ptr_offset"] - e["ptr_offset"]
            else:
                block_size = seg_len - e["ptr_offset"]

        if block_size and block_size > 0:
            sizes.append(block_size)

        w0 = struct.unpack_from("<H", header, 0)[0] if len(header) >= 2 else None
        w1 = struct.unpack_from("<H", header, 2)[0] if len(header) >= 4 else None
        w2 = struct.unpack_from("<H", header, 4)[0] if len(header) >= 6 else None
        w3 = struct.unpack_from("<H", header, 6)[0] if len(header) >= 8 else None

        probes.append({
            "index": idx,
            "file_offset_hex": f"0x{fo:X}",
            "seg": e["target_seg"],
            "ptr_offset_hex": e["ptr_offset_hex"],
            "block_size": block_size,
            "first_32_hex": header[:32].hex(),
            "first_words": {
                "w0": w0, "w1": w1, "w2": w2, "w3": w3,
            },
            "first_word_product": w0 * w1 if w0 and w1 else None,
        })

    size_counter = Counter(sizes)
    common_sizes = size_counter.most_common(5)

    possible_dims = []
    for sz, count in common_sizes:
        candidates = []
        for bpp in (4, 8):
            bytes_per_px = bpp / 8
            pixel_count = int(sz / bytes_per_px)
            for w in range(8, 513, 8):
                h = pixel_count // w
                if w * h == pixel_count and 4 <= h <= 512:
                    candidates.append({"w": w, "h": h, "bpp": bpp})
            hdr_sizes = [0, 4, 8, 16]
            for hs in hdr_sizes:
                if hs == 0:
                    continue
                data_sz = sz - hs
                if data_sz <= 0:
                    continue
                pc = int(data_sz / bytes_per_px)
                for w in range(8, 513, 8):
                    h = pc // w
                    if w * h == pc and 4 <= h <= 512:
                        candidates.append({"w": w, "h": h, "bpp": bpp,
                                          "header_bytes": hs})
        possible_dims.append({
            "block_size": sz,
            "count": count,
            "candidates": candidates[:20],
        })

    first_words_w0 = Counter()
    first_words_w1 = Counter()
    for p in probes:
        if p["first_words"]["w0"] is not None:
            first_words_w0[p["first_words"]["w0"]] += 1
        if p["first_words"]["w1"] is not None:
            first_words_w1[p["first_words"]["w1"]] += 1

    return {
        "dll": str(dll_path),
        "probes": probes,
        "block_size_distribution": [
            {"size": sz, "size_hex": f"0x{sz:X}", "count": c}
            for sz, c in common_sizes
        ],
        "possible_dimensions": possible_dims,
        "first_word_distribution": {
            "w0": dict(first_words_w0.most_common(10)),
            "w1": dict(first_words_w1.most_common(10)),
        },
    }


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    results = {}

    for dll_name, table_file in [
        ("ITEML.DLL", "iteml_cg_resolved.json"),
        ("ITEMS.DLL", "items_cg_resolved.json"),
    ]:
        table_path = OUT_DIR / table_file
        if not table_path.is_file():
            print(f"  {table_file} not found, skipping")
            continue

        entries = read_resolved_table(table_path)
        dll_path = PL / dll_name

        print(f"\n{'='*60}")
        print(f"  {dll_name}")
        print(f"{'='*60}")

        result = probe_cg_blocks(dll_path, entries)
        results[dll_name] = result

        print(f"  Block size distribution:")
        for bs in result["block_size_distribution"]:
            print(f"    {bs['size_hex']} ({bs['size']} bytes) × {bs['count']}")

        print(f"\n  First word (w0) distribution:")
        for val, cnt in list(result["first_word_distribution"]["w0"].items())[:5]:
            print(f"    {val} (0x{val:04X}) × {cnt}")

        print(f"\n  First word (w1) distribution:")
        for val, cnt in list(result["first_word_distribution"]["w1"].items())[:5]:
            print(f"    {val} (0x{val:04X}) × {cnt}")

        print(f"\n  Possible dimensions:")
        for pd in result["possible_dimensions"]:
            print(f"    Block {pd['block_size']} bytes:")
            for c in pd["candidates"][:8]:
                extra = f" (header={c['header_bytes']}B)" if "header_bytes" in c else ""
                print(f"      {c['w']}×{c['h']} @ {c['bpp']}bpp{extra}")

        print(f"\n  Sample probes (first 5):")
        for p in result["probes"][:5]:
            print(f"    [{p['index']:3d}] file={p['file_offset_hex']} "
                  f"block={p['block_size']} "
                  f"words=[{p['first_words']['w0']}, {p['first_words']['w1']}, "
                  f"{p['first_words']['w2']}, {p['first_words']['w3']}] "
                  f"hex={p['first_32_hex'][:32]}...")

    out_path = OUT_DIR / "cg_format_probe.json"
    out_path.write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\nWROTE {out_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

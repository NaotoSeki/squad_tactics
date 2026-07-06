# -*- coding: utf-8 -*-
"""
Platoon Leader — hunt item/weapon->ammo table signatures in CBE.EXE + ITEML.DLL.
Cross-check with scripts/pl_decoded/cbe_weapon_ammo_explicit.json

Run: python scripts/re_pl_item_id_tables.py
Output: scripts/pl_decoded/re_item_table_hits.json
"""
import json
import struct
from pathlib import Path

PL = Path(r"D:\PL")
ROOT = Path(__file__).resolve().parents[1]
EXPLICIT = ROOT / "scripts" / "pl_decoded" / "cbe_weapon_ammo_explicit.json"
OUT = ROOT / "scripts" / "pl_decoded" / "re_item_table_hits.json"


def u16w(w: int, a: int) -> bytes:
    return struct.pack("<HH", w & 0xFFFF, a & 0xFFFF)


def load_expected_pairs() -> list[tuple[int, int, str]]:
    """(weapon_cbe, ammo_cbe, label) from explicit edges (first ammo only for multi)."""
    ex = json.loads(EXPLICIT.read_text(encoding="utf-8"))
    out = []
    for e in ex.get("edges", []):
        w = e["cbeWeaponIndex"]
        for am in e["acceptsAmmoPlIndices"][:1]:
            out.append((w, am, e.get("plWeaponName", "")))
    m = ex.get("mg42")
    if m:
        out.append((m["cbeWeaponIndex"], m["acceptsAmmoPlIndices"][0], "MG42"))
    m = ex.get("luger")
    if m:
        out.append((m["cbeWeaponIndex"], m["acceptsAmmoPlIndices"][0], "P08"))
    return out


def find_all(hay: bytes, needle: bytes) -> list[int]:
    r = []
    p = 0
    while True:
        i = hay.find(needle, p)
        if i < 0:
            break
        r.append(i)
        p = i + 1
    return r


def scan_file(name: str, data: bytes, pairs: list[tuple[int, int, str]], margin: int = 0) -> dict:
    hits = {
        "file": name,
        "size": len(data),
        "pair_hits": [],
        "sequence_hits": [],
    }
    for w, a, lbl in pairs:
        pat = u16w(w, a)
        off = find_all(data, pat)
        if off:
            hits["pair_hits"].append(
                {
                    "w": w,
                    "a": a,
                    "label": lbl,
                    "count": len(off),
                    "offsets_hex": [hex(x) for x in off[:24]],
                }
            )
    # back-to-back chain of 4 known pairs: (0,225)(1,226) unlikely adjacent but try 3-4 from explicit
    ex = json.loads(EXPLICIT.read_text(encoding="utf-8"))
    edges = ex.get("edges", [])[:6]
    seq = b"".join(
        u16w(e["cbeWeaponIndex"], e["acceptsAmmoPlIndices"][0]) for e in edges if e.get("acceptsAmmoPlIndices")
    )
    if len(seq) >= 8:
        at = data.find(seq)
        hits["sequence_hits"].append(
            {
                "bytes_len": len(seq),
                "offset_hex": None if at < 0 else hex(at),
                "first_edges": [e.get("plWeaponName") for e in edges if e.get("acceptsAmmoPlIndices")],
            }
        )
    return hits


def scan_segment_densities(data: bytes, ne_off: int, seg_tuples: list) -> list:
    """
    Heuristic: find windows where many u16 values fall in 0..600 (cbe name index range).
    """
    hot = []
    for i, s, e in seg_tuples:
        chunk = data[s : min(s + 120000, e)]
        good = 0
        for o in range(0, min(len(chunk), 20000) - 1, 2):
            v = struct.unpack_from("<H", chunk, o)[0]
            if v <= 600:
                good += 1
        if good > 800:
            hot.append(
                {
                    "seg": i,
                    "start": hex(s),
                    "u16_in_range0_600_per_20k": good,
                }
            )
    return hot[:20]


def parse_ne_segments(path: Path) -> tuple[bytes, list]:
    d = path.read_bytes()
    if d[:2] != b"MZ":
        return d, []
    ne = struct.unpack_from("<I", d, 0x3C)[0]
    if d[ne : ne + 2] != b"NE":
        return d, []
    nseg = struct.unpack_from("<H", d, ne + 0x1C)[0]
    st_off = struct.unpack_from("<H", d, ne + 0x22)[0]
    al = struct.unpack_from("<H", d, ne + 0x32)[0]
    segs = []
    base = ne + st_off
    for i in range(nseg):
        o = base + i * 8
        if o + 8 > len(d):
            break
        ro = struct.unpack_from("<H", d, o)[0] << al
        sl = struct.unpack_from("<H", d, o + 2)[0] or 65536
        segs.append((i + 1, ro, min(ro + sl, len(d))))
    return d, segs


def cbe_offset_to_segment(data: bytes, t: int) -> dict | None:
    if data[:2] != b"MZ" or t < 0 or t >= len(data):
        return None
    ne = struct.unpack_from("<I", data, 0x3C)[0]
    if data[ne : ne + 2] != b"NE":
        return None
    nseg = struct.unpack_from("<H", data, ne + 0x1C)[0]
    st = struct.unpack_from("<H", data, ne + 0x22)[0]
    al = struct.unpack_from("<H", data, ne + 0x32)[0]
    base = ne + st
    for i in range(nseg):
        o = base + i * 8
        if o + 8 > len(data):
            break
        ro = struct.unpack_from("<H", data, o)[0] << al
        sl = struct.unpack_from("<H", data, o + 2)[0] or 65536
        if ro <= t < ro + sl:
            return {
                "segment_index_1based": i + 1,
                "seg_file_start": hex(ro),
                "offset_in_segment": t - ro,
            }
    return None


def main() -> None:
    pairs = load_expected_pairs()
    results = {
        "_meta": {
            "description": "Binary scan for (weapon_u16, ammo_u16) little-endian pairs matching explicit cbe indeces",
            "expected_pairs_count": len(pairs),
        },
        "cbe": {},
        "iteml": {},
    }

    cbe = PL / "CBE.EXE"
    if cbe.exists():
        data = cbe.read_bytes()
        results["cbe"] = scan_file(str(cbe), data, pairs)
        t0 = int("0x1dd460", 16)
        results["cbe"]["offset_0_225_first_segment"] = cbe_offset_to_segment(data, t0)
        t1 = int("0x1dc0b4", 16)
        results["cbe"]["offset_7_0_0_230_bar_hypothesis"] = cbe_offset_to_segment(data, t1)

    iteml = PL / "ITEML.DLL"
    if iteml.exists():
        data, segs = parse_ne_segments(iteml)
        results["iteml"]["segment_hotspots"] = scan_segment_densities(data, 0, segs) if segs else []
        results["iteml"].update(
            scan_file(str(iteml), data, pairs)
        )
        results["iteml"]["ne_segment_count"] = len(segs)

    # Export table: count how many (0,225) in CBE vs (100,200) random - signal check
    if cbe.exists():
        data = cbe.read_bytes()
        p0 = u16w(0, 225)
        results["cbe"]["sentinel_0_225_hits"] = len(find_all(data, p0))
        results["cbe"]["sentinel_7_230_hits"] = len(find_all(data, u16w(7, 230)))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print("WROTE", OUT)
    for ph in results.get("cbe", {}).get("pair_hits", [])[:8]:
        print("  CBE", ph.get("label"), "w", ph.get("w"), "a", ph.get("a"), "n", ph.get("count"), "e.g.", ph.get("offsets_hex", [])[:2])


if __name__ == "__main__":
    main()

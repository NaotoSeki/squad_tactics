# -*- coding: utf-8 -*-
"""Probe NE header: ITEML vs INTERMIS — where is the real resource table?"""
import struct
from pathlib import Path

def show(path: str) -> None:
    d = Path(path).read_bytes()
    ne = struct.unpack_from("<I", d, 0x3C)[0]
    assert d[ne : ne + 2] == b"NE", path
    print("===", path, "ne_off", ne, "len", len(d))
    for k in (0x20, 0x22, 0x24, 0x26, 0x28, 0x2A, 0x2C, 0x2E, 0x30, 0x32, 0x34, 0x36, 0x38):
        if ne + k + 2 > len(d):
            break
        w = struct.unpack_from("<H", d, ne + k)[0]
        print(f"  +0x{k:02x}: {w:5d} (0x{w:04x})")

    rwo = struct.unpack_from("<H", d, ne + 0x24)[0]
    for mult in (1, 16, 32):
        abs_off = ne + rwo * mult
        if abs_off + 8 < len(d):
            peek = d[abs_off : abs_off + 20]
            print(
                f"  ne + 0x24({rwo}) * {mult} = {abs_off}  peek {peek.hex()}"
            )
    if ne + 0x36 + 2 <= len(d):
        w36 = struct.unpack_from("<H", d, ne + 0x36)[0]
        w38 = struct.unpack_from("<H", d, ne + 0x38)[0]
        # sometimes resource in bytes from start of file
        for name, a in (("+0x36 as abs", w36), ("+0x38 as abs", w38)):
            if a + 20 < len(d):
                print(f"  {name} -> {a} peek {d[a:a+12].hex()}")


if __name__ == "__main__":
    show(r"D:\PL\ITEML.DLL")
    print()
    show(r"D:\PL\INTERMIS.DLL")

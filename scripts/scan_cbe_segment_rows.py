# -*- coding: utf-8 -*-
"""
Wave 0b: seg ~132 付近の連続 u16 行を、stride 仮定で可視化（手元 CBE 用）。
  set PL_CBE_EXE=path\\to\\CBE.EXE
  未設定時は D:\\PL\\CBE.EXE
"""
import os
import struct
from pathlib import Path

def main() -> None:
    exe = Path(os.environ.get("PL_CBE_EXE", r"D:\PL\CBE.EXE"))
    if not exe.is_file():
        print("CBE not found:", exe, "(set PL_CBE_EXE)")
        return
    data = exe.read_bytes()
    off = 0x1DD460
    words = []
    n = 256
    for i in range(n):
        p = off + 2 * i
        if p + 2 > len(data):
            break
        words.append(struct.unpack_from("<H", data, p)[0])
    print(f"u16 from {off:#x} x{n} words, file={exe}")
    for stride in (12, 16, 20, 24, 32):
        wcount = max(0, n - (stride // 2) * 8)
        print(f"\n--- assume stride {stride} bytes, first 4 logical rows (u16[0..stride/2-1]) ---")
        step = stride // 2
        for row in range(4):
            start = row * step
            if start + step > len(words):
                break
            roww = words[start : start + min(step, 12)]
            print(f"  row{row}", roww)

if __name__ == "__main__":
    main()

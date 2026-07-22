"""Small read-only PE x64 disassembler used for SSC decoder forensics."""

from __future__ import annotations

import argparse
from pathlib import Path
import struct

from capstone import Cs, CS_ARCH_X86, CS_MODE_64


def _u16(data: bytes, offset: int) -> int:
    return struct.unpack_from("<H", data, offset)[0]


def _u32(data: bytes, offset: int) -> int:
    return struct.unpack_from("<I", data, offset)[0]


def _u64(data: bytes, offset: int) -> int:
    return struct.unpack_from("<Q", data, offset)[0]


def image_layout(data: bytes) -> tuple[int, list[tuple[int, int, int, int]]]:
    pe = _u32(data, 0x3C)
    coff = pe + 4
    section_count = _u16(data, coff + 2)
    optional_size = _u16(data, coff + 16)
    optional = coff + 20
    magic = _u16(data, optional)
    if magic == 0x20B:
        image_base = _u64(data, optional + 24)
    elif magic == 0x10B:
        image_base = _u32(data, optional + 28)
    else:
        raise ValueError(f"unsupported PE optional-header magic 0x{magic:x}")
    section_table = optional + optional_size
    sections: list[tuple[int, int, int, int]] = []
    for index in range(section_count):
        entry = section_table + index * 40
        sections.append(
            (
                _u32(data, entry + 12),
                _u32(data, entry + 8),
                _u32(data, entry + 20),
                _u32(data, entry + 16),
            )
        )
    return image_base, sections


def rva_to_offset(sections: list[tuple[int, int, int, int]], rva: int) -> int:
    for virtual, virtual_size, raw, raw_size in sections:
        if virtual <= rva < virtual + max(virtual_size, raw_size):
            return raw + rva - virtual
    raise ValueError(f"RVA 0x{rva:x} is not mapped")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=Path)
    parser.add_argument("rva", type=lambda value: int(value, 0))
    parser.add_argument("--bytes", type=int, default=128)
    args = parser.parse_args()
    data = args.path.read_bytes()
    image_base, sections = image_layout(data)
    offset = rva_to_offset(sections, args.rva)
    code = data[offset : offset + args.bytes]
    decoder = Cs(CS_ARCH_X86, CS_MODE_64)
    for instruction in decoder.disasm(code, image_base + args.rva):
        print(
            f"0x{instruction.address:016x}  "
            f"{instruction.bytes.hex(' '):<28}  "
            f"{instruction.mnemonic:<8} {instruction.op_str}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

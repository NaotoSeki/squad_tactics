"""List PE exports without loading the target DLL."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
import struct


class PeFormatError(ValueError):
    pass


@dataclass(frozen=True)
class Section:
    virtual_address: int
    virtual_size: int
    raw_offset: int
    raw_size: int


def _u16(data: bytes, offset: int) -> int:
    return struct.unpack_from("<H", data, offset)[0]


def _u32(data: bytes, offset: int) -> int:
    return struct.unpack_from("<I", data, offset)[0]


def _rva_offset(sections: list[Section], rva: int) -> int:
    for section in sections:
        span = max(section.virtual_size, section.raw_size)
        if section.virtual_address <= rva < section.virtual_address + span:
            return section.raw_offset + (rva - section.virtual_address)
    raise PeFormatError(f"RVA 0x{rva:x} is not covered by a section")


def list_exports(path: str | Path) -> list[tuple[str, int, int]]:
    data = Path(path).read_bytes()
    if data[:2] != b"MZ":
        raise PeFormatError("missing DOS MZ signature")
    pe = _u32(data, 0x3C)
    if data[pe : pe + 4] != b"PE\0\0":
        raise PeFormatError("missing PE signature")

    coff = pe + 4
    section_count = _u16(data, coff + 2)
    optional_size = _u16(data, coff + 16)
    optional = coff + 20
    magic = _u16(data, optional)
    if magic == 0x20B:
        directory = optional + 112
    elif magic == 0x10B:
        directory = optional + 96
    else:
        raise PeFormatError(f"unsupported optional-header magic 0x{magic:x}")

    export_rva = _u32(data, directory)
    if export_rva == 0:
        return []
    section_table = optional + optional_size
    sections: list[Section] = []
    for index in range(section_count):
        entry = section_table + index * 40
        sections.append(
            Section(
                virtual_size=_u32(data, entry + 8),
                virtual_address=_u32(data, entry + 12),
                raw_size=_u32(data, entry + 16),
                raw_offset=_u32(data, entry + 20),
            )
        )

    export = _rva_offset(sections, export_rva)
    ordinal_base = _u32(data, export + 16)
    function_count = _u32(data, export + 20)
    name_count = _u32(data, export + 24)
    functions = _rva_offset(sections, _u32(data, export + 28))
    names = _rva_offset(sections, _u32(data, export + 32))
    ordinals = _rva_offset(sections, _u32(data, export + 36))

    result: list[tuple[str, int, int]] = []
    for index in range(name_count):
        name_rva = _u32(data, names + index * 4)
        name_offset = _rva_offset(sections, name_rva)
        end = data.index(b"\0", name_offset)
        name = data[name_offset:end].decode("ascii", errors="replace")
        ordinal_index = _u16(data, ordinals + index * 2)
        if ordinal_index >= function_count:
            raise PeFormatError(f"export {name} has an invalid ordinal index")
        function_rva = _u32(data, functions + ordinal_index * 4)
        result.append((name, ordinal_base + ordinal_index, function_rva))
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=Path)
    parser.add_argument("--contains", default="")
    args = parser.parse_args()
    needle = args.contains.casefold()
    for name, ordinal, rva in list_exports(args.path):
        if needle and needle not in name.casefold():
            continue
        print(f"{ordinal:5d}  0x{rva:08x}  {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

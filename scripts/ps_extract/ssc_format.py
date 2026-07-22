"""Low-level reader for Panzer Strike ``.ssc`` sprite containers.

This module intentionally separates the confirmed container layout from the
still-being-reversed scanline codec.  It never mutates the source assets.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import struct


class SscFormatError(ValueError):
    """Raised when an SSC file violates the confirmed container layout."""


@dataclass(frozen=True)
class SscFrame:
    slot: int
    data_size: int
    format_id: int | None = None
    depth: int | None = None
    origin_x: int | None = None
    origin_y: int | None = None
    width: int | None = None
    height: int | None = None
    payload: bytes = b""

    @property
    def is_empty(self) -> bool:
        return self.data_size == 0


@dataclass(frozen=True)
class SscFile:
    source: Path
    frames: tuple[SscFrame, ...]
    trailer: bytes

    @property
    def nonempty_frames(self) -> tuple[SscFrame, ...]:
        return tuple(frame for frame in self.frames if not frame.is_empty)


@dataclass(frozen=True)
class SscScanline:
    row: int
    encoded_size: int
    chunk_count: int
    body: bytes


_U32 = struct.Struct("<I")
_FRAME_HEADER = struct.Struct("<IIhhHH")
_ROW_HEADER = struct.Struct("<HH")


def parse_ssc_bytes(data: bytes, *, source: Path | None = None) -> SscFile:
    if len(data) < _U32.size:
        raise SscFormatError("SSC data is shorter than the slot-count field")

    slot_count = _U32.unpack_from(data, 0)[0]
    if not 1 <= slot_count <= 4096:
        raise SscFormatError(f"implausible SSC slot count: {slot_count}")

    offset = _U32.size
    frames: list[SscFrame] = []
    for slot in range(slot_count):
        if offset + _U32.size > len(data):
            raise SscFormatError(f"slot {slot}: missing data-size field")
        data_size = _U32.unpack_from(data, offset)[0]
        offset += _U32.size
        if data_size == 0:
            frames.append(SscFrame(slot=slot, data_size=0))
            continue

        if offset + _FRAME_HEADER.size + data_size > len(data):
            raise SscFormatError(
                f"slot {slot}: frame overruns file "
                f"(payload={data_size}, offset={offset}, file={len(data)})"
            )
        format_id, depth, origin_x, origin_y, width, height = (
            _FRAME_HEADER.unpack_from(data, offset)
        )
        offset += _FRAME_HEADER.size
        payload = data[offset : offset + data_size]
        offset += data_size
        frames.append(
            SscFrame(
                slot=slot,
                data_size=data_size,
                format_id=format_id,
                depth=depth,
                origin_x=origin_x,
                origin_y=origin_y,
                width=width,
                height=height,
                payload=payload,
            )
        )

    return SscFile(
        source=source or Path("<memory>"),
        frames=tuple(frames),
        trailer=data[offset:],
    )


def read_ssc(path: str | Path) -> SscFile:
    source = Path(path)
    return parse_ssc_bytes(source.read_bytes(), source=source)


def parse_scanlines(frame: SscFrame) -> tuple[SscScanline, ...]:
    """Split a frame payload into confirmed per-row records.

    Each encoded row starts with ``uint16 body_size`` and
    ``uint16 chunk_count``.  Chunk semantics are deliberately left opaque
    until the remaining sub-codec is proven.
    """

    if frame.is_empty:
        return ()
    if frame.height is None:
        raise SscFormatError("nonempty frame is missing its height")

    payload = frame.payload
    offset = 0
    rows: list[SscScanline] = []
    for row in range(frame.height):
        if offset + _ROW_HEADER.size > len(payload):
            raise SscFormatError(f"row {row}: missing scanline header")
        encoded_size, chunk_count = _ROW_HEADER.unpack_from(payload, offset)
        offset += _ROW_HEADER.size
        end = offset + encoded_size
        if end > len(payload):
            raise SscFormatError(
                f"row {row}: body overruns frame "
                f"(body={encoded_size}, offset={offset}, payload={len(payload)})"
            )
        rows.append(
            SscScanline(
                row=row,
                encoded_size=encoded_size,
                chunk_count=chunk_count,
                body=payload[offset:end],
            )
        )
        offset = end

    if offset != len(payload):
        raise SscFormatError(
            f"scanline payload has {len(payload) - offset} unexplained bytes"
        )
    return tuple(rows)

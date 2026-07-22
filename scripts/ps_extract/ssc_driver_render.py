"""Render an SSC frame through Panzer Strike's installed graphics driver.

This is a local interoperability probe.  It calls only the driver's exported
pixel-buffer functions and never writes to the game installation.
"""

from __future__ import annotations

import argparse
import ctypes
import os
from pathlib import Path
import struct

from PIL import Image

try:
    from .ssc_format import read_ssc
except ImportError:  # Direct script execution.
    from ssc_format import read_ssc


class Size(ctypes.Structure):
    _fields_ = [("width", ctypes.c_int32), ("height", ctypes.c_int32)]


class Point(ctypes.Structure):
    _fields_ = [("x", ctypes.c_int32), ("y", ctypes.c_int32)]


class Rect(ctypes.Structure):
    _fields_ = [
        ("x", ctypes.c_int32),
        ("y", ctypes.c_int32),
        ("width", ctypes.c_int32),
        ("height", ctypes.c_int32),
    ]


class Sprite(ctypes.Structure):
    _fields_ = [
        ("format_id", ctypes.c_uint32),
        ("depth", ctypes.c_uint32),
        ("origin_x", ctypes.c_int16),
        ("origin_y", ctypes.c_int16),
        ("width", ctypes.c_uint16),
        ("height", ctypes.c_uint16),
        ("data", ctypes.c_void_p),
    ]


def read_palette(path: Path) -> ctypes.Array[ctypes.c_uint32]:
    data = path.read_bytes()
    if len(data) != 1024 or struct.unpack_from("<I", data, 0)[0] != 1020:
        raise ValueError(f"unsupported SPL palette layout: {path}")
    palette = (ctypes.c_uint32 * 256)()
    palette[0] = 0
    for index, value in enumerate(struct.unpack_from("<255I", data, 4), start=1):
        palette[index] = value
    return palette


def render(
    driver_path: Path,
    ssc_path: Path,
    spl_path: Path,
    output_path: Path,
    *,
    slot: int,
    margin: int,
) -> None:
    sprite_file = read_ssc(ssc_path)
    frame = sprite_file.frames[slot]
    if frame.is_empty:
        raise ValueError(f"SSC slot {slot} is empty")
    assert frame.format_id is not None
    assert frame.depth is not None
    assert frame.origin_x is not None
    assert frame.origin_y is not None
    assert frame.width is not None
    assert frame.height is not None

    payload = ctypes.create_string_buffer(frame.payload)
    sprite = Sprite(
        format_id=frame.format_id,
        depth=frame.depth,
        origin_x=frame.origin_x,
        origin_y=frame.origin_y,
        width=frame.width,
        height=frame.height,
        data=ctypes.cast(payload, ctypes.c_void_p),
    )
    palette = read_palette(spl_path)

    canvas_width = frame.width + margin * 2
    canvas_height = frame.height + margin * 2
    point = Point(margin - frame.origin_x, margin - frame.origin_y)
    clip = Rect(0, 0, canvas_width, canvas_height)

    os.add_dll_directory(str(driver_path.parent))
    driver = ctypes.WinDLL(str(driver_path))
    driver.PixelBufferCreate.argtypes = [ctypes.POINTER(Size)]
    driver.PixelBufferCreate.restype = ctypes.c_void_p
    driver.PixelBufferDelete.argtypes = [ctypes.c_void_p]
    driver.PixelBufferGetDataPtr.argtypes = [ctypes.c_void_p]
    driver.PixelBufferGetDataPtr.restype = ctypes.c_void_p
    driver.PixelBufferGetPitch.argtypes = [ctypes.c_void_p]
    driver.PixelBufferGetPitch.restype = ctypes.c_int32
    driver.PixelBufferSpriteDraw8Bpp.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(Sprite),
        ctypes.POINTER(ctypes.c_uint32),
        ctypes.POINTER(Point),
        ctypes.POINTER(Rect),
    ]
    driver.PixelBufferSpriteDraw8Bpp.restype = None

    pixel_buffer = driver.PixelBufferCreate(Size(canvas_width, canvas_height))
    if not pixel_buffer:
        raise RuntimeError("PixelBufferCreate returned null")
    try:
        driver.PixelBufferSpriteDraw8Bpp(
            pixel_buffer,
            ctypes.byref(sprite),
            palette,
            ctypes.byref(point),
            ctypes.byref(clip),
        )
        pitch = driver.PixelBufferGetPitch(pixel_buffer)
        data_ptr = driver.PixelBufferGetDataPtr(pixel_buffer)
        if not data_ptr or pitch < canvas_width:
            raise RuntimeError(f"invalid driver buffer (ptr={data_ptr}, pitch={pitch})")
        raw = ctypes.string_at(data_ptr, pitch * canvas_height * 4)
        image = Image.frombytes("RGBA", (pitch, canvas_height), raw, "raw", "BGRA")
        if pitch != canvas_width:
            image = image.crop((0, 0, canvas_width, canvas_height))
        output_path.parent.mkdir(parents=True, exist_ok=True)
        image.save(output_path)
    finally:
        driver.PixelBufferDelete(pixel_buffer)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("ssc", type=Path)
    parser.add_argument("spl", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--slot", type=int, default=0)
    parser.add_argument("--margin", type=int, default=8)
    parser.add_argument(
        "--driver",
        type=Path,
        default=Path(
            r"C:\Program Files (x86)\Steam\steamapps\common\Panzer Strike Demo"
            r"\Drivers\Driver.Direct3D9.dll"
        ),
    )
    args = parser.parse_args()
    render(
        args.driver,
        args.ssc,
        args.spl,
        args.output,
        slot=args.slot,
        margin=args.margin,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

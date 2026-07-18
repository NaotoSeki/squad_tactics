import struct
import unittest
from pathlib import Path

from scripts.ps_extract.ssc_format import (
    SscFormatError,
    parse_scanlines,
    parse_ssc_bytes,
)


class SscFormatTests(unittest.TestCase):
    def test_container_with_empty_frame_payload_and_trailer(self):
        payload = struct.pack("<HH", 3, 1) + b"abc"
        data = (
            struct.pack("<I", 2)
            + struct.pack("<I", 0)
            + struct.pack("<I", len(payload))
            + struct.pack("<IIhhHH", 723, 8, -4, 7, 9, 1)
            + payload
            + b"TRAILER"
        )

        parsed = parse_ssc_bytes(data, source=Path("sample.ssc"))

        self.assertEqual(len(parsed.frames), 2)
        self.assertTrue(parsed.frames[0].is_empty)
        frame = parsed.frames[1]
        self.assertEqual(frame.format_id, 723)
        self.assertEqual((frame.origin_x, frame.origin_y), (-4, 7))
        self.assertEqual((frame.width, frame.height), (9, 1))
        self.assertEqual(parsed.trailer, b"TRAILER")
        rows = parse_scanlines(frame)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].encoded_size, 3)
        self.assertEqual(rows[0].chunk_count, 1)
        self.assertEqual(rows[0].body, b"abc")

    def test_scanline_rejects_unexplained_payload_bytes(self):
        payload = struct.pack("<HH", 1, 1) + b"x" + b"extra"
        data = (
            struct.pack("<I", 1)
            + struct.pack("<I", len(payload))
            + struct.pack("<IIhhHH", 723, 8, 0, 0, 1, 1)
            + payload
        )
        frame = parse_ssc_bytes(data).frames[0]
        with self.assertRaisesRegex(SscFormatError, "unexplained bytes"):
            parse_scanlines(frame)

    def test_container_rejects_payload_overrun(self):
        data = (
            struct.pack("<I", 1)
            + struct.pack("<I", 99)
            + struct.pack("<IIhhHH", 723, 8, 0, 0, 1, 1)
        )
        with self.assertRaisesRegex(SscFormatError, "overruns file"):
            parse_ssc_bytes(data)


if __name__ == "__main__":
    unittest.main()

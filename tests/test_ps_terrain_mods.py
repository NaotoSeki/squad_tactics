"""立体物台帳から導出した地形modの整合と、盤面が「動く理由」を持つことの検証。

2026-08-03。地形テーブルは1ヘックス＝1種別の単値なので、台帳が持つ低木70個・柵27個が
まるごと捨てられ、**射程内ペアの81%が素通し＝全員が全員を見通せる平原**になっていた。
機動する理由が盤面に無いので、AIが撃ち合ったまま固まるのは正しい判断だった。

ここで縛るのは2つ:
  1. mod が台帳から機械的に導かれていること（手で足すと絵と地形がずれる）
  2. 導出後の盤面が実際に死角を持つこと（＝側面機動が幾何的に成立する）
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAPS = ROOT / "asset" / "environment" / "maps"
MODS_JS = MAPS / "ps_terrain_mods.js"

sys.path.insert(0, str(ROOT / "scripts"))
import derive_terrain_mods as D  # noqa: E402


def _js_object_literal(path: Path, varname: str) -> dict:
    """`window.<varname> = { ... };` の中身を JSON として読む。

    先頭コメントにも波括弧が出るので、代入の右辺から切り出すこと。
    """
    src = path.read_text(encoding="utf-8")
    start = src.index("{", src.index(varname))
    body = src[start: src.rindex("}") + 1]
    body = re.sub(r",(\s*[}\]])", r"\1", body)   # 末尾カンマを落とす
    return json.loads(body)


def load_mods() -> dict:
    return _js_object_literal(MODS_JS, "PS_TERRAIN_MODS")


def load_battlefields() -> dict:
    return _js_object_literal(MAPS / "ps_battlefields.js", "PS_BATTLEFIELDS")


TERRAIN = {
    "GRASS": {"id": 1, "cover": 10, "cost": 1},
    "FOREST": {"id": 2, "cover": 25, "cost": 2},
    "ROAD": {"id": 3, "cover": 0, "cost": 1},
    "RUIN": {"id": 4, "cover": 40, "cost": 2},
    "BLDG": {"id": 6, "cover": 0, "cost": 99, "building": True},
    "FIELD": {"id": 7, "cover": 15, "cost": 2},
}
SIGHT_BLOCK = {1: 0, 2: 0.5, 3: 0, 4: 1.0, 5: 0, 6: 1.0, 7: 0, -1: 0}
THRESHOLD = 1.0


def hex_line(a, b):
    """sim_battle_adapter.hexLine と同じ立方体座標の線形補間。"""
    def to_cube(h):
        return (h[0], -h[0] - h[1], h[1])

    ax, ay, az = to_cube(a)
    bx, by, bz = to_cube(b)
    n = max(abs(ax - bx), abs(ay - by), abs(az - bz))
    if n == 0:
        return [a]
    out = []
    for i in range(n + 1):
        t = i / n
        x = ax + (bx - ax) * t + 1e-6
        y = ay + (by - ay) * t + 2e-6
        z = az + (bz - az) * t - 3e-6
        rx, ry, rz = round(x), round(y), round(z)
        dx, dy, dz = abs(rx - x), abs(ry - y), abs(rz - z)
        if dx > dy and dx > dz:
            rx = -ry - rz
        elif dy > dz:
            ry = -rx - rz
        else:
            rz = -rx - ry
        out.append((rx, rz))
    return out


def build_cells(key, bf, mods):
    cells = {}
    for r, q0, names in bf[key]["rows"]:
        for i, name in enumerate(names):
            q = q0 + i
            c = dict(TERRAIN[name])
            m = mods.get(key, {}).get(f"{q},{r}")
            if m and not c.get("building"):
                add_block, add_cover = m
                if add_block > 0:
                    c["sightBlock"] = min(1.0, SIGHT_BLOCK.get(c["id"], 0) + add_block)
                if add_cover > 0:
                    c["cover"] = min(45, c["cover"] + add_cover)
            cells[(q, r)] = c
    return cells


def blocked_fraction(cells):
    passable = [h for h, c in cells.items() if c["cost"] < 99]
    pairs = blocked = 0
    for i, a in enumerate(passable):
        for b in passable[i + 1:]:
            d = (abs(a[0] - b[0]) + abs(a[0] + a[1] - b[0] - b[1]) + abs(a[1] - b[1])) // 2
            if d < 2 or d > 7:
                continue
            pairs += 1
            lo, hi = (a, b) if (a[0], a[1]) <= (b[0], b[1]) else (b, a)
            acc = 0.0
            for h in hex_line(lo, hi)[1:-1]:
                c = cells.get(h)
                if c is None:
                    continue
                if c.get("building") or c["cost"] >= 99:
                    blocked += 1
                    break
                acc += c.get("sightBlock", SIGHT_BLOCK.get(c["id"], 0))
                if acc >= THRESHOLD:
                    blocked += 1
                    break
    return blocked / pairs, pairs


class TerrainModsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mods = load_mods()
        cls.bf = load_battlefields()

    def test_generated_file_is_up_to_date(self):
        """台帳を編集したのに再生成し忘れた、を防ぐ。"""
        for path in sorted(MAPS.glob("*_objects.json")):
            key = path.name[: -len("_objects.json")]
            expected = D.derive(json.loads(path.read_text(encoding="utf-8")))
            with self.subTest(map=key):
                self.assertEqual(self.mods.get(key, {}), expected,
                                 "scripts/derive_terrain_mods.py を再実行すること")

    def test_mods_only_touch_hexes_that_have_objects(self):
        """絵に無いところへ遮蔽を足していないこと（芝生で兵士が隠れるのを防ぐ）。"""
        for key, per in self.mods.items():
            ledger = json.loads((MAPS / f"{key}_objects.json").read_text(encoding="utf-8"))
            occupied = {f"{o['hex'][0]},{o['hex'][1]}" for o in ledger["objects"] if o.get("hex")}
            with self.subTest(map=key):
                self.assertTrue(set(per).issubset(occupied),
                                f"台帳に無いヘックスへ mod が付いている: {set(per) - occupied}")

    def test_board_actually_has_dead_ground(self):
        """導出後の盤面が死角を持つこと。ここが本題で、無ければ機動に意味が出ない。"""
        fracs = {}
        for key in self.mods:
            if key not in self.bf:
                continue
            frac, pairs = blocked_fraction(build_cells(key, self.bf, self.mods))
            fracs[key] = frac
            with self.subTest(map=key):
                self.assertGreater(frac, 0.10, f"{key}: 遮蔽率 {frac:.1%} は平原すぎる")
                self.assertLess(frac, 0.70, f"{key}: 遮蔽率 {frac:.1%} は塞がりすぎ（撃ち合いが成立しない）")
        avg = sum(fracs.values()) / len(fracs)
        self.assertGreater(avg, 0.25, f"平均遮蔽率 {avg:.1%} が低すぎる（導入前は12.0%）")

    def test_buildings_are_not_weakened(self):
        """建物は単独で完全遮蔽・不可侵のまま。mod で上書きしない。"""
        for key in self.mods:
            if key not in self.bf:
                continue
            cells = build_cells(key, self.bf, self.mods)
            for h, c in cells.items():
                if c.get("building"):
                    with self.subTest(map=key, hex=h):
                        self.assertEqual(c["cost"], 99)
                        self.assertNotIn("sightBlock", c)

    def test_script_is_deterministic(self):
        """同じ台帳から同じ結果が出ること（再生成で差分が暴れない）。"""
        before = MODS_JS.read_text(encoding="utf-8")
        subprocess.run([sys.executable, str(ROOT / "scripts" / "derive_terrain_mods.py")],
                       check=True, capture_output=True)
        self.assertEqual(before, MODS_JS.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()

"""シートの方向行順（manifest.dirOrder）を、**実シートのピクセルから**検証する。

2026-08-03、「撃ち合っている二人が互いに逆を向く」の原因がこれだった。
`dirOrder` は repack_soldier_sheets_v2.py のハードコード文字列で誰も測っておらず、
実物に対して**鏡像かつ45°ずれて**いた（旧: S,SE,E,NE,N,NW,W,SW）。

厄介なのは、この手のバグが**自己整合するコードでは絶対に検出できない**ことで、
実際 phaser_soldier_view.js の向き計算をそれ自身の規約で検算しても一致率99%と出た。
規約を「絵」に結び付けられるのはここだけなので、この検証はピクセルから行う。

検証の鎖:
  ここ            : manifest.dirOrder  <-> 実シートのピクセル
  soldier_facing.test.js : soldierDirFromDelta <-> manifest.dirOrder
"""
from __future__ import annotations

import json
import math
import unittest
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SPRITES = ROOT / "asset" / "sprites" / "soldier"

# 画面座標の単位ベクトル（y は下向き正）
SCREEN_VEC = {
    "S": (0.0, 1.0), "SW": (-0.70711, 0.70711), "W": (-1.0, 0.0), "NW": (-0.70711, -0.70711),
    "N": (0.0, -1.0), "NE": (0.70711, -0.70711), "E": (1.0, 0.0), "SE": (0.70711, 0.70711),
}
# 小銃を構えている姿勢のみ。stand_idle は銃を下ろしていて前方への張り出しが無く、
# 重心の偏りが向きを表さない（実測で N/NE がゼロ近傍の反符号になる）。
AIMING_ACTIONS = ("prone_idle", "stand_fire", "kneel_fire")


def load_manifest() -> dict:
    return json.loads((SPRITES / "manifest.json").read_text(encoding="utf-8"))


def cell_alpha(manifest: dict, action: str, direction: int, frame: int = 0):
    """指定 (方向, フレーム) セルのアルファチャンネルを切り出す。"""
    meta = manifest["actions"][action]
    fw, fh, cols, n = meta["frameW"], meta["frameH"], meta["cols"], meta["frames"]
    img = Image.open(SPRITES / meta["file"]).convert("RGBA")
    i = direction * n + frame
    x0, y0 = (i % cols) * fw, (i // cols) * fh
    return img.crop((x0, y0, x0 + fw, y0 + fh)).getchannel("A")


def silhouette(alpha):
    """(幅, 高さ, 重心のbbox中心からのずれ) を返す。"""
    bb = alpha.getbbox()
    px = alpha.load()
    sx = sy = tot = 0.0
    for y in range(bb[1], bb[3]):
        for x in range(bb[0], bb[2]):
            v = px[x, y]
            if v:
                sx += x * v
                sy += y * v
                tot += v
    ox = sx / tot - (bb[0] + bb[2]) / 2.0
    oy = sy / tot - (bb[1] + bb[3]) / 2.0
    return bb[2] - bb[0], bb[3] - bb[1], ox, oy


class SoldierDirOrderTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = load_manifest()
        cls.order = cls.manifest["dirOrder"]

    def test_dir_order_is_a_valid_45deg_sequence(self):
        """8方位が重複なく、45°ずつ一定の向きに回ること。"""
        self.assertEqual(len(self.order), 8)
        self.assertEqual(set(self.order), set(SCREEN_VEC), "8方位が揃っていない")
        angles = [math.atan2(-SCREEN_VEC[d][1], SCREEN_VEC[d][0]) for d in self.order]
        steps = []
        for i in range(8):
            d = (angles[(i + 1) % 8] - angles[i]) % (2 * math.pi)
            steps.append(round(math.degrees(d)))
        self.assertEqual(set(steps), {315}, f"45°の等間隔・一定回転になっていない: {steps}")

    def test_view_axis_rows_are_the_narrowest(self):
        """N/S（視線軸に沿う）は最も細く、E/W（横向き）は最も広い。

        カーディナルがどの行に来るかを決めるのはこの幅で、旧 dirOrder の
        「row 0 = S」は**偶数行にカーディナルを置く**ため原理的に成立しない。
        """
        for action in ("prone_idle", "stand_fire"):
            with self.subTest(action=action):
                widths = [silhouette(cell_alpha(self.manifest, action, d))[0] for d in range(8)]
                rank = sorted(range(8), key=lambda d: widths[d])
                narrow = {self.order[rank[0]], self.order[rank[1]]}
                wide = {self.order[rank[-1]], self.order[rank[-2]]}
                self.assertEqual(narrow, {"N", "S"},
                                 f"最も細い2行が N/S でない: 幅={widths} 順={self.order}")
                self.assertEqual(wide, {"E", "W"},
                                 f"最も広い2行が E/W でない: 幅={widths} 順={self.order}")

    def test_prone_facing_away_is_taller(self):
        """伏せて『奥を向く』(N) 方が『手前を向く』(S) より画面上で背が高い。

        N/S のどちらがどちらかを決める（幅だけでは区別できない）。低仰角カメラでは
        奥へ伸びた体が画面の上方向へ広がる。
        """
        n_row = self.order.index("N")
        s_row = self.order.index("S")
        h_n = silhouette(cell_alpha(self.manifest, "prone_idle", n_row))[1]
        h_s = silhouette(cell_alpha(self.manifest, "prone_idle", s_row))[1]
        self.assertGreater(h_n, h_s + 3, f"奥向き(row{n_row})が手前向き(row{s_row})より高くない: {h_n} vs {h_s}")

    def test_mass_trails_behind_the_aim(self):
        """重心は常に狙いの**反対側**へ寄る（脚と胴が後ろに残る）。

        左右の別（E と W、および斜め）を決めるのはこれ。幅・高さは鏡像で不変なので、
        この符号だけが handedness を機械的に固定できる。
        """
        for action in AIMING_ACTIONS:
            for d in range(8):
                name = self.order[d]
                vx, vy = SCREEN_VEC[name]
                _, _, ox, oy = silhouette(cell_alpha(self.manifest, action, d))
                dot = ox * vx + oy * vy
                with self.subTest(action=action, row=d, dir=name):
                    self.assertLess(dot, 0.0,
                                    f"{action} row{d}({name}) の重心が狙い側へ寄っている "
                                    f"(重心ずれ=({ox:+.2f},{oy:+.2f}) 向き=({vx:+.2f},{vy:+.2f}) dot={dot:+.2f})")

    def test_repack_script_declares_the_same_order(self):
        """次に repack した時に古い順序へ戻らないこと。"""
        src = (ROOT / "scripts" / "repack_soldier_sheets_v2.py").read_text(encoding="utf-8")
        literal = '"dirOrder": [' + ", ".join(f'"{d}"' for d in self.order) + "],"
        self.assertIn(literal, src, "repack スクリプトの dirOrder が manifest と食い違っている")


if __name__ == "__main__":
    unittest.main()

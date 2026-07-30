"""合成兵士クリップ（sp_synth_clips.py / synth_clips.json）の整合と、実レンダで踏んだ罠の再発防止。

罠の出所は docs/SOLDIER_MOTION_PLAN.md §7 と synth_clips.json の _angle_lesson。
どちらも「レンダして目で見て初めて分かった」類なので、prose ではなくここで機械的に留める。
"""
from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PIPELINE = ROOT / "scripts" / "soldier_pipeline"
SYNTH_SPEC = PIPELINE / "synth_clips.json"
JOBS = PIPELINE / "jobs.json"
CONFIG = PIPELINE / "config.json"

# 脊椎チェーンの累積前傾ピッチ上限（度）。これを超えると「隠れる」ではなく「崩れ落ちる」絵になる。
# 2026-07-30 に累積30°で実際に失敗し、12°前後へ引き下げて合格させた。
PITCH_CHAIN = (
    "mixamorig:Spine",
    "mixamorig:Spine1",
    "mixamorig:Spine2",
)
HEAD_CHAIN = ("mixamorig:Neck", "mixamorig:Head")
MAX_TORSO_PITCH = 24.0
MAX_HEAD_PITCH = 16.0


def action_to_manifest_name(action_name: str) -> str:
    """Blender アクション名を repack 後の manifest アクション名へ変換する。"""
    return action_name.lower().replace(".", "_")


class SoldierSynthClipsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.spec = json.loads(SYNTH_SPEC.read_text(encoding="utf-8"))
        cls.jobs = json.loads(JOBS.read_text(encoding="utf-8"))
        cls.config = json.loads(CONFIG.read_text(encoding="utf-8"))
        cls.clips = cls.spec["clips"]
        cls.jobs_by_action = {
            job["action"]: job
            for job in cls.jobs["jobs"]
            if isinstance(job, dict) and "action" in job
        }

    def test_spec_shape_and_unique_names(self) -> None:
        self.assertIsInstance(self.clips, list)
        self.assertGreater(len(self.clips), 0)
        names = [clip["name"] for clip in self.clips]
        self.assertEqual(len(names), len(set(names)), "合成クリップ名が重複している")

    def test_pipeline_config_wires_synth_stage(self) -> None:
        """config に synth_clips が無いと合成ステージが黙ってスキップされる。"""
        self.assertIn("synth_clips", self.config)
        self.assertTrue(Path(self.config["synth_clips"]).name == "synth_clips.json")

    def test_every_clip_has_a_render_job_with_step_one(self) -> None:
        """合成側で既に間引いているので、レンダ job の step は必ず 1。

        step>1 だと二重間引きになり、遷移クリップは数フレームまで潰れる。
        """
        for clip in self.clips:
            name = clip["name"]
            with self.subTest(clip=name):
                self.assertIn(name, self.jobs_by_action, f"jobs.json に {name} の job が無い")
                self.assertEqual(
                    1,
                    self.jobs_by_action[name].get("step", 1),
                    f"{name} の job step は 1 でなければならない（合成側で間引き済み）",
                )

    def test_hit_clips_never_derive_from_dying(self) -> None:
        """被弾フリンチを Dying から切り出してはいけない。

        Dying は初動で小銃を手放すため、掠っただけで銃を投げ捨てる絵になる
        （2026-07-30 実レンダで確認・撤回済み）。
        """
        for clip in self.clips:
            if not clip["name"].endswith(".Hit"):
                continue
            with self.subTest(clip=clip["name"]):
                for source in self._source_actions(clip):
                    self.assertNotIn(
                        "Dying",
                        source,
                        f"{clip['name']} が Dying 由来になっている（小銃を落とす）",
                    )

    def test_lean_offsets_stay_within_calibrated_pitch(self) -> None:
        """脊椎の累積前傾が較正済みの上限を超えていないこと。"""
        for clip in self.clips:
            for index, op in enumerate(clip.get("ops", [])):
                if op.get("op") != "offset":
                    continue
                bones = op["bones"]
                torso = sum(abs(bones.get(b, [0, 0, 0])[0]) for b in PITCH_CHAIN)
                head = sum(abs(bones.get(b, [0, 0, 0])[0]) for b in HEAD_CHAIN)
                with self.subTest(clip=clip["name"], op=index):
                    self.assertLessEqual(
                        torso,
                        MAX_TORSO_PITCH,
                        f"{clip['name']}: 胴の累積ピッチ {torso}° が上限 {MAX_TORSO_PITCH}° 超",
                    )
                    self.assertLessEqual(
                        head,
                        MAX_HEAD_PITCH,
                        f"{clip['name']}: 頭の累積ピッチ {head}° が上限 {MAX_HEAD_PITCH}° 超",
                    )

    def test_cover_fire_leans_by_roll_not_pitch(self) -> None:
        """乗り出しはロール(Z)で作る。ピッチ主導だと肩付けが解けて照準の絵が壊れる。"""
        for clip in self.clips:
            name = clip["name"]
            # Trans.* は既にオフセット済みの遮蔽クリップを繋ぐだけなので offset op を持たない
            if name.startswith("Trans.") or not name.endswith(".Cover_Fire"):
                continue
            offsets = [op for op in clip.get("ops", []) if op.get("op") == "offset"]
            self.assertTrue(offsets, f"{clip['name']} に offset op が無い")
            bones = offsets[0]["bones"]
            roll = sum(abs(bones.get(b, [0, 0, 0])[2]) for b in PITCH_CHAIN)
            pitch = sum(abs(bones.get(b, [0, 0, 0])[0]) for b in PITCH_CHAIN)
            with self.subTest(clip=clip["name"]):
                self.assertGreater(
                    roll, pitch, f"{clip['name']}: ロール({roll}°) がピッチ({pitch}°) を上回るべき"
                )

    def test_transitions_reference_defined_cover_clips(self) -> None:
        """遷移クリップは先に定義された遮蔽クリップだけを入力に取る。"""
        defined: set[str] = set()
        for clip in self.clips:
            for source in self._source_actions(clip):
                if source.startswith(("Kneel.Cover", "Stand.Cover")):
                    with self.subTest(clip=clip["name"], source=source):
                        self.assertIn(
                            source,
                            defined,
                            f"{clip['name']} が未定義の {source} を参照している（定義順が逆）",
                        )
            defined.add(clip["name"])

    def _source_actions(self, clip: dict) -> list[str]:
        """clip の入力アクション名を列挙する。"""
        if "source" in clip:
            return [clip["source"]["action"]]
        return [segment["action"] for segment in clip["splice"]]


if __name__ == "__main__":
    unittest.main()

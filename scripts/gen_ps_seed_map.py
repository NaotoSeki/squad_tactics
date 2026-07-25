#!/usr/bin/env python3
"""PS実アセットから、シードごとに異なる「ゲームとして意味のある」戦場マップを生成する。

旧実装 scripts/ps_extract/render_ps_seed_map.py（実測クラスタを5個選んで移植）は廃止。
content量がクラスタ5個分に固定されるためキャンバスを盤面サイズへ広げると73%が地色で
残り、かつ盤としての妥当性（連結性・スポーン地帯・道の連続）を保証していなかった。

本実装はフローを反転する:
  Phase A  先に30hexの盤面計画を立てる（ゲーム契約を構成的に保証、シード決定的）
  Phase B  その計画に従ってPSの絵を合成する（実測クラスタは"部品ライブラリ"として使う）
  Phase C  ps_battlefield/v1 スキーマで出力（ゲーム側は無改造で読める）

アセット語彙はハードコードせず、grammarの実測placementsから構築する。
補間・リサンプリング・色調補正は一切かけない（PS原寸のまま）。
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
from collections import Counter, defaultdict, deque
from pathlib import Path
from typing import Any, Iterable

from PIL import Image, ImageDraw, ImageFont

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent

# render_ps_native_crop.py は同ディレクトリのモジュールをトップレベル名でimportするため、
# ps_extract/ 自体を sys.path へ入れる必要がある。
sys.path.insert(0, str(SCRIPT_DIR / "ps_extract"))
sys.path.insert(0, str(SCRIPT_DIR))

from render_ps_native_crop import (  # noqa: E402
    SpriteIndex,
    resolve_fence_layers,
    stable_variant,
    stamp_entry,
)
from build_ps_battlefield import (  # noqa: E402
    BOARD_ROWS,
    HEX_SIZE,
    ROW_LEN,
    TERRAIN_COLORS,
    hex_to_px,
    write_registry,
)

Terrain = str
Placement = dict[str, Any]
ManifestEntry = dict[str, Any]

PASSABLE_TERRAINS: set[Terrain] = {"GRASS", "FOREST", "ROAD", "FIELD"}

# slot1(倒伏地表) を持つ family。実測: Objects/Plants/ の112種が (1,2,4) 構成。
PLANT_FAMILIES: set[str] = {"shrub", "flower", "plant"}

# 地表として先に敷く低層family。立体物(影+本体)とは描画段が違う。
LOW_FAMILIES: set[str] = {
    "terrain",
    "grass",
    "ground_feature",
    "ground_spot",
    "road",
    "field",
    "flower",
}


def repo_path(path: Path) -> Path:
    """相対指定をリポジトリルート基準で解決する。"""
    return path if path.is_absolute() else REPO_ROOT / path


def parse_base_color(value: str) -> tuple[int, int, int, int]:
    parts = value.split(",")
    if len(parts) != 3:
        raise argparse.ArgumentTypeError("base color は R,G,B 形式で指定してください")
    try:
        rgb = tuple(int(part.strip()) for part in parts)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("base color は整数 R,G,B 形式で指定してください") from exc
    if any(channel < 0 or channel > 255 for channel in rgb):
        raise argparse.ArgumentTypeError("base color の各値は 0..255 です")
    return rgb[0], rgb[1], rgb[2], 255


def cells_from_board_rows() -> list[tuple[int, int]]:
    """build_ps_battlefield と同じ BOARD_ROWS からセル列を得る。"""
    return [(q, r) for r, start_q in BOARD_ROWS for q in range(start_q, start_q + ROW_LEN)]


def local_neighbors(cell: tuple[int, int], valid_cells: set[tuple[int, int]]) -> list[tuple[int, int]]:
    """盤面契約にある axial 6近傍のうち、盤内のものだけを返す。"""
    q, r = cell
    candidates = [
        (q + 1, r),
        (q - 1, r),
        (q, r + 1),
        (q + 1, r - 1),
        (q - 1, r + 1),
        (q, r - 1),
    ]
    return [candidate for candidate in candidates if candidate in valid_cells]


def px_to_hex_local(x: float, y: float) -> tuple[int, int]:
    """hex_to_px の逆。Renderer.roundHex と同じ cube 丸め。"""
    rf = y / (HEX_SIZE * 1.5)
    qf = x / (HEX_SIZE * math.sqrt(3.0)) - rf / 2.0
    rq, rr = round(qf), round(rf)
    rs = round(-qf - rf)
    dq, dr, ds = abs(rq - qf), abs(rr - rf), abs(rs - (-qf - rf))
    if dq > dr and dq > ds:
        rq = -rr - rs
    elif dr > ds:
        rr = -rq - rs
    return rq, rr


def row_start_q(r: int) -> int:
    return next(start_q for row_r, start_q in BOARD_ROWS if row_r == r)


def terrain_rows(plan: dict[tuple[int, int], Terrain]) -> list[list[Any]]:
    """ps_battlefield/v1 の rows 形式へ変換する。絵からの逆算ではなく計画をそのまま出す。"""
    return [
        [r, start_q, [plan[(q, r)] for q in range(start_q, start_q + ROW_LEN)]]
        for r, start_q in BOARD_ROWS
    ]


# --------------------------------------------------------------------------
# Phase A: 盤面計画
# --------------------------------------------------------------------------


def component_sizes(
    plan: dict[tuple[int, int], Terrain],
    cells: set[tuple[int, int]],
) -> list[int]:
    """BLDG(cost99)を除く歩行可能セルの連結成分サイズを降順で返す。"""
    passable = {cell for cell in cells if plan[cell] in PASSABLE_TERRAINS}
    remaining = set(passable)
    sizes: list[int] = []

    while remaining:
        start = remaining.pop()
        queue: deque[tuple[int, int]] = deque([start])
        size = 1
        while queue:
            cell = queue.popleft()
            for adjacent in local_neighbors(cell, cells):
                if adjacent in remaining:
                    remaining.remove(adjacent)
                    queue.append(adjacent)
                    size += 1
        sizes.append(size)

    return sorted(sizes, reverse=True)


def rows_connected(
    plan: dict[tuple[int, int], Terrain],
    cells: set[tuple[int, int]],
) -> bool:
    """r=7 と r=12 の歩行可能セル間に、歩行可能セルだけを辿る経路があるか。"""
    starts = [cell for cell in cells if cell[1] == 7 and plan[cell] in PASSABLE_TERRAINS]
    targets = {cell for cell in cells if cell[1] == 12 and plan[cell] in PASSABLE_TERRAINS}
    if not starts or not targets:
        return False

    visited = set(starts)
    queue: deque[tuple[int, int]] = deque(starts)
    while queue:
        cell = queue.popleft()
        if cell in targets:
            return True
        for adjacent in local_neighbors(cell, cells):
            if adjacent not in visited and plan[adjacent] in PASSABLE_TERRAINS:
                visited.add(adjacent)
                queue.append(adjacent)
    return False


def audit_plan(
    plan: dict[tuple[int, int], Terrain],
    cells: set[tuple[int, int]],
) -> tuple[bool, dict[str, Any], Counter[str]]:
    """Phase A のゲーム盤契約を検証する。"""
    counts: Counter[str] = Counter(plan.values())
    sizes = component_sizes(plan, cells)
    passable_count = sum(sizes)
    connected = len(sizes) == 1
    south_spawn = sum(1 for cell in cells if cell[1] >= 10 and plan[cell] in PASSABLE_TERRAINS)
    north_spawn = sum(1 for cell in cells if cell[1] < 10 and plan[cell] in PASSABLE_TERRAINS)

    ok = (
        connected
        and south_spawn >= 5
        and north_spawn >= 5
        and counts["ROAD"] >= 3
        and 2 <= counts["BLDG"] <= 6
        and rows_connected(plan, cells)
    )

    connectivity = {
        "ok": connected,
        "passable": passable_count,
        "component_sizes": sizes,
    }
    return ok, connectivity, counts


def choose_connected_group(
    rng: random.Random,
    candidates: set[tuple[int, int]],
    cells: set[tuple[int, int]],
    desired_count: int,
) -> set[tuple[int, int]] | None:
    """候補集合から、互いに隣接する desired_count 個の塊を構成する。"""
    if len(candidates) < desired_count:
        return None

    start = rng.choice(sorted(candidates))
    group = {start}
    frontier = set(local_neighbors(start, cells)) & candidates

    while len(group) < desired_count:
        frontier -= group
        if not frontier:
            return None
        selected = rng.choice(sorted(frontier))
        frontier.remove(selected)
        group.add(selected)
        frontier |= (set(local_neighbors(selected, cells)) & candidates) - group

    return group


def make_road_spine(
    rng: random.Random,
    cells: set[tuple[int, int]],
) -> list[tuple[int, int]] | None:
    """r=7 から r=12 へ毎行1セルずつ南下する道の背骨。南北連結を構成的に保証する。"""
    starts = sorted(cell for cell in cells if cell[1] == 7)
    if not starts:
        return None

    path = [rng.choice(starts)]
    current = path[0]

    for next_r in range(8, 13):
        q, _ = current
        # 行の開始qが1つ左へずれる行があるため、真下と左下の2択で辿る。
        options = [cell for cell in ((q, next_r), (q - 1, next_r)) if cell in cells]
        if not options:
            return None
        current = rng.choice(options)
        path.append(current)

    return path


def build_plan_once(
    rng: random.Random,
    cells: set[tuple[int, int]],
) -> dict[tuple[int, int], Terrain] | None:
    """仕様の順序で30hexの地形計画を構成する。"""
    plan: dict[tuple[int, int], Terrain] = {cell: "GRASS" for cell in cells}

    road_path = make_road_spine(rng, cells)
    if road_path is None:
        return None
    for cell in road_path:
        plan[cell] = "ROAD"

    # 集落: 実測 building_to_road median 74.38 logical ≒ 1hex以内。道に隣接させる。
    building_candidates = {
        adjacent
        for road_cell in road_path
        for adjacent in local_neighbors(road_cell, cells)
        if plan[adjacent] != "ROAD"
    }
    candidate_order = sorted(building_candidates)
    rng.shuffle(candidate_order)

    requested_buildings = rng.randint(2, 4)
    buildings: list[tuple[int, int]] = []
    for candidate in candidate_order:
        # 実測 building_spacing median 120 logical > 1hex。BLDG同士は隣接させない。
        if all(candidate not in local_neighbors(existing, cells) for existing in buildings):
            buildings.append(candidate)
            if len(buildings) == requested_buildings:
                break
    if len(buildings) < 2:
        return None
    for cell in buildings:
        plan[cell] = "BLDG"

    field_count = rng.randint(4, 7)
    field_candidates = {cell for cell in cells if plan[cell] == "GRASS"}
    field_group = choose_connected_group(rng, field_candidates, cells, field_count)
    if field_group is None:
        return None
    for cell in field_group:
        plan[cell] = "FIELD"

    forest_count = rng.randint(3, 6)
    forest_candidates = [cell for cell in cells if plan[cell] == "GRASS"]
    # 盤面の縁(行の両端q、または r==7 / r==12)を優先する。
    edge_candidates = [
        cell
        for cell in forest_candidates
        if cell[1] in {7, 12}
        or cell[0] == row_start_q(cell[1])
        or cell[0] == row_start_q(cell[1]) + ROW_LEN - 1
    ]
    rng.shuffle(edge_candidates)
    rng.shuffle(forest_candidates)

    selected_forest: list[tuple[int, int]] = []
    for cell in edge_candidates + forest_candidates:
        if cell not in selected_forest:
            selected_forest.append(cell)
        if len(selected_forest) >= forest_count:
            break
    if len(selected_forest) < 3:
        return None
    for cell in selected_forest:
        plan[cell] = "FOREST"

    return plan


def build_valid_plan(seed: int) -> tuple[dict[tuple[int, int], Terrain], dict[str, Any], Counter[str]]:
    """派生シードを最大200回試し、ゲーム契約を満たす盤面を作る。"""
    cells = set(cells_from_board_rows())

    for attempt in range(200):
        rng = random.Random(seed + attempt * 1_000_003)
        plan = build_plan_once(rng, cells)
        if plan is None:
            continue
        ok, connectivity, counts = audit_plan(plan, cells)
        if ok:
            return plan, connectivity, counts

    raise RuntimeError("200回の派生シード試行後も有効な盤面計画を生成できませんでした")


# --------------------------------------------------------------------------
# Phase B: 絵の合成
# --------------------------------------------------------------------------


def read_grammar(grammar_path: Path) -> tuple[list[dict[str, Any]], dict[str, list[str]], dict[str, Any]]:
    """実測 placements だけから family ごとのアセット語彙を構築する。

    アセット名を発明しないための要。重複は実測出現頻度なので意図的に保持し、
    そのまま重み付きサンプリングになるようにする。
    """
    grammar = json.loads(grammar_path.read_text(encoding="utf-8"))
    map_data = grammar["maps"][0]
    clusters = list(map_data.get("building_clusters", []))
    vocabulary: dict[str, list[str]] = defaultdict(list)

    for cluster in clusters:
        for placement in cluster.get("placements", []):
            family = placement.get("family")
            asset = placement.get("asset")
            if isinstance(family, str) and isinstance(asset, str) and asset:
                vocabulary[family].append(asset)

    return clusters, dict(vocabulary), map_data


def center_projection(width: int, height: int, scale: float) -> tuple[float, float]:
    """build_ps_battlefield.py と同じ「盤面bbox中心をキャンバス中心に合わせる」投影。"""
    points = [hex_to_px(q, r) for q, r in cells_from_board_rows()]
    min_x = min(point[0] for point in points)
    max_x = max(point[0] for point in points)
    min_y = min(point[1] for point in points)
    max_y = max(point[1] for point in points)

    board_cx = (min_x + max_x) / 2.0
    board_cy = (min_y + max_y) / 2.0
    return board_cx - (width / 2.0) * scale, board_cy - (height / 2.0) * scale


def hex_center_image(
    q: int,
    r: int,
    top_left_x: float,
    top_left_y: float,
    scale: float,
) -> tuple[int, int]:
    """ゲームpxのhex中心をキャンバス座標へ。crop原点は(0,0)なのでこれがscreen座標。"""
    game_x, game_y = hex_to_px(q, r)
    return (
        int(round((game_x - top_left_x) / scale)),
        int(round((game_y - top_left_y) / scale)),
    )


def logical_offset_to_screen(dx: int, dy: int) -> tuple[int, int]:
    """PS論理座標の相対値をscreen相対値へ。論理X=(40,20)/論理Y=(-40,20)に対応。"""
    return dx - dy, (dx + dy) // 2


def screen_to_logical(screen_x: int, screen_y: int, map_height: int) -> tuple[int, int]:
    """screen座標を論理座標へ戻す（柵の接続判定が論理座標を要求するため）。

    screen_x = lx - ly + map_height*40 / screen_y = (lx + ly) // 2 の逆。
    """
    shifted = screen_x - map_height * 40
    total = 2 * screen_y
    return (total + shifted) // 2, (total - shifted) // 2


def entry_slot_number(entry: ManifestEntry) -> int | None:
    value = entry.get("slot")
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.lstrip("-").isdigit():
        return int(value)
    return None


def entry_format_number(entry: ManifestEntry) -> int | None:
    value = entry.get("format_id")
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None


class Renderer:
    """PS原寸スプライトを三段階描画契約（地表→独立影→screen Y昇順の立体）で合成する。"""

    def __init__(
        self,
        canvas: Image.Image,
        index: SpriteIndex,
        vocabulary: dict[str, list[str]],
        rng: random.Random,
        cluster_radius: int,
        top_left_x: float,
        top_left_y: float,
        scale: float,
    ) -> None:
        self.canvas = canvas
        self.index = index
        self.vocabulary = vocabulary
        self.rng = rng
        self.cluster_radius = cluster_radius
        # 台帳のhex解決に使う。背景と同じ投影を共有するのが要。
        self.top_left_x = top_left_x
        self.top_left_y = top_left_y
        self.scale = scale
        self.board_cells = set(cells_from_board_rows())
        self.slot_cache: dict[tuple[str, int], list[ManifestEntry]] = {}
        self.all_slot_cache: dict[str, list[ManifestEntry]] = {}
        self.missing_assets: Counter[str] = Counter()
        self.placements_drawn = 0
        # 立体物は背景PNGへ焼き込まない。台帳へ出して本編で生きたスプライトにする。
        # こうしないと (1)破壊状態の差し替えができず (2)着弾痕デカールが樹冠の上に乗る。
        self.tall: list[dict[str, Any]] = []

    def sample_asset(self, families: Iterable[str]) -> str | None:
        choices: list[str] = []
        for family in families:
            choices.extend(self.vocabulary.get(family, []))
        return self.rng.choice(choices) if choices else None

    def slots(self, asset: str, slot: int) -> list[ManifestEntry]:
        key = (asset, slot)
        if key not in self.slot_cache:
            entries = self.index.slots(asset, [slot])
            self.slot_cache[key] = [entry for entry in entries if entry]
        return self.slot_cache[key]

    # 柵(village_fence_frontage)は最大slot 167まで使う(支柱/接続の4方向×変種×
    # 無傷/圧壊 + それぞれの影)。64で打ち切ると影と圧壊版を取りこぼす。
    MAX_SLOT = 200

    def all_slots(self, asset: str) -> list[ManifestEntry]:
        if asset not in self.all_slot_cache:
            entries = self.index.slots(asset, list(range(self.MAX_SLOT)))
            self.all_slot_cache[asset] = [entry for entry in entries if entry]
        return self.all_slot_cache[asset]

    def choose_entry(self, asset: str, slot: int, x: int, y: int) -> ManifestEntry | None:
        entries = self.slots(asset, slot)
        if not entries:
            self.missing_assets[asset] += 1
            return None
        return entries[stable_variant(x, y, len(entries))]

    def stamp_ground(self, asset: str | None, x: int, y: int) -> None:
        if asset is None:
            return
        entry = self.choose_entry(asset, 0, x, y)
        if entry is not None and stamp_entry(self.canvas, self.index, entry, x, y, 0, 0):
            self.placements_drawn += 1

    def _states_for(self, asset: str, family: str) -> dict[str, list[int | None]] | None:
        """そのアセットが持つ破壊状態のスロット列を返す。無ければ None。

        - 建物: 本体の状態列と影の状態列がSSC内で同順・同数に並ぶ。
          intact_body = first_shadow_slot - 影スロット数。以降が無傷→破壊の順。
        - 植物/低木/作物: slot1 が倒伏した地表版。倒伏すると立体影は消える。
        - 木: 状態列を持たない(PS実機でも木は倒伏対象外)。
        """
        entries = self.all_slots(asset)
        slots = {
            s: e for e in entries
            for s in [entry_slot_number(e)] if s is not None
        }

        if family == "building":
            shadow_slots = sorted(
                s for s, e in slots.items() if entry_format_number(e) == 934
            )
            if not shadow_slots:
                return None
            first_shadow = shadow_slots[0]
            intact_body = first_shadow - len(shadow_slots)
            body_states = [s for s in range(intact_body, first_shadow) if s in slots]
            if not body_states:
                return None
            return {"body": body_states, "shadow": shadow_slots}

        if family in PLANT_FAMILIES and {1, 2, 4} <= set(slots):
            return {"body": [2, 1], "shadow": [4, None]}

        return None

    def _hex_at(self, x: int, y: int) -> list[int] | None:
        """キャンバス座標 -> 盤面hex。盤外なら None。"""
        game_x = self.top_left_x + x * self.scale
        game_y = self.top_left_y + y * self.scale
        cell = px_to_hex_local(game_x, game_y)
        return list(cell) if cell in self.board_cells else None

    def stamp_fence(
        self,
        asset: str,
        x: int,
        y: int,
        logical_x: int,
        logical_y: int,
        fence_points: set[tuple[int, int]],
    ) -> None:
        """柵は単一スプライトではなく、支柱＋隣接方向の半柵の合成。

        接続判定は論理座標（40単位）で行うため、screen位置とは別に論理座標を渡す。
        合成物なので台帳では composite:true とし、スロット列をそのまま持たせる。
        圧壊版は post が +4(56→60)、connection が +16(64→80)、影は body+56。
        """
        bodies, shadows = resolve_fence_layers(self.index, asset, logical_x, logical_y, fence_points)
        body_slots = [entry_slot_number(e) for e in bodies if e]
        body_slots = [s for s in body_slots if s is not None]
        if not body_slots:
            self.missing_assets[asset] += 1
            return

        available = {
            s for e in self.all_slots(asset)
            for s in [entry_slot_number(e)] if s is not None
        }

        def crushed_of(slot: int) -> int:
            # 支柱(56..59)は+4、接続(64..)は+16 で圧壊版になる
            return slot + 4 if slot < 64 else slot + 16

        crushed = [crushed_of(s) for s in body_slots]
        crushed = [s for s in crushed if s in available]

        self.tall.append({
            "asset": asset,
            "family": "fence",
            "x": int(x),
            "y": int(y),
            "composite": True,
            "body_slots": body_slots,
            "shadow_slots": [s for s in ((sl + 56) for sl in body_slots) if s in available],
            "crushed_slots": crushed,
            "crushed_shadow_slots": [s for s in ((sl + 56) for sl in crushed) if s in available],
            "hex": self._hex_at(x, y),
        })
        self.placements_drawn += 1

    def queue_object(
        self,
        asset: str | None,
        x: int,
        y: int,
        building: bool = False,
        family: str = "prop",
    ) -> None:
        """立体物を台帳へ登録する（背景PNGには描かない）。"""
        if asset is None:
            return
        if building:
            shadow_entry, body_entry = self.intact_building_entries(asset, x, y)
            family = "building"
        else:
            shadow_entry = self.choose_entry(asset, 4, x, y)
            body_entry = self.choose_entry(asset, 2, x, y)

        if body_entry is None:
            return

        self.tall.append({
            "asset": asset,
            "family": family,
            "x": int(x),
            "y": int(y),
            "body_slot": entry_slot_number(body_entry),
            "shadow_slot": entry_slot_number(shadow_entry) if shadow_entry else None,
            "states": self._states_for(asset, family),
            "hex": self._hex_at(x, y),
        })
        self.placements_drawn += 1

    def intact_building_entries(
        self,
        asset: str,
        x: int,
        y: int,
    ) -> tuple[ManifestEntry | None, ManifestEntry | None]:
        """SSC内で最初のformat934スロットから無傷body slotを逆算する。

        建物SSCは本体の状態列と影の状態列が同じ順で並ぶので、
        intact_body_slot = first_shadow_slot - (format934スロット数)。
        """
        entries = self.all_slots(asset)
        shadow_slots = sorted(
            {
                slot
                for entry in entries
                if entry_format_number(entry) == 934
                for slot in [entry_slot_number(entry)]
                if slot is not None
            }
        )
        if shadow_slots:
            first_shadow_slot = shadow_slots[0]
            intact_body_slot = first_shadow_slot - len(shadow_slots)
            return (
                self.choose_entry(asset, first_shadow_slot, x, y),
                self.choose_entry(asset, intact_body_slot, x, y),
            )
        # 影スロットを持たない資産は通常の立体規約へフォールバック。
        return self.choose_entry(asset, 4, x, y), self.choose_entry(asset, 2, x, y)


def stamp_hex_ground(renderer: Renderer, center_x: int, center_y: int) -> None:
    """各hexにterrain/grass実測語彙を密に敷き、地色の露出を潰す。"""
    for _ in range(12):
        asset = renderer.sample_asset(("terrain", "grass", "ground_feature", "ground_spot"))
        if asset is None:
            return
        renderer.stamp_ground(
            asset,
            center_x + renderer.rng.randint(-48, 48),
            center_y + renderer.rng.randint(-38, 38),
        )


def stamp_road(
    renderer: Renderer,
    path: list[tuple[int, int]],
    center_lookup: dict[tuple[int, int], tuple[int, int]],
) -> None:
    """道の中心線に沿って road family を連続配置する（途切れさせない）。

    PSの road_* は 50〜200px の路面タイルで、実マップでは多数を重ねて帯を作っている。
    1マップ1種を細く並べると「地形はROADなのに絵が道に見えない」ため、
    実測頻度のまま毎回引き直し、中心線に加えて左右へ振った列も敷いて幅を持たせる。
    """
    if not path or not renderer.vocabulary.get("road"):
        return

    for start, end in zip(path, path[1:]):
        x0, y0 = center_lookup[start]
        x1, y1 = center_lookup[end]
        length = math.hypot(x1 - x0, y1 - y0)
        if length <= 0:
            continue
        # 路面タイルは最大204x112と大きい。横に振って重ねると地面全体を侵食するため、
        # 中心線1本・間隔32pxで敷く（隣接タイルが十分重なり、途切れない）。
        steps = max(1, math.ceil(length / 32.0))
        for step in range(steps + 1):
            t = step / steps
            renderer.stamp_ground(
                renderer.sample_asset(("road",)),
                int(round(x0 + (x1 - x0) * t)),
                int(round(y0 + (y1 - y0) * t)),
            )

    # 交点(hex中心)は確実に路面にする
    for cell in path:
        renderer.stamp_ground(renderer.sample_asset(("road",)), *center_lookup[cell])


def stamp_field(renderer: Renderer, center_x: int, center_y: int) -> None:
    """論理軸に沿った畑の列。screen上は (40,20) 方向へ伸びる。"""
    for column in (-32, 0, 32):
        for offset in (-42, -14, 14, 42):
            asset = renderer.sample_asset(("field",))
            if asset is None:
                return
            renderer.stamp_ground(
                asset,
                center_x + column + offset,
                center_y + column // 2 + offset // 2,
            )


def stamp_forest(renderer: Renderer, center_x: int, center_y: int) -> None:
    """実測 tree の ring240 p75=4 を1hexの目安にし、shrubを混ぜる。"""
    for _ in range(4):
        renderer.queue_object(
            renderer.sample_asset(("tree",)),
            center_x + renderer.rng.randint(-38, 38),
            center_y + renderer.rng.randint(-30, 30),
            family="tree",
        )
    for _ in range(renderer.rng.randint(1, 2)):
        renderer.queue_object(
            renderer.sample_asset(("shrub",)),
            center_x + renderer.rng.randint(-42, 42),
            center_y + renderer.rng.randint(-32, 32),
            family="shrub",
        )


def stamp_grass(renderer: Renderer, center_x: int, center_y: int) -> None:
    """GRASSには低密度の grass/flower/shrub を置く。"""
    for _ in range(2):
        renderer.stamp_ground(
            renderer.sample_asset(("grass", "flower")),
            center_x + renderer.rng.randint(-42, 42),
            center_y + renderer.rng.randint(-32, 32),
        )
    if renderer.rng.random() < 0.45:
        renderer.queue_object(
            renderer.sample_asset(("shrub",)),
            center_x + renderer.rng.randint(-38, 38),
            center_y + renderer.rng.randint(-28, 28),
            family="shrub",
        )


def choose_cluster(rng: random.Random, clusters: list[dict[str, Any]]) -> dict[str, Any] | None:
    """アンカー建物名と周辺placementを両方持つ実測クラスタのみを選択対象にする。

    building placement の有無は問わない（近隣建物は描かない設計のため）。
    """
    eligible = [
        cluster
        for cluster in clusters
        if isinstance(cluster.get("building_asset"), str)
        and cluster.get("building_asset")
        and cluster.get("placements")
    ]
    return rng.choice(eligible) if eligible else None


def transfer_cluster(
    renderer: Renderer,
    cluster: dict[str, Any],
    center_x: int,
    center_y: int,
    map_height: int,
) -> None:
    """実測クラスタを部品ライブラリとして1hex中心へ移植する。

    設計: **1 BLDG hex = 1 建物**。建物をどこへ置くかはPhase Aの計画が決めるので、
    クラスタからは「その建物の周り」（柵・庭・小物・地表）だけを借りる。
    クラスタ内の近隣建物(`family == "building"`)は描かない — 半径内に入っても
    隣のhexの計画と矛盾するため。実際、実測930件の近隣建物placementのうち
    半径150に入るのは176件しかなく、これに頼ると建物が出ない hex が多発する。

    アンカー建物は `placements` に含まれない（dx=dy=0 の building placement は
    存在しない）ので、`building_asset` から明示的に描く。

    cluster_radius を超える placement は捨てる。これが無いと隣のhexへ内容が漏れ、
    絵と地形テーブルがズレる。
    """
    anchor_lx, anchor_ly = screen_to_logical(center_x, center_y, map_height)

    # 柵は接続合成アセット。半径内の柵の論理座標を先に集めてから描く。
    fence_points: set[tuple[int, int]] = set()
    kept: list[tuple[str, str, int, int, int, int]] = []

    for placement in cluster.get("placements", []):
        asset = placement.get("asset")
        family = placement.get("family")
        if not isinstance(asset, str) or not isinstance(family, str):
            continue
        if family == "building":
            continue  # 建物はアンカーのみ（上記の設計）

        dx, dy = int(placement.get("dx", 0)), int(placement.get("dy", 0))
        offset_x, offset_y = logical_offset_to_screen(dx, dy)
        if math.hypot(offset_x, offset_y) > renderer.cluster_radius:
            continue

        lx, ly = anchor_lx + dx, anchor_ly + dy
        if family == "fence":
            fence_points.add((lx, ly))
        kept.append((asset, family, center_x + offset_x, center_y + offset_y, lx, ly))

    # アンカー建物（無傷状態）を hex 中心へ
    anchor_asset = cluster.get("building_asset")
    if isinstance(anchor_asset, str) and anchor_asset:
        renderer.queue_object(anchor_asset, center_x, center_y, building=True)

    for asset, family, x, y, lx, ly in kept:
        if family == "fence":
            renderer.stamp_fence(asset, x, y, lx, ly, fence_points)
        elif family in LOW_FAMILIES:
            renderer.stamp_ground(asset, x, y)
        else:
            renderer.queue_object(asset, x, y, family=family)


def render_map(
    plan: dict[tuple[int, int], Terrain],
    clusters: list[dict[str, Any]],
    vocabulary: dict[str, list[str]],
    index: SpriteIndex,
    width: int,
    height: int,
    scale: float,
    base_color: tuple[int, int, int, int],
    cluster_radius: int,
    seed: int,
    map_height: int,
) -> tuple[Image.Image, Renderer, float, float]:
    """Phase B全体。"""
    canvas = Image.new("RGBA", (width, height), base_color)
    renderer = Renderer(
        canvas=canvas,
        index=index,
        vocabulary=vocabulary,
        rng=random.Random(seed),
        cluster_radius=cluster_radius,
        top_left_x=0.0, top_left_y=0.0, scale=scale,
    )

    top_left_x, top_left_y = center_projection(width, height, scale)
    renderer.top_left_x, renderer.top_left_y = top_left_x, top_left_y
    centers = {
        cell: hex_center_image(cell[0], cell[1], top_left_x, top_left_y, scale) for cell in plan
    }

    # 1) 地表: キャンバス全面 -> hexごとの上敷き。盤外の角まで地色を残さない。
    for y in range(-16, height + 17, 32):
        for x in range(-16, width + 17, 32):
            renderer.stamp_ground(
                renderer.sample_asset(("terrain", "grass", "ground_feature", "ground_spot")),
                x + renderer.rng.randint(-5, 5),
                y + renderer.rng.randint(-5, 5),
            )

    for cell in sorted(plan, key=lambda item: (item[1], item[0])):
        stamp_hex_ground(renderer, *centers[cell])

    road_path = sorted(
        (cell for cell, terrain in plan.items() if terrain == "ROAD"),
        key=lambda cell: cell[1],
    )
    stamp_road(renderer, road_path, centers)

    # 2) 各hexの内容。立体物はキューへ積まれ、flush_objects で描画段が決まる。
    for cell in sorted(plan, key=lambda item: (item[1], item[0])):
        terrain = plan[cell]
        center_x, center_y = centers[cell]
        if terrain == "FIELD":
            stamp_field(renderer, center_x, center_y)
        elif terrain == "FOREST":
            stamp_forest(renderer, center_x, center_y)
        elif terrain == "GRASS":
            stamp_grass(renderer, center_x, center_y)
        elif terrain == "BLDG":
            cluster = choose_cluster(renderer.rng, clusters)
            if cluster is not None:
                transfer_cluster(renderer, cluster, center_x, center_y, map_height)

    return canvas, renderer, top_left_x, top_left_y


def flat_background_fraction(image: Image.Image, base_color: tuple[int, int, int, int]) -> float:
    """一度も描かれず基調色のまま残った画素の割合（監査値）。"""
    flat = sum(1 for pixel in image.getdata() if pixel == base_color)
    return flat / float(image.width * image.height)


# --------------------------------------------------------------------------
# Phase C: 出力
# --------------------------------------------------------------------------


def hex_polygon(
    q: int,
    r: int,
    top_left_x: float,
    top_left_y: float,
    scale: float,
) -> list[tuple[int, int]]:
    """overlay用のpointy-top hex輪郭をキャンバス座標で返す。"""
    center_game_x, center_game_y = hex_to_px(q, r)
    points: list[tuple[int, int]] = []
    for index in range(6):
        game_x = center_game_x + HEX_SIZE * math.sin(math.radians(60 * index))
        game_y = center_game_y - HEX_SIZE * math.cos(math.radians(60 * index))
        points.append(
            (
                int(round((game_x - top_left_x) / scale)),
                int(round((game_y - top_left_y) / scale)),
            )
        )
    return points


def write_overlay(
    overlay_path: Path,
    base_image: Image.Image,
    plan: dict[tuple[int, int], Terrain],
    scale: float,
    top_left_x: float,
    top_left_y: float,
) -> None:
    """導出地形がPS画のどこに乗ったかの目視検収用注釈画像。"""
    layer = Image.new("RGBA", base_image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    font = ImageFont.load_default()

    for cell in sorted(plan, key=lambda item: (item[1], item[0])):
        q, r = cell
        terrain = plan[cell]
        color = tuple(TERRAIN_COLORS.get(terrain, (255, 255, 255)))
        polygon = hex_polygon(q, r, top_left_x, top_left_y, scale)
        draw.polygon(polygon, fill=color + (48,), outline=color + (220,), width=2)
        center_x, center_y = hex_center_image(q, r, top_left_x, top_left_y, scale)
        draw.text(
            (center_x, center_y),
            f"{terrain}\n{q},{r}",
            fill=(0, 0, 0, 255),
            font=font,
            anchor="mm",
            align="center",
        )

    overlay_path.parent.mkdir(parents=True, exist_ok=True)
    Image.alpha_composite(base_image, layer).convert("RGB").save(overlay_path, quality=92)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", required=True, type=int)
    parser.add_argument(
        "--grammar",
        type=Path,
        default=Path("scratch/ps_placement_grammar/ps_demo_building_clusters_v1.json"),
    )
    parser.add_argument("--canonical-root", type=Path, default=Path("scratch/ps_sprites_canonical_v1"))
    parser.add_argument("--canonical-manifest", type=Path, default=None)
    parser.add_argument("--legacy-catalog", type=Path, default=Path("scratch/ps_sprites_v2/catalog.json"))
    parser.add_argument("--out-dir", type=Path, default=Path("asset/environment/maps"))
    parser.add_argument("--width", type=int, default=620)
    parser.add_argument("--height", type=int, default=620)
    parser.add_argument("--scale", type=float, default=0.84)
    parser.add_argument("--map-height", type=int, default=12)
    parser.add_argument("--cluster-radius", type=int, default=150)
    parser.add_argument("--base-color", type=parse_base_color, default=(120, 126, 88, 255))
    parser.add_argument("--overlay", type=Path, default=None)
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if args.width <= 0 or args.height <= 0:
        raise SystemExit("--width と --height は正の整数で指定してください")
    if args.scale <= 0:
        raise SystemExit("--scale は正の値で指定してください")
    if args.cluster_radius <= 0:
        raise SystemExit("--cluster-radius は正の整数で指定してください")

    grammar_path = repo_path(args.grammar)
    canonical_root = repo_path(args.canonical_root)
    canonical_manifest = (
        repo_path(args.canonical_manifest)
        if args.canonical_manifest is not None
        else canonical_root / "canonical_manifest.json"
    )
    legacy_catalog = repo_path(args.legacy_catalog)
    out_dir = repo_path(args.out_dir)
    overlay_path = repo_path(args.overlay) if args.overlay is not None else None

    plan, connectivity, counts = build_valid_plan(args.seed)
    clusters, vocabulary, _map_data = read_grammar(grammar_path)
    index = SpriteIndex(canonical_root, canonical_manifest, legacy_catalog)

    canvas, renderer, top_left_x, top_left_y = render_map(
        plan=plan,
        clusters=clusters,
        vocabulary=vocabulary,
        index=index,
        width=args.width,
        height=args.height,
        scale=args.scale,
        base_color=args.base_color,
        cluster_radius=args.cluster_radius,
        seed=args.seed,
        map_height=args.map_height,
    )

    flat_fraction = flat_background_fraction(canvas, args.base_color)
    coverage_ok = flat_fraction < 0.03

    out_dir.mkdir(parents=True, exist_ok=True)
    stem = f"ps_seed_{args.seed}"
    image_name = f"{stem}.png"
    canvas.convert("RGB").save(out_dir / image_name)

    metadata = {
        "schema": "ps_battlefield/v1",
        "name": stem,
        "image": image_name,
        "image_width": args.width,
        "image_height": args.height,
        "projection": {
            "scale": args.scale,
            "top_left_x": top_left_x,
            "top_left_y": top_left_y,
            "note": "game_px = top_left + image_px * scale (等方。PS 2:1等角のまま歪ませない)",
        },
        "source": {
            "generator": "gen_ps_seed_map",
            "seed": args.seed,
            "grammar": str(args.grammar),
        },
        "rows": terrain_rows(plan),
        "audit": {
            "coverage_ok": coverage_ok,
            "terrain_counts": dict(sorted(counts.items())),
            "connectivity": connectivity,
            "placements_drawn": renderer.placements_drawn,
            "tall_objects": len(renderer.tall),
            "missing_assets": dict(sorted(renderer.missing_assets.items())),
            "flat_background_fraction": flat_fraction,
        },
    }

    (out_dir / f"{stem}.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    # 立体物台帳。本編はこれを読んで生きたスプライトを生成し、破壊状態を差し替える。
    objects_record = {
        "schema": "ps_objects/v1",
        "name": stem,
        "projection": {
            "scale": args.scale,
            "top_left_x": top_left_x,
            "top_left_y": top_left_y,
        },
        "image_width": args.width,
        "image_height": args.height,
        "objects": renderer.tall,
    }
    (out_dir / f"{stem}_objects.json").write_text(
        json.dumps(objects_record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    if overlay_path is not None:
        write_overlay(overlay_path, canvas, plan, args.scale, top_left_x, top_left_y)

    write_registry(out_dir)

    print("地形行:")
    for row in metadata["rows"]:
        print(f"  r={row[0]} q0={row[1]}: {row[2]}")
    print(f"terrain_counts: {dict(sorted(counts.items()))}")
    print(f"connectivity: {connectivity}")
    print(f"flat_background_fraction: {flat_fraction:.4f} (coverage_ok={coverage_ok})")
    print(f"placements_drawn: {renderer.placements_drawn}")
    fam = Counter(str(o.get("family")) for o in renderer.tall)
    print(f"tall_objects: {len(renderer.tall)}  {dict(fam.most_common())}")
    if renderer.missing_assets:
        print(f"missing_assets: {len(renderer.missing_assets)} unique, {sum(renderer.missing_assets.values())} instances")


if __name__ == "__main__":
    main()

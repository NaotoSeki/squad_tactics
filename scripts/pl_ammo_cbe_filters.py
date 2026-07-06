# -*- coding: utf-8 -*-
"""
CBE 装填フィルタ — audit / build_wpns_pl_master / export で共用。

パイプライン:
  raw ammo_indices（CBE +44..+50）
    → category==18（銃剣・擲弾除外）
    → u16[27] 形状一致
    → magazine_capacity 照合（武器 +0x28 vs 弾 +0x28 — u27 クラスタ内置換）
    → u16[21] mag_type — w21≠0 のみ（**ルール未確定・実装保留**）
    → u26 弾薬箱 inner（PatrK15→7.92f250 等）— `include_composite=True` 時
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATS_JSON = ROOT / "data" / "wpns_pl_stats_decoded.json"
MAG_SHAPE_JS = ROOT / "data" / "pl_cbe_mag_shape.js"
MAG_TYPE_JS = ROOT / "data" / "pl_cbe_mag_type.js"
COMPOSITE_JSON = ROOT / "data" / "pl_composite_links.json"
MISSION_POOL_JSON = ROOT / "data" / "pl_cbe_mission_pool.json"
NAME_TABLE_JSON = ROOT / "data" / "cbe_name_table.json"

LOADABLE_CAT = 18
DRUM_RECEIVER = 65
CAT_AMMO_BOX = 13

_composite_cache: dict | None = None
_mission_pool_cache: dict[int, list[int]] | None = None


def load_mission_pool() -> dict[int, list[int]]:
    global _mission_pool_cache
    if _mission_pool_cache is not None:
        return _mission_pool_cache
    out: dict[int, list[int]] = {}
    if MISSION_POOL_JSON.is_file():
        doc = json.loads(MISSION_POOL_JSON.read_text(encoding="utf-8"))
        for k, v in (doc.get("pool") or {}).items():
            if v:
                out[int(k)] = [int(x) for x in v]
    _mission_pool_cache = out
    return out


def weapon_has_mission_pool(wi: int) -> bool:
    return wi in load_mission_pool()


def apply_mission_pool_cap_filter(
    wi: int,
    indices: list[int],
    *,
    stats_by_cbe: dict[int, dict],
    cat_map: dict[int, int],
) -> list[int]:
    """4240C / 38814 相当 — pool 登録武器の cat18 cap 照合。"""
    if not weapon_has_mission_pool(wi):
        return indices
    weapon = stats_by_cbe.get(wi)
    wcap = weapon.get("magazine_capacity") if weapon else None
    if wcap is None:
        return indices
    out: list[int] = []
    seen: set[int] = set()
    for ai in indices:
        ai = int(ai)
        if cat_map.get(ai) != LOADABLE_CAT:
            if ai not in seen:
                seen.add(ai)
                out.append(ai)
            continue
        acap = stats_by_cbe.get(ai, {}).get("magazine_capacity")
        if acap == wcap and ai not in seen:
            seen.add(ai)
            out.append(ai)
    return out if out else indices


def load_json_from_js(path: Path, var_name: str) -> dict:
    if not path.exists():
        return {}
    text = path.read_text(encoding="utf-8")
    m = re.search(rf"window\.{re.escape(var_name)}\s*=\s*(\{{[\s\S]*?\}})\s*;", text)
    if not m:
        return {}
    return json.loads(m.group(1))


def load_category_map() -> dict[int, int]:
    rows = json.loads(STATS_JSON.read_text(encoding="utf-8"))
    return {int(r["cbeNameIndex"]): int(r.get("category_code") or 0) for r in rows}


def load_stats_by_cbe() -> dict[int, dict]:
    rows = json.loads(STATS_JSON.read_text(encoding="utf-8"))
    return {int(r["cbeNameIndex"]): r for r in rows}


def load_cbe_names() -> dict[int, str]:
    if not NAME_TABLE_JSON.exists():
        return {}
    raw = json.loads(NAME_TABLE_JSON.read_text(encoding="utf-8"))
    return {int(k): str(v) for k, v in raw.items()}


def shape_u27(idx: int, shape: dict) -> int | None:
    v = shape.get(str(idx), shape.get(idx))
    return int(v) if v is not None else None


def ammo_name_prefix(name: str) -> str:
    if "-" in name:
        return name.rsplit("-", 1)[0]
    return name


def find_mag_cap_substitute(
    wi: int,
    ai: int,
    wcap: int,
    *,
    stats_by_cbe: dict[int, dict],
    cat_map: dict[int, int],
    w_shape: dict,
    a_shape: dict,
    names: dict[int, str],
) -> int | None:
    """u27 クラスタ内で weapon.magazine_capacity に合う cat18 弾を探す。"""
    wu27 = shape_u27(wi, w_shape)
    if wu27 is None:
        return None
    aname = names.get(ai, "")
    prefix = ammo_name_prefix(aname)
    exact_prefix: list[int] = []
    exact_u27: list[int] = []
    minus_one: int | None = None
    for idx, row in stats_by_cbe.items():
        if cat_map.get(idx) != LOADABLE_CAT:
            continue
        au27 = shape_u27(idx, a_shape)
        if au27 != wu27:
            continue
        acap = row.get("magazine_capacity")
        nm = names.get(idx, "")
        if acap == wcap:
            exact_u27.append(int(idx))
            if prefix and nm.startswith(prefix):
                exact_prefix.append(int(idx))
        if prefix and nm.startswith(prefix) and nm.endswith("-1"):
            minus_one = int(idx)
    if exact_prefix:
        return min(exact_prefix)
    if minus_one is not None:
        return minus_one
    if exact_u27:
        return min(exact_u27)
    return None


def apply_mag_cap_substitute(
    wi: int,
    indices: list[int],
    *,
    stats_by_cbe: dict[int, dict] | None = None,
    cat_map: dict[int, int] | None = None,
    w_shape: dict | None = None,
    a_shape: dict | None = None,
    names: dict[int, str] | None = None,
    apply: bool = True,
) -> tuple[list[int], list[dict]]:
    """cat18 主弾が武器装填数と不一致のとき u27 クラスタ内で置換。"""
    raw = [int(x) for x in indices]
    if not apply:
        return raw, []
    if stats_by_cbe is None:
        stats_by_cbe = load_stats_by_cbe()
    if cat_map is None:
        cat_map = load_category_map()
    if w_shape is None:
        w_shape = load_json_from_js(MAG_SHAPE_JS, "PL_CBE_MAG_SHAPE_WEAPONS")
    if a_shape is None:
        a_shape = load_json_from_js(MAG_SHAPE_JS, "PL_CBE_MAG_SHAPE_AMMO")
    if names is None:
        names = load_cbe_names()

    weapon = stats_by_cbe.get(wi)
    if not weapon:
        return raw, []
    wcap = weapon.get("magazine_capacity")
    if wcap is None:
        return raw, []

    cat18 = [ai for ai in raw if cat_map.get(ai) == LOADABLE_CAT]
    cat18_caps = {stats_by_cbe.get(ai, {}).get("magazine_capacity") for ai in cat18}
    multi_cap_options = len(cat18) > 1 and len(cat18_caps) > 1

    out: list[int] = []
    swaps: list[dict] = []
    seen: set[int] = set()
    for ai in raw:
        if cat_map.get(ai) != LOADABLE_CAT:
            if ai not in seen:
                seen.add(ai)
                out.append(ai)
            continue
        acap = stats_by_cbe.get(ai, {}).get("magazine_capacity")
        target = ai
        # 弾 pack > 武器 cap のときだけ sibling へ（Kar98k 273→272）。pack < cap は CBE 行を維持（VG1-5 等）
        if (
            acap is not None
            and wcap is not None
            and acap > wcap
            and not multi_cap_options
        ):
            sub = find_mag_cap_substitute(
                wi,
                ai,
                int(wcap),
                stats_by_cbe=stats_by_cbe,
                cat_map=cat_map,
                w_shape=w_shape,
                a_shape=a_shape,
                names=names,
            )
            if sub is not None and sub != ai:
                swaps.append({"from": ai, "to": sub, "wcap": wcap, "fromCap": acap})
                target = sub
        if target not in seen:
            seen.add(target)
            out.append(target)
    return out, swaps


def passes_category(cat_map: dict[int, int], ai: int) -> bool:
    return cat_map.get(ai) == LOADABLE_CAT


def load_mag_type_maps() -> tuple[dict, dict]:
    w = load_json_from_js(MAG_TYPE_JS, "PL_CBE_MAG_TYPE_WEAPONS")
    a = load_json_from_js(MAG_TYPE_JS, "PL_CBE_MAG_TYPE_AMMO")
    return w, a


def mag_type_w21(wi: int, mag_w: dict) -> int:
    return int(mag_w.get(str(wi), mag_w.get(wi, 0)) or 0)


def mag_type_a21(ai: int, mag_a: dict) -> int:
    return int(mag_a.get(str(ai), mag_a.get(ai, 0)) or 0)


def passes_mag_type(
    wi: int,
    ai: int,
    mag_w: dict,
    mag_a: dict,
) -> bool:
    """第3フィルタ — CBE @ 0x18BF3: w21==0 スキップ、それ以外は a21==w21 完全一致。"""
    w21 = mag_type_w21(wi, mag_w)
    if w21 == 0:
        return True
    return mag_type_a21(ai, mag_a) == w21


def passes_u27(
    wi: int,
    ai: int,
    w_shape: dict,
    a_shape: dict,
) -> bool:
    ws = w_shape.get(str(wi), w_shape.get(wi))
    aa = a_shape.get(str(ai), a_shape.get(ai))
    if ws is None or aa is None:
        return True
    if int(ws) == DRUM_RECEIVER:
        return True
    return int(ws) == int(aa)


def filter_pipeline_stages(
    wi: int,
    raw: list[int],
    *,
    cat_map: dict[int, int] | None = None,
    w_shape: dict | None = None,
    a_shape: dict | None = None,
    mag_w: dict | None = None,
    mag_a: dict | None = None,
    apply_mag_type: bool = False,
    apply_mag_cap: bool = True,
) -> dict[str, list[int]]:
    """CBE 生スロット → 各フィルタ段の出力（監査・export 用）。"""
    if cat_map is None:
        cat_map = load_category_map()
    if w_shape is None:
        w_shape = load_json_from_js(MAG_SHAPE_JS, "PL_CBE_MAG_SHAPE_WEAPONS")
    if a_shape is None:
        a_shape = load_json_from_js(MAG_SHAPE_JS, "PL_CBE_MAG_SHAPE_AMMO")
    if mag_w is None or mag_a is None:
        mag_w, mag_a = load_mag_type_maps()

    aux = [int(ai) for ai in raw if not passes_category(cat_map, int(ai))]
    cat_drop = [int(ai) for ai in raw if int(ai) not in aux and not passes_category(cat_map, int(ai))]
    after_cat = [int(ai) for ai in raw if passes_category(cat_map, int(ai))]
    u27_drop = [ai for ai in after_cat if not passes_u27(wi, ai, w_shape, a_shape)]
    after_u27 = [ai for ai in after_cat if passes_u27(wi, ai, w_shape, a_shape)]
    after_mag_cap, mag_cap_swaps = apply_mag_cap_substitute(
        wi,
        after_u27,
        cat_map=cat_map,
        w_shape=w_shape,
        a_shape=a_shape,
        apply=apply_mag_cap,
    )
    mag_cap_replaced = [s["from"] for s in mag_cap_swaps]
    if apply_mag_type:
        mag_drop = [ai for ai in after_mag_cap if not passes_mag_type(wi, ai, mag_w, mag_a)]
        after_mag = [ai for ai in after_mag_cap if passes_mag_type(wi, ai, mag_w, mag_a)]
    else:
        mag_drop = []
        after_mag = after_mag_cap[:]

    return {
        "raw": [int(x) for x in raw],
        "aux": aux,
        "catDropped": cat_drop,
        "afterCat18": after_cat,
        "u27Dropped": u27_drop,
        "afterU27": after_u27,
        "magCapSwaps": mag_cap_swaps,
        "magCapReplaced": mag_cap_replaced,
        "afterMagCap": after_mag_cap,
        "magTypeDropped": mag_drop,
        "afterMagType": after_mag,
    }


def finalize_ammo_indices(
    wi: int,
    indices: list[int],
    *,
    cat_map: dict[int, int] | None = None,
    w_shape: dict | None = None,
    a_shape: dict | None = None,
    mag_w: dict | None = None,
    mag_a: dict | None = None,
    apply_category: bool = True,
    apply_u27: bool = True,
    apply_mag_type: bool = False,
    apply_mag_cap: bool = True,
) -> list[int]:
    stages = filter_pipeline_stages(
        wi,
        indices,
        cat_map=cat_map,
        w_shape=w_shape,
        a_shape=a_shape,
        mag_w=mag_w,
        mag_a=mag_a,
        apply_mag_type=apply_mag_type,
        apply_mag_cap=apply_mag_cap,
    )
    if not apply_category:
        return stages["raw"]
    if not apply_u27:
        return stages["afterCat18"]
    if apply_mag_type:
        return stages["afterMagType"]
    return stages["afterMagCap"]


def load_composite_index() -> dict[str, dict[int, dict]]:
    """pl_composite_links.json — export_pl_composite_links.py 生成。"""
    global _composite_cache
    if _composite_cache is not None:
        return _composite_cache
    empty: dict[str, dict[int, dict]] = {"boxes": {}, "weapons": {}}
    if not COMPOSITE_JSON.exists():
        _composite_cache = empty
        return _composite_cache
    doc = json.loads(COMPOSITE_JSON.read_text(encoding="utf-8"))
    boxes = {int(b["idx"]): b for b in doc.get("ammoBoxes") or [] if b.get("idx") is not None}
    weapons = {
        int(w["weaponIdx"]): w for w in doc.get("weapons") or [] if w.get("weaponIdx") is not None
    }
    _composite_cache = {"boxes": boxes, "weapons": weapons}
    return _composite_cache


def u26_link_for_weapon(wi: int) -> dict | None:
    comp = load_composite_index()
    row = comp["weapons"].get(wi)
    if not row:
        return None
    return row.get("u26Link")


def box_inner_raw_indices(
    box_idx: int,
    *,
    stats_by_cbe: dict[int, dict] | None = None,
) -> list[int]:
    if stats_by_cbe is None:
        stats_by_cbe = load_stats_by_cbe()
    row = stats_by_cbe.get(box_idx)
    if not row:
        comp = load_composite_index()
        box = comp["boxes"].get(box_idx)
        if box:
            return [int(x["idx"]) for x in (box.get("innerAmmo") or []) if x.get("idx") is not None]
        return []
    return [int(x) for x in (row.get("ammo_indices") or []) if x]


def u26_ammo_box_inner_indices(
    wi: int,
    *,
    stats_by_cbe: dict[int, dict] | None = None,
) -> list[int]:
    """武器 u26→ammo_box(cat13) の内包弾 index（未フィルタ）。"""
    link = u26_link_for_weapon(wi)
    if not link or link.get("kind") != "ammo_box":
        return []
    box_idx = int(link["idx"])
    return box_inner_raw_indices(box_idx, stats_by_cbe=stats_by_cbe)


def merge_unique_indices(*lists: list[int]) -> list[int]:
    out: list[int] = []
    seen: set[int] = set()
    for lst in lists:
        for ai in lst:
            ai = int(ai)
            if ai in seen:
                continue
            seen.add(ai)
            out.append(ai)
    return out


def expand_composite_ammo(
    wi: int,
    indices: list[int],
    *,
    cat_map: dict[int, int] | None = None,
    w_shape: dict | None = None,
    a_shape: dict | None = None,
    mag_w: dict | None = None,
    mag_a: dict | None = None,
    stats_by_cbe: dict[int, dict] | None = None,
    apply_u27: bool = True,
    apply_category: bool = True,
    apply_mag_type: bool = False,
) -> list[int]:
    """主弾リストに u26 弾薬箱内 cat18 弾を union（MG34+PatrK15 等）。"""
    inner_raw = u26_ammo_box_inner_indices(wi, stats_by_cbe=stats_by_cbe)
    if not inner_raw:
        return [int(x) for x in indices]
    inner = finalize_ammo_indices(
        wi,
        inner_raw,
        cat_map=cat_map,
        w_shape=w_shape,
        a_shape=a_shape,
        mag_w=mag_w,
        mag_a=mag_a,
        apply_category=apply_category,
        apply_u27=apply_u27,
        apply_mag_type=apply_mag_type,
    )
    return merge_unique_indices([int(x) for x in indices], inner)


def composite_loadout_meta(wi: int) -> dict | None:
    """武器の複合装備メタ（u26 / 主弾 / 箱内）— UI・監査用。"""
    comp = load_composite_index()
    row = comp["weapons"].get(wi)
    if not row:
        return None
    link = row.get("u26Link")
    inner: list[int] = []
    if link and link.get("kind") == "ammo_box":
        inner = u26_ammo_box_inner_indices(wi)
    return {
        "weaponIdx": wi,
        "primaryAmmo": [int(s["idx"]) for s in (row.get("primaryAmmo") or []) if s.get("idx") is not None],
        "auxSlots": [int(s["idx"]) for s in (row.get("auxSlots") or []) if s.get("idx") is not None],
        "u26": int(link["idx"]) if link and link.get("idx") is not None else None,
        "u26Kind": link.get("kind") if link else None,
        "boxInnerRaw": inner,
        "completeHmgHint": bool(row.get("completeHmgHint")),
    }


def effective_ammo_for_weapon(
    wi: int,
    *,
    explicit: dict[int, list[int]] | None = None,
    stats_by_cbe: dict[int, dict] | None = None,
    cat_map: dict[int, int] | None = None,
    w_shape: dict | None = None,
    a_shape: dict | None = None,
    mag_w: dict | None = None,
    mag_a: dict | None = None,
    include_composite: bool = False,
    apply_mag_type: bool = False,
    use_mission_pool: bool = True,
) -> list[int]:
    """CBE stats / seg132 mission pool + フィルタ。pool 武器は L1 列起点（ST ランタイム同型）。"""
    if stats_by_cbe is None:
        stats_by_cbe = load_stats_by_cbe()
    if cat_map is None:
        cat_map = load_category_map()
    if w_shape is None:
        w_shape = load_json_from_js(MAG_SHAPE_JS, "PL_CBE_MAG_SHAPE_WEAPONS")
    if a_shape is None:
        a_shape = load_json_from_js(MAG_SHAPE_JS, "PL_CBE_MAG_SHAPE_AMMO")
    if mag_w is None or mag_a is None:
        mag_w, mag_a = load_mag_type_maps()

    pool_map = load_mission_pool() if use_mission_pool else {}
    row = stats_by_cbe.get(wi)
    raw: list[int] = []

    if use_mission_pool and wi in pool_map:
        raw = pool_map[wi][:]
    elif explicit and wi in explicit:
        raw = [int(x) for x in explicit[wi]]
    elif row:
        raw = [int(x) for x in (row.get("ammo_indices") or [])]

    after_cat = [int(ai) for ai in raw if passes_category(cat_map, int(ai))]
    after_u27 = [ai for ai in after_cat if passes_u27(wi, ai, w_shape, a_shape)]

    if use_mission_pool and wi in pool_map:
        after_cap = apply_mission_pool_cap_filter(
            wi, after_u27, stats_by_cbe=stats_by_cbe, cat_map=cat_map
        )
    else:
        after_cap, _ = apply_mag_cap_substitute(
            wi,
            after_u27,
            stats_by_cbe=stats_by_cbe,
            cat_map=cat_map,
            w_shape=w_shape,
            a_shape=a_shape,
        )

    if apply_mag_type:
        after_cap = [ai for ai in after_cap if passes_mag_type(wi, ai, mag_w, mag_a)]

    if not include_composite:
        return after_cap
    return expand_composite_ammo(
        wi,
        after_cap,
        cat_map=cat_map,
        w_shape=w_shape,
        a_shape=a_shape,
        mag_w=mag_w,
        mag_a=mag_a,
        stats_by_cbe=stats_by_cbe,
        apply_mag_type=apply_mag_type,
    )

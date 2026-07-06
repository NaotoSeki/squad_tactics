# -*- coding: utf-8 -*-
"""
seg132 descriptor JSON → PL_CBE_MISSION_POOL 一括生成。

入力: scripts/pl_decoded/cbe_seg132_units.json
      data/cbe_name_table.json
      data/pl_cbe_item_categories.js（cat 分類）
出力:
  data/pl_cbe_mission_pool.json
  data/pl_cbe_mission_pool.js

実行: python scripts/export_pl_cbe_mission_pool.py
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEG132_JSON = ROOT / "scripts" / "pl_decoded" / "cbe_seg132_units.json"
RUNTIME_JSON = ROOT / "data" / "pl_cbe_mission_pool_runtime.json"
NAMES_JSON = ROOT / "data" / "cbe_name_table.json"
CATS_JS = ROOT / "data" / "pl_cbe_item_categories.js"
OUT_JSON = ROOT / "data" / "pl_cbe_mission_pool.json"
OUT_JS = ROOT / "data" / "pl_cbe_mission_pool.js"
LOADABLE_CAT = 18

# Gew98 seg132 @ 0x1DCAAC — Kar98 系は同一 (idx,qty) テンプレを共有（RE 確定）
KAR98_FAMILY_SOURCE = 55
KAR98_FAMILY_TARGETS = (56, 57, 58, 69)


def load_categories() -> dict[int, int]:
    text = CATS_JS.read_text(encoding="utf-8")
    m = re.search(r"PL_CBE_ITEM_CATEGORIES\s*=\s*(\{.*?\});", text, re.S)
    if not m:
        return {}
    raw = json.loads(m.group(1))
    out: dict[int, int] = {}
    for k, v in raw.items():
        if isinstance(v, dict) and v.get("cat") is not None:
            out[int(k)] = int(v["cat"])
    return out


def load_names() -> dict[str, str]:
    return json.loads(NAMES_JSON.read_text(encoding="utf-8"))


def union_pairs(blocks: list[dict]) -> list[int]:
    seen: set[int] = set()
    out: list[int] = []
    for block in sorted(blocks, key=lambda b: b["file_off"]):
        for p in block["pairs"]:
            idx = int(p["idx"])
            if idx in seen:
                continue
            seen.add(idx)
            out.append(idx)
    return out


def split_cat(indices: list[int], cats: dict[int, int]) -> tuple[list[int], list[int]]:
    cat18: list[int] = []
    aux: list[int] = []
    for idx in indices:
        cat = cats.get(idx)
        if cat == LOADABLE_CAT:
            cat18.append(idx)
        else:
            aux.append(idx)
    return cat18, aux


def block_summary(block: dict, names: dict[str, str]) -> dict:
    pairs = []
    for p in block["pairs"]:
        idx = int(p["idx"])
        pairs.append(
            {
                "idx": idx,
                "qty": int(p["qty"]),
                "name": names.get(str(idx), f"#{idx}"),
                "pass1": p.get("gate_pass1_masked"),
            }
        )
    return {
        "file_off": block["file_off"],
        "mag_hex": block["mag_hex"],
        "cx_gate": block.get("cx_gate"),
        "pass1_hits": block.get("pass1_hits") or [],
        "pairs": pairs,
    }


def propagate_kar98_family(
    weapons: dict[int, dict],
    names: dict[str, str],
    cats: dict[int, int],
) -> None:
    src = weapons.get(KAR98_FAMILY_SOURCE)
    if not src:
        return
    for tgt in KAR98_FAMILY_TARGETS:
        if tgt in weapons:
            continue
        weapons[tgt] = {
            "weapon_id": tgt,
            "name": names.get(str(tgt), f"weapon_{tgt}"),
            "source": "kar98_family_propagate",
            "propagated_from": KAR98_FAMILY_SOURCE,
            "from_file": src.get("from_file"),
            "blocks": [],
            "indices": src["indices"][:],
            "cat18": src["cat18"][:],
            "aux": src["aux"][:],
        }


def load_runtime_dumps() -> list[dict]:
    if not RUNTIME_JSON.is_file():
        return []
    raw = json.loads(RUNTIME_JSON.read_text(encoding="utf-8"))
    out: list[dict] = []
    for d in raw.get("dumps") or []:
        if d.get("_template"):
            continue
        pool = d.get("pool_270")
        if not pool or not isinstance(pool, list) or not pool:
            continue
        out.append(d)
    return out


def apply_runtime_dumps(
    weapons: dict[int, dict],
    dumps: list[dict],
    names: dict[str, str],
    cats: dict[int, int],
) -> int:
    n = 0
    for d in dumps:
        cbe = int(d["cbe"])
        indices = [int(x) for x in d["pool_270"]]
        cat18, aux = split_cat(indices, cats)
        p1ec = d.get("pool_1ec")
        weapons[cbe] = {
            "weapon_id": cbe,
            "name": d.get("name") or names.get(str(cbe), f"weapon_{cbe}"),
            "source": "runtime_dump",
            "from_file": d.get("scenario"),
            "blocks": [],
            "indices": indices,
            "cat18": cat18,
            "aux": aux,
            "pool_1ec": [int(x) for x in p1ec] if isinstance(p1ec, list) and p1ec else None,
            "ui_note": d.get("ui_note"),
            "dumped": d.get("dumped"),
        }
        n += 1
    return n


def build_payload(
    seg132: dict,
    names: dict[str, str],
    cats: dict[int, int],
    runtime_dumps: list[dict],
) -> dict:
    by_weapon: dict[int, list[dict]] = defaultdict(list)
    for d in seg132["descriptors"]:
        by_weapon[int(d["weapon_id"])].append(d)

    weapons: dict[int, dict] = {}
    for wid in sorted(by_weapon):
        blocks = by_weapon[wid]
        indices = union_pairs(blocks)
        cat18, aux = split_cat(indices, cats)
        weapons[wid] = {
            "weapon_id": wid,
            "name": names.get(str(wid), f"weapon_{wid}"),
            "source": "seg132",
            "from_file": blocks[0]["file_off"] if len(blocks) == 1 else None,
            "blocks": [block_summary(b, names) for b in sorted(blocks, key=lambda x: x["file_off"])],
            "indices": indices,
            "cat18": cat18,
            "aux": aux,
        }

    propagate_kar98_family(weapons, names, cats)
    runtime_count = apply_runtime_dumps(weapons, runtime_dumps, names, cats)

    pool = {str(wid): w["indices"] for wid, w in weapons.items()}
    pool_cat18 = {str(wid): w["cat18"] for wid, w in weapons.items() if w["cat18"]}
    pool_aux = {str(wid): w["aux"] for wid, w in weapons.items() if w["aux"]}
    pool_pass2 = {
        str(wid): w["pool_1ec"]
        for wid, w in weapons.items()
        if w.get("pool_1ec")
    }

    return {
        "generated": date.today().isoformat(),
        "source": "scripts/pl_decoded/cbe_seg132_units.json",
        "runtime_source": str(RUNTIME_JSON.relative_to(ROOT)),
        "descriptor_blocks": len(seg132["descriptors"]),
        "weapon_entries": len(weapons),
        "runtime_overrides": runtime_count,
        "gate_rule": seg132.get("gate_rule"),
        "kar98_family_propagate": {
            "from": KAR98_FAMILY_SOURCE,
            "to": list(KAR98_FAMILY_TARGETS),
        },
        "pool": pool,
        "pool_cat18": pool_cat18,
        "pool_aux": pool_aux,
        "pool_pass2": pool_pass2,
        "weapons": {str(k): v for k, v in weapons.items()},
    }


def js_string(s: str) -> str:
    return json.dumps(s, ensure_ascii=False)


def render_js(payload: dict) -> str:
    pool_lines = []
    for wid in sorted(payload["pool"].keys(), key=lambda x: int(x)):
        w = payload["weapons"][wid]
        idxs = payload["pool"][wid]
        comment_parts = []
        if w.get("source") == "runtime_dump":
            comment_parts.append("runtime L2")
            if w.get("ui_note"):
                comment_parts.append(str(w["ui_note"]))
        elif w.get("source") == "kar98_family_propagate":
            comment_parts.append(f"from Gew98/{KAR98_FAMILY_SOURCE}")
        elif w.get("blocks"):
            comment_parts.append(w["blocks"][0]["file_off"])
        if w.get("cat18"):
            comment_parts.append("cat18:" + ",".join(str(i) for i in w["cat18"]))
        comment = " — ".join(comment_parts) if comment_parts else w.get("name", wid)
        inner = ", ".join(str(i) for i in idxs)
        pool_lines.append(f"        /** {comment} */")
        pool_lines.append(f"        '{wid}': [{inner}],")

    aux_entries = payload.get("pool_aux") or {}
    aux_lines = []
    for wid in sorted(aux_entries.keys(), key=lambda x: int(x)):
        inner = ", ".join(str(i) for i in aux_entries[wid])
        aux_lines.append(f"        '{wid}': [{inner}],")

    pass2_entries = payload.get("pool_pass2") or {}
    pass2_lines = []
    for wid in sorted(pass2_entries.keys(), key=lambda x: int(x)):
        inner = ", ".join(str(i) for i in pass2_entries[wid])
        pass2_lines.append(f"        '{wid}': [{inner}],")

    meta = {
        "generated": payload["generated"],
        "descriptor_blocks": payload["descriptor_blocks"],
        "weapon_entries": payload["weapon_entries"],
        "runtime_overrides": payload.get("runtime_overrides", 0),
        "kar98_family": payload["kar98_family_propagate"],
        "note": "L2 runtime dump overrides seg132; see pl_cbe_mission_pool_runtime.json",
    }

    return f"""/**
 * CBE mission pool — seg132 (L1) + runtime dump (L2)
 * regen: python scripts/export_pl_cbe_mission_pool.py
 * @see docs/PL_CBE_MISSION_POOL_RE.md
 * @see docs/PL_CBE_RUNTIME_POOL_DUMP.md
 */
(function () {{
    'use strict';
    /** cbeNameIndex → pool index 列（出現順） */
    window.PL_CBE_MISSION_POOL = {{
{chr(10).join(pool_lines)}
    }};

    /** cat18 のみ — 参考 */
    window.PL_CBE_MISSION_POOL_CAT18 = {{
{chr(10).join(f"        '{k}': [{', '.join(str(i) for i in v)}]," for k, v in sorted(payload['pool_cat18'].items(), key=lambda x: int(x[0])))}
    }};

    /** cat≠18 — pass2/副装 RE 用 */
    window.PL_CBE_MISSION_POOL_AUX = {{
{chr(10).join(aux_lines) if aux_lines else "        // none"}
    }};

    /** DOSBox DS:0x1EC pass2 列（dump 済みのみ） */
    window.PL_CBE_MISSION_POOL_PASS2 = {{
{chr(10).join(pass2_lines) if pass2_lines else "        // none"}
    }};

    window.PL_CBE_MISSION_POOL_META = {json.dumps(meta, ensure_ascii=False, indent=8).replace("    ", "        ")};
}}());
"""


def main() -> None:
    if not SEG132_JSON.is_file():
        raise SystemExit(f"Run re_cbe_seg132_export.py first: missing {SEG132_JSON}")

    seg132 = json.loads(SEG132_JSON.read_text(encoding="utf-8"))
    names = load_names()
    cats = load_categories()
    runtime_dumps = load_runtime_dumps()
    payload = build_payload(seg132, names, cats, runtime_dumps)

    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    OUT_JS.write_text(render_js(payload), encoding="utf-8")

    print(f"Wrote {OUT_JSON.relative_to(ROOT)}")
    print(f"Wrote {OUT_JS.relative_to(ROOT)}")
    print(
        f"weapons={payload['weapon_entries']} seg132={payload['descriptor_blocks']} "
        f"runtime={payload.get('runtime_overrides', 0)}"
    )


if __name__ == "__main__":
    main()

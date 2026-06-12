# -*- coding: utf-8 -*-
"""
Merge CBE 厳密弾行 (cbe_weapon_ammo_explicit.json) →
  - scripts/pl_decoded/pl_item_compatibility.json
  - pl_st_weapon_ammo.js
再生成: python scripts/build_pl_st_compat.py

将来: CBE バイナリから全件表が機械抽出できたら、このスクリプトに「明示 JSON よりバイナリを優先」
の入力段を差し込み、同じ pl_st_weapon_ammo.js 形式で出力する（Phase 3 / plan §0.6）。
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JSON_PATH = ROOT / "scripts" / "pl_decoded" / "pl_item_compatibility.json"
EXPLICIT = ROOT / "scripts" / "pl_decoded" / "cbe_weapon_ammo_explicit.json"
OUT_JS = ROOT / "pl_st_weapon_ammo.js"


def load_names(j: dict) -> list:
    return j["weapon_name_tables"]["cbe_us_m1911a1_chain"]["names"]


def fam_indices(names: list) -> dict:
    return {
        "cal_3006": [i for i, n in enumerate(names) if n.startswith("3006-") or n == "3006-5"],
        "cal_45acp": [i for i, n in enumerate(names) if "45ACP" in n],
        "cal_792": [i for i, n in enumerate(names) if n.startswith("7.92-") or n.startswith("7.92")],
        "cal_9mm_para": [i for i, n in enumerate(names) if n.startswith("9Pb-")],
    }


def build_st_map(explicit: dict) -> dict:
    """Squad Tactics用: stWpnCode がある edge + mg42/luger ブロック。"""
    st_map: dict = {}
    for e in explicit.get("edges", []):
        code = e.get("stWpnCode")
        if not code:
            continue
        st_map[code] = {
            "plCbeWeaponIndex": e["cbeWeaponIndex"],
            "plWeaponName": e["plWeaponName"],
            "acceptsAmmoPlIndices": e["acceptsAmmoPlIndices"],
            "plAmmoLabel": e.get("label", ""),
        }
    m = explicit.get("mg42")
    if m and m.get("stWpnCode"):
        st_map[m["stWpnCode"]] = {
            "plCbeWeaponIndex": m["cbeWeaponIndex"],
            "plWeaponName": "MG42",
            "acceptsAmmoPlIndices": m["acceptsAmmoPlIndices"],
            "plAmmoLabel": m.get("note", "7.92 帯; 厳密1:1は次バイナリ"),
        }
    m = explicit.get("luger")
    if m and m.get("stWpnCode"):
        st_map[m["stWpnCode"]] = {
            "plCbeWeaponIndex": m["cbeWeaponIndex"],
            "plWeaponName": m.get("plWeaponName", "P08"),
            "acceptsAmmoPlIndices": m["acceptsAmmoPlIndices"],
            "plAmmoLabel": m.get("note", "9Pb; 厳密は次版"),
        }
    return st_map


def pl_only_edges(explicit: dict) -> dict:
    """ST に無い PL 専用火器 (M1917 等) / 厳密グローバル"""
    d = {}
    for e in explicit.get("edges", []):
        if e.get("stWpnCode") is not None:
            continue
        d[str(e["cbeWeaponIndex"])] = {
            "plWeaponName": e["plWeaponName"],
            "acceptsAmmoPlIndices": e["acceptsAmmoPlIndices"],
            "plAmmoLabel": e.get("label", ""),
        }
    return d


def main() -> None:
    doc = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    names = load_names(doc)
    explicit = json.loads(EXPLICIT.read_text(encoding="utf-8"))

    st_map = build_st_map(explicit)
    pl_only = pl_only_edges(explicit)

    fams = fam_indices(names)

    doc.setdefault("_meta", {})
    doc["_meta"]["stWeaponBindings"] = {
        "version": 2,
        "description": "cbe_weapon_ammo_explicit.json 由来。M1911A1=45ACP-7 のような**行単位**で一致。",
        "caution": "未列挙火器は edges に追記。7.92/9mm 帯は暫定クラスタ。",
    }
    doc["squadTacticsPlBindings"] = st_map
    doc["plCbeOrdnanceOnly"] = {
        "description": "Squad 兵士に 1:1 対応しない PL 専用火器 (リボルバー/発煙/27mm 等)",
        "byCbeWeaponIndex": pl_only,
    }
    doc["cbeWeaponAmmoExplicitFile"] = "scripts/pl_decoded/cbe_weapon_ammo_explicit.json"
    doc["plAmmoFamiliesByCbeIndex"] = {k: v for k, v in fams.items()}

    JSON_PATH.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")

    # Full strict map: ST codes + all PL-only (for plCompatAcceptsCbeAmmoIndex on future items)
    export_block = {
        "squadTactics": st_map,
        "plOnlyCbeLaunchers": pl_only,
        "cbeNameChainLength": len(names),
    }

    js = [
        "/** PL / CBE 弾薬行 — 厳密 cbe_weapon_ammo_explicit.json + build_pl_st_compat.py */",
        "(function () {",
        "  'use strict';",
        f"  const PL_ST_WEAPON_AMMO = {json.dumps(st_map, ensure_ascii=False, indent=2)};",
        f"  const PL_CBE_OR_ONLY = {json.dumps(pl_only, ensure_ascii=False, indent=2)};",
        f"  const PL_CBE_EXPORT_META = {json.dumps(export_block, ensure_ascii=False, indent=2)};",
        "  function applyPlCompatToWpnss() {",
        "    if (typeof WPNS === 'undefined') return;",
        "    for (const code of Object.keys(PL_ST_WEAPON_AMMO)) {",
        "      if (!WPNS[code]) continue;",
        "      WPNS[code].plCompat = PL_ST_WEAPON_AMMO[code];",
        "    }",
        "  }",
        "  function plCompatAcceptsCbeAmmoIndex(wpnCode, plCbeAmmoIndex) {",
        "    const w = (typeof WPNS !== 'undefined') && WPNS[wpnCode];",
        "    const c = w && w.plCompat;",
        "    if (!c || !c.acceptsAmmoPlIndices) return true;",
        "    return c.acceptsAmmoPlIndices.indexOf(plCbeAmmoIndex) >= 0;",
        "  }",
        "  function plOnlyLauncherAccepts(cbeWeaponIndex, plCbeAmmoIndex) {",
        "    const k = String(cbeWeaponIndex);",
        "    const o = PL_CBE_OR_ONLY[k];",
        "    if (!o || !o.acceptsAmmoPlIndices) return false;",
        "    return o.acceptsAmmoPlIndices.indexOf(plCbeAmmoIndex) >= 0;",
        "  }",
        "  if (typeof window !== 'undefined') {",
        "    window.PL_ST_WEAPON_AMMO = PL_ST_WEAPON_AMMO;",
        "    window.PL_CBE_OR_ONLY = PL_CBE_OR_ONLY;",
        "    window.PL_CBE_EXPORT_META = PL_CBE_EXPORT_META;",
        "    window.applyPlCompatToWpnss = applyPlCompatToWpnss;",
        "    window.plCompatAcceptsCbeAmmoIndex = plCompatAcceptsCbeAmmoIndex;",
        "    window.plOnlyLauncherAccepts = plOnlyLauncherAccepts;",
        "  }",
        "  applyPlCompatToWpnss();",
        "})();",
        "",
    ]
    OUT_JS.write_text("\n".join(js), encoding="utf-8")
    print("WROTE", JSON_PATH, OUT_JS, "st keys", list(st_map.keys()))


if __name__ == "__main__":
    main()

# -*- coding: utf-8 -*-
# HexKit batch renderer -> asset/environment/hex_tiles_v7/
# Driven in chunks: set HEXKIT_PART to "s1".."s5" (one building seed, all damage
# levels & rotations) or "grounds" (ground bases + rubble overlays + catalog).
import bpy
import json
import math
import os

HEXKIT_DEMO = False   # gen files must not run their demo blocks
EXTRAS_DEMO = False
SCAR_DEMO = False
SPECIALS_DEMO = False
GREEN_DEMO = False
DETAIL_DEMO = False
SRC = "C:/Projects/squad_tactics/scripts/hex_ruins"
g = globals()
exec(open(SRC + "/gen_building.py", encoding="utf-8").read(), g)
exec(open(SRC + "/gen_extras.py", encoding="utf-8").read(), g)  # pulls in gen_ground too
exec(open(SRC + "/gen_scar.py", encoding="utf-8").read(), g)
exec(open(SRC + "/gen_specials.py", encoding="utf-8").read(), g)
exec(open(SRC + "/gen_green.py", encoding="utf-8").read(), g)
exec(open(SRC + "/gen_detail.py", encoding="utf-8").read(), g)

scn = bpy.data.scenes["HexKit"]
CFG = json.loads(scn["hexkit_cfg"])
OUT = CFG["out_dir"]
os.makedirs(OUT, exist_ok=True)

# lighting / performance (demo blocks skipped, so set explicitly)
from mathutils import Vector as _V
for n in bpy.data.worlds["HK_World"].node_tree.nodes:
    if n.type == 'BACKGROUND':
        n.inputs[1].default_value = 0.58
_sun_obj = bpy.data.objects.get("HK_Sun")
if _sun_obj is None or _sun_obj.type != "LIGHT":
    raise RuntimeError("HexKit source blend is missing the HK_Sun light object")
_sun = _sun_obj.data
_sun.energy = 4.2
_sun.angle = math.radians(5.0)
_e, _a = math.radians(62.0), math.radians(45.0)
_d = _V((math.cos(_e) * math.sin(_a), math.cos(_e) * math.cos(_a), -math.sin(_e)))
_sun_obj.rotation_euler = _d.to_track_quat('-Z', 'Y').to_euler()
scn.view_settings.look = 'High Contrast'
scn.cycles.samples = 96
scn.render.use_persistent_data = True

part = g.get("HEXKIT_PART", "s1")
ROTS = [0, 60, 120, 180, 240, 300]

if len(part) == 2 and part[0] == "s" and part[1].isdigit():
    seed = int(part[1:])
    for dmg in (0, 1, 2):
        name = f"BLDG_s{seed}_d{dmg}"
        col = get_kit_col(name)
        build_building(seed=seed, damage=dmg, col=col)
        for rot in ROTS:
            path = f"{OUT}/bldg_s{seed}_d{dmg}_rot{rot}.png"
            stage_and_render(col, rot, path, with_catcher=True)
            print("R", os.path.basename(path))

elif part == "grounds":
    for v in range(6):
        col = get_kit_col(f"GND_cobble_{v}")
        build_ground("cobble", v, col)
        stage_and_render(col, 0, f"{OUT}/gnd_cobble_v{v}.png", with_catcher=False)
        print("R gnd_cobble_v%d" % v)
    for v in range(3):
        col = get_kit_col(f"GND_street_{v}")
        build_ground("street", v, col)
        stage_and_render(col, 0, f"{OUT}/gnd_street_v{v}.png", with_catcher=False)
        print("R gnd_street_v%d" % v)
    for v in range(2):
        col = get_kit_col(f"GND_crater_{v}")
        build_ground("crater_cobble", v, col)
        stage_and_render(col, 0, f"{OUT}/gnd_crater_v{v}.png", with_catcher=False)
        print("R gnd_crater_v%d" % v)
    for v in range(3):
        col = get_kit_col(f"RF_{v}")
        build_rubble_field(v, col)
        for rot in (0, 60):
            stage_and_render(col, rot, f"{OUT}/rubble_v{v}_rot{rot}.png", with_catcher=True)
        print("R rubble_v%d" % v)

elif part in ("extras", "roads"):
    for pat, rots, nv in (("straight", (0, 60, 120), 4), ("corner", ROTS, 3),
                          ("tee", ROTS, 2), ("cross", (0, 60, 120), 2)):
        for v in range(nv):
            col = get_kit_col(f"XRD_{pat}_{v}")
            build_road(pat, v, col)
            for rot in rots:
                stage_and_render(col, rot, f"{OUT}/road_{pat}_v{v}_rot{rot}.png",
                                 with_catcher=False)
            print(f"R road_{pat}_v{v}")
if part == "extras":
    for pat, rots, nv in (("straight", (0, 60, 120), 2), ("corner", ROTS, 2),
                          ("end", ROTS, 1)):
        for v in range(nv):
            col = get_kit_col(f"XTR_{pat}_{v}")
            build_trench(pat, v, col)
            for rot in rots:
                stage_and_render(col, rot, f"{OUT}/trench_{pat}_v{v}_rot{rot}.png",
                                 with_catcher=True)
            print(f"R trench_{pat}_v{v}")
    for v in range(2):
        col = get_kit_col(f"XFX_{v}")
        build_foxholes(v, col)
        stage_and_render(col, 0, f"{OUT}/foxhole_v{v}_rot0.png", with_catcher=True)
        print("R foxhole_v%d" % v)
    for pat, rots, nv in (("straight", (0, 60, 120), 2), ("corner", ROTS, 2),
                          ("end", ROTS, 1)):
        for v in range(nv):
            col = get_kit_col(f"XBG_{pat}_{v}")
            build_bocage(pat, v, col)
            for rot in rots:
                stage_and_render(col, rot, f"{OUT}/bocage_{pat}_v{v}_rot{rot}.png",
                                 with_catcher=True)
            print(f"R bocage_{pat}_v{v}")
    for v in range(2):
        col = get_kit_col(f"XWR_{v}")
        build_wire(v, col)
        for rot in (0, 60, 120):
            stage_and_render(col, rot, f"{OUT}/wire_v{v}_rot{rot}.png", with_catcher=True)
        print("R wire_v%d" % v)
    for kind, rots, nv in (("hedgehog", (0, 60, 120), 2), ("sandbag", (0,), 2),
                           ("barrels", (0,), 2)):
        for v in range(nv):
            col = get_kit_col(f"XPR_{kind}_{v}")
            build_props(kind, v, col)
            for rot in rots:
                stage_and_render(col, rot, f"{OUT}/prop_{kind}_v{v}_rot{rot}.png",
                                 with_catcher=True)
            print(f"R prop_{kind}_v{v}")
    for v in range(5):
        col = get_kit_col(f"XTREE_{v}")
        build_tree(v, col)
        stage_and_render(col, 0, f"{OUT}/tree_v{v}_rot0.png", with_catcher=True)
        print("R tree_v%d" % v)
    for v in range(3):
        col = get_kit_col(f"XVEG_{v}")
        build_vegetation(v, col)
        stage_and_render(col, 0, f"{OUT}/veg_v{v}_rot0.png", with_catcher=True)
        print("R veg_v%d" % v)

elif part == "patches":
    # シームブレーカー土パッチ4種 + 全面タイル追加バリアント(隣接重複回避の
    # ため3→6へ。反復感対策はバリエーション量産でなく「隣に同じ絵を並べない」
    # 割当+最小限の追加で解決する方針)
    for v in range(4):
        col = get_kit_col(f"XDP_{v}")
        build_dirtpatch(v, col)
        stage_and_render(col, 0, f"{OUT}/dirtpatch_v{v}.png", with_catcher=True)
        print("R dirtpatch_v%d" % v)
    for v in (3, 4, 5):
        col = get_kit_col(f"XSC_full_{v}")
        build_scar("full", v, col)
        stage_and_render(col, 0, f"{OUT}/scar_full_v{v}_rot0.png", with_catcher=False)
        print("R scar_full_v%d" % v)
    for v in (3, 4, 5):
        col = get_kit_col(f"XGR_full_{v}")
        build_green("full", v, col)
        stage_and_render(col, 0, f"{OUT}/gnd_grass_v{v}.png", with_catcher=False)
        print("R gnd_grass_v%d" % v)

elif part == "green":
    # 市街外周の野原: cobble<->grass 遷移(scarと同エッジマスク族) + 草地基礎。63枚
    for pat in ("e1", "e2a", "e2o", "e3", "e4"):
        for v in range(2):
            col = get_kit_col(f"XGR_{pat}_{v}")
            build_green(pat, v, col)
            for rot in ROTS:
                stage_and_render(col, rot, f"{OUT}/grn_{pat}_v{v}_rot{rot}.png",
                                 with_catcher=False)
            print(f"R grn_{pat}_v{v}")
    for v in range(3):
        col = get_kit_col(f"XGR_full_{v}")
        build_green("full", v, col)
        stage_and_render(col, 0, f"{OUT}/gnd_grass_v{v}.png", with_catcher=False)
        print("R gnd_grass_v%d" % v)

elif part == "roads_dmg":
    # 道路の損傷段階 d1/d2（d0=既存の無印ファイル）。96レンダー。
    for pat, rots, nv in (("straight", (0, 60, 120), 4), ("corner", ROTS, 3),
                          ("tee", ROTS, 2), ("cross", (0, 60, 120), 2)):
        for v in range(nv):
            for dmg in (1, 2):
                col = get_kit_col(f"XRD_{pat}_{v}_d{dmg}")
                build_road(pat, v, col, dmg=dmg)
                for rot in rots:
                    path = f"{OUT}/road_{pat}_v{v}_d{dmg}_rot{rot}.png"
                    stage_and_render(col, rot, path, with_catcher=False)
                print(f"R road_{pat}_v{v}_d{dmg}")

elif part == "scar":
    for pat in ("e1", "e2a", "e2o", "e3", "e4"):
        for v in range(2):
            col = get_kit_col(f"XSC_{pat}_{v}")
            build_scar(pat, v, col)
            for rot in ROTS:
                stage_and_render(col, rot, f"{OUT}/scar_{pat}_v{v}_rot{rot}.png",
                                 with_catcher=False)
            print(f"R scar_{pat}_v{v}")
    for v in range(3):
        col = get_kit_col(f"XSC_full_{v}")
        build_scar("full", v, col)
        stage_and_render(col, 0, f"{OUT}/scar_full_v{v}_rot0.png", with_catcher=False)
        print("R scar_full_v%d" % v)
    for v in range(2):
        col = get_kit_col(f"XCP_{v}")
        build_crater_pair(v, col)
        render_crater_pair(col, f"{OUT}/cpair_v{v}", rots=(0, 60, 120))
        print("R cpair_v%d" % v)


elif part == "scar_pairs_extra":
    extra_rots = (0, 60, 120)
    expected = [
        f"{OUT}/cpair_v{v}_{tile}_rot{rot}.png"
        for v in (2, 3) for tile in ("a", "b") for rot in extra_rots
    ]
    existing = [path for path in expected if os.path.exists(path)]
    if existing:
        raise FileExistsError(
            "refusing to overwrite crater-pair output(s): " + ", ".join(existing)
        )
    for v in (2, 3):
        col = get_kit_col(f"XCP_{v}")
        build_crater_pair(v, col)
        render_crater_pair(col, f"{OUT}/cpair_v{v}", rots=extra_rots)
        print("R cpair_v%d" % v)

elif part == "specials":
    for kind, builder in (("church", build_church), ("factory", build_factory)):
        for dmg in (0, 1, 2):
            col = get_kit_col(f"XSP_{kind}_{dmg}")
            builder(dmg, col)
            for rot in ROTS:
                stage_and_render(col, rot, f"{OUT}/{kind}_d{dmg}_rot{rot}.png",
                                 with_catcher=True)
            print(f"R {kind}_d{dmg}")

elif part in ("details", "details_priority", "details_trees", "details_tracks",
              "details_cobble", "details_fields"):
    render_detail_pack(part)

elif part == "catalog":
    # catalog: everything the composer needs to place tiles pixel-perfectly
    catalog = {
        "meta": {
            "canvas": [CFG["res_x"], CFG["res_y"]],
            "px_per_m": CFG["res_x"] / CFG["view_w"],
            "hex_R_m": CFG["hex_R"],
            "hex_R_px": CFG["hex_R"] * CFG["res_x"] / CFG["view_w"],
            "anchor_px": [CFG["res_x"] / 2,
                          CFG["res_y"] / 2 + CFG["target_y"] * CFG["res_x"] / CFG["view_w"]],
            "projection": "military: elev %.0fdeg, vertical shear preserves plan shape" % CFG["theta_deg"],
        },
        "grounds": {
            "cobble": [f"gnd_cobble_v{v}.png" for v in range(6)],
            "street": [f"gnd_street_v{v}.png" for v in range(3)],
            "crater": [f"gnd_crater_v{v}.png" for v in range(2)],
        },
        "overlays": {
            "buildings": [
                {"file": f"bldg_s{s}_d{d}_rot{r}.png", "seed": s, "damage": d, "rot": r}
                for s in (1, 2, 3, 4, 5) for d in (0, 1, 2) for r in ROTS
            ],
            "rubble": [
                {"file": f"rubble_v{v}_rot{r}.png", "variant": v, "rot": r}
                for v in range(3) for r in (0, 60)
            ],
        },
        "extras": {
            "road": {
                "straight": {"variants": 4, "rots": [0, 60, 120]},
                "corner": {"variants": 3, "rots": ROTS},
                "tee": {"variants": 2, "rots": ROTS},
                "cross": {"variants": 2, "rots": [0, 60, 120]},
            },
            "trench": {
                "straight": {"variants": 2, "rots": [0, 60, 120]},
                "corner": {"variants": 2, "rots": ROTS},
                "end": {"variants": 1, "rots": ROTS},
            },
            "foxhole": {"variants": 2, "rots": [0]},
            "bocage": {
                "straight": {"variants": 2, "rots": [0, 60, 120]},
                "corner": {"variants": 2, "rots": ROTS},
                "end": {"variants": 1, "rots": ROTS},
            },
            "wire": {"variants": 2, "rots": [0, 60, 120]},
            "prop": {
                "hedgehog": {"variants": 2, "rots": [0, 60, 120]},
                "sandbag": {"variants": 2, "rots": [0]},
                "barrels": {"variants": 2, "rots": [0]},
            },
            "tree": {"variants": 5, "rots": [0]},
            "veg": {"variants": 3, "rots": [0]},
        },
        "scar": {
            "patterns": {
                "e1": {"mask": [0], "variants": 2, "rots": ROTS},
                "e2a": {"mask": [0, 1], "variants": 2, "rots": ROTS},
                "e2o": {"mask": [0, 3], "variants": 2, "rots": ROTS},
                "e3": {"mask": [0, 1, 2], "variants": 2, "rots": ROTS},
                "e4": {"mask": [0, 1, 2, 3], "variants": 2, "rots": ROTS},
                "full": {"mask": [0, 1, 2, 3, 4, 5], "variants": 3, "rots": [0]},
            },
            "crater_pair": {"variants": 4, "rots": [0, 60, 120],
                            "tiles": ["a", "b"]},
        },
        "specials": {
            "church": {"damages": [0, 1, 2], "rots": ROTS},
            "factory": {"damages": [0, 1, 2], "rots": ROTS},
        },
    }
    with open(OUT + "/catalog.json", "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=1)
    print("catalog written")

print("PART DONE:", part)

# -*- coding: utf-8 -*-
"""KHAOS v6 — GUI-mode groundburst explosion, bake, transparent PNG probe renders.

Run:  blender.exe --factory-startup -P khaos_v6.py
(GUI mode on purpose: nested bpy.ops.view3d.* / outliner ops need real areas.)
"""
import bpy
import os
import sys
import time
import math
import traceback

BASE = r"C:\Users\AWARE~1.梨\AppData\Local\Temp\claude\C--Projects-squad-tactics\1ce9f290-02e2-406c-a906-094373f17762\scratchpad\khaos_test"
LOG = open(os.path.join(BASE, "run_log_v6.txt"), "w", encoding="utf-8")

def log(*a):
    msg = " ".join(str(x) for x in a)
    print(msg)
    LOG.write(msg + "\n")
    LOG.flush()

def quit_blender():
    LOG.close()
    bpy.ops.wm.quit_blender()

def main():
    t0 = time.time()

    # ---- 0. clean default scene (Cube! Light, Camera) ----
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    log("scene cleaned, objects:", len(bpy.data.objects))

    # ---- 1. enable addon ----
    import addon_utils
    addon_utils.enable("khaos_legacy", default_set=False)
    log("addon enabled")

    # ---- 2. preset flags (checkbox equivalents) ----
    kt = bpy.context.scene.khaos_tool
    kt.my_bool = False    # thin smoke particle streaks OFF
    kt.my_bool8 = True    # Smoke/Fire particles (fireball core)
    kt.my_bool13 = True   # Thicker Smoke/Fire
    kt.my_bool6 = True    # Dirt debris
    kt.my_bool5 = True    # Sparks
    kt.my_bool4 = True    # Burning debris
    log("khaos_tool flags set")

    # ---- 3. run groundburst inside a full VIEW_3D context override ----
    bpy.context.scene.cursor.location = (0, 0, 0)
    win = bpy.context.window_manager.windows[0]
    area = next(a for a in win.screen.areas if a.type == 'VIEW_3D')
    region = next(r for r in area.regions if r.type == 'WINDOW')
    op_err = None
    with bpy.context.temp_override(window=win, screen=win.screen, area=area, region=region):
        try:
            bpy.ops.my.groundburstexplosion()
            log("groundburst: FINISHED")
        except Exception:
            op_err = traceback.format_exc()
            log("groundburst FAILED:\n", op_err)
    if op_err:
        with bpy.context.temp_override(window=win, screen=win.screen, area=area, region=region):
            try:
                bpy.ops.my.omnidirectionalexplosion()
                log("fallback omnidirectional: FINISHED")
            except Exception:
                log("omnidirectional FAILED too:\n", traceback.format_exc())
                quit_blender()

    # ---- 4. scene inventory + hard asserts ----
    domain = None
    flows = []
    for obj in bpy.data.objects:
        kinds = []
        for m in obj.modifiers:
            if m.type == 'FLUID':
                kinds.append(m.fluid_type)
                if m.fluid_type == 'DOMAIN':
                    domain = obj
                elif m.fluid_type == 'FLOW':
                    flows.append(obj)
        log(f"  obj: {obj.name} type={obj.type} fluid={kinds} psys={len(obj.particle_systems)}")
    assert domain is not None, "no smoke domain created"
    assert len(flows) >= 1, "no flow objects created"
    assert 'Cube' not in bpy.data.objects, "default cube leaked"
    log(f"inventory OK: domain={domain.name}, flows={len(flows)}")

    # ---- 5. bake setup ----
    scn = bpy.context.scene
    scn.frame_start = 1
    scn.frame_end = 56
    ds = domain.modifiers[next(i for i, m in enumerate(domain.modifiers) if m.type == 'FLUID')].domain_settings if False else None
    for m in domain.modifiers:
        if m.type == 'FLUID' and m.fluid_type == 'DOMAIN':
            ds = m.domain_settings
    ds.resolution_max = 112
    ds.cache_type = 'ALL'
    cache_dir = os.path.join(BASE, "cache_v6")
    ds.cache_directory = cache_dir
    log(f"domain settings: res={ds.resolution_max}, cache={cache_dir}, frames 1-{scn.frame_end}")
    ds.cache_frame_start = 1
    ds.cache_frame_end = scn.frame_end

    t_bake = time.time()
    with bpy.context.temp_override(window=win, screen=win.screen, area=area, region=region,
                                   object=domain, active_object=domain, selected_objects=[domain]):
        bpy.ops.fluid.bake_all()
    bake_s = time.time() - t_bake
    log(f"bake done in {bake_s:.1f}s")

    # verify cache actually has data
    n_cache = 0
    for root, _dirs, files in os.walk(cache_dir):
        n_cache += len(files)
    log(f"cache files: {n_cache}")
    assert n_cache >= scn.frame_end, f"cache too small ({n_cache} files) — bake likely failed"

    # ---- 6. render prep ----
    for obj in flows:
        obj.hide_render = True
        log(f"hide_render: {obj.name}")
    # hide any leftover helper empties/meshes that are not domain and have no particle instancing duty
    # (debris particle emitters must stay visible=False themselves but their instanced particles render)
    for obj in bpy.data.objects:
        if obj.type == 'MESH' and obj is not domain and obj not in flows and len(obj.particle_systems) == 0:
            obj.hide_render = True
            log(f"hide_render (helper): {obj.name}")

    # sun
    sun_data = bpy.data.lights.new("Sun", type='SUN')
    sun_data.energy = 3.0
    sun_data.angle = math.radians(5.0)
    sun = bpy.data.objects.new("Sun", sun_data)
    scn.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(50), 0, math.radians(-30))

    # ortho camera, 55 deg elevation, aimed at domain center
    import mathutils
    bb = [domain.matrix_world @ mathutils.Vector(c) for c in domain.bound_box]
    cx = sum(v.x for v in bb) / 8.0
    cy = sum(v.y for v in bb) / 8.0
    cz = sum(v.z for v in bb) / 8.0
    size = max(max(v.x for v in bb) - min(v.x for v in bb),
               max(v.z for v in bb) - min(v.z for v in bb))
    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = size * 1.15
    cam = bpy.data.objects.new("Cam", cam_data)
    scn.collection.objects.link(cam)
    theta = math.radians(55.0)
    dist = 60.0
    cam.location = (cx, cy - dist * math.cos(theta), cz + dist * math.sin(theta))
    cam.rotation_euler = (math.radians(90.0) - theta + math.radians(0), 0, 0)
    # aim exactly: point -Z at center
    direction = mathutils.Vector((cx, cy, cz)) - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    scn.camera = cam
    log(f"camera: ortho_scale={cam_data.ortho_scale:.2f}, domain center=({cx:.1f},{cy:.1f},{cz:.1f})")

    # render settings
    scn.render.engine = 'CYCLES'
    scn.cycles.samples = 64
    scn.cycles.use_denoising = True
    scn.cycles.device = 'CPU'
    scn.render.film_transparent = True
    scn.render.resolution_x = 256
    scn.render.resolution_y = 256
    scn.render.resolution_percentage = 100
    scn.render.image_settings.file_format = 'PNG'
    scn.render.image_settings.color_mode = 'RGBA'
    scn.cycles.volume_bounces = 2

    # ---- 7. probe renders + in-process alpha verification ----
    import numpy as np
    frames = [4, 10, 18, 28, 40, 52]
    stats = []
    for f in frames:
        scn.frame_set(f)
        path = os.path.join(BASE, f"v6_f{f:03d}.png")
        scn.render.filepath = path
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path)
        px = np.array(img.pixels[:]).reshape(-1, 4)
        a = px[:, 3]
        nz = int((a > 0.004).sum())
        opaque = int((a > 0.98).sum())
        stats.append((f, nz, opaque, float(a.max()), float(a.mean())))
        log(f"frame {f}: nonzero={nz} opaque={opaque} maxA={a.max():.3f} meanA={a.mean():.4f}")
        bpy.data.images.remove(img)

    nzs = [s[1] for s in stats]
    varies = (max(nzs) - min(nzs)) > 0.2 * max(nzs)
    log("VERDICT: alpha varies across frames:", varies)
    log("VERDICT: peak nonzero px:", max(nzs), "of", 256 * 256)

    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(BASE, "khaos_test_v6.blend"))
    log(f"total {time.time()-t0:.1f}s — saved khaos_test_v6.blend")

try:
    main()
except Exception:
    log("FATAL:\n", traceback.format_exc())
finally:
    quit_blender()

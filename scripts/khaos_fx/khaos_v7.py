# -*- coding: utf-8 -*-
"""KHAOS v7 — retune v6 scene: thicker smoke, real fire via Principled Volume, rebake.

Run:  blender.exe -b khaos_test_v6.blend --python khaos_v7.py
"""
import bpy
import os
import time
import math
import traceback

BASE = r"C:\Users\AWARE~1.梨\AppData\Local\Temp\claude\C--Projects-squad-tactics\1ce9f290-02e2-406c-a906-094373f17762\scratchpad\khaos_test"
LOG = open(os.path.join(BASE, "run_log_v7.txt"), "w", encoding="utf-8")

def log(*a):
    msg = " ".join(str(x) for x in a)
    print(msg)
    LOG.write(msg + "\n")
    LOG.flush()

def main():
    t0 = time.time()
    scn = bpy.context.scene
    domain = bpy.data.objects['Smoke Domain']
    ds = next(m for m in domain.modifiers if m.type == 'FLUID').domain_settings

    # ---- flows: thicker smoke ----
    for o in bpy.data.objects:
        for m in o.modifiers:
            if m.type == 'FLUID' and m.fluid_type == 'FLOW':
                fs = m.flow_settings
                fs.density = 2.2
                log(f"flow {o.name}: density -> {fs.density}")

    # ---- domain: billowing detail + swirl + dissolve tail ----
    ds.use_noise = True
    ds.noise_scale = 2
    ds.noise_strength = 1.0
    ds.vorticity = 0.15
    ds.use_dissolve_smoke = True
    ds.dissolve_speed = 60
    ds.use_dissolve_smoke_log = True
    ds.resolution_max = 112
    ds.cache_type = 'ALL'
    cache_dir = os.path.join(BASE, "cache_v7")
    ds.cache_directory = cache_dir
    ds.cache_frame_start = 1
    ds.cache_frame_end = scn.frame_end
    log(f"domain: noise x{ds.noise_scale}, vorticity {ds.vorticity}, dissolve {ds.dissolve_speed}, cache {cache_dir}")

    # ---- material: clean Principled Volume (density + blackbody fire) ----
    mat = domain.material_slots[0].material
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    pv = nt.nodes.new('ShaderNodeVolumePrincipled')
    pv.inputs['Color'].default_value = (0.34, 0.30, 0.26, 1.0)  # dusty brown-gray
    pv.inputs['Density'].default_value = 11.0
    pv.inputs['Density Attribute'].default_value = 'density'
    pv.inputs['Blackbody Intensity'].default_value = 1.3
    pv.inputs['Temperature'].default_value = 1400.0
    pv.inputs['Temperature Attribute'].default_value = 'temperature'
    pv.inputs['Anisotropy'].default_value = 0.2
    nt.links.new(pv.outputs['Volume'], out.inputs['Volume'])
    log("material rebuilt: Principled Volume density=11 blackbody=1.3 T=1400")

    # ---- rebake ----
    t_bake = time.time()
    with bpy.context.temp_override(object=domain, active_object=domain, selected_objects=[domain]):
        bpy.ops.fluid.bake_all()
    log(f"bake done in {time.time()-t_bake:.1f}s")
    n_cache = sum(len(fs) for _r, _d, fs in os.walk(cache_dir))
    log(f"cache files: {n_cache}")
    assert n_cache >= scn.frame_end, "bake produced too few cache files"

    # ---- render probes ----
    scn.cycles.samples = 96
    scn.cycles.use_denoising = True
    scn.render.film_transparent = True
    import numpy as np
    frames = [4, 8, 12, 18, 28, 40, 52]
    for f in frames:
        scn.frame_set(f)
        path = os.path.join(BASE, f"v7_f{f:03d}.png")
        scn.render.filepath = path
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path)
        px = np.array(img.pixels[:]).reshape(-1, 4)
        a = px[:, 3]
        vis = px[a > 0.03]
        nz = int((a > 0.004).sum())
        # fire detector: premultiplied-ish orange = R clearly above B
        fire_px = int(((vis[:, 0] > vis[:, 2] * 1.35) & (vis[:, 0] > 0.15)).sum()) if len(vis) else 0
        log(f"frame {f}: nonzero={nz} maxA={a.max():.3f} meanA={a.mean():.4f} firepx={fire_px}")
        bpy.data.images.remove(img)

    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(BASE, "khaos_test_v7.blend"))
    log(f"total {time.time()-t0:.1f}s — saved khaos_test_v7.blend")

try:
    main()
except Exception:
    log("FATAL:\n", traceback.format_exc())
finally:
    LOG.close()

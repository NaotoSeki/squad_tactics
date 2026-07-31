# -*- coding: utf-8 -*-
"""KHAOS tiered explosion builder — parameterized by --tier.

Reuses the khaos_v6.py (GUI-mode generation) + khaos_v7.py (Principled Volume
material + rebake) + pack_sheets.py (sprite sheet packing) pipeline, but folded
into one script driven by a per-tier parameter table so 5 caliber variants can
be produced without duplicating the pipeline 5 times.

Two invocation modes (mirrors the v6/v7/pack_sheets split — Blender's bundled
Python has no PIL, so post-processing must run under the system interpreter):

  # 1) Blender stage (GUI mode required — same reason as khaos_v6.py: the
  #    groundburst preset calls nested bpy.ops.view3d.*/outliner ops that need
  #    real areas, so `-b` will fail):
  blender.exe --factory-startup -P build_tier.py -- --tier t1_12mm

  # 2) Post-process stage (plain python w/ Pillow + numpy — fade tail, pack
  #    sprite sheets, write JSON metadata):
  python build_tier.py --tier t1_12mm --postprocess

Run all 5 tiers strictly sequentially — Blender fluid bake locks the machine,
parallel tiers would fight over CPU / cache directories.
"""
import json
import math
import os
import sys
import time
import traceback

TIER_BASE = r"C:\Users\AWARE~1.梨\AppData\Local\Temp\claude\C--Projects-squad-tactics\1ce9f290-02e2-406c-a906-094373f17762\scratchpad\khaos_tiers"
ASSET_DIR = r"C:\Projects\squad_tactics\asset"

# ---------------------------------------------------------------------------
# TIER PARAMETER TABLE — confirmed by supervisor, do not change without
# reporting the change + reason.
# ---------------------------------------------------------------------------
TIERS = {
    "t1_12mm": dict(
        label="12.7mm impact", scale=0.28, amount_mult=0.4, duration_mult=0.5, lifetime_mult=0.5,
        resolution_max=48, frame_end=16, flow_density=1.0,
        bools={"my_bool": True, "my_bool6": True, "my_bool5": True, "my_bool8": False, "my_bool4": False, "my_bool13": False},
        blackbody=0.0, temperature=600, vol_density=8,
        hires_frames=8, lores_frames=6,
        # neutral (unchanged from the first approved batch) — no vertical bias
        vertical_stretch=1.0, alpha=0.15, beta=0.20, vorticity=0.15,
        # 2026-07-11 (user: T1/T2 smoke reaches the frame edge and clips): this
        # radial groundburst fans wide-and-low, so a tight square framing lets
        # the horizontal fan hit the sides. Fix = frame generously (no clip at
        # any frame -- calibrated on the existing bake, margin 2.2 contains the
        # widest mid frame with padding) then content-crop in postprocess (same
        # union-alpha square crop T5 uses) to tighten back to a clean fill.
        frame_margin=2.2, crop_content=True, crop_margin=1.5,
    ),
    "t2_grenade": dict(
        # 2026-07-10 supervisor correction: my_bool8 (Smoke/Fire) was True, but
        # KHAOS's fuel injection runs for a large fraction of the tier's total
        # duration (not an instant flash) — visual QC showed sustained orange
        # fire across ~half of the 12 sampled frames, contradicting the explicit
        # spec "grenade fire should be near-instant/near-none". Disabled to
        # match T1's fireless dust+frag+spark composition.
        label="Grenade", scale=0.42, amount_mult=0.6, duration_mult=0.6, lifetime_mult=0.6,
        resolution_max=56, frame_end=22, flow_density=1.4,
        bools={"my_bool": True, "my_bool6": True, "my_bool5": True, "my_bool8": False, "my_bool4": True, "my_bool13": False},
        blackbody=0.0, temperature=700, vol_density=9,
        hires_frames=12, lores_frames=8,
        # neutral (unchanged from the first approved batch) — no vertical bias
        vertical_stretch=1.0, alpha=0.15, beta=0.20, vorticity=0.15,
        # 2026-07-11 anti-clip framing (see t1_12mm note): generous camera
        # margin + content crop with a wide crop_margin so the horizontal fan
        # isn't cropped tight to the square's edges.
        frame_margin=2.2, crop_content=True, crop_margin=1.5,
    ),
    "t3_mortar60": dict(
        # 2026-07-10 supervisor revision: T3/T4/T5 all read as the same radial
        # "sea urchin" burst merely resized — no sense of a plume rising
        # upward as caliber increases. Validated via two cheap probes (see
        # scratchpad/khaos_tiers/probe_vertical*.py) that FluidDomainSettings
        # alpha/beta (RNA-confirmed: higher = faster rising smoke) combined
        # with a ground-anchored Z-only stretch of the whole generated
        # assembly (pivot at world Z=0, the true burst origin — NOT the
        # domain's own bound_box minimum, which sits well below the burst
        # point by the preset's own symmetric design and would just inflate
        # unused underground volume) gives a convincing progressively-taller
        # "leaps upward" column. Numbers below are the validated recipe,
        # scaled modestly for T3 (smallest of the three getting the effect).
        # 2026-07-11 supervisor addition: ExplosionParticleGroups.blend has
        # unused debris categories (Rock/Rebar/Concrete/Metal/Glass/Wood)
        # beyond the Dirt+Burning already wired up. Adding Rock debris here
        # for a bit more chaos on ground impacts (user: "ド派手にしていこう").
        label="60mm mortar", scale=0.65, amount_mult=0.85, duration_mult=0.8, lifetime_mult=0.8,
        resolution_max=88, frame_end=34, flow_density=1.8,
        bools={"my_bool": False, "my_bool6": True, "my_bool5": True, "my_bool8": True, "my_bool4": True, "my_bool13": False, "my_bool12": True},
        blackbody=0.8, temperature=850, vol_density=10,
        hires_frames=18, lores_frames=10,
        vertical_stretch=1.5, alpha=0.35, beta=0.45, vorticity=0.20,
        # 2026-07-11 recalibration: measured via sequential-frame stepping
        # (the only valid way to test Newton particle physics -- direct
        # frame_set jumps leave the cache stale) that debris ALREADY overshoot
        # this tier's camera frame at the original 1.0x factor, before any
        # boost. 2.5x sent them wildly out of frame (invisible, not "flashy").
        # 0.6x keeps most debris within the visible frame while still giving
        # them enough push to clear the smoke's optical density.
        # 2026-07-12: with the camera widened by debris_headroom + content
        # crop now on, debris can fly at natural speed and be visible without
        # getting hard-cut; bigger chunks (1.5x) so they read as debris.
        debris_velocity_mult=1.0, debris_size_mult=1.5,
    ),
    "t4_shell120": dict(
        # 2026-07-11: added Concrete/Rebar/Rock/Metal Shard debris (unused
        # categories in ExplosionParticleGroups.blend) for a more dramatic,
        # structure-hit look at this caliber (user: "ド派手にしていこう").
        label="120mm shell", scale=1.0, amount_mult=1.0, duration_mult=1.0, lifetime_mult=1.0,
        resolution_max=112, frame_end=56, flow_density=2.2,
        bools={"my_bool": False, "my_bool6": True, "my_bool5": True, "my_bool8": True, "my_bool4": True, "my_bool13": True,
               "my_bool10": True, "my_bool11": True, "my_bool12": True, "my_bool2": True},
        blackbody=1.2, temperature=1000, vol_density=11,
        hires_frames=32, lores_frames=16,
        vertical_stretch=1.9, alpha=0.50, beta=0.65, vorticity=0.24,
        # 2026-07-11 recalibration: same finding as T3 -- measured via
        # sequential-frame stepping that Rock debris already reach max|z|=6.82
        # /max|x|=5.93 at the ORIGINAL 1.0x normal_factor, already past this
        # tier's camera half-height (~5.18 from ortho_scale=10.36). 3.5x sent
        # them to max|z|=24 (nowhere near frame). 0.6x brings the spread back
        # to ~4.2-5.0, fitting the frame while still pushing debris out of the
        # smoke's optical core (scratchpad/khaos_tiers/veltest_t4_*.png calib).
        # 2026-07-12: with the camera widened by debris_headroom + content
        # crop now on, debris can fly at natural speed and be visible without
        # getting hard-cut; bigger chunks (1.5x) so they read as debris.
        debris_velocity_mult=1.0, debris_size_mult=1.5,
    ),
    "t5_aerialbomb": dict(
        # 2026-07-10 supervisor revision 2 (user: "T5 should be about twice as
        # tall"): groundburst physically cannot fill a doubled domain — its
        # emission is radial, and even 4x buoyancy plateaued at top/bottom
        # alpha ratio ~0.23 (probe_t5_tall/tall2.py). Switched to the
        # "directional" preset: plane emitter firing along its normal with
        # normal_factor = 32*velocitydim gives the plume real upward launch
        # momentum. Preset spawns emitters tilted 65deg around Y; build stage
        # zeroes that rotation so the column rises straight up. Validated in
        # probe_t5_dir2.py: ratio climbs steadily to 0.54 @f78, frame-filling
        # vertical column, roughly 2x the previous visual height.
        # 2026-07-11: full debris roster -- Concrete/Rebar/Rock/Metal Shard/
        # Glass/Wood/Tree Branch, all previously-unused ExplosionParticleGroups
        # categories -- for the most dramatic tier (user: "ド派手にしていこう").
        label="Aerial bomb", scale=1.6, amount_mult=1.3, duration_mult=2.0, lifetime_mult=1.3,
        resolution_max=128, frame_end=80, flow_density=2.6,
        bools={"my_bool": False, "my_bool6": True, "my_bool5": True, "my_bool8": True, "my_bool4": True, "my_bool13": True,
               "my_bool10": True, "my_bool11": True, "my_bool12": True, "my_bool2": True,
               "my_bool1": True, "my_bool3": True, "my_bool9": True},
        blackbody=1.4, temperature=1050, vol_density=12,
        vertical_stretch=4.3, alpha=0.80, beta=1.10, vorticity=0.15,
        # T5's camera frame is enormous (ortho_scale~29, half-height~14.5) to
        # fit the tall directional column, so debris have far more headroom
        # before exiting frame than T3/T4 -- a moderate boost is safe here.
        debris_velocity_mult=1.3, debris_size_mult=1.4,
        preset="directional", velocitydim=1.8, randomspreaddim=0.55, dissolve_speed=150,
        crop_content=True,
        hires_frames=40, lores_frames=20,
    ),
}


def _parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = argv[1:]
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--tier", required=True, choices=list(TIERS.keys()))
    p.add_argument("--postprocess", action="store_true")
    # variant N (1-based): produces a distinct explosion by seeding every
    # particle system with (N-1). flow_source is PARTICLES (verified on the
    # bakes), so a seed change re-rolls the smoke silhouette itself, not just
    # debris scatter -> genuinely different sprite, same tier character.
    # variant 1 == the base filename (no suffix); 2/3 == _v2/_v3.
    p.add_argument("--variant", type=int, default=1)
    return p.parse_args(argv)


def variant_suffix(variant):
    return "" if variant <= 1 else f"_v{variant}"


class Logger:
    def __init__(self, path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.f = open(path, "a", encoding="utf-8")

    def log(self, *a):
        msg = " ".join(str(x) for x in a)
        print(msg)
        self.f.write(msg + "\n")
        self.f.flush()

    def close(self):
        self.f.close()


# ---------------------------------------------------------------------------
# BLENDER STAGE (steps 1-7): generate, scale, retexture, bake, render.
# ---------------------------------------------------------------------------
def run_blender_stage(tier_key, log, variant=1):
    import bpy
    import addon_utils
    import mathutils
    import numpy as np

    tier = TIERS[tier_key]
    suffix = variant_suffix(variant)
    seed = variant - 1
    t0 = time.time()

    # ---- 0. clean scene (avoid default Cube leaking in) ----
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    log("scene cleaned, objects:", len(bpy.data.objects))

    # ---- 1. enable addon ----
    addon_utils.enable("khaos_legacy", default_set=False)
    log("addon enabled")

    scn = bpy.context.scene
    kt = scn.khaos_tool

    # -- read defaults BEFORE touching anything, per spec (do not hardcode
    #    absolute values) --
    default_amount = kt.particleamountdim
    default_duration = kt.particleemissiondurationdim
    default_lifetime = kt.particledlifetimedim
    log(f"khaos_tool defaults (fresh addon enable): particleamountdim={default_amount} "
        f"particleemissiondurationdim={default_duration} particledlifetimedim={default_lifetime}")

    new_amount_f = default_amount * tier["amount_mult"]
    new_amount_int_raw = int(round(new_amount_f))
    new_amount_int = max(1, new_amount_int_raw)
    new_duration = default_duration * tier["duration_mult"]
    new_lifetime = default_lifetime * tier["lifetime_mult"]
    log(f"NOTE: particleamountdim is an IntProperty (Blender API rejects a float assign), "
        f"so {default_amount}*{tier['amount_mult']}={new_amount_f:.3f} must be rounded -> {new_amount_int_raw}. "
        f"With default=1 this means low-mult tiers round to 0 and most mid/high-mult tiers "
        f"round to the same 1 -- flagging this since it reduces this parameter's cross-tier "
        f"differentiation (scale/resolution_max/frame_end/flow_density/vol_density still vary "
        f"fully per the table and remain the primary differentiators). CONFIRMED BY TEST RUN: "
        f"particleamountdim=0 zeroes the particle system count that drives the domain's smoke "
        f"FLOW (settings.count = N * particleamountdim in khaos_legacy), which produced a fully "
        f"transparent render (0 nonzero-alpha px across all sampled frames) for t1 -- i.e. rounding "
        f"to 0 does not just reduce differentiation, it disables the explosion entirely. Applying "
        f"a floor of 1 (max(1, round(...))) as a necessary technical correction; this is a deviation "
        f"from the literal default*mult formula for t1 only (0.4 -> would be 0, floored to 1) and is "
        f"reported here per the 'note numeric deviations' instruction.")
    kt.particleamountdim = new_amount_int
    kt.particleemissiondurationdim = new_duration
    kt.particledlifetimedim = new_lifetime
    log(f"set: particleamountdim={kt.particleamountdim} "
        f"particleemissiondurationdim={kt.particleemissiondurationdim:.3f} "
        f"particledlifetimedim={kt.particledlifetimedim:.3f}")

    for name, val in tier["bools"].items():
        setattr(kt, name, val)
    log("bools set:", tier["bools"])

    # ---- 2. run the tier's preset inside a full VIEW_3D context override
    #         (GUI-mode requirement, see README.md) ----
    # preset "groundburst" (default): radial ground blast.
    # preset "directional": plane emitter firing along its normal — used for
    # tall rising columns (T5). Validated in probe_t5_dir2.py.
    preset = tier.get("preset", "groundburst")
    if tier.get("velocitydim") is not None:
        kt.velocitydim = tier["velocitydim"]
        log(f"velocitydim set to {kt.velocitydim}")
    if tier.get("randomspreaddim") is not None:
        kt.randomspreaddim = tier["randomspreaddim"]
        log(f"randomspreaddim set to {kt.randomspreaddim}")

    scn.cursor.location = (0, 0, 0)
    win = bpy.context.window_manager.windows[0]
    area = next(a for a in win.screen.areas if a.type == "VIEW_3D")
    region = next(r for r in area.regions if r.type == "WINDOW")

    preset_ops = {
        "groundburst": ("my.groundburstexplosion", "my.omnidirectionalexplosion"),
        "directional": ("my.directionexplosion", None),
    }
    primary_op, fallback_op = preset_ops[preset]

    def _call_op(op_path):
        mod, name = op_path.split(".")
        getattr(getattr(bpy.ops, mod), name)()

    before_names = set(bpy.data.objects.keys())
    op_err = None
    with bpy.context.temp_override(window=win, screen=win.screen, area=area, region=region):
        try:
            _call_op(primary_op)
            log(f"{primary_op}: FINISHED")
        except Exception:
            op_err = traceback.format_exc()
            log(f"{primary_op} FAILED:\n", op_err)
    if op_err:
        if fallback_op is None:
            raise RuntimeError(f"{primary_op} failed and tier has no fallback:\n{op_err}")
        with bpy.context.temp_override(window=win, screen=win.screen, area=area, region=region):
            try:
                _call_op(fallback_op)
                log(f"fallback {fallback_op}: FINISHED")
            except Exception:
                log(f"{fallback_op} FAILED too:\n", traceback.format_exc())
                raise

    after_names = set(bpy.data.objects.keys())
    new_names = after_names - before_names
    new_objects = [bpy.data.objects[n] for n in new_names]

    # ---- 2c. variant seeding ----
    # Re-seed every particle system so a variant is a genuinely different
    # explosion. Must happen before bake (seed feeds the PARTICLES flow source
    # that drives the Mantaflow sim). variant 1 -> seed 0 reproduces the
    # approved base look.
    n_seeded = 0
    for obj in new_objects:
        for ps in obj.particle_systems:
            ps.seed = seed
            n_seeded += 1
    log(f"variant {variant}: seeded {n_seeded} particle systems with seed={seed}")

    if preset == "directional":
        # The directional preset spawns every emitter tilted 65 deg around Y
        # (side-blast demo default). Zero the rotation so the plane normal
        # (and thus normal_factor particle emission) points straight up (+Z),
        # turning the side fan into a rising column.
        for obj in new_objects:
            has_flow = any(m.type == "FLUID" and m.fluid_type == "FLOW" for m in obj.modifiers)
            if has_flow or len(obj.particle_systems) > 0:
                obj.rotation_euler = (0.0, 0.0, 0.0)
                log(f"zeroed emitter rotation: {obj.name}")

    # ---- 3. inventory + hard asserts ----
    domain = None
    flows = []
    for obj in new_objects:
        kinds = []
        for m in obj.modifiers:
            if m.type == "FLUID":
                kinds.append(m.fluid_type)
                if m.fluid_type == "DOMAIN":
                    domain = obj
                elif m.fluid_type == "FLOW":
                    flows.append(obj)
        log(f"  obj: {obj.name} type={obj.type} fluid={kinds} psys={len(obj.particle_systems)} "
            f"parent={obj.parent.name if obj.parent else None}")
    assert domain is not None, "no smoke domain created"
    assert len(flows) >= 1, "no flow objects created"
    assert "Cube" not in bpy.data.objects, "default cube leaked"
    log(f"inventory OK: domain={domain.name}, flows={len(flows)}, total_new_objects={len(new_objects)}")

    # ---- 3b. debris launch-velocity/fineness override ----
    # 2026-07-11 (user: fine debris that clears the smoke, not chunky pieces
    # buried inside it): debris particle systems render_type=='COLLECTION'
    # (rock/concrete/rebar/metal/glass/wood/branch/dirt/spark/burning);
    # smoke/fire itself is render_type=='HALO'. This distinguishes them
    # cleanly without hardcoding names. normal_factor (launch speed) is
    # sourced from scene.khaos_tool.velocitydim at generation time, but that
    # property is SHARED with the smoke/fire flows -- raising it globally
    # would also speed up the already-tuned vertical plume. So debris get a
    # targeted post-generation override instead: only their own
    # normal_factor and particle_size, smoke/fire left untouched. Confirmed
    # via probe (scratchpad/khaos_tiers/sizetest_t4_f030.png) that particle
    # SIZE alone doesn't help -- debris were fully occluded inside the dense
    # smoke volume; only escaping the volume via higher velocity fixes it.
    debris_vel_mult = tier.get("debris_velocity_mult", 1.0)
    debris_size_mult = tier.get("debris_size_mult", 1.0)
    if debris_vel_mult != 1.0 or debris_size_mult != 1.0:
        n_debris_psys = 0
        for obj in new_objects:
            for ps in obj.particle_systems:
                if ps.settings.render_type == "COLLECTION":
                    ps.settings.normal_factor *= debris_vel_mult
                    ps.settings.particle_size *= debris_size_mult
                    n_debris_psys += 1
        log(f"debris override: {n_debris_psys} particle systems, "
            f"velocity x{debris_vel_mult}, size x{debris_size_mult}")

    # ---- 4. geometry scale, around world origin ----
    # The addon never parents generated objects to each other (verified by
    # reading khaos_legacy/__init__.py — no `.parent =` assignments anywhere),
    # so independently multiplying each new object's own location & scale by
    # the tier factor is equivalent to a uniform scale of the whole assembly
    # about (0, 0, 0), without needing a 3D-cursor-pivot transform op.
    scale = tier["scale"]
    for obj in new_objects:
        obj.location = obj.location * scale
        obj.scale = obj.scale * scale
    log(f"scaled {len(new_objects)} new objects by {scale}x around origin")

    # ---- 4b. ground-anchored vertical (Z-only) stretch ----
    # Multiplying only the Z component of location+scale, pivoted at world
    # Z=0 (the true burst origin, where the flow emitters sit), stretches the
    # domain container upward without moving the ground contact point — this
    # gives the sim physical headroom to develop a rising column instead of
    # hitting the domain ceiling. Anchoring at the domain's own bound_box
    # minimum instead of world Z=0 was tried first (probe_vertical.py) and
    # rejected: the groundburst preset's domain is itself symmetric about the
    # burst point, so its bbox minimum sits well *below* true ground, and
    # anchoring there just inflates unused underground volume and floats the
    # visible burst in the middle of the frame.
    #
    # 2026-07-11 bug fix: this must NOT apply to debris TEMPLATE objects
    # (the actual rock/rebar/concrete/etc. meshes referenced by a particle
    # system's instance_collection) -- their own object.scale is the base
    # size for every particle instance, and Z-only stretch warped them into
    # grotesque non-isotropic spikes/slabs (e.g. "Rebar Piece one" ended up
    # scale=(0.042, 0.042, 2.393), a ~57x aspect distortion -- confirmed via
    # scratchpad/khaos_tiers debug dump). Debris templates still get the
    # isotropic "scale" step above (bigger caliber -> bigger chunks is
    # correct), just not this Z-only pass. Domain/flows/emitter meshes (which
    # define the plume's shape, not individual debris pieces) still stretch.
    debris_template_names = set()
    for scan_obj in new_objects:
        for ps in scan_obj.particle_systems:
            ic = ps.settings.instance_collection
            if ic:
                for sub in ic.objects:
                    debris_template_names.add(sub.name)

    vstretch = tier["vertical_stretch"]
    if vstretch != 1.0:
        n_stretched = 0
        for obj in new_objects:
            if obj.name in debris_template_names:
                continue
            loc = obj.location
            obj.location = mathutils.Vector((loc.x, loc.y, loc.z * vstretch))
            scl = obj.scale
            obj.scale = mathutils.Vector((scl.x, scl.y, scl.z * vstretch))
            n_stretched += 1
        log(f"vertical-stretched {n_stretched}/{len(new_objects)} new objects by {vstretch}x around world Z=0 "
            f"({len(debris_template_names)} debris templates exempted)")

    # ---- 5. material rebuild — cinematic dry-earth volume ----
    # 2026-07-12 (user: cinematic realistic dust/debris blast, matched to the
    # sunlit hex tiles). Validated in scratchpad/khaos_tiers/cine3/crisp/upres
    # probes. Key changes from the earlier soft look:
    #  - density ~2.9x higher -> opaque body with sunlit/shadowed FACES (the
    #    thing that makes it read as a lit 3D mass instead of a soft haze)
    #  - dry-earth color, forward anisotropy 0.35 -> lit rims toward the sun
    #  - fire subdued (blackbody capped at 0.5) so it reads dust-and-debris,
    #    not fireball; tiers that never had fire (T1/T2, blackbody 0) stay 0.
    cine_density = float(tier["vol_density"]) * 2.9
    cine_blackbody = min(float(tier["blackbody"]), 0.5)
    mat = domain.material_slots[0].material
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    pv = nt.nodes.new("ShaderNodeVolumePrincipled")
    pv.inputs["Color"].default_value = (0.42, 0.36, 0.28, 1.0)
    pv.inputs["Density"].default_value = cine_density
    pv.inputs["Density Attribute"].default_value = "density"
    pv.inputs["Blackbody Intensity"].default_value = cine_blackbody
    pv.inputs["Temperature"].default_value = float(tier["temperature"])
    pv.inputs["Temperature Attribute"].default_value = "temperature"
    pv.inputs["Anisotropy"].default_value = 0.35
    nt.links.new(pv.outputs["Volume"], out.inputs["Volume"])
    log(f"material (cinematic): density={cine_density:.1f} blackbody={cine_blackbody} T={tier['temperature']}")

    # ---- 6. domain settings ----
    ds = next(m for m in domain.modifiers if m.type == "FLUID" and m.fluid_type == "DOMAIN").domain_settings
    scn.frame_start = 1
    scn.frame_end = tier["frame_end"]
    ds.resolution_max = tier["resolution_max"]
    # 2026-07-12: Mantaflow noise UPRES is the real crisp-smoke lever (user
    # wanted photoreal turbulent detail when zoomed in). A/B triptych
    # (scratchpad/khaos_tiers/detail_triptych.png) showed noise_scale=4 gives
    # genuine fine wisps/billows that a shader-noise hack could not. This is
    # the expensive part: the noise pass is baked on top of the base sim by
    # bake_all() and cost ~1056s for T4 alone. Effective grid = resolution_max
    # x noise_scale (e.g. T4 112x4 = 448).
    ds.use_noise = True
    ds.noise_scale = 4
    ds.noise_strength = 1.35
    ds.noise_pos_scale = 1.3
    ds.vorticity = tier["vorticity"]
    # alpha/beta: FluidDomainSettings RNA confirms both are "higher = faster
    # rising smoke" (density-buoyancy and heat-buoyancy respectively) -- the
    # primary lever, alongside the vertical stretch above, for the
    # progressively-taller-plume look validated in probe_vertical2/3.py.
    ds.alpha = tier["alpha"]
    ds.beta = tier["beta"]
    log(f"buoyancy: alpha={tier['alpha']} beta={tier['beta']} vorticity={tier['vorticity']}")

    # dissolve_speed direction: fetch + log the live RNA description (do not
    # guess), and cross-check against empirical evidence already on record in
    # this session's scratchpad (khaos_test/run_log_v7.txt): dissolve_speed=60
    # on a 56-frame sim left the smoke NOT fully dissolved by the final frame
    # (nonzero-alpha pixel count still ~22762 at frame 52, decaying only
    # slowly) -> a LARGER dissolve_speed value means SLOWER dissolve / smoke
    # persists LONGER. We want bigger tiers to keep their smoke around longer,
    # so dissolve_speed scales UP with frame_end, anchored to the v7 precedent
    # (frame_end=56 -> dissolve_speed=60).
    desc = bpy.types.FluidDomainSettings.bl_rna.properties["dissolve_speed"].description
    log(f"dissolve_speed RNA description (live, this Blender): {desc!r}")
    log("dissolve_speed direction basis: empirical (khaos_test/run_log_v7.txt: speed=60 leaves "
        "smoke undissolved at end of a 56f sim -> larger=slower/longer-lasting). "
        "Setting dissolve_speed proportional to frame_end, anchored at v7's (56 -> 60).")
    if tier.get("dissolve_speed") is not None:
        # explicit per-tier override (tall-column tiers need much slower
        # dissolve so smoke survives the longer climb — probe_t5_dir2.py)
        dissolve_speed = tier["dissolve_speed"]
    else:
        dissolve_speed = max(1, round(tier["frame_end"] * (60.0 / 56.0)))
    ds.dissolve_speed = dissolve_speed
    ds.use_dissolve_smoke = True
    ds.use_dissolve_smoke_log = True
    log(f"dissolve_speed set to {dissolve_speed} for frame_end={tier['frame_end']}")

    cache_dir = os.path.join(TIER_BASE, f"cache_{tier_key}{suffix}")
    ds.cache_directory = cache_dir
    ds.cache_type = "ALL"
    ds.cache_frame_start = 1
    ds.cache_frame_end = tier["frame_end"]
    log(f"domain: resolution_max={ds.resolution_max} frame_end={tier['frame_end']} cache={cache_dir}")

    for obj in flows:
        for m in obj.modifiers:
            if m.type == "FLUID" and m.fluid_type == "FLOW":
                m.flow_settings.density = tier["flow_density"]
                log(f"flow {obj.name}: density -> {tier['flow_density']}")

    # ---- 7. bake ----
    t_bake = time.time()
    with bpy.context.temp_override(object=domain, active_object=domain, selected_objects=[domain]):
        bpy.ops.fluid.bake_all()
    bake_s = time.time() - t_bake
    n_cache = 0
    for _root, _dirs, files in os.walk(cache_dir):
        n_cache += len(files)
    log(f"bake done in {bake_s:.1f}s, cache files: {n_cache}")
    assert n_cache >= tier["frame_end"], f"cache too small ({n_cache} files) -- bake likely failed"

    # ---- render prep: hide flows + helper (non-emitting) debris meshes ----
    # 2026-07-11: a same-day "fix" here (exempting particle-instance-referenced
    # debris templates from this hide) was ITSELF the bug, not a repair --
    # confirmed by direct A/B render tests (scratchpad/khaos_tiers/
    # diag_t1_*.png): Collection-instanced particle systems render their
    # scattered instances fine regardless of the source/template object's own
    # hide_render flag. Un-hiding the templates didn't reveal new instanced
    # debris; it revealed the template objects' own STATIC copies, sitting
    # unmoving at their library position near the origin every frame (the
    # "totem pole" artifact -- 5 stacked "Dirt piece N" objects rendering
    # directly, not a smoke/material bug and not a scale bug). Reverted to
    # the original unconditional hide, which is correct: it suppresses the
    # template's own direct render while leaving Collection-based particle
    # instancing fully intact.
    for obj in flows:
        obj.hide_render = True
        log(f"hide_render: {obj.name}")
    for obj in bpy.data.objects:
        if obj.type == "MESH" and obj is not domain and obj not in flows and len(obj.particle_systems) == 0:
            obj.hide_render = True
            log(f"hide_render (helper): {obj.name}")

    # ---- cinematic lighting: matched EXACTLY to the hex-tile rig ----
    # 2026-07-12 (user: "背景マップは日中の強い光が落ちてるけど煙火には当たって
    # ない"). Copied verbatim from scripts/hex_ruins/rig_setup.py so the blast
    # sits in the same daylight as the terrain: warm key sun from the SW at
    # 62deg elevation + a cool overcast sky fill. This is what carves the
    # sunlit/shadowed faces that make the smoke read as a lit solid mass.
    sun_data = bpy.data.lights.new("Sun", type="SUN")
    sun_data.energy = 5.5          # tiles use 4.2; volumes eat more light
    sun_data.color = (1.0, 0.93, 0.82)
    sun_data.angle = math.radians(5.0)
    sun = bpy.data.objects.new("Sun", sun_data)
    scn.collection.objects.link(sun)
    _sun_elev = math.radians(62.0)
    _az_to = math.radians(45.0)    # light travels toward NE (comes from SW)
    _d = mathutils.Vector((math.cos(_sun_elev) * math.sin(_az_to),
                           math.cos(_sun_elev) * math.cos(_az_to),
                           -math.sin(_sun_elev)))
    sun.rotation_euler = _d.to_track_quat("-Z", "Y").to_euler()

    world = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
    scn.world = world
    world.use_nodes = True
    _wn = world.node_tree.nodes
    _wl = world.node_tree.links
    _wn.clear()
    _bg = _wn.new("ShaderNodeBackground")
    _bg.inputs[0].default_value = (0.45, 0.52, 0.62, 1.0)   # cool overcast sky
    _bg.inputs[1].default_value = 0.55
    _wout = _wn.new("ShaderNodeOutputWorld")
    _wl.new(_bg.outputs[0], _wout.inputs[0])

    bb = [domain.matrix_world @ mathutils.Vector(c) for c in domain.bound_box]
    cx = sum(v.x for v in bb) / 8.0
    cy = sum(v.y for v in bb) / 8.0
    z_max = max(v.z for v in bb)
    z_min = min(v.z for v in bb)
    x_span = max(v.x for v in bb) - min(v.x for v in bb)
    # 2026-07-12 (user: "飛び散るデブリが見切れないように"): debris particles fly
    # OUTSIDE the smoke domain bbox, so framing on the domain alone hard-clips
    # them at the raw frame edge. Widen the raw camera by debris_headroom so
    # the flung debris stays inside the render; the postprocess content-crop
    # (now enabled for every tier) then tightens to the true smoke+debris
    # alpha union, so nothing reads as abruptly cut.
    headroom = tier.get("debris_headroom", 1.35)
    if tier["vertical_stretch"] > 1.0:
        # Vertically-stretched tiers: the domain is symmetric about the burst
        # origin (Z=0), so most of its lower half is unused dead volume the
        # rising smoke never reaches. Frame an asymmetric "useful span"
        # (a small margin below ground up to the true top) instead of the
        # full symmetric bbox, validated visually in probe_vertical3 --
        # otherwise half the frame is wasted transparent space and the
        # explosion reads small/floating instead of filling the sprite cell.
        useful_min_z = -0.15 * z_max
        target_z = (useful_min_z + z_max) / 2.0
        ortho_scale = max((z_max - useful_min_z) * 1.1, x_span * 1.15) * headroom
    else:
        target_z = (z_max + z_min) / 2.0
        ortho_scale = max(z_max - z_min, x_span) * tier.get("frame_margin", 1.15) * headroom
    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = ortho_scale
    cam = bpy.data.objects.new("Cam", cam_data)
    scn.collection.objects.link(cam)
    theta = math.radians(55.0)
    dist = 100.0
    cam.location = (cx, cy - dist * math.cos(theta), target_z + dist * math.sin(theta))
    direction = mathutils.Vector((cx, cy, target_z)) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scn.camera = cam
    log(f"camera: ortho_scale={ortho_scale:.3f} target_z={target_z:.2f} domain_xy=({cx:.2f},{cy:.2f}) z_span=({z_min:.2f}..{z_max:.2f})")

    scn.render.engine = "CYCLES"
    scn.cycles.samples = 160
    scn.cycles.use_denoising = True
    scn.cycles.device = "CPU"
    scn.render.film_transparent = True
    # fine volume sampling so the upres detail actually resolves in-render
    # (coarse steps would blur away the noise-pass wisps we paid to bake)
    scn.cycles.volume_step_rate = 0.25
    scn.cycles.volume_max_steps = 1024
    # 2026-07-11 (round 2): 256 native still read as "soft" once actually
    # displayed -- the map overlay upscales explosions to match hex size
    # (map_preview_explosions.html's sizeMul), and T4/T5 need up to ~357-466
    # display px, so 256 was being STRETCHED there (the real blur source,
    # confirmed via denoise on/off A-B test showing no difference -- the
    # softness isn't a denoiser artifact). 512 covers T5's ~466px need with
    # margin, so every tier ends up at <=1.0x (native or downscaled, never
    # upscaled) at its actual on-screen size.
    scn.render.resolution_x = 512
    scn.render.resolution_y = 512
    scn.render.resolution_percentage = 100
    scn.render.image_settings.file_format = "PNG"
    scn.render.image_settings.color_mode = "RGBA"
    scn.cycles.volume_bounces = 2

    prod_dir = os.path.join(TIER_BASE, f"prod_{tier_key}{suffix}")
    os.makedirs(prod_dir, exist_ok=True)
    t_render = time.time()
    render_count = 0
    for f in range(2, tier["frame_end"] + 1):
        scn.frame_set(f)
        path = os.path.join(prod_dir, f"frame_{f:03d}.png")
        scn.render.filepath = path
        bpy.ops.render.render(write_still=True)
        render_count += 1
    log(f"rendered {render_count} frames in {time.time() - t_render:.1f}s -> {prod_dir}")

    # sanity: nonzero-alpha pixel count must differ across frames (unbaked
    # / unrendered sims would render an identical/empty result every frame)
    sample_frames = sorted(set([2, (2 + tier["frame_end"]) // 2, tier["frame_end"]]))
    nz_counts = []
    for f in sample_frames:
        img = bpy.data.images.load(os.path.join(prod_dir, f"frame_{f:03d}.png"))
        px = np.array(img.pixels[:]).reshape(-1, 4)
        nz = int((px[:, 3] > 0.004).sum())
        nz_counts.append(nz)
        bpy.data.images.remove(img)
    log(f"alpha nonzero sample @ frames {sample_frames}: {nz_counts}")
    assert len(set(nz_counts)) > 1, "alpha identical across sampled frames -- possible unbaked/unrendered sim"

    blend_path = os.path.join(TIER_BASE, f"khaos_tier_{tier_key}{suffix}.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    log(f"saved {blend_path}")
    log(f"BLENDER STAGE total {time.time() - t0:.1f}s")


# ---------------------------------------------------------------------------
# POST-PROCESS STAGE (steps 8-10): fade tail, pack sheets, write JSON.
# Runs under the system python (Pillow + numpy) — Blender's bundled python has
# no PIL (verified: `blender.exe -b --python-expr "import PIL"` -> ModuleNotFoundError).
# ---------------------------------------------------------------------------
def _select_n(frame_paths, n):
    """Evenly sample n paths out of frame_paths, preserving order, no duplicates."""
    import numpy as np
    if len(frame_paths) <= n:
        return list(frame_paths)
    idx = np.round(np.linspace(0, len(frame_paths) - 1, n)).astype(int)
    result_idx = []
    seen = set()
    for i in idx:
        ii = int(i)
        while ii in seen and ii < len(frame_paths) - 1:
            ii += 1
        seen.add(ii)
        result_idx.append(ii)
    result_idx = sorted(set(result_idx))
    if len(result_idx) < n:
        remaining = [i for i in range(len(frame_paths)) if i not in result_idx]
        result_idx = sorted(result_idx + remaining[: n - len(result_idx)])
    return [frame_paths[i] for i in result_idx[:n]]


def _smoothstep(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def run_postprocess(tier_key, log, variant=1):
    import re
    import numpy as np
    from PIL import Image, ImageFilter

    tier = TIERS[tier_key]
    suffix = variant_suffix(variant)
    prod_dir = os.path.join(TIER_BASE, f"prod_{tier_key}{suffix}")
    faded_dir = os.path.join(TIER_BASE, f"prod_{tier_key}{suffix}_faded")
    os.makedirs(faded_dir, exist_ok=True)

    pattern = re.compile(r"^frame_(\d+)\.png$", re.IGNORECASE)
    frame_entries = []
    for fname in sorted(os.listdir(prod_dir)):
        m = pattern.match(fname)
        if m:
            frame_entries.append((int(m.group(1)), os.path.join(prod_dir, fname)))
    frame_entries.sort()
    log(f"loaded {len(frame_entries)} rendered frames from {prod_dir}")
    assert frame_entries, f"no rendered frames found in {prod_dir}"

    # ---- 8. tail fade: timeline 60%+ smoothstep alpha -> 0 ----
    frame_end = tier["frame_end"]
    fade_start = frame_end * 0.6
    faded_paths = []
    for fnum, path in frame_entries:
        img = Image.open(path).convert("RGBA")
        arr = np.array(img).astype(np.float32)
        if fnum >= fade_start:
            t = (fnum - fade_start) / max(1e-6, (frame_end - fade_start))
            mult = 1.0 - _smoothstep(t)
        else:
            mult = 1.0
        arr[:, :, 3] *= mult
        out_img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")
        out_path = os.path.join(faded_dir, f"frame_{fnum:03d}.png")
        out_img.save(out_path)
        faded_paths.append(out_path)
    log(f"faded {len(faded_paths)} frames -> {faded_dir} (fade_start=frame {fade_start:.1f}/{frame_end})")

    # The tail fade drives alpha to exactly 0 by frame_end (by construction),
    # and the first 1-2 rendered frames can still be blank before the sim
    # visibly ignites. Naively evenly-sampling across the FULL faded frame
    # list (as pack_sheets.py's original select_frames did) can therefore pick
    # a genuinely all-transparent frame at either end, which fails the "no
    # empty cells" sheet requirement even though every grid slot is filled
    # with a distinct frame. Trim fully-blank frames off both ends before
    # even-sampling so every selected frame has visible content.
    # 2026-07-12: treat "alpha max <= 3" as blank, not just ==0. The tail-fade
    # frames dissolve to near-zero alpha, and the denoiser paints color
    # garbage onto those near-empty low-density frames (harmless in-game at
    # ~0.4% opacity, but ugly as a retained sprite frame). max<=3 trims those
    # ghost frames while keeping any real ignition/dissipation content.
    usable_paths = []
    blank_flags = []
    for p in faded_paths:
        a = np.array(Image.open(p).convert("RGBA"))[:, :, 3]
        blank_flags.append(bool(a.max() <= 3))
    first_usable = 0
    while first_usable < len(blank_flags) and blank_flags[first_usable]:
        first_usable += 1
    last_usable = len(blank_flags) - 1
    while last_usable > first_usable and blank_flags[last_usable]:
        last_usable -= 1
    usable_paths = faded_paths[first_usable:last_usable + 1] if first_usable <= last_usable else faded_paths
    log(f"trimmed {first_usable} leading + {len(faded_paths) - 1 - last_usable} trailing all-blank "
        f"frames before sampling -> {len(usable_paths)}/{len(faded_paths)} usable frames")

    # ---- optional content-aware crop (crop_content tiers) ----
    # Tall-column tiers frame the camera on the full stretched domain, but the
    # actual plume is much narrower than the domain box, leaving big
    # transparent margins in every cell. Compute the union alpha bbox across
    # all usable frames (so the animation stays registered — every frame gets
    # the SAME crop), square it up, add a small margin, and crop before
    # packing. Pure postprocess: no rebake needed.
    # 2026-07-12: content-crop is now ON for EVERY tier (was opt-in). With the
    # camera widened by debris_headroom, the raw render contains the full
    # smoke+debris spread with slack; the union-alpha crop then frames tightly
    # to what's actually there, so flying debris is included, not hard-cut.
    crop_box = None
    if tier.get("crop_content", True):
        union = None
        for p in usable_paths:
            a = np.array(Image.open(p).convert("RGBA"))[:, :, 3]
            union = a if union is None else np.maximum(union, a)
        # threshold >6 (not >2) so a stray denoiser speckle can't balloon the
        # crop; solid debris chunks and real dust are well above this.
        ys, xs = np.where(union > 6)
        assert len(xs) > 0, "content crop requested but union alpha is empty"
        x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        w, h = x1 - x0, y1 - y0
        # crop_margin: the square side is max(w,h)*crop_margin, centered on the
        # content. Because it's a SQUARE, a wide-and-low explosion (w>>h) gets
        # margin only from (crop_margin-1) on its LONG (horizontal) axis -- at
        # the old fixed 1.04 that was ~2px each side, so the fan read as clipped
        # even though the raw render didn't clip (2026-07-11 user report). Make
        # it per-tier: wide radial tiers (T1/T2) need a generous margin so the
        # horizontal fan has real breathing room; tall tiers (T5) look right at
        # a tight 1.04 (a tapering column filling the cell is the intent).
        crop_margin = tier.get("crop_margin", 1.12)
        side = int(round(max(w, h) * crop_margin))
        img_w, img_h = union.shape[1], union.shape[0]
        side = min(side, img_w, img_h)
        cx_, cy_ = (x0 + x1) // 2, (y0 + y1) // 2
        left = int(min(max(0, cx_ - side // 2), img_w - side))
        top = int(min(max(0, cy_ - side // 2), img_h - side))
        crop_box = (left, top, left + side, top + side)
        log(f"content crop: union bbox=({x0},{y0})-({x1},{y1}) -> square crop {crop_box} "
            f"(fills {side}px of {img_w}px source, was {max(w, h)}px content)")

    # ---- adjacent-frame alpha variation sanity check (unbaked detector) ----
    sample = [frame_entries[0][0], frame_entries[len(frame_entries) // 2][0], frame_entries[-1][0]]
    nz = []
    for fnum in sample:
        p = os.path.join(prod_dir, f"frame_{fnum:03d}.png")
        a = np.array(Image.open(p).convert("RGBA"))[:, :, 3]
        nz.append(int((a > 1).sum()))
    log(f"prod alpha nonzero @ frames {sample}: {nz}")
    assert len(set(nz)) > 1, "identical nonzero-alpha counts across sample frames -- possible unbaked sim"

    # ---- 9. sprite sheet packing (no-empty-trailing-row grid) ----
    # 2026-07-12 (user, after seeing style_compare.html side-by-side test):
    # decided on Style C (Unsharp Mask) + a 256px final frame, sourced from
    # the native 512px renders. Filtering BEFORE the downscale (not after) is
    # deliberate: sharpening at the higher source resolution then downsizing
    # gives the resize's own antialiasing a chance to clean up any sharpening
    # halos, which reads crisper than sharpening at the final 256 directly.
    UNSHARP = ImageFilter.UnsharpMask(radius=3, percent=250, threshold=2)

    def alpha_scurve(im, strength=0.5):
        # Contrast S-curve on the ALPHA channel only: pushes the wide
        # semi-transparent boundary toward opaque-or-gone, hardening the
        # silhouette so the mass reads as a solid lit body rather than a soft
        # haze. Part of the approved cinematic finalize (cine3_final look).
        arr = np.array(im).astype(np.float32)
        a = arr[:, :, 3] / 255.0
        curved = a * a * (3.0 - 2.0 * a)
        arr[:, :, 3] = np.clip((a * (1.0 - strength) + curved * strength) * 255.0, 0, 255)
        return Image.fromarray(arr.astype(np.uint8), "RGBA")

    def build_sheet(paths, frame_size, cols, target_n):
        selected = _select_n(paths, target_n)
        imgs = []
        for p in selected:
            im = Image.open(p).convert("RGBA")
            if crop_box is not None:
                im = im.crop(crop_box)
            # 2026-07-12: unsharp mask dropped at user request -- the noise
            # upres now supplies real detail, so the sharpen (which had been
            # compensating for soft volumetric smoke) is no longer needed and
            # its halos read as artificial next to genuine turbulent wisps.
            # Alpha S-curve (edge hardening) is kept.
            im = alpha_scurve(im, 0.5)
            imgs.append(im.resize((frame_size, frame_size), Image.LANCZOS))
        n = len(imgs)
        rows = math.ceil(n / cols)
        sheet = Image.new("RGBA", (cols * frame_size, rows * frame_size), (0, 0, 0, 0))
        for i, im in enumerate(imgs):
            r, c = divmod(i, cols)
            sheet.paste(im, (c * frame_size, r * frame_size))
        arr = np.array(sheet)
        # defensive crop: remove a fully-empty trailing row if one ever appears
        while rows > 1:
            row_alpha = arr[(rows - 1) * frame_size: rows * frame_size, :, 3]
            if row_alpha.max() == 0:
                rows -= 1
                sheet = sheet.crop((0, 0, cols * frame_size, rows * frame_size))
                arr = np.array(sheet)
            else:
                break
        return sheet, n, cols, rows

    # Ship size 384 (2026-07-12): the cinematic + noise-upres render carries
    # real fine detail now, so downscaling all the way to 256 would throw away
    # what the (expensive) upres bake bought. 384 preserves it while keeping
    # the widest sheet (8 cols x 384 = 3072px) safely under the common 4096
    # GPU texture limit -- 512 would push T-tier sheets to 4096 wide, right at
    # the edge. At the largest in-game display (~466px for T5) 384 is only a
    # mild ~1.2x upscale, well within what the sharpened detail supports.
    HI_FRAME_SIZE = 384
    sheet_hi, n_hi, cols_hi, rows_hi = build_sheet(usable_paths, HI_FRAME_SIZE, 8, tier["hires_frames"])
    sheet_lo, n_lo, cols_lo, rows_lo = build_sheet(usable_paths, 64, 4, tier["lores_frames"])

    os.makedirs(ASSET_DIR, exist_ok=True)
    hi_path = os.path.join(ASSET_DIR, f"explosion_khaos_{tier_key}{suffix}_{HI_FRAME_SIZE}.png")
    lo_path = os.path.join(ASSET_DIR, f"explosion_khaos_{tier_key}{suffix}_64.png")
    sheet_hi.save(hi_path)
    sheet_lo.save(lo_path)
    log(f"saved {hi_path} ({sheet_hi.width}x{sheet_hi.height}, {n_hi}f grid {cols_hi}x{rows_hi})")
    log(f"saved {lo_path} ({sheet_lo.width}x{sheet_lo.height}, {n_lo}f grid {cols_lo}x{rows_lo})")

    def check_empty_cells(sheet, frame_size, cols, rows):
        arr = np.array(sheet)
        empties = []
        for r in range(rows):
            for c in range(cols):
                cell = arr[r * frame_size:(r + 1) * frame_size, c * frame_size:(c + 1) * frame_size, 3]
                if cell.size and cell.max() == 0:
                    empties.append((r, c))
        return empties

    empty_hi = check_empty_cells(sheet_hi, HI_FRAME_SIZE, cols_hi, rows_hi)
    empty_lo = check_empty_cells(sheet_lo, 64, cols_lo, rows_lo)
    if empty_hi or empty_lo:
        log(f"NOTE: partial last row leaves individual empty grid CELLS (cols is fixed per spec, "
            f"and the tier's frame count isn't always a multiple of it): hi={empty_hi} lo={empty_lo}. "
            f"This is purely a layout artifact (no fully-empty trailing ROW was left uncropped, "
            f"which was the literal spec rule) -- every frame slot that IS filled now has real, "
            f"non-blank content (blank-alpha frames are pre-trimmed above), so these are simply "
            f"unused trailing slots, standard for sprite sheets driven by a frame-count field in "
            f"the JSON metadata.")

    # ---- 10. JSON metadata ----
    def write_json(png_path, n, cols, rows, frame_size, sheet):
        meta = {
            "frames": n, "cols": cols, "rows": rows, "frameSize": frame_size,
            "sheetWidth": sheet.width, "sheetHeight": sheet.height,
        }
        json_path = png_path[:-4] + ".json"
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)
        return json_path, meta

    hi_json_path, hi_meta = write_json(hi_path, n_hi, cols_hi, rows_hi, HI_FRAME_SIZE, sheet_hi)
    lo_json_path, lo_meta = write_json(lo_path, n_lo, cols_lo, rows_lo, 64, sheet_lo)
    log(f"saved {hi_json_path}: {hi_meta}")
    log(f"saved {lo_json_path}: {lo_meta}")

    # ---- fire_px representative (v7-style detector) on the hires-selected frames ----
    selected_hi = _select_n(usable_paths, tier["hires_frames"])
    fire_pxs = []
    for p in selected_hi:
        arr = np.array(Image.open(p).convert("RGBA")).astype(np.float32) / 255.0
        a = arr[:, :, 3]
        vis = arr[a > 0.03]
        fire = int(((vis[:, 0] > vis[:, 2] * 1.35) & (vis[:, 0] > 0.15)).sum()) if len(vis) else 0
        fire_pxs.append(fire)
    fire_repr = max(fire_pxs) if fire_pxs else 0
    log(f"fire_px per selected hires-frame: {fire_pxs} -> representative(max)={fire_repr}")

    report = {
        "tier": tier_key,
        "label": tier["label"],
        "hires_sheet": {"path": hi_path, "frames": n_hi, "cols": cols_hi, "rows": rows_hi, "empty_cells": empty_hi},
        "lores_sheet": {"path": lo_path, "frames": n_lo, "cols": cols_lo, "rows": rows_lo, "empty_cells": empty_lo},
        "fire_px_representative": fire_repr,
        "fire_px_per_frame": fire_pxs,
    }
    with open(os.path.join(TIER_BASE, f"report_{tier_key}{suffix}.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    log(f"POSTPROCESS STAGE done for {tier_key}{suffix}")


def main():
    args = _parse_args()
    suffix = variant_suffix(args.variant)
    log_path = os.path.join(TIER_BASE, f"log_{args.tier}{suffix}.txt")
    logger = Logger(log_path)
    ok = True
    try:
        if args.postprocess:
            run_postprocess(args.tier, logger.log, variant=args.variant)
        else:
            run_blender_stage(args.tier, logger.log, variant=args.variant)
    except Exception:
        ok = False
        logger.log("FATAL:\n" + traceback.format_exc())
    finally:
        logger.close()
    return ok


if __name__ == "__main__":
    os.makedirs(TIER_BASE, exist_ok=True)
    result_ok = main()
    try:
        import bpy
        bpy.ops.wm.quit_blender()
    except ImportError:
        if not result_ok:
            sys.exit(1)

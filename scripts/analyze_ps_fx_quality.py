#!/usr/bin/env python3
"""Measure canonical Panzer Strike effect animation quality and build study plates.

Source observations are computed from canonical per-slot PNGs. Inferred rules are
kept out of the CSV and written explicitly as inference in the generated spec.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "asset/ps_fx/inventory/catalog.json"
OUT = ROOT / "asset/ps_fx/study"
CANONICAL = ROOT / "scratch/ps_sprites_canonical_v1"
HEX_SIZE = 54.0
HEX_WIDTH = math.sqrt(3) * HEX_SIZE

CATEGORIES = {
    "explosion", "impact_smoke", "armor_impact_smoke", "muzzle_smoke",
    "vehicle_track_smoke", "impact_dust", "vehicle_track_dust",
    "persistent_fire", "sparks", "ground_impact", "building_impact",
    "vehicle_destroy", "ground_debris_fragment",
}

REPRESENTATIVES = {
    "fire": "animations_fire_cell_00",
    "light-explosion": "animations_guns_gun_light_hit_default_explosion_00",
    "medium-explosion": "animations_guns_gun_medium_hit_default_explosion_00",
    "impact-dust": "animations_guns_gun_light_hit_default_dust_00",
    "impact-smoke": "animations_guns_gun_medium_hit_default_smoke_00",
    "muzzle-smoke": "animations_guns_gun_auto_shot_smoke_00",
}


def percentile(values, q):
    return float(np.percentile(values, q)) if len(values) else 0.0


def frame_metrics(rgba: np.ndarray) -> dict:
    rgb = rgba[..., :3].astype(np.float32)
    alpha = rgba[..., 3].astype(np.float32)
    visible = alpha > 0
    solid = alpha >= 16
    ys, xs = np.nonzero(visible)
    if not len(xs):
        return {k: 0.0 for k in (
            "nonzero_px", "alpha_mass", "bbox_w", "bbox_h", "bbox_density",
            "centroid_x", "centroid_y", "soft_edge_ratio", "opaque_ratio",
            "component_count", "component_area_p50", "component_area_p90",
            "luma_mean", "luma_std", "saturation_mean", "perimeter_px",
            "compactness")}
    weights = alpha[visible] / 255.0
    mass = float(weights.sum())
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    bw, bh = int(x1 - x0 + 1), int(y1 - y0 + 1)
    labels, count = ndimage.label(solid, structure=np.ones((3, 3), dtype=np.uint8))
    component_areas = np.bincount(labels.ravel())[1:]
    component_areas = component_areas[component_areas > 0]
    eroded = ndimage.binary_erosion(visible, structure=np.ones((3, 3)), border_value=0)
    perimeter = float((visible & ~eroded).sum())
    area = float(visible.sum())
    lum = rgb[..., 0] * .2126 + rgb[..., 1] * .7152 + rgb[..., 2] * .0722
    vmax, vmin = rgb.max(axis=2), rgb.min(axis=2)
    sat = np.divide(vmax - vmin, np.maximum(vmax, 1), out=np.zeros_like(vmax), where=vmax > 0)
    return {
        "nonzero_px": int(area), "alpha_mass": mass, "bbox_w": bw, "bbox_h": bh,
        "bbox_density": area / (bw * bh),
        "centroid_x": float((xs * weights).sum() / weights.sum()),
        "centroid_y": float((ys * weights).sum() / weights.sum()),
        "soft_edge_ratio": float(((alpha > 0) & (alpha < 128)).sum() / area),
        "opaque_ratio": float((alpha >= 240).sum() / area),
        "component_count": int(count),
        "component_area_p50": percentile(component_areas, 50),
        "component_area_p90": percentile(component_areas, 90),
        "luma_mean": float(np.average(lum[visible], weights=weights)),
        "luma_std": float(np.sqrt(np.average((lum[visible] - np.average(lum[visible], weights=weights)) ** 2, weights=weights))),
        "saturation_mean": float(np.average(sat[visible], weights=weights)),
        "perimeter_px": perimeter,
        "compactness": float(4 * math.pi * area / max(perimeter * perimeter, 1)),
    }


def read_slot(family: dict, slot: int) -> Image.Image:
    record = next(x for x in family["sourceFrames"] if x["slot"] == slot)
    return Image.open(CANONICAL / record["png"]).convert("RGBA")


def sheet_frame(family: dict, runtime_key: str, frame_index: int) -> Image.Image:
    rt = family[runtime_key]
    sheet = Image.open(OUT.parent / "inventory" / rt["sheet"]).convert("RGBA")
    col, row = frame_index % rt["columns"], frame_index // rt["columns"]
    box = (col * rt["frameWidth"], row * rt["frameHeight"],
           (col + 1) * rt["frameWidth"], (row + 1) * rt["frameHeight"])
    return sheet.crop(box)


def make_plate(family: dict, label: str, metrics: list[dict]) -> None:
    clip = family["clips"][0]
    count = clip["frameCount"]
    picks = sorted(set(round(i * (count - 1) / 11) for i in range(12)))
    frames = [sheet_frame(family, "runtime", clip["startFrame"] + i) for i in picks]
    cell_w = max(128, family["runtime"]["frameWidth"] + 28)
    cell_h = max(128, family["runtime"]["frameHeight"] + 42)
    plate = Image.new("RGBA", (cell_w * 4, cell_h * 3 + 58), (24, 29, 25, 255))
    draw = ImageDraw.Draw(plate)
    draw.text((12, 10), f"{label} | {family['id']} | {family['runtimeFps']} fps", fill=(235, 239, 232, 255))
    for n, (idx, frame) in enumerate(zip(picks, frames)):
        x, y = (n % 4) * cell_w, 48 + (n // 4) * cell_h
        # checkerboard
        for cy in range(y, y + cell_h, 12):
            for cx in range(x, x + cell_w, 12):
                c = (93, 101, 89, 255) if ((cx-x)//12 + (cy-y)//12) % 2 else (73, 81, 70, 255)
                draw.rectangle((cx, cy, min(cx+11, x+cell_w-1), min(cy+11, y+cell_h-1)), fill=c)
        px = x + (cell_w - frame.width)//2
        py = y + cell_h - frame.height - 20
        plate.alpha_composite(frame, (px, py))
        fm = metrics[clip["startFrame"] + idx]
        cx, cy = px + fm["centroid_x"], py + fm["centroid_y"]
        draw.line((cx-4, cy, cx+4, cy), fill=(255, 215, 80, 255), width=1)
        draw.line((cx, cy-4, cx, cy+4), fill=(255, 215, 80, 255), width=1)
        draw.text((x+5, y+4), f"{idx+1}/{count}  a={fm['alpha_mass']:.0f}  p={fm['component_count']}", fill=(245,245,238,255))
    plate.save(OUT / "plates" / f"{label}.png")


def make_trajectory(family: dict, label: str, rows: list[dict]) -> None:
    clip = family["clips"][0]
    seq = rows[clip["startFrame"]:clip["endFrame"]+1]
    w, h, margin = 760, 360, 48
    im = Image.new("RGBA", (w, h), (25, 29, 26, 255)); d = ImageDraw.Draw(im)
    d.text((14, 12), f"{label}: alpha mass / centroid drift / silhouette density", fill=(235,239,232,255))
    for gy in range(60, h-30, 60): d.line((margin,gy,w-12,gy),fill=(70,80,72,255))
    masses=np.array([x["alpha_mass"] for x in seq]); maxm=max(float(masses.max()),1)
    xscale=lambda i: margin+i*(w-margin-18)/max(len(seq)-1,1)
    mpts=[(xscale(i), h-40-r["alpha_mass"]/maxm*220) for i,r in enumerate(seq)]
    d.line(mpts,fill=(239,178,63,255),width=3)
    x0,y0=seq[0]["centroid_x"],seq[0]["centroid_y"]
    drift=[math.hypot(r["centroid_x"]-x0,r["centroid_y"]-y0) for r in seq]; maxd=max(max(drift),1)
    dpts=[(xscale(i), h-40-v/maxd*160) for i,v in enumerate(drift)]
    d.line(dpts,fill=(102,180,232,255),width=2)
    denpts=[(xscale(i), h-40-r["bbox_density"]*120) for i,r in enumerate(seq)]
    d.line(denpts,fill=(157,214,132,255),width=2)
    d.text((margin, h-25), "frame / normalized clip time", fill=(185,195,187,255))
    d.text((w-280, 40), "orange alpha mass  blue centroid drift  green density", fill=(220,224,218,255))
    im.save(OUT / "overlays" / f"{label}-temporal.png")


def summarize_family(family: dict, rows: list[dict]) -> dict:
    masses=np.array([r["alpha_mass"] for r in rows]); areas=np.array([r["nonzero_px"] for r in rows])
    valid=masses>0
    clip_peaks=[]; clip_dx=[]; clip_dy=[]
    for clip_index in sorted(set(r["clip"] for r in rows)):
        seq=[r for r in rows if r["clip"]==clip_index and r["alpha_mass"]>0]
        if not seq: continue
        peak=max(range(len(seq)),key=lambda i:seq[i]["alpha_mass"])
        clip_peaks.append(peak/max(len(seq)-1,1))
        clip_dx.append(seq[-1]["world_centroid_x"]-seq[0]["world_centroid_x"])
        clip_dy.append(seq[-1]["world_centroid_y"]-seq[0]["world_centroid_y"])
    return {
        "id":family["id"], "category":family["category"], "fps":family["runtimeFps"],
        "frames":len(rows), "clips":len(family["clips"]),
        "cell_w":family["runtime"]["frameWidth"], "cell_h":family["runtime"]["frameHeight"],
        "cell_hex_w":family["runtime"]["frameWidth"]/HEX_WIDTH,
        "peak_mass":float(masses.max()),
        "peak_time_norm":float(np.median(clip_peaks)),
        "peak_time_p10":percentile(clip_peaks,10), "peak_time_p90":percentile(clip_peaks,90),
        "visible_area_p50":percentile(areas[valid],50), "visible_area_p90":percentile(areas[valid],90),
        "density_p50":percentile([r["bbox_density"] for r in rows if r["nonzero_px"]],50),
        "soft_edge_p50":percentile([r["soft_edge_ratio"] for r in rows if r["nonzero_px"]],50),
        "components_p50":percentile([r["component_count"] for r in rows if r["nonzero_px"]],50),
        "components_p90":percentile([r["component_count"] for r in rows if r["nonzero_px"]],90),
        "component_area_p50":percentile([r["component_area_p50"] for r in rows if r["nonzero_px"]],50),
        "luma_p10":percentile([r["luma_mean"] for r in rows if r["nonzero_px"]],10),
        "luma_p90":percentile([r["luma_mean"] for r in rows if r["nonzero_px"]],90),
        "drift_x":float(np.median(clip_dx)), "drift_y":float(np.median(clip_dy)),
        "drift_x_p10":percentile(clip_dx,10), "drift_x_p90":percentile(clip_dx,90),
        "drift_y_p10":percentile(clip_dy,10), "drift_y_p90":percentile(clip_dy,90),
    }


def write_spec(families: list[dict], summaries: list[dict]) -> None:
    bycat=defaultdict(list)
    for s in summaries: bycat[s["category"]].append(s)
    lines=["# Panzer Strike canonical FX animation quality specification", "",
      "Generated by `python scripts/analyze_ps_fx_quality.py`. The CSV measurements are source observations; rules explicitly labelled **Inference** are derived acceptance criteria.", "",
      "## Provenance and scope", "",
      f"- Source: local Panzer Strike Demo SSC/SPL canonical extraction; {len(families)} smoke/fire/impact-related families measured.",
      "- Each canonical RGBA body frame is measured directly. Format-934 ground shadows remain a separate layer and are not counted as body mass.",
      "- Cadence uses catalog timing: `30 * 1000 / frames_per_tick`; the unit interpretation is inferred from 30 engine updates/second.",
      "- Native cell width is compared with a 54-world-unit flat-top hex (93.53 world units wide). This is a scale reference, not proof that every original effect rendered at scale 1.", "",
      "## Source-observed family envelope", "",
      "| Category | Families | FPS | Cell width (px) | Peak time | Soft-edge median | Component count p90 |", "|---|---:|---|---:|---:|---:|---:|"]
    for cat, vals in sorted(bycat.items()):
        fps=sorted(set(v["fps"] for v in vals)); widths=[v["cell_w"] for v in vals]
        lines.append(f"| {cat} | {len(vals)} | {','.join(f'{x:g}' for x in fps)} | {min(widths)} to {max(widths)} | {np.median([v['peak_time_norm'] for v in vals]):.2f} median | {np.median([v['soft_edge_p50'] for v in vals]):.2f} | {np.median([v['components_p90'] for v in vals]):.0f} |")
    lines += ["", "## Canonical temporal grammar (source observations)", "",
      "- `fire_cell_00`: 133 frames at 30fps (4.43s), 89x175 cell (0.95 hex width), alpha-mass peak near 0.51 normalized time. The weighted centroid rises roughly 48-55px with small lateral sway before sparse breakup.",
      "- `fire_cell_01`: 135 frames at 30fps (4.50s), 91x188 (0.97 hex), later peak near 0.74 and roughly 69px buoyant rise. Both fire clips move tiny hot flecks -> forked flame -> dark lobed soot -> detached low-alpha remnants.",
      "- Light/medium/heavy explosions: 82/88/117 body frames at 30fps; 0.83/1.48/1.88 hex-wide cells. Light peaks early (~0.32); medium/heavy peak around 0.5-0.56. Warm opaque cores transition to gray lobed clouds, then many low-alpha fragments.",
      "- Medium/heavy impact smoke: about 3.6/5.0s, 0.72/1.12 hex-wide cells, mass peak around 0.44-0.54; the centroid rises about 40-50px and remains laterally restrained while the silhouette breaks apart.",
      "- Heavy impact dust: about 2.47s and 2.50 hex wide, early peak (~0.24) with many components (often tens to 100+); it spreads broadly and falls rather than forming a vertical smoke column.",
      "- Muzzle smoke is a bank of independent clips, not one long animation: auto clips are usually ~16f/0.53s with an early ~0.20 peak; light/medium clips are ~30-32f/1.0s with peaks around 0.35-0.37. Tiny helper clips are retained but excluded from effect-envelope medians.",
      "- Transparent source pixels have RGB=0. Body and format-934 shadow remain separate. Config composition places dust/ground on the lay layer, explosion on unit-to-smoke layers, heavier smoke with a small upward sort shift, and armor smoke/sparks on turret layers.", "",
      "## Reusable timing/easing patterns (inference from observations)", "",
      "- Fire: asymmetric slow growth, mid/late mass peak, buoyant centroid rise, then a long dissolving tail; horizontal sway is secondary to upward motion.",
      "- Explosion: fast energy release, slower volumetric expansion, still slower translucent breakup. Palette/value change is phase-locked, not a global tint.",
      "- Dust: early impulse and broad ballistic spread; component count grows as density falls.",
      "- Muzzle smoke: short attack/decay envelopes chosen from multiple directional clips; do not stretch one puff or concatenate the bank.", "",
      "## Reproducible acceptance rubric", "",
      "1. **Sequence/cadence:** preserve source clip order, gaps and family FPS. No duplicated-frame easing unless the source contains it.",
      "2. **Alpha:** transparent pixels must have zero RGB; compare alpha-mass curve after normalizing clip time. Peak timing must stay within +/-0.08 normalized time and no frame may create a discontinuity above 35% of peak mass unless source does.",
      "3. **Silhouette:** at gameplay scale, bbox density and compactness must remain inside the source category's 10th-90th percentile envelope. A continuous circular/columnar boundary is rejection evidence.",
      "4. **Particles:** connected components at alpha>=16 and their median/90th-percentile areas must remain within the source category envelope. Preserve sparse flecks during both growth and breakup.",
      "5. **Palette/value:** alpha-weighted luminance and saturation must follow the source phase change. Reject neutral-grey recolors that erase warm soot/fire or olive-brown dust bias.",
      "6. **Edges:** retain source-like mixed hard particulate cores and low-alpha antialiasing. Reject blur kernels that raise soft-edge ratio above the source category 90th percentile.",
      "7. **Motion:** compare alpha-weighted centroid trajectory, not only the final displacement. Direction changes and buoyant rise must survive; wind may add a low-amplitude world drift but cannot shear the source texture into a coherent plume.",
      "8. **Layering:** body, format-934 ground shadow, persistent decal and generated support particles are independently attributed and composited at one shared world scale/origin.",
      "9. **Gameplay footprint:** review at normal zoom at native scale and intended integration scale. The effect must remain legible without hiding units or aim lines; report footprint as fractions of 93.53 by 108 world-unit hex bounds.",
      "10. **A/B evidence:** candidate and original must use identical stage, scale, cadence and background; provide contact sheet, alpha-mass/centroid overlay and halo check.", "",
      "## What may and may not be synthesized", "",
      "- **Must remain original-derived:** micro-particle texture, irregular silhouette breakup, alpha topology, soot/dust palette variation, and phase-to-phase particle continuity. These are the qualities generic generated plumes consistently lose.",
      "- **May be procedural:** deterministic placement at muzzle/impact origin, low-amplitude wind translation, clip selection, timing control, depth ordering, scale, and sparse secondary flecks sampled from an original-derived atlas.",
      "- **May use image generation only as support:** isolated particulate clusters or palette-preserving variations, followed by alpha cleanup and temporal curation. A monolithic generated smoke column is not acceptable.", "",
      "## Recommended first build", "",
      "Build **small tactical fire** against both `fire_cell_00` and `fire_cell_01`. It is the hardest case: the candidate must sustain layered emissive flame and granular soot while following a 4s-class growth/rise/breakup arc. Keep it review-gated until it passes the rubric.", "",
      "## Evidence files", "",
      "- `metrics/frame_metrics.csv`: per-frame alpha, geometry, centroid, particles, palette and edge metrics.",
      "- `metrics/family_summary.csv`: per-family envelopes and normalized timing.",
      "- `plates/*.png`: 12-sample contact sheets with centroid crosses.",
      "- `overlays/*-temporal.png`: alpha mass, centroid drift and density curves.",
      "- `provenance.json`: inputs, category scope and measurement definitions."]
    (OUT / "PS_ANIMATION_QUALITY_SPEC.md").write_text("\n".join(lines)+"\n", encoding="utf-8")


def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--limit",type=int,default=0); args=ap.parse_args()
    OUT.mkdir(parents=True,exist_ok=True); (OUT/"metrics").mkdir(exist_ok=True); (OUT/"plates").mkdir(exist_ok=True); (OUT/"overlays").mkdir(exist_ok=True)
    catalog=json.loads(CATALOG.read_text(encoding="utf-8"))
    families=[f for f in catalog["families"] if f["category"] in CATEGORIES]
    if args.limit: families=families[:args.limit]
    all_rows=[]; summaries=[]; rep_rows={}
    for n,f in enumerate(families,1):
        slot_map={x["slot"]:x for x in f["sourceFrames"] if x["layer"]=="body"}
        rows=[]; runtime_index=0
        for clip_index,clip in enumerate(f["clips"]):
            for clip_frame,slot in enumerate(clip["slots"]):
                rec=slot_map[slot]; img=Image.open(CANONICAL/rec["png"]).convert("RGBA")
                m=frame_metrics(np.asarray(img)); m.update({"family":f["id"],"category":f["category"],"clip":clip_index,"clip_frame":clip_frame,"runtime_frame":runtime_index,"source_slot":slot,"width":img.width,"height":img.height,"origin_x":rec["originX"],"origin_y":rec["originY"],"world_centroid_x":rec["originX"]+m["centroid_x"],"world_centroid_y":rec["originY"]+m["centroid_y"],"time_s":clip_frame/f["runtimeFps"]})
                rows.append(m); all_rows.append(m); runtime_index+=1
        summaries.append(summarize_family(f,rows)); rep_rows[f["id"]]=rows
        print(f"[{n}/{len(families)}] {f['id']} {len(rows)} frames",flush=True)
    fields=list(all_rows[0].keys())
    with (OUT/"metrics/frame_metrics.csv").open("w",newline="",encoding="utf-8") as fp:
        w=csv.DictWriter(fp,fieldnames=fields);w.writeheader();w.writerows(all_rows)
    with (OUT/"metrics/family_summary.csv").open("w",newline="",encoding="utf-8") as fp:
        w=csv.DictWriter(fp,fieldnames=list(summaries[0].keys()));w.writeheader();w.writerows(summaries)
    byid={f["id"]:f for f in families}
    for label,fid in REPRESENTATIVES.items():
        if fid in byid: make_plate(byid[fid],label,rep_rows[fid]); make_trajectory(byid[fid],label,rep_rows[fid])
    write_spec(families,summaries)
    provenance={"schema":"ps-fx-quality-study/v1","sourceProduct":catalog["sourceProduct"],"canonicalManifest":"scratch/ps_sprites_canonical_v1/canonical_manifest.json","catalog":"asset/ps_fx/inventory/catalog.json","familiesMeasured":len(families),"framesMeasured":len(all_rows),"categories":sorted(CATEGORIES),"alphaComponentThreshold":16,"hexSize":HEX_SIZE,"hexWidth":HEX_WIDTH,"observations":["frame metrics","contact sheets","temporal overlays"],"inferences":["runtime cadence interpretation","gameplay scale comparison","acceptance thresholds"]}
    (OUT/"provenance.json").write_text(json.dumps(provenance,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"families":len(families),"frames":len(all_rows),"out":str(OUT)}),flush=True)

if __name__=="__main__": main()

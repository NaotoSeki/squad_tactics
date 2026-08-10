#!/usr/bin/env python3
"""Generate a deterministic, project-owned multi-pass dirt-impact blockout.

No reference images, learned weights, circles, ellipses, rectangles or regular
polygon sprites are used. Organic opacity comes from continuous noise fields;
solid clods use noise-perturbed height fields with directional lighting.
"""
from __future__ import annotations
import argparse, hashlib, json, math
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy.ndimage import gaussian_filter
from scipy.ndimage import label

ROOT = Path(__file__).resolve().parents[2]
SIZE=(160,128); ANCHOR=(80,100); FRAMES=48; FPS=30; PASSES=("opaque_clods","fine_dust","broken_grass","contact_shadow")

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def rgba(array):
    q=np.clip(array,0,255).astype(np.uint8); q[q[...,3]==0,:3]=0
    return Image.fromarray(q,"RGBA")
def zero_transparent_rgb(a): a[a[...,3]==0,:3]=0; return a

def field_texture(seed, radius):
    rng=np.random.default_rng(seed); n=rng.normal(size=(radius*2+9,radius*2+9))
    coarse=gaussian_filter(n,2.2); fine=gaussian_filter(rng.normal(size=n.shape),0.7)
    y,x=np.mgrid[:n.shape[0],:n.shape[1]]; cx=(n.shape[1]-1)/2; cy=(n.shape[0]-1)/2
    angle=np.arctan2(y-cy,x-cx); radial=np.hypot((x-cx)*.9,(y-cy)*1.08)
    boundary=radius*(.76+.13*np.sin(angle*3+seed)+.09*np.sin(angle*7+seed*.31))
    height=np.clip((boundary-radial)/3.2 + coarse*.72 + fine*.18,0,1)
    return height

def composite_over(dst, src):
    a=src[...,3:4]/255.; dst[...,:3]=src[...,:3]*a+dst[...,:3]*(1-a); dst[...,3:4]=(a+dst[...,3:4]/255.*(1-a))*255

def measure(a):
    q=np.clip(a,0,255).astype(np.uint8); alpha=q[...,3]; visible=alpha>0; solid=alpha>=16
    ys,xs=np.nonzero(visible); mass=float(alpha.sum()/255)
    if not len(xs): return {"alphaMass":0,"coverage":0,"centroid":[0,0],"bbox":[0,0,0,0],"components":0,"clipped":False}
    weights=alpha[ys,xs].astype(float); bbox=[int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)]
    return {"alphaMass":round(mass,3),"coverage":round(float(visible.mean()),6),
        "centroid":[round(float((xs*weights).sum()/weights.sum()),3),round(float((ys*weights).sum()/weights.sum()),3)],
        "bbox":bbox,"components":int(label(solid,np.ones((3,3),dtype=np.uint8))[1]),
        "clipped":bool(bbox[0]==0 or bbox[1]==0 or bbox[2]==SIZE[0] or bbox[3]==SIZE[1])}

def render(seed, out):
    rng=np.random.default_rng(seed); out.mkdir(parents=True,exist_ok=True)
    dirs={p:out/p for p in PASSES}; [d.mkdir(exist_ok=True) for d in dirs.values()]
    clods=[]
    for i in range(13):
        ang=rng.uniform(math.radians(205),math.radians(335)); speed=rng.uniform(28,92)
        clods.append((rng.uniform(-3,3),ang,speed,rng.integers(3,8),field_texture(seed+i*71,int(rng.integers(3,8))),rng.integers(0,4)))
    dust_base=gaussian_filter(rng.random((SIZE[1],SIZE[0])),3.2)
    dust_detail=gaussian_filter(rng.random((SIZE[1],SIZE[0])),1.0)
    grass=[]
    for i in range(7): grass.append((rng.uniform(-18,18),rng.uniform(-58,58),rng.uniform(18,42),rng.uniform(0.25,0.7),rng.uniform(-1,1)))
    composite_dir=out/"composite"; composite_dir.mkdir(exist_ok=True)
    metrics=[]
    for fi in range(FRAMES):
        t=fi/FPS; tn=fi/(FRAMES-1); layers={p:np.zeros((SIZE[1],SIZE[0],4),dtype=float) for p in PASSES}
        # Opaque soil clods: noise-height sprites with normal-like lighting.
        for lateral,ang,speed,r,h,delay in clods:
            if fi<delay: continue
            tt=(fi-delay)/FPS; x=ANCHOR[0]+lateral+math.cos(ang)*speed*tt; y=ANCHOR[1]+math.sin(ang)*speed*tt+55*tt*tt
            if not (-12<x<SIZE[0]+12 and -12<y<SIZE[1]+12): continue
            hh,ww=h.shape; x0=int(x-ww/2); y0=int(y-hh/2); yy0=max(0,y0); xx0=max(0,x0); yy1=min(SIZE[1],y0+hh); xx1=min(SIZE[0],x0+ww)
            if yy1<=yy0 or xx1<=xx0: continue
            sy=slice(yy0-y0,yy1-y0); sx=slice(xx0-x0,xx1-x0); q=h[sy,sx]
            if min(q.shape) < 2: continue
            gy,gx=np.gradient(q); light=np.clip(.58-gx*.55-gy*.75+q*.35,.2,1)
            base=np.array([[54,42,28],[83,64,39],[116,88,52],[145,116,73]])[(fi+delay)%4]
            patch=layers["opaque_clods"][yy0:yy1,xx0:xx1]; mask=np.clip((q-.14)*340,0,255)
            patch[...,:3]=base*light[...,None]; patch[...,3]=np.maximum(patch[...,3],mask)
        # Fine dust: advected multi-scale density, clipped to a low ground fan.
        shift=int(tn*34); density=np.roll(dust_base,shift,axis=1)*.72+np.roll(dust_detail,-shift//2,axis=0)*.28
        y,x=np.mgrid[:SIZE[1],:SIZE[0]]; fan=np.exp(-(((x-ANCHOR[0]-tn*8)/(18+tn*54))**2+((y-(ANCHOR[1]-tn*16))/(7+tn*20))**2))
        envelope=(math.sin(min(1,tn/.16)*math.pi/2)*(1-tn)**1.25); alpha=np.clip((density-.38)*720*fan*envelope,0,118)
        dust=layers["fine_dust"]; dust[...,:3]=np.array([105,88,62]); dust[...,3]=alpha
        # Broken grass: tapered, curved blades with a dark spine and dry edge.
        gim=rgba(layers["broken_grass"]); gd=ImageDraw.Draw(gim)
        for j,(ox,vx,vy,bend,spin) in enumerate(grass):
            tt=max(0,t-j*.012); px=ANCHOR[0]+ox+vx*tt; py=ANCHOR[1]-4-vy*tt+48*tt*tt
            length=8+j%4*2; a=-1.3+spin*tt*3; ex=px+math.cos(a)*length; ey=py+math.sin(a)*length; mx=(px+ex)/2+bend*5; my=(py+ey)/2-3
            pts=[(px,py),(mx,my),(ex,ey)]; gd.line(pts,fill=(35,43,19,max(0,int(220*(1-tn)))),width=2); gd.line(pts,fill=(112,112,52,max(0,int(150*(1-tn)))),width=1)
        layers["broken_grass"]=np.asarray(gim).copy()
        # Contact shadow derives only from owned generated body alpha.
        body=np.maximum(layers["opaque_clods"][...,3],layers["broken_grass"][...,3]); sim=Image.fromarray(body.astype(np.uint8)).resize((SIZE[0],32),Image.Resampling.BILINEAR).filter(ImageFilter.GaussianBlur(3.2)).resize(SIZE,Image.Resampling.BILINEAR)
        sa=np.asarray(sim).astype(float)*.24*(1-tn); layers["contact_shadow"][...,3]=sa
        comp=np.zeros_like(next(iter(layers.values())))
        for name in ("contact_shadow","fine_dust","broken_grass","opaque_clods"): composite_over(comp,layers[name])
        pass_metrics={}
        for name,a in layers.items():
            rgba(a).save(dirs[name]/f"frame_{fi:04d}.png"); pass_metrics[name]=measure(a)
        comp=zero_transparent_rgb(comp); rgba(comp).save(composite_dir/f"frame_{fi:04d}.png")
        body=np.zeros_like(comp)
        for name in ("fine_dust","broken_grass","opaque_clods"): composite_over(body,layers[name])
        metrics.append({"frame":fi,"timeSeconds":round(fi/FPS,4),"anchorPx":list(ANCHOR),"body":measure(body),"composite":measure(comp),"passes":pass_metrics})
    cols=8; rows=math.ceil(FRAMES/cols); atlas=Image.new("RGBA",(SIZE[0]*cols,SIZE[1]*rows))
    for i,p in enumerate(sorted(composite_dir.glob("*.png"))): atlas.alpha_composite(Image.open(p),(i%cols*SIZE[0],i//cols*SIZE[1]))
    atlas.save(out/"atlas.png")
    pass_atlases={}
    for name in PASSES:
        pa=Image.new("RGBA",atlas.size)
        for i,p in enumerate(sorted(dirs[name].glob("*.png"))): pa.alpha_composite(Image.open(p),(i%cols*SIZE[0],i//cols*SIZE[1]))
        filename=f"atlas_{name}.png"; pa.save(out/filename); pass_atlases[name]=filename
    manifest={"schema":"squad-tactics-splatter-atlas/v1","assetId":"original.dirt.blockout.v1","status":"critic-candidate","promotionAllowed":False,"frameSize":list(SIZE),"frameCount":FRAMES,"fps":FPS,"anchorPx":list(ANCHOR),"anchor":{"x":ANCHOR[0]/SIZE[0],"y":ANCHOR[1]/SIZE[1]},"passes":list(PASSES),"compositeOrder":["contact_shadow","fine_dust","broken_grass","opaque_clods"],"atlas":{"file":"atlas.png","columns":cols,"rows":rows},"passAtlases":pass_atlases,"profile":"asset/fx/splatter_pipeline/profiles.json","qualitySpec":"asset/fx/splatter_pipeline/quality_spec.json","humanAB":{"status":"pending","reviewers":[]}}
    (out/"manifest.json").write_text(json.dumps(manifest,indent=2)+"\n",encoding="utf-8")
    body_mass=[m["body"]["alphaMass"] for m in metrics]; peak=max(range(FRAMES),key=lambda i:body_mass[i])
    summary={"peakFrame":peak,"peakTimeNorm":round(peak/(FRAMES-1),4),"clippedFrames":[m["frame"] for m in metrics if m["body"]["clipped"]],"bodyExcludesContactShadow":True}
    (out/"metrics.json").write_text(json.dumps({"summary":summary,"frames":metrics},indent=2)+"\n",encoding="utf-8")
    evidence=out/"evidence"; evidence.mkdir(exist_ok=True)
    picks=[0,4,8,12,18,22,30,40,47]; sheet=Image.new("RGBA",(SIZE[0]*3,SIZE[1]*3),(36,39,34,255))
    sd=ImageDraw.Draw(sheet)
    for n,i in enumerate(picks):
        x=(n%3)*SIZE[0]; y=(n//3)*SIZE[1]
        for cy in range(y,y+SIZE[1],16):
            for cx in range(x,x+SIZE[0],16): sd.rectangle((cx,cy,cx+15,cy+15),fill=(72,76,68,255) if ((cx-x)//16+(cy-y)//16)%2 else (52,56,50,255))
        sheet.alpha_composite(Image.open(composite_dir/f"frame_{i:04d}.png"),(x,y)); sd.text((x+4,y+4),f"f{i:02d}",fill=(255,216,128,255))
    sheet.save(evidence/"slowed_contact_sheet.png")
    graph=Image.new("RGBA",(720,300),(28,31,28,255)); gd=ImageDraw.Draw(graph); maxmass=max(body_mass) or 1
    pts=[(30+i*(660/(FRAMES-1)),260-body_mass[i]/maxmass*210) for i in range(FRAMES)]; gd.line(pts,fill=(226,165,68,255),width=3)
    gd.line((30,260,690,260),fill=(120,130,120,255)); gd.text((32,18),f"body alpha mass / peak f{peak} t={summary['peakTimeNorm']}",fill=(235,238,230,255)); graph.save(evidence/"alpha_mass_centroid_overlay.png")
    peakim=Image.open(composite_dir/f"frame_{peak:04d}.png"); halo=Image.new("RGBA",(SIZE[0]*3,SIZE[1]),(0,0,0,255))
    for n,bg in enumerate(((0,0,0,255),(255,0,255,255),(238,238,238,255))): panel=Image.new("RGBA",SIZE,bg); panel.alpha_composite(peakim); halo.alpha_composite(panel,(n*SIZE[0],0))
    halo.save(evidence/"halo_check.png")
    prov={"assetId":manifest["assetId"],"license":"project-owned","generator":"scripts/splatter_pipeline/generate_dirt_blockout.py","generatorVersion":"1","seed":seed,"referencePixelsUsed":False,"trainingOrConditioningUsed":False,"releaseStatus":"critic-candidate","outputs":{}}
    for p in [out/"atlas.png",out/"manifest.json",out/"metrics.json",*[out/f for f in pass_atlases.values()],evidence/"slowed_contact_sheet.png",evidence/"alpha_mass_centroid_overlay.png",evidence/"halo_check.png"]: prov["outputs"][str(p.relative_to(out)).replace('\\','/')]=sha(p)
    (out/"provenance.json").write_text(json.dumps(prov,indent=2)+"\n",encoding="utf-8")

if __name__=="__main__":
    ap=argparse.ArgumentParser(); ap.add_argument("--seed",type=int,default=41027); ap.add_argument("--out",type=Path,default=ROOT/"asset/generated/splatter/dirt_blockout_v1"); a=ap.parse_args(); render(a.seed,a.out); print(a.out)

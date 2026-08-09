#!/usr/bin/env python3
"""Import user-provided grenade/M2 WAVs without modifying their originals."""
from __future__ import annotations
import argparse, hashlib, json, math, wave
from pathlib import Path
import numpy as np
from scipy.signal import resample_poly

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'asset/audio/sfx'

def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for chunk in iter(lambda:f.read(1<<20),b''):h.update(chunk)
    return h.hexdigest()

def decode(raw,width):
    if width==2:return np.frombuffer(raw,'<i2').astype(np.float64)/32768
    if width==3:
        b=np.frombuffer(raw,np.uint8).reshape(-1,3);v=b[:,0].astype(np.int32)|(b[:,1].astype(np.int32)<<8)|(b[:,2].astype(np.int32)<<16)
        v=np.where(v&0x800000,v|~0xffffff,v);return v.astype(np.float64)/8388608
    if width==4:return np.frombuffer(raw,'<i4').astype(np.float64)/2147483648
    raise ValueError(f'unsupported PCM width {width}')

def convert(src,dst,role,target_peak_db):
    with wave.open(str(src),'rb') as w:
        if w.getcomptype()!='NONE':raise ValueError('compressed WAV is not supported')
        ch,rate,width,n=w.getnchannels(),w.getframerate(),w.getsampwidth(),w.getnframes();raw=w.readframes(n)
    samples=decode(raw,width).reshape(-1,ch)
    if rate!=48000:samples=resample_poly(samples,48000,rate,axis=0)
    peak=float(np.max(np.abs(samples))) or 1
    gain=(10**(target_peak_db/20))/peak;samples=np.clip(samples*gain,-1,1)
    pcm=np.round(samples*32767).astype('<i2')
    with wave.open(str(dst),'wb') as w:w.setnchannels(ch);w.setsampwidth(2);w.setframerate(48000);w.writeframes(pcm.tobytes())
    return {'role':role,'sourcePath':str(src.resolve()),'sourceSha256':sha(src),'sourceBytes':src.stat().st_size,'sourceFormat':{'codec':f'PCM {width*8}-bit','channels':ch,'sampleRate':rate,'frames':n,'durationSeconds':n/rate},'outputPath':str(dst.relative_to(ROOT)).replace('\\','/'),'outputSha256':sha(dst),'outputFormat':{'codec':'PCM 16-bit','channels':ch,'sampleRate':48000,'frames':len(samples),'durationSeconds':len(samples)/48000,'peakDbFS':target_peak_db},'gainDb':20*math.log10(gain)}

def main():
    p=argparse.ArgumentParser();p.add_argument('--grenade',required=True,type=Path);p.add_argument('--mortar',required=True,type=Path);a=p.parse_args();OUT.mkdir(parents=True,exist_ok=True)
    entries=[convert(a.grenade,OUT/'grenade_explosion_ps.wav','grenade explosion at BLAST/detonation',-4),convert(a.mortar,OUT/'m2_mortar_fire_ps.wav','M2 mortar launch/fire at SHOT',-7)]
    manifest={'schema':'squad-tactics-user-audio-import/v1','sourceScope':'user-provided local assets; originals preserved read-only','entries':entries}
    (OUT/'grenade_mortar_provenance.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    print(json.dumps(manifest,indent=2,ensure_ascii=True))
if __name__=='__main__':main()

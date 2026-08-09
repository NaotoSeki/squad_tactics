#!/usr/bin/env node
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'..');
const ctx={globalThis:{location:{hostname:'release.invalid',search:''}}};ctx.globalThis.globalThis=ctx.globalThis;
vm.runInNewContext(fs.readFileSync(path.join(root,'fx_pack_registry.js'),'utf8'),ctx);
const pack=process.env.SQUAD_FX_PACK||'original';ctx.globalThis.FxPacks.activeId=pack;
let files=[];const manifest=process.argv[2];
if(manifest)files=JSON.parse(fs.readFileSync(path.resolve(manifest),'utf8')).files||[];
try{ctx.globalThis.FxPacks.assertReleaseSafe(files);console.log('release FX guard: OK (original pack)')}
catch(e){console.error('release FX guard: BLOCKED - '+e.message);process.exit(1)}

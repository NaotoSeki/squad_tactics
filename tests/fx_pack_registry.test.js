const fs=require('fs'),path=require('path'),vm=require('vm');
const src=fs.readFileSync(path.resolve(__dirname,'../fx_pack_registry.js'),'utf8');
function load(host,search){const g={location:{hostname:host,search}};const c={globalThis:g,URLSearchParams};g.globalThis=g;vm.runInNewContext(src,c);return g.FxPacks}
function ok(v,m){if(!v)throw new Error(m)}
function throws(fn,re,m){let hit=false;try{fn()}catch(e){hit=re.test(String(e))}ok(hit,m)}
const release=load('game.example.com','?fxpack=panzer_reference');ok(release.activeId==='original','remote/release must default original');ok(release.assertReleaseSafe(['asset/explosion_khaos_t2_grenade_384.png']),'owned bundle should pass');
throws(()=>release.assertReleaseSafe(['asset/generated/original_artillery_mantaflow_v6/package/atlas.png']),/Research-only FX/,'unapproved generated candidate must not enter release bundle');
throws(()=>release.assertReleaseSafe(['asset/generated/original_artillery_imagegen_v1/package/atlas.png']),/Research-only FX/,'unapproved imagegen candidate must not enter release bundle');
const dev=load('localhost','?fxpack=panzer_reference');ok(dev.activeId==='panzer_reference','localhost may explicitly select reference pack');ok(dev.logicalKeys.every(k=>Object.prototype.hasOwnProperty.call(dev.packs.original.effects,k)&&Object.prototype.hasOwnProperty.call(dev.packs.panzer_reference.effects,k)),'packs must share contract');
let blocked=false;try{release.assertReleaseSafe(['asset/ps_fx/ps_fire_cell_00.png'])}catch(e){blocked=true}ok(blocked,'release guard must reject PS paths');
blocked=false;try{dev.assertReleaseSafe([])}catch(e){blocked=true}ok(blocked,'release guard must reject reference pack');
console.log('fx_pack_registry.test.js: OK');

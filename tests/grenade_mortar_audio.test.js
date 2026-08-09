const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'..');
const sound=fs.readFileSync(path.join(root,'phaser_sound.js'),'utf8');
const rtwp=fs.readFileSync(path.join(root,'logic_battle_rtwp.js'),'utf8');
const legacy=fs.readFileSync(path.join(root,'logic_game.js'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'asset/audio/sfx/grenade_mortar_provenance.json'),'utf8'));
function ok(v,m){if(!v)throw new Error(m)}
function wav(p){const b=fs.readFileSync(p);ok(b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WAVE','invalid WAV');return {channels:b.readUInt16LE(22),rate:b.readUInt32LE(24),bits:b.readUInt16LE(34),bytes:b.length}}
function sha(p){return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}
const g=path.join(root,'asset/audio/sfx/grenade_explosion_ps.wav');
const m=path.join(root,'asset/audio/sfx/m2_mortar_fire_ps.wav');
ok(JSON.stringify(wav(g))===JSON.stringify({channels:2,rate:48000,bits:16,bytes:301868}),'grenade conversion drift');
ok(JSON.stringify(wav(m))===JSON.stringify({channels:2,rate:48000,bits:16,bytes:68652}),'mortar conversion drift');
for(const e of manifest.entries){const p=path.join(root,e.outputPath);ok(sha(p)===e.outputSha256,`hash mismatch ${e.outputPath}`)}
ok(sound.includes("'grenade_explosion_ps': 'asset/audio/sfx/grenade_explosion_ps.wav'"),'grenade preload missing');
ok(sound.includes("'m2_mortar_fire_ps': 'asset/audio/sfx/m2_mortar_fire_ps.wav'"),'mortar preload missing');
ok(sound.includes("'grenade_explosion_ps': 280")&&sound.includes("'m2_mortar_fire_ps': 450"),'duplicate-play throttles missing');
ok(sound.includes('this.assetVolumes[id]')&&sound.includes('const cached ='),'volume/cache fallback guard missing');
const grenadeBlock=rtwp.slice(rtwp.indexOf("case 'GRENADE':"),rtwp.indexOf("case 'BLAST':"));
const blastBlock=rtwp.slice(rtwp.indexOf("case 'BLAST':"),rtwp.indexOf("case 'MELEE_START':"));
ok(!grenadeBlock.includes('grenade_explosion_ps'),'grenade explosion must not play at throw');
ok(blastBlock.includes("play('grenade_explosion_ps', 'boom')"),'grenade sound must play at BLAST with fallback');
const shotBlock=rtwp.slice(rtwp.indexOf("case 'SHOT':"),rtwp.indexOf("case 'GRENADE':"));
ok(shotBlock.includes("play('m2_mortar_fire_ps', 'cannon')"),'RTWP M2 sound must play at SHOT');
const legacyLaunch=legacy.indexOf("Sfx.play('m2_mortar_fire_ps', 'cannon', audioEpoch)");
ok(legacyLaunch>0&&legacyLaunch<legacy.indexOf('setTimeout(() => {',legacyLaunch),'legacy M2 sound must precede flight timer');
console.log('grenade_mortar_audio.test.js: OK');

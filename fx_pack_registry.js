/** Logical VFX pack contract. Gameplay requests roles; packs choose assets. */
(function (root) {
  'use strict';
  const LOGICAL_KEYS = Object.freeze([
    'persistent_fire','muzzle_smoke','grenade_blast','grenade_smoke',
    'mortar_impact','mortar_smoke','impact_dust','bullet_impact','impact_splatter'
  ]);
  const packs = Object.freeze({
    original: Object.freeze({
      id:'original', releaseSafe:true, provenance:'project-owned KHAOS and original runtime work',
      effects:Object.freeze({
        persistent_fire:null, muzzle_smoke:null,
        grenade_blast:{kind:'khaos',tier:'t2_grenade'}, grenade_smoke:{kind:'procedural',preset:'impact-smoke'},
        mortar_impact:{kind:'khaos',tier:'t2_grenade'}, mortar_smoke:{kind:'procedural',preset:'mortar-smoke'},
        impact_dust:{kind:'procedural',preset:'impact-dust'}, bullet_impact:{kind:'khaos',tier:'t1_12mm'},
        impact_splatter:{kind:'procedural',profile:'dirt'}
      })
    }),
    panzer_reference: Object.freeze({
      id:'panzer_reference', releaseSafe:false, researchOnly:true,
      provenance:'private local Panzer Strike Demo canonical extraction; never package',
      effects:Object.freeze({
        persistent_fire:{kind:'ps_original',role:'fire'}, muzzle_smoke:{kind:'ps_original',role:'smoke'},
        grenade_blast:{kind:'khaos',tier:'t2_grenade'}, grenade_smoke:{kind:'ps_original',role:'smoke'},
        mortar_impact:{kind:'khaos',tier:'t2_grenade'}, mortar_smoke:{kind:'ps_original',role:'smoke'},
        impact_dust:{kind:'ps_original',role:'dust'}, bullet_impact:{kind:'khaos',tier:'t1_12mm'},
        impact_splatter:null
      })
    })
  });
  function isLocal(host){return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host||'')}
  function requested(){
    const p=typeof URLSearchParams!=='undefined'?new URLSearchParams(root.location&&root.location.search||''):null;
    const id=p&&p.get('fxpack');
    return id==='panzer_reference'&&isLocal(root.location&&root.location.hostname)?id:'original';
  }
  const api={
    logicalKeys:LOGICAL_KEYS,packs,activeId:requested(),
    active(){return packs[this.activeId]||packs.original},
    get(key,packId){if(!LOGICAL_KEYS.includes(key))throw new Error('Unknown FX logical key: '+key);return (packs[packId||this.activeId]||packs.original).effects[key]},
    selectForDevelopment(id){if(id==='panzer_reference'&&!isLocal(root.location&&root.location.hostname))throw new Error('panzer_reference is localhost-only');this.activeId=packs[id]?id:'original';return this.active()},
    assertReleaseSafe(bundlePaths){
      if(this.activeId!=='original'||!this.active().releaseSafe)throw new Error('Release requires original FX pack');
      const banned=/(^|[\\/])(ps_fx|ps_sprites|panzer_reference)([\\/]|$)|panzer.?strike/i;
      const hit=(bundlePaths||[]).find(p=>banned.test(String(p)));if(hit)throw new Error('Research-only FX in release bundle: '+hit);return true;
    }
  };
  root.FxPacks=api;
})(typeof window!=='undefined'?window:globalThis);

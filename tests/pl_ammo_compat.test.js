/**
 * Regression tests for Platoon Leader item-reference normalization.
 * Run with: node tests/pl_ammo_compat.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function loadRuntime() {
  const sandbox = {
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  function run(filename, tail) {
    const source = fs.readFileSync(path.join(ROOT, filename), 'utf8');
    vm.runInContext(source + (tail || ''), sandbox, { filename });
  }

  run('data.js', '\n;this.WPNS = WPNS;');
  [
    'data/wpns_pl_master.js',
    'data/pl_ammo_data.js',
    'data/pl_cbe_mag_shape.js',
    'data/pl_cbe_item_categories.js',
    'data/pl_cbe_weapon_slots.js',
    'data/pl_cbe_weapon_ammo_canonical.js',
    'data/pl_cbe_mission_pool.js',
    'data/pl_composite_links.js',
    'data/pl_cbe_equip_columns.js',
    'data/pl_cbe_pool_map.js',
    'data/pl_cbe_aux_compat.js',
    'data/pl_ammo_compat_overrides.js',
    // This is deliberately last among the data tables: it is the exact,
    // normalized legacy authority and replaces the older heuristic tables.
    'data/pl_weapon_ammo_legacy_truth.js',
    'data/pl_ammo_resolve.js',
    'data/pl_mg_tripod.js',
  ].forEach((filename) => run(filename));
  run('logic_game.js');
  return sandbox;
}

const runtime = loadRuntime();
const { WPNS } = runtime;

// CBE +0x26 is a base malfunction rate on weapons and an additive modifier
// on category-18 magazines/belts.  M1928A1 (2) + 50-round drum (2) = 4.
const thompsonBox = runtime.buildSpareAmmoItem(WPNS.pl_15, 235);
const thompsonDrum = runtime.buildSpareAmmoItem(WPNS.pl_15, 236);
assert.strictEqual(thompsonBox.malfMod, 0);
assert.strictEqual(thompsonBox.malfRate, 2);
assert.strictEqual(thompsonDrum.malfMod, 2);
assert.strictEqual(thompsonDrum.malfRate, 4);
const loadedThompson = { ...WPNS.pl_15, code: 'pl_15', current: 0 };
runtime.applySpareMagToPrimary(loadedThompson, loadedThompson, thompsonDrum);
assert.strictEqual(loadedThompson.loadedAmmoCbeNameIndex, 236);
assert.strictEqual(loadedThompson.loadedMalfMod, 2);
assert.strictEqual(loadedThompson.effectiveMalfRate, 4);
const battleLogic = Object.create(runtime.BattleLogic.prototype);
assert.strictEqual(battleLogic._getWeaponMalfunctionRate(WPNS.pl_15), 2);
assert.strictEqual(battleLogic._getWeaponMalfunctionRate(loadedThompson), 4);
vm.runInContext('Math.random = () => 0.039', runtime);
assert.strictEqual(battleLogic._rollWeaponMalfunction(WPNS.pl_15), false);
assert.strictEqual(battleLogic._rollWeaponMalfunction(loadedThompson), true);

// The decoded source must preserve the executable's one-based IDs while
// exposing only normalized zero-based indices to every downstream builder.
const decodedStats = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data/wpns_pl_stats_decoded.json'), 'utf8'),
);
assert.strictEqual(decodedStats.length, 455, 'decoded CBE row count');
for (const row of decodedStats) {
  assert.ok(Array.isArray(row.ammo_raw_item_ids), 'raw item IDs missing at ' + row.cbeNameIndex);
  assert.deepStrictEqual(
    row.ammo_indices,
    row.ammo_raw_item_ids.map((rawItemId) => rawItemId - 1),
    'one-based item normalization at ' + row.cbeNameIndex,
  );
  if (row.u26_raw_item_id != null) {
    assert.strictEqual(
      row.u26_index,
      row.u26_raw_item_id - 1,
      'one-based u26 normalization at ' + row.cbeNameIndex,
    );
  }
}

function ammo(code) {
  return Array.from(runtime.getWeaponAcceptsAmmoIndices(WPNS[code]));
}

function expectAmmo(code, expected) {
  assert.deepStrictEqual(ammo(code), expected, code + ' ammunition');
}

// Core Squad Tactics weapons.
expectAmmo('m1911', [225]);             // 45ACP-7
expectAmmo('m1', [231]);                // 3006-8 en-bloc
expectAmmo('k98_scope', [229]);         // M1903A4: 3006-5
expectAmmo('bar', [230]);               // 3006-20B
expectAmmo('thompson', [234, 235]);     // M1A1: 20/30-round Thompson boxes
expectAmmo('luger', [258]);             // P08: 9Pb-8L
expectAmmo('mg42', [293, 296, 295]);    // Gt34-50 + PatrK41 belts

// U.S. machine guns, boxes, and tripods.
expectAmmo('pl_20', [239, 240]);
expectAmmo('pl_22', [239, 240]);
expectAmmo('pl_23', [239, 240]);
expectAmmo('pl_24', [241]);
assert.strictEqual(runtime.getWeaponCompositeLoadout(WPNS.pl_20).ammoBoxCbe, 34);
assert.strictEqual(runtime.getWeaponCompositeLoadout(WPNS.pl_23).ammoBoxCbe, 34);
assert.strictEqual(runtime.getWeaponCompositeLoadout(WPNS.pl_24).ammoBoxCbe, 35);
assert.strictEqual(runtime.getTripodCbeForWeapon(WPNS.pl_20), 31);
assert.strictEqual(runtime.getTripodCbeForWeapon(WPNS.pl_22), 32);
assert.strictEqual(runtime.getTripodCbeForWeapon(WPNS.pl_23), 31);
assert.strictEqual(runtime.getTripodCbeForWeapon(WPNS.pl_24), 33);

// German and other belt-fed examples.
expectAmmo('pl_91', [293, 294, 296, 295]);
expectAmmo('pl_94', [293, 296, 295]);
expectAmmo('pl_95', [289, 288]);
expectAmmo('pl_179', [358]);
expectAmmo('pl_199', [374]);
expectAmmo('pl_200', [375]);
assert.strictEqual(runtime.getWeaponCompositeLoadout(WPNS.pl_91).ammoBoxCbe, 115);
assert.strictEqual(runtime.getWeaponCompositeLoadout(WPNS.pl_200).ammoBoxCbe, 202);
assert.strictEqual(runtime.getTripodCbeForWeapon(WPNS.pl_91), 112);
assert.strictEqual(runtime.getTripodCbeForWeapon(WPNS.pl_94), 113);

// Mounted weapons must use their own CBE records, not infantry feed aliases.
expectAmmo('pl_400', [293]);
expectAmmo('pl_401', [293]);
expectAmmo('pl_402', [293]);
expectAmmo('pl_403', [293]);
expectAmmo('pl_404', []);
expectAmmo('pl_406', []);
expectAmmo('pl_407', [342]);
expectAmmo('pl_408', [358]);
expectAmmo('pl_409', []);
assert.strictEqual(runtime.PL_LEGACY_ITEM_LINKS.weapons['407'].rawItemIds[0], 343);
assert.ok(!runtime.PL_LEGACY_ITEM_LINKS.weapons['409'].unresolved);
assert.ok(runtime.PL_LEGACY_ITEM_LINKS.weapons['409'].noInfantryItemFeed);

// Previously observed catastrophic false positives must remain rejected.
assert.ok(!ammo('luger').includes(259), 'P08 must not accept .32 ACP');
assert.ok(!ammo('pl_23').includes(242), 'M1919A4 must not accept M6A1 rocket');
assert.ok(!ammo('pl_200').includes(296), 'DShK must not accept German 7.92 mm belt');

// Exhaustive runtime check: every generated row must resolve exactly to the
// effective legacy list, including authoritative empty rows.
let checked = 0;
for (const [index, row] of Object.entries(runtime.PL_LEGACY_ITEM_LINKS.weapons)) {
  const weapon = WPNS['pl_' + index];
  if (!weapon) continue;
  assert.deepStrictEqual(
    Array.from(runtime.getWeaponAcceptsAmmoIndices(weapon)),
    Array.from(row.effectiveAmmo),
    'pl_' + index + ' must match normalized legacy truth',
  );
  for (const ammoIndex of row.effectiveAmmo) {
    const category = runtime.PL_CBE_ITEM_CATEGORIES[String(ammoIndex)];
    assert.ok(category && category.cat === 18, 'loadable item must be category 18: ' + ammoIndex);
  }
  const composite = runtime.getWeaponCompositeLoadout(weapon);
  assert.strictEqual(
    composite && composite.ammoBoxCbe != null ? Number(composite.ammoBoxCbe) : null,
    row.ammoBox == null ? null : Number(row.ammoBox),
    'pl_' + index + ' ammunition box',
  );
  assert.deepStrictEqual(
    composite ? Array.from(composite.boxInner) : [],
    Array.from(row.boxAmmo),
    'pl_' + index + ' ammunition-box contents',
  );
  assert.strictEqual(
    runtime.getTripodCbeForWeapon(weapon),
    row.tripod == null ? null : Number(row.tripod),
    'pl_' + index + ' tripod',
  );
  checked++;
}

assert.strictEqual(
  checked,
  Object.keys(runtime.PL_LEGACY_ITEM_LINKS.weapons).length,
  'every published truth row must have a runtime weapon',
);
console.log('PASS: PL ammunition compatibility (' + checked + ' runtime rows)');

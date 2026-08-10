const Review = require('../battle_review.js');
let passed = 0;
function check(ok, label) { if (!ok) throw new Error(label); passed++; }

const source = {
  map: [[{ cover: 10 }]], state: 'WIN', selectedUnit: null,
  units: [{ id: 'p1', name: 'Alpha', team: 'player', q: 0, r: 0,
    hp: 12, maxHp: 100, suppression: 88, simState: 'pinned',
    hands: [{ code: 'rifle', name: 'Rifle' }], bag: [{ code: 'mag', name: 'Magazine' }] }],
  actionAttack() { throw new Error('live attack dispatched'); },
  actionMove() { throw new Error('live move dispatched'); },
};
const snapshot = Review.capture(source, { winner: 'B', reason: 'incapacitated', tick: 41 }, { tick: 41 });
check(Review.isImmutable(snapshot), 'snapshot and nested normal-render state are frozen');
check(snapshot.renderer === 'normal-battle-scene', 'review declares the existing battle renderer');
source.units[0].hp = 100; source.map[0][0].cover = 99;
check(snapshot.units[0].hp === 12 && snapshot.map[0][0].cover === 10,
  'promotion/healing and map mutations cannot alter the final scene state');

const frozen = Review.createFrozenGame(snapshot, source);
check(Object.getPrototypeOf(frozen) === source && frozen.state === 'REVIEW',
  'review is a read-only facade over the normal BattleLogic path');
check(frozen.map[0][0].cover === 10 && frozen.units[0].hp === 12,
  'normal renderer receives final terrain and unit state');
check(frozen.actionAttack() === false && frozen.actionMove() === false && frozen.handleClick() === false,
  'attack, move and board command dispatch are disabled');
check(frozen.reloadWeapon() === false && frozen.toggleFireMode() === false
  && frozen.swapEquipment() === false && frozen.issueOrder() === false,
  'reload, fire mode, equipment and RTwP order mutations are disabled');
frozen.selectedUnit = frozen.units[0];
check(source.selectedUnit === null && source.units[0].hp === 100,
  'inspection selection remains isolated from persistent game state');

const sharedDef = { name: 'Rifleman', role: 'infantry', isTank: false };
const sharedSnapshot = Review.capture({ map: [], units: [
  { id: 'a', hp: 10, def: sharedDef }, { id: 'b', hp: 10, def: sharedDef }
] }, { winner: 'A', tick: 2 });
check(sharedSnapshot.units[0].def.name === 'Rifleman'
  && sharedSnapshot.units[1].def.name === 'Rifleman',
  'shared unit definitions remain available for every normal-render sprite');

console.log(`battle_review: ${passed} passed`);

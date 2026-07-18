/** Run with: node tests/reaction_rules.test.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// vm サンドボックス環境の準備
const sandbox = {
  console,
  window: {},
};
sandbox.window = sandbox;
vm.createContext(sandbox);

// logic_reaction.js をロード
const reactionSource = fs.readFileSync(path.join(ROOT, 'logic_reaction.js'), 'utf8');
vm.runInContext(reactionSource, sandbox, { filename: 'logic_reaction.js' });

const ReactionRules = sandbox.window.ReactionRules;
assert.ok(ReactionRules, 'ReactionRules should be defined');

// ===== shouldGoProne テスト =====
function testShouldGoProne() {
  // damage < 5 なら false
  assert.strictEqual(ReactionRules.shouldGoProne({ def: {} }, 4), false, 'damage 4 should not go prone');

  // damage >= 5 なら true
  assert.strictEqual(ReactionRules.shouldGoProne({ def: {} }, 5), true, 'damage 5 should go prone');
  assert.strictEqual(ReactionRules.shouldGoProne({ def: {} }, 10), true, 'damage 10 should go prone');

  // 戦車は常に false
  assert.strictEqual(ReactionRules.shouldGoProne({ def: { isTank: true } }, 100), false, 'tank should never go prone');

  // null/undefined unit は false
  assert.strictEqual(ReactionRules.shouldGoProne(null, 5), false, 'null unit should return false');
  assert.strictEqual(ReactionRules.shouldGoProne(undefined, 5), false, 'undefined unit should return false');
  assert.strictEqual(ReactionRules.shouldGoProne({}, 5), false, 'unit without def should return false');

  console.log('✓ testShouldGoProne passed');
}

// ===== pickCoverHex テスト =====
function testPickCoverHex() {
  // モック map: q=0,r=0 (cover 10), q=0,r=1 (cover 40), q=0,r=2 (cover 25), q=0,r=3 (cost 99 - 不可)
  const mockMap = [
    [
      { q: 0, r: 0, cover: 10, cost: 1, id: 1 },  // current
      { q: 0, r: 1, cover: 40, cost: 1, id: 1 },  // 候補1
      { q: 0, r: 2, cover: 25, cost: 1, id: 1 },  // 候補2
      { q: 0, r: 3, cover: 0, cost: 99, id: -1 }, // 不可
    ],
  ];

  // モック ctx
  const mockCtx = {
    map: mockMap,
    neighbors: (q, r) => {
      // (0,0) の隣接: (0,1), (0,2), (0,3) を返す（簡略化）
      if (q === 0 && r === 0) return [
        { q: 0, r: 1 },
        { q: 0, r: 2 },
        { q: 0, r: 3 },
      ];
      return [];
    },
    unitsInHex: (q, r) => [], // 全hex 空
    hexCap: 2,
    hexDist: (a, b) => Math.abs(a.q - b.q) + Math.abs(a.r - b.r),
  };

  // テスト1: 現hex cover < 30 のとき、cover 40 と 25 から 40 を選ぶ
  const unit = { q: 0, r: 0, def: {}, team: 'player' };
  const dest = ReactionRules.pickCoverHex(mockCtx, unit, null);
  assert.ok(dest, 'should find a destination hex');
  assert.strictEqual(dest.q, 0, 'destination q should be 0');
  assert.strictEqual(dest.r, 1, 'destination r should be 1 (highest cover)');

  // テスト2: 現hex cover >= 30 なら呼ばない（呼び側の判定）。ここではコンテキストテスト
  const safeMockCtx = {
    ...mockCtx,
    map: [[
      { q: 0, r: 0, cover: 35, cost: 1, id: 1 }, // current >= 30
      { q: 0, r: 1, cover: 40, cost: 1, id: 1 },
    ]],
  };
  const safeUnit = { q: 0, r: 0, def: {}, team: 'player' };
  // cover >= 30 の場合、pickCoverHex は依然として候補を探す。
  // ただし呼び側で「current cover < 30」をチェックすべき。
  // この関数テストではコンテキスト欠落や null への耐性を重視。

  // テスト3: cover+15 未満しか無い場合 → null
  const lowCoverCtx = {
    map: [[
      { q: 0, r: 0, cover: 10, cost: 1, id: 1 }, // current
      { q: 0, r: 1, cover: 20, cost: 1, id: 1 }, // 10 + 15 = 25 > 20 なので候補外
      { q: 0, r: 2, cover: 24, cost: 1, id: 1 }, // 10 + 15 = 25 > 24 なので候補外
    ]],
    neighbors: (q, r) => {
      if (q === 0 && r === 0) return [{ q: 0, r: 1 }, { q: 0, r: 2 }];
      return [];
    },
    unitsInHex: (q, r) => [],
    hexCap: 2,
    hexDist: (a, b) => Math.abs(a.q - b.q),
  };
  const lowUnit = { q: 0, r: 0, def: {}, team: 'player' };
  const noDestLow = ReactionRules.pickCoverHex(lowCoverCtx, lowUnit, null);
  assert.strictEqual(noDestLow, null, 'no destination when all neighbors have insufficient cover');

  // テスト4: 定員満杯の hex は候補外
  const fullHexCtx = {
    map: [[
      { q: 0, r: 0, cover: 10, cost: 1, id: 1 },
      { q: 0, r: 1, cover: 40, cost: 1, id: 1 },
    ]],
    neighbors: (q, r) => {
      if (q === 0 && r === 0) return [{ q: 0, r: 1 }];
      return [];
    },
    unitsInHex: (q, r) => {
      if (q === 0 && r === 1) {
        // 3ユニット（定員超過）
        return [
          { team: 'player', hp: 10 },
          { team: 'player', hp: 10 },
          { team: 'player', hp: 10 },
        ];
      }
      return [];
    },
    hexCap: 2,
    hexDist: (a, b) => 0,
  };
  const fullUnit = { q: 0, r: 0, def: {}, team: 'player' };
  const noDestFull = ReactionRules.pickCoverHex(fullHexCtx, fullUnit, null);
  assert.strictEqual(noDestFull, null, 'no destination when all neighbor hexes are full');

  // テスト5: cost 99 (不可) は候補外
  const blockedCtx = {
    map: [[
      { q: 0, r: 0, cover: 10, cost: 1, id: 1 },
      { q: 0, r: 1, cover: 40, cost: 99, id: -1 }, // cost 99 不可
    ]],
    neighbors: (q, r) => {
      if (q === 0 && r === 0) return [{ q: 0, r: 1 }];
      return [];
    },
    unitsInHex: (q, r) => [],
    hexCap: 2,
    hexDist: (a, b) => 0,
  };
  const blockedUnit = { q: 0, r: 0, def: {}, team: 'player' };
  const noDestBlocked = ReactionRules.pickCoverHex(blockedCtx, blockedUnit, null);
  assert.strictEqual(noDestBlocked, null, 'no destination when all neighbors have cost >= 99');

  // テスト6: 同 cover 同率 → attacker から遠い方を選ぶ
  const sameCoverCtx = {
    map: [[
      { q: 0, r: 0, cover: 10, cost: 1, id: 1 },  // current at (0,0)
      { q: 0, r: 1, cover: 30, cost: 1, id: 1 },  // candidate at (0,1)
      { q: 1, r: 0, cover: 30, cost: 1, id: 1 },  // candidate at (1,0)
    ]],
    neighbors: (q, r) => {
      if (q === 0 && r === 0) return [
        { q: 0, r: 1 },
        { q: 1, r: 0 },
      ];
      return [];
    },
    unitsInHex: (q, r) => [],
    hexCap: 2,
    hexDist: (a, b) => Math.abs(a.q - b.q) + Math.abs(a.r - b.r),
  };
  const sameUnit = { q: 0, r: 0, def: {}, team: 'player' };
  const attackerPos = { q: 2, r: 0 }; // attacker is at (2,0)
  const destSameCover = ReactionRules.pickCoverHex(sameCoverCtx, sameUnit, attackerPos);
  // dist from (0,1) to (2,0) = 2+0 = 2
  // dist from (1,0) to (2,0) = 1+0 = 1
  // → 遠い方 (0,1) を選ぶ
  assert.ok(destSameCover, 'should find destination with same cover');
  assert.strictEqual(destSameCover.r, 1, 'should choose farther destination (0,1) from attacker at (2,0)');

  // テスト7: attackerPos = null でも正常動作
  const nulAttackerDest = ReactionRules.pickCoverHex(mockCtx, unit, null);
  assert.ok(nulAttackerDest, 'should work with attackerPos = null');
  assert.strictEqual(nulAttackerDest.r, 1, 'should still choose highest cover when attacker is null');

  // テスト8: ctx 欠落時は null
  assert.strictEqual(ReactionRules.pickCoverHex(null, unit, null), null, 'should return null when ctx is null');
  assert.strictEqual(ReactionRules.pickCoverHex(undefined, unit, null), null, 'should return null when ctx is undefined');
  assert.strictEqual(ReactionRules.pickCoverHex({}, unit, null), null, 'should return null when ctx is incomplete');

  // テスト9: unit 欠落時は null
  assert.strictEqual(ReactionRules.pickCoverHex(mockCtx, null, null), null, 'should return null when unit is null');
  assert.strictEqual(ReactionRules.pickCoverHex(mockCtx, undefined, null), null, 'should return null when unit is undefined');

  console.log('✓ testPickCoverHex passed');
}

// メインテスト実行
testShouldGoProne();
testPickCoverHex();

console.log('✓ All reaction_rules tests passed');

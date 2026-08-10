/**
 * tests/rtwp_native_runtime.test.js -- RTwP が唯一の実行系である不変条件を固定する
 *
 * NORTH_STAR §7 Strangler Fig の最終段階。旧ターン制への切り戻し(?rtwp=0)を撤去し、
 * BattleFacade を RTwP-native な実行基盤に据えたことを機構で縛る。切り戻しが再混入
 * したら（誰かが ?rtwp=0 ガードを戻したら）ここで落ちる。
 *
 * No framework. Run with `node tests/rtwp_native_runtime.test.js`.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0;
function ok(cond, label) {
  assert.ok(cond, label);
  pass++;
  console.log('PASS: ' + label);
}

// 1. ランタイム経路に rtwp=0 の切り戻しガード（location.search を見る正規表現）が
//    残っていない。散文コメント中の言及は許すが、実行ガードの署名は許さない。
const bridge = read('phaser_bridge.js');
const rtwp = read('logic_battle_rtwp.js');
const GUARD = /rtwp=0\(\?:/; // 切り戻しガードで使っていた正規表現リテラルの署名
ok(!GUARD.test(bridge), 'phaser_bridge.js に rtwp=0 切り戻しガードが無い');
ok(!GUARD.test(rtwp), 'logic_battle_rtwp.js に rtwp=0 切り戻しガードが無い');

// 2. RTwP の attach/update は enabled だけで走る（location.search を見ない）
ok(/window\.RtwpBattle\s*&&\s*window\.RtwpBattle\.enabled\s*\)/.test(bridge),
  'phaser_bridge.js の RTwP ゲートは enabled のみ');

// 3. BattleFacade が正本、BattleLogic は後方互換の別名
const game = read('logic_game.js');
ok(/window\.BattleFacade\s*=\s*class BattleFacade/.test(game),
  'logic_game.js は BattleFacade を定義する');
ok(/window\.BattleLogic\s*=\s*window\.BattleFacade/.test(game),
  'BattleLogic は BattleFacade の別名として残る');

// 4. CampaignManager は BattleFacade 経由で構築する
const campaign = read('logic_campaign.js');
ok(/window\.BattleFacade\s*\|\|\s*window\.BattleLogic/.test(campaign),
  'logic_campaign.js は BattleFacade を優先して構築する');

// 5. 機能: isEnabled() は location.search に ?rtwp=0 があっても true を返す
function loadRtwp(search) {
  const sb = {
    module: { exports: {} }, console: { log() {}, warn() {}, error() {} },
    Math: Math, JSON: JSON, Date: Date, Map: Map, Set: Set, Infinity: Infinity,
    location: { search: search },
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(read('logic_battle_rtwp.js'), sb, { filename: 'logic_battle_rtwp.js' });
  return sb.RtwpBattle;
}
ok(loadRtwp('?rtwp=0').isEnabled() === true,
  'isEnabled() は ?rtwp=0 でも true（切り戻し不能）');
ok(loadRtwp('').isEnabled() === true, 'isEnabled() は既定で true');
const off = loadRtwp('');
off.enabled = false;
ok(off.isEnabled() === false, 'enabled=false のときだけ isEnabled() は false');

// 6. 旧ターン制の自動戦闘エントリ（AUTO ボタン = EnemyAI をプレイヤーへ回す）が
//    リリース入口(index.html)から撤去され、全AIが sim 経由になっている
const html = read('index.html');
ok(!/id="auto-toggle"/.test(html),
  'index.html に AUTO ボタン(#auto-toggle)が無い（旧自動戦闘AIの入口を撤去）');
ok(!/onclick="gameLogic\.toggleAuto\(\)"/.test(html),
  'index.html に toggleAuto() の起動口が無い');
ok(!/logic_ai\.js/.test(html),
  'index.html に旧ターン制AIスクリプトの読み込みが無い');
ok(!fs.existsSync(path.join(ROOT, 'logic_ai.js')),
  'logic_ai.js はRTwP移行後の実行資産から削除されている');

// 7. 旧自動戦闘AIの本体(runAuto/toggleAuto)と、ターン制AIの接続が
//    BattleFacade から撤去されている（Stage 1/2 スイープの固定）。
ok(!/\brunAuto\s*\(/.test(game), 'logic_game.js に runAuto() の定義が無い');
ok(!/\btoggleAuto\s*\(/.test(game), 'logic_game.js に toggleAuto() の定義が無い');
ok(!/this\.isAuto\s*=\s*(?:true|!)/.test(game),
  'this.isAuto を true / トグルで真にする代入が無い（自動戦闘は再活性化不能）');
ok(!/EnemyAI|executeTurn|this\.ai\b/.test(game),
  'BattleFacade に旧EnemyAIの接続が無い');
ok(!/\bendTurn\s*\(/.test(game) && !/\bcheckPhaseEnd\s*\(/.test(game),
  'BattleFacade に旧ターン遷移(endTurn/checkPhaseEnd)が無い');

// 8. 境界の不変条件: RTwP は installUi で旧コマンドメニュー(ui.showActionMenu)を
//    showSoldierMenu へ差し替える。これが旧ターン制の interactionMode 遷移
//    (setMode('ATTACK') 等 → actionAttack/checkPhaseEnd/endTurn/EnemyAI.executeTurn)を
//    実行時到達不能に保つ唯一の要。差し替えが外れたら旧クラスタが再び生きるため、
//    削除より先にこの配線をロックしておく（ブラウザsmoke後の物理削除の前提条件）。
ok(/g\.ui\.showActionMenu\s*=\s*function[^\n]*self\.showSoldierMenu/.test(rtwp),
  'logic_battle_rtwp.js は旧コマンドメニューを showSoldierMenu へ差し替える');

console.log('\n' + pass + ' passed');

/** Victory report and RTwP kill-attribution contracts. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const campaign = fs.readFileSync(path.join(root, 'logic_campaign.js'), 'utf8');
const sim = fs.readFileSync(path.join(root, 'sim_core.js'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'logic_battle_rtwp.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert.match(campaign, /renderVictoryReport\(b, casualties, survivors, battleEnd, promotions\)/,
  'victory uses a report instead of routing to reward choice cards');
assert.match(campaign, /this\.resupplySurvivors\(\{ heal: false \}\)/,
  'next sector automatically restocks ammunition without erasing wounds');
assert.match(campaign, /CONTINUE TO NEXT SECTOR/,
  'report has one explicit continuation action');
assert.match(campaign, /THIS BATTLE \/ CAREER[\s\S]*?FINAL HP \/ STATUS[\s\S]*?PROMOTION/,
  'every report row clearly separates kills, final condition and promotion');
assert.match(campaign, /resupplySurvivors\(options = \{\}\)[\s\S]*?const heal = options\.heal === true/,
  'healing is no longer implicit in ordinary resupply');
assert.match(campaign, /u\.hp > 0 && u\.hp < u\.maxHp \* 0\.25[\s\S]*?u\.simState === 'incap'/,
  'RTwP low-health and incapacitated survivors are reported as wounded');
assert.match(sim, /battleKills: 0/, 'sim tracks per-sector kills');
assert.match(sim, /source\.battleKills = \(source\.battleKills \|\| 0\) \+ 1/,
  'a confirmed down increments the source battle kill counter');
assert.match(bridge, /kills: Math\.max\(0, Number\(unit\.kills\) \|\| 0\)/,
  'persistent kills enter the next RTwP sector');
assert.match(campaign, /buildColumn\('FALLEN'[\s\S]*?buildColumn\('SURVIVORS'/,
  'report renders fallen and survivor columns side by side');
assert.match(campaign, /kind === 'kia' && u\.team === 'player' && Number\(before\.hp\) <= 0[\s\S]*?sector-report-purple-heart/,
  'Purple Heart styling is restricted to player casualties');
assert.match(page, /\.sector-report-columns[^{]*\{[^}]*grid-template-columns:repeat\(2/,
  'report keeps a two-column roster layout');
assert.match(page, /\.sector-report-list[^{]*\{[^}]*overflow-y:auto/,
  'each roster column scrolls independently');

console.log('sector_victory_report: 13 passed');

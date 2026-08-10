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

assert.match(campaign, /renderVictoryReport\(b, survivors, battleEnd, promotions\)/,
  'victory uses a report instead of routing to reward choice cards');
assert.match(campaign, /this\.resupplySurvivors\(\{ heal: false \}\)/,
  'next sector automatically restocks ammunition without erasing wounds');
assert.match(campaign, /CONTINUE TO NEXT SECTOR/,
  'report has one explicit continuation action');
assert.match(campaign, /sectorKills[\s\S]*?BATTLE CONDITION/,
  'report includes kills and battle condition columns');
assert.match(campaign, /resupplySurvivors\(options = \{\}\)[\s\S]*?const heal = options\.heal === true/,
  'healing is no longer implicit in ordinary resupply');
assert.match(campaign, /u\.hp > 0 && u\.hp < u\.maxHp \* 0\.25[\s\S]*?u\.simState === 'incap'/,
  'RTwP low-health and incapacitated survivors are reported as wounded');
assert.match(sim, /battleKills: 0/, 'sim tracks per-sector kills');
assert.match(sim, /source\.battleKills = \(source\.battleKills \|\| 0\) \+ 1/,
  'a confirmed down increments the source battle kill counter');
assert.match(bridge, /kills: Math\.max\(0, Number\(unit\.kills\) \|\| 0\)/,
  'persistent kills enter the next RTwP sector');
assert.match(page, /\.sector-report-table/, 'report uses a scrollable table layout');

console.log('sector_victory_report: 10 passed');

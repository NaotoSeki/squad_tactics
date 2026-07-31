/**
 * scripts/check_architecture_doc.js -- ARCHITECTURE.md と実ファイルの食い違いを検出する
 *
 * 地図が territory とズレるのが、繰り返し起きた「調べたら実は違った」の主因だった。
 * 2026-08-01 の改稿前、ARCHITECTURE.md は50行・12ファイル言及で、44あるルートJSのうち
 * 37が未記載、しかも存在しない game.js を案内していた（カバー率16%）。
 * 文書は放っておくと必ず腐るので、prose ではなく機構で縛る。
 *
 *   node scripts/check_architecture_doc.js          # レポート（ズレていれば exit 1）
 *   node scripts/check_architecture_doc.js --warn   # 常に exit 0（様子見用）
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DOC = path.join(ROOT, 'ARCHITECTURE.md');
const WARN_ONLY = process.argv.indexOf('--warn') !== -1;

/** 文書に載せなくてよいもの（生成物・ベンダ・実験用） */
const EXEMPT = [
  /^mission_embed_/,     // ミッション埋め込みは生成物
];

function main() {
  if (!fs.existsSync(DOC)) {
    console.error('ARCHITECTURE.md が見つかりません');
    process.exit(1);
  }
  const doc = fs.readFileSync(DOC, 'utf8');

  // 1. ルートJS で文書に出てこないもの
  const roots = fs.readdirSync(ROOT)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => !EXEMPT.some((re) => re.test(f)));
  const undocumented = roots.filter((f) => doc.indexOf(f) === -1);

  // 2. 文書が言及していて実在しないもの
  // §6 は「これから作る」提案なので、そこに出るファイル名は実在チェックの対象外
  const proposalAt = doc.indexOf('## 6.');
  const checkArea = proposalAt > 0 ? doc.slice(0, proposalAt) : doc;
  const mentioned = new Set((checkArea.match(/[\w./-]+\.(?:js|py|md|html|json)/g) || []));
  const missing = [...mentioned].filter((m) => {
    if (/^https?:/.test(m)) return false;
    return !fs.existsSync(path.join(ROOT, m));
  });

  // 3. 行数表記の乖離（±15% を超えたら陳腐化とみなす）
  const stale = [];
  const rowRe = /`([\w./-]+\.js)`\s*\|\s*\*{0,2}(\d[\d,]*)\*{0,2}\s*\|/g;
  let m;
  while ((m = rowRe.exec(doc)) !== null) {
    const file = m[1];
    const claimed = parseInt(m[2].replace(/,/g, ''), 10);
    const p = path.join(ROOT, file);
    if (!fs.existsSync(p)) continue;
    const actual = fs.readFileSync(p, 'utf8').split('\n').length;
    if (Math.abs(actual - claimed) > Math.max(20, claimed * 0.15)) {
      stale.push(file + ': 記載 ' + claimed + ' 行 / 実際 ' + actual + ' 行');
    }
  }

  const line = (n) => '-'.repeat(n);
  console.log('\nARCHITECTURE.md と実ファイルの突合');
  console.log(line(64));
  console.log('ルートJS: ' + roots.length + ' 件 / 文書に記載あり: '
    + (roots.length - undocumented.length) + ' 件 ('
    + Math.round(100 * (roots.length - undocumented.length) / roots.length) + '%)');

  if (undocumented.length) {
    console.log('\n[NG] 文書に出てこないルートJS (' + undocumented.length + '件):');
    undocumented.forEach((f) => console.log('   - ' + f));
  }
  if (missing.length) {
    console.log('\n[NG] 文書が案内していて実在しないファイル (' + missing.length + '件):');
    missing.forEach((f) => console.log('   - ' + f));
  }
  if (stale.length) {
    console.log('\n[NG] 行数の記載が実際とズレている (' + stale.length + '件):');
    stale.forEach((s) => console.log('   - ' + s));
  }

  const bad = undocumented.length + missing.length + stale.length;
  console.log('\n' + line(64));
  console.log(bad === 0 ? '一致。地図は territory を覆っている。'
    : '食い違い ' + bad + ' 件。ARCHITECTURE.md を直すこと。');
  console.log(line(64) + '\n');

  if (bad && !WARN_ONLY) process.exit(1);
}

main();

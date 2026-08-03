"""logic_game.js のメソッドを実測: 行数 / this への依存 / DOM依存 を出す"""
import re, sys
sys.stdout.reconfigure(encoding='utf-8')

src = open('logic_game.js', encoding='utf-8').read().split('\n')
methods = []
i = 0
while i < len(src):
    m = re.match(r'^  ([a-zA-Z_][a-zA-Z0-9_]*)\s*\(', src[i])
    if not m:
        i += 1
        continue
    name = m.group(1)
    depth = src[i].count('{') - src[i].count('}')
    start = i
    j = i + 1
    while j < len(src) and depth > 0:
        depth += src[j].count('{') - src[j].count('}')
        j += 1
    body = '\n'.join(src[start:j])
    n = j - start
    this_refs = len(re.findall(r'\bthis\.', body))
    dom = len(re.findall(r'document\.|window\.|Renderer\.|\.ui\.', body))
    methods.append((n, name, this_refs, dom, start + 1))
    i = j

methods.sort(reverse=True)
print('%-38s %5s %7s %6s  %s' % ('メソッド', '行数', 'this参照', 'DOM等', '開始行'))
print('-' * 74)
for n, name, t, d, ln in methods[:22]:
    print('%-38s %5d %7d %6d  %d' % (name, n, t, d, ln))

print()
tot = sum(n for n, *_ in methods)
print('メソッド数 %d / 合計 %d 行' % (len(methods), tot))
pure = [m for m in methods if m[2] <= 1 and m[3] == 0 and m[0] >= 8]
print()
print('=== 純粋に近い（this参照<=1・DOM無し・8行以上）===')
for n, name, t, d, ln in sorted(pure, reverse=True):
    print('  %-34s %4d行  this=%d  L%d' % (name, n, t, ln))

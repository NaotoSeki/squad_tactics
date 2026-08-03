"""
scripts/audit_assets.py -- 資産が実行時に読まれているかを監査する

「使っていないものを切りたい」時に、勘ではなく実測で判断するためのツール。

## 単純な文字列一致では足りない（実際に踏んだ罠）

コードは資産名を**生成して**読むことがある:

    this.load.spritesheet(KHAOS_FX.key(tier, v), `asset/explosion_khaos_${tier}${v}_384.png`, ...)

これを完全一致で探すと「未参照」と誤判定し、生きている資産を消してしまう。
そこでテンプレートリテラルの `${...}` を除いた**前後の固定部分**も参照断片として集め、
前方一致でも照合する。

## 使い方

    python scripts/audit_assets.py                 # 全体のレポート
    python scripts/audit_assets.py --untracked     # git 未追跡のものだけ
    python scripts/audit_assets.py --path asset/environment   # 特定の場所だけ

**このツールは何も削除しない。** 判断材料を出すだけ。
"""

import os
import re
import sys
import argparse
import subprocess

sys.stdout.reconfigure(encoding='utf-8')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEP = chr(92)

# 走査から外す場所（コードではない / 巨大 / 調査資料）
SKIP_DIRS = ('.git', 'node_modules', 'research', 'asset_src', 'scratch', '__pycache__')
CODE_EXT = ('.js', '.html', '.py', '.json', '.md')


def collect_references():
    """コード中に現れる asset/ data/ のパス断片を集める。生成名の固定部分も拾う。"""
    refs = set()
    # 通常のパス
    plain = re.compile(r"""['"`]((?:asset|data)/[A-Za-z0-9_./ -]*)""")
    # テンプレートリテラルの ${...} を除いた固定部分
    tmpl = re.compile(r"""`((?:asset|data)/[^`]*)`""")
    for dirpath, dirnames, filenames in os.walk(ROOT):
        norm = dirpath.replace(SEP, '/')
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        if any('/' + s in norm or norm.endswith(s) for s in SKIP_DIRS):
            continue
        for fn in filenames:
            if not fn.endswith(CODE_EXT):
                continue
            path = os.path.join(dirpath, fn)
            try:
                text = open(path, encoding='utf-8', errors='replace').read()
            except OSError:
                continue
            for m in plain.finditer(text):
                refs.add(m.group(1).replace(SEP, '/'))
            for m in tmpl.finditer(text):
                # `asset/explosion_khaos_${tier}${v}_384.png` -> 'asset/explosion_khaos_'
                head = re.split(r'\$\{', m.group(1))[0]
                if len(head) > 8:
                    refs.add(head.replace(SEP, '/'))
    return refs


def is_referenced(path, refs):
    """パスが参照断片のどれかと前方一致するか（生成名を取りこぼさないため双方向で見る）"""
    p = path.replace(SEP, '/').rstrip('/')
    for r in refs:
        if not r:
            continue
        if p.startswith(r) or r.startswith(p):
            return True
    return False


def dir_size(path):
    if os.path.isfile(path):
        try:
            return os.path.getsize(path)
        except OSError:
            return 0
    total = 0
    for dirpath, _, filenames in os.walk(path):
        for fn in filenames:
            try:
                total += os.path.getsize(os.path.join(dirpath, fn))
            except OSError:
                pass
    return total


def untracked_entries():
    out = subprocess.run(['git', 'status', '--porcelain'], cwd=ROOT,
                         capture_output=True, text=True).stdout
    return [l[3:].strip().strip('"') for l in out.split('\n') if l.startswith('??')]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--untracked', action='store_true', help='git 未追跡のものだけを見る')
    ap.add_argument('--path', default='asset', help='監査する場所（既定: asset）')
    args = ap.parse_args()

    os.chdir(ROOT)
    refs = collect_references()

    if args.untracked:
        entries = [e for e in untracked_entries() if e.startswith(args.path)]
    else:
        base = args.path
        entries = []
        if os.path.isdir(base):
            for name in sorted(os.listdir(base)):
                entries.append(os.path.join(base, name).replace(SEP, '/'))

    rows = []
    for e in entries:
        if not os.path.exists(e):
            continue
        rows.append((dir_size(e), e, is_referenced(e, refs)))
    rows.sort(reverse=True)

    print('\n資産監査 — コードが実行時に読むか')
    print('参照断片 %d 件を %s から収集（生成名の固定部分を含む）' % (len(refs), 'コード全体'))
    print('-' * 84)
    print('%-52s %10s  %s' % ('資産', 'サイズ', '参照'))
    print('-' * 84)
    for size, path, ref in rows[:40]:
        print('%-52s %8.1f MB  %s' % (path[:52], size / 1048576, 'YES' if ref else '--- 参照なし'))

    yes = sum(s for s, _, r in rows if r)
    no = sum(s for s, _, r in rows if not r)
    print('-' * 84)
    print('参照あり %.0f MB / 参照なし %.0f MB' % (yes / 1048576, no / 1048576))
    print()
    print('注意: 「参照なし」は削除してよいという意味ではない。')
    print('  - .blend など**元データ**は資産を再生成するために要る（実行時には読まれない）')
    print('  - 次バージョンの素材（作業中）はまだ参照されていないだけのことがある')
    print('  - manifest/JSON 経由の間接参照はこのツールでは追えない場合がある')
    print('削除は必ず人が判断すること。このツールは判断材料しか出さない。')


if __name__ == '__main__':
    main()

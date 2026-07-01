# ~~史実 × CBE 装填提案リスト~~ — **廃止**

**2026-05-31 廃止**

Wikipedia 口径ヒューリスティクスによる「史実提案」は **誤りが多く、採用しない**。

典型例（いずれも PL 正本と無関係な誤提案）:

| 武器 | 誤提案 | PL 正本 |
|------|--------|---------|
| M1911A1 | 45ACP-3（リボルバー半クリップ） | CBE スロット → **45ACP-7**（225） |
| M1 Rifle | 3006-5 / 30Cbn | **3006-8**（231） |
| HSc | 9Pb-8W | CBE → **32ACP-8H**（264）※要フィルタ RE |
| Gew98 | 7.92-10G | 5発装填 → **7.92-5**（272）※要フィルタ RE |

---

## 正本ドキュメント

**[PL_CBE_AMMO_TRUTH.md](./PL_CBE_AMMO_TRUTH.md)** — CBE バイナリ + cat18 + u27 のみ。

```bash
python scripts/export_pl_cbe_ammo_truth.py
python scripts/audit_pl_ammo_comprehensive.py
python scripts/build_wpns_pl_master.py
```

方針: [PL_AMMO_TRUTH.md](./PL_AMMO_TRUTH.md)

---

## 残置ファイル（参照禁止）

| ファイル | 状態 |
|----------|------|
| `data/pl_ammo_historical_research.json` | 凍結 — 新規追記禁止 |
| `data/pl_ammo_historical_proposals.json` | 生成停止 |
| `scripts/wikipedia_ammo_crawl.py` | 実行非推奨 |
| `scripts/research_historical_ammo_loop.py` | 生成停止 |

ユーザー指摘・PL 実機確認は `data/pl_cbe_ammo_truth.json` の差分行に反映する。

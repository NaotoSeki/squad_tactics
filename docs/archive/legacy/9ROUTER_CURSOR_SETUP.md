# 9router × Cursor セットアップ（Platoon Leader RE 向け）

**目的**: 9router の RTK（tool_result 圧縮 20–40%）と無料/格安ルートでトークンを節約し、Cursor オンデマンドは **本当に必要な深い RE だけ** に使う。

**9router**: [decolua/9router](https://github.com/decolua/9router)  
**RE 入口**: [PL_CBE_RE_INDEX.md](./PL_CBE_RE_INDEX.md)  
**Antigravity 引き継ぎ**: [PL_RE_HANDOFF_ANTIGRAVITY.md](./PL_RE_HANDOFF_ANTIGRAVITY.md)

---

## 0. 現状（2026-05-31）

| 項目 | 状態 |
|------|------|
| Node.js | v22+ 確認済 |
| `npm install -g 9router` | 済 |
| `npm install -g better-sqlite3` | 済（Cursor OAuth 自動取込用） |
| 9router 起動 | `http://localhost:20128`（トレイ常駐） |

再起動:

```powershell
.\scripts\start_9router.ps1 -NoBrowser
```

---

## 1. ダッシュボード初期設定（5 分）

1. ブラウザで **http://localhost:20128/dashboard** を開く
2. 初回ログイン（パスワード設定）
3. **Endpoint** タブ → **RTK Token Saver: ON**（デフォルト ON）を確認
4. **API Key** をコピー（Cursor 設定で使う）

### プロバイダ接続（推奨順）

| 優先 | Provider | 用途 | モデル例 |
|------|----------|------|----------|
| 1 | **Kiro AI** | 無料・大量 RE（スクリプト/doc） | `kr/claude-sonnet-4.5` |
| 2 | **OpenCode Free** | サインアップ不要バックアップ | `oc/` 系（自動取得） |
| 3 | **Cursor** | 既存 Pro サブスク + RTK | `cu/claude-4.6-opus-max` |
| 4 | **GLM**（任意） | 格安バックアップ $0.6/1M | `glm/glm-4.7` |

**Cursor 接続**: Dashboard → Providers → **Connect Cursor** → OAuth  
Windows で DB 読込エラーが出たら:

```powershell
npm install -g better-sqlite3
```

→ Dashboard で **Retry**

---

## 2. Combo 作成（RE 用）

Dashboard → **Combos** → Create New

### `pl-re-bulk`（無料・日常 RE）

```
Name: pl-re-bulk
Models:
  1. kr/claude-sonnet-4.5
  2. oc/（OpenCode Free の先頭モデル）
  3. glm/glm-4.7
```

用途: doc 更新、`scripts/re_cbe_*.py` 追加、JSON 再生成、grep 結果の整理

### `ag-via-cursor`（Antigravity IDE → Cursor サブスク）

Antigravity を主 IDE にしつつ Cursor サブスクを使う場合:

```
Name: ag-via-cursor
Models:
  1. cu/claude-4.6-opus-max   # Cursor サブスク（RTK 付き）
  2. kr/claude-sonnet-4.5     # Kiro 無料 fallback
  3. ag/（Antigravity 接続済みモデル）
```

Antigravity IDE 側も Cursor と同様:

```
Base URL: http://127.0.0.1:20128/v1
API Key:  [9router ダッシュボード]
Model:    ag-via-cursor
```

### `pl-re-deep`（深い RE・オンデマンド節約）

```
Name: pl-re-deep
Models:
  1. cu/claude-4.6-opus-max   # Cursor サブスク経由 + RTK
  2. kr/claude-sonnet-4.5
  3. glm/glm-4.7
```

用途: DE85/DE9A、D0F0、E02C ランタイム同一性など **未完了 §8** の難所

---

## 3. Cursor IDE 設定

### 方法 A — ダッシュボード（推奨）

```
Dashboard → CLI Tools → Cursor → Model: pl-re-bulk または pl-re-deep → Apply
```

### 方法 B — 手動

**Settings → Models → OpenAI API**（Advanced）:

| 項目 | 値 |
|------|-----|
| Override OpenAI Base URL | `http://127.0.0.1:20128/v1` |
| OpenAI API Key | 9router ダッシュボードの API Key |
| Custom model | `pl-re-bulk` または `kr/claude-sonnet-4.5` |

**注意**

- Base URL は **`127.0.0.1`** 推奨（Windows IPv6 問題回避）
- 末尾 **`/v1`** 必須
- モデル名は **9router の prefix 付き**（`kr/...`, `cu/...`, combo 名そのまま）
- クラウド `https://9router.com/v1` は VPS デプロイ時のみ

### オンデマンド（Cursor ネイティブモデル併用）

9router 経由 = **Cursor API 枠を消費しない**（Kiro/GLM/combo 使用時）。

ネイティブ Claude/GPT（Cursor 標準モデル）を使う場合:

1. **Cursor Settings → Usage → Enable on-demand usage**
2. **Monthly spend limit** を設定（例: $50–100、RE 完走用）
3. 深い RE セッションだけネイティブ、それ以外は **9router カスタムモデル**

---

## 4. PL RE トークン節約ワークフロー

### モデル使い分け

| タスク | モデル | 理由 |
|--------|--------|------|
| doc 追記・索引更新 | `pl-re-bulk` | 低コスト |
| `re_cbe_*.py` 新規/修正 | `pl-re-bulk` | 反復が多い |
| 逆アセンブル 1 関数深掘り | `pl-re-deep` | 推論力 |
| DOSBox ランタイム検証設計 | `pl-re-deep` または Cursor ネイティブ + オンデマンド | 不確実性が高い |
| 一括再生成（§4 スクリプト群） | **ターミナルで直接実行**（AI 不要） | トークン 0 |

### エージェント指示の型（コピペ用）

```
@docs/PL_CBE_RE_INDEX.md §8 の優先 4（DE85/DE9A/DE5E）だけ着手。
D:\PL\CBE.EXE file offset は 0x04xxxx 6 桁。Capstone lcall オペランド逆順に注意。
新規確定分は scripts/re_cbe_*.py → md+json 自動生成。doc 末尾に ST再現/未完了/関連 を維持。
大きな hex dump は scripts/ に出力してパスだけ報告（チャットに貼らない）。
```

### 一括再生成（AI 不要）

```powershell
cd c:\Projects\squad_tactics
python scripts/re_cbe_273_272_path.py
python scripts/re_cbe_mission_pool.py
python scripts/re_cbe_dbd7_deep.py
python scripts/re_cbe_mag_type_3d540.py
python scripts/re_cbe_3dbc2.py
python scripts/re_cbe_loadout_template.py
python scripts/re_cbe_800f_mask.py
python scripts/re_cbe_seg132_export.py
python scripts/re_cbe_pass2_1ec.py
python scripts/re_cbe_loadout_candidate.py
```

---

## 5. 動作確認

PowerShell:

```powershell
# ダッシュボード
Start-Process "http://127.0.0.1:20128/dashboard"

# API（API Key を $KEY に設定）
$KEY = "sk_..."   # dashboard から
Invoke-RestMethod -Uri "http://127.0.0.1:20128/v1/chat/completions" `
  -Method POST `
  -Headers @{ Authorization = "Bearer $KEY"; "Content-Type" = "application/json" } `
  -Body '{"model":"kr/claude-sonnet-4.5","messages":[{"role":"user","content":"ping"}],"max_tokens":16}'
```

Cursor: カスタムモデル `pl-re-bulk` で Agent に「PL_CBE_RE_INDEX §8 を読んで優先 4 だけ要約」と送り、応答が返れば OK。

---

## 6. トラブルシュート

| 症状 | 対処 |
|------|------|
| Cursor でモデルエラー | 9router 最新化: `npm install -g 9router@latest` |
| Cursor OAuth 失敗 | `npm i -g better-sqlite3` → Dashboard Retry |
| localhost タイムアウト | トレイアイコンで 9router 稼働確認 / ポート 20128 |
| クォータ切れ | Combo フォールバック確認 / Kiro 再接続 |
| RTK 効果を見たい | Dashboard → Usage Analytics で token 推移 |

---

## 7. 残 RE タスク（オンデマンド投入目安）

[PL_CBE_RE_INDEX.md §8](./PL_CBE_RE_INDEX.md#8-未完了優先順) より:

1. **DE85 / DE9A / DE5E** — mission pool slot type
2. **`lcall D0F0`** — DBD7 被除数
3. runtime **0x70B2 / 0xB979** → seg132 マップ
4. E02C 入力 ptr 同一性（DOSBox）

**§8 の 1–2 を `pl-re-deep` で片付け → 3–4 は DOSBox セッション → 残りは bulk で doc/スクリプト整理** がコスパ最良。

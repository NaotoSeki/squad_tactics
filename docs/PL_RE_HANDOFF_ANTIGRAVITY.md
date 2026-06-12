# Platoon Leader RE — Antigravity 引き継ぎ

**目的**: Cursor セッションから Antigravity IDE へ RE 作業を移す。  
**本書**: Antigravity / 他 AI が **最初に読む** 1 枚 — 詳細はリンク先。

**最終更新**: 2026-06-01  
**引き渡し元**: Cursor + 9router（Kiro / Cursor / Antigravity 接続済み）

---

## 1. いま何をしているか

| 項目 | 内容 |
|------|------|
| ゲーム | **Platoon Leader** (1997 SEGA/TechnoBrain) |
| 対象 | `D:\PL\CBE.EXE` — 装填 / mission pool / 装備 UI |
| ST 側 repo | `c:\Projects\squad_tactics` |
| RE 入口 | [PL_CBE_RE_INDEX.md](./PL_CBE_RE_INDEX.md) |
| **直近ミッション** | **各種兵器データベースの完全掌握（D:\PL を正本とする紐づき解決）** |

### 直近セッションで確定したこと

- [PL_CBE_DE_SLOT_RE.md](./PL_CBE_DE_SLOT_RE.md) を修正し、`DE85/DE5E/DE9A` は実在しないゴーストスタブ（再配置チェーンのプレースホルダー）であることを完全特定。
- すべての分岐パスは同一の `lcall DBD7` (`0x04859A`) を呼び出し、リターン後の処理のみが異なることを検証完了。

### 兵器データベース掌握ロードマップ（優先順）

1. ~~**`lcall D0F0` @ `0x04859D` (DBD7被除数ソース)**~~ [RESOLVED]
   - MSVC LCG `rand()` 呼び出しであり、0〜99の乱数を弾薬出現確率 (u16_5) と比較する確率判定の天井値であることを完全特定。
2. **`0x41BD8` (三脚等非u26交差互換テーブル)**
   - 主武器と Laf34 / M2 三脚等の pairing ロジックおよび固定テーブルのアドレスを解読する。
3. **`0x41942` (武器・弾薬のカテゴリ判定 `weapon_col_type`)**
   - 装備画面のコラム分類および対応フラグ判定の仕組みを確定する。
4. **CBE 64B 武器レコードの未知フィールド (`unknown_`) の完全解読**
   - 重量、初期命中率、コストに続くその他の未知データ領域（射程、APコスト等）を特定する。

再生成:

```powershell
cd c:\Projects\squad_tactics
python scripts/re_cbe_de_slot_deep.py
```

---

## 2. 9router / Antigravity セットアップ（接続済み）

| Provider | 状態 | 用途 |
|----------|------|------|
| **Kiro** | ✅ OAuth | 無料 bulk RE — `kr/claude-sonnet-4.5` |
| **Cursor** | ✅ OAuth | サブスク — `cu/claude-4.6-opus-max` |
| **Antigravity** | ✅ OAuth | Gemini 系 — `ag/` プレフィクス |

9router: `http://127.0.0.1:20128`（未起動なら `.\scripts\start_9router.ps1 -NoBrowser`）

**API 接続の向き**（混同注意）:

```
Antigravity IDE ──(9router API Key)──▶ 9router ──(OAuth)──▶ Kiro / Cursor / Antigravity
```

- **Antigravity IDE** に入れるのは **9router の API Key**（OpenAI 互換）
- **Kiro / Cursor / Antigravity** は 9router **ダッシュボード側**で Connect（済）

詳細: [9ROUTER_CURSOR_SETUP.md](./9ROUTER_CURSOR_SETUP.md)

---

## 3. Antigravity IDE 設定（継承確認用）

### 3.1 9router 経由（推奨 — RTK で 20–40% 節約）

Dashboard → **Combos** → 未作成なら **`ag-via-cursor`** を作成:

```
Name: ag-via-cursor
Models:
  1. cu/claude-4.6-opus-max
  2. kr/claude-sonnet-4.5
  3. ag/（接続済み Antigravity モデル名）
```

Antigravity IDE → Settings → Models（OpenAI 互換）:

| 項目 | 値 |
|------|-----|
| Base URL | `http://127.0.0.1:20128/v1` |
| API Key | 9router ダッシュボード → Endpoint |
| Model | `ag-via-cursor` または `kr/claude-sonnet-4.5` |

### 3.2 動作確認

```
Reply with exactly: 9router-ok
```

9router ダッシュボード **Usage** にリクエストが増えれば OK。

### 3.3 AIの役割分担

| エージェント | 役割 | 得意分野・利用方針 |
|---|---|---|
| **Antigravity** (Gemini) | **ミッションコントローラー** | **全体設計・探索型調査監督**。広大なコンテキストウィンドウを活かして、バイナリ全体のポインタ、データ、スクリプトの依存関係、マップファイルをスキャンし、計画を策定する。 |
| **Cursor / Kiro** (Claude) | **深層逆アセンブリエンジン** | **局所的で極めて高度なコード推論**。特定の関数、分岐判定、DOSBoxレジスタダンプの精緻な読み込み、複雑な1アセンブラブロックの深掘りにフォーカスする。 |

### 3.4 Cursor Composer v2 / Agent機能と9router

- Cursorの Composer (v2) や Agent機能は、設定（Settings -> Models -> OpenAI API）で 9router の Base URL と API Key を指定すれば基本的には問題なくルーティングされます。
- 正しく 9router を経由しているかは、Composer 使用時に 9router ダッシュボードの `Usage & Analytics` 画面を開き、リクエストカウントが増加しているかで確認できます。

### 3.5 クォータ切れ・今後の課金ガイド

もし Kiro や Cursor の無料枠・サブスク制限に達した場合（API limit reached）、以下の課金方法で解決できます。

1. **OpenRouter (プリペイド式 - 最も推奨)**
   - 9routerと非常に親和性の高い外部プロバイダ。アカウントを作成してクレジットカード等で $5～10 程度プリペイド（チャージ）して API Key を発行し、9router の Providers/Combos に追加します。
   - これにより、完全な従量課金（使ったトークン分だけ数円〜数角単位）で `claude-3.5-sonnet` などを補充利用できます。
2. **Cursor Pro ($20/月)**
   - Cursor 標準の 500回/月 枠を使い切った場合、追加高速枠を購入するか、低速枠（混雑時に少し待たされるが、無制限）でそのまま利用し続けることができます。
3. **DeepSeek API (超格安コード生成用)**
   - DeepSeekの API Key を 9router に追加。価格が `$0.14 / 1M input tokens` と信じられないほど安いため、コード生成・スクリプト再生成などの日常 bulk 作業に割り当てるとコストをほぼゼロにできます。

---

## 4. RE 作業ルール（必読）

Cursor 用ルール: [`.cursor/rules/pl-re-token-efficiency.mdc`](../.cursor/rules/pl-re-token-efficiency.mdc)  
Antigravity でも同趣旨で守ること。

| ルール | 内容 |
|--------|------|
| file offset | **`0x04xxxx` 6 桁** |
| lcall | 生バイト `9A ip_lo ip_hi cs_lo cs_hi` — Capstone 表示順 **逆** のことがある |
| DBD7 着地 | seg5 + **`0xD0DA`** → **`0x04859A`**（≠ `0x049097`） |
| DE4A スタブ | seg5 + **cs_imm** → 例 DE5E = **`0x04931E`** |
| 出力 | hex dump 全文をチャットに貼らない → `scripts/pl_decoded/` に書いてパス報告 |
| 確定時 | `scripts/re_cbe_*.py` → md + json、doc 末尾 **ST再現 / 未完了 / 関連** |

---

## 5. Antigravity 用コピペプロンプト

```
@c:\Projects\squad_tactics\docs\PL_RE_HANDOFF_ANTIGRAVITY.md と @docs/PL_CBE_RE_INDEX.md を読んで RE を継続。

直近: PL_CBE_DE_SLOT_RE.md — DE85/DE9A/DE5E 部分完了。
次: DE85 内部 lcall @ 0x049345 の着地解決（re_cbe_de_slot_deep.py 拡張可）。

正本 D:\PL\CBE.EXE。file offset 0x04xxxx 6桁。lcall バイト順注意。
大きな disasm は pl_decoded/ に出力。1ターン1論点。
```

---

## 6. ファイルマップ（触る場所）

| 種別 | パス |
|------|------|
| RE 索引 | `docs/PL_CBE_RE_INDEX.md` |
| 直近 RE | `docs/PL_CBE_DE_SLOT_RE.md` |
| 9router | `docs/9ROUTER_CURSOR_SETUP.md` |
| DE slot スクリプト | `scripts/re_cbe_de_slot_deep.py` |
| DE slot JSON | `scripts/pl_decoded/cbe_de_slot_re.json` |
| mission pool | `docs/PL_CBE_MISSION_POOL_RE.md` |
| DBD7 | `docs/PL_CBE_DBD7_RE.md` |
| 273→272 正本 | `docs/PL_CBE_273_272_PATH_RE.md` |
| 9router 起動 | `scripts/start_9router.ps1` |

---

## 7. 継承チェックリスト

Antigravity で以下を順に確認:

- [ ] 9router 起動（`http://127.0.0.1:20128/dashboard`）
- [ ] Antigravity IDE → 9router Base URL + API Key + モデル
- [ ] テスト応答 `9router-ok` + Usage 増加
- [ ] `docs/PL_CBE_RE_INDEX.md` §2 パイプライン図を読んだ
- [ ] `docs/PL_CBE_DE_SLOT_RE.md` 未完了 § を把握
- [ ] `python scripts/re_cbe_de_slot_deep.py` が通る（`D:\PL\CBE.EXE` 必須）
- [ ] 次タスク（DE85 内部 lcall）に着手

---

## 8. 関連

- [PL_CBE_RE_INDEX.md](./PL_CBE_RE_INDEX.md) — RE 全体索引
- [9ROUTER_CURSOR_SETUP.md](./9ROUTER_CURSOR_SETUP.md) — 9router 詳細
- [PL_CBE_DE_SLOT_RE.md](./PL_CBE_DE_SLOT_RE.md) — 直近 RE 成果

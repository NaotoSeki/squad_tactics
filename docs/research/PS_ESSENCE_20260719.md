# Panzer Strike — 全体アルゴリズム調査とエッセンス抽出

調査日: 2026-07-19
調査者: Claude (research agent)
対象成果物: 本ファイルのみ新規作成。既存ファイルは変更していない。

**凡例**: 🟢確定事実（ローカル証拠 or 一次ソースで裏取り済み） / 🟡推測・傍証（系譜・類推からの推論、明示） / 🔴未確認（調べたが分からなかった）

---

## 0. 要点サマリ（5行）

1. ローカルの「Panzer Strike」は Steam の `Panzer Strike Demo`（appid 4787810 / 本体 3305930、ISAK Team、2025年発表・2026 Q3 フル版予定）で、Sudden Strike 1-2 / Blitzkrieg 1 の直接的な現代版オマージュ。1987年 SSI の Gary Grigsby作『Panzer Strike』とは**無関係の別ゲーム**。
2. squad_tactics 内での実際の使用実績は**アートリファレンス抽出のみ**（`scripts/ps_extract/` が SSC スプライトコンテナと SPL パレットを実ゲームの D3D9 ドライバ経由で解析・PNG化、33枚抽出済み）。ゲームロジック・アルゴリズムのローカル解析実績は無い。
3. `data/pl_*` 系（CBE.EXE 由来）は Panzer Strike とは**完全に別の出典**——1997年 SEGA/TechnoBrain『プラトーン・リーダー(Platoon Leader)』の武器・弾薬データテーブル。混同禁止（タスク指示通り確認・分離済み）。
4. Panzer Strike 自体はまだ初期デモ段階（外部情報によればスキルミッシュモードは「AI行動なし」の技術デモ）で、精緻な戦闘アルゴリズムは未公開・未成熟。よって本書のメカニクス解剖は、Panzer Strike が公式に「直接の系譜」と名乗る Sudden Strike / Blitzkrieg 1 の**確立済みメカニクス**を主たる一次情報として扱う（Panzer Strike固有の確認事項ではないと明記）。
5. 移植候補の最有力は、既存 NORTH_STAR.md の「分隊長ノード」「伝達コスト」「遮蔽最重要」ドクトリンを補強する形の小粒な追加——NCOオーラ（視認・経験値ボーナス半径）、建物内射撃スロットの向き制限、遮蔽の損壊連動——であり、大味な「基地建設なし・数千ユニット」的スケール変更は不要（すでに方向性が違う）。

---

## 1. 対象の同定

### 1.1 ローカル証拠

| 証拠 | 内容 | 状態 |
|---|---|---|
| `scripts/ps_extract/ssc_format.py` | docstring: `"""Low-level reader for Panzer Strike ``.ssc`` sprite containers."""` | 🟢 |
| `scripts/ps_extract/ssc_probe.py` | docstring: `"""Print structural facts about Panzer Strike SSC sprites."""` | 🟢 |
| `scripts/ps_extract/ssc_driver_render.py` | `--driver` 既定値 `C:\Program Files (x86)\Steam\steamapps\common\Panzer Strike Demo\Drivers\Driver.Direct3D9.dll` | 🟢 |
| `scripts/ps_extract/reference_extract.py` | `DEFAULT_OBJECT_ROOT = ...\Panzer Strike Demo\Data\Game\Common\Media\Objects` | 🟢 |
| `scratch/kb3d_study/ps_spl_list.txt` | 同 Steam パス配下の `.spl`（パレット）ファイル一覧296件 | 🟢 |
| `scratch/kb3d_study/ps_reference/` | 33枚のPNG（樹木・建物・畑・柵・瓦礫・クレーター・草花等、KB3D素材との視覚言語比較用） | 🟢 |
| `tests/test_ps_ssc_format.py` | SSCコンテナのパース（slot_count / frame header / scanline overrun 検出）の単体テスト3件 | 🟢 |
| `docs/HANDOFF_TO_FABLE5.md` L100, L104 | 「Panzer Strike参照PNG33件」への言及、Blender外部テクスチャ依存として存在 | 🟢 |
| `docs/WORLDVIEW_REGEN_DESIGN.md` L11 | **「Panzer Strike（Sudden Strike クローン）の画づくり文法」**と明記 | 🟢 決定的証拠 |
| `docs/HANDOFF_TO_GPT.md` L13 | 参照画像は「実ゲーム画面」（Steamデモ本体のスクリーンショット） | 🟢 |

**Steam本体の未検出**: ユーザーの `Downloads` フォルダには Panzer Strike 関連ファイルは無かった（`*panzer*`, `*strike*`, `*.ssc`, `*ssi*` で検索し無検出）。ゲーム本体は `C:\Program Files (x86)\Steam\steamapps\common\Panzer Strike Demo` に**インストールされていた（過去のスクリプト実行時点）**ことがコード上のパスから伺えるが、今回の調査では実機の現存確認・再検証は行っていない（スクリプトのデフォルト引数からの推定に留まる）。

**技術的に注目すべき点**: `ssc_driver_render.py` は SSC のピクセル符号化（スキャンラインRLE、`ssc_format.py` の docstring で「まだ解読途中の scanline codec」と明記）を自力で解かず、**ゲーム本体が同梱する `Driver.Direct3D9.dll` を ctypes で直接呼び出し**、`PixelBufferSpriteDraw8Bpp` 等のエクスポート関数にスプライト構造体とパレットを渡してRGBAを取得している。これは正しい設計判断（コーデックの誤読リスクを排除し、ゲーム自身の正規実装で復号する）だが、**ゲームプレイのロジックには一切触れていない**——這い出したのは色域・オブジェクト語彙（KB3D比較用）のみで、戦闘アルゴリズムの手がかりはゼロ。

### 1.2 外部情報での同定

- Steam: [Panzer Strike](https://store.steampowered.com/app/3305930/Panzer_Strike/)（本体, appid 3305930）/ [Panzer Strike Demo](https://store.steampowered.com/app/4787810/Panzer_Strike_Demo/)（appid 4787810、ローカルパスと一致）
- 開発: 🟡 検索結果は開発チームを "ISAK Team" と記載（複数の二次ソースの要約経由であり、Steamストアページ本文からの直接確認はできていない。表記ゆれの可能性あり、要再検証）。
- 系譜の自己申告: [Sudden Strike Maps記事](https://sudden-strike-maps.de/index.php/289-panzer-strike-rts-was-announced) — 「Sudden Strike 1-2 と Blitzkrieg 1 に強く影響を受けた、クラシックなリアルタイム戦術ゲームの再現・現代化プロジェクト」。開発陣の一人は Sudden Strike 改造コミュニティ向けツール（RWG, FMRM, SuSt_Graph）の作者と紹介されており、系譜主張は単なるマーケティング文言以上の裏付けがある。
- 現状: 🟡 同記事は「スキルミッシュモードは大規模戦車戦を披露するが、現時点でAI行動が無い」と明記。技術デモ段階であり、squad_tacticsが求める「完成した全体アルゴリズム」の状態にはまだ到達していない可能性が高い。
- 予定: 2026年内 → Q3 2026 フル版予定（🟡 発表時点の予定であり実際のリリースは未確認）。

**結論**: これは **1987年 SSI / Gary Grigsby の『Panzer Strike』ではない**。同名だが無関係の、2020年代インディーによる Sudden Strike / Blitzkrieg 直系オマージュ作品。タスク前提の「SSIのGrigsby系（命中/貫通テーブル・士気・抑圧・指揮範囲）」という仮説は**不成立**——ローカル証拠（Steamパス・D3D9ドライバ・ドキュメント上の明記）がこれを裏付ける。

### 1.3 別ゲームとの混同回避（`data/pl_*` の出自）

`data/pl_ammo_resolve.js`, `data/pl_cbe_*.js`, `data/pl_composite_links.*`, `scripts/cbe_*.py`, `scripts/pl_*.py` は **Panzer Strike と無関係**。`scripts/pl_decoded/analysis_summary.txt` 冒頭に明記:

> `Platoon Leader (1997 SEGA/TechnoBrain) - COM.DLL & ADM.DLL 解析レポート`

16bit NE形式DLL（`COM.DLL`, `ADM.DLL` 等）のエクスポート関数リバースエンジニアリングによる、武器・弾薬・装備互換テーブルの抽出プロジェクトであり、日本のPC/コンシューマ向けWW2小隊戦術ゲーム『プラトーン・リーダー』(1997) が出典。`data/ammo_field_analysis.md` の「CBE.EXE / TABLE_START=0x1DDF00」もこれに属する。NORTH_STAR.md §4.3 が言う「PL由来の武器・弾薬互換データ（構築済パイプライン）」はこれを指す。

このゲーム自体のメカニクス調査は**本タスクの範囲外**（今回はPanzer Strikeが対象）。ただし、「pl」という接頭辞が2つの無関係な出典（Platoon Leader由来のデータ層 と Panzer Strike由来のアート参照層）に同時に存在する現状は、将来の可読性リスクとして記録しておく（対処はスコープ外のため提案のみ: `data/pl_*` を `data/plt_*` 等へ改名、または冒頭コメントに出典明記——別タスクで）。

---

## 2. 全体アルゴリズムの解剖

**重要な前提**: Panzer Strike自身の内部アルゴリズムを記述した一次資料（マニュアル・Wiki・開発者インタビューでの数値開示）は見つからなかった。デモが技術デモ段階であることと符合する。以下は、Panzer Strikeが公式に系譜と認める **Sudden Strike（Fireglow Games, 2000）** と **Blitzkrieg（Nival, 2003）** の確立済みメカニクスを主情報源とし、**「Panzer Strikeが継承する可能性が高い設計思想」として🟡推測で記述する**。Panzer Strike固有の確認済み事実（Steamストアページの機能列）は🟢で区別する。

### 2.1 ターン/フェーズ構造

- 🟢 Panzer Strike: Steamストア記載は「Authentic RTS gameplay」——リアルタイム。ターン制ではない。ノンリニアミッション、ソロ/マルチ対応。
- 🟡 Sudden Strike/Blitzkrieg系譜: 完全リアルタイム、一時停止なし（Blitzkriegはポーズ可能な指示行列を持つが基本はリアルタイム進行）。基地建設・資源採集・ユニット生産が**存在しない**——シナリオ開始時に配布された部隊のみで戦う一発勝負性が特徴（Wikipedia/ガイド記事: "no resource gathering, base building, technology researching, or unit spawning"）。増援・空爆支援もプレイヤーの自由裁量ではなく、シナリオが定めたタイミングで到来する（プレイヤーの介入度が低い）。
- 命令の同時実行/交互実行の区別自体が無意味な設計（リアルタイム）。ただし個々の部隊への命令はプレイヤーの直接クリックで即時発行され、伝達遅延は無い（=squad_tacticsが独自に追加している「伝達コスト」は、この系譜には存在しない要素）。

### 2.2 射撃解決

- 🟡 命中率の明示的な公式は一次資料で開示されておらず（ガイド記事も「具体的な数式は非公開」と明記）、実装はブラックボックス。判明している構成要素:
  - 経験値（0〜1000）が命中率・射程・視認範囲に影響（ユニット種による）
  - 地形（建物内部にいる歩兵は建物の開口部の向きにしか射撃できない——後述2.4）
  - 装甲は**方向依存**（前面装甲は正面弾を軽減、側面・背面は脆弱）——貫通vs装甲の二値ではなく方向性のある減衰モデル
  - 距離減衰は「射程」と「視認範囲」を分離して扱う（射程 > 視認範囲のユニットが多く、正しく視認さえできれば射程内で撃てる=間接射撃・スポッティング連携の戦術価値が生まれる）
  - データテーブル駆動の度合いは🟡高い（ユニットごとの装甲厚・貫通力・射程をXMLやリソースファイルで管理する設計がこの世代のRTTの通例。Blitzkriegはソースがnival/Blitzkriegでpublic archiveされているため検証可能だが、本タスクでは深掘りしていない）

### 2.3 士気・抑圧・部隊結束

- 🔴 Sudden Strike固有の「モラル/パニック」の明示的な状態機械は、調査したガイド・Wikipediaでは**言及が見つからなかった**（ガイド記事は明確に「morale/suppression not covered」と回答）。
- 🟡 一方でBlitzkriegの周辺コミュニティ議論では「Shocked」「Panicked」という抑圧下の状態名が言及されており（ただし出典は一般的な戦術ゲーム比較の文脈で、Blitzkrieg固有の確定情報ではない可能性がある——**信頼度は低い**）。
- 結論: この系譜のタイトルは、squad_tactics の North Star が採用する「制圧ゲージ0-100・suppressed/pinned二段階・rout判定」ほど精緻な士気状態機械を持っていない、または少なくとも公開情報からは確認できない。**squad_tactics側の制圧システムはこの系譜からの直接移植ではなく独自設計として扱うべき**（この点は「頂戴しないもの」ではなく「そもも頂戴する対象が無い」という発見）。

### 2.4 視認・隠蔽

- 🟢/🟡 (Sudden Strike, ガイド記事より) 視認範囲は武器射程と別管理。ユニット移動で視界が新しい区画に「ラグ」を伴って更新される（数秒遅延）。
- 🟡 建物内の歩兵は「建物内部で位置をシフトし、視界と射撃可能角度が特定方向に制限される」——**開口部（窓・扉）の向きに縛られた射界**という設計。これはsquad_tacticsの `HANDOFF_TO_FABLE5.md` §7 navigation JSON契約が既に用意している `slots[].facing_deg` フィールドと概念的に一致する（詳細は §3.2）。
- 🟡 丘陵地形は「低い側から高い側が見えない」——高低差による一方的視認の欠落（squad_tacticsは現状 hexの `cover`/`cost` フィールドのみで高低差視認を持たない可能性が高く、要確認）。
- 🟡 地雷は所有側にのみ見える——非対称情報の一例（squad_tacticsのスコープには現状無い）。

### 2.5 指揮系統

- 🔴 Sudden Strike/Blitzkriegには squad_tactics の「伝達コスト・命令遅延」に相当する明示的な仕組みは見当たらない——**命令は即時実行**が基本（プレイヤーが直接クリックで個別ユニットに指示、遅延なし）。
- 🟢 唯一の指揮的要素は「士官(officer)の近接ボーナス」: 士官の近くにいる友軍ユニットは経験値獲得ボーナスを得る（士官が車両内・砲兵要員として搭乗中でも有効。ただし士官同士には効果が及ばない）。士官は歩兵中最長の視認範囲を持つ。
- これは squad_tactics の「分隊長=伝達ノード・分隊長死亡で全遅延×3」という設計とは全く異なるレイヤーの仕組み（コマンド遅延ではなく、パッシブな近接オーラ）。**むしろ良い補完候補**——North Starの「分隊長の位置取り自体が戦術」という狙いに、"経験値/視認オーラ"という**別の理由**を追加できる（§3.1で提案）。

### 2.6 経験値・ベテラン化

- 🟢 (Sudden Strike) 経験値0〜1000のスケール。**被弾によるダメージが最速の経験値獲得手段**（生存が経験を生むのではなく、被弾＝リスクを取ることが経験を生む、というインセンティブ設計）。射撃・命中でも獲得するが速度は遅い。経験は次に装甲耐性・命中率・射程・視認へ反映。
- 🟢 (Blitzkrieg) キャンペーンをまたいで名前付き「コア部隊」が階級と経験を持ち越す——squad_tacticsのロスター永続・死の不可逆と同方向の設計哲学（Darkest Dungeon型ローグライクとの親和性はSquad Tactics側の独自発展）。
- 🔴 Panzer Strike自体がこの経験値モデルを採用しているかは未確認（技術デモの機能列に veterancy の記載なし）。

### 2.7 シナリオ/キャンペーン生成

- 🟢 (Sudden Strike/Blitzkrieg系譜) シナリオは「開始時に配布された部隊のみ」で戦う——資源採集・生産・研究が無く、プレイヤーの介入は配布された戦力の運用のみ。増援は脚本側が管理し、プレイヤーの裁量は小さい。
- 🟢 (Panzer Strike Steamページ) 「Non-linear missions」（ソロ）「40種類以上の兵器」「huge maps, thousands of units」。
- 🟡 マップ・戦力の手続き的バリエーション（プロシージャル生成）についての言及は無し。この世代のRTTは基本**ハンドクラフトされたシナリオ集**であり、squad_tacticsのようなラン毎ランダム生成の設計思想は無い（あるいは無いことが確認できていない、という意味で🔴でもある）。

---

## 3. squad_tactics への移植候補（優先度付き）

前提: North Star（RTwP＋伝達コスト＋分隊長体験、遮蔽最重要、8-12名の分隊規模、30hexビネット、1戦10-15分）と矛盾しないことを確認済み。全候補は既存のsim_core/sim_orders/sim_policy構想（North Star §7）またはnavigation/v1契約（HANDOFF_TO_FABLE5）への接続点を明示する。

### 🔴最優先 — NCOオーラ（経験値/視認ボーナス半径）

**出典**: Sudden Strikeの士官近接経験値ボーナス + 最長視認範囲（§2.5, §2.6）
**接続点**: North Star §3.4の伝達コスト表（「分隊長から2hex以内+LOS = 1秒」）は**そのまま流用可能な既存の距離基準**。同じ半径判定に、パッシブな「経験値獲得率+X%」「視認範囲+Yhex」を重ねるだけで、新規の距離計算コードを増やさずに実装できる。
**狙い**: 「分隊長の位置取り自体が戦術」（§3.4既定）を、伝達遅延という「防御的理由」だけでなく、**オーラという「攻めの理由」**でも強化する——分隊長を前に出すと部隊は強くなるが、伝達網は同じ理由で脆くなる（NCO死亡=全遅延×3）というジレンマが二重化する。
**粒度**: 数値1-2個（`SIM_TUNING`テーブルへの追加行のみ）。既存の指揮接続グラフ（battle_cloud.js流用）に相乗り可能。
**留意**: 「経験値」は現行v2で兵の成長軸として明確に存在する（§4.2 XP→SKILLS）ため接続は自然。ただし「被弾が最速のXP源」という Sudden Strike の設計はNorth Star §4.2「戦闘中HP回復なし」と組み合わせると危険（生き残れば強くなるが被弾を煽る設計は死の不可逆性と衝突しうる）——**採用するのは「NCO近接ボーナス」の部分のみ**とし、「被弾でXP増加」は移植しない（§4で後述）。

### 🟠高優先 — 建物内射撃スロットの向き制限（facing_deg の意味論強化）

**出典**: Sudden Strikeの「建物内歩兵は開口部の方向にしか射撃できない」（§2.4）
**接続点**: `HANDOFF_TO_FABLE5.md` §7 navigation JSON契約は既に `slots[].facing_deg` フィールドを持つ設計だが、現状は契約案の段階（§16「本書は次担当が実装する契約案であり、完成済み機能として扱わないこと」）。これは**設計変更ではなく、既存契約の意味論を一段具体化する提案**——「slotのfacing_degは見た目の演出値ではなく、AIのターゲティング・射線判定が読む正規データ」として運用する。
**狙い**: 建物防御時、防御側は正面（窓の方向）からは強いが側背面は素通しという非対称性が生まれ、North Star §3.2「殺傷ベクトル①側面/背面射撃」の設計意図（機動こそ殺傷力）と完全に一致する。建物という地形要素が、側面機動の価値をさらに具体的に体現する。
**粒度**: navigation/v1 のPhase 2（小型農家1件の縦切り実証）に自然に組み込める——別工程を増やさない。

### 🟠高優先 — 遮蔽の損壊連動（"隠れられる"は永続ではない）

**出典**: Sudden Strikeの「建物は歩兵を庇い被害を減らすが、建物・橋には耐久値があり破壊可能」+ Blitzkriegの「森は戦車・砲撃で平地化できる」（§2.4, Wikipedia）
**接続点**: `HANDOFF_TO_FABLE5.md` §10.1 破壊状態の同期契約（d0→d1→d2→destroyed で navigation state を同時切替）は既に存在する設計。ここに**戦闘ルール側のフック**を追加する提案: 遮蔽値（cover）自体を destruction state の関数にする。
**狙い**: North Star §3.2「遮蔽の重み」ドクトリン（遮蔽差の意味が薄れる変更は原則却下）と両立しつつ、「膠着を動かす手段」を追加する——迫撃砲・榴弾で遮蔽そのものを削るという、既に§3.2優先度2「手榴弾・迫撃砲=面制圧・遮蔽ごと排除」に明記された狙いを地形側の実装契約に橋渡しする。**新しいルールではなく、既存2つの決定（§3.2と§10.1）を接続するだけ**なので導入コストは低い。

### 🟡中優先 — 視界の「遅延更新」によるスポッティング演出

**出典**: Sudden Strikeのユニット移動時の視界ラグ（数秒）
**接続点**: sim_orders.js（命令遅延）と同じ「時間遅延キュー」の仕組みを、視認情報にも流用できる——新規サブシステムを作らずtickベースの遅延機構を再利用。
**狙い**: 「見えているのに即座に介入できない」体験（North Star §3.4三現主義）に、「そもそも見え始めるのに一瞬かかる」という視認側のもどかしさを加える。
**留意**: 実装複雑度と体感効果のバランスが不明。**spotting機構自体が未着手**（現状 hexのLOSは即時full-or-nothing）なので、spotting系統に着手する時にセットで検討する程度の優先度。単独では見送り可。

### 🟡中優先 — 士官/分隊長の「射界外」でも有効な経験値バフの明示ログ

**出典**: Sudden Strikeの士官ボーナスが車両搭乗中でも有効という設計
**接続点**: North Star §4.1「実装は必ず可視化する」ドクトリンに従い、NCOオーラが発火した際に吹き出し/ログで「〇〇分隊長の指導で経験値+」等を出す。
**狙い**: §3.1の数値実装に対する見える化の後付け。優先度は§3.1と一体化して扱ってよい。

### 🟢低優先（将来・車両支援ユニットが増えたら再検討） — 装甲の方向依存モデル

**出典**: Sudden Strikeの前面/側面/背面装甲差
**接続点**: 現状squad_tacticsは歩兵中心（8-12名分隊）で、対戦車砲・MG陣地程度が支援ユニットの想定。装甲の方向依存は「対物ユニット」が増えた時に効いてくる要素であり、今のスコープでは過剰実装になりうる。
**判断**: 保留。North Star §6保留表の「小隊規模指揮」「知略ダイヤル」と同様、**コア確立後に再審査**すべき候補としてマークするのみ。

---

## 4. 頂戴しないもの（理由付き）

| 要素 | 出典 | 頂戴しない理由 |
|---|---|---|
| 「基地建設なし・数千ユニット規模」の大規模RTS的スケール | Sudden Strike/Panzer Strike Steamページ("huge maps, thousands of units") | North Starが明示的に「1個分隊8-12名、30hexビネット、就寝前の1戦10-15分」という**対極の親密スケール**を確定済み（§1, §5, §10 Q1/Q3）。この系譜の「基地建設なし」自体は既にsquad_tacticsと共通しているが、そこから「大量物量」まで持ち込む理由はない。 |
| 被弾がXP最速獲得源という設計 | Sudden Strike経験値モデル（§2.6） | North Star §4.2「戦闘中HP回復は存在しない・無回復原則」と組み合わせると、「わざと被弾させてXPを稼ぐ」という自己破壊的なインセンティブがロスター愛着（P1)・死の不可逆性の重みと衝突する。NCOオーラは頂戴するが、被弾ボーナスの部分は明確に除外。 |
| 士気/抑圧の精緻な状態機械 | 系譜側は該当情報が見つからず | そもも移植元が存在しない（§2.3参照）。squad_tacticsの制圧ゲージ設計（0-100・suppressed/pinned・rout）は独自設計として継続するのが正しい——この系譜から「輸入」したと誤認しないよう明記。 |
| Blitzkriegの重量級マイクロマネジメント文化 | Wikipedia要約「huge micromanagement」 | North Star P3（テンポ）と§3.4三現主義（現場NCOが判断主体、プレイヤーは介入するが常時操作しない）に真っ向から反する。むしろsquad_tacticsのRTwP+AIポリシーは、この系譜の「常時マイクロ管理」への意図的なアンチテーゼとして位置付けるべき。 |
| ハンドクラフトシナリオ集としてのキャンペーン構造 | Sudden Strike/Blitzkriegキャンペーン様式 | squad_tacticsは既にローグライク的ラン生成（採用ドラフト・鹵獲系譜・変動源による毎ラン差異、North Star §5 P2）を確定済み。固定シナリオ集への回帰は裁定表で言う「棄却」方向と同義。 |
| 命令即時実行（遅延なし） | 系譜側の基本操作性（§2.5） | squad_tacticsの核（伝達コスト）そのものと正反対。ここは意図的にPanzer Strike系譜から**逆方向へ差別化**している部分であり、参考にすべきは「無いこと」の確認のみ。 |
| Sudden Strikeのスポッティング「バグ」（1秒LOS露出による間接射撃悪用） | ガイド記事に記載の既知の不具合 | 意図された設計ではなくエクスプロイト。悪用可能なバグをメカニクスとして取り込む理由はない。 |
| Platoon Leader (`data/pl_*`) 由来の詳細武器/弾薬シミュレーション（故障率・マガジン形状互換等）への追加投資 | §1.3 | 別ゲーム出典であり本タスクの対象外。North Star §4.3で「新規データ開発は凍結し活用に回る」と既に裁定済み——今回の調査を理由に手を広げない。 |

---

## 5. 出典一覧

### ローカル証拠（squad_tactics リポジトリ内、確認済みファイル）

- `scripts/ps_extract/ssc_format.py`, `ssc_probe.py`, `ssc_decode.py`, `ssc_driver_render.py`, `reference_extract.py`
- `tests/test_ps_ssc_format.py`
- `scratch/kb3d_study/ps_reference/`（33 PNG）, `scratch/kb3d_study/ps_atlas/`, `scratch/kb3d_study/ps_spl_list.txt`, `scratch/kb3d_study/s9_ps_palette_stats.py`
- `docs/HANDOFF_TO_FABLE5.md`, `docs/HANDOFF_TO_GPT.md`, `docs/WORLDVIEW_REGEN_DESIGN.md`, `docs/ART_BIBLE_URBAN.md`, `docs/MAP_SYSTEM_HANDOFF.md`, `docs/RENDER_UPGRADE_WORKLOG.md`
- `docs/NORTH_STAR.md`（設計正本、全裁定の基準として参照）
- `scripts/pl_decoded/analysis_summary.txt`（Platoon Leader出自の確認根拠）
- `data/ammo_field_analysis.md`（CBE.EXE/Platoon Leader系データの分析記録）

### 外部情報

- [Panzer Strike on Steam](https://store.steampowered.com/app/3305930/Panzer_Strike/)（本体ストアページ、機能列）
- [Panzer Strike Demo on Steam](https://store.steampowered.com/app/4787810/Panzer_Strike_Demo/)（ローカルインストールパスと一致するデモ版）
- [Panzer Strike by PanzerStrike - itch.io](https://panzerstrike.itch.io/panzer-strike)
- [Sudden Strike Maps: Panzer Strike RTS was announced](https://sudden-strike-maps.de/index.php/289-panzer-strike-rts-was-announced)（系譜・開発者背景の一次的な紹介記事）
- [Steam Community Guide: Understanding Sudden Strike - Mechanics, Tactics, and Strategy](https://steamcommunity.com/sharedfiles/filedetails/?id=2804282696)（Sudden Strikeのコミュニティ解説、経験値・視認・補給・地形の詳細出典）
- [Sudden Strike (video game) - Wikipedia](https://en.wikipedia.org/wiki/Sudden_Strike_(video_game))
- [Blitzkrieg (video game) - Wikipedia](https://en.wikipedia.org/wiki/Blitzkrieg_(video_game))
- 参考（未深掘り、将来の一次資料候補）: [nival/Blitzkrieg on GitHub](https://github.com/nival/Blitzkrieg)（Blitzkriegの公開ソースコード。本タスクでは未調査だが、数値・アルゴリズムレベルの裏取りが必要になった場合の最有力の一次資料）

### 未確認・要再検証の項目

- Panzer Strike開発チーム名（"ISAK Team"表記）は二次要約経由のみで、Steamストアページ本文からの直接確認は本調査では行っていない。
- Panzer Strike自体が士気・抑圧・スポッティング遅延・veterancyのいずれを実装済みか、または実装予定かは、公開されているストアページ機能列（40種類以上の兵器、ダメージ・装甲機構、ノンリニアミッション、建設要素なし)以上の情報が得られなかった。

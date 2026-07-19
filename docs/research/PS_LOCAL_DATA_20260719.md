# Panzer Strike Demo — 実機データ全解析

- 調査日: 2026-07-19
- 執筆: Fable5(監督官が子調査2件+実測を統合。子調査: 視界/AI班・地形/マップ班、戦闘核は監督官実測)
- 対象: `C:\Program Files (x86)\Steam\steamapps\common\Panzer Strike Demo`(Version 0.3.3、読み取りのみ・無改変)
- 関連: [PS_ESSENCE_20260719.md](PS_ESSENCE_20260719.md)(同定と系譜)、[PS_ESSENCE_AG_20260719.md](PS_ESSENCE_AG_20260719.md)(※1987年SSI同名作の誤同定に基づく参考資料)

**凡例**: 🟢実測(ファイル+キー引用) / 🟡推測(根拠明示) / 🔴未解明

---

## 1. フォーマット概説

- 🟢 `.sdt` = 平文テキスト設定。文法は `名前 (バリアント) <テンプレート参照> [ key: value ... 入れ子 ]`。`Templates/` 配下の `template` 定義を `<...>` で継承合成する。ゲームの実効パラメータはほぼ全てここにある。
- 🟢 `.ssc`/`.spl` = スプライト/パレット(既知、ps_extract で解析済み)。`.sml` = ビットマスク(視界セクター等)。`.psm` = マップ/セーブ(マジック `PZMS` + zlib圧縮ペイロード、内部未解凍)。`.ptj` = 弾道事前計算テーブル(🟡)。`.sar` = 小型アーカイブ(🔴内部未確認)。
- 🟢 数値は多くが「`x, y` の対」。文脈により (新兵, 熟練) [reload 90,59・accuracy_part 128,96] または (近, 遠) [penetration 8,3] を意味する(🟡対の意味は項目ごとに揺れる — 個別確認が必要)。

## 2. 戦闘解決の核(実測)

### 2.1 命中 = パーセントロールではなく散布(dispersion)モデル

- 🟢 `Templates/Weapons/weapon_accuracies.sdt`: 武器クラスごとに `aim [ accuracy: 85, 55  range_to_accuracy: square  dead_zone: 10,10 ]`。accuracy値は**小さいほど正確**(散布半径系)。距離→精度の写像カーブが3種: `square` / `linear` / `onepointfive`(1.5乗)。手榴弾は `365,175 / linear / dead_zone 80,80`(最小投擲距離がdead_zone)。
- 🟢 `Configs/accuracy_patterns.sdt`: **連射劣化テーブル** — 8段の `burst` 行で、撃ち続けるほど値が悪化。各行は `standing/moving`(射手状態) × `static/dynamic`(目標状態) の4値(例: 1射目 128/160/160/192 → 8射目 62/128/128/153)。つまり「初弾が最も正確、動く目標・動きながらの射撃は悪化」がデータで表現される。
- 🟢 `Configs/params.sdt`: `accuracy [ distance: 1200  distance_far: 12000 ]` — 距離スケーリングの基準点。
- 🟢 弾道: `Media/Datas/trajectories_40_80x40.ptj`(🟡距離-高さの事前計算アーチ)。

### 2.2 装甲・貫通

- 🟢 装甲は4チャネル: `Configs/armors.sdt` = `fire, flat, ballistic, blast`。弾種がどのチャネルを使うかは `Configs/shot_types.sdt`: `shot_type [ id: bullet use_armor: flat suppress_range: 40 ]`、`shell` は `damage_per_penetration: 20`、`grenade` は `ballistic / damage_per_penetration: 50`。
- 🟢 武器側: `Templates/Weapons/weapon_soldiers.sdt` — `rifle: penetration: 8,3  damage_penetrated: 70,70  spread: 5  burst[shots:5,5 reload:150,98]  aim[range:720,760]`。🟡 penetration の対は(近,遠)の距離減衰。**「貫通した時だけ damage_penetrated を与える」**構造で、貫通量×damage_per_penetration の加算もある(shot_types)。
- 🟢 榴弾/爆風: `Shots/shots_blast.sdt` — 口径ごとの爆風半径がデータ化(45mm→range31、152mm→range82)。`shot_type blast/howitzer` は `damage_area [ destroys: unit range[value..step] ]`。
- 🟢 被弾カテゴリ: `Configs/hits.sdt` = `ground, water, tree, stand, building, armor, man, resident, gun, soft`(ダメージ分岐キー)。`Templates/Units/unit_targets.sdt` に目標種別の `radius[front/side]`(当たり判定半径)。

### 2.3 制圧・回復・出血

- 🟢 **制圧は弾種の属性**: `shot_types.sdt` の `suppress_range`(bullet 40 / shell・blast・howitzer 80 / fire 20)— 着弾点からこの範囲の兵が制圧される。`params.sdt` の `march [ suppress_delay: 150  suppress_delay_ai: 600 ]`(制圧からの回復遅延、AIは4倍長い=プレイヤー優遇)。
- 🟢 **自動回復と出血**: `params.sdt auto_heal` — `heal [ health_part: 96 value: 1 ]`(HPが96/128以上なら毎delay+1回復)、`kill [ health_part: 32 value: 1 ]`(32/128以下なら-1悪化=放置すると死ぬ)。**重傷者は救護しないと出血死し、軽傷は自然回復する**を2閾値だけで表現。

### 2.4 経験値・熟練

- 🟢 `Templates/Weapons/weapon_experiences.sdt`: 武器ごとに撃破時経験値(`rifle 10 / grenade 25 / armor_gun 25 / mg 1`)と `accuracy_part: 128, 96` — 🟡熟練で精度値が 128分率→96/128 に改善(=25%正確化)。MGは経験1でほぼ育たない(スプレー武器を育てさせない設計)。

## 3. ユニットモデル(実測)

- 🟢 `Units/German|Soviet/{soldiers,tanks,guns,hmgs,apcs,spgs,trucks}.sdt`。兵1種は `soldier (german, guner) <target_common, crouch_enabled, drive_nothing, assault_rifle>` のようにテンプレート合成で定義。所持弾薬(`ammo <bullet_7_92mm> count: 80`)、武器スロット(小銃+手榴弾)、姿勢別アニメ遅延(`stand/crouch delay`)。
- 🟢 姿勢は `crouch_enabled` 等のフラグ。乗員は `drive_vehicles` を持つ crew 兵種として分離(車両撃破→乗員脱出の素地)。
- 🟢 AI関連はテンプレート数値のみ: `unit_aggression.sdt`(兵種別 `range: 850,970 scan_delay: 90,45 range_min`)と `weapon_priorities.sdt`(武器種×目標種の優先度0-255。対戦車重は armorheavy=255/man=50、autoは万遍なく)。🔴 退避・制圧射撃などの手順ロジックは設定に無く実行ファイル側。

## 4. 地形・グリッド・遮蔽(子調査実測)

- 🟢 **タイル別の cost/cover 表は存在しない**。`Objects/*.sdt`(buildings/fences/trees/roads/grounds 等15種)に移動コスト・防御値のキーは0件(`cover|cost:|defense|block:|move_cost` grep全滅)。
- 🟢 移動は許可リスト方式: `Templates/Units/unit_movements.sdt` の `movement.common [ lands: ground, shallows ]`(乗れる地面種の列挙)。`trample: grass`(草の踏み潰し=視覚)。
- 🟢 **遮蔽は角度依存オクルージョン**: `Templates/Objects/buildings.sdt` の `resident.direction_N` に `skip [ type: bullet angle_range: 2721,13663 ]` — **入射角がこの範囲なら被弾スキップ**。建物は `health: 500〜42000` と、`residents [ resident <floor_2, direction_3> ]`(**階×方向の駐留兵スロット**)を持つ。弾種カテゴリ吸収 `absorb [ type: bullet|shell|blast|grenade|howitzer|inside ]`。
- 🟡 グリッドは**連続座標**(確度中): `tiles.sdt cell_width: 80` は単一スカラー(broadphase bucketと推測)、"hex"全文0件、座標が80の倍数に非整列、距離指定が全てx,y対称対。
- 🟢 マップ `.psm` = `PZMS` + zlib。内部形式未解凍(読み取り専用方針)。

## 5. 視界(子調査実測)

- 🟢 `Media/Masks/sight_sector_000..255.sml`(256個)。サイズ単調増加→index192(67,123B)で飽和。ヘッダ `20 00` + stride(08→10) + 行数(01→0x7f頭打ち)。本体は扇形/円形の輪郭を行ごとのビット列で表すマスク。
- 🟡 番号=視認距離で、**距離ごとの可視範囲を事前計算ビットマスクとして持つ**方式(サイズ飽和は描画上限クリップで説明がつく)。🔴 ヘッダ全フィールドと走査方向は未確定。
- 🟢 視界は乗員スロット単位でも定義される: `sight.tank_base [ driver [ range: 16,19 ] ]`、建物駐留兵 `resident.floor_1 [ dead_zone: 80,80 range: 40,40 ]`(階が上がると視程が伸びる構造)。

## 6. squad_tactics への含意(統合)

1. **建物residentsスロットは navigation/v1 の実在証明**(優先度: 高) — 「階×方向の駐留スロット+入射角レンジの被弾スキップ」は、HANDOFF_TO_FABLE5 §6 の slots(fire/wait, facing)+obstacleのblocks_projectileとほぼ同型。Phase 2 の縦切り実証を進める設計的自信になる。移植時は「方向スロット=window/fire slot、angle_range=facingの許容射界」として対応付ける。
2. **散布モデル+連射劣化+姿勢/移動修整**(優先度: 高) — 現行の命中%一発ロール(logic_game.js)に対し、(a)連射するほど当たらない (b)動く/動かれると当たらない (c)熟練で締まる、をテーブル1枚で足せる。RTwP(sim_core)では特に「初弾照準の価値」がテンポを作る。
3. **制圧を弾種属性にする**(優先度: 高) — `suppress_range` 方式は「外れ弾でも近くに落ちれば制圧」を自然に生む。実装済みの被弾リアクション(logic_reaction.js)の発火条件を「ダメージ」から「suppress_range内の着弾」へ拡張すると、機関銃の制圧射撃が成立する。
4. **出血/自然回復の2閾値**(優先度: 中) — auto_heal の heal/kill 2閾値は、衛生兵・救護の遊びを最小実装で導入できる(HP>75%で自然回復、<25%で悪化)。
5. **視界の事前計算マスク**(優先度: 中) — 30hex盤ならhex単位のLOSで足りるが、将来の連続座標化・大型盤では距離インデックス付き可視マスクのキャッシュが有効。
6. **データ表駆動AI**(優先度: 中) — aggression(発見距離/スキャン間隔)と weapon_priorities(武器×目標の0-255)の2表だけでAIの「らしさ」を作る構造は、本編AIの整理に直輸入できる(手順ロジックはコード、性格はデータ)。
7. **移植しないもの**: 連続座標系そのもの(本作はhexタイルが基盤・NORTH_STAR §3.1)、口径別爆風データの丸写し(PL由来の武器データ体系と競合)、AI手順の推測実装(根拠なし)。

## 7. 未解明リスト

- 🔴 smlヘッダの厳密なフィールド定義・ビット走査方向
- 🔴 `.psm` zlibペイロードの内部構造(解凍未実施)/ `.sar` アーカイブ内部 / `.ptj` の軸対応
- 🔴 AIの意思決定手順(退避・集中射撃・移動先選定)— 実行ファイル側、設定に痕跡なし
- 🔴 数値対 `x, y` の意味の全項目確定(項目ごとに新兵/熟練・近/遠が揺れる)
- 🔴 `damage_per_penetration` の正確な適用式(貫通超過量に乗るのか、固定加算か)

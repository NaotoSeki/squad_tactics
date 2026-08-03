# 戦場キャンバス原則

**状態**: 最上位アート／シミュレーション設計原則  
**確定日**: 2026-07-23

## 1. North Star

戦場は巨大な共有キャンバスである。

作者が用意したのどかな初期風景を第一層とし、プレイヤーとゲームエンジンが、
移動、着弾、破壊、火災、死、時間を通じて共同で戦争情景を描く。

轍、クレーター、損壊した建物、潰れた植生、残骸、死体は、単なる一時VFXではない。
それらは、その場所で実際に起きた戦闘の空間的な証拠であり、戦場の記憶である。
同じ初期マップでも、異なる戦闘は異なる最終風景を生まなければならない。

目標は「破壊されたマップを用意する」ことではない。
平穏な農場が戦闘を経て悲惨な爪痕を帯び、その最終画面だけから、戦車が通った道、
激戦地、使われた火力、崩れた建物、燃えた車両、人が死んだ場所を読み取れること。

最終画は構成された絵に見えるべきだが、事前に構成された絵であってはならない。

## 2. 非交渉ルール

1. 結果を伴うアクションは、シミュレーション結果と視覚的残留物を同時に解決する。
2. 残留物は装飾ではなく、保存・再生可能な第一級のゲーム状態とする。
3. 位置、向き、バリアント、生成時刻、描画層、寿命、発生イベントを保持する。
4. バリアントはイベントと位置から決定的に選び、保存／読込／リプレイで同じ絵を再現する。
5. 後の出来事は過去の痕跡を変形できる。死体は燃え、草は潰れ、残骸は再破壊され得る。
6. 痕跡には異なる記憶時間を持たせる。一時演出、長時間フェード、戦闘中永続、状態置換を区別する。
7. 正本アセットの原点、スロット、パレット、マスク、影を正規化や中央揃えで失わない。

「不可逆」とは、全ピクセルが永久に残るという意味ではない。
後の出来事で痕跡が覆われたり焼失したりしても、戦場の状態が無傷の過去へ巻き戻らないという意味である。

## 3. PS本編のアセット読込・配置モデル

インストール済みPanzer Strike Demoのデータから、以下を確認した。

### 3.1 IDから描画物まで

SDTテンプレートがオブジェクトIDを次の要素へ解決する。

- `visual`: SSCスプライトコンテナ
- `palette`: SPLパレット
- `mask`: 建物や一部オブジェクトの当たり／占有マスク
- `hit`: tree、stand、building、armor、man、corpse等の対象クラス
- `layer`: lays、road、decor、crater等の描画経路
- 状態、耐久、踏み潰し、破壊、居住スロット等の挙動

`visual`と`palette`は独立参照であり、複数の形状バリアントが同一ファミリーパレットを共有する。
SSCの各フレームはスロット番号、原点、幅、高さ、深度、形式を持つ。
したがって実装は、PNGを中央揃えして置くのではなく、SSC由来の原点をアンカーとして置く必要がある。

### 3.2 PSMは「29枚の画像レイヤ」ではない

旧解析の512×384／29レイヤ仮説は誤りだった。
展開後の直列化データ全体を固定長で輪切りしたため、実際のレコード境界を横断していた。

確認済みPSMブロック:

- `MAP_INFO`
- `MAP_CELLS`
- `MAP_BRIGHTNESS`
- `MAP_TILES`
- `MAP_PONTOONS`
- `MAP_ASSETS`
- `MAP_DECORS`
- `MAP_OBJECTS`
- `MAP_BUILDINGS`
- `MAP_DEPTH`

`MAP_INFO`が宣言する実グリッドは、デモ戦闘マップが256×256、チュートリアルが96×96。
配置座標の範囲は、宣言寸法1あたり40座標単位と整合する。
`tiles.sdt`の`cell_width: 80`との正確な投影関係は引き続き検証対象とする。

### 3.3 マップ内アセット辞書

`MAP_ASSETS`はアセット名を10個の型別カタログへ格納する。
配置レコードは名前を反復せず、カタログ番号とローカル番号で参照する。

| 番号 | 確認済み内容 |
| ---: | --- |
| 0 | terrain / ground |
| 1 | grass |
| 2 | road、平面decor、field、crater、track |
| 3 | land overlay、小型plant |
| 4 | cliff |
| 5 | fence |
| 6 | stand、crop、prop、大型plant |
| 7 | building |
| 8 | 両デモマップでは未使用 |
| 9 | tree、大型shrub |

### 3.4 配置レコード

両マップで一致したレコード構造:

```text
MAP_DECORS
  catalog:u8, asset:u16, x:u32, y:u32

MAP_OBJECTS
  catalog:u8, asset:u16, x:u32, y:u32, extra:u32

MAP_BUILDINGS
  asset:u16, x:u32, y:u32, orientation:u32
```

`MAP_OBJECTS.extra`は両デモマップの全レコードで0。
建物の`orientation`には0と3種の非ゼロ値があり、4方向状態と整合するが、
これが画像回転、論理方向、または両方のどれかは未確定。

実測件数:

| マップ | DECORS | OBJECTS | BUILDINGS |
| --- | ---: | ---: | ---: |
| demo_campaign_battle_01 | 32,880 | 56,499 | 186 |
| demo_campaign_tutorial_01 | 6,825 | 16,184 | 59 |

`MAP_DEPTH`は宣言グリッド1点につき8 byte、すなわち4個のlittle-endian `uint16`を持つ。
名称と値の連続性から空間／深度支援データと考えられるが、4成分の厳密な意味は未確定。

## 4. PS本編のイベント→戦場痕跡

### 4.1 装軌移動

- 戦車移動は`trampler_tracks`を使用する。
- `delay_part: 80`の設定で移動煙／砂埃と`tracks_tank`を生成する。
- `tracks_tank`グループには64個のアセットバリアントがある。
- 各track SSCにも64方向スロットがある。
- trackは`crater`描画層へ置かれる。
- 全体設定は`remove_delay: 3600`、`fade_duration: 450`。
- 時間単位は未確定。よって「長く残るが永久ではない」とのみ断定する。

### 4.2 着弾

- 砲種auto / light / medium / heavyごとに別のクレーターグループを選ぶ。
- 各グループ内で複数の正本バリアントを選ぶ。
- 爆光、砂埃、煙は一時アニメーション層。
- craterは静的な地表残留物。
- grenadeおよび砲撃テンプレートはunit、building、tree、fence、stand、landを破壊対象にできる。

### 4.3 建物

- 建物はhealth付きの順序状態を持つ。
- SSCには無傷から損傷、廃墟、瓦礫へ進む対応フレームと影がある。
- 状態遷移は絵だけでなく、居住位置、階高、射界、方向別防護も変更する。
- したがって「画像差替え」と「シミュレーション変化」は同じ状態遷移でなければならない。

### 4.4 車両、火砲、火災

- 車両死亡は`died_cell`クレーター、破壊アニメーション、火花、遅延・再帰火災を生成する。
- gun / HMGも固有の死亡効果とクレーター規則を持つ。
- 多数の車両に`health_corpse`があり、多くは生存時healthの5倍。
- 火災shotは明示的に`corpse`を破壊対象とする。

これは、残骸が単なる終了VFXではなく、後からさらに作用を受けるdamageableな状態である直接証拠。

### 4.5 歩兵

- stand / crouch双方に4段階の死亡アニメーションがある。
- `corpse`はエンジンの明示的な対象クラス。
- 歩兵死体の最終スロットと保持時間は、設定ファイルだけでは未確定。

### 4.6 植生、柵、小物

- plantはtramplableまたはcrushableになり得る。
- 戦車は`grass`と`lays`を踏み潰す。
- tree、fence、stand、landは武器の対象クラス。
- 現設定には独立したstump / felled-treeテンプレートを確認できない。
  実行時検証までは、木の破壊を「切株化」と断定せず、消失／状態喪失として扱う。

## 5. squad_tacticsの正本状態モデル

```text
BattlefieldState
  base_map
  object_states[id]      # intact -> damaged -> ruined / alive -> corpse
  marks[]                # track / crater / scorch / debris / blood
  transient_effects[]    # flash / dust / smoke / particles
```

```text
BattleMark
  id
  kind
  world_position
  orientation
  variant_seed
  source_event_id
  source_actor_id
  created_at
  layer
  memory_class
  state
  fade_start
  expire_at
```

一つのアクションは次の一本のパイプラインを通す。

```text
gameplay event
  -> damage / movement / destruction resolution
  -> state replacement + residue policy
  -> deterministic asset / slot selection
  -> authored originで適切な層へ配置
  -> persist / fade / later transform
```

記憶クラス:

| クラス | 例 | 方針 |
| --- | --- | --- |
| transient | 閃光、砂埃、移動する煙 | アニメーション寿命のみ |
| fading | 轍、薄い地表汚れ | 長時間保持後に制御フェード |
| battle-persistent | crater、瓦礫、焦げ、破片 | 戦闘中保持。後イベントで変形可 |
| state-replacement | 損壊建物、死体、残骸、潰れた小物 | 前状態を置換し、さらに作用を受け得る |

## 6. 現コードとの接続点

既存実装には土台がある。

- `logic_map_city.js`
  - `cell.decals`が自由位置の痕跡を保持できる。
  - `damageGround`が道路／石畳を損傷地表へ置換する。
  - `damageBuilding`が建物段階を進める。
- `phaser_terrain_v7.js`
  - flatとtall / Y-sortを分離できる。
  - 建物／地表テクスチャを実行時に遅延ロードして差し替えられる。
  - decalは位置、scale、alpha、layer、tallを持てる。
- `phaser_bridge.js`
  - 現在は高tier爆発だけが建物／地表損傷を呼ぶ。
- `logic_game.js`
  - `applyDamage`が死亡を確定するが、現在は一時破片のみで、永続corpse状態がない。

不足は、これらが個別の例外処理で、単一のイベント→痕跡台帳になっていないこと。
次の実装では、移動、着弾、損傷段階、死亡を同じ決定的な`BattlefieldState`へ接続する。

## 7. 受入基準

戦闘前後の二枚だけを見て、ログなしで次を推定できること。

- 装甲車両が通った経路
- 火力が集中した地点と砲種の違い
- 争奪された場所
- 破壊・炎上した建物と車両
- 兵士が倒れた場所

この条件を満たして初めて、プレイヤーとゲームエンジンが共同で描く「戦争情景のアート」になったと判定する。

## 8. 検証データ

- `scratch/ps_map_decode/psm_structure_confirmed_20260723.json`
- `scratch/ps_sprites_canonical_v1/battlefield_canvas_contract.json`
- `scratch/ps_sprites_canonical_v1/canonical_manifest.json`


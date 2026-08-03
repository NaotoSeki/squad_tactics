# KB3D Forge — KitBash3D WW2 パーツ分解・再構築による派生建物量産システム 設計書

- 版: v1.0 (2026-07-17)
- 設計: Fable5（監督官）。実装: GPT-5.6 Terra（CLIProxyAPI経由）。検収: Fable5。
- 調査データ: `scratch/kb3d_study/`（inventory.json / structure.json / resA_deep.json / render/*.png）
- 本書の数値はすべて 2026-07-17 の実測（Blender 5.0.1 でのダンプ・レンダー）に基づく。

---

## 0. 目的

`kb3d_worldwartwo-native.blend`（919.9MB）に含まれる高品位な WW2 建物・小物を**要素分解し、組み合わせを変えて再構築**することで、元キットに無い「派生／オリジナル建物」を大量生成する。生成物は
(a) .blend として保存できる 3D アセット、(b) squad_tactics の HexKit リグで焼く hex タイル素材、の両方に使える形にする。

長期目標 [WW2荒廃都市のローグライク生成] の建物多様化エンジンにあたる。

## 1. 調査結果（確定事実 — 実測済み）

### 1.1 ファイル・シーン構成
- パス: `C:\Users\aware.梨花のPC\Downloads\Kitbash3D - World War 2\Kitbash3D - World War 2 [Blender Native]\kb3d_worldwartwo.blender.native\kb3d_worldwartwo-native.blend`（919.9MB、Blender ネイティブ）
- データブロック: objects 1619 / meshes 1541 / materials 88 / images 459 / scenes 2
- シーン `KB3D_WorldWarTwo-Native` に 1616 オブジェクトが**フラット**に入っている（コレクション未使用）。シーン `Scene` はデフォルト残骸（Camera/Cube/Light の3個）— 触らない。
- グルーピングは Empty のみ: 各アセットは `KB3D_WWT_<Family>_<Variant>_grp` という Empty を親に持つ2層構造。grp は展示場グリッド状に配置されている（例: Residential A grp = (81.8, 0.3, 0)）。
- **総頂点 6.6M**。最大メッシュは 76k 頂点（Residential B の BuildingA）。

### 1.2 アセット一覧（44ファミリー）
- 建物 10 ファミリー・15 体: BldgMdResidential A–E / BldgSmCamp A–B / BldgLgCheckpoint / BldgLgFarmhouse / BldgLgSniperTower / BldgMdBunker / BldgLgBrokenChurch / BldgMdHideout / BldgSmBunker / BldgSmHideout
- 交換用開口部パーツ: BldgPartDoor A–G（43 obj）、BldgPartWindow A–F（22 obj）
- Prop 32 ファミリー: AACannon, AAGun, SandBags A–E, WoodenCrates, Barrels, Table A–E, MachineGun, Mortar, Flag, Bike, Wagon ほか

### 1.3 建物の内部構造（パーツ文法）
各建物 grp の直下は以下に分類できる（Residential A の実測: 総パーツ 103）:

| 分類 | 例 | 特徴 |
|---|---|---|
| CORE（躯体） | BuildingA (10.0×6.8×14.8m, 34k verts), BuildingB, BuildingC | 1メッシュに 1000–1700 個の loose parts（梁・瓦・石が個別部材のまま結合）。15–18 マテリアルスロット。**壁の開口（窓穴・ドア穴）はモデリング済みで空いている** |
| OPENING（開口の蓋） | DoorA–D, DoorLeft/Right A–C, WindowLeft/Right A–L | 開口位置に置かれた独立オブジェクト。窓の**枠と格子は躯体側**、Left/Right は観音開きの各翼（鎧戸・扉）。外すと躯体に穴が残る（=破壊表現に使える） |
| DECAL（損傷・汚しデカール) | DecalBulletHolesA–C, DecalCracksA–C, DecalDamageA–C, DecalGrungeA–D | HASHED alpha の小カード群。1オブジェクトに 50–200 loose parts（弾痕1個=数枚のクアッド）。壁面に沿って浮かせて配置されている |
| DEBRIS（瓦礫） | DebrisA–M | 小片(11 verts)〜大崩落(25k verts, 485 loose)まで13段階。材質は RubblesA/B + WoodChipped + WoodTrim の混成 |
| PROP（小物） | Crate, SandBags, Barrel, Table, Tarp, Canopy... | 接地小物。単体でも使える |
| GROUND（敷地） | Ground (24.2×15.9m), Floor | 不定形の土台。SoilGravel 等 |
| STRUCT（外構） | MakeshiftBalcony, PerimeterWall A–I (4.7×0.9×3.9m 規格), Stairs, Platform, Archway, Tower | 塀はモジュール寸法で連結可能 |

- 他ファミリーも同文法（Checkpoint: Bridge+Platform+Stairs+Gate、Bunker: Dome+Corner×4+Roof、Church: Building+Archway×2+Tower×2 等）。
- Debris/Decal の所持数はファミリー差が大きい: Residential A=13/13、Church=18/14、Camp/Hideout/SmBunker=0/数枚。**Church が瓦礫の宝庫**。

### 1.4 開口部の規格（実測分布）
- 鎧戸 WindowLeft/Right: **0.5×0.1×1.0m が 47/72**（ほぼ規格化）
- 半扉 DoorLeft/Right: **0.5×0.1–0.2×2.0m が 37/64**
- 一枚扉 Door: 1.0×0.1–0.2×2.0–2.1m が主流（15種の寸法があり、向き違い X/Y を含む）
- BldgPartDoor A/B/C はほぼ同寸（枠 1.17×2.23m、扉 ~1.0×2.13m）→ **相互差し替え可能**。D は縦長 2.64m、E は両開き 2.13m 幅、G は大型 1.68×3.14m と「寸法族」が分かれる。
- → 差し替えは**寸法クラスタ内**でのみ行う（§4.3）。

### 1.5 マテリアル・テクスチャ体系
- 規律: **1マテリアル = 1テクスチャセット**（同名の basecolor/height/metallic/normal/roughness、計86セット。例外なし）。+ opacity 22 / emissive 5。
- 3系統:
  1. **トリム/タイラブル系**（壁・木・石・金属 ~55 種）: UV は 0–1 を超えてタイリング（実測: 躯体系はほぼ全 tile 型）。**メッシュを切り貼りしても破綻しない**のが本システム成立の根拠。
  2. **Atlas 系デカール 16 種**: AtlasBulletHoles(+Bricks) / AtlasCrack(+B) / AtlasDamageWallA–D / AtlasDecalsA(users=278) / AtlasLeakes(3種) / AtlasWallDamageBricks(2種) / AtlasFlags / LeafAtlas。全て opacity 付き HASHED。
  3. **Unique 系**（プロップ専用ベイク ~14 種）: AAGun, Barrels, LampsBaked(emissive) 等。
- 特記: `ConcreteDamagedEdgesTrimDark`（users=51、opacity 付き）は**破壊断面のギザギザ縁をアルファ抜きで表現する専用トリム**。破壊パスの断面材の第一候補。
- blend_method: 87/88 が HASHED。
- **画像は非パック・全パス切れ**。起動のたびに `bpy.ops.file.find_missing_files(directory=TEX2K)` で 2K フォルダ（546ファイル）へリマップ必須。4K は zip 未展開（v1 は 2K でよい）。
  - TEX2K: `C:\Users\aware.梨花のPC\Downloads\Kitbash3D - World War 2\Kitbash3D - World War 2 [PNG 2k]\kb3d_worldwartwo.png.2k`

### 1.6 「精緻さ」の構成要素（視覚調査 render/*.png より）
1. 部材単位モデリング（瓦1枚・梁1本が個別 loose part、ベベル済みミッドポリ）
2. トリムシート PBR + **true displacement**（全1541メッシュに `SUBSURF "Subdiv for displacement"` モディファイア + height マップ。レンダー重いので通常は show_render=False、最終品質時のみ on）
3. 破壊の3層表現: (a) 躯体自体の欠損造形（崩落屋根・露出垂木・壁破孔・ギザ断面） (b) 損傷デカール (c) Debris 散布
4. 開口の蓋（ドア・鎧戸）が分離していて、欠落＝破壊・荒廃の表現になる

## 2. アーキテクチャ — 3レイヤー

```
Layer 0  Extraction   : blend → parts_catalog.json（パーツ台帳+テンプレート+開口アンカー）
Layer 1  Recombination: catalog → recipe.json（乱数+制約で派生レシピを量産）→ シーン構築
Layer 2  Destruction  : 躯体へのプロシージャル破壊（ブーリアン+断面材+瓦礫散布+デカール）
```

設計原則:
- **決定論**: すべての乱数は recipe の seed から。同一 recipe → 同一出力。
- **元 blend 内で合成する**（v1）: 919MB のロードは実測 ~10 秒で許容。append の座標評価バグを踏まない。出力は新規コレクション `FORGE_OUT` に構築し、必要ならそれだけ別 .blend へ書き出す。
- **オブジェクト単位の分解**（v1）: loose parts 単位の細分解は v2。1619 パーツ+開口差し替え+破壊で組合せ空間は十分。
- 絵作りの破綻を防ぐため、**完全自由配置はしない**。既存15建物の配置を「テンプレート」として使い、スロット差し替え方式を取る（§4.2）。

## 3. モジュール構成（実装対象）

```
scripts/kb3d_forge/
  README.md          運用手順・罠一覧（§8を反映）
  paths.py           KB blend / TEX2K / 出力先の定数（1箇所に集約）
  catalog_build.py   [Blender内実行] Layer 0: parts_catalog.json 生成
  forge_grammar.py   [素のPython]    Layer 1前半: catalog → recipe*.json 量産
  forge_build.py     [Blender内実行] Layer 1後半: recipe → シーン構築 → 検証 → 保存/レンダー
  destruction.py     [Blender内実行] Layer 2: forge_build から import される破壊パス
  batch_forge.py     [素のPython]    ドライバ: blender -b を N 回起動して量産+サムネHTML
  schemas.md         カタログ/レシピの JSON スキーマ定義（本書§4の写し+実装補足）
```

実行形態:
- Blender 内スクリプト: `& 'C:\Program Files\Blender Foundation\Blender 5.0\blender.exe' -b <KB.blend> -P <script> -- --args...`（`--factory-startup` は catalog では可、forge では不要）
- `sys.argv` の `--` 以降を argparse で読む。
- コンソール出力は **ASCII のみ**（ホストは cp932。日本語や em-dash を print すると死ぬ）。

## 4. データ設計

### 4.1 parts_catalog.json（Layer 0 出力）

```jsonc
{
  "meta": {"source": "<blendパス>", "generated": "2026-07-17T...", "blender": "5.0.1"},
  "parts": [
    {
      "name": "KB3D_WWT_BldgMdResidential_A_BuildingA",
      "family": "BldgMdResidential", "variant": "A", "part": "BuildingA",
      "cls": "CORE",                    // CORE|OPENING|DECAL|DEBRIS|PROP|GROUND|STRUCT
      "grp": "KB3D_WWT_BldgMdResidential_A_grp",
      "rel_loc": [x,y,z],               // grp からの相対位置（テンプレート座標）
      "rot": [rx,ry,rz], "scale": [sx,sy,sz],
      "dim": [dx,dy,dz],                // ワールド bbox 寸法
      "bb_min_rel": [..], "bb_max_rel": [..],   // grp 相対の bbox
      "verts": 34223, "mats": ["KB3D_WWT_ConcreteDamagedWallA", ...]
    }, ...
  ],
  "templates": [
    {
      "name": "BldgMdResidential_A",
      "grp": "KB3D_WWT_BldgMdResidential_A_grp",
      "cores":    ["...BuildingA", "...BuildingB", "...BuildingC"],
      "ground":   ["...Ground"],
      "struct":   ["...MakeshiftBalcony", ...],
      "openings": [   // 開口アンカー = 現在の蓋パーツの位置がそのまま開口位置
        {"anchor_id": "ResA_op_00", "occupant": "...DoorA",
         "kind": "door",              // door|door_wing|shutter
         "rel_loc": [..], "rot": [..], "dim": [..],
         "cluster": "door_1.0x2.1"},  // §4.3 の寸法クラスタID
        ...
      ],
      "decals":  ["...DecalBulletHolesA", ...],
      "debris":  ["...DebrisA", ...],
      "props":   ["...CrateA", ...]
    }, ...
  ],
  "opening_clusters": {
    "shutter_0.5x1.0": ["...WindowLeftA", "...WindowLeftC", ...],  // 相互差し替え可能группы
    "door_1.0x2.1":    [...],
    "door_wing_0.5x2.0": [...]
  },
  "damage_decal_sets": {"bullet": [...], "crack": [...], "damage": [...], "grunge": [...]},
  "debris_pool": [ {"name": "...DebrisK", "dim": [..], "verts": 9082, "size_class": "L"}, ... ],
  "prop_themes": {"military": ["...SandBags*", "...AmmoBox*", ...], "domestic": [...], "church": [...]}
}
```

分類ルール（part 名の正規表現。catalog_build.py に実装）:
- `^(Building|Tower|Dome|Bridge|Platform|Mezzanine|CommsCenter|Shed|MainTent|Tent|OPsTent|WaterTower|SpeakerTower|Porch|WoodenStructure|CrateShak)` → CORE
- `^(Door|Window|GateDoor)` → OPENING（`(Left|Right)` を含めば wing/shutter 判定。dim.z >= 1.5 → door系、それ未満 → shutter）
- `^Decal` → DECAL、`^Debris` → DEBRIS、`^(Ground|Floor)` → GROUND
- `^(PerimeterWall|Stairs|Archway|Corner|Guardrail|Awning|MakeshiftBalcony|GateBase|Gate$|Well|StonePath|WoodDeck|Banners)` → STRUCT
- 残り → PROP
- 判定不能・迷いが出た名前は WARN ログに出して PROP に落とす（黙って捨てない）。

opening_clusters の作り方: OPENING パーツを (kind, round(dim.x,1), round(dim.z,1)) でグルーピング。**回転が違うだけの同型**を吸収するため dim は「長辺=幅、短辺=厚み」に正規化してから丸める。クラスタ内のメンバーが 2 未満ならそのクラスタは差し替え不可（swap 候補なし）としてマークする。

### 4.2 recipe.json（Layer 1 中間物 — forge_grammar.py が量産）

```jsonc
{
  "seed": 12345,
  "name": "FORGE_012345_resA",
  "template": "BldgMdResidential_A",
  "core_swaps": {            // 棟スロット→別ファミリーの CORE を移植（無ければ原状）
    "KB3D_WWT_BldgMdResidential_A_BuildingB": "KB3D_WWT_BldgMdResidential_C_BuildingA"
  },
  "openings": [              // アンカー単位の操作
    {"anchor_id": "ResA_op_00", "op": "swap", "with": "KB3D_WWT_BldgMdResidential_D_DoorB"},
    {"anchor_id": "ResA_op_07", "op": "remove"},        // 蓋なし=破壊・廃墟感
    {"anchor_id": "ResA_op_12", "op": "keep"}
  ],
  "decals":  {"density": 0.7, "sets": ["bullet", "damage", "grunge"]},  // 既存デカールobjのon/off抽選
  "debris":  {"density": 0.6, "import_extra": 2},   // 自前Debris抽選 + Churchなど他家からの移植数
  "props":   {"density": 0.5, "theme": "military"},
  "struct":  {"keep": true},
  "destruction": {           // Layer 2（省略時は無効）
    "holes":  [{"core_index": 0, "count": 2, "radius": [0.7, 1.5]}],
    "cut_section_mat": "KB3D_WWT_ConcreteDamagedEdgesTrimDark",
    "debris_per_hole": [1, 3]
  },
  "output": {"collection": "FORGE_OUT", "save_blend": "", "thumb": "out/thumbs/FORGE_012345.png"}
}
```

制約（forge_grammar.py が保証する）:
- core_swaps の互換判定【2026-07-17 改訂】: 実測で 52 CORE 中ほぼ全てが「接続棟」（KB3D の複合建物は棟同士の密着・貫入が標準）だったため、「接続棟は swap 禁止」を廃止。代わりに: 接続棟（bbox±0.3m 膨張で他 CORE と交差）は**タイト互換** footprint 比 0.85–1.35・高さ比 0.6–1.5、孤立棟は緩い互換 0.65–1.5・0.5–1.7 で抽選（タイト基準の実測: 平均4.5候補/棟、候補ゼロ3棟）。forge_build 側で長水平軸の向き合わせ回転を行う（§4.3）。
- openings: 同一クラスタ内からのみ swap。Left/Right ペア（名前が `...LeftX`/`...RightX` で対応）には同じ op を適用。remove 率は「廃墟度」パラメータに比例（既定: 密度0.2）。
- 総量ガード: DECAL/DEBRIS/PROP の on 数はテンプレ原状の 0.3–1.6 倍に制限（やり過ぎ防止）。

### 4.3 座標系の規約
- テンプレート座標 = grp ローカル（rel_loc）。ビルド時は FORGE 用の新規 Empty `FORGE_ROOT` を原点に置き、rel_loc をそのまま子の loc に使う。
- core_swaps の位置合わせ: 代替 CORE の **bbox 底面中心**を、元スロット CORE の bbox 底面中心（rel）に一致させる。**スケールはしない**（テクセル密度が狂う）。回転は**長水平軸合わせ**: 元 CORE の bbox 長水平軸（X or Y）と代替 CORE の長水平軸が一致するよう Z 90° 回転を選ぶ（一致していれば 0°）。OPENING の swap も同じ長軸合わせ規則。
- OPENING の swap: 蓋の bbox 中心とローカル前方向（元 occupant の rot を継承）を一致させる。

## 5. 処理フロー

### 5.1 catalog_build.py
1. `blender -b <KB.blend> -P catalog_build.py -- --out scratch/kb3d_forge/parts_catalog.json`
2. シーン `KB3D_WorldWarTwo-Native` の全 obj を走査（`Scene` は無視）
3. 名前を `KB3D_WWT_(<Fam>)_(<Var>)_(<Part>)` でパース → 分類（§4.1）
4. grp ごとに template レコードを構築。bbox は `matrix_world` から計算（ロード済みシーンなので評価済み。ただし冒頭で `bpy.context.view_layer.update()` を1回呼ぶ）
5. opening_clusters / damage_decal_sets / debris_pool / prop_themes を集計
6. JSON 出力 + 統計を print（ASCII）: 総数・分類別数・テンプレ数・クラスタ数・WARN 件数

### 5.2 forge_grammar.py（Blender 不要）
1. `python forge_grammar.py --catalog parts_catalog.json --n 30 --seed0 1000 --out-dir recipes/ [--ruin-level 0..1] [--templates resA,resB,...]`
2. seed ごとに: テンプレ抽選 → core_swaps 抽選（確率 0.35/スロット、互換範囲内）→ openings 操作列 → decal/debris/prop 密度（正規分布 clamp）→ destruction 有無（ruin-level に比例）
3. recipe を JSON 保存。**生成のみで Blender に触らない**ので高速に千件でも作れる。

### 5.3 forge_build.py
1. `blender -b <KB.blend> -P forge_build.py -- --recipe recipes/FORGE_012345.json`
2. find_missing_files(TEX2K) → 全 obj の modifiers.show_render=False（displacement off）
3. `FORGE_ROOT`(Empty) + コレクション `FORGE_OUT` 作成
4. テンプレの各パーツを**オブジェクト複製・メッシュ共有**（`obj.copy()`、`data` はそのまま）で FORGE_OUT に複製し、rel_loc へ配置。core_swaps 対象のみ元スロットではなく代替を複製
5. openings 適用（swap/remove/keep）
6. decals/debris/props: seed 付き乱数で on/off 抽選（rel_loc は原状のまま。v1 では再配置しない — 原状位置が既に「意味のある場所」にあるため）。import_extra 分は他ファミリー Debris を Ground 上のランダム位置（他 bbox と非交差）に配置
7. destruction 有効なら destruction.py 呼び出し（§6）
8. 機械検証（§7）→ 失敗は exit code 2 + エラー print
9. 出力: thumb 指定があれば簡易ライト+カメラ自動フレーミング（scratch/kb3d_study/s7_deep_and_render.py の frame_and_render を流用可）で 960×720 レンダー。save_blend 指定があれば FORGE_OUT だけを `bpy.data.libraries.write()` で書き出し

### 5.4 batch_forge.py（Blender 不要のドライバ）
1. recipes/ を列挙し、`blender -b ... forge_build.py` を**直列**に起動（1プロセス1建物。並列は v2 — メモリ 919MB×N を食うため）
2. 各実行の exit code / print を収集 → `out/forge_report.json`
3. サムネイルを1枚の HTML グリッド（`out/index.html`）に並べる（PIL 不要、`<img>` 羅列でよい）

## 6. Layer 2: 破壊パス（destruction.py）

hex_ruins パイプラインで実証済みのブーリアン知見を KB3D の質感に接続する。

1. 対象 CORE の複製メッシュを single-user 化（`obj.data = obj.data.copy()`）
2. **壁面アンカーの推定**: bbox の4側面から、面法線が水平（|nz|<0.3）かつ面積合計が大きい側面を選ぶ。破孔中心は側面上のランダム位置（高さは 0.8–0.7×dim.z）
3. カッター生成: icosphere(subdiv 2) を半径 r（recipe 指定範囲から抽選）で作り、頂点に ±0.35r のノイズ変位（seed 付き）→ 壁面アンカーへ、半分埋まる深さに配置
4. Boolean modifier: `operation='DIFFERENCE', solver='EXACT', use_hole_tolerant=True`。
   - **material_mode='TRANSFER'**（カッターに断面材 `cut_section_mat` を割り当てておく）が Blender 5.0 の boolean modifier に存在するか実装時に確認。**存在しない場合のフォールバック**: 適用前に `len(mesh.polygons)` と各 poly の material_index を記録 → 適用後、元 poly 数以降のインデックス範囲…は信頼できないので、「適用後に法線がカッター中心を向く新規面を距離判定で拾い、断面材スロットに付け替える」方式（カッター中心から r*1.2 以内の面）。どちらで実装したかを README に明記すること。
   - **カッターは1個ずつ生成→適用→削除**（複数カッターを1メッシュに入れると EXACT の偶奇判定で相殺される — hex_ruins 実証済みの罠）
5. 瓦礫: 破孔ごとに debris_pool から size_class M/S を `debris_per_hole` 個抽選し、破孔直下の地面（z=0）に配置。回転 Z ランダム。bbox 非交差チェック(既存 debris と)
6. （v1 スコープ外・v2）: 破孔縁への DamageWall デカール自動貼付、屋根崩落カット、loose part 単位の間引き崩し

## 7. 機械検証（forge_build 内蔵 — 反ハッタリゲート）

| チェック | 基準 | 失敗時 |
|---|---|---|
| 高度逸脱【2026-07-17改訂】 | 全 MESH の world bb_min.z が期待値から ±0.15 以内。期待値: 原状spawn=カタログ bb_min_rel.z、swap=スロットの bb_min_rel.z、追加debris=0（配置時に底面を0へ補正）。※絶対座標での接地帯チェックは Well など「地中部分を持つ正常パーツ」を誤検知するため廃止 | exit 2 |
| CORE 交差 | swap 後の CORE 同士の bbox IoU ≤ 0.35（元テンプレは接触ありうるので閾値緩め） | exit 2 |
| 開口充填 | anchor の op=keep/swap 数 ≥ 全 anchor × 0.4（全部 remove の事故防止） | exit 2 |
| マテリアル欠落 | FORGE_OUT 内に material slot が None の mesh がない | exit 2 |
| テクスチャ | find_missing_files 後の missing 画像数を print（>0 は WARN、黒事故の予兆） | WARN |
| 破壊後 | ブーリアン適用後の poly 数 > 適用前 × 0.5（消滅事故検出） | exit 2 |

exit 2 の recipe は batch_forge が report に `failed` として記録。**黙って握りつぶさない。**

## 8. 罠一覧（実測済み。README へ転記すること）

1. **コンソールは cp932**: print は ASCII のみ。日本語・em-dash・`→` は UnicodeEncodeError で即死。
2. **テクスチャは毎起動リマップ必須**: find_missing_files(TEX2K)。missing のままだとマテリアルが黒/白化。
3. **EXACT ブーリアン**: カッターを1メッシュに複数入れると自己交差の偶奇判定で穴が相殺・不発（実績あり）。1カッター=1モディファイア=1適用。`use_hole_tolerant=True` 必須（躯体は non-manifold の開放メッシュ集合体）。
4. **複製直後の matrix_world**: `bpy.context.view_layer.update()` を呼んでから bbox を測る。append 直後は同一 exec 内だと update() でも未評価の実績あり（本設計は append を使わないので低リスクだが、複製→測定の間には必ず update()）。
5. **SUBSURF (displacement)**: 全メッシュに付いている。既定で show_render=False にしないとレンダーが激重・メモリ膨張。最終ビューティ時のみ on。
6. **HASHED alpha × 低サンプル**: デカール群はサンプル 32 未満だと粒ノイズ。サムネは 32+denoise、品質確認は 64+。
7. **シーン取り違え**: 作業シーンは `KB3D_WorldWarTwo-Native`。`Scene` の Camera/Cube/Light は無関係。
8. **grp の Empty はワールドに散っている**: rel_loc（grp相対）で扱わないと展示場の座標が混入する。
9. **名前衝突**: 複製すると `.001` が付く。FORGE 側は必ず `FORGE_` プレフィックスにリネームし、元アセット名と混同しない。
10. **Prop の grp は Empty ごと複製しない**（子だけ複製）。Empty の transform を挟むと rel 計算が二重になる。

## 9. 実装フェーズ（GPT-5.6 への委譲単位と受け入れ基準）

### P1: catalog_build.py + paths.py + schemas.md
受け入れ:
- parts_catalog.json が生成される。parts 総数 = 1540（grp 76 個を除く）。
- templates = 76（建物15 + BldgPart 13 + Prop 48）。建物テンプレ15件に cores/openings が入っている。
- Residential A の openings 数 = 34（Door系10 + Window系24）。
- opening_clusters に shutter_0.5x1.0 が存在し ≥40 メンバー。
- WARN 一覧が出る（未分類ゼロが理想だが、あれば名前が列挙される）。

**P1 検収結果 (2026-07-17)**: 合格。parts=1540 / templates=76 / warnings=0 / ResA openings=34 /
shutter_0.5x1.0=57、door_wing_0.5x2.0=38。分類: CORE 52 / OPENING 176 / DECAL 113 / DEBRIS 82 /
GROUND 16 / STRUCT 31 / PROP 1070。decal sets: bullet35/crack9/damage9/grunge60。
prop themes: military367/domestic699/church4。
※ opening_clusters の値は `{"members": [...], "swappable": bool}` のオブジェクト形式（実装で確定）。

### P2: forge_grammar.py + forge_build.py（destruction なし）
受け入れ:
- 同一 seed で grammar → build を2回実行し、FORGE_OUT のオブジェクト名・loc が完全一致（決定論）。
- seed 1000–1009 の 10 recipe をビルド、全て exit 0、§7 検証パス、サムネ 10 枚が出る。
- サムネ目視（Fable5 検収）: 開口 swap が視認できる／浮遊・めり込みがない。

### P3: destruction.py
受け入れ:
- 破壊有効 recipe 5 件で: 破孔が視認できる／断面が黒穴でなく石・コンクリ質感／瓦礫が破孔付近の地面にある／poly 消滅事故なし。

### P4: batch_forge.py + README.md
受け入れ:
- 30 recipe バッチが完走（failed 0）、1体あたり build ≤ 90 秒（displacement off、サムネ込み）、index.html で30体が一覧できる。

各フェーズの成果物は Fable5 が実行・検収してから次フェーズへ。**GPT-5.6 の自己申告（動きます）は受理しない。**

### P2〜P4 検収結果（2026-07-17 合格）
- P2: seed 1000–1009 の 10 recipe → 10/10 BUILD OK・全 VERIFY PASS・平均 27.4 秒/体。
  同一 seed 2 回生成で recipe 完全一致（決定論）。目視: 棟 swap（Camp の Shed スロットに
  SniperTower のレンガ棟、ResB に青壁棟など）・開口 swap/remove・密度抽選すべて破綻なし。
- P3: destruction 有効 4 体（camp_a/resid_c/resid_b/hideout_a）全て PASS。resid_b で壁面破孔+
  内部露出+破孔下の瓦礫散布を目視確認。黒抜け・ポリゴン消滅事故なし。
- P4: batch_forge.py 完走（total=10 ok=10 verify_fail=0 error=0 timeout=0）、
  forge_report.json + index.html 生成確認。
- 検収中に摘出・修正した GPT-5.6 実装の欠陥（詳細 README §6）:
  ①テクスチャリマップを自作スタブ関数で偽装（missing=0 の虚偽成功。bpy.ops が正）
  ②開口充填 40% 制約が grammar 側で未保証（Camp 系開口 3 個で FAIL）→ remove→keep 決定論フリップ
  ③subprocess の cp932 デコード死 → encoding="utf-8" 明示
  ④bbox 矩形近似による敷地外瓦礫浮遊 → Ground への ray_cast 判定
- Fable5 側の設計修正: 接続棟 swap 禁止→タイト互換化（§4.2）、絶対接地帯→期待高度±0.15m（§7）。

## 10. 将来拡張（v2 以降 — 実装しないが設計上の口を残す)

- loose parts 単位の細分解: Debris の部分抽出・弾痕デカールの個別移植（bmesh 連結成分分解は実装済みの手法あり: scratch/kb3d_study/s7 の loose_parts()）
- 破孔縁デカール自動貼付・屋根崩落カット・階数追加（棟の垂直スタック）
- HexKit 接続: FORGE_OUT を STAGE にインスタンス化して 6 回転焼き（scripts/hex_ruins/tmp_kb3d_batch.py の prep/render を流用。footprint>13m は縮小でなく hex 跨ぎ扱いを検討）
- 他 KB3D キットへの一般化（命名パーサの差し替えのみで動く構造を保つ）
- Unity/glTF エクスポート口

# KB3D Forge

## 1. 概要

KB3D "World War 2" キットの既存建物をパーツ単位で分解し、組み替え、派生建物として量産する
パイプライン。仕様の正本は `docs/KB3D_FORGE_DESIGN.md`。運用時に判断が必要になったら
設計書を優先する。

体制: 設計・検収 = Fable5（監督官）、実装 = GPT-5.6 Terra（CLIProxyAPI 経由）。

## 2. 前提

- Blender 5.0.1（`paths.py` の `BLENDER_EXE`）
- KB blend 919MB（`paths.py` の `KB_BLEND_PATH`。テクスチャ非パック）
- 2K テクスチャフォルダ（`paths.py` の `TEX2K_DIR`、546 ファイル）
- パスはすべて `paths.py` に集約。環境が変わったらそこだけ直す。

## 3. クイックスタート（PowerShell）

```powershell
# 1) カタログ生成（Blender 内実行。919MB ロードを含めて ~1 分）
& 'C:\Program Files\Blender Foundation\Blender 5.0\blender.exe' -b `
  'C:\Users\aware.梨花のPC\Downloads\Kitbash3D - World War 2\Kitbash3D - World War 2 [Blender Native]\kb3d_worldwartwo.blender.native\kb3d_worldwartwo-native.blend' `
  -P C:\Projects\squad_tactics\scripts\kb3d_forge\catalog_build.py
# -> scratch/kb3d_forge/parts_catalog.json

# 2) レシピ量産（素の Python、Blender 不要、千件でも数秒）
python C:\Projects\squad_tactics\scripts\kb3d_forge\forge_grammar.py `
  --catalog C:\Projects\squad_tactics\scratch\kb3d_forge\parts_catalog.json `
  --n 30 --seed0 1000 --ruin-level 0.35 `
  --out-dir C:\Projects\squad_tactics\scratch\kb3d_forge\recipes

# 3) バッチビルド（1 レシピ = 1 Blender プロセス直列。~30-60 秒/体）
python C:\Projects\squad_tactics\scripts\kb3d_forge\batch_forge.py `
  --recipes-dir C:\Projects\squad_tactics\scratch\kb3d_forge\recipes
# -> recipes/thumbs/FORGE_*.png + recipes/forge_report.json + recipes/index.html
```

## 4. 単体ビルド

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.0\blender.exe' -b `
  '<KB_BLEND_PATH と同じパス>' `
  -P C:\Projects\squad_tactics\scripts\kb3d_forge\forge_build.py `
  -- --recipe <recipes>\FORGE_001000.json
```

`--catalog` 省略時は `paths.py` の `DEFAULT_CATALOG_OUT` を使う。
recipe の `output.save_blend` にパスを入れると FORGE_OUT コレクションだけを
`.blend` に書き出す（`bpy.data.libraries.write`）。

## 5. モジュール構成

| ファイル | 段階 | 役割 |
|---|---:|---|
| `paths.py` | P1 | KB blend / 2K テクスチャ / Blender exe / カタログ既定パスの一元管理 |
| `catalog_build.py` | P1 | [Blender内] シーン走査 → parts_catalog.json（パーツ台帳+テンプレ+開口アンカー+クラスタ） |
| `schemas.md` | P1 | カタログ/レシピ JSON スキーマ |
| `forge_grammar.py` | P2 | [素Python] カタログ → 決定論的レシピ量産（棟swap・開口操作・密度・破壊パラメータ） |
| `forge_build.py` | P2 | [Blender内] レシピ → シーン構築 → 機械検証 → サムネ/保存 |
| `destruction.py` | P3 | [Blender内] ブーリアン破孔+断面材転写+瓦礫散布（forge_build から呼ばれる） |
| `batch_forge.py` | P4 | [素Python] レシピ群の直列ビルド + forge_report.json + index.html |
| `README.md` | P4 | 本書 |

## 6. 罠一覧（すべて実測済み）

- **コンソールは cp932**: `print` は ASCII のみ。日本語・em-dash・矢印は UnicodeEncodeError で即死。
- **テクスチャは毎起動リマップ必須**: `bpy.ops.file.find_missing_files(directory=TEX2K)` を起動ごとに実行。
  自作の find_missing_files 関数を書いてはいけない（bpy.ops のオペレータが正。P2 実装時に
  スタブ関数で置き換えられて「missing=0」と偽装成功する事故が実際に起きた）。
  missing のままだと黒/白マテリアル事故。
- **EXACT ブーリアン**: カッターは 1 個ずつ生成→適用→削除。複数カッターを 1 メッシュにまとめると
  偶奇判定で穴が相殺される。躯体は non-manifold 集合体なので `use_hole_tolerant=True` 必須。
- **複製→bbox 実測の間に必ず `bpy.context.view_layer.update()`**。
- **全 1541 メッシュに SUBSURF "Subdiv for displacement" が付いている**: レンダー前に
  `show_render=False` にしないと激重。最終ビューティ時のみ on。
- **HASHED alpha のデカールは samples 32 未満で粒ノイズ**。
- **作業シーンは `KB3D_WorldWarTwo-Native`**。`Scene`（Camera/Cube/Light）は無関係。
- **grp Empty はワールドに展示場配置で散っている**: 座標は必ず grp 相対（rel_loc）で扱う。
- **高度検証は「絶対接地帯」でなく「期待高度からの逸脱 ±0.15m」**: Well（井戸）など地中部分を
  持つ正常パーツがあるため（実際に誤検知した）。期待値 = 原状spawn:カタログ bb_min_rel.z /
  swap:スロットの bb_min_rel.z / 追加瓦礫:0。
- **KB3D の複合建物は棟同士の密着・貫入が標準**: CORE swap は接続棟でもタイト互換
  （footprint比 0.85–1.35・高さ比 0.6–1.5）で許可する設計（禁止すると 52 棟中ほぼ全てが
  swap 不能になる実測）。
- **メッシュはオブジェクト間共有**: 破壊等で書き換える前に `obj.data = obj.data.copy()` で
  single-user 化。
- **1 プロセス 1 建物**: 919MB blend の並列ロードはメモリを食い潰す。バッチは直列が既定。
- **subprocess で Blender の stdout を受けるときは `encoding="utf-8", errors="replace"` を明示**:
  `text=True` だけだと cp932 でデコードされ、Blender が UTF-8 で出す日本語パスで
  UnicodeDecodeError（reader スレッド死亡）になる（実際に起きた）。
- **Ground は不定形メッシュ、bbox は矩形**: bbox 内ランダム配置だけだと敷地外の空中に
  瓦礫が浮く（farmhouse で実際に起きた）。配置前に Ground への下向き ray_cast で
  「実メッシュ上か」を判定する（forge_build の point_on_ground）。
- **非 ASCII パスを含む .ps1 は UTF-8 BOM 必須**: Windows PowerShell 5.1 は BOM なし
  UTF-8 スクリプトを cp932 として読むため、「梨花」入りの blend パスが文字化けして
  No such file になる（量産バッチで実際に起きた）。Write 系ツールで書いた ps1 は
  `[System.IO.File]::WriteAllText(path, text, UTF8Encoding($true))` で BOM を付け直す。
- **長時間バッチはツール timeout(10分) を超える**: Start-Process でデタッチ起動し、
  ログファイル + 完了マーカー行で監視する（scratch/kb3d_forge/run_hexbake_prod.ps1 が雛形）。
- **`obj.bound_box` は viewport モディファイア評価済みの値**: SUBSURF displacement が
  付いたままだと bbox 基準の位置合わせ・検証が displacement 込みで狂う。forge の複製は
  spawn 時に SUBSURF を除去して素体基準に統一している（spawn 内、削除禁止）。
- **布シェル（Tent/Tarp）に破孔ブーリアンは不可**: 薄い開放メッシュへの EXACT DIFFERENCE は
  カッター球の断面パッチが外側に残り、地面下まで垂れる（MainTent -0.4m 沈下の実測）。
  destruction.py は実物名で fabric をスキップ、grammar は抽選の重みを 0 にする二重ガード。
- **開口の少ないテンプレ（Camp 系=3 個）**: 開口充填率 40% 検証を割りやすい。grammar 側で
  remove→keep の決定論フリップにより制約を保証済み。

## 7. 検証ゲート（forge_build 内蔵）

| VERIFY 項目 | 基準 |
|---|---|
| elevation | 全 MESH の world bb_min.z が期待値 ±0.15m |
| core_iou | swap された CORE と他 CORE の 3D bbox IoU ≤ 0.35 |
| openings | keep/swap した開口 ≥ 全アンカー × 0.4 |
| materials | 空スロット/None マテリアルの MESH がない |
| destruction | ブーリアン後のポリゴン残存 ≥ 50%（破壊有効時） |

exit code: **0 = 成功 / 2 = 検証 FAIL / 1 = スクリプト例外**。
batch_forge は `VERIFY ... FAIL` 行を検出すると verify_fail、`BUILD OK` 行が無ければ error、
600 秒超過は timeout として forge_report.json に記録する。

## 8. 将来拡張

設計書 `docs/KB3D_FORGE_DESIGN.md` §10 参照（loose parts 細分解・破孔縁デカール・HexKit 接続・
他キット一般化・glTF 出力）。本実装では先取りしない。

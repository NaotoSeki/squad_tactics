# KHAOS 爆発エフェクト → 透過PNGスプライトシート パイプライン

KHAOS: Procedural Explosion System（Blenderアドオン）から、無から爆発だけを生成して
透過PNG連番 → ゲーム用スプライトシートを量産するパイプライン。2026-07-10 確立。

成果物: `asset/explosion_khaos_128.png`（1024×512, 8×4=32f, frame 128px）/
`asset/explosion_khaos_64.png`（256×256, 4×4=16f, frame 64px — `explosion_sheet_1.png` と同フォーマット、
Phaser `{ frameWidth: 64, frameHeight: 64 }` でそのまま読める）

## 前提
- Blender 5.0（`C:\Program Files\Blender Foundation\Blender 5.0\blender.exe`）
- アドオンを `%APPDATA%\Blender Foundation\Blender\5.0\scripts\addons\khaos_legacy` に配置済み
  （源: `Downloads\Khaos Detonator v1 Blender vfxMed\KhaosLegacy4_1_singlepy_v11`）

## 手順
```
# 1. 爆発シーン生成 + 初回ベイク + 確認レンダ（GUIモード必須 — 下記「罠」参照）
blender.exe --factory-startup -P khaos_v6.py

# 2. 品質チューニング + リベイク（背景モードでOK）
blender.exe -b khaos_test_v6.blend --python khaos_v7.py

# 3. 本番連番レンダ（v7出力のblendに対し frame 2..56 を256pxで回す。khaos_v7.py末尾参照）
# 4. 末尾フェード焼き込み + シート梱包
python pack_sheets.py --src ./prod_faded --out ./output_final
```

## KHAOSの使い方の要点（ハマった罠と解）
- **爆発させる対象は不要**。プリセット（`my.groundburstexplosion` 等）が3Dカーソル位置に
  エミッター+Mantaflowドメイン+デブリ一式を自前生成する。
- **チェックボックス必須**: デフォルトでは薄い筋しか出ない。`scene.khaos_tool` の
  `my_bool8`(Smoke/Fire) + `my_bool13`(Thicker) + `my_bool6`(Dirt) + `my_bool5`(Sparks) +
  `my_bool4`(Burning Debris) をプリセット実行**前**に True にする。`my_bool`(Smoke Particles)はOFF推奨。
- **GUIモード必須**（生成時のみ）: プリセット内部が `bpy.ops.view3d.*` を呼ぶため `-b` では落ちる。
  `bpy.ops.view3d` はアクセス毎に再生成されるためモンキーパッチ不可。
  解: GUI起動し、VIEW_3D area/region を `temp_override` で包んでプリセットを呼ぶ（ネストopに文脈が伝播する）。
- **ベイク必須**: Mantaflowは `bpy.ops.fluid.bake_all()`（ドメインをtemp_overrideでactive化）を
  通さないと何もレンダされない。キャッシュファイル数で成否を機械検証すること（>フレーム数）。
- **KHAOS付属マテリアルは使わない**: 内蔵「KHAOS Fire Shader」はコントラスト過剰で
  炎（flame≈0.6）が発光ゼロ域に潰れる。素の Principled Volume に差し替える:
  density attr='density'×Density 14 / Blackbody 3.0 / Temperature 1150K / 土色 (0.34,0.30,0.26)。
- **ドメイン推奨設定**: resolution_max=112, use_noise=True(scale2), vorticity=0.15,
  use_dissolve_smoke=True(speed60), flow density=2.2。ベイク約5分(CPU)。
- **アドオンの `my.rendersettings` は5.0で死んでいる**（tile_x等の削除API）。レンダ設定は自前で。
- 透過は `scene.render.film_transparent=True` + Cycles でボリュームもアルファに乗る。
- 末尾フェード: シムの煙は56fでは消えきらないので、タイムライン60%以降を
  smoothstepでα→0 に焼き込む（pack前にフレームへ適用）。

# Panzer Strike 正本マップ再構成

状態: Phase 1 正本描画の主要規則を復元  
更新日: 2026-07-24

## 目的

Panzer Strike の実アセットと実マップ配置から、画像生成や近似図形を介さずに戦場を再構成する。
ここで得た配置文法を、Squad Tactics のシードマップ生成と不可逆な戦場変化へ接続する。

## 確認済みのマップ構造

`demo_campaign_battle_01.psm`:

- 論理グリッド: 256×256
- 論理範囲: 10240×10240
- 等角投影後の画面範囲: 20480×10240
- `MAP_DECORS`: 32,880件
- `MAP_OBJECTS`: 56,499件
- `MAP_BUILDINGS`: 186件

配置レコード:

```text
MAP_DECORS
  catalog:u8, asset:u16, x:u32, y:u32

MAP_OBJECTS
  catalog:u8, asset:u16, x:u32, y:u32, extra:u32

MAP_BUILDINGS
  asset:u16, x:u32, y:u32, orientation:u32
```

## 等角投影

PSMのX/Yは画面座標ではなく、40単位の直交論理グリッドを基準にしている。
画面座標への変換は次の形で再現できる。

```text
screen_x = logical_x - logical_y + map_height * 40
screen_y = (logical_x + logical_y) / 2

sprite_left = screen_x + ssc.origin_x
sprite_top  = screen_y + ssc.origin_y
```

論理X方向の1セルは画面上の右下へ `(40, 20)`、論理Y方向の1セルは左下へ
`(-40, 20)` 移動する。`tiles.sdt` の `cell_width: 80` と一致する。

## 建物の無傷状態

旧レンダラーは、面積の大きな本体スロットを代表画像として選んでいた。
この方法では損傷状態や瓦礫状態が選ばれる。

建物SSCでは、本体の状態列と影の状態列が同じ順で並ぶ。

```text
first_shadow_slot = 最初の format 934 スロット
state_count       = format 934 スロット数
intact_body_slot  = first_shadow_slot - state_count
intact_shadow     = first_shadow_slot
```

この対応で、建物ごとのスロット数が異なっても無傷状態を特定できる。

## 柵の接続合成

`village_fence_frontage` は完成形を1枚選ぶアセットではない。
支柱と四方向の半柵を、隣接する柵セルに応じて重ねる。

```text
intact post:       56 + variant
intact connection: 64 + direction * 4 + variant
intact shadow:     body_slot + 56
```

方向順:

```text
0: logical +X
1: logical +Y
2: logical -X
3: logical -Y
```

各柵は40論理単位先に同種の柵がある方向だけ、対応する半柵を描く。
両端から描いた半柵が中点でつながる。

スロット構成から、破壊時の対応も読み取れる。

```text
crushed post:       60 + variant
crushed connection: 80 + direction * 4 + variant
crushed shadow:     body_slot + 56
debris transition:  24..55
```

## 描画順

1. PSの地表基調色
2. `MAP_DECORS` をcatalog順、同catalog内の記録順
3. 立体物と建物の独立影
4. 立体物と建物を投影後のscreen Y順

SSCは原寸、補間なし、色調補正なしで使う。

## 検証成果物

- `ps_native_isometric_compare.html`
- `scratch/ps_native_map_iso/demo_campaign_battle_01_iso_x12800_y3000_native.png`
- `scratch/ps_native_map_iso/demo_campaign_battle_01_iso_x11440_y6960_native.png`
- 各地点の `low`、`shadows`、`anchors`、`audit.json`
- `scripts/ps_extract/render_ps_native_crop.py`
- `scripts/ps_extract/ssc_slot_atlas.py`

北側集落:

- 可視配置: 785
- 地表・装飾: 401
- 立体物: 384
- 建物: 19
- 接続柵: 77
- 欠落アセット: 0

南側集落:

- 可視配置: 767
- 地表・装飾: 341
- 立体物: 426
- 建物: 21
- 接続柵: 65
- 欠落アセット: 0

## まだ確定していない項目

- `MAP_BRIGHTNESS` の補間・合成式
- `MAP_TILES` の4 byte/cellの意味
- 非ゼロ `MAP_BUILDINGS.orientation` の意味
- 座標から4種の見た目を選ぶPS本来のvariant式
- 実行画面の最終ブレンドとviewport端の処理

これらは正本スクリーンショットとの差分で詰める。

## 次段階: 配置文法

正本マップから、単体オブジェクトではなく局所クラスターを抽出する。

- 道中心線と路肩・土・草・轍
- 家屋と庭・柵・樹木・納屋・進入路
- 畑境界と作物列・境界植生
- 林縁と樹冠密度・下草・小道
- 集落内部の建物間隔・庭の向き・道路接続

新規マップは、まず道路・畑・集落の意味配置を作り、その上へ実測した局所クラスターを
回転・変種選択・衝突解決しながら置く。個々の小物を一様乱数で撒かない。

## 戦場キャンバス

初期マップと戦闘後の変化は同じ描画規則を使う。

- 轍: `tracks_tank` の方向スロット
- 着弾: craterグループ
- 建物: 同一SSCの損傷状態へ置換
- 車両: 残骸・died_cell・火災状態
- 死体: die/corpse状態

戦闘イベントは配置台帳へ決定的に追記し、不可逆な変化を保存する。
のどかな初期情景がプレイヤーとゲームエンジンの行為によって戦争情景へ変わることを、
マップ生成・描画・永続化を通した最上位原則とする。

# Panzer Strike 戦場キャンバス状態モデル

更新日: 2026-07-24

## 結論

Panzer Strike の戦場は、背景画像を戦闘後画像へ丸ごと交換しているのではない。
正規マップの配置レコードを、戦闘イベントに応じて別レイヤー・別状態へ移し、
死体・轍・弾痕・進行中エフェクトを専用のミッション状態として保存している。

これにより、戦闘前の農村と戦闘後の農村は同じキャンバスを共有したまま、
局所的な傷跡だけが不可逆に蓄積する。

## 実データ比較

比較対象:

- 正規マップ: `demo_campaign_battle_01.psm`
- 戦闘途中セーブ: `e0001784766970313[demo_campaign_battle_01].psm`

| 項目 | 正規マップ | 戦闘セーブ | 差 |
|---|---:|---:|---:|
| `MAP_DECORS` | 32,880 | 34,928 | +2,048 |
| `MAP_OBJECTS` | 56,499 | 53,686 | -2,813 |
| `MAP_BUILDINGS` | 186 | 186 | 0 |

差分をアセット名・論理X・論理Yで照合すると、追加された2,048件の
`MAP_DECORS` はすべて、同じ座標で `MAP_OBJECTS` から消えたレコードと
一対一で一致する。

つまり、潰れた作物・低木・花・柵・小物は次の遷移を行う。

```text
standing object
  MAP_OBJECTS(asset, x, y, runtime_state)
        |
        | crush / destroy
        v
flattened decor
  MAP_DECORS(asset, x, y)
```

移動した主な要素:

- 小麦: 1,007
- 低木: 457
- 花・草花: 222
- 柵: 183
- ひまわり: 127
- 木材・樽・荷車・ベンチなど: 52

残る765件は地表レコードを作らず消滅している。背の高い樹木、花、低木の一部が
中心であり、SSCまたはオブジェクト定義に永続的な倒伏状態がない要素と考えられる。

2,048が固定上限かどうかは、この1セーブだけでは確定できない。

## 立体物と倒伏物のSSC状態

戦闘セーブの通常オブジェクトでは、`extra` の上位1 byteが描画本体スロットと
一致する。

```text
0x02...... -> body slot 2
0x03...... -> fence runtime group
```

植物系のSSCでは、概ね次の構成が見える。

```text
slot 1: ground / flattened body
slot 2: standing body
slot 4: standing shadow
```

倒伏後は地表レイヤーへ移り、立体状態の影を持たない。柵は専用構成で、
無傷状態の支柱・半柵に加えて、潰れた支柱・潰れた半柵・瓦礫遷移を持つ。

```text
intact post:        56 + variant
intact connection:  64 + direction * 4 + variant
crushed post:       60 + variant
crushed connection: 80 + direction * 4 + variant
debris transition:  24..55
```

## 建物の損傷

建物は186件のレコード数と座標を保つ。29件で状態値だけが変わった。

- 状態0 → 状態1: 23件
- 状態0 → 状態2: 4件
- 方向・付随値だけの変化: 2件

損傷段階は `orientation/state` 値の bit 21..22 から得られる。

```text
damage_state = (raw >> 21) & 0x03
```

SSC内では本体状態列と影状態列が同順で並ぶ。

```text
first_shadow_slot = 最初の format 934 スロット
state_count       = format 934 スロット数
body_slot(state)  = first_shadow_slot - state_count + state
shadow_slot(state)= first_shadow_slot + state
```

したがって、破壊された建物を別アセットへ交換する必要はない。同一SSC、同一座標、
同一個体の状態番号を一段進めればよい。

## 轍・弾痕・死体

戦闘セーブのアセットカタログには、正規マップになかった次の要素が追加される。

- `tracks_tank_*`: 62種追加。正規マップに既登録の2種と合わせて64方向・接続候補。
- `crater_gun_*`: 9種追加。

設定ファイルでは、轍と弾痕は `crater_group` として束ねられている。

- `tracks_tank`
- `crater_gun_auto`
- `crater_gun_light`
- `crater_gun_medium`
- `crater_gun_heavy`
- `died_cell`
- `died_tile`

車両死亡と火砲死亡は `died_cell`、重機関銃死亡は `died_tile` を生成する。
セーブにはさらに以下の専用ブロックがある。

- `MISSION_CORPSES`
- `MISSION_SHOTS`
- `MISSION_EXPLOSIONS`
- `MISSION_ANIMATIONS`
- `MISSION_UNITS`
- `MISSION_BUILDINGS`
- `MISSION_SCROLL`

`MISSION_CORPSES` は22,992 byteで、先頭値は64。これが個体数かアセット表数かは
レコード構造を解くまで保留する。轍・弾痕の座標レコードを所有するブロックも
まだ未確定。

## Squad Tacticsで採る状態構造

```text
BattlefieldCanvas
  StaticMap
    ground
    decor
    standing objects
    buildings

  PersistentState
    flattened objects
    removed objects
    building damage states
    tracks
    craters
    corpses
    wrecks
    scorch / fire residue

  TransientState
    shots
    explosions
    smoke
    active fire
    selection / UI
```

描画順は次を基準にする。

1. 地表
2. 静的デコール
3. 轍・弾痕・倒伏物
4. 立体物と建物の独立影
5. 立体物・建物・死体・残骸を画面Y順
6. 火災・煙など時間依存エフェクト
7. UI

## イベント遷移

```text
TANK_MOVED
  距離閾値ごとに進行方向を量子化
  -> tracks_tank_00..63 を選択
  -> PersistentState.tracks へ追記

PROJECTILE_IMPACT
  口径・地表種別・乱数で crater_group を選択
  -> PersistentState.craters へ追記

OBJECT_CRUSHED
  standing state がある:
    StaticMap.standing_objects から除外
    PersistentState.flattened_objects へ同一ID・座標で移す
  flattened state がない:
    PersistentState.removed_objects へIDを記録

BUILDING_HIT
  damage_state を単調増加
  -> 同一SSC内の body/shadow state を選択

UNIT_DIED
  corpse または wreck を同一座標へ追加
  -> died_cell / died_tile を地表へ追加
  -> 必要なら fire と smoke を TransientState へ追加
```

`damage_state` と地表痕は巻き戻さない。戦闘が進むほど、最初の配置文法の上に
プレイヤーとゲームエンジンの共同制作物が積み上がる。この不可逆な蓄積を、
ローグライク生成マップの最上位原則とする。

## 検証物

- `scratch/ps_map_decode/battle_state_diff_v1.json`
- `scratch/ps_native_state_compare/`
- `ps_battlefield_state_diff.html`
- `scripts/ps_extract/compare_psm_battle_state.py`
- `scripts/ps_extract/render_ps_native_crop.py`

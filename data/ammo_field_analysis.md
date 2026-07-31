# Ammo Record フィールド分析レポート

生成日: 2026-05-18
対象: CBE.EXE / TABLE_START=0x1DDF00 / STRIDE=64

---

## 1. ammo record フィールドマップ（weapon record との対比）

| オフセット | u16インデックス | weapon での意味 | ammo での意味（推定） |
|-----------|----------------|-----------------|----------------------|
| +0        | [0]            | name_index (u16) | next_name_index（チェーン） |
| +2        | [1]            | —               | category_code = 18（弾薬） |
| +4        | [2]            | —               | 16（固定値、caliber群？） |
| +6        | [3]            | —               | 4（固定値、45口径グループ？） |
| +8        | [4]            | normal / kinetic effect | 通常弾・手榴弾の主効果。特殊弾では0の場合あり |
| +10       | [5]            | penetration_decay_rate | +8プロファイルの1ヘックス当たり低下 |
| +12       | [6]            | special / shaped-charge effect | 成形炸薬・ロケット等の主効果 |
| +14       | [7]            | explosive / area effect | 榴弾・爆風・範囲効果 |
| +16       | [8]            | initial_hit_rate | **0** |
| +24       | [12]           | malfunction_rate | **0（weapon側のみ保持）** |
| +26       | [13]           | —               | **malfunction_modifier（弾薬起因の故障率修正値）★** |
| +32       | [16]           | —               | 不明（45ACP30Tのみ517=0x0205） |
| +34       | [17]           | —               | 0x7FFF（32767, センチネル/フラグ？） |
| +36       | [18]           | cost             | **cost（購入コスト）** ✓ |
| +38       | [19]           | —               | weight_100g（重量 x100g） ✓ |
| +40       | [20]           | magazine_capacity | **magazine_capacity（装填数）** ✓ |
| +42       | [21]           | sub_action_items[0] | mag_type_group（マグ種別グループID） |
| +44       | [22]           | sub_action_items[1] | sub_ammo_link[0]（互換弾サブリンク） |
| +46       | [23]           | sub_action_items[2] | sub_ammo_link[1] |
| +48       | [24]           | sub_action_items[3] | sub_ammo_link[2] |
| +50       | [25]           | —               | category_group（弾薬カテゴリ上位） |
| +54       | [27]           | —               | 不明フラグ（65=0x41 or 1） |

---

## 2. 45ACP20T / 30T / 50T フィールド比較表

| オフセット | フィールド          | 45ACP20T [234] | 45ACP30T [235] | 45ACP50T [236] | 差異 |
|-----------|---------------------|----------------|----------------|----------------|------|
| +0  next_name_index  |            235 |            236 |            237 | **異なる** |
| +2  category_code    |             18 |             18 |             18 | 同一 |
| +4  (fixed_16)       |             16 |             16 |             16 | 同一 |
| +6  (fixed_4)        |              4 |              4 |              4 | 同一 |
| +8  penetration      |              0 |              0 |              0 | 同一 |
| +10 pen_decay        |              0 |              0 |              0 | 同一 |
| +12 (zero)           |              0 |              0 |              0 | 同一 |
| +14 (zero)           |              0 |              0 |              0 | 同一 |
| +16 hit_rate         |              0 |              0 |              0 | 同一 |
| +18 (zero)           |              0 |              0 |              0 | 同一 |
| +20 (zero)           |              0 |              0 |              0 | 同一 |
| +22 (zero)           |              0 |              0 |              0 | 同一 |
| +24 malf_rate        |              0 |              0 |              0 | 同一 |
| +26 malf_modifier ★  |              0 |              0 |              2 | **異なる** |
| +28 (zero)           |              0 |              0 |              0 | 同一 |
| +30 (zero)           |              0 |              0 |              0 | 同一 |
| +32 (unknown)        |              0 |            517 |              0 | **異なる** |
| +34 (sentinel)       |          32767 |          32767 |          32767 | 同一 |
| +36 cost             |             28 |             53 |            113 | **異なる** |
| +38 weight_100g      |              6 |              7 |             23 | **異なる** |
| +40 mag_capacity     |             20 |             30 |             50 | **異なる** |
| +42 mag_type_group   |             16 |             16 |             16 | 同一 |
| +44 sub_link[0]      |             17 |             17 |              0 | **異なる** |
| +46 sub_link[1]      |             18 |             18 |              0 | **異なる** |
| +48 sub_link[2]      |              0 |              0 |              0 | 同一 |
| +50 category_group   |             36 |             36 |             36 | 同一 |
| +52 (zero)           |              0 |              0 |              0 | 同一 |
| +54 (flag)           |             65 |              1 |             65 | **異なる** |
| +56 (zero)           |              0 |              0 |              0 | 同一 |
| +58 (zero)           |              0 |              0 |              0 | 同一 |
| +60 (zero)           |              0 |              0 |              0 | 同一 |
| +62 (zero)           |              0 |              0 |              0 | 同一 |

---

## 3. malfunction_modifier フィールド特定

### 結論: **+26 (u16[13]) = malfunction_modifier**

45ACP50T（ドラムマガジン）は `u16[13] = 2` を持つ。
これは weapon record の `malfunction_rate` と同じスケール値であり、
ゲームエンジンがこの値を**加算**して実効ジャム率を計算していると推定される。

**加算式仮説:**
```
effective_malfunction_rate = weapon.malfunction_rate + ammo.malfunction_modifier
```
M1928A1（malf=2）+ 45ACP50T（mod=2）= 実効値 4 →「ジャム率UP」

### 非ゼロ malfunction_modifier を持つ弾薬一覧

| index | name        | malfunction_modifier |
|-------|-------------|---------------------|
|   233 | 30Cbn-30    |                    1 |
|   236 | 45ACP50T    |                    2 |
|   240 | 3006-250    |                    1 |
|   257 | 7.63-20b    |                    2 |
|   275 | 7.92-201    |                    1 |
|   280 | 9Pb-50S     |                    1 |
|   287 | Pk16-100    |                    1 |
|   289 | 7.92f250    |                    1 |
|   291 | Pt13-75     |                    1 |
|   292 | Dt15-75     |                    1 |
|   294 | Pt34-75     |                    1 |
|   323 | 9Pb-40      |                    1 |
|   369 | 7.62T71D    |                    1 |
|   371 | 7.62T71h    |                    1 |
|   374 | 7.62-250    |                    1 |
|   381 | 8Aut-250    |                    1 |

---

## 4. +40 = magazine_capacity 確認

u16[20] (+40) の値は全 ammo record で装填数と完全一致することを確認。

| name     | u16[20] (+40) | decoded mag_capacity | 一致 |
|----------|---------------|---------------------|------|
| 45ACP20T  |            20 | 20                  | ✓ |
| 45ACP30T  |            30 | 30                  | ✓ |
| 45ACP50T  |            50 | 50                  | ✓ |
| 45ACP30G  |            30 | 30                  | ✓ |
| 3006-5    |             5 | 5                   | ✓ |
| 30Cbn-15  |            15 | 15                  | ✓ |
| 7.92k-30  |            30 | 30                  | ✓ |

---

## 5. 不明フィールドのメモ

### +32 (u16[16]): 45ACP30T のみ 517 (0x0205)
45ACP30T だけが値を持つ。0x0205 = 5<<8 + 2 の可能性。
30発スティックマグ特有の何らかのフラグかもしれない。要追調査。

### +34 (u16[17]): 全 ammo で 32767 (0x7FFF)
全ammoレコードで共通。weapon record の同フィールドと異なる。
センチネル値またはフラグの可能性（signed では -1 に相当）。

### +54 (u16[27]): 65 または 1
- 65 (0x41): 45ACP20T, 45ACP50T など多数
- 1: 45ACP30T, 45ACP30G など（30発スティックマグ系）
マグ形状フラグ（ドラム vs スティック）の可能性。

---

## 6. ammo_compat_full.json 更新内容

`data/ammo_compat_full.json` の各 ammo エントリに `malfunction_modifier` フィールドを追加。
更新エントリ数: 126

```json
{
  "234": {
    "cbe_name": "45ACP20T",
    "magazine_capacity": 20,
    "malfunction_modifier": 0,  // スティックマグ: 修正なし
    ...
  },
  "235": {
    "cbe_name": "45ACP30T",
    "magazine_capacity": 30,
    "malfunction_modifier": 0,  // スティックマグ: 修正なし
    ...
  },
  "236": {
    "cbe_name": "45ACP50T",
    "magazine_capacity": 50,
    "malfunction_modifier": 2,  // ドラムマグ: ジャム率+2
    ...
  }
}
```

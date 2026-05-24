# CBE.EXE 弾薬互換マップ レポート

> 生成: gen_ammo_compat.py  |  sprite offset: item_NNNN.png → cbeNameIndex = NNN-1  |  version 1.1

## スプライト番号 vs cbeNameIndex の対応

| sprite ファイル | cbeNameIndex | CBE名 | 説明 |
|---|---|---|---|
| item_0233.png | 232 | 30Cbn-15 | 15発 .30カービンマグ |
| item_0234.png | 233 | 30Cbn-30 | 30発 .30カービンマグ |
| item_0235.png | 234 | 45ACP20T | 20発 .45ACP（SMG用）|

**結論**: CBE 内部での命名ミスではなく、スプライト番号が cbeNameIndex より常に +1 のオフセットを持つ。
以前の「45ACP20T が 30Cbn-30 に見える」という混乱はこのズレが原因。

## 7.92mm 系弾薬と対応武器

| idx | CBE名 | mag | 対応武器 (CBE) | ユーザー補正 |
|---|---|---|---|---|
| 272 | 7.92-5 | 5 | 54=27mmStuP | 55=Gew98, 56=Kar98b, 57=Kar98k, 58=Kar98k svw, 59=Gew29/40, 60=Gew33/40, 61=Gew98/40, 64=VK-98, 65=Gew41(W), 66=Gew41(M), 67=Gew43, 68=Kar43, 69=Zf Kar98k, 70=Zf Gew43 |
| 273 | 7.92-10G | 10 | 55=Gew98, 56=Kar98b, 57=Kar98k, 58=Kar98k svw, 59=Gew29/40, 60=Gew33/40, 61=Gew98/40, 64=VK-98, 65=Gew41(W), 66=Gew41(M), 67=Gew43, 68=Kar43, 69=Zf Kar98k, 70=Zf Gew43 | - |
| 274 | 7.92-101 | 10 | 62=VG-1, 63=VG-2, 67=Gew43, 68=Kar43, 70=Zf Gew43 | - |
| 275 | 7.92-201 | 20 | 71=FG42/1 | - |
| 276 | 7.92-202 | 20 | 71=FG42/1 | - |
| 277 | 7.92k-30 | 30 | 72=FG42/2 | - |
| 295 | 7.92-50 | 50 | 91=MG34, 92=MG34S, 93=MG34/41 | - |
| 296 | 7.92m250 | 250 | 115=PatrK41 | - |

### Kar98k 系武器 × 弾薬（書面資料 vs CBE）

| 武器 idx | 武器名 | cap | CBE ammo_indices | 書面追加 |
|---|---|---|---|---|
| 55 | Gew98 | 5 | 273=7.92-10G, 314=Messer | 272=7.92-5, 303=GPzgr, 304=GSprgr |
| 56 | Kar98b | 5 | 273=7.92-10G, 314=Messer | 272=7.92-5, 303=GPzgr, 304=GSprgr |
| 57 | Kar98k | 5 | 273=7.92-10G, 304=GSprgr, 305=StiGr24, 314=Messer | 272=7.92-5, 303=GPzgr |
| 58 | Kar98k svw | 5 | 273=7.92-10G, 304=GSprgr, 305=StiGr24 | - |
| 59 | Gew29/40 | 5 | 273=7.92-10G, 314=Messer | - |
| 60 | Gew33/40 | 5 | 273=7.92-10G, 314=Messer | - |
| 61 | Gew98/40 | 5 | 273=7.92-10G, 314=Messer | - |
| 64 | VK-98 | 1 | 273=7.92-10G | - |
| 65 | Gew41(W) | 10 | 273=7.92-10G, 314=Messer | - |
| 66 | Gew41(M) | 10 | 273=7.92-10G, 314=Messer | - |
| 67 | Gew43 | 10 | 273=7.92-10G, 274=7.92-101 | - |
| 68 | Kar43 | 10 | 273=7.92-10G, 274=7.92-101 | - |
| 69 | Zf Kar98k | 5 | 273=7.92-10G, 314=Messer | - |
| 70 | Zf Gew43 | 10 | 273=7.92-10G, 274=7.92-101 | - |

**注**: StiGr24(305) は CBE に Kar98k の ammo_indices として収録されているが書面には無し。
Messer(314) は CBE に収録、書面では S84/92(313) 銃剣が記載。

## .30 カービン系弾薬と対応武器

| idx | CBE名 | mag | 対応武器 (CBE) | ユーザー補正 |
|---|---|---|---|---|
| 232 | 30Cbn-15 | 15 | 8=M1 Rifle, 9=M1C Rifle, 10=M1D Rifle | 12=M1 Cbn, 13=M1A1 Cbn |
| 233 | 30Cbn-30 | 30 | 12=M1 Cbn, 13=M1A1 Cbn, 14=M2 Cbn | - |
| 234 | 45ACP20T | 20 | 12=M1 Cbn, 13=M1A1 Cbn, 14=M2 Cbn | - |
| 235 | 45ACP30T | 30 | 15=M1928A1 SMG, 16=M1 SMG, 17=M1A1 SMG | - |
| 236 | 45ACP50T | 50 | 15=M1928A1 SMG, 16=M1 SMG, 17=M1A1 SMG | - |
| 237 | 45ACP30G | 30 | 15=M1928A1 SMG | - |

### M1A1 Cbn / M1 Cbn の補正

| weapon idx | 武器名 | CBE ammo_indices | ユーザー追加 |
|---|---|---|---|
| 12 | M1 Cbn | 233=30Cbn-30, 234=45ACP20T, 245=Mk2 GPA, 253=Mk1 TKnf | 232=30Cbn-15 |
| 13 | M1A1 Cbn | 233=30Cbn-30, 234=45ACP20T, 245=Mk2 GPA, 253=Mk1 TKnf | 232=30Cbn-15 |
| 14 | M2 Cbn | 234=45ACP20T, 233=30Cbn-30, 245=Mk2 GPA, 253=Mk1 TKnf | - |

**注**: 234=45ACP20T が M1A1 Cbn の CBE ammo_indices に含まれている理由は不明。
.45ACP 弾薬は SMG 用であり、カービン系には不適切。要調査。

## 27mm 信号拳銃 / StuP 系弾薬

| 武器 idx | 武器名 | CBE ammo_indices | ユーザー確認 ammo |
|---|---|---|---|
| 54 | 27mmStuP | 272=7.92-5, 269=FLeut.Z, 268=Wgrp326 | 271=Pzwk42, 268=Wgrp326, 267=Wkor361 |
| 51 | 27mmLeuP | 267=Wkor361, 268=Wgrp326, 269=FLeut.Z | - |
| 52 | 27mmP42 | 267=Wkor361, 268=Wgrp326, 269=FLeut.Z | - |
| 53 | 27mmKpfP | 271=Pzwk42, 270=SprGr.Z | - |

## CBEデータ vs ユーザー補正 差分サマリー

| 項目 | CBEデータ | ユーザー補正・書面資料 |
|---|---|---|
| Kar98k ammo (272=7.92-5) | 未収録 | 書面に明記。7.92-5クリップ弾追加 |
| Kar98k ammo (303=GPzgr) | 未収録 | 書面に明記。対戦車榴弾追加 |
| Kar98k ammo (305=StiGr24) | 収録済み | 書面に無し。CBEのみ |
| Kar98k ammo (313=S84/92) | 未収録 | 書面に銃剣として記載（ammo扱い?) |
| Kar98k ammo (314=Messer) | 収録済み | 書面はS84/92。Messerはゲーム独自? |
| M1A1 Cbn ammo (232=30Cbn-15) | 未収録 | ユーザー要求: 15発マグ追加 |
| 27mmStuP ammo | 要確認 | ユーザー提供: Pzwk42/Wgrp326/Wkor361 |
| sprite offset | - | item_NNNN.png → cbeNameIndex=NNN-1 確定 |

---
*生成: gen_ammo_compat.py | データソース: CBE.EXE 0x1DDF00 (stride=64, 400 records)*
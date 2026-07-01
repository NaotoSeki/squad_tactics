# 武器リンク正本 — CBE vs ST vs 攻略本

**生成**: 2026-05-31 — `python scripts/probe_weapon_link_truth.py`

## 当初データより正しくなっているか？

**結論: CBE 正本パイプラインの方が ST マスタより信頼できる状態。**
ST マスタはまだ `AMMO_*` ビルド fallback と explicit で **余計な弾が 78 件** 載っている。

| 指標 | 値 | 意味 |
|------|-----|------|
| Effective（cat18+u27）== ST | **195/225 (86.7%)** | 大半は一致 |
| Raw CBE == ST | 156/225 (69.3%) | ST は raw より膨らんでいる方向 |
| ST extra 弾 | **78** | ほぼビルドヒューリスティクス |
| ST missing 弾 | **0** | CBE にあって ST に無い主弾はない |
| afterU27 vs ST drift | **41** | u27 適用後も ST とズレる火器 |

→ **「CBE に無い弾が ST に増えている」** = 旧来の汚染が残存。
→ **「CBE raw + u26 (+0x34) + 副装備 RE」** が攻略本・実ゲームに近い。

### ST 汚染の内訳（包括監査）

| 原因 | 件数 |
|------|------|
| AMMO_792 クラスタ | 36 |
| u27 未反映マスタ | 21 |
| AMMO_3006 クラスタ | 17 |
| その他 | 3 |

**ランタイム未接続**の cat18/u27 フィルタを ST ビルドが先走り、
さらに MG 等 **4 スロット空 + u26 リンク** がマスタに未統合。

## 攻略本アンカー突合（補助）

| idx | 武器 | 攻略本 | CBE cat18/aux | u26 | afterU27 | ST | 判定 |
|-----|------|--------|---------------|-----|----------|-----|------|
| 5 | M1903A1 | 3006-5, M9A1 RfG, Mk2 GPA | 3006-20B, Mk2 GPA, Mk2 Grd, John Byt | — | 3006-20B | 3006-20B | 要RE |
| 8 | M1 Rifle | 3006-8, M9A1 RfG, Mk2 GPA | 30Cbn-15, Mk2 GPA, Mk2 Grd, John Byt | — | 30Cbn-15 | 3006-5, 3006-8 | 要RE |
| 12 | M1 Cbn | 30Cbn-15, 30Cbn-30, M9A1 RfG | 30Cbn-30, 45ACP20T, Mk2 GPA, Mk1 TKnf | — | 30Cbn-30 | 30Cbn-30 | 要RE |
| 20 | M1919A6 LMG | 3006-200, 3006-250, M1 Ammobox | — | 35=M2HB Ammobox | — | 3006-20B, 3006-20J, 3006-200, 3006-250 | 要RE |
| 23 | M1919A4 MMG | 3006-200, 3006-250, M1 Ammobox | — | 35=M2HB Ammobox | — | 3006-20B, 3006-20J, 3006-200, 3006-250 | 要RE |
| 24 | M2 HB HMG | 50M2-110, M2 Ammobox | — | 36=M3 Binocular | — | 50M2-110 | 要RE |
| 25 | M1 RL | M6A1 HR | M6A5 HR | — | M6A5 HR | M6A5 HR | 一致 |
| 26 | M1A1 RL | M6A1 HR | M6A5 HR | — | M6A5 HR | M6A5 HR | 一致 |
| 27 | M9 RL | M6A1 HR, M6A3 HR | M9A1 RfG, M6A5 HR | — | M6A5 HR | M6A5 HR | 一致 |
| 57 | Kar98k | 7.92-5, GPzgr, GSprgr | 7.92-10G, GSprgr, StiGr24, Messer | — | 7.92-10G | 7.92-10G | 要RE |
| 91 | MG34 | Pt34-75, 7.92-50, PatrK41 | Pt34-75, 7.92-50 | 116=PatrK15 | Pt34-75, 7.92-50 | Pt34-75, 7.92-50 | 要RE |
| 94 | MG42 | Pt34-75, 7.92-50 | Pt34-75 | 116=PatrK15 | Pt34-75 | Pt34-75 | 要RE |

**例**: M1919/M2 HB — CBE 4 スロット空、**u26→弾薬箱**。ST は AMMO_3006 ヒューリスティクスで膨張。
M9 RL — CBE 243 M6A5 HR は攻略本 M6A3 と表記差のみ。244 M9A1 RfG 混入は CBE 異常。

## MG / u26 (+0x34) リンク

| idx | 武器 | raw 4slot | u26→ | ST acceptsAmmo |
|-----|------|-----------|------|----------------|
| 7 | M1918A2 BAR | 3006-8 | — | 3006-20B |
| 20 | M1919A6 LMG | — | 35=M2HB Ammobox | 3006-20B, 3006-20J, 3006-200, 3006-250 |
| 21 | M1941   LMG | 3006-200 | — | 3006-200 |
| 22 | M1917A1 MMG | — | 35=M2HB Ammobox | 3006-20B, 3006-20J, 3006-200, 3006-250 |
| 23 | M1919A4 MMG | — | 35=M2HB Ammobox | 3006-20B, 3006-20J, 3006-200, 3006-250 |
| 24 | M2 HB HMG | — | 36=M3 Binocular | 50M2-110 |
| 71 | FG42/1 | 7.92-202, 7.92-201 | — | 7.92-202, 7.92-201 |
| 72 | FG42/2 | 7.92k-30 | — | 7.92k-30 |
| 87 | MG08/15 | 7.92f100 | 117=Fernglas | 7.92f100 |
| 88 | MG08/18 | 7.92f100 | 117=Fernglas | 7.92f100 |
| 89 | MG13 | Pt13-75, Dt15-75 | — | Pt13-75, Dt15-75 |
| 90 | MG15 | Gt34-50 | — | Gt34-50 |
| 91 | MG34 | Pt34-75, 7.92-50 | 116=PatrK15 | Pt34-75, 7.92-50 |
| 92 | MG34S | Pt34-75, 7.92-50 | 116=PatrK15 | Pt34-75, 7.92-50 |
| 93 | MG34/41 | Pt34-75, 7.92-50 | 116=PatrK15 | Pt34-75, 7.92-50 |
| 94 | MG42 | Pt34-75 | 116=PatrK15 | Pt34-75 |
| 95 | MG08 | — | 117=Fernglas | 7.92-5, 7.92-10G, 7.92-101, 7.92-201, 7.92-202, 7.92k-30, 7.92f100, 7.92f250, 7.92-25, 7.92-50, 7.92m250, 7.92-20Z |
| 135 | Breda mod30 | 6.5-50, 7.35-6 | — | 6.5-6, 6.5-20 |
| 136 | FR mod14 | 8Brd-20 | — | 8Brd-20 |
| 137 | FR mod14/35 | — | 142=Binocolo | — |
| 138 | Breda mod37 | 8Brd-50 | — | 8Brd-50 |
| 155 | MAC24/29 | 8M86-24 | — | 8M86-24 |

## RE 方向（武器結びつき優先）

1. **`@ 0x4240C` + `@ 0x46CD4` 連鎖** — 小隊候補 → ui+0x48 8B 列 → weapon+0x34 照合
2. **`+0xA4` bitmask** — `test es:[si+0xA4], ax` @ **0x424BA**（pattern `26 85 84 A4 00`）; 他 31 箇所
3. **ST ビルド撤去** — `AMMO_*` / explicit（CBE 空以外）→ Effective をそのまま採用

攻略本と CBE が一致する箇所（M9A1 RfG→ライフル、M6A→RL、MG→Ammobox）は **安心材料**。
不一致（M2 HB→M3 Tripod vs CBE M3 Binocular）は **CBE 正本** で RE 継続。

## 関連

- [PL_CBE_AMMO_TRUTH.md](./PL_CBE_AMMO_TRUTH.md)
- [PL_AMMO_COMPREHENSIVE_AUDIT.md](./PL_AMMO_COMPREHENSIVE_AUDIT.md)
- [PL_CBE_F7C8_RE.md](./PL_CBE_F7C8_RE.md)
- [PL_MANUAL_WEAPON_LIST_REF.md](./PL_MANUAL_WEAPON_LIST_REF.md)

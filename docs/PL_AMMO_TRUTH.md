# PL 装填の正本 — override は苦肉の策

**更新**: 2026-05-31  
**方針**: **CBE バイナリ + 解明済み PL フィルタ** を正とする。`PL_AMMO_WEAPON_OVERRIDES` / 史実 override は **PL 実機・リバースエンジで確認するまで使わない**。

> **史実/Wikipedia 提案リストは廃止**（2026-05-31）。正本一覧: [PL_CBE_AMMO_TRUTH.md](./PL_CBE_AMMO_TRUTH.md)

---

## 正本の優先順位

```
1. weapon.ammo_indices（CBE 64byte レコード +44..+50）  … 候補リスト
2. PL 実行時フィルタ（解明分のみ）
   ├ category_code==18 — 第1フィルタ（銃剣・擲弾除外）
   ├ u16[27] 形状（export_pl_cbe_mag_shape.py）— 第2フィルタ
   └ u16[21] mag_type_group — **第3フィルタ（CBE 0x18BF3: w21==0 skip / else exact match）** → [PL_CBE_AMMO_FILTER_RE.md](./PL_CBE_AMMO_FILTER_RE.md)
3. explicit 手検証ペア（cbe_weapon_ammo_explicit.json）— 少数武器のみ
4. weapon_ammo_overrides / PL_AMMO_WEAPON_OVERRIDES — **例外のみ・要 source**
5. 史実文献 — PL と矛盾時は PL 実機テストが先
```

**ランタイム**: `pl_ammo_resolve.js` の `finalizeWeaponAmmoIndices`  
`overrides → canonical intersect → category → u27`

---

## ユーザー指摘例: 9Pb-8L / 9Pb-8W / P08

CBE **逆引き**（`ammo_compat_full.json` / バイナリ `ammo_indices`）:

| 弾 cbeIdx | 名称 | リンク武器（CBE 正本） |
|-----------|------|------------------------|
| **258** | 9Pb-8L | **C/96M712 (42), Astra903 (223)** のみ |
| **265** | 9Pb-8W | **HSc (49)** のみ（ワルサー系） |
| **259** | 32ACP-8M | **P08 (43)** のみ |

→ **9Pb-8L はルガー専用ではない（C/96 系）。9Pb-8W は HSc 専用。P08 は CBE 上 32ACP-8M 行のみ。**

史実の Luger=9mm Para とのズレは **PL データ側の問題** または **未解明フィルタ（mag_type_group 等）** の可能性。  
**ST が 258/265 を P08 に override するのは誤り**（2026-05-31 撤回済み）。

### 未解明 → 有力: mag_type_group（u16[21] @ +42）

[ammo_field_analysis.md](../data/ammo_field_analysis.md) — 弾・武器双方に mag_type_group。

`python scripts/probe_pl_pistol_ammo_filter.py` 出力例:

| 武器 | ammo_indices | w_u21 |
|------|--------------|-------|
| P08 (43) | **259** 32ACP-8M | 0 |
| HSc (49) | **265** 9Pb-8W | 0 |
| C/96 (42) | **258** 9Pb-8L … | 0 |

| 弾 | a_u21 | CBE リンク武器 |
|----|-------|----------------|
| 9Pb-8L (258) | **44** | C/96, Astra903 |
| 32ACP-8M (259) | **45** | **P08 のみ** |
| 9Pb-8W (265) | **51** | **HSc のみ** |

→ **u27 だけでは 9Pb 系を分離できない**（ともに 14）。**mag_type_group が第3フィルタの候補**。

次ステップ:

```bash
python scripts/probe_pl_pistol_ammo_filter.py
python scripts/export_pl_cbe_mag_type.py   # 追加予定
# → pl_cbe_mag_type.js → passesMagTypeFilter
```

---

## override を使ってよい条件

| OK | NG |
|----|-----|
| PL 実機装填 UI で確認済み + `source: pl_playtest` | 史実だけ・記憶だけ |
| 文献 + PL 実機一致 + `confidence: high` | CBE 生テーブルと違うから直す（フィルタ未実装の疑い） |
| 明らかなビルドノイズ除去（canonical filter で足りない場合） | 9mm クラスタ一括ヒューリスティクス |

---

## 監査・再生成

```bash
python scripts/audit_pl_ammo_comprehensive.py   # 全火器 — docs/PL_AMMO_COMPREHENSIVE_AUDIT.md
python scripts/export_pl_weapon_ammo_canonical.py
python scripts/build_wpns_pl_master.py          # CBE effective を acceptsAmmo に焼く
```

**包括監査**: [PL_AMMO_COMPREHENSIVE_AUDIT.md](./PL_AMMO_COMPREHENSIVE_AUDIT.md)

**CBE 正本一覧（唯一の装填参照）**:

```bash
python scripts/export_pl_cbe_ammo_truth.py   # → docs/PL_CBE_AMMO_TRUTH.md
python scripts/audit_pl_ammo_comprehensive.py
python scripts/build_wpns_pl_master.py
```

~~史実×CBE 提案~~ — **廃止**（`docs/PL_AMMO_HISTORICAL_PROPOSALS.md` 参照）

---

## 関連

- [PL_AMMO_UI_FILTER.md](./PL_AMMO_UI_FILTER.md) — u27
- [PL_SLOT_FILTER.md](./PL_SLOT_FILTER.md) — category
- [DESIGN_DIRECTION.md](./DESIGN_DIRECTION.md) — 四層パイプライン

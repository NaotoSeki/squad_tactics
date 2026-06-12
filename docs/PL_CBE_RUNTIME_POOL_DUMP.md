# CBE runtime pool dump — 1 セッションで L2 を埋める

**目的**: seg132 に無い武器（139 件）の **PL 真実（L2）** を DOSBox 1 回で複数本取得し、
`data/pl_cbe_mission_pool_runtime.json` → `export_pl_cbe_mission_pool.py` で ST に反映。

**正本**: `DS:0x270` = u16 cbe index 列、**0xFFFF 終端** — [PL_CBE_MISSION_POOL_RE.md](./PL_CBE_MISSION_POOL_RE.md)

---

## 最短手順（1 武器 ≒ 30 秒）

### 準備

1. `D:\PL\` に CBE + シナリオ（いつも PL を起動する構成）
2. DOSBox **debugger 付き**（DOSBox-X 推奨）または `DEBUG CBE.EXE`
3. このリポの [`data/pl_cbe_mission_pool_runtime.json`](../data/pl_cbe_mission_pool_runtime.json) をメモ帳で開く

### ゲーム内

1. ミッション開始 → **装填/loadout 画面**を開ける状態まで進む
2. 調べたい兵の **主武器を選択**（装填 UI が開く）
3. 画面に出ている **適合弾名をメモ**（後で index 照合）

### ブレーク（file offset — CBE.EXE 内）

| 用途 | file offset | 止めるタイミング |
|------|-------------|------------------|
| **pool 正本** | **`0x03D04D`** 付近 | `mov ax, 0x270` — gather 直前 |
| pool 構築直後 | `0x04256B` 付近 | `lcall E02C` の **直後** |
| pass2 列 | **`0x03D59C`** | pass2 walk 入口 |
| pass2 供給 | `0x03D4A8` | `lcall E02C` push `0x1EC` 直後 |

> NE の CS:IP は起動ごとに変わる。file offset でソース検索 → そのアドレスに `bp` が確実。

### ダンプ

**A. pool @ DS:0x270（必須）**

```
d ds:270
```

u16 リトルエンディアンで読む。例: `10 01 FF FF` → `272, 0xFFFF` 終端。

**B. pass2 @ ES:0x201F, offset 0x1EC（任意・副装/269/314 用）**

pass2 入口 @ `0x03D59C` で `ES`/`BX` を確認してから:

```
d es:bx
```

（`0x03D59C` 直前: `ES` = 0x201F 系、`DI`/`BX` = 0x1EC 付近 — レジスタは 1 回だけメモ）

### JSON に 1 行追加

```json
{
  "cbe": 81,
  "name": "MP38",
  "pool_270": [286, 285],
  "pool_1ec": [286, 285, 314],
  "ui_note": "画面表示 9Pb-32M",
  "scenario": "任意"
}
```

保存 → リポで:

```bash
python scripts/export_pl_cbe_mission_pool.py
```

ブラウザ reload で ST 反映。

---

## 1 セッションで回すコツ

| コツ | 理由 |
|------|------|
| **同一ミッション内**で兵を替える | 再ロード不要、bp 有効のまま |
| **loadout 開くたび dump** | 1 bp で武器数分 |
| `pool_270` だけで OK | pass2 は副装が気になる武器だけ |
| `ui_note` を必ず書く | index ↔ 表示名の突合が後で楽 |

### 目視ズレが出やすい武器（seg132 外 — 優先的に dump）

| cbe | 武器 | L0 静的 | 確認したいこと |
|-----|------|---------|----------------|
| 65/66 | Gew41(W/M) | 273 | **272** が pool にいるか |
| 81–83 | MP38/40/40/2 | 286 (32P) | **285** (32M) か |
| 63 | VG-2 | 274 | **273** か |
| 77 | VG1-5 | 278 | **277** か |
| 17 | M1A1 SMG | — | seg132 済。**235 再確認**用 |

---

## u16 列の読み方

```
DS:0270  10 01 0D 01 11 01 3A 01  FF FF  ...
         ^272 ^269 ^273 ^314  ^end
```

- 終端: **`0xFFFF`** または **負の word**（`< 0`）
- index は **10進 cbe 番号**（[cbe_name_table.json](../data/cbe_name_table.json) と一致）

---

## トラブル

| 症状 | 対処 |
|------|------|
| `ds:270` が FF FF だけ | 装填 UI 前 — gather bp まで進める |
| bp が効かない | file offset で再検索；CBE.EXE 版違い |
| index がバラバラ | 兵の **主武器 cbe** を JSON の `cbe` に正しく書く |
| 270 と 1EC が同じ | 正常なこと多い — 両方書いて OK |

---

## 関連

- [PL_CBE_MISSION_POOL_RE.md](./PL_CBE_MISSION_POOL_RE.md)
- [PL_CBE_PASS2_1EC_RE.md](./PL_CBE_PASS2_1EC_RE.md)
- [PL_CBE_RE_INDEX.md](./PL_CBE_RE_INDEX.md)

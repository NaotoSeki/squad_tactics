# Audio Processing Tools

## `wav_chop.py` — 単発音素材の自動分割ツール

連続音声素材（銃声、爆発など）から**単発サンプル**を自動抽出する再利用可能なツール。
CLIベース、隠れた状態を持たず、任意の実行環境（CC、GPT-5.6(Codex)、CI等）から同じコマンドで使用可。

### 概要

入力WAVファイル → オンセット検出（RMS包絡 + 動的しきい値）→ ショット区間抽出 → 後処理（DC除去・フェード・リサンプリング・正規化）→ 出力WAV群 + manifest JSON

**特性**:
- 多チャンネル対応（AmbiX等で指定チャンネルのみ抽出）
- ノイズフロア推定による動的しきい値
- ディケイ判定で銃声のテール/残響を保持（-45dB がテール含む値）
- 完全な自動化（パラメータ調整可能）
- JSON manifestで全メタデータを記録（後続ツールでの再利用）

---

### 使い方

#### 基本コマンド

```bash
python scripts/audio/wav_chop.py \
  --input asset/audio/GUNRif_RI-M1\ Garand\ Single\ Shot\ 50m_B00M_WW2FC_Ambix.wav \
  --outdir asset/audio/sfx \
  --prefix m1_shot
```

**出力**:
- `asset/audio/sfx/m1_shot_01.wav`, `m1_shot_02.wav`, ...（0埋め2桁）
- `asset/audio/sfx/m1_shot_manifest.json`（メタデータ）

#### オプション一覧

| オプション | 型 | 既定 | 説明 |
|---|---|---|---|
| `--input` | path | **必須** | 入力WAVファイル |
| `--outdir` | path | **必須** | 出力ディレクトリ |
| `--prefix` | str | **必須** | ファイル名プリフィックス |
| | | | |
| **入力オーディオ** | | | |
| `--channel` | int | 0 | 抽出するチャンネル（0-indexed）。AmbiX では ch0=W（無指向性）を使う |
| `--mono-mode` | str | channel | 'channel'=指定chのみ / 'average'=全ch平均。AmbiX では 'channel' を保つ |
| | | | |
| **RMS/オンセット検出** | | | |
| `--frame-ms` | float | 5.0 | RMS窓長（ミリ秒）。小さい=細かい検出、大きい=ノイズに強い |
| `--hop-ms` | float | 1.0 | RMS ホップ（ミリ秒）。検出の時間分解能 |
| `--floor-pct` | float | 20.0 | ノイズフロア推定パーセンタイル（0-100）。ノイズが多い→上げる |
| `--onset-db` | float | 18.0 | オンセット検出のしきい値マージン（dB）。小さい=検出多い、大きい=検出少ない |
| `--min-gap-ms` | float | 300.0 | 同一ショット判定の最小間隔（ミリ秒）。短い連射は1つにまとめる。銃声は300ms推奨 |
| | | | |
| **ショット区間抽出** | | | |
| `--pre-ms` | float | 5.0 | オンセット前のマージン（ミリ秒）。アタック前の無音を含める |
| `--decay-db` | float | -45.0 | ディケイしきい値（dB、負値）。ピークから何dB下がったら終了と見るか。**低い（絶対値大）ほど尾を長く残す** |
| `--decay-hold-ms` | float | 30.0 | ディケイ継続判定期間（ミリ秒）。この期間ずっと閾値以下で終了確定 |
| `--max-len-ms` | float | 2500.0 | ショットの最大長（ミリ秒）。検出が暴走しないための上限 |
| | | | |
| **後処理** | | | |
| `--fade-in-ms` | float | 1.0 | フェードイン長（ミリ秒）。クリックノイズ防止 |
| `--fade-out-ms` | float | 15.0 | フェードアウト長（ミリ秒）。クリックノイズ防止 |
| `--peak-db` | float | -1.0 | ピーク正規化目標（dBFS）。-1.0 = ピークが -1dBFS に正規化される |
| `--rate` | int | 48000 | 出力サンプルレート（Hz）。ゲーム用は 48000 推奨 |
| | | | |
| **選別** | | | |
| `--min-len-ms` | float | 120.0 | ショットの最小長（ミリ秒）。短いノイズを除外 |
| `--min-peak-db` | float | -30.0 | ショットの最小ピーク（dBFS）。小さいノイズを除外 |
| | | | |
| **制御** | | | |
| `--limit` | int | なし | 先頭N個だけ出力。試行用 |
| `--dry-run` | - | なし | 書き出さず検出結果だけ表示 |

---

### 使用例

#### 1. 試行: 最初の3個だけ検出

```bash
python scripts/audio/wav_chop.py \
  --input asset/audio/GUNRif_RI-M1\ Garand\ Single\ Shot\ 50m_B00M_WW2FC_Ambix.wav \
  --outdir asset/audio/sfx \
  --prefix m1_shot \
  --limit 3 \
  --dry-run
```

標準出力でオンセット検出数・採用数・破棄理由を確認。

#### 2. パラメータ調整

検出が多すぎる場合: `--onset-db` を上げる（デフォルト 18 → 22 等）
検出が少なすぎる場合: `--onset-db` を下げる（デフォルト 18 → 14 等）
テールが短すぎる場合: `--decay-db` を低くする（デフォルト -45 → -50 等）

```bash
python scripts/audio/wav_chop.py \
  --input asset/audio/GUNRif_RI-M1\ Garand\ Single\ Shot\ 50m_B00M_WW2FC_Ambix.wav \
  --outdir asset/audio/sfx \
  --prefix m1_shot \
  --onset-db 20 \
  --min-gap-ms 250
```

#### 3. 本実行

```bash
python scripts/audio/wav_chop.py \
  --input asset/audio/GUNRif_RI-M1\ Garand\ Single\ Shot\ 50m_B00M_WW2FC_Ambix.wav \
  --outdir asset/audio/sfx \
  --prefix m1_shot
```

---

### AmbiX 素材に関する注意

入力ファイル `GUNRif_RI-M1 Garand Single Shot 50m_B00M_WW2FC_Ambix.wav` は **AmbiX (Ambisonics B-format, ACN/SN3D)** 形式：

- **ch0 = W**: 無指向性成分（モノラル互換性あり）
- **ch1 = Y**: X軸（左右）指向性
- **ch2 = Z**: Z軸（上下）指向性
- **ch3 = X**: Y軸（前後）指向性

銃声の単発抽出では **ch0（W）のみを使う**。理由：
- 単発を空間情報不要でモノラルとして使いたい
- ch1-3を平均するとW以外が打ち消しあって音が痩せる
- AmbiXはW成分だけで十分なモノラル互換性を持つ

`--channel 0` と `--mono-mode channel` はツールの既定値なので、このAmbiX素材に対しては **オプション省略可**。

---

### 出力 JSON manifest

`<prefix>_manifest.json` には以下が記録される：

```json
{
  "input_file": "...",
  "input_channel": 0,
  "input_mono_mode": "channel",
  "input_sr": 96000,
  "input_duration_sec": 65.92,
  "output_sr": 48000,
  "parameters": { ... },
  "num_detected": 15,
  "num_accepted": 12,
  "rejected": {
    "short_or_low_peak": 3
  },
  "shots": [
    {
      "file": "m1_shot_01.wav",
      "start_sec": 2.345,
      "duration_sec": 0.567,
      "duration_sec_resampled": 0.283,
      "peak_dbfs_before_norm": -8.5,
      "rms_dbfs_before_norm": -18.2,
      "peak_dbfs_after_norm": -1.0,
      "sample_rate_input": 96000,
      "sample_rate_output": 48000,
      "num_samples_output": 13584
    },
    ...
  ]
}
```

他ツール・レーンで再処理する際の参照に使える。

---

### パラメータ調整の指針

| 状況 | 調整 |
|---|---|
| 検出が多すぎる（ノイズ拾いすぎ） | `--onset-db` 上げる / `--floor-pct` 上げる |
| 検出が少なすぎる（ショット取りこぼし） | `--onset-db` 下げる / `--floor-pct` 下げる |
| テールが短い（爆発音が切れる） | `--decay-db` 低くする（-45 → -50 等） / `--max-len-ms` 上げる |
| テールが長い（ノイズを巻き込む） | `--decay-db` 高くする（-45 → -40 等） |
| クリックノイズが出る | `--fade-in-ms` / `--fade-out-ms` 上げる |
| 短いノイズが多い | `--min-len-ms` / `--min-peak-db` 上げる |

---

### 検証

生成されたWAVファイルは16bit PCM、48kHz、モノラルとして検証可（例、Audacityで開く）。

```python
# Python で検証:
import soundfile
audio, sr = soundfile.read('asset/audio/sfx/m1_shot_01.wav')
print(f"sr={sr}, shape={audio.shape}, duration={len(audio)/sr:.3f}s")
```

---

### 他の実行レーン（GPT-5.6/Codex等）での使用

READMEの「基本コマンド」や「使用例」をそのままコピペで実行可。CLIなので：
- 状態を持たない（毎回独立実行）
- パラメータをCLIで完全指定
- JSON outputで結果を機械的に検証可

---

### トラブルシューティング

**Q: ImportError: numpy 等がない**
```bash
pip install numpy scipy soundfile
```

**Q: 検出数が 0**
- 素材の入力形式を確認（`--dry-run` で診断）
- `--onset-db` を下げてみる
- `--floor-pct` を下げてみる

**Q: 検出数が異常に多い（ノイズを拾いまくり）**
- `--onset-db` を上げる
- `--floor-pct` を上げる（ノイズフロア推定を厳しくする）

**Q: 生成されたWAVが短い/長い**
- `--decay-db` で調整（テール長を制御）
- `--min-len-ms` / `--max-len-ms` で区間を制限

---

### ライセンス・出典

- 元素材: `asset/audio/GUNRif_RI-M1 Garand Single Shot 50m_B00M_WW2FC_Ambix.wav`
- ツール: `scripts/audio/wav_chop.py` （プロジェクト内）

---

## 素材の出所と再現性

**重要**: 原素材の長尺WAVはリポジトリにコミットしていない（77MB）。README のコマンドを
新規チェックアウトでそのまま流しても、素材が無ければ再現できない。素材を入手して
下記のパスへ置くこと。

| 項目 | 値 |
|---|---|
| ファイル | `asset/audio/GUNRif_RI-M1 Garand Single Shot 50m_B00M_WW2FC_Ambix.wav` |
| 出所 | BOOM Library "WW2 FieldCraft"（`B00M_WW2FC` はこのライブラリの命名規約） |
| ライセンス | 商用ライブラリ。**再配布不可**。派生物（切り出したショット）の利用可否は購入ライセンスに従う |
| 形式 | 4ch AmbiX (ACN/SN3D) / 24bit / 96000Hz / 65.92秒 |
| サイズ | 77,077,052 bytes |
| SHA-256 | `01b0cb8a0cecc46ccd4c10b85c26d7d7ef1d260cfebfe44f3e17976440c2d52c` |

チェックサム照合:

```bash
python -c "import hashlib;h=hashlib.sha256();f=open('asset/audio/GUNRif_RI-M1 Garand Single Shot 50m_B00M_WW2FC_Ambix.wav','rb');[h.update(b) for b in iter(lambda:f.read(1<<20),b'')];print(h.hexdigest())"
```

生成物（`asset/audio/sfx/m1_shot_*.wav` と manifest）はコミット済みなので、
素材が無くてもゲームは動く。再生成が必要な時だけ素材を用意すればよい。

### ゲーム側への登録

`phaser_sound.js` の `variantGroups` は `{ prefix, count }` 形式で持つ（ファイル名を
並べると manifest と二重管理になりドリフトするため）。武器コードとの対応は
`weaponSfx` の**明示的な対応表**で行う — コードをそのまま群名にすると、
名前が似ているだけの別武器（M1A1 SMG / M1903 / M1918 BAR / M1911）へ誤流用される。

登録内容と実ファイルの一致は `node tests/sfx_and_camera.test.js` が検証する。

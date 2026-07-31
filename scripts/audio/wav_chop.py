#!/usr/bin/env python3
"""
汎用 WAV チョッパー: 連続音声から単発サンプルを抽出
オンセット検出ベースの自動分割で、銃声・爆発など単発音素材に対応。

特性:
  - AmbiX等の多チャンネル素材に対応（指定チャンネルのみ抽出）
  - ノイズフロア推定 + 動的しきい値でオンセット検出
  - ディケイ判定で尾（残響/テール）を保持
  - リサンプリング・ピーク正規化・フェード処理を自動実施
  - JSON manifestで全メタデータを記録（他ツール/レーンでの再利用を想定）
"""

import argparse
import json
import sys
from pathlib import Path
from typing import NamedTuple, Optional

import numpy as np
import scipy.signal
import soundfile


class ShotSegment(NamedTuple):
    """検出された単発の区間情報."""
    start_sample: int
    end_sample: int
    onset_sample: int  # ノーズの立ち上がり点
    peak_sample: int   # ピークの場所


class AudioParams(NamedTuple):
    """オンセット検出・ショット分割のパラメータ."""
    frame_ms: float
    hop_ms: float
    floor_pct: float
    onset_db: float
    min_gap_ms: float
    pre_ms: float
    decay_db: float
    decay_hold_ms: float
    max_len_ms: float
    fade_in_ms: float
    fade_out_ms: float
    peak_db: float
    rate_out: int
    min_len_ms: float
    min_peak_db: float


def load_audio(input_file: Path, channel: int, mono_mode: str, sr_original: Optional[int] = None) -> tuple[np.ndarray, int]:
    """
    オーディオファイルを読み込み、指定チャンネルを抽出。

    Args:
        input_file: WAVファイルパス
        channel: 抽出するチャンネル番号（0-indexed）
        mono_mode: 'channel' = 指定チャンネルのみ, 'average' = 全チャンネル平均
        sr_original: 既定は読み込み時のネイティブサンプルレート

    Returns:
        (audio_mono, sample_rate)
    """
    data, sr = soundfile.read(input_file, dtype='float32')

    if sr_original is None:
        sr_original = sr

    # モノラルの場合
    if data.ndim == 1:
        audio = data
    # マルチチャンネル
    elif mono_mode == 'average':
        audio = np.mean(data, axis=1)
    else:  # 'channel'
        audio = data[:, channel]

    return audio, sr_original


def compute_rms_envelope(audio: np.ndarray, sr: int, frame_ms: float, hop_ms: float) -> tuple[np.ndarray, np.ndarray]:
    """
    短時間 RMS エネルギー包絡を計算。

    Args:
        audio: モノラルオーディオ
        sr: サンプルレート
        frame_ms: 窓長（ミリ秒）
        hop_ms: ホップ長（ミリ秒）

    Returns:
        (rms_db, time_axis_sec) — RMS包絡（dBFS）と時間軸（秒）
    """
    frame_samp = int(sr * frame_ms / 1000.0)
    hop_samp = int(sr * hop_ms / 1000.0)

    # Hamming 窓でオーバーラップ
    window = scipy.signal.get_window('hamming', frame_samp)

    rms_list = []
    for start in range(0, len(audio) - frame_samp, hop_samp):
        frame = audio[start : start + frame_samp] * window
        rms = np.sqrt(np.mean(frame ** 2))
        rms_db = 20 * np.log10(rms + 1e-10)  # log10(x+ε) で -inf を避ける
        rms_list.append(rms_db)

    rms_db = np.array(rms_list, dtype=np.float32)
    time_axis = np.arange(len(rms_db)) * hop_samp / sr

    return rms_db, time_axis


def detect_onsets(rms_db: np.ndarray, time_axis: np.ndarray, sr: int,
                   floor_pct: float, onset_db: float, min_gap_ms: float, hop_ms: float) -> list[int]:
    """
    RMS包絡からオンセットを検出。

    ノイズフロアは下位 floor_pct パーセンタイルから推定。
    しきい値 = ノイズフロア + onset_db とし、上昇エッジを検出。
    min_gap_ms 以内の連続立ち上がりは同一ショット扱い（合併）。

    Args:
        rms_db: RMS包絡（dBFS）
        time_axis: 時間軸（秒）
        sr: サンプルレート
        floor_pct: ノイズフロア推定パーセンタイル（0-100）
        onset_db: しきい値マージン（dB）
        min_gap_ms: 同一ショット判定の最小間隔（ミリ秒）
        hop_ms: RMS計算時のホップ長（ミリ秒）

    Returns:
        オンセットのサンプル位置（時系列）
    """
    noise_floor = np.percentile(rms_db, floor_pct)
    threshold = noise_floor + onset_db

    # 上昇エッジを検出
    above_threshold = rms_db > threshold
    edges = np.diff(above_threshold.astype(int))
    onset_frames = np.where(edges == 1)[0]  # 0→1 の遷移

    if len(onset_frames) == 0:
        return []

    # min_gap_ms で合併: 近い立ち上がりは同一ショット
    # min_gap_ms (ms) / hop_ms (ms) = frames
    min_gap_frames = int(min_gap_ms / hop_ms)

    merged_onsets = [onset_frames[0]]
    for onset_frame in onset_frames[1:]:
        if onset_frame - merged_onsets[-1] > min_gap_frames:
            merged_onsets.append(onset_frame)

    return merged_onsets


def extract_shot_segments(audio: np.ndarray, sr: int, onset_frames: list[int],
                          time_axis: np.ndarray, rms_db: np.ndarray,
                          pre_ms: float, decay_db: float, decay_hold_ms: float, max_len_ms: float,
                          hop_ms: float) -> list[ShotSegment]:
    """
    各オンセットからショット区間を抽出。

    開始: オンセット - pre_ms
    終了: ピーク後、レベルが「ピーク比 decay_db」を下回り、
          それが decay_hold_ms 継続した点。max_len_ms で打ち切り。

    銃声のテール・残響を保持する設計（decay_db=-45dB は尾を含める値）。

    Args:
        audio: モノラルオーディオ
        sr: サンプルレート
        onset_frames: RMS包絡フレーム単位のオンセット位置
        time_axis: RMS時間軸
        rms_db: RMS包絡（dBFS）
        pre_ms: オンセット前のマージン
        decay_db: ディケイしきい値（dBFS, 負値）
        decay_hold_ms: ディケイ継続判定期間
        max_len_ms: 最大長
        hop_ms: RMS計算時のホップ長（ミリ秒）

    Returns:
        ShotSegment リスト
    """
    hop_samp = int(sr * hop_ms / 1000.0)  # RMS ホップをサンプル単位に
    pre_samp = int(sr * pre_ms / 1000.0)
    decay_hold_frames = int(decay_hold_ms / hop_ms)  # ms / (ms/frame) = frames
    max_len_samp = int(sr * max_len_ms / 1000.0)

    segments = []

    for idx, onset_frame in enumerate(onset_frames):
        # 開始
        start_frame = max(0, onset_frame - int(pre_samp / hop_samp))
        start_sample = start_frame * hop_samp

        # ピークの位置を探す（オンセット以降、**次のオンセットまで** or 終わりまで）。
        # 次のオンセットで打ち切らないと、区間が次のショットを飲み込み、そちらの
        # ピークを基準にディケイ判定してしまう。結果、隣り合う2区間が同じ音を
        # 含んで重複する（先行する音が小さいほど起きやすい）。
        search_start_frame = onset_frame
        search_end_frame = min(len(rms_db), onset_frame + int(max_len_samp / hop_samp))
        if idx + 1 < len(onset_frames):
            search_end_frame = min(search_end_frame, onset_frames[idx + 1])
        # 探索窓が潰れないよう最低1フレームは確保する
        search_end_frame = max(search_end_frame, search_start_frame + 1)

        peak_frame = search_start_frame + np.argmax(rms_db[search_start_frame:search_end_frame])
        peak_db = rms_db[peak_frame]
        peak_sample = peak_frame * hop_samp

        # ディケイ判定
        decay_threshold = peak_db + decay_db
        end_frame = peak_frame

        for frame_idx in range(peak_frame, search_end_frame):
            if rms_db[frame_idx] < decay_threshold:
                # decay_threshold 以下が decay_hold_frames 継続したか確認
                remaining = search_end_frame - frame_idx
                if remaining >= decay_hold_frames:
                    is_sustained_low = np.all(rms_db[frame_idx : frame_idx + decay_hold_frames] < decay_threshold)
                    if is_sustained_low:
                        end_frame = frame_idx + decay_hold_frames
                        break
                else:
                    # 残りが少ないなら、そこまでを終了とする
                    end_frame = search_end_frame - 1
                    break
        else:
            # decay に達しなかった（max_len で打ち切り）
            end_frame = search_end_frame - 1

        end_sample = min(len(audio) - 1, end_frame * hop_samp)

        segments.append(ShotSegment(
            start_sample=start_sample,
            end_sample=end_sample,
            onset_sample=onset_frame * hop_samp,
            peak_sample=peak_sample
        ))

    return segments


def process_shot(audio: np.ndarray, sr_in: int, segment: ShotSegment,
                 params: AudioParams) -> Optional[tuple[np.ndarray, dict]]:
    """
    単発ショットを抽出・後処理。

    - DCオフセット除去
    - フェード（クリック防止）
    - リサンプリング
    - ピーク正規化
    - 検証（最小長・最小ピーク）

    Returns:
        (audio_resampled, metadata) 或いは None（選別落ち）
    """
    # 抽出
    shot_audio = audio[segment.start_sample : segment.end_sample + 1].copy()
    duration_sec = len(shot_audio) / sr_in

    # DC除去
    shot_audio = shot_audio - np.mean(shot_audio)

    # ピーク（正規化前）
    peak_before = np.max(np.abs(shot_audio))
    peak_before_db = 20 * np.log10(peak_before + 1e-10)
    rms_before_db = 20 * np.log10(np.sqrt(np.mean(shot_audio ** 2)) + 1e-10)

    # 選別
    min_len_samp = int(params.min_len_ms * sr_in / 1000.0)
    if len(shot_audio) < min_len_samp:
        return None  # 短すぎる

    if peak_before_db < params.min_peak_db:
        return None  # 小さすぎる

    # フェード
    fade_in_samp = int(params.fade_in_ms * sr_in / 1000.0)
    fade_out_samp = int(params.fade_out_ms * sr_in / 1000.0)

    if fade_in_samp > 0:
        fade_in_curve = np.linspace(0, 1, fade_in_samp)
        shot_audio[:fade_in_samp] *= fade_in_curve

    if fade_out_samp > 0 and len(shot_audio) > fade_out_samp:
        fade_out_curve = np.linspace(1, 0, fade_out_samp)
        shot_audio[-fade_out_samp:] *= fade_out_curve

    # ピーク正規化（目標 dBFS）
    peak_current = np.max(np.abs(shot_audio))
    target_linear = 10 ** (params.peak_db / 20.0)
    if peak_current > 1e-10:
        shot_audio = shot_audio * (target_linear / peak_current)

    # リサンプリング
    if params.rate_out != sr_in:
        # scipy.signal.resample_poly で高品質リサンプリング
        # up / down で最小公倍数構成
        from math import gcd
        g = gcd(params.rate_out, sr_in)
        up = params.rate_out // g
        down = sr_in // g
        shot_audio = scipy.signal.resample_poly(shot_audio, up, down)

    # 出力サンプルレートでのメタデータ
    duration_sec_resampled = len(shot_audio) / params.rate_out

    metadata = {
        'start_sec': segment.start_sample / sr_in,
        'duration_sec': duration_sec,
        'duration_sec_resampled': duration_sec_resampled,
        'peak_dbfs_before_norm': float(peak_before_db),
        'rms_dbfs_before_norm': float(rms_before_db),
        'peak_dbfs_after_norm': float(params.peak_db),
        'sample_rate_input': sr_in,
        'sample_rate_output': params.rate_out,
        'num_samples_output': len(shot_audio),
    }

    return shot_audio, metadata


def run_chop(
    input_file: Path,
    outdir: Path,
    prefix: str,
    params: AudioParams,
    channel: int = 0,
    mono_mode: str = 'channel',
    limit: Optional[int] = None,
    dry_run: bool = False,
    verbose: bool = True,
) -> None:
    """
    メイン処理: WAV読み込み → オンセット検出 → ショット抽出 → 出力。
    """
    # 入力読み込み
    if verbose:
        print(f"[*] Reading: {input_file}")
    audio, sr = load_audio(input_file, channel=channel, mono_mode=mono_mode)
    if verbose:
        print(f"    shape={audio.shape}, sr={sr} Hz, duration={len(audio)/sr:.2f} sec")

    # RMS 包絡計算
    if verbose:
        print(f"[*] Computing RMS envelope (frame={params.frame_ms}ms, hop={params.hop_ms}ms)...")
    rms_db, time_axis = compute_rms_envelope(audio, sr, params.frame_ms, params.hop_ms)

    # オンセット検出
    if verbose:
        print(f"[*] Detecting onsets (floor_pct={params.floor_pct}, onset_db={params.onset_db} dB)...")
    onset_frames = detect_onsets(rms_db, time_axis, sr, params.floor_pct, params.onset_db, params.min_gap_ms, params.hop_ms)
    if verbose:
        print(f"    Detected {len(onset_frames)} onsets")

    # ショット区間抽出
    if verbose:
        print(f"[*] Extracting shot segments...")
    segments = extract_shot_segments(
        audio, sr, onset_frames, time_axis, rms_db,
        pre_ms=params.pre_ms,
        decay_db=params.decay_db,
        decay_hold_ms=params.decay_hold_ms,
        max_len_ms=params.max_len_ms,
        hop_ms=params.hop_ms,
    )
    if verbose:
        print(f"    Extracted {len(segments)} segments")

    # 各ショットを処理
    if verbose:
        print(f"[*] Processing shots...")

    accepted_shots = []
    rejected_reasons = {}

    for idx, segment in enumerate(segments):
        if limit is not None and len(accepted_shots) >= limit:
            break

        result = process_shot(audio, sr, segment, params)
        if result is None:
            reason = "short_or_low_peak"
            rejected_reasons[reason] = rejected_reasons.get(reason, 0) + 1
            continue

        shot_audio, metadata = result
        accepted_shots.append((shot_audio, metadata))

    if verbose:
        print(f"    Accepted {len(accepted_shots)}, rejected {sum(rejected_reasons.values())}")
        for reason, count in rejected_reasons.items():
            print(f"      - {reason}: {count}")

    # 出力
    if dry_run:
        if verbose:
            print(f"[*] DRY RUN: no files written")
    else:
        outdir.mkdir(parents=True, exist_ok=True)

        manifest = {
            'input_file': str(input_file),
            'input_channel': channel,
            'input_mono_mode': mono_mode,
            'input_sr': sr,
            'input_duration_sec': len(audio) / sr,
            'output_sr': params.rate_out,
            'parameters': params._asdict(),
            'num_detected': len(segments),
            'num_accepted': len(accepted_shots),
            'rejected': rejected_reasons,
            'shots': [],
        }

        for idx, (shot_audio, metadata) in enumerate(accepted_shots):
            shot_num = idx + 1
            shot_fname = f"{prefix}_{shot_num:02d}.wav"
            shot_path = outdir / shot_fname

            # 16bit PCM で書き出し
            soundfile.write(shot_path, shot_audio, params.rate_out, subtype='PCM_16')

            manifest['shots'].append({
                'file': shot_fname,
                **metadata,
            })

            if verbose:
                print(f"  [{shot_num}] {shot_fname}: {metadata['duration_sec_resampled']:.3f} sec, {metadata['peak_dbfs_after_norm']:.1f} dBFS")

        # manifest JSON 書き出し
        manifest_path = outdir / f"{prefix}_manifest.json"
        with open(manifest_path, 'w') as f:
            json.dump(manifest, f, indent=2)

        if verbose:
            print(f"\n[+] Manifest: {manifest_path}")

    # サマリー出力
    if verbose:
        durations = [m['duration_sec_resampled'] for _, m in accepted_shots]
        if durations:
            print(f"\n[Summary]")
            print(f"  Detected: {len(segments)}")
            print(f"  Accepted: {len(accepted_shots)}")
            print(f"  Duration (resampled): min={min(durations):.3f}s, median={np.median(durations):.3f}s, max={max(durations):.3f}s")
            print(f"  Output directory: {outdir}")


def main():
    parser = argparse.ArgumentParser(
        description='WAV チョッパー: 単発音素材を自動分割',
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument('--input', type=Path, required=True,
                        help='入力 WAV ファイル')
    parser.add_argument('--outdir', type=Path, required=True,
                        help='出力ディレクトリ')
    parser.add_argument('--prefix', type=str, required=True,
                        help='出力ファイル名プリフィックス')

    # オーディオ入力
    parser.add_argument('--channel', type=int, default=0,
                        help='抽出するチャンネル (0-indexed)')
    parser.add_argument('--mono-mode', choices=['channel', 'average'], default='channel',
                        help="モノラル化方法: 'channel'=指定ch のみ, 'average'=全ch平均")

    # RMS/オンセット検出
    parser.add_argument('--frame-ms', type=float, default=5.0,
                        help='RMS 窓長 (ms)')
    parser.add_argument('--hop-ms', type=float, default=1.0,
                        help='RMS ホップ (ms)')
    parser.add_argument('--floor-pct', type=float, default=20.0,
                        help='ノイズフロア推定パーセンタイル (0-100)')
    parser.add_argument('--onset-db', type=float, default=18.0,
                        help='オンセットしきい値マージン (dB)')
    parser.add_argument('--min-gap-ms', type=float, default=300.0,
                        help='同一ショット判定の最小間隔 (ms)')

    # ショット区間
    parser.add_argument('--pre-ms', type=float, default=5.0,
                        help='オンセット前のマージン (ms)')
    parser.add_argument('--decay-db', type=float, default=-45.0,
                        help='ディケイしきい値 (dB, 負値) — 低いほど尾を長く残す')
    parser.add_argument('--decay-hold-ms', type=float, default=30.0,
                        help='ディケイ継続判定期間 (ms)')
    parser.add_argument('--max-len-ms', type=float, default=2500.0,
                        help='ショットの最大長 (ms)')

    # 後処理
    parser.add_argument('--fade-in-ms', type=float, default=1.0,
                        help='フェードイン長 (ms)')
    parser.add_argument('--fade-out-ms', type=float, default=15.0,
                        help='フェードアウト長 (ms)')
    parser.add_argument('--peak-db', type=float, default=-1.0,
                        help='ピーク正規化目標 (dBFS)')
    parser.add_argument('--rate', type=int, default=48000,
                        help='出力サンプルレート (Hz)')

    # 選別
    parser.add_argument('--min-len-ms', type=float, default=120.0,
                        help='ショットの最小長 (ms)')
    parser.add_argument('--min-peak-db', type=float, default=-30.0,
                        help='ショットの最小ピーク (dBFS)')

    # 制御
    parser.add_argument('--limit', type=int, default=None,
                        help='先頭 N 個だけ出力（試行用）')
    parser.add_argument('--dry-run', action='store_true',
                        help='書き出さず検出結果だけ表示')

    args = parser.parse_args()

    # パラメータオブジェクト構築
    params = AudioParams(
        frame_ms=args.frame_ms,
        hop_ms=args.hop_ms,
        floor_pct=args.floor_pct,
        onset_db=args.onset_db,
        min_gap_ms=args.min_gap_ms,
        pre_ms=args.pre_ms,
        decay_db=args.decay_db,
        decay_hold_ms=args.decay_hold_ms,
        max_len_ms=args.max_len_ms,
        fade_in_ms=args.fade_in_ms,
        fade_out_ms=args.fade_out_ms,
        peak_db=args.peak_db,
        rate_out=args.rate,
        min_len_ms=args.min_len_ms,
        min_peak_db=args.min_peak_db,
    )

    run_chop(
        input_file=args.input,
        outdir=args.outdir,
        prefix=args.prefix,
        params=params,
        channel=args.channel,
        mono_mode=args.mono_mode,
        limit=args.limit,
        dry_run=args.dry_run,
        verbose=True,
    )


if __name__ == '__main__':
    main()

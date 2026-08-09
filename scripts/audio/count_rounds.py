"""銃声クリップに入っている発射弾数と発射レート(rpm)を実測する。

なぜ要るか: シム側が1トリガーで消費する弾数と、鳴らすクリップの中身が
食い違うと「30発鳴っているのに弾は2発しか減らない」という嘘になる
（2026-08-04 に実際そうなっていた）。SIM_TUNING.ROUNDS_PER_PULL と
Sfx.variantRounds はこのスクリプトの出力を正本にしている。数字を
変える時はここを回してから変えること。

    python scripts/audio/count_rounds.py                 # 既定の3系統
    python scripts/audio/count_rounds.py asset/audio/sfx/mg42_auto_01.wav

手法:
  - 2ms hop / 4ms 窓の RMS 包絡を作り、その正の差分（オンセット強度）を取る
  - 発射数 = オンセット強度のピーク数（min gap 30ms = 2000rpm 上限）
  - 発射レート = オンセット強度列の自己相関の最初のピーク周期
    連射は等間隔なので自己相関の方がピーク検出より頑健。実測値が実銃の
    公称レート（MG42 1200-1500 / Thompson 700 / StG44 500）と合うことが
    検出が効いていることの裏取りになる。
  - 弾数推定 = 発射区間 / 周期 + 1（残響でピークが潰れた分を補う）
"""

from __future__ import annotations

import glob
import os
import sys
import wave

import numpy as np

HOP_S = 0.002
WIN_S = 0.004
MIN_GAP_S = 0.030
PEAK_RATIO = 0.25
# 自己相関で探す周期の範囲。30ms=2000rpm 〜 200ms=300rpm
PERIOD_LO_S = 0.030
PERIOD_HI_S = 0.200

DEFAULT_PATTERNS = (
    "mg42_auto_*",
    "mg42_burst_*",
    "thompson_auto_*",
    "thompson_burst_*",
    "stg44_auto_*",
    "stg44_burst_*",
)
SFX_DIR = os.path.join("asset", "audio", "sfx")


def load_mono(path: str) -> tuple[np.ndarray, int]:
    """WAV をモノラル float [-1,1] で読む。"""
    with wave.open(path, "rb") as w:
        frames = w.getnframes()
        sr = w.getframerate()
        channels = w.getnchannels()
        width = w.getsampwidth()
        raw = w.readframes(frames)
    dtype = {1: np.int8, 2: np.int16, 4: np.int32}[width]
    x = np.frombuffer(raw, dtype=dtype).astype(np.float64)
    if channels > 1:
        x = x.reshape(-1, channels).mean(axis=1)
    peak = np.abs(x).max()
    return (x / peak if peak else x), sr


def onset_strength(x: np.ndarray, sr: int) -> np.ndarray:
    """RMS 包絡の正の差分＝オンセット強度。"""
    hop = int(sr * HOP_S)
    win = int(sr * WIN_S)
    count = (len(x) - win) // hop
    if count <= 0:
        return np.zeros(0)
    env = np.array([np.sqrt((x[i * hop:i * hop + win] ** 2).mean()) for i in range(count)])
    flux = np.diff(env, prepend=env[0])
    flux[flux < 0] = 0
    return flux


def peak_times(flux: np.ndarray) -> list[float]:
    """オンセット強度の局所ピーク時刻(秒)。"""
    if flux.size == 0 or flux.max() <= 0:
        return []
    norm = flux / flux.max()
    min_gap = int(MIN_GAP_S / HOP_S)
    times: list[float] = []
    last = -(10**9)
    for i in range(1, len(norm) - 1):
        if norm[i] < PEAK_RATIO:
            continue
        if norm[i] < norm[i - 1] or norm[i] < norm[i + 1]:
            continue
        if i - last < min_gap:
            continue
        times.append(i * HOP_S)
        last = i
    return times


def cyclic_period(flux: np.ndarray) -> float:
    """自己相関で連射周期(秒)を求める。単発クリップでは意味を持たない。"""
    if flux.size == 0:
        return 0.0
    centered = flux - flux.mean()
    ac = np.correlate(centered, centered, "full")[len(centered) - 1:]
    lo = int(PERIOD_LO_S / HOP_S)
    hi = min(int(PERIOD_HI_S / HOP_S), len(ac))
    if hi <= lo:
        return 0.0
    return (int(np.argmax(ac[lo:hi])) + lo) * HOP_S


def analyze(path: str) -> dict:
    x, sr = load_mono(path)
    flux = onset_strength(x, sr)
    peaks = peak_times(flux)
    period = cyclic_period(flux)
    span = (peaks[-1] - peaks[0]) if len(peaks) > 1 else 0.0
    est = (span / period + 1) if period > 0 and span > 0 else float(len(peaks))
    return {
        "file": os.path.basename(path),
        "onsets": len(peaks),
        "span_s": span,
        "period_ms": period * 1000,
        "rpm": (60 / period) if period > 0 else 0.0,
        "est_rounds": est,
        "clip_s": len(x) / sr,
    }


def main(argv: list[str]) -> int:
    paths: list[str] = []
    if len(argv) > 1:
        paths = argv[1:]
    else:
        for pattern in DEFAULT_PATTERNS:
            paths.extend(sorted(glob.glob(os.path.join(SFX_DIR, pattern + ".wav"))))
    if not paths:
        print("no wav matched (run from the repo root)", file=sys.stderr)
        return 1

    header = f"{'file':26s} {'onsets':>6s} {'span_s':>7s} {'period_ms':>9s} {'rpm':>6s} {'rounds':>7s}"
    print(header)
    print("-" * len(header))
    for path in paths:
        r = analyze(path)
        print(
            f"{r['file']:26s} {r['onsets']:6d} {r['span_s']:7.3f} "
            f"{r['period_ms']:9.1f} {r['rpm']:6.0f} {r['est_rounds']:7.1f}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

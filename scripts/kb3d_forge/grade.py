import argparse
import json
import sys
from pathlib import Path

try:
    import numpy as np
except ImportError:
    print("numpy required")
    sys.exit(1)

from PIL import Image


DEFAULT_CONFIG = {
    "knee_start": 0.85,
    "knee_compress": 0.55,
    "gamma": 1.08,
    "sat_scale": 0.90,
    "warm_hue": {
        "h_min_deg": 0,
        "h_max_deg": 40,
        "scale": 1.05,
    },
    "white_balance_amber": 0.03,
}


def rgb_to_hsv(rgb):
    r = rgb[:, 0]
    g = rgb[:, 1]
    b = rgb[:, 2]

    maximum = np.maximum(np.maximum(r, g), b)
    minimum = np.minimum(np.minimum(r, g), b)
    delta = maximum - minimum

    hue = np.zeros_like(maximum)
    nonzero = delta > 0.0

    red_max = nonzero & (maximum == r)
    green_max = nonzero & (maximum == g)
    blue_max = nonzero & (maximum == b)

    hue[red_max] = np.mod(
        (g[red_max] - b[red_max]) / delta[red_max],
        6.0,
    )
    hue[green_max] = (
        (b[green_max] - r[green_max]) / delta[green_max]
    ) + 2.0
    hue[blue_max] = (
        (r[blue_max] - g[blue_max]) / delta[blue_max]
    ) + 4.0
    hue /= 6.0

    saturation = np.zeros_like(maximum)
    value_nonzero = maximum > 0.0
    saturation[value_nonzero] = (
        delta[value_nonzero] / maximum[value_nonzero]
    )

    return np.stack((hue, saturation, maximum), axis=1)


def hsv_to_rgb(hsv):
    hue = np.mod(hsv[:, 0], 1.0)
    saturation = hsv[:, 1]
    value = hsv[:, 2]

    chroma = value * saturation
    hue_sector = hue * 6.0
    x_value = chroma * (1.0 - np.abs(np.mod(hue_sector, 2.0) - 1.0))
    match = value - chroma

    red = np.zeros_like(value)
    green = np.zeros_like(value)
    blue = np.zeros_like(value)

    masks = (
        (hue_sector < 1.0),
        (hue_sector >= 1.0) & (hue_sector < 2.0),
        (hue_sector >= 2.0) & (hue_sector < 3.0),
        (hue_sector >= 3.0) & (hue_sector < 4.0),
        (hue_sector >= 4.0) & (hue_sector < 5.0),
        (hue_sector >= 5.0),
    )

    red[masks[0]], green[masks[0]] = chroma[masks[0]], x_value[masks[0]]
    red[masks[1]], green[masks[1]] = x_value[masks[1]], chroma[masks[1]]
    green[masks[2]], blue[masks[2]] = chroma[masks[2]], x_value[masks[2]]
    green[masks[3]], blue[masks[3]] = x_value[masks[3]], chroma[masks[3]]
    red[masks[4]], blue[masks[4]] = x_value[masks[4]], chroma[masks[4]]
    red[masks[5]], blue[masks[5]] = chroma[masks[5]], x_value[masks[5]]

    return np.stack((red + match, green + match, blue + match), axis=1)


def load_config(path):
    config = {
        key: value.copy() if isinstance(value, dict) else value
        for key, value in DEFAULT_CONFIG.items()
    }
    if path is None:
        path = Path(__file__).with_name("grade_config.json")

    with open(path, "r", encoding="utf-8") as handle:
        loaded = json.load(handle)

    for key, value in loaded.items():
        if key == "warm_hue" and isinstance(value, dict):
            config["warm_hue"].update(value)
        else:
            config[key] = value
    return config


def grade_rgb(rgb, config):
    hsv = rgb_to_hsv(rgb)

    knee_start = float(config["knee_start"])
    knee_compress = float(config["knee_compress"])
    gamma = float(config["gamma"])
    sat_scale = float(config["sat_scale"])
    warm = config["warm_hue"]
    wb = float(config["white_balance_amber"])

    value = hsv[:, 2]
    over_knee = value > knee_start
    value[over_knee] = (
        knee_start + (value[over_knee] - knee_start) * knee_compress
    )
    hsv[:, 2] = value ** gamma

    hsv[:, 1] *= sat_scale
    hue_degrees = hsv[:, 0] * 360.0
    warm_mask = (
        (hue_degrees >= float(warm["h_min_deg"]))
        & (hue_degrees <= float(warm["h_max_deg"]))
    )
    hsv[warm_mask, 1] *= float(warm["scale"])

    graded = hsv_to_rgb(hsv)
    graded[:, 0] *= 1.0 + wb
    graded[:, 2] *= 1.0 - wb
    return np.clip(graded, 0.0, 1.0)


def percentile_text(values):
    if values.size == 0:
        return "nan/nan/nan"
    p10, p50, p90 = np.percentile(values, (10, 50, 90))
    return "%.3f/%.3f/%.3f" % (p10, p50, p90)


def process_file(input_path, output_path, config):
    with Image.open(input_path) as image:
        rgba = np.asarray(image.convert("RGBA"), dtype=np.uint8).copy()

    alpha = rgba[:, :, 3]
    selected = alpha > 0
    rgb = rgba[:, :, :3].astype(np.float32) / 255.0

    input_hsv = rgb_to_hsv(rgb[selected])
    output_rgb = rgb.copy()

    if np.any(selected):
        output_rgb[selected] = grade_rgb(rgb[selected], config)

    output_hsv = rgb_to_hsv(output_rgb[selected])
    rgba[:, :, :3] = np.rint(output_rgb * 255.0).astype(np.uint8)

    Image.fromarray(rgba, mode="RGBA").save(output_path)
    return input_hsv, output_hsv


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--in-dir", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--config")
    parser.add_argument("--report", action="store_true")
    return parser.parse_args()


def main():
    args = parse_args()
    input_dir = Path(args.in_dir).resolve()
    output_dir = Path(args.out_dir).resolve()

    if input_dir == output_dir:
        print("ERROR input and output directories must differ")
        sys.exit(1)

    config = load_config(args.config)
    output_dir.mkdir(parents=True, exist_ok=True)

    input_s = []
    input_v = []
    output_s = []
    output_v = []
    files = sorted(input_dir.glob("*.png"))

    for input_path in files:
        in_hsv, out_hsv = process_file(
            input_path,
            output_dir / input_path.name,
            config,
        )
        input_s.append(in_hsv[:, 1])
        input_v.append(in_hsv[:, 2])
        output_s.append(out_hsv[:, 1])
        output_v.append(out_hsv[:, 2])

    if args.report:
        in_s_values = (
            np.concatenate(input_s) if input_s else np.array([], dtype=np.float32)
        )
        in_v_values = (
            np.concatenate(input_v) if input_v else np.array([], dtype=np.float32)
        )
        out_s_values = (
            np.concatenate(output_s) if output_s else np.array([], dtype=np.float32)
        )
        out_v_values = (
            np.concatenate(output_v) if output_v else np.array([], dtype=np.float32)
        )
        print(
            "REPORT in  s p10/50/90 = %s v p10/50/90 = %s"
            % (percentile_text(in_s_values), percentile_text(in_v_values))
        )
        print(
            "REPORT out s p10/50/90 = %s v p10/50/90 = %s"
            % (percentile_text(out_s_values), percentile_text(out_v_values))
        )

    print("GRADE OK files=%d" % len(files))


if __name__ == "__main__":
    main()

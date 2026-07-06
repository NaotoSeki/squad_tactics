"""
Noise field generation using OpenSimplex with domain warping.
Produces large continuous terrain textures that tile seamlessly when sampled.
"""

import numpy as np
from opensimplex import OpenSimplex


def generate_field(w, h, seed, palette, scale=0.012):
    """Generate a continuous terrain texture field.

    Args:
        w, h: Field dimensions in pixels
        seed: Random seed for noise
        palette: Dict with keys 'a','b','c','d' mapping to np.array RGB colors
        scale: World-space scale factor (smaller = larger patterns)

    Returns:
        np.ndarray (h, w, 3) with RGB values in [0, 1]
    """
    o1 = OpenSimplex(seed=seed)
    o2 = OpenSimplex(seed=seed + 100)
    o3 = OpenSimplex(seed=seed + 200)
    o4 = OpenSimplex(seed=seed + 300)

    field = np.zeros((h, w, 3))
    for y in range(h):
        for x in range(w):
            wx = x * scale
            wy = y * scale
            # Domain warping for organic patterns
            warp_x = o3.noise2(wx * 0.7 + 1.7, wy * 0.7 + 9.2) * 0.45
            warp_y = o4.noise2(wx * 0.7 + 8.3, wy * 0.7 + 2.8) * 0.45
            # Multi-octave sampling
            n1 = o1.noise2(wx + warp_x, wy + warp_y)
            n2 = o2.noise2((wx + warp_x) * 2.8, (wy + warp_y) * 2.8)
            n3 = o1.noise2(wx * 9, wy * 9)

            t = (n1 + 1) / 2 * 0.48 + (n2 + 1) / 2 * 0.32 + (n3 + 1) / 2 * 0.20

            # Color mapping with 3 bands
            if t > 0.6:
                bl = (t - 0.6) / 0.4
                color = palette['b'] * (1 - bl) + palette['a'] * bl
            elif t > 0.3:
                bl = (t - 0.3) / 0.3
                color = palette['c'] * (1 - bl) + palette['b'] * bl
            else:
                color = palette['c'].copy()

            # Warm/accent patches
            warm = o2.noise2(wx * 1.5, wy * 1.5)
            if warm > 0.15:
                bl = min(1, (warm - 0.15) * 0.3)
                color = color * (1 - bl) + palette['d'] * bl

            # Fine grain texture
            color += (n3 + 1) / 2 * 0.025
            field[y, x] = color

    # Subtle lighting from gradient
    green = field[:, :, 1]
    gy, gx = np.gradient(green)
    shadow = np.clip(-gx * 0.35 + gy * 0.25, -0.05, 0.05)
    field += shadow[:, :, np.newaxis]
    return np.clip(field, 0, 1)


# === Standard Palettes ===

PALETTES = {
    'grass': {
        'a': np.array([0.52, 0.55, 0.35]),
        'b': np.array([0.44, 0.48, 0.30]),
        'c': np.array([0.37, 0.41, 0.26]),
        'd': np.array([0.50, 0.49, 0.33]),
    },
    'forest': {
        'a': np.array([0.30, 0.38, 0.21]),
        'b': np.array([0.22, 0.30, 0.15]),
        'c': np.array([0.16, 0.23, 0.10]),
        'd': np.array([0.26, 0.34, 0.18]),
    },
    'water': {
        'a': np.array([0.35, 0.43, 0.48]),
        'b': np.array([0.28, 0.36, 0.42]),
        'c': np.array([0.22, 0.29, 0.36]),
        'd': np.array([0.30, 0.38, 0.44]),
    },
    'dirt': {
        'a': np.array([0.52, 0.47, 0.36]),
        'b': np.array([0.44, 0.40, 0.30]),
        'c': np.array([0.37, 0.34, 0.25]),
        'd': np.array([0.48, 0.43, 0.32]),
    },
}

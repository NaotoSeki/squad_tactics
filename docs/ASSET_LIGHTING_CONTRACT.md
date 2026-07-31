# Asset lighting contract

All reconstructed map assets use one shared lighting model so independently
generated sprites read as parts of the same battlefield.

## `ps-overcast-upper-left-v1`

- Camera: elevated PS-native 2:1 isometric/top-down view.
- Key direction: light arrives from the screen upper-left.
- Shadow direction: relief and cast shadows travel toward the screen lower-right.
- Shadow screen vector: approximately `(0.72, 0.69)` before per-asset PS
  calibration.
- Elevation: approximately 55 degrees. Ground relief stays shallow.
- Source size: large overcast source, with soft penumbrae and no hard sun edge.
- Ambient fill: high, approximately 0.72, retaining the subdued PS contrast.
- Color: neutral daylight, approximately 6000 K, without orange or blue grading.
- Specular response: restrained. Dry soil, bark, foliage, stone, and wood must not
  look wet, glossy, HDR, or studio-lit.

Ground decals contain only micro-relief shading. They do not add a detached cast
shadow or a raised floor plane. Trees and raised objects may cast a soft
lower-right shadow, but its position, extent, and density are calibrated to the
canonical PS asset. A second key light, front flash, rim light, and cinematic
backlight are prohibited.

Every ImageGen edit prompt must include this exact invariant:

> Lighting/mood: use only the shared `ps-overcast-upper-left-v1` lighting:
> one large soft neutral key arriving from screen upper-left, high overcast
> ambient fill, highlights on upper-left-facing relief, and every micro-shadow
> or cast shadow toward screen lower-right. No second light, front flash, rim
> light, hard sun, HDR, or cinematic grading.

The canonical PS image remains the final palette and footprint authority. The
shared direction controls newly reconstructed sub-pixel detail; it does not
authorize changing the original silhouette, placement, anchor, or material.

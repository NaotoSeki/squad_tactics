# Original splatter FX workstream

Panzer Strike material is a non-shipping quality teacher only. Reference frames,
decoded pixels, crops, derivatives and learned weights are forbidden in runtime
assets and release bundles. Measurements may define abstract acceptance bands;
all shipped pixels or procedural geometry must be created independently.

## Evaluation contract

Measure each candidate as a time series at 60 Hz: visible duration, particle
count, occupied width/height, centroid displacement, upward/downward velocity,
angular spread, peak-area time, opacity decay, color range and resting residue.
Store medians plus 10th/90th percentiles by material. A candidate passes the
automatic gate only when it stays inside the approved band for duration, peak
time, spread and decay, has a complete provenance sidecar, and contains no
research-only path or hash.

Human A/B review is blind and compares only motion qualities. Two reviewers
must both accept readability at gameplay zoom, material identity, timing,
silhouette variety and absence of obvious looping. Reviewers never select or
copy a reference frame. A disagreement returns the candidate to iteration.

## Independent generation and promotion

1. Generate candidates from project-owned Blender scenes, documented procedural
   profiles, or models whose license and prompt permit commercial output.
2. Record tool/model versions, seed, full settings or prompt, source hashes,
   ownership, transforms, output hashes and reviewer decisions.
3. Compare metrics and run blind A/B. Only approved candidates move from
   `candidate` to `release` status.
4. Add the approved logical role to `FxPacks.original`; never branch gameplay on
   a vendor/source name.
5. Run provenance/hash tests and the release-file guard before packaging.

## Material order

1. Dirt: establishes ballistic arcs, gravity, fading and the runtime hook.
2. Grass/leaves: adds thin rotating silhouettes and wind response.
3. Wood: adds elongated chips and directional breakage.
4. Stone: adds heavier short arcs and limited bounce.
5. Wall dust: combines mineral chips with a slower powder envelope.
6. Explosion debris: composes approved materials under a strict particle budget.

The first vertical slice is `original.dirt.v1`. It is a code-native procedural
asset under `asset/fx/original_splatter`, uses a deterministic seed, and layers
onto the existing bullet-impact smoke without changing damage, event timing or
persistent decal behavior.

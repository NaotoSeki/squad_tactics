/** Project-owned, procedural impact-splatter profiles. No reference pixels are used. */
(function (root) {
  'use strict';
  root.OriginalSplatterProfiles = Object.freeze({
    version: 1,
    profiles: Object.freeze({
      dirt: Object.freeze({
        id: 'original.dirt.v1', releaseSafe: true,
        particleCount: Object.freeze([7, 11]), lifeFrames: Object.freeze([18, 34]),
        speedPxPerFrame: Object.freeze([1.4, 4.8]), launchAngleDeg: Object.freeze([205, 335]),
        verticalBias: -1.8, gravityPxPerFrame2: 0.16,
        sizePx: Object.freeze([1.4, 3.8]),
        colors: Object.freeze(['#493b2b', '#65523a', '#806847', '#9a8058']),
        alpha: Object.freeze([0.58, 0.9]), delayFrames: Object.freeze([0, 3])
      })
    })
  });
})(typeof window !== 'undefined' ? window : globalThis);

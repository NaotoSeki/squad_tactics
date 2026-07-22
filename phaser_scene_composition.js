'use strict';

/**
 * PS-STYLE SCENE COMPOSITION  (reverse-engineered from Panzer Strike)
 *
 * Ground truth (config PanzerStrike.sdt + RenderDoc D3D9-hook log + driver disasm):
 *   - PS renders sprites as GPU textures (device:hardware, driver:direct3d9).
 *   - Sprite source data is DITHERED ([coverage,index], premult-over codec).
 *   - display.scale game:100 ; display.colors { gamma, sharpness }.
 *   => On-screen smoothness = hardware BILINEAR texture filtering (dissolves the
 *      dither at draw scale) + a gamma/SHARPNESS post-process. Bilinear alone is
 *      mushy; the sharpness pass restores edge detail => smooth AND detailed.
 *
 * We're a GPU renderer too (Phaser/WebGL), so we reproduce PS's actual method:
 *   - LINEAR filtering on sprites (Phaser default; NEAREST was a mistake, reverted).
 *   - A camera post-process: unsharp-mask SHARPEN + color grade (contrast/sat/gamma),
 *     matching PS's colors{gamma, sharpness}.
 *
 * Also hosts the premultiplied blend used by PS fmt723 sprites (essential for the
 * translucent fire/explosion sprites that come next).
 */
window.SceneComposition = {
  // Tunable in one place. sharp≈PS sharpness, gamma≈PS gamma.
  params: { sharp: 0.55, contrast: 1.12, saturate: 1.14, gamma: 1.02 },

  _registered: false,
  _premultMode: undefined,

  _frag: [
    'precision mediump float;',
    'uniform sampler2D uMainSampler;',
    'uniform vec2 uResolution;',
    'uniform float uSharp;',
    'uniform float uContrast;',
    'uniform float uSaturate;',
    'uniform float uGamma;',
    'varying vec2 outTexCoord;',
    'void main(){',
    '  vec2 px = 1.0 / uResolution;',
    '  vec3 c = texture2D(uMainSampler, outTexCoord).rgb;',
    '  vec3 b = (texture2D(uMainSampler, outTexCoord + vec2(px.x,0.0)).rgb',
    '         +  texture2D(uMainSampler, outTexCoord - vec2(px.x,0.0)).rgb',
    '         +  texture2D(uMainSampler, outTexCoord + vec2(0.0,px.y)).rgb',
    '         +  texture2D(uMainSampler, outTexCoord - vec2(0.0,px.y)).rgb) * 0.25;',
    '  c = c + uSharp * (c - b);',                    // unsharp-mask sharpen
    '  c = (c - 0.5) * uContrast + 0.5;',             // contrast
    '  float l = dot(c, vec3(0.299, 0.587, 0.114));',
    '  c = mix(vec3(l), c, uSaturate);',              // saturation
    '  c = pow(max(c, vec3(0.0)), vec3(1.0 / uGamma));', // gamma
    '  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);',
    '}'
  ].join('\n'),

  _definePipeline(scene) {
    if (this._registered) return true;
    var renderer = scene && scene.renderer;
    if (!renderer || !renderer.pipelines || !window.Phaser ||
        !Phaser.Renderer || !Phaser.Renderer.WebGL ||
        !Phaser.Renderer.WebGL.Pipelines || !Phaser.Renderer.WebGL.Pipelines.PostFXPipeline) {
      return false; // canvas renderer / unsupported
    }
    var frag = this._frag;
    var PSGrade = function (game) {
      Phaser.Renderer.WebGL.Pipelines.PostFXPipeline.call(this, { game: game, name: 'PSGrade', fragShader: frag });
    };
    PSGrade.prototype = Object.create(Phaser.Renderer.WebGL.Pipelines.PostFXPipeline.prototype);
    PSGrade.prototype.constructor = PSGrade;
    PSGrade.prototype.onPreRender = function () {
      var p = window.SceneComposition.params;
      this.set1f('uSharp', p.sharp);
      this.set1f('uContrast', p.contrast);
      this.set1f('uSaturate', p.saturate);
      this.set1f('uGamma', p.gamma);
      this.set2f('uResolution', this.renderer.width, this.renderer.height);
    };
    try {
      renderer.pipelines.addPostPipeline('PSGrade', PSGrade);
    } catch (e) {
      console.warn('[SceneComposition] pipeline register failed:', e);
      return false;
    }
    this._registered = true;
    return true;
  },

  /** Apply PS-style post (sharpen + grade) to a camera (idempotent). */
  applyGrade(scene, camera) {
    var cam = camera || (scene && scene.cameras && scene.cameras.main);
    if (!cam) return;
    if (!this._definePipeline(scene)) return; // fallback: no post
    if (cam.__psGraded) return;
    try { cam.setPostPipeline('PSGrade'); cam.__psGraded = true; }
    catch (e) { console.warn('[SceneComposition] setPostPipeline failed:', e); }
  },

  /** Premultiplied-over blend (out = src + dst*(1-srcA)) for PS fmt723 sprites. */
  premultBlend(scene) {
    var r = scene && scene.renderer;
    if (!r || !r.gl || !r.addBlendMode) return null;
    if (this._premultMode === undefined) {
      var gl = r.gl;
      this._premultMode = r.addBlendMode([gl.ONE, gl.ONE_MINUS_SRC_ALPHA], gl.FUNC_ADD);
    }
    return this._premultMode;
  }
};

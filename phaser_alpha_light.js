'use strict';

/**
 * Shared alpha-space lighting for live battlefield sprites.
 *
 * Both sunlight and short-lived point lights reuse the visible texture/frame
 * alpha. This keeps houses, trees, soldiers, and muzzle lighting in one visual
 * model instead of mixing ellipses, baked shadows, and unrelated rim effects.
 */
(function (global) {
  const SUN = Object.freeze({
    // Sun arrives from the upper-left; cast shadows travel east/south-east.
    x: 0.925,
    y: 0.380,
    castScale: 0.34,
    flatten: 0.28,
    widthScale: 1.04,
    alpha: 0.38,
    tint: 0x000000,
  });

  function finite(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function textureKey(source) {
    return source && source.texture && source.texture.key
      ? source.texture.key
      : (source && source.key);
  }

  function frameName(source) {
    return source && source.frame && source.frame.name != null
      ? source.frame.name
      : undefined;
  }

  function cloneAlpha(scene, source) {
    const key = textureKey(source);
    if (!scene || !scene.add || !scene.add.image || !key) return null;
    return scene.add.image(source.x || 0, source.y || 0, key, frameName(source));
  }

  function applyFrameAndPose(copy, source) {
    if (!copy || !source) return;
    const key = textureKey(source);
    if (key && copy.texture && copy.texture.key !== key && copy.setTexture) {
      copy.setTexture(key, frameName(source));
    } else if (source.frame && copy.setFrame) {
      copy.setFrame(source.frame.name);
    }
    if (copy.setOrigin) copy.setOrigin(finite(source.originX, 0.5), finite(source.originY, 0.5));
    if (copy.setFlip) copy.setFlip(!!source.flipX, !!source.flipY);
    else if (copy.setFlipX) copy.setFlipX(!!source.flipX);
    if (copy.setRotation) copy.setRotation(finite(source.rotation, 0));
    if (copy.setVisible) copy.setVisible(source.visible !== false);
  }

  function setGroundDarken(copy, tint) {
    if (!copy) return;
    // A solid tint-fill turns the source artwork into an actual alpha mask.
    // NORMAL alpha compositing then removes luminance from the ground reliably;
    // Phaser's MULTIPLY path was renderer-dependent and almost invisible on the
    // bright rural terrain.
    if (copy.setTintFill) copy.setTintFill(tint);
    else if (copy.setTint) copy.setTint(tint);
    if (!copy.setBlendMode || typeof Phaser === 'undefined' || !Phaser.BlendModes) return;
    copy.setBlendMode(Phaser.BlendModes.NORMAL);
  }

  function setAdd(copy) {
    if (!copy || !copy.setBlendMode || typeof Phaser === 'undefined' || !Phaser.BlendModes) return;
    copy.setBlendMode(Phaser.BlendModes.ADD);
  }

  const AlphaLightSpace = {
    SUN,

    /** Update a persistent sun shadow from the source's current alpha frame. */
    syncSunShadow(shadow, source, options) {
      if (!shadow || !source) return shadow;
      const opts = Object.assign({}, shadow._alphaLightOptions || {}, options || {});
      shadow._alphaLightOptions = opts;
      applyFrameAndPose(shadow, source);

      const height = Math.max(1, Math.abs(finite(source.displayHeight, 0)));
      const originX = finite(source.originX, 0.5);
      const originY = finite(source.originY, 0.5);
      const vector = opts.vector || SUN;
      const castScale = finite(opts.castScale, SUN.castScale);
      const flatten = finite(opts.flatten, SUN.flatten);
      const widthScale = finite(opts.widthScale, SUN.widthScale);
      // Keep the mask connected to the object's foot while retaining a clear
      // south-east projection. Only part of the projected length is positional;
      // the flattened silhouette itself supplies the remainder.
      const castX = vector.x * height * castScale * 0.72;
      const castY = vector.y * height * castScale * 0.72;
      const flatHeight = height * flatten;
      const baseY = finite(source.y, 0) + height * (1 - originY);

      if (shadow.setOrigin) shadow.setOrigin(originX, originY);
      if (shadow.setScale) {
        shadow.setScale(
          finite(source.scaleX, 1) * widthScale,
          finite(source.scaleY, 1) * flatten
        );
      }
      if (shadow.setPosition) {
        shadow.setPosition(
          finite(source.x, 0) + castX,
          baseY - flatHeight * (1 - originY) + castY
        );
      }
      setGroundDarken(shadow, opts.tint == null ? SUN.tint : opts.tint);
      if (shadow.setAlpha) {
        const sourceAlpha = Number.isFinite(source.alpha) ? source.alpha : 1;
        shadow.setAlpha(finite(opts.alpha, SUN.alpha) * sourceAlpha);
      }
      if (shadow.setDepth && Number.isFinite(opts.depth)) shadow.setDepth(opts.depth);
      shadow._alphaLightSunShadow = true;
      shadow._alphaLightDarkensGround = true;
      return shadow;
    },

    /** Create a persistent projected sun shadow from a live sprite/image. */
    createSunShadow(scene, source, options) {
      const shadow = cloneAlpha(scene, source);
      if (!shadow) return null;
      this.syncSunShadow(shadow, source, options);
      return shadow;
    },

    /**
     * Apply a short point light to the same alpha silhouette.
     * Produces a warm light-facing rim and a faint opposite cast shadow.
     */
    flashAlpha(scene, source, lightX, lightY, radius, options) {
      if (!scene || !scene.tweens || !source) return false;
      const opts = options || {};
      const worldX = finite(opts.worldX, finite(source.x, 0));
      const worldY = finite(opts.worldY, finite(source.y, 0));
      const dx = lightX - worldX;
      const dy = lightY - worldY;
      const dist = Math.hypot(dx, dy);
      if (dist > radius) return false;
      const gain = 1 - dist / Math.max(1, radius);
      const inv = dist > 1 ? 1 / dist : 0;
      const nx = dx * inv;
      const ny = dy * inv;
      const parent = opts.parent || null;
      const shadowLayer = opts.shadowLayer || null;

      const pointShadow = cloneAlpha(scene, source);
      if (pointShadow) {
        this.syncSunShadow(pointShadow, source, {
          vector: { x: -nx, y: -ny },
          castScale: 0.12 + gain * 0.10,
          flatten: finite(opts.pointFlatten, 0.32),
          widthScale: 1.02,
          alpha: 0.035 + gain * 0.075,
          tint: 0x11100d,
          depth: opts.shadowDepth,
        });
        pointShadow._alphaLightPointShadow = true;
        if (parent && parent.addAt) {
          const sourceIndex = parent.getIndex ? parent.getIndex(source) : 0;
          parent.addAt(pointShadow, sourceIndex >= 0 ? sourceIndex : 0);
        } else if (shadowLayer && shadowLayer.add) {
          shadowLayer.add(pointShadow);
        }
        scene.tweens.add({
          targets: pointShadow,
          alpha: 0,
          duration: finite(opts.duration, 92),
          ease: 'Cubic.out',
          onComplete: () => { if (pointShadow.active) pointShadow.destroy(); },
        });
      }

      const rim = cloneAlpha(scene, source);
      if (rim) {
        applyFrameAndPose(rim, source);
        if (rim.setPosition) rim.setPosition(
          finite(source.x, 0) + nx * (1.8 + gain * 1.8),
          finite(source.y, 0) + ny * (1.8 + gain * 1.8)
        );
        if (rim.setScale) rim.setScale(finite(source.scaleX, 1), finite(source.scaleY, 1));
        if (rim.setTint) rim.setTint(opts.tint == null ? 0xffaa5c : opts.tint);
        if (rim.setAlpha) rim.setAlpha(0.055 + gain * 0.20);
        if (rim.setDepth && Number.isFinite(opts.rimDepth)) rim.setDepth(opts.rimDepth);
        setAdd(rim);
        rim._alphaLightRim = true;
        if (parent && parent.add) parent.add(rim);
        scene.tweens.add({
          targets: rim,
          alpha: 0,
          duration: finite(opts.duration, 92),
          ease: 'Cubic.out',
          onComplete: () => { if (rim.active) rim.destroy(); },
        });
      }
      return !!(pointShadow || rim);
    },
  };

  global.AlphaLightSpace = AlphaLightSpace;
})(typeof window !== 'undefined' ? window : globalThis);

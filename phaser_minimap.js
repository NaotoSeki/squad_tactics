/** Tactical minimap shared by the production and sim battle views. */
(function () {
  'use strict';

  class TacticalMinimap {
    constructor(scene) {
      this.scene = scene;
      this.main = scene.cameras.main;
      this.bounds = null;
      this._onResize = () => this.layout();

      const old = document.getElementById('tactical-minimap-frame');
      if (old) old.remove();
      this.frame = document.createElement('div');
      this.frame.id = 'tactical-minimap-frame';
      this.frame.innerHTML = '<span>TACTICAL MAP</span>';
      Object.assign(this.frame.style, {
        position: 'fixed', left: '12px', top: '12px', zIndex: '1150',
        border: '1px solid rgba(221,170,68,.75)',
        boxShadow: '0 3px 14px rgba(0,0,0,.7)',
        background: 'rgba(10,14,9,.08)', overflow: 'hidden',
        pointerEvents: 'auto', cursor: 'crosshair', boxSizing: 'border-box'
      });
      const label = this.frame.firstChild;
      Object.assign(label.style, {
        position: 'absolute', left: '5px', top: '3px', zIndex: '1',
        color: '#d9bc72', font: 'bold 8px monospace', letterSpacing: '1px',
        textShadow: '0 1px 2px #000', pointerEvents: 'none'
      });
      document.body.appendChild(this.frame);

      this.camera = scene.cameras.add(12, 12, 200, 145, false, 'TacticalMinimap');
      this.camera.setBackgroundColor(0x25271b);
      this.camera.setRoundPixels(true);
      this.viewportGraphic = scene.add.graphics().setDepth(99999);
      this.main.ignore(this.viewportGraphic);

      this.frame.addEventListener('pointerdown', (event) => this.recenter(event));
      scene.scale.on('resize', this._onResize);
      scene.events.once('shutdown', () => this.destroy());
      this.layout();
    }

    layout() {
      if (!this.camera || !this.scene) return;
      const mapViewportW = this.main ? this.main.width : this.scene.scale.width;
      const w = Math.max(164, Math.min(224, Math.round(mapViewportW * 0.21)));
      const h = Math.round(w * 0.72);
      this.frame.style.width = w + 'px';
      this.frame.style.height = h + 'px';
      this.camera.setViewport(12, 12, w, h);
      if (this.bounds) this.fit(this.bounds);
    }

    fit(bounds) {
      if (!bounds || !(bounds.w > 0) || !(bounds.h > 0)) return;
      this.bounds = { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
      const zoom = Math.min(
        Math.max(1, this.camera.width - 8) / bounds.w,
        Math.max(1, this.camera.height - 8) / bounds.h
      );
      this.camera.setZoom(Math.max(0.01, zoom));
      this.camera.centerOn(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2);
    }

    update() {
      if (!this.viewportGraphic || !this.main || !this.camera) return;
      const view = this.main.worldView;
      this.viewportGraphic.clear();
      this.viewportGraphic.lineStyle(Math.max(1, 2 / this.camera.zoom), 0xffdf76, 0.95);
      this.viewportGraphic.strokeRect(view.x, view.y, view.width, view.height);
    }

    recenter(event) {
      if (!this.camera || !this.main) return;
      const rect = this.frame.getBoundingClientRect();
      const localX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
      const localY = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
      const view = this.camera.worldView;
      this.main.centerOn(
        view.x + localX / this.camera.zoom,
        view.y + localY / this.camera.zoom
      );
    }

    destroy() {
      if (this.scene && this.scene.scale) this.scene.scale.off('resize', this._onResize);
      if (this.frame) this.frame.remove();
      if (this.viewportGraphic && this.viewportGraphic.active) this.viewportGraphic.destroy();
      if (this.scene && this.camera) this.scene.cameras.remove(this.camera);
      this.frame = null;
      this.viewportGraphic = null;
      this.camera = null;
    }
  }

  window.TacticalMinimap = TacticalMinimap;
}());

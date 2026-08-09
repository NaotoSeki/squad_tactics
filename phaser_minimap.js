/**
 * Tactical minimap shared by the production and sim battle views.
 *
 * これは「盤面の縮小写真」ではない。**抽象化した戦術図**である。
 * 旧実装は Phaser のカメラをもう一台足して本物のシーンをそのまま縮小描画して
 * いた。見た目が実画面のミニチュアになって読みづらいうえ、毎フレーム全シーンを
 * もう一度描くので純粋に高い（立体物・植生・VFX まで巻き込む）。
 *
 * 現在は DOM の 2D canvas 一枚で完結する:
 *   - 地形は生成時に一度だけベイク（hex ごとの色ブロック）
 *   - 毎フレーム描くのはベイク画像の貼付け + ユニットの点 + 視界枠だけ
 * Phaser 側のオブジェクトもカメラも持たないので、シーンの描画コストはゼロ。
 */
(function () {
  'use strict';

  // 抽象図の配色。実際の地面テクスチャとは合わせない（読めることが最優先）。
  // data.js TERRAIN の id に対応（-1 VOID / 0 荒地 / 1 草原 / 2 森林 / 3 道路 /
  // 4 廃墟 / 6 建物 / 7 畑）。未知の id は草地扱い（穴を開けない）。
  const TERRAIN_COLORS = {
    0: '#4a4336', // 荒地
    1: '#39482a', // 草原
    2: '#20301c', // 森林
    3: '#6d6553', // 道路（明るく＝線として読ませる）
    4: '#544c44', // 廃墟
    5: '#27384a', // 水域
    6: '#7d7263', // 建物
    7: '#4e5331', // 畑
  };
  const TERRAIN_DEFAULT = '#39482a';
  const FIELD_BG = '#12150f'; // 盤外（VOID）
  const COLOR_ALLY = '#8fe6cf';
  const COLOR_FOE = '#e2705d';
  const COLOR_VIEW = '#ffdf76';
  const REDRAW_MS = 60; // ミニマップに 60fps は要らない

  class TacticalMinimap {
    constructor(scene) {
      this.scene = scene;
      this.main = scene.cameras.main;
      this.bounds = null;
      this.baked = null;
      this._bakeKey = '';
      this._lastDraw = 0;
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
        background: FIELD_BG, overflow: 'hidden',
        pointerEvents: 'auto', cursor: 'crosshair', boxSizing: 'border-box'
      });
      const label = this.frame.firstChild;
      Object.assign(label.style, {
        position: 'absolute', left: '5px', top: '3px', zIndex: '1',
        color: '#d9bc72', font: 'bold 8px monospace', letterSpacing: '1px',
        textShadow: '0 1px 2px #000', pointerEvents: 'none'
      });
      this.canvas = document.createElement('canvas');
      Object.assign(this.canvas.style, {
        position: 'absolute', left: '0', top: '0', width: '100%', height: '100%',
        display: 'block', pointerEvents: 'none'
      });
      this.frame.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      document.body.appendChild(this.frame);

      this.frame.addEventListener('pointerdown', (event) => this.recenter(event));
      scene.scale.on('resize', this._onResize);
      scene.events.once('shutdown', () => this.destroy());
      this.layout();
    }

    layout() {
      if (!this.frame || !this.scene) return;
      const mapViewportW = this.main ? this.main.width : this.scene.scale.width;
      const w = Math.max(164, Math.min(224, Math.round(mapViewportW * 0.21)));
      const h = Math.round(w * 0.72);
      this.frame.style.width = w + 'px';
      this.frame.style.height = h + 'px';
      const dpr = Math.min(2, (window.devicePixelRatio || 1));
      this.cssW = w; this.cssH = h; this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this._bakeKey = ''; // 寸法が変わったら地形は焼き直し
      this.draw(true);
    }

    /** 盤面のワールド範囲。ここが決まって初めて投影できる。 */
    fit(bounds) {
      if (!bounds || !(bounds.w > 0) || !(bounds.h > 0)) return;
      this.bounds = { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
      this._bakeKey = '';
      this.draw(true);
    }

    setVisible(visible) {
      if (this.frame) this.frame.style.visibility = visible ? '' : 'hidden';
    }

    update() {
      this.draw(false);
    }

    /** ワールド座標 -> ミニマップ CSS px。盤面はアスペクト比を保って内接させる。 */
    _project() {
      if (!this.bounds || !this.cssW) return null;
      const pad = 4;
      const s = Math.min((this.cssW - pad * 2) / this.bounds.w, (this.cssH - pad * 2) / this.bounds.h);
      return {
        s,
        ox: (this.cssW - this.bounds.w * s) / 2 - this.bounds.x * s,
        oy: (this.cssH - this.bounds.h * s) / 2 - this.bounds.y * s,
      };
    }

    /** 地形グリッドの取得元は本編(gameLogic.map)と sim(scene.mapData.grid)で違う。 */
    _grid() {
      const sceneGrid = this.scene && this.scene.mapData && this.scene.mapData.grid;
      if (sceneGrid && sceneGrid.length) return sceneGrid;
      const gl = window.gameLogic;
      return gl && gl.map && gl.map.length ? gl.map : null;
    }

    /** 地形は動かない。ミニマップ寸法か盤面が変わった時だけ焼く。 */
    _bakeTerrain() {
      const grid = this._grid();
      const proj = this._project();
      if (!grid || !proj || typeof Renderer === 'undefined' || !Renderer.hexToPx) return;
      const key = grid.length + 'x' + (grid[0] ? grid[0].length : 0) + '@' + this.cssW + 'x' + this.cssH
        + '#' + Math.round(this.bounds.x) + ',' + Math.round(this.bounds.y)
        + ',' + Math.round(this.bounds.w) + ',' + Math.round(this.bounds.h);
      if (key === this._bakeKey && this.baked) return;

      const dpr = this.dpr;
      if (!this.baked) this.baked = document.createElement('canvas');
      this.baked.width = this.canvas.width;
      this.baked.height = this.canvas.height;
      const c = this.baked.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, this.cssW, this.cssH);
      c.fillStyle = FIELD_BG;
      c.fillRect(0, 0, this.cssW, this.cssH);

      // hex 1枚をブロック1個で表す。隙間が出ないよう最小1pxで気持ち太らせる。
      const W = grid.length, H = grid[0] ? grid[0].length : 0;
      const hexW = Math.sqrt(3) * (typeof HEX_SIZE !== 'undefined' ? HEX_SIZE : 54);
      const cell = Math.max(1, Math.ceil(hexW * proj.s));
      for (let q = 0; q < W; q++) {
        const col = grid[q];
        if (!col) continue;
        for (let r = 0; r < H; r++) {
          const t = col[r];
          if (!t || t.id === -1) continue;
          const color = TERRAIN_COLORS[t.id] || TERRAIN_DEFAULT;
          const p = Renderer.hexToPx(q, r);
          c.fillStyle = color;
          c.fillRect(Math.round(proj.ox + p.x * proj.s - cell / 2),
            Math.round(proj.oy + p.y * proj.s - cell / 2), cell, cell);
        }
      }
      this._bakeKey = key;
    }

    draw(force) {
      if (!this.ctx || !this.cssW) return;
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      if (!force && now - this._lastDraw < REDRAW_MS) return;
      this._lastDraw = now;

      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.cssW, this.cssH);
      ctx.fillStyle = FIELD_BG;
      ctx.fillRect(0, 0, this.cssW, this.cssH);

      this._bakeTerrain();
      const proj = this._project();
      if (!proj) return;
      if (this.baked) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(this.baked, 0, 0);
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      }

      // ユニットは点。誰がどこにいるかだけ読めればよい。
      const gl = window.gameLogic;
      const units = gl && gl.units ? gl.units : null;
      if (units && typeof Renderer !== 'undefined' && Renderer.hexToPx) {
        const selected = gl.selectedUnit;
        for (let i = 0; i < units.length; i++) {
          const u = units[i];
          if (!u || u.hp <= 0 || u.q == null) continue;
          const p = Renderer.hexToPx(u.q, u.r);
          const x = proj.ox + p.x * proj.s, y = proj.oy + p.y * proj.s;
          const ally = u.team === 'player';
          ctx.fillStyle = ally ? COLOR_ALLY : COLOR_FOE;
          const rad = (u.def && u.def.isTank) ? 2.6 : 1.8;
          ctx.beginPath();
          ctx.arc(x, y, rad, 0, Math.PI * 2);
          ctx.fill();
          if (selected && selected.id === u.id) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(x, y, rad + 2.2, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }

      // 現在の視界。ミニマップの唯一の「操作可能」な情報。
      if (this.main && this.main.worldView) {
        const v = this.main.worldView;
        // ズームが引かれていると視界は盤面より広い。枠がミニマップの外へ
        // はみ出して切れると壊れて見えるので、内側へクランプする。
        const x0 = Math.max(0.5, proj.ox + v.x * proj.s);
        const y0 = Math.max(0.5, proj.oy + v.y * proj.s);
        const x1 = Math.min(this.cssW - 0.5, proj.ox + (v.x + v.width) * proj.s);
        const y1 = Math.min(this.cssH - 0.5, proj.oy + (v.y + v.height) * proj.s);
        ctx.strokeStyle = COLOR_VIEW;
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5,
          Math.max(3, Math.round(x1 - x0)), Math.max(3, Math.round(y1 - y0)));
      }
    }

    recenter(event) {
      const proj = this._project();
      if (!proj || !this.main) return;
      const rect = this.frame.getBoundingClientRect();
      const localX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
      const localY = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
      this.main.centerOn((localX - proj.ox) / proj.s, (localY - proj.oy) / proj.s);
      this.draw(true);
    }

    destroy() {
      if (this.scene && this.scene.scale) this.scene.scale.off('resize', this._onResize);
      if (this.frame) this.frame.remove();
      this.frame = null;
      this.canvas = null;
      this.ctx = null;
      this.baked = null;
      this.scene = null;
    }
  }

  window.TacticalMinimap = TacticalMinimap;
}());

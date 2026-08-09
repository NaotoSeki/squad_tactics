'use strict';

/**
 * DECAL LAYER — 着弾痕・轍を地表へ「焼き込む」永続レイヤー。
 *
 * PS実機の方式に合わせている: PSは着弾痕や轍を生きたオブジェクトとして持たず、
 * 配置台帳(MAP_DECORS)へ追記して地表の一部にしてしまう。戦闘前後のPSMを比較すると
 * `crater_gun` と `tracks_tank` がセーブ側に増えており、MAP_OBJECTS からは減っている
 * (docs/PS_BATTLEFIELD_STATE_MODEL.md)。つまり戦場は「巨大な1枚のキャンバス」で、
 * 戦闘の痕跡はそこへ不可逆に積まれていく。
 *
 * 【コストについて】デカールが安いのは「焼き込むから」であって、デカールだから
 * ではない。個別スプライトのまま何千個も残すとドローコールで破綻する。ここでは
 * 単一の RenderTexture へ描き込むので、**痕跡が何個あっても描画は1テクスチャ1ドロー**。
 * 増えるのは焼き込み時の一度きりの塗りだけで、以降のフレームコストは一定。
 * だから「いくらでも増やせる」は正しいが、その条件が焼き込みである点が要。
 *
 * RenderTexture はPS原寸(背景画像と同じ解像度)で持ち、背景と同じスケール・同じ
 * 左上座標で表示する。こうするとデカールが背景アートと同じ画素密度で乗るので、
 * 拡大時に痕跡だけ解像度が浮くことがない。
 */
window.DecalLayer = {
  /** asset/environment/decals/manifest.json の内容（preloadで読み込む） */
  manifest: null,

  _rt: null,
  _scene: null,
  _proj: null,
  _count: 0,

  /** KHAOS爆発ティア → PSクレーターのティア */
  TIER_MAP: {
    t1_12mm: 'auto',
    t2_grenade: 'light',
    t3_mortar60: 'medium',
    t4_shell120: 'heavy',
    t5_aerialbomb: 'heavy'
  },

  /** t5は最大口径。同ティアのheavyを少し大きく焼く */
  TIER_SCALE: { t5_aerialbomb: 1.35 },

  /**
   * 背景と同じ投影で永続RenderTextureを敷く。
   * @param {Phaser.Scene} scene
   * @param {{scale:number, topLeftX:number, topLeftY:number}} projection 背景と共有する投影
   * @param {number} imageWidth  背景画像のPS原寸幅
   * @param {number} imageHeight 背景画像のPS原寸高さ
   */
  init(scene, projection, imageWidth, imageHeight) {
    this.destroy();
    if (!scene || !scene.add || !projection) return null;

    const rt = scene.add.renderTexture(
      projection.topLeftX, projection.topLeftY, imageWidth, imageHeight
    );
    rt.setOrigin(0, 0);
    rt.setScale(projection.scale);
    // 背景(-10000)のすぐ上、立体物や兵士より下。
    rt.setDepth(-9990);

    this._rt = rt;
    this._scene = scene;
    this._proj = projection;
    this._count = 0;
    return rt;
  },

  destroy() {
    if (this._rt) { try { this._rt.destroy(); } catch (e) { /* シーン破棄済み */ } }
    this._rt = null;
    this._scene = null;
    this._proj = null;
    this._count = 0;
  },

  /** これまでに焼いた痕跡の数（検証用） */
  count() { return this._count; },

  ready() { return !!(this._rt && this.manifest && this.manifest.tiers); },

  _pick(tierName) {
    const list = this.manifest && this.manifest.tiers && this.manifest.tiers[tierName];
    if (!list || !list.length) return null;
    return list[(Math.random() * list.length) | 0];
  },

  /**
   * ワールド座標へ着弾痕を1つ焼き込む（不可逆）。
   * @param {number} worldX ゲーム座標
   * @param {number} worldY ゲーム座標
   * @param {string} tier KHAOS_FX.TIERS のキー、またはPSデカールのティア名
   * @param {{scale?: number}=} opts 個別の表示倍率
   * @returns {boolean} 焼けたか
   */
  stamp(worldX, worldY, tier, opts) {
    if (!this.ready()) return false;
    const tierName = this.TIER_MAP[tier] || tier || 'light';
    const decal = this._pick(tierName);
    if (!decal) return false;

    const key = 'decal_' + decal.id;
    if (!this._scene.textures.exists(key)) return false;

    // ワールド座標 → 背景画像内の画素座標（背景と同じ投影を使うのが要）
    const imgX = (worldX - this._proj.topLeftX) / this._proj.scale;
    const imgY = (worldY - this._proj.topLeftY) / this._proj.scale;

    // SSC由来のorigin規約: left = world + origin（正本レンダラの stamp_entry と同じ）
    const left = imgX + decal.ox;
    const top = imgY + decal.oy;

    const requestedScale = Number(opts && opts.scale);
    const extra = (this.TIER_SCALE[tier] || 1)
      * (Number.isFinite(requestedScale) && requestedScale > 0 ? requestedScale : 1);
    if (extra !== 1) {
      // 拡大焼きは中心を保つよう左上を補正する
      const dw = decal.w * (extra - 1), dh = decal.h * (extra - 1);
      const img = this._scene.add.image(0, 0, key).setOrigin(0, 0).setScale(extra).setVisible(false);
      this._rt.draw(img, left - dw / 2, top - dh / 2);
      img.destroy();
    } else {
      this._rt.draw(key, left, top);
    }

    this._count++;
    return true;
  },

  /** 轍など、線分に沿って連続で焼く用（車両移動から呼ぶ想定） */
  stampLine(x0, y0, x1, y1, khaosTier, stepPx) {
    if (!this.ready()) return 0;
    const step = stepPx || 24;
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(dist / step));
    let done = 0;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (this.stamp(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, khaosTier)) done++;
    }
    return done;
  }
};

/**
 * PHASER TERRAIN RURAL V29: Background image renderer for rural_v29.png
 *
 * RuralV29Map が生成したマップを背景にして、
 * Blender-rendered 30hex PNG (1600px/image, isometric projection 55°) を配置する。
 *
 * 計算:
 *   IMG_PPM = 1600 / 72 px/m (レンダー密度)
 *   SIN55 = sin(55°), COS55 = cos(55°)
 *   BOARD_R = 7.2 m (ボード半径)
 *   sx = HEX_SIZE / (BOARD_R * IMG_PPM)  ≈ 0.3375
 *   sy = HEX_SIZE / (BOARD_R * SIN55 * IMG_PPM) ≈ 0.4120
 *   v29画像内基準hex = (q_img=0, m=0) = ワールド(6.8, 8.0) の画像px
 *   base = Renderer.hexToPx(4, 12) = ゲーム座標(4,12)へ対応
 */
window.TerrainRenderRuralV29 = {
  buildMap(scene, hexGroup, map) {
    const IMG_PPM = 1600 / 72;                     // レンダー密度: px/m
    const SIN55 = Math.sin(55 * Math.PI / 180);
    const COS55 = Math.cos(55 * Math.PI / 180);
    const BOARD_R = 7.2;

    const sx = HEX_SIZE / (BOARD_R * IMG_PPM);     // ≈0.3375
    const sy = HEX_SIZE / (BOARD_R * SIN55 * IMG_PPM); // ≈0.4120

    // v29画像内の基準ヘックス(画像内q_img=0, m=0)のワールド座標と画像px位置
    const imgX = 800 + (6.8 - 35) * IMG_PPM;        // ≈173.33
    const imgY = 610 - ((8.0 - 35) * SIN55 + (0.08 - 1.5) * COS55) * IMG_PPM; // ≈1119.6

    // この基準ヘックスはゲーム座標(4, 12)に対応
    const anchor = Renderer.hexToPx(4, 12);
    const topLeftX = anchor.x - imgX * sx;
    const topLeftY = anchor.y - imgY * sy;

    // テクスチャ 'rural_v29' がまだロードされていなければ実行時ロード
    if (!scene.textures.exists('rural_v29')) {
      const loadAndDraw = () => {
        if (!scene.textures.exists('rural_v29')) return; // キャンセルされた場合
        this._drawImage(scene, hexGroup, topLeftX, topLeftY, sx, sy);
      };
      scene.load.image('rural_v29', 'asset/environment/maps/rural_v29.png');
      scene.load.once('complete', loadAndDraw);
      scene.load.start();
    } else {
      // 既にロード済み
      this._drawImage(scene, hexGroup, topLeftX, topLeftY, sx, sy);
    }
  },

  _drawImage(scene, hexGroup, topLeftX, topLeftY, sx, sy) {
    const img = scene.add.image(topLeftX, topLeftY, 'rural_v29')
      .setOrigin(0, 0)
      .setScale(sx, sy)
      .setDepth(-10000);
    hexGroup.add(img);
  }
};

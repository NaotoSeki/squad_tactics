/**
 * PHASER TERRAIN RURAL V29: Background image renderer for rural_v29.png
 *
 * RuralV29Map が生成したマップを背景にして、
 * Blender-rendered 30hex PNG (1600px/image, isometric projection 55°) を配置する。
 *
 * バリアント対応: RuralV29Map.lastVariant から textureKey・textureFile を動的に取得
 * テクスチャロード失敗時は console.warn で警告し、背景なしで続行する
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
    // RuralV29Map から選択されたバリアント情報を取得
    if (!window.RuralV29Map || !window.RuralV29Map.lastVariant) {
      console.warn('RuralV29Map.lastVariant not set, skipping terrain render');
      return;
    }

    const variant = window.RuralV29Map.lastVariant;
    const textureKey = variant.texture;
    const textureFile = variant.file;

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

    // 指定されたテクスチャキーがロード済みか確認
    if (!scene.textures.exists(textureKey)) {
      const loadAndDraw = () => {
        if (!scene.textures.exists(textureKey)) {
          console.warn(`failed to load texture '${textureKey}' from ${textureFile}`);
          return; // ロード失敗、背景なしで続行
        }
        this._drawImage(scene, hexGroup, topLeftX, topLeftY, sx, sy, textureKey);
      };
      scene.load.image(textureKey, textureFile);
      scene.load.once('complete', loadAndDraw);
      scene.load.start();
    } else {
      // 既にロード済み
      this._drawImage(scene, hexGroup, topLeftX, topLeftY, sx, sy, textureKey);
    }
  },

  /**
   * 背景画像を描画
   * @param {Phaser.Scene} scene
   * @param {Phaser.Physics.Arcade.Group} hexGroup
   * @param {number} topLeftX - 左上隅のゲーム座標X
   * @param {number} topLeftY - 左上隅のゲーム座標Y
   * @param {number} sx - X軸スケール
   * @param {number} sy - Y軸スケール
   * @param {string} textureKey - Phaserテクスチャキー
   */
  _drawImage(scene, hexGroup, topLeftX, topLeftY, sx, sy, textureKey) {
    const img = scene.add.image(topLeftX, topLeftY, textureKey)
      .setOrigin(0, 0)
      .setScale(sx, sy)
      .setDepth(-10000);
    hexGroup.add(img);
  }
};

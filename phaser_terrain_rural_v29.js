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

    // kit モード判定（north/south の2枚合成パス）
    if (variant.kit) {
      this._buildMapKitMode(scene, hexGroup, variant);
      return;
    }

    // PS正本キャンバス判定（Blenderの55°投影ではなくPS自身の等角投影を使う）
    if (variant.psNative) {
      this._buildMapPsNative(scene, hexGroup, variant);
      return;
    }

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
   * PS正本キャンバスの背景生成。
   *
   * Blenderバリアントは 55°投影の前後圧縮を打ち消すため sx≠sy（縦を1/sin55倍に
   * 伸ばす）が、PSキャンバスにこれをやると 2:1等角なので縦2倍になり家屋も木も
   * 潰れて別物になる。PS画は歪ませないのが最優先なので **等方スケール** で置く。
   * 代償として、盤面のヘックス平面とPS地面の前後圧縮は厳密には一致しない
   * （画面上のヘックスは不可視レイヤーなので視覚的には露出しない）。
   *
   * 投影値(scale / topLeft)は scripts/build_ps_battlefield.py が地形テーブルと
   * 同時に算出したものをそのまま使う。両者が同じ数値を共有していることが、
   * 「絵の上の家」と「BLDGヘックス」がズレない条件。
   */
  _buildMapPsNative(scene, hexGroup, variant) {
    const bf = window.PS_BATTLEFIELDS && window.PS_BATTLEFIELDS[variant.psNative];
    if (!bf || !bf.projection) {
      console.warn(`PS battlefield '${variant.psNative}' not found, skipping background`);
      return;
    }

    const { scale, topLeftX, topLeftY } = bf.projection;
    const textureKey = variant.texture;
    const textureFile = variant.file;

    // 着弾痕の焼き込みレイヤーを背景と同じ投影・同じ画素密度で敷く。
    // 背景より後・立体物より前(depth -9990)。テクスチャの読み込み完了を待つ必要はない。
    if (window.DecalLayer) {
      window.DecalLayer.init(scene, bf.projection, bf.imageWidth, bf.imageHeight);
    }

    if (!scene.textures.exists(textureKey)) {
      scene.load.image(textureKey, textureFile);
      scene.load.once('complete', () => {
        if (!scene.textures.exists(textureKey)) {
          console.warn(`failed to load texture '${textureKey}' from ${textureFile}`);
          return;
        }
        this._drawImage(scene, hexGroup, topLeftX, topLeftY, scale, scale, textureKey);
      });
      scene.load.start();
    } else {
      this._drawImage(scene, hexGroup, topLeftX, topLeftY, scale, scale, textureKey);
    }
  },

  /**
   * kit モード用背景生成（north/south の2枚合成）
   * @param {Phaser.Scene} scene
   * @param {Phaser.Physics.Arcade.Group} hexGroup
   * @param {Object} variant - { north: {...}, south: {...} }
   */
  _buildMapKitMode(scene, hexGroup, variant) {
    const { north, south } = variant;
    const northKey = north.texture;
    const northFile = north.file;
    const southKey = south.texture;
    const southFile = south.file;

    const IMG_PPM = 1600 / 72;
    const SIN55 = Math.sin(55 * Math.PI / 180);
    const COS55 = Math.cos(55 * Math.PI / 180);
    const BOARD_R = 7.2;

    const sx = HEX_SIZE / (BOARD_R * IMG_PPM);
    const sy = HEX_SIZE / (BOARD_R * SIN55 * IMG_PPM);

    // 画像内の基準ヘックス(q_img=0, m=0) の位置計算
    const imgX = 800 + (6.8 - 35) * IMG_PPM;
    const imgY = 610 - ((8.0 - 35) * SIN55 + (0.08 - 1.5) * COS55) * IMG_PPM;

    // 画像内の継ぎ目ピクセルY座標（r9/r10の境界）
    // r9(m=3)のwy=40.4、r10(m=2)のwy=29.6の中点=35.0が正しい境界値。
    // (2026-07-20 訂正: 初期実装は45.8を使用していたが、これはr10をm=4として
    // 誤算出した値でr8/r9境界に相当していた。r_game=12-mが正。ドッキング点の
    // X座標28.6はパリティの都合で無傷だったため変更不要)
    const SEAM_WORLD_Y = 35.0;
    const GROUND_Z = 0.08;
    const seamPx = 610 - ((SEAM_WORLD_Y - 35) * SIN55 + (GROUND_Z - 1.5) * COS55) * IMG_PPM;

    const anchor = Renderer.hexToPx(4, 12);
    const topLeftX = anchor.x - imgX * sx;
    const topLeftY = anchor.y - imgY * sy;

    // north と south の両方をロードしてから一度だけ描画する。
    // 既にロード済みのテクスチャは即座に「ロード済み」カウントに数え、
    // 未ロードのものだけ load完了イベントを待つ(単一画像版_buildMap()と同じ
    // if/elseパターンを2系統に拡張。二重描画を避けるため drawn フラグで一度だけ実行)。
    let pending = 0;
    let drawn = false;
    const tryDraw = () => {
      if (drawn) return;
      drawn = true;
      this._drawKitImages(scene, hexGroup, topLeftX, topLeftY, sx, sy, northKey, southKey, seamPx);
    };
    const onOneLoaded = () => {
      pending--;
      if (pending <= 0) tryDraw();
    };

    if (!scene.textures.exists(northKey)) {
      pending++;
      scene.load.image(northKey, northFile);
      scene.load.once('complete', () => {
        if (!scene.textures.exists(northKey)) {
          console.warn(`failed to load texture '${northKey}' from ${northFile}`);
        }
        onOneLoaded();
      });
    }
    if (!scene.textures.exists(southKey)) {
      pending++;
      scene.load.image(southKey, southFile);
      scene.load.once('complete', () => {
        if (!scene.textures.exists(southKey)) {
          console.warn(`failed to load texture '${southKey}' from ${southFile}`);
        }
        onOneLoaded();
      });
    }

    if (pending > 0) {
      scene.load.start();
    } else {
      // 両方とも既にロード済み
      tryDraw();
    }
  },

  /**
   * kit 用2枚の背景画像を描画
   * @param {Phaser.Scene} scene
   * @param {Phaser.Physics.Arcade.Group} hexGroup
   * @param {number} topLeftX
   * @param {number} topLeftY
   * @param {number} sx
   * @param {number} sy
   * @param {string} northKey
   * @param {string} southKey
   * @param {number} seamPx - 画像内継ぎ目Y座標（ピクセル）
   */
  _drawKitImages(scene, hexGroup, topLeftX, topLeftY, sx, sy, northKey, southKey, seamPx) {
    const roundedSeam = Math.round(seamPx);
    const SRC_W = 1600, SRC_H = 1220;
    const F = 34; // 継ぎ目フェザー半幅(ソースpx)。2*F=68px のクロスフェード帯で境界段差を消す

    const nImg = scene.textures.exists(northKey) ? scene.textures.get(northKey).getSourceImage() : null;
    const sImg = scene.textures.exists(southKey) ? scene.textures.get(southKey).getSourceImage() : null;

    // ソース画像が取れない環境では旧方式(ハードカット2スプライト)へフォールバック
    if (!nImg || !sImg) {
      if (nImg) scene.add.image(topLeftX, topLeftY, northKey).setOrigin(0, 0)
        .setCrop(0, 0, SRC_W, roundedSeam).setScale(sx, sy).setDepth(-10000).addToDisplayList();
      if (sImg) scene.add.image(topLeftX, topLeftY, southKey).setOrigin(0, 0)
        .setCrop(0, roundedSeam, SRC_W, SRC_H - roundedSeam).setScale(sx, sy).setDepth(-10000);
      return;
    }

    // north[0,seam) と south[seam,H) を1枚のcanvasへ合成し、継ぎ目±F を
    // 縦アルファ勾配でクロスフェード（別レンダー同士のground/植生の境界段差を消す）。
    const cv = document.createElement('canvas');
    cv.width = SRC_W; cv.height = SRC_H;
    const g = cv.getContext('2d');
    const top = roundedSeam - F, botStart = roundedSeam + F;
    // フェザー帯より上=north、下=south を素直に貼る
    g.drawImage(nImg, 0, 0, SRC_W, top, 0, 0, SRC_W, top);
    g.drawImage(sImg, 0, botStart, SRC_W, SRC_H - botStart, 0, botStart, SRC_W, SRC_H - botStart);
    // 帯: north を敷き、south を上0→下1のアルファ勾配で重ねる
    const bandH = 2 * F;
    g.drawImage(nImg, 0, top, SRC_W, bandH, 0, top, SRC_W, bandH);
    const tc = document.createElement('canvas'); tc.width = SRC_W; tc.height = bandH;
    const tg = tc.getContext('2d');
    tg.drawImage(sImg, 0, top, SRC_W, bandH, 0, 0, SRC_W, bandH);
    const grad = tg.createLinearGradient(0, 0, 0, bandH);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,1)');
    tg.globalCompositeOperation = 'destination-in';
    tg.fillStyle = grad; tg.fillRect(0, 0, SRC_W, bandH);
    g.drawImage(tc, 0, top);

    // Phaser テクスチャ化して単一画像で表示（キーは付け替え。旧テクスチャは破棄）
    const key = 'kit_composited';
    if (scene.textures.exists(key)) scene.textures.remove(key);
    scene.textures.addCanvas(key, cv);
    const composedImg = scene.add.image(topLeftX, topLeftY, key)
      .setOrigin(0, 0).setScale(sx, sy).setDepth(-10000);
    hexGroup.add(composedImg);
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

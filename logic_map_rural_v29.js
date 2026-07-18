/**
 * LOGIC MAP RURAL V29: Blender-rendered 30-hex rural map integration
 *
 * Blender-rendered background PNG (30hex layout) is placed behind the hexgrid.
 * Terrain: GRASS, FOREST, ROAD, FIELD (新規), RUIN, BLDG (コスト99不可侵)
 *
 * 地形は下記テーブルで固定配置(P1基準):
 *   r=7:  (7,7)FOREST (8,7)ROAD (9,7)BLDG (10,7)BLDG (11,7)FOREST
 *   r=8:  (6,8)FOREST (7,8)ROAD (8,8)ROAD (9,8)GRASS (10,8)FIELD
 *   r=9:  (6,9)RUIN (7,9)ROAD (8,9)ROAD (9,9)GRASS (10,9)FOREST
 *   r=10: (5,10)GRASS (6,10)GRASS (7,10)ROAD (8,10)FIELD (9,10)FIELD
 *   r=11: (5,11)GRASS (6,11)ROAD (7,11)FIELD (8,11)FIELD (9,11)FOREST
 *   r=12: (4,12)ROAD (5,12)GRASS (6,12)FOREST (7,12)FIELD (8,12)FIELD
 *
 * バリアント対応: P1(基準)、P2/P4(180°回転版)、P3(建物交換版、地形同一)
 */
window.RuralV29Map = {
  enabled: true,
  /** 直近バトルで実際に農村マップを生成したか（レンダラの分岐に使う） */
  active: false,

  /** ローカルで定義する地形種（TERRAIN グローバルには追加しない） */
  FIELD: { id: 7, name: "畑", cost: 2, cover: 15 },
  RUIN: { id: 4, name: "廃屋", cost: 2, cover: 40 },
  BLDG: { id: 6, name: "建物", cost: 99, cover: 0, building: true, tankBlocked: true },

  /**
   * マップバリアント定義
   * - key: バリアント識別子
   * - texture: Phaserテクスチャキー
   * - file: アセットファイルパス
   * - rot180: 180°回転適用フラグ
   * - ready: ファイルロード完了時 true（初期値はP1のみ）
   */
  VARIANTS: [
    { key: 'p1', texture: 'rural_v29',    file: 'asset/environment/maps/rural_v29.png',    rot180: false, ready: true },
    { key: 'p2', texture: 'rural_v29_p2', file: 'asset/environment/maps/rural_v29_p2.png', rot180: true,  ready: true },
    { key: 'p3', texture: 'rural_v29_p3', file: 'asset/environment/maps/rural_v29_p3.png', rot180: false, ready: true },
    { key: 'p4', texture: 'rural_v29_p4', file: 'asset/environment/maps/rural_v29_p4.png', rot180: true,  ready: true },
  ],

  /**
   * バリアント選択制御
   * - fixedVariant: null = ランダム選択、'p1'/'p2' 等で固定
   * - lastVariant: 最後に generate() で選択されたVARIANTSエントリ
   */
  fixedVariant: null,
  lastVariant: null,

  /**
   * 30hexの地形テーブル（P1基準、座標q,r → 地形オブジェクト）
   * rot180時はこのテーブルに座標変換を適用
   * 各セルはシャローコピーで独立オブジェクト化する
   */
  _terrain_table_base: [
    // r=7
    { q: 7, r: 7, base: 'FOREST' },
    { q: 8, r: 7, base: 'ROAD' },
    { q: 9, r: 7, base: 'BLDG' },
    { q: 10, r: 7, base: 'BLDG' },
    { q: 11, r: 7, base: 'FOREST' },
    // r=8
    { q: 6, r: 8, base: 'FOREST' },
    { q: 7, r: 8, base: 'ROAD' },
    { q: 8, r: 8, base: 'ROAD' },
    { q: 9, r: 8, base: 'GRASS' },
    { q: 10, r: 8, base: 'FIELD' },
    // r=9
    { q: 6, r: 9, base: 'RUIN' },
    { q: 7, r: 9, base: 'ROAD' },
    { q: 8, r: 9, base: 'ROAD' },
    { q: 9, r: 9, base: 'GRASS' },
    { q: 10, r: 9, base: 'FOREST' },
    // r=10
    { q: 5, r: 10, base: 'GRASS' },
    { q: 6, r: 10, base: 'GRASS' },
    { q: 7, r: 10, base: 'ROAD' },
    { q: 8, r: 10, base: 'FIELD' },
    { q: 9, r: 10, base: 'FIELD' },
    // r=11
    { q: 5, r: 11, base: 'GRASS' },
    { q: 6, r: 11, base: 'ROAD' },
    { q: 7, r: 11, base: 'FIELD' },
    { q: 8, r: 11, base: 'FIELD' },
    { q: 9, r: 11, base: 'FOREST' },
    // r=12
    { q: 4, r: 12, base: 'ROAD' },
    { q: 5, r: 12, base: 'GRASS' },
    { q: 6, r: 12, base: 'FOREST' },
    { q: 7, r: 12, base: 'FIELD' },
    { q: 8, r: 12, base: 'FIELD' },
  ],

  /**
   * ゲームマップ game.map を初期化して、30hexのテーブルを配置する
   * 冒頭でバリアント選択を行い、rot180が必要な場合は座標を変換
   */
  generate(game) {
    // バリアント選択（fixedVariant=null ならランダム、さもなくば固定）
    this._selectVariant();

    game.map = [];
    for (let q = 0; q < MAP_W; q++) {
      game.map[q] = [];
      for (let r = 0; r < MAP_H; r++) {
        game.map[q][r] = TERRAIN.VOID;
      }
    }

    // 選択されたバリアントに応じた地形テーブルを取得
    const terrainTable = this._getTerrainTable();

    // 30hexテーブルを配置（各セルは TERRAIN またはローカル地形定義のシャローコピー）
    for (const entry of terrainTable) {
      const { q, r, base } = entry;
      if (!this.isValidHex(q, r)) continue;

      let terrainDef;
      if (base === 'FIELD') terrainDef = this.FIELD;
      else if (base === 'RUIN') terrainDef = this.RUIN;
      else if (base === 'BLDG') terrainDef = this.BLDG;
      else terrainDef = TERRAIN[base];

      // シャローコピーで独立オブジェクト化
      game.map[q][r] = { ...terrainDef };
    }

    this.active = true;
    if (window.CityMap) window.CityMap.active = false;
  },

  /**
   * バリアント選択: fixedVariant に従うか、ready=true のものからランダム選択
   */
  _selectVariant() {
    if (this.fixedVariant) {
      this.lastVariant = this.VARIANTS.find(v => v.key === this.fixedVariant);
      if (!this.lastVariant) {
        console.warn(`fixedVariant '${this.fixedVariant}' not found, falling back to random selection`);
        this._selectRandomVariant();
      }
    } else {
      this._selectRandomVariant();
    }
  },

  /**
   * ready=true のバリアントからランダムに選択
   */
  _selectRandomVariant() {
    const readyVariants = this.VARIANTS.filter(v => v.ready);
    if (readyVariants.length === 0) {
      console.error('No ready variants found, using P1 as fallback');
      this.lastVariant = this.VARIANTS[0];
    } else {
      const idx = Math.floor(Math.random() * readyVariants.length);
      this.lastVariant = readyVariants[idx];
    }
  },

  /**
   * 選択されたバリアントに応じた地形テーブルを返す
   * rot180=true の場合、座標を(q,r) → (15-q, 19-r)に変換
   */
  _getTerrainTable() {
    if (!this.lastVariant) {
      console.error('lastVariant is not set, using base table');
      return this._terrain_table_base;
    }

    let table = [...this._terrain_table_base];
    if (this.lastVariant.rot180) {
      table = this._rotateTable180(table);
    }
    return table;
  },

  /**
   * 180°回転座標変換: (q,r) → (15-q, 19-r)
   */
  _rotateTable180(table) {
    return table.map(entry => ({
      q: 15 - entry.q,
      r: 19 - entry.r,
      base: entry.base,
    }));
  },

  isValidHex(q, r) {
    return q >= 0 && q < MAP_W && r >= 0 && r < MAP_H;
  }
};

/**
 * LOGIC MAP RURAL V29: Blender-rendered 30-hex rural map integration
 *
 * Blender-rendered background PNG (30hex layout) is placed behind the hexgrid.
 * Terrain: GRASS, FOREST, ROAD, FIELD (新規), RUIN, BLDG (コスト99不可侵)
 *
 * 地形は下記テーブルで固定配置:
 *   r=7:  (7,7)FOREST (8,7)ROAD (9,7)BLDG (10,7)BLDG (11,7)FOREST
 *   r=8:  (6,8)FOREST (7,8)ROAD (8,8)ROAD (9,8)GRASS (10,8)FIELD
 *   r=9:  (6,9)RUIN (7,9)ROAD (8,9)ROAD (9,9)GRASS (10,9)FOREST
 *   r=10: (5,10)GRASS (6,10)GRASS (7,10)ROAD (8,10)FIELD (9,10)FIELD
 *   r=11: (5,11)GRASS (6,11)ROAD (7,11)FIELD (8,11)FIELD (9,11)FOREST
 *   r=12: (4,12)ROAD (5,12)GRASS (6,12)FOREST (7,12)FIELD (8,12)FIELD
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
   * 30hexの地形テーブル（座標q,r → 地形オブジェクト）
   * 各セルはシャローコピーで独立オブジェクト化する
   */
  _terrain_table: [
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
   */
  generate(game) {
    game.map = [];
    for (let q = 0; q < MAP_W; q++) {
      game.map[q] = [];
      for (let r = 0; r < MAP_H; r++) {
        game.map[q][r] = TERRAIN.VOID;
      }
    }

    // 30hexテーブルを配置（各セルは TERRAIN またはローカル地形定義のシャローコピー）
    for (const entry of this._terrain_table) {
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

  isValidHex(q, r) {
    return q >= 0 && q < MAP_W && r >= 0 && r < MAP_H;
  }
};

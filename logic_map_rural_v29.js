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
   * - pixelRatio: 背景画像の任意の画素比。省略時1、2なら縦横2倍画像
   * - rot180: 180°回転適用フラグ
   * - ready: ファイルロード完了時 true（初期値はP1のみ）
   */
  VARIANTS: [
    // --- Blenderレンダー由来の固定マップ(2026-07-25 退役) ---
    // 「セクタを進めると以前のレンダ済み5枚が出てくる」ため全て ready:false にした。
    // 戦場は毎回PS実アセットからの生成物(psNative)を使う。
    // 削除はせず fixedVariant 指定でのみ参照可能なまま残す(比較・回帰用)。
    { key: 'p1', texture: 'rural_v29',    file: 'asset/environment/maps/rural_v29.png',    rot180: false, ready: false },
    { key: 'p2', texture: 'rural_v29_p2', file: 'asset/environment/maps/rural_v29_p2.png', rot180: true,  ready: false },
    { key: 'p3', texture: 'rural_v29_p3', file: 'asset/environment/maps/rural_v29_p3.png', rot180: false, ready: false },
    { key: 'p4', texture: 'rural_v29_p4', file: 'asset/environment/maps/rural_v29_p4.png', rot180: true,  ready: false },
    // 別ロケーション3種(2026-07-19): 道路網・建物・破壊度が異なる独立構図。
    // table キーで _locationRows の専用地形テーブルを参照する。
    { key: 'loc_crossroad',   texture: 'rural_loc_crossroad',   file: 'asset/environment/maps/rural_loc_crossroad.png',   rot180: false, ready: false, table: 'loc_crossroad' },
    { key: 'loc_forest_farm', texture: 'rural_loc_forest_farm', file: 'asset/environment/maps/rural_loc_forest_farm.png', rot180: false, ready: false, table: 'loc_forest_farm' },
    { key: 'loc_shelled',     texture: 'rural_loc_shelled',     file: 'asset/environment/maps/rural_loc_shelled.png',     rot180: false, ready: false, table: 'loc_shelled' },
    { key: 'loc_church_square', texture: 'rural_loc_church_square', file: 'asset/environment/maps/rural_loc_church_square.png', rot180: false, ready: false, table: 'loc_church_square' },
    // PS正本キャンバス(2026-07-25)。Blenderレンダーではなく Panzer Strike の実マップ
    // 配置をSSC原寸で再構成したもの。地形テーブルは手描きではなく配置台帳から機械導出
    // (scripts/build_ps_battlefield.py)。psNative キーで window.PS_BATTLEFIELDS を引き、
    // 背景の投影値もそこから取る(Blenderの55°投影定数は使わない)。
    // 正本クロップ(実マップの一角)。構図が固定なので通常プールからは外し、
    // 比較・回帰用に fixedVariant でのみ参照する。通常戦闘はシード生成物を使う。
    { key: 'ps_village_north', texture: 'ps_village_north', file: 'asset/environment/maps/ps_village_north.png', rot180: false, ready: false, psNative: 'ps_village_north' },
  ],

  /**
   * KIT_PIECES: 北ピース(r7-9) × 南ピース(r10-12) の 2×2 = 4 パターン
   * 実行時にランダム/固定選択で組み合わせ、継ぎ目で結合する。
   * ファイル未存在でも ready:false のまま動作(監督官がPNG到着時に ready:true に変更)。
   * 継ぎ目契約: r9のq=7=ROAD, r10のq=7=ROAD (本ピース完成時も維持すること)。
   */
  KIT_PIECES: {
    north: [
      {
        key: 'kit_north_a', texture: 'kit_north_a', file: 'asset/environment/maps/kit_north_a.png', ready: false,
        rows: [
          [7, 7, ['FOREST', 'ROAD', 'GRASS', 'FIELD', 'FOREST']],
          [8, 6, ['FOREST', 'ROAD', 'ROAD', 'GRASS', 'FIELD']],
          [9, 6, ['RUIN', 'ROAD', 'ROAD', 'GRASS', 'FOREST']]
        ]
      },
      {
        key: 'kit_north_b', texture: 'kit_north_b', file: 'asset/environment/maps/kit_north_b.png', ready: false,
        rows: [
          [7, 7, ['FOREST', 'ROAD', 'BLDG', 'FIELD', 'FOREST']],
          [8, 6, ['GRASS', 'ROAD', 'FIELD', 'GRASS', 'FOREST']],
          [9, 6, ['GRASS', 'ROAD', 'FIELD', 'GRASS', 'FOREST']]
        ]
      }
    ],
    south: [
      {
        key: 'kit_south_a', texture: 'kit_south_a', file: 'asset/environment/maps/kit_south_a.png', ready: false,
        rows: [
          [10, 5, ['GRASS', 'GRASS', 'ROAD', 'FIELD', 'FIELD']],
          [11, 5, ['GRASS', 'ROAD', 'FIELD', 'FIELD', 'FOREST']],
          [12, 4, ['ROAD', 'GRASS', 'FOREST', 'FIELD', 'FIELD']]
        ]
      },
      {
        key: 'kit_south_b', texture: 'kit_south_b', file: 'asset/environment/maps/kit_south_b.png', ready: false,
        rows: [
          [10, 5, ['FOREST', 'BLDG', 'ROAD', 'FOREST', 'GRASS']],
          [11, 5, ['ROAD', 'ROAD', 'GRASS', 'FIELD', 'GRASS']],
          [12, 4, ['GRASS', 'ROAD', 'GRASS', 'GRASS', 'FOREST']]
        ]
      }
    ]
  },

  /**
   * kit モード制御
   * - enabled: kit 生成を試みるかどうか
   * - fixedNorth/fixedSouth: null = ランダム選択、'kit_north_a' 等で固定
   * - lastNorth/lastSouth: 最後に生成されたピース（デバッグ用）
   */
  kitMode: {
    // 2026-07-25 停止: kitピースもBlenderレンダー。PS生成物へ一本化した。
    enabled: false,
    fixedNorth: null,
    fixedSouth: null,
    lastNorth: null,
    lastSouth: null
  },

  /**
   * 別ロケーションの地形テーブル(コンパクト行形式)。
   * [r, 開始q, [左から右へのbase列]] — 盤面の行開始qは r7→7, r8→6, r9→6, r10→5, r11→5, r12→4。
   * 目視検収済みレンダー(scratchpad注釈グリッド)に基づき監督官が確定。
   */
  _locationRows: {
    loc_crossroad: [
      [7, 7, ['FOREST', 'ROAD', 'GRASS', 'FIELD', 'FOREST']],
      [8, 6, ['FOREST', 'GRASS', 'ROAD', 'BLDG', 'FIELD']],
      [9, 6, ['GRASS', 'BLDG', 'ROAD', 'GRASS', 'FOREST']],
      [10, 5, ['ROAD', 'ROAD', 'ROAD', 'ROAD', 'ROAD']],
      [11, 5, ['GRASS', 'ROAD', 'GRASS', 'FIELD', 'FOREST']],
      [12, 4, ['GRASS', 'GRASS', 'ROAD', 'GRASS', 'FIELD']],
    ],
    loc_forest_farm: [
      [7, 7, ['ROAD', 'FIELD', 'GRASS', 'BLDG', 'FOREST']],
      [8, 6, ['FOREST', 'ROAD', 'BLDG', 'GRASS', 'FOREST']],
      [9, 6, ['FOREST', 'ROAD', 'GRASS', 'GRASS', 'FOREST']],
      [10, 5, ['FOREST', 'ROAD', 'FOREST', 'FIELD', 'FIELD']],
      [11, 5, ['GRASS', 'ROAD', 'FIELD', 'FIELD', 'FOREST']],
      [12, 4, ['ROAD', 'ROAD', 'FOREST', 'GRASS', 'FOREST']],
    ],
    loc_shelled: [
      [7, 7, ['GRASS', 'ROAD', 'GRASS', 'BLDG', 'FOREST']],
      [8, 6, ['FOREST', 'GRASS', 'RUIN', 'GRASS', 'ROAD']],
      [9, 6, ['FIELD', 'RUIN', 'ROAD', 'ROAD', 'GRASS']],
      [10, 5, ['FIELD', 'FIELD', 'ROAD', 'RUIN', 'FOREST']],
      [11, 5, ['ROAD', 'ROAD', 'GRASS', 'GRASS', 'FOREST']],
      [12, 4, ['ROAD', 'GRASS', 'GRASS', 'GRASS', 'FIELD']],
    ],
    loc_church_square: [
      [7, 7, ['FOREST', 'ROAD', 'BLDG', 'FOREST', 'FOREST']],
      [8, 6, ['FOREST', 'GRASS', 'ROAD', 'BLDG', 'GRASS']],
      [9, 6, ['GRASS', 'BLDG', 'ROAD', 'BLDG', 'GRASS']],
      // (9,10)は住宅裏手の小径としてGRASSに開放 — BLDGのままだと東北隅
      // (10,7)(11,7)(10,8)(10,9)の4hexが盤面から完全に孤立する(接続性検証で発見)。
      [10, 5, ['GRASS', 'BLDG', 'ROAD', 'BLDG', 'GRASS']],
      [11, 5, ['FOREST', 'BLDG', 'ROAD', 'BLDG', 'FOREST']],
      [12, 4, ['FOREST', 'GRASS', 'ROAD', 'GRASS', 'FOREST']],
    ],
  },

  /** コンパクト行形式 → {q,r,base} 配列へ展開 */
  _rowsToTable(rows) {
    const out = [];
    for (const [r, q0, bases] of rows) {
      bases.forEach((base, i) => out.push({ q: q0 + i, r, base }));
    }
    return out;
  },

  /**
   * KIT_PIECES から north/south を選択
   * - fixedNorth/fixedSouth があれば優先
   * - 無ければ ready=true のものからランダム選択
   * - ready な north/south が両方1つ以上あれば { north, south } を返す
   * - 不足なら null を返す
   */
  _selectKitPieces() {
    const readyNorth = this.KIT_PIECES.north.filter(p => p.ready);
    const readySouth = this.KIT_PIECES.south.filter(p => p.ready);

    if (readyNorth.length === 0 || readySouth.length === 0) {
      // 不足、フォールバック
      return null;
    }

    let north = this.kitMode.fixedNorth
      ? this.KIT_PIECES.north.find(p => p.key === this.kitMode.fixedNorth)
      : readyNorth[Math.floor(Math.random() * readyNorth.length)];

    let south = this.kitMode.fixedSouth
      ? this.KIT_PIECES.south.find(p => p.key === this.kitMode.fixedSouth)
      : readySouth[Math.floor(Math.random() * readySouth.length)];

    if (!north || !south) {
      return null;
    }

    this.kitMode.lastNorth = north;
    this.kitMode.lastSouth = south;
    return { north, south };
  },

  /**
   * window.PS_BATTLEFIELDS の全エントリを VARIANTS へ自動登録する。
   *
   * シード生成(scripts/gen_ps_seed_map.py)で新しいマップを作るたびにJSを編集
   * しなくて済むようにするための機構。レジストリ(生成物)に載っていれば、
   * それだけでマップ候補になる。VARIANTS に手書きしたキーは上書きしない。
   */
  _registerPsBattlefields() {
    const registry = window.PS_BATTLEFIELDS;
    if (!registry) return;
    const known = new Set(this.VARIANTS.map(v => v.key));
    Object.keys(registry).forEach(name => {
      if (known.has(name)) return;
      const bf = registry[name];
      if (!bf || !bf.rows || !bf.image) return;
      const variant = {
        key: name,
        texture: name,
        file: `asset/environment/maps/${bf.image}`,
        rot180: false,
        ready: true,
        psNative: name
      };
      if (Number.isFinite(bf.pixelRatio) && bf.pixelRatio > 0) {
        variant.pixelRatio = bf.pixelRatio;
      }
      this.VARIANTS.push(variant);
    });
  },

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
   * kitMode が有効で、ready な north/south が両方1つ以上あれば、一定確率で kit 生成を試みる
   */
  generate(game) {
    // 生成済みPSキャンバス(レジストリ)を毎回取り込む。冪等。
    this._registerPsBattlefields();

    // Kit モード試行（30%確率で、かつ条件満たしていれば）
    let terrainTable = null;
    if (this.kitMode.enabled && Math.random() < 0.30) {
      const kitPieces = this._selectKitPieces();
      if (kitPieces) {
        // kit 生成成功
        const { north, south } = kitPieces;
        const northRows = north.rows;
        const southRows = south.rows;
        // 北3行 + 南3行を連結
        const allRows = [...northRows, ...southRows];
        terrainTable = this._rowsToTable(allRows);
        this.lastVariant = {
          key: `kit:${north.key}+${south.key}`,
          kit: true,
          north,
          south
        };
      }
    }

    // kit 不成立またはスキップ時は従来のバリアント選択へ
    if (!terrainTable) {
      this._selectVariant();
    }

    game.map = [];
    for (let q = 0; q < MAP_W; q++) {
      game.map[q] = [];
      for (let r = 0; r < MAP_H; r++) {
        game.map[q][r] = TERRAIN.VOID;
      }
    }

    // 選択されたバリアントに応じた地形テーブルを取得（kit未生成なら通常選択から）
    if (!terrainTable) {
      terrainTable = this._getTerrainTable();
    }

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

    // PS正本キャンバスは生成済みレジストリから行を取る(rot180と排他)
    if (this.lastVariant.psNative) {
      const bf = window.PS_BATTLEFIELDS && window.PS_BATTLEFIELDS[this.lastVariant.psNative];
      if (bf && bf.rows) return this._rowsToTable(bf.rows);
      console.error(`PS battlefield '${this.lastVariant.psNative}' not in window.PS_BATTLEFIELDS, using base table`);
      return this._terrain_table_base;
    }

    // 別ロケーションは専用テーブル(rot180と排他)
    if (this.lastVariant.table) {
      const rows = this._locationRows[this.lastVariant.table];
      if (rows) return this._rowsToTable(rows);
      console.error(`location table '${this.lastVariant.table}' not found, using base table`);
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

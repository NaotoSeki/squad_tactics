/**
 * LOGIC MAP CITY: WW2廃墟都市ジェネレータ (hex_tiles_v7)
 *
 * asset/environment/hex_tiles_v7/map_preview_explosions.html の genCity() を
 * 本編の MAP_W x MAP_H グリッドへ移植したもの。決定論的シード(h32)ベース。
 *
 * 生成結果は game.map[q][r] に既存 TERRAIN 互換オブジェクトとして格納する:
 *   { id, name, cost, cover, city: { ground, gfile, flat[], over[] } }
 * - 建物(bldg/church/factory)・ボカージュ = cost 99 (不可侵 — 経路探索が自動迂回)
 * - 塹壕/タコツボ = cost 1, cover 55 / 瓦礫 = cost 2, cover 40
 * - 荒地スカー/クレーター = cost 2 / 道路・街路 = cost 1
 *
 * 旧ジェネレータ(logic_map.js MapSystem.generate)はCityMap.enabled=falseで温存。
 */
window.CityMap = {
  enabled: true,
  /** 直近バトルで実際に都市マップを生成したか（レンダラの分岐に使う） */
  active: false,
  /** null = 毎回ランダム。数値固定でマップ再現可 */
  fixedSeed: null,
  lastSeed: 0,
  /** テスト/デバッグ時の直近生成診断。未解決文法は常に例外にする。 */
  lastDiagnostics: null,

  DIRS: [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]],
  SCAR_BASES: { e1: [0], e2a: [0, 1], e2o: [0, 3], e3: [0, 1, 2], e4: [0, 1, 2, 3], full: [0, 1, 2, 3, 4, 5] },
  NG: { cobble: 6, street: 3, grass: 6 },   // grass 3→6 (2026-07-14 反復対策で追加レンダー)

  /** grn_ / gnd_grass タイル(2026-07-13)納品済みにつき解禁 */
  GREEN_READY: true,

  /** kbres_{a-e}_rot* (Kitbash3D住宅、2026-07-15レンダー)納品後に true へ */
  KBRES_READY: false,

  h32(...args) {
    let s = args.join('|'), h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15;
    return h >>> 0;
  },
  rnd(...a) { return this.h32(...a) / 4294967295; },
  _setEq(a, b) { return a.size === b.length && b.every(x => a.has(x)); },

  scarResolve(mask) {
    let bits = 0;
    for (const k of mask) bits |= 1 << k;
    if (!this._scarCache) this._scarCache = new Array(64);
    if (this._scarCache[bits] !== undefined) return this._scarCache[bits];
    let found = null;
    if (mask.size) outer: for (const [pat, base] of Object.entries(this.SCAR_BASES))
      for (let r = 0; r < 6; r++)
        if (this._setEq(new Set([...mask].map(k => ((k - r) % 6 + 6) % 6)), base)) {
          found = [pat, r * 60]; break outer;
        }
    this._scarCache[bits] = found;
    return found;
  },

  roadTile(dirs, seed, q, r) {
    const nvar = { straight: 4, corner: 3, tee: 2, cross: 2 };
    const ds = [...new Set(dirs)].sort((a, b) => a - b);
    const f = (pat, rot) => `road_${pat}_v${this.h32(seed, q, r, 'rv') % nvar[pat]}_rot${rot}.png`;
    if (ds.length === 2) {
      const [a, b] = ds;
      if ((b - a) % 6 === 3) return f('straight', (a % 3) * 60);
      if ((b - a) % 6 === 2) return f('corner', a * 60);
      if (((a - b) % 6 + 6) % 6 === 2) return f('corner', b * 60);
    }
    if (ds.length === 3)
      for (let k = 0; k < 6; k++)
        if (this._setEq(new Set(ds.map(d => ((d - k) % 6 + 6) % 6)), [0, 2, 3]))
          return f('tee', k * 60);
    if (ds.length === 4)
      for (const k of [0, 1, 2])
        if (this._setEq(new Set(ds.map(d => ((d - k) % 6 + 6) % 6)), [0, 2, 3, 5]))
          return f('cross', k * 60);
    return null;
  },

  /**
   * 都市セルグリッドを生成して返す。Map<'q,r', cell>
   * cell = { q, r, ground, gfile, flat[], over[], wreck, dist, open, scar }
   */
  genCity(seed, COLS, ROWS) {
    const h32 = this.h32.bind(this);
    const rnd = this.rnd.bind(this);
    const DIRS = this.DIRS;
    const grid = new Map();
    const key = (q, r) => q + ',' + r;
    const at = (q, r) => grid.get(key(q, r));
    const diagnostics = { green: [], scar: [], road: [], roadRevisit: [], coreStages: [] };

    // --- オーガニック市街地シルエット: 中心からのランダムウォークでプレイ可能
    //     領域を成形する(MapSystem.generate()のpaintBrush walkerと同じ発想を
    //     CityMap自身の決定論的シード(h32)で再実装)。固定COLS×ROWS矩形を全部
    //     openにする旧方式は軸座標→画面変換で必ずひし形になる欠陥があった
    //     (2026-07-13 ユーザー指摘: 「なぜ毎回ひし形？」)。
    const cx = COLS / 2, cy = ROWS / 2;
    const cx0 = Math.floor(cx), cr0 = Math.floor(cy);
    const core = new Set([key(cx0, cr0)]);
    const paintCore = (q, r) => {
      core.add(key(q, r));
      DIRS.forEach(d => {
        const nq = q + d[0], nr = r + d[1];
        if (nq >= 0 && nq < COLS && nr >= 0 && nr < ROWS) core.add(key(nq, nr));
      });
    };
    // ウォーカーには中心へのソフト引力(遊泳半径制限)をかける。制限なしの
    // クランプ付きランダムウォークはグリッド全体へ薄く広がる「網状」になり、
    // 網の穴はどこを削っても連結が切れる→正規化が充填一辺倒→グリッド全域
    // 充填=ひし形回帰、という連鎖の起点だった(2026-07-15実測)。
    // 距離はスクリーン空間で測る(軸座標のユークリッドは画面上で斜めに歪む)。
    const scrDist = (q, r) => {
      const dx = (q - cx) + (r - cy) / 2;
      const dy = 0.866 * (r - cy);
      return Math.hypot(dx, dy);
    };
    const maxRad = Math.min(COLS, ROWS) * 0.38;
    let walkers = [{ q: cx0, r: cr0 }];
    const nSteps = Math.round(COLS * ROWS * 0.9);
    for (let i = 0; i < nSteps; i++) {
      const wi = h32(seed, 'wsel', i) % walkers.length;
      const w = walkers[wi];
      paintCore(w.q, w.r);
      let dir = DIRS[h32(seed, 'wdir', i) % 6];
      if (scrDist(w.q + dir[0], w.r + dir[1]) > maxRad) {
        let bd = Infinity;
        for (const d2 of DIRS) {
          const dd = scrDist(w.q + d2[0], w.r + d2[1]);
          if (dd < bd) { bd = dd; dir = d2; }
        }
      }
      const next = { q: Math.max(0, Math.min(COLS - 1, w.q + dir[0])),
                     r: Math.max(0, Math.min(ROWS - 1, w.r + dir[1])) };
      if (rnd(seed, 'wsplit', i) < 0.035 && walkers.length < 5) walkers.push(next);
      else walkers[wi] = next;
    }
    // 形態学的平滑化: くぼみ充填(隣接4+)と細い触手の除去(隣接2-)を交互に。
    // ウォーカーは時々「細い触手つき」の形を出し、それが後段のマスク正規化と
    // 相性最悪(削ると連結が切れる→充填フォールバック→連鎖膨張でひし形回帰)
    // だった(2026-07-15実測: walkerCore 169→正規化後288)。触手はここで
    // 退縮させ、正規化の仕事を残さない。
    for (let pass = 0; pass < 3; pass++) {
      const add = [];
      for (let r = 0; r < ROWS; r++) for (let q = 0; q < COLS; q++) {
        const k = key(q, r);
        if (core.has(k)) continue;
        if (DIRS.filter(d => core.has(key(q + d[0], r + d[1]))).length >= 4) add.push(k);
      }
      add.forEach(k => core.add(k));
      const del = [];
      for (const k of core) {
        const [q, r] = k.split(',').map(Number);
        if (DIRS.filter(d => core.has(key(q + d[0], r + d[1]))).length <= 2) del.push(k);
      }
      del.forEach(k => core.delete(k));
    }
    // 最大連結成分のみ採用(触手除去でダンベル形が分離した場合の衛星を捨てる)
    {
      const seen = new Set();
      let bestComp = null;
      for (const start of core) {
        if (seen.has(start)) continue;
        const comp = [start];
        seen.add(start);
        for (let i = 0; i < comp.length; i++) {
          const [q, r] = comp[i].split(',').map(Number);
          for (const [dq, dr] of DIRS) {
            const nk = key(q + dq, r + dr);
            if (core.has(nk) && !seen.has(nk)) { seen.add(nk); comp.push(nk); }
          }
        }
        if (!bestComp || comp.length > bestComp.length) bestComp = comp;
      }
      if (bestComp && bestComp.length < core.size) {
        core.clear();
        bestComp.forEach(k => core.add(k));
      }
    }
    diagnostics.coreStages.push(['smoothed', core.size]);

    // --- 外周グリーンフリンジ: coreから3リングを草地遷移候補にする。
    //     遷移語彙にない境界は、連結性を保ったままcoreの突起を最小限削って
    //     正規化する。囲まれた1セル穴だけはcoreへ埋める。
    let fringe = new Set();
    const buildFringe = () => {
      const out = new Set();
      let frontier = new Set(core);
      for (let grow = 0; grow < 3; grow++) {
        const next = new Set();
        for (const c of frontier) {
          const [q, r] = c.split(',').map(Number);
          for (const [dq, dr] of DIRS) {
            const nq = q + dq, nr = r + dr, nk = key(nq, nr);
            if (nq < 0 || nr < 0 || nq >= COLS || nr >= ROWS || core.has(nk) || out.has(nk)) continue;
            out.add(nk); next.add(nk);
          }
        }
        frontier = next;
      }
      return out;
    };
    const greenMaskFor = (q, r) => new Set(DIRS.map((d, k) => {
      const nq = q + d[0], nr = r + d[1];
      if (nq < 0 || nr < 0 || nq >= COLS || nr >= ROWS) return k;
      return core.has(key(nq, nr)) ? -1 : k;
    }).filter(k => k >= 0));
    // ※形状正規化は廃止(2026-07-15)。境界をタイル語彙に合わせてcoreを変形する
    //   方式は、語彙が凸角(core隣接1つ=マスクサイズ5)すら表現できないため
    //   「ほぼ凸の巨大な塊→グリッド全面=ひし形」へ必然的に収束する
    //   (GPT-4.6版で実測: core 167→335)。coreの形は一切変えず、
    //   表現できない境界は割当段の「エッジ反転」(語彙で表現できない緑セルを
    //   全面草地へ昇格し、共有エッジの草をcore側セルのgrnローブで受ける)で
    //   吸収する — grnタイルは逆から読めば「石畳に草が食い込む」タイルとして
    //   そのまま使える。
    if (this.GREEN_READY) fringe = buildFringe();
    // --- A*道路網: 旧方式(水平アベニュー直線+対角線を2行毎にq-1する機械的
    //     ジグザグ)は軸座標→画面変換の補正が段差として丸見えだった欠陥があった
    //     (2026-07-13 ユーザー指摘)。logic_map.js MapSystem.findRoadPath と同じ
    //     発想(地形コスト+並走ペナルティ+正弦ノイズ)をcoreの外郭アンカー間で
    //     実行し、有機的に湾曲する道をA*で見つける。roadTile()によるタイル
    //     選択(neighbor方向マスク)は既存のまま流用。
    const streets = new Set();
    // 道路の接続は「実際に敷いた経路のグラフ」で管理する(空間的な隣り合わせから
    // 推定しない)。旧方式は交差点のナナメ隣で {a,a+1,a+3} のようなタイル非対応
    // マスクを作り、フォールバックの全面グレー(gnd_street)が湧いていた
    // (2026-07-14 ユーザー指摘の「交差点の丸坊主ヘックス」の正体)。
    const roadLinks = new Map();   // key -> Set(実接続エッジ方向)
    const linkAdd = (k, d) => { if (!roadLinks.has(k)) roadLinks.set(k, new Set()); roadLinks.get(k).add(d); };
    const roadCostAt = (q, r, fromDir, toDir, avoid) => {
      let cost = 1.0;
      cost += Math.sin(q * 0.61 + r * 0.47) * 0.45 + Math.cos(q * 0.29 - r * 0.53) * 0.4;
      if (avoid && DIRS.some(d => avoid.has(key(q + d[0], r + d[1])))) cost += 3.5;
      cost += (fromDir === toDir) ? 0.22 : -0.1;
      return Math.max(0.4, cost);
    };
    /**
     * 状態=(セル,進行方向)のA*。タイルセットの文法に合わせて進行方向の変化を
     * 0°/±60°に制限する — ±120°ターン({a,a+1}エッジ対)のタイルは存在しないため、
     * バリエーションを量産するのではなく生成側が文法を守る。
     * 戻り値: [{q,r,d}...] (d=そのセルへ入った移動方向)。失敗時 null。
     */
    const findRoadPathLocal = (sq, sr, tq, tr, opts) => {
      const blocked = opts && opts.blocked;
      const avoid = opts && opts.avoid;
      const startDir = opts && opts.startDir != null ? opts.startDir : null;
      const skey = (q, r, d) => q + ',' + r + ',' + d;
      const gScore = new Map(), cameFrom = new Map();
      const openList = [], closedCells = new Set();
      const h = (q, r) => hexDist({ q, r }, { q: tq, r: tr }) * 1.05;
      const seedDirs = startDir != null ? [startDir] : [0, 1, 2, 3, 4, 5];
      for (const d of seedDirs) {
        gScore.set(skey(sq, sr, d), 0);
        openList.push({ q: sq, r: sr, d, f: h(sq, sr) });
      }
      let goal = null;
      while (openList.length > 0) {
        openList.sort((a, b) => a.f - b.f);
        const cur = openList.shift();
        // 同じ座標を別方向状態で再展開すると、経路が自分自身へ戻って非対応の
        // 3辺マスクを作る。開始セルだけは初期方向候補6つを全て展開してよい。
        const coord = key(cur.q, cur.r);
        const isStart = cur.q === sq && cur.r === sr;
        if (!isStart && closedCells.has(coord)) continue;
        if (!isStart) closedCells.add(coord);
        if (cur.q === tq && cur.r === tr) { goal = cur; break; }
        const ck = skey(cur.q, cur.r, cur.d);
        const g0 = gScore.get(ck);
        DIRS.forEach((dv, di) => {
          const delta = (di - cur.d + 6) % 6;
          if (delta === 2 || delta === 3 || delta === 4) return;   // 急カーブ・反転禁止
          const nq = cur.q + dv[0], nr = cur.r + dv[1];
          if (nq < 0 || nr < 0 || nq >= COLS || nr >= ROWS) return;
          const nk = key(nq, nr);
          if (!core.has(nk)) return;                // 道路は市街地コア内のみ
          if (blocked && blocked.has(nk)) return;   // 既設道路への再突入禁止
          const ng = g0 + roadCostAt(nq, nr, cur.d, di, avoid);
          const sk2 = skey(nq, nr, di);
          if (!gScore.has(sk2) || ng < gScore.get(sk2)) {
            gScore.set(sk2, ng); cameFrom.set(sk2, ck);
            openList.push({ q: nq, r: nr, d: di, f: ng + h(nq, nr) });
          }
        });
      }
      if (!goal) return null;
      const seq = [];
      let k2 = skey(goal.q, goal.r, goal.d);
      while (k2) {
        const [qq, rr, dd] = k2.split(',').map(Number);
        seq.push({ q: qq, r: rr, d: dd });
        k2 = cameFrom.get(k2);
      }
      return seq.reverse();
    };
    /**
     * 経路をstreets+roadLinksへ焼き込む。backEdge=先頭セルの後方接続
     * (nullなら最初の移動方向の逆=「道はマップ外へ続いている」仮想継続。
     *  行き止まりタイルは存在しないので、端は必ず継続扱いにする)。
     */
    const paintSeq = (seq, backEdge) => {
      if (!seq || seq.length < 2) return false;
      const seen = new Set();
      for (const c of seq) {
        const ck = key(c.q, c.r);
        if (seen.has(ck)) {
          diagnostics.roadRevisit.push({ q: c.q, r: c.r });
          this.lastDiagnostics = diagnostics;
          throw new Error(`[CityMap] road path revisited ${ck}`);
        }
        seen.add(ck);
      }
      for (let i = 0; i < seq.length; i++) {
        const c = seq[i];
        streets.add(key(c.q, c.r));
        if (i > 0) {
          linkAdd(key(c.q, c.r), (c.d + 3) % 6);
          linkAdd(key(seq[i - 1].q, seq[i - 1].r), c.d);
        }
      }
      linkAdd(key(seq[0].q, seq[0].r), backEdge != null ? backEdge : (seq[1].d + 3) % 6);
      const last = seq[seq.length - 1];
      linkAdd(key(last.q, last.r), last.d);   // 前方も仮想継続
      return true;
    };
    let west = null, east = null, north = null, south = null;
    for (const c of core) {
      const [q, r] = c.split(',').map(Number);
      if (!west || q < west.q) west = { q, r };
      if (!east || q > east.q) east = { q, r };
      if (!north || r < north.r) north = { q, r };
      if (!south || r > south.r) south = { q, r };
    }
    // 幹線: 西→東。支線: 幹線の直進セルからT分岐(構築的にteeタイル保証)して
    // 南北の遠い方へ。交差(crossタイル)は幾何条件が厳しいのでT字のみ使う。
    const seq1 = (west && east && !(west.q === east.q && west.r === east.r))
      ? findRoadPathLocal(west.q, west.r, east.q, east.r, {}) : null;
    if (seq1) {
      paintSeq(seq1, null);
      if (seq1.length >= 5 && north && south) {
        const distToRoad = (a) => Math.min.apply(null, seq1.map(c => hexDist(a, c)));
        const target = distToRoad(south) >= distToRoad(north) ? south : north;
        const candidates = [];
        for (let i = 2; i < seq1.length - 2; i++) {
          if (seq1[i].d === seq1[i + 1].d) candidates.push(i);
        }
        const order = candidates
          .map((i, j) => [h32(seed, 'br', j), i]).sort((x, y) => x[0] - y[0]).map(x => x[1]);
        outer2: for (const i of order) {
          const J = seq1[i];
          const axis = seq1[i + 1].d;
          for (const e of [(axis + 2) % 6, (axis + 5) % 6]) {
            const bq2 = J.q + DIRS[e][0], br2 = J.r + DIRS[e][1];
            if (bq2 < 0 || br2 < 0 || bq2 >= COLS || br2 >= ROWS) continue;
            const bk = key(bq2, br2);
            if (!core.has(bk) || streets.has(bk)) continue;
            if (bq2 === target.q && br2 === target.r) continue;
            const seq2 = findRoadPathLocal(bq2, br2, target.q, target.r,
              { startDir: e, blocked: streets, avoid: streets });
            if (seq2) {
              linkAdd(key(J.q, J.r), e);          // 交差点にT分岐エッジ({a,a+3}+{a+2}=tee)
              paintSeq(seq2, (e + 3) % 6);        // 分岐初セルの後方接続=交差点
              break outer2;
            }
          }
        }
      }
    }

    // Keep one building-free vehicle lane connected to the road graph. The road
    // grammar can legitimately reject a steep secondary branch; this lane is a
    // narrow cobbled access route that still guarantees both deployment halves
    // share one vehicle-passable component.
    const vehicleLane = new Set();
    const roadRows = [...streets].map(c => Number(c.split(',')[1]));
    const hasNorthRoad = roadRows.some(r => r < ROWS / 2);
    const hasSouthRoad = roadRows.some(r => r >= ROWS / 2);
    let laneStarts = [], laneGoal = null;
    if (streets.size && (!hasNorthRoad || !hasSouthRoad)) {
      laneStarts = [...streets].sort();
      laneGoal = c => {
        const r = Number(c.split(',')[1]);
        return hasNorthRoad ? r >= ROWS / 2 : r < ROWS / 2;
      };
    } else if (!streets.size && north && south) {
      laneStarts = [key(north.q, north.r)];
      const southKey = key(south.q, south.r);
      laneGoal = c => c === southKey;
    }
    if (laneGoal) {
      const parent = new Map(), queue = [];
      for (const c of laneStarts) { parent.set(c, null); queue.push(c); }
      let goal = null;
      for (let i = 0; i < queue.length && !goal; i++) {
        const c = queue[i], [q, r] = c.split(',').map(Number);
        if (laneGoal(c)) { goal = c; break; }
        for (const [dq, dr] of DIRS) {
          const nk = key(q + dq, r + dr);
          if (!core.has(nk) || parent.has(nk)) continue;
          parent.set(nk, c); queue.push(nk);
        }
      }
      if (!goal) {
        diagnostics.road.push({ reason: 'vehicle lane could not reach both deployment halves' });
        this.lastDiagnostics = diagnostics;
        throw new Error('[CityMap] vehicle lane connectivity failed');
      }
      for (let c = goal; c != null; c = parent.get(c)) vehicleLane.add(c);
    }
    // --- グリッド確定(1パス): core/fringe/VOID + 街路の最終分類をセルへ反映
    for (let r = 0; r < ROWS; r++) for (let q = 0; q < COLS; q++) {
      const k = key(q, r);
      const dist = Math.hypot(q - cx, r - cy) / Math.max(cx, cy);
      const isCore = core.has(k);
      const isFringe = !isCore && fringe.has(k);
      const wreck = Math.max(0, 1 - dist) + (rnd(seed, q, r, 'n') - 0.5) * 0.55;
      const cell = { q, r, ground: isFringe ? 'grass' : 'cobble', gfile: null, flat: [], over: [], decals: [],
                     wreck, dist, open: isCore, scar: false, green: isFringe, void: !isCore && !isFringe,
                     _vehicleLane: vehicleLane.has(k) };
      if (isCore && streets.has(k)) { cell.open = false; cell.ground = 'street'; }
      grid.set(k, cell);
    }

    // --- グリーンフリンジのタイル割当(エッジ反転方式)。
    //     語彙で表現できない緑マスク(凸角=core隣接1つのサイズ5等)のセルは
    //     全面草地へ「昇格」し、core側との共有エッジを草に反転する。反転を
    //     受けたcoreセルは地面をgrnタイル(石畳+草ローブ)にして両側の
    //     エッジ色を一致させる。coreの形・通行データは一切変えない。
    const flippedCore = new Set();   // 草ローブ地面を持つcoreセル(スカー等の上書き禁止)
    if (this.GREEN_READY) {
      const flips = new Map();       // coreセルkey -> Set(草エッジ方向)
      const addFlip = (k, d) => { if (!flips.has(k)) flips.set(k, new Set()); flips.get(k).add(d); };
      const promoted = new Set();
      const promote = (c) => {
        if (promoted.has(c)) return;
        promoted.add(c);
        const [q, r] = c.split(',').map(Number);
        const m = greenMaskFor(q, r);
        for (let d = 0; d < 6; d++) {
          if (m.has(d)) continue;   // core方向のみ反転
          const nk = key(q + DIRS[d][0], r + DIRS[d][1]);
          if (core.has(nk)) addFlip(nk, (d + 3) % 6);
        }
      };
      // pass1: 非解決マスクの緑セルを昇格
      for (const c of fringe) {
        const [q, r] = c.split(',').map(Number);
        const m = greenMaskFor(q, r);
        if (!m.size || !this.scarResolve(m)) promote(c);
      }
      // pass2: core側の反転集合が語彙外なら、弧間ギャップの隣接緑セルも昇格して
      //        連続弧化(定点反復)。ギャップ相手がcore/道路のときは打ち切り(まれ)
      for (let it = 0; it < 4; it++) {
        let changed = false;
        for (const [k, fset] of flips) {
          if (!fset.size || this.scarResolve(fset)) continue;
          const [q, r] = k.split(',').map(Number);
          for (let d = 0; d < 6 && !this.scarResolve(fset); d++) {
            if (fset.has(d)) continue;
            if (!(fset.has((d + 1) % 6) && fset.has((d + 5) % 6))) continue;   // 両隣が草の1エッジギャップ
            const nk = key(q + DIRS[d][0], r + DIRS[d][1]);
            if (core.has(nk)) continue;   // core-coreエッジは反転しない
            fset.add(d);
            if (fringe.has(nk)) promote(nk);
            changed = true;
          }
        }
        if (!changed) break;
      }
      // 割当: 緑セル
      for (const c of fringe) {
        const [q, r] = c.split(',').map(Number);
        const cell = at(q, r);
        if (!cell) continue;
        const m = greenMaskFor(q, r);
        const resolved = promoted.has(c) ? ['full', 0] : (m.size ? this.scarResolve(m) : null) || ['full', 0];
        const [pat, rot] = resolved;
        if (pat === 'full') { cell.ground = 'grass'; cell.gfile = null; }
        else {
          cell.ground = 'grn';
          cell.gfile = `grn_${pat}_v${this.h32(seed, q, r, 'gv2') % 2}_rot${rot}.png`;
        }
      }
      // 割当: 反転を受けたcoreセルへ草ローブ地面(機能は市街のまま、絵だけgrn)
      for (const [k, fset] of flips) {
        const [q, r] = k.split(',').map(Number);
        const cell = at(q, r);
        if (!cell || !fset.size) continue;
        if (cell.ground !== 'cobble') {   // 道路/舗装は上書きしない(まれな硬エッジは許容)
          diagnostics.green.push({ q, r, reason: 'flip onto non-cobble', ground: cell.ground });
          continue;
        }
        const resolved = this.scarResolve(fset);
        if (!resolved) {   // pass2でも直せない語彙外(まれ) — 石畳のまま許容
          diagnostics.green.push({ q, r, reason: 'unresolvable core flips', mask: [...fset] });
          continue;
        }
        const [pat, rot] = resolved;
        if (pat === 'full') { cell.ground = 'grass'; cell.gfile = null; }
        else {
          cell.ground = 'grn';
          cell.gfile = `grn_${pat}_v${this.h32(seed, q, r, 'gv3') % 2}_rot${rot}.png`;
        }
        // open=false でスカー/建物/塹壕の既存ゲート全てから除外(草ローブの
        // 上書き防止)。通行・地形データは石畳のまま
        cell.open = false;
        flippedCore.add(k);
      }
    }

    // --- 荒地ブロブ + 2hexクレーター（個数は面積比例: プレビュー 12x9 で 1-2 個）
    const scarCells = new Set();
    const pairCells = new Map();
    const nBlob = Math.max(1, Math.round(COLS * ROWS / 72)) + h32(seed, 'nblob') % 2;
    for (let i = 0; i < nBlob; i++) {
      for (let t = 0; t < 20; t++) {
        const bq_ = 1 + h32(seed, 'blq', i, t) % (COLS - 3);
        const br_ = 1 + h32(seed, 'blr', i, t) % (ROWS - 2);
        const k = h32(seed, 'blk', i, t) % 3;
        const nb = [bq_ + DIRS[k][0], br_ + DIRS[k][1]];
        const c0 = at(bq_, br_), c1 = at(nb[0], nb[1]);
        if (!c0 || !c0.open || !c1 || !c1.open) continue;
        // cpairの周囲1リングを道路・既設scarから離す。セットピースの外周が
        // 非対応マスクで切り取られることを生成時点で防ぐ。
        const footprint = new Set([key(bq_, br_), key(nb[0], nb[1])]);
        for (const cc of [[bq_, br_], nb]) for (const [dq, dr] of DIRS)
          footprint.add(key(cc[0] + dq, cc[1] + dr));
        if ([...footprint].some(kk => {
          const [fq, fr] = kk.split(',').map(Number), fc = at(fq, fr);
          return !fc || !fc.open || scarCells.has(kk);
        })) continue;
        const v = h32(seed, 'blv', i) % 4;
        pairCells.set(key(bq_, br_), `cpair_v${v}_a_rot${k * 60}.png`);
        pairCells.set(key(nb[0], nb[1]), `cpair_v${v}_b_rot${k * 60}.png`);
        scarCells.add(key(bq_, br_)); scarCells.add(key(nb[0], nb[1]));
        for (const cc of [[bq_, br_], nb])
          for (const [dq, dr] of DIRS) {
            const n2 = at(cc[0] + dq, cc[1] + dr);
            if (n2 && n2.open) scarCells.add(key(n2.q, n2.r));
          }
        break;
      }
    }
    const frontier = [...scarCells].filter(c => !pairCells.has(c));
    const extra = 2 + h32(seed, 'blx') % 4;
    for (let j = 0; j < extra && frontier.length; j++) {
      const c = frontier[h32(seed, 'blf', j) % frontier.length].split(',').map(Number);
      for (const [dq, dr] of DIRS) {
        const n2 = at(c[0] + dq, c[1] + dr);
        if (n2 && n2.open && !scarCells.has(key(n2.q, n2.r)) &&
            rnd(seed, 'blg', j, n2.q, n2.r) < 0.5) {
          scarCells.add(key(n2.q, n2.r)); frontier.push(key(n2.q, n2.r));
        }
      }
    }
    const maskOf = (q, r) => new Set(DIRS.map((d, k) =>
      scarCells.has(key(q + d[0], r + d[1])) ? k : -1).filter(k => k >= 0));
    // 既存語彙へ単調に近づける。まず1セル追加で現セルを解決できる候補を採用し、
    // 道路等で追加不能な孤立突起だけを削る。削ったセルは再追加しないため収束する。
    const removedScar = new Set();
    for (let pass = 0; pass < COLS * ROWS * 4; pass++) {
      const bad = [...scarCells].filter(c => {
        if (pairCells.has(c)) return false;
        const [q, r] = c.split(',').map(Number);
        return !this.scarResolve(maskOf(q, r));
      }).sort();
      if (!bad.length) break;
      let changed = false;
      for (const c of bad) {
        if (!scarCells.has(c) || pairCells.has(c)) continue;
        const [q, r] = c.split(',').map(Number);
        const mask = maskOf(q, r);
        if (this.scarResolve(mask)) continue;
        const candidates = [];
        for (let k = 0; k < 6; k++) {
          if (mask.has(k)) continue;
          const nq = q + DIRS[k][0], nr = r + DIRS[k][1], nk = key(nq, nr);
          const n2 = at(nq, nr);
          if (!n2 || !n2.open || scarCells.has(nk) || removedScar.has(nk)) continue;
          const trial = new Set(mask); trial.add(k);
          if (this.scarResolve(trial)) candidates.push([h32(seed, 'scarfix', q, r, k), nk]);
        }
        if (candidates.length) {
          candidates.sort((a, b) => a[0] - b[0]);
          scarCells.add(candidates[0][1]);
        } else {
          scarCells.delete(c);
          removedScar.add(c);
        }
        changed = true;
      }
      if (!changed) break;
    }
    const badScar = [...scarCells].filter(c => {
      if (pairCells.has(c)) return false;
      const [q, r] = c.split(',').map(Number);
      return !this.scarResolve(maskOf(q, r));
    });
    if (badScar.length) {
      diagnostics.scar.push(...badScar.map(c => {
        const [q, r] = c.split(',').map(Number);
        return { q, r, mask: [...maskOf(q, r)] };
      }));
      this.lastDiagnostics = diagnostics;
      throw new Error(`[CityMap] scar topology normalization failed (${badScar.length})`);
    }    for (const c of scarCells) {
      const [q, r] = c.split(',').map(Number);
      const cell = at(q, r);
      if (!cell) continue;
      cell.scar = true; cell.open = false;
      if (pairCells.has(c)) { cell.ground = 'pair'; cell.gfile = pairCells.get(c); }
      else {
        const res = this.scarResolve(maskOf(q, r));
        if (!res) {
          diagnostics.scar.push({ q, r, mask: [...maskOf(q, r)] });
          this.lastDiagnostics = diagnostics;
          throw new Error(`[CityMap] unresolved scar mask at ${q},${r}`);
        }
        const [pat, rot] = res;
        const nv = pat === 'full' ? 3 : 2;
        cell.ground = 'scar';
        cell.gfile = `scar_${pat}_v${h32(seed, q, r, 'sv') % nv}_rot${pat === 'full' ? 0 : rot}.png`;
      }
    }

    // --- 道路タイル割当: 実接続グラフ(roadLinks)からマスクを引く。
    //     文法違反を石畳へ戻して隠す安全網は廃止し、生成エラーとして可視化する。
    for (const s of streets) {
      const [q, r] = s.split(',').map(Number);
      const cell = at(q, r);
      if (!cell) continue;
      const dirs = [...(roadLinks.get(s) || [])];
      const t = this.roadTile(dirs, seed, q, r);
      if (!t) diagnostics.road.push({ q, r, dirs });
      else { cell.ground = 'road'; cell.gfile = t; }
    }
    if (diagnostics.road.length) {
      this.lastDiagnostics = diagnostics;
      const x = diagnostics.road[0];
      throw new Error(`[CityMap] unresolved road mask at ${x.q},${x.r}: ${x.dirs}`);
    }
    // --- 反復パターン対策: 全面タイル(石畳/草地/スカー全面)のバリアントを
    //     「隣接セルと同じ絵を選ばない」貪欲割当にする。バリエーション量産では
    //     なく並べ方で解決(2026-07-14 双子クレーター等の反復感指摘への対応)。
    //     走査順で既訪問の隣接(W/NW/NE)を避ければ体感上の反復はほぼ消える。
    for (let r = 0; r < ROWS; r++) for (let q = 0; q < COLS; q++) {
      const cell = at(q, r);
      if (!cell || cell.void) continue;
      let fam = null, n = 0;
      if (!cell.gfile && cell.ground === 'cobble') { fam = 'cobble'; n = this.NG.cobble; }
      else if (!cell.gfile && cell.ground === 'grass') { fam = 'grass'; n = this.NG.grass; }
      else if (cell.gfile && /^scar_full_/.test(cell.gfile)) { fam = 'scarfull'; n = 6; }
      if (!fam) continue;
      const used = new Set();
      for (const [dq, dr] of DIRS) {
        const nb = at(q + dq, r + dr);
        if (nb && nb._fullVar && nb._fullVar.fam === fam) used.add(nb._fullVar.v);
      }
      let v = h32(seed, q, r, 'fv') % n;
      for (let t2 = 0; t2 < n && used.has(v); t2++) v = (v + 1) % n;
      cell._fullVar = { fam, v };
      if (fam === 'scarfull') cell.gfile = `scar_full_v${v}_rot0.png`;
      else cell.gfile = `gnd_${fam}_v${v}.png`;
    }

    // --- 地形にアンカーした防御線。固定r行ではなく、実core境界・道路・scarに
    //     接する連続空きセルを選ぶ。建物より先に予約して通常マップでも確実に現れる。
    const straightCandidates = (predicate, minLen, maxLen, salt, scoreFn) => {
      const out = [];
      for (let axis = 0; axis < 3; axis++) {
        const [dq, dr] = DIRS[axis];
        for (let r = 0; r < ROWS; r++) for (let q = 0; q < COLS; q++) {
          const seq = [];
          for (let n = 0; n < maxLen; n++) {
            const c = at(q + dq * n, r + dr * n);
            if (!c || !predicate(c)) break;
            seq.push(c);
          }
          if (seq.length < minLen) continue;
          const span = minLen + h32(seed, salt, q, r, axis) % (seq.length - minLen + 1);
          const cells = seq.slice(0, span);
          out.push({ axis, cells, score: scoreFn(cells), tie: h32(seed, salt, 'tie', q, r, axis) });
        }
      }
      return out.sort((a, b) => b.score - a.score || a.tie - b.tie);
    };
    const edgeScore = cells => {
      let score = 0;
      for (const c of cells) for (const [dq, dr] of DIRS) {
        const n = at(c.q + dq, c.r + dr);
        if (!n || n.void || n.green) score += 4;
        else if (n.ground === 'road') score += 3;
        else if (n.scar) score += 2;
      }
      return score;
    };
    const coreFree = c => c.open && !c.green && !c.void;
    const trenchPick = straightCandidates(coreFree, 3, 6, 'trenchLine', edgeScore).find(x => x.score > 0);
    if (trenchPick) {
      const axis = trenchPick.axis, rot = (axis % 3) * 60;
      trenchPick.cells.forEach((c, i) => {
        if (i === 0) c.flat.push(`trench_end_v0_rot${axis * 60}.png`);
        else if (i === trenchPick.cells.length - 1) c.flat.push(`trench_end_v0_rot${(axis + 3) * 60}.png`);
        else c.flat.push(`trench_straight_v${h32(seed, c.q, c.r, 'tv') % 2}_rot${rot}.png`);
        c.open = false; c._defense = 'trench';
      });
      const sideOptions = [(axis + 2) % 6, (axis + 5) % 6];
      const sideCount = d => trenchPick.cells.filter(c => {
        const n = at(c.q + DIRS[d][0], c.r + DIRS[d][1]);
        return n && n.open;
      }).length;
      const aCount = sideCount(sideOptions[0]), bCount = sideCount(sideOptions[1]);
      const frontDir = aCount === bCount
        ? sideOptions[h32(seed, 'trenchSide') % 2]
        : (aCount < bCount ? sideOptions[0] : sideOptions[1]);
      const wireFree = w => w && !w.void && !w._defense && !w.scar && w.ground !== 'road';
      const foxFree = f => f && !f.void && !f._defense && !f.scar && f.ground !== 'road';
      let wirePlaced = 0, foxPlaced = 0;
      for (const c of trenchPick.cells) {
        const w = at(c.q + DIRS[frontDir][0], c.r + DIRS[frontDir][1]);
        if (wireFree(w) && rnd(seed, c.q, c.r, 'wirePlace') < 0.82) {
          w.over.push(`wire_v${h32(seed, c.q, c.r, 'wv') % 2}_rot${rot}.png`);
          w.open = false; w._defense = 'wire'; wirePlaced++;
        }
        const rearDir = (frontDir + 3) % 6;
        const f = at(c.q + DIRS[rearDir][0], c.r + DIRS[rearDir][1]);
        if (foxFree(f) && rnd(seed, c.q, c.r, 'foxPlace') < 0.48) {
          f.flat.push(`foxhole_v${h32(seed, c.q, c.r, 'fv') % 2}_rot0.png`);
          f.open = false; f._defense = 'foxhole'; foxPlaced++;
        }
      }
      // 短い線でも各族が計測可能になるよう、空き候補があれば最低1セルを保証。
      if (!wirePlaced) for (const c of trenchPick.cells) {
        const w = at(c.q + DIRS[frontDir][0], c.r + DIRS[frontDir][1]);
        if (wireFree(w)) {
          w.over.push(`wire_v${h32(seed, c.q, c.r, 'wvf') % 2}_rot${rot}.png`);
          w.open = false; w._defense = 'wire'; break;
        }
      }
      if (!foxPlaced) for (const c of trenchPick.cells) {
        const rearDir = (frontDir + 3) % 6;
        const f = at(c.q + DIRS[rearDir][0], c.r + DIRS[rearDir][1]);
        if (foxFree(f)) {
          f.flat.push(`foxhole_v${h32(seed, c.q, c.r, 'fvf') % 2}_rot0.png`);
          f.open = false; f._defense = 'foxhole'; break;
        }
      }
    }

    const keepsInfantryConnected = blocked => {
      const passable = [...grid.values()].filter(c => !c.void && !blocked.has(key(c.q, c.r)));
      if (!passable.length) return false;
      const seen = new Set([key(passable[0].q, passable[0].r)]), queue = [passable[0]];
      for (let i = 0; i < queue.length; i++) {
        const c = queue[i];
        for (const [dq, dr] of DIRS) {
          const n = at(c.q + dq, c.r + dr), nk = key(c.q + dq, c.r + dr);
          if (!n || n.void || blocked.has(nk) || seen.has(nk)) continue;
          seen.add(nk); queue.push(n);
        }
      }
      return seen.size === passable.length;
    };
    const greenFree = c => c.green && !c.void && !c._defense;
    const bocageScore = cells => {
      let score = 0;
      for (const c of cells) for (const [dq, dr] of DIRS) {
        const n = at(c.q + dq, c.r + dr);
        if (!n || n.void) score += 4;
        else if (!n.green && !n.void) score += 2;
      }
      return score;
    };
    const bocageCandidates = straightCandidates(greenFree, 3, 6, 'bocageLine', bocageScore);
    const bocagePick = bocageCandidates.find(x => x.score > 0 &&
      keepsInfantryConnected(new Set(x.cells.map(c => key(c.q, c.r)))));
    if (bocagePick) {
      const axis = bocagePick.axis, rot = (axis % 3) * 60;
      bocagePick.cells.forEach((c, i) => {
        if (i === 0) c.over.push(`bocage_end_v0_rot${axis * 60}.png`);
        else if (i === bocagePick.cells.length - 1) c.over.push(`bocage_end_v0_rot${(axis + 3) * 60}.png`);
        else c.over.push(`bocage_straight_v${h32(seed, c.q, c.r, 'bv') % 2}_rot${rot}.png`);
        c._defense = 'bocage';
      });
    }
    // --- 建物 / 瓦礫 / ランドマーク（教会1・工場は大マップで2まで）
    let churchDone = false;
    let factoryLeft = COLS * ROWS > 200 ? 2 : 1;
    const dmgOf = w => w < 0.25 ? 0 : (w < 0.6 ? 1 : 2);
    for (let r = 0; r < ROWS; r++) for (let q = 0; q < COLS; q++) {
      const cell = at(q, r);
      if (!cell.open || cell._vehicleLane) continue;
      const roll = rnd(seed, q, r, 'b');
      if (!churchDone && rnd(seed, 'chp') < 0.75 && cell.dist > 0.3 && cell.dist < 0.75 && roll < 0.2) {
        cell.over.push(`church_d${cell.wreck < 0.3 ? 0 : (cell.wreck < 0.65 ? 1 : 2)}_rot${60 * (h32(seed, q, r, 'cr') % 6)}.png`);
        cell.open = false; churchDone = true; continue;
      }
      if (factoryLeft > 0 && rnd(seed, 'fap', factoryLeft) < 0.65 && cell.dist > 0.5 && roll < 0.25) {
        cell.over.push(`factory_d${cell.wreck < 0.3 ? 0 : (cell.wreck < 0.65 ? 1 : 2)}_rot${60 * (h32(seed, q, r, 'fr') % 6)}.png`);
        cell.open = false; factoryLeft--; continue;
      }
      if (roll < 0.62) {
        // Kitbash3D住宅(kbres_a-e): プリレンダー済みの戦禍住宅列。素の状態で
        // 既に損傷しているため、中破以上のセル(wreck>=0.2)へ約半数混ぜる。
        // 損傷段は持たない(直撃で一発瓦礫化 — damageBuilding参照)
        if (this.KBRES_READY && cell.wreck >= 0.2 && rnd(seed, q, r, 'kb') < 0.5) {
          const kb = ['a', 'b', 'c', 'd', 'e'][h32(seed, q, r, 'kbs') % 5];
          cell.over.push(`kbres_${kb}_rot${60 * (h32(seed, q, r, 'rot') % 6)}.png`);
        } else {
          cell.over.push(`bldg_s${1 + h32(seed, q, r, 'bs') % 5}_d${dmgOf(cell.wreck)}_rot${60 * (h32(seed, q, r, 'rot') % 6)}.png`);
        }
        cell.open = false;
      } else if (roll < 0.76) {
        cell.over.push(`rubble_v${h32(seed, q, r, 'rv') % 3}_rot${60 * (h32(seed, q, r, 'rr') % 2)}.png`);
      }
    }

    // --- 田畑デカール: cube座標4x4 parcelごとに向きと作物段階を固定する。
    //     全面grassのみを対象にし、grn遷移・防御線へは置かない。
    const cubeCoord = (q, r, axis) => [q, r, -q - r][axis];
    const fieldAxis = h32(seed, 'fieldAxis') % 3;
    const fieldPhaseU = h32(seed, 'fieldPhaseU') % 4;
    const fieldPhaseV = h32(seed, 'fieldPhaseV') % 4;
    const fieldParcelOf = cell => {
      const u = cubeCoord(cell.q, cell.r, fieldAxis);
      const v = cubeCoord(cell.q, cell.r, (fieldAxis + 1) % 3);
      return `${fieldAxis}:${Math.floor((u + fieldPhaseU) / 4)},${Math.floor((v + fieldPhaseV) / 4)}`;
    };
    const fieldParcels = new Map();
    for (const cell of grid.values()) {
      if (!cell.void && cell.green && cell.ground === 'grass' && !cell._defense) {
        const pid = fieldParcelOf(cell);
        if (!fieldParcels.has(pid)) fieldParcels.set(pid, []);
        fieldParcels.get(pid).push(cell);
      }
    }
    for (const [pid, parcelCells] of fieldParcels) {
      if (parcelCells.length < 5 || h32(seed, pid, 'fieldUse') % 100 >= 60) continue;
      const variant = h32(seed, pid, 'fieldVariant') % 4;
      const rot = (h32(seed, pid, 'fieldRot') % 3) * 60;
      const remaining = new Map(parcelCells.map(c => [key(c.q, c.r), c]));
      while (remaining.size) {
        const first = remaining.values().next().value;
        const component = [], queue = [first];
        remaining.delete(key(first.q, first.r));
        for (let i = 0; i < queue.length; i++) {
          const c = queue[i]; component.push(c);
          for (const [dq, dr] of DIRS) {
            const nk = key(c.q + dq, c.r + dr), n = remaining.get(nk);
            if (!n) continue;
            remaining.delete(nk); queue.push(n);
          }
        }
        if (component.length < 5) continue;
        const coverage = 85 + h32(seed, pid, component[0].q, component[0].r, 'fieldCoverage') % 16;
        const target = Math.max(5, Math.min(component.length,
          Math.ceil(component.length * coverage / 100)));
        const componentKeys = new Set(component.map(c => key(c.q, c.r)));
        component.sort((a, b) => {
          const degree = c => DIRS.filter(([dq, dr]) => componentKeys.has(key(c.q + dq, c.r + dr))).length;
          return degree(b) - degree(a) || h32(seed, pid, a.q, a.r, 'fieldStart') -
            h32(seed, pid, b.q, b.r, 'fieldStart');
        });
        const selected = [], seen = new Set(), grow = [component[0]];
        seen.add(key(component[0].q, component[0].r));
        for (let i = 0; i < grow.length && selected.length < target; i++) {
          const c = grow[i]; selected.push(c);
          const neighbors = DIRS.map(([dq, dr]) => at(c.q + dq, c.r + dr))
            .filter(n => n && componentKeys.has(key(n.q, n.r)) && !seen.has(key(n.q, n.r)))
            .sort((a, b) => h32(seed, pid, a.q, a.r, 'fieldGrow') -
              h32(seed, pid, b.q, b.r, 'fieldGrow'));
          for (const n of neighbors) { seen.add(key(n.q, n.r)); grow.push(n); }
        }
        for (const c of selected) {
          c.decals.push({ file: `fieldrows_v${variant}_rot${rot}.png`, layer: 'flat', tall: false,
            scale: 1, alpha: 0.93 });
          c._fieldParcel = pid; c._fieldVariant = variant; c._fieldRot = rot;
        }
      }
    }

    // --- 車両轍: road_straightの最大runだけに、焼き込み回転の2-5セル区間を置く。
    const straightInfo = cell => {
      const m = cell && typeof cell.gfile === 'string' &&
        cell.gfile.match(/^road_straight_v\d+_rot(0|60|120)\.png$/);
      return m ? { rot: Number(m[1]), axis: Number(m[1]) / 60 } : null;
    };
    const consumedStraight = new Set();
    for (const cell of grid.values()) {
      const info = straightInfo(cell), ck = key(cell.q, cell.r);
      if (!info || consumedStraight.has(ck)) continue;
      const back = DIRS[(info.axis + 3) % 6];
      const prev = at(cell.q + back[0], cell.r + back[1]);
      const prevInfo = straightInfo(prev);
      if (prevInfo && prevInfo.axis === info.axis) continue;
      const run = [];
      const step = DIRS[info.axis];
      let cur = cell;
      while (cur) {
        const ci = straightInfo(cur);
        if (!ci || ci.axis !== info.axis) break;
        run.push(cur); consumedStraight.add(key(cur.q, cur.r));
        cur = at(cur.q + step[0], cur.r + step[1]);
      }
      if (run.length < 3) continue;
      const runId = `${info.axis}:${run[0].q},${run[0].r}`;
      const coverage = 40 + h32(seed, runId, 'trackCoverage') % 16;
      const rawTarget = run.length * coverage / 100;
      let target;
      if (rawTarget < 2) {
        target = h32(seed, runId, 'trackShort') % 10000 < rawTarget / 2 * 10000 ? 2 : 0;
      } else {
        target = Math.max(2, Math.min(run.length, Math.round(rawTarget)));
      }
      if (!target) continue;
      const parts = [];
      let left = target;
      while (left > 5) { const n = Math.min(5, left - 2); parts.push(n); left -= n; }
      parts.push(left);
      const required = target + parts.length - 1;
      const start = h32(seed, runId, 'trackStart') % Math.max(1, run.length - required + 1);
      const variant = h32(seed, runId, 'trackVariant') % 4;
      let cursor = start;
      parts.forEach((length, segment) => {
        for (let i = 0; i < length; i++) {
          const c = run[cursor + i];
          c.decals.push({ file: `track_v${variant}_rot${info.rot}.png`, layer: 'flat', tall: false,
            scale: 1, alpha: 0.92 });
          c._trackRun = runId; c._trackSegment = segment;
          c._trackVariant = variant; c._trackRot = info.rot;
        }
        cursor += length + 1;
      });
    }

    // --- 小物 / 植生: 3x3 macroで林をまとめ、道路1-ringの背高樹木を避ける。
    const groveAxis = h32(seed, 'groveAxis') % 3;
    const grovePhaseU = h32(seed, 'grovePhaseU') % 3;
    const grovePhaseV = h32(seed, 'grovePhaseV') % 3;
    const groveOf = cell => {
      const u = cubeCoord(cell.q, cell.r, groveAxis);
      const v = cubeCoord(cell.q, cell.r, (groveAxis + 1) % 3);
      return `${groveAxis}:${Math.floor((u + grovePhaseU) / 3)},${Math.floor((v + grovePhaseV) / 3)}`;
    };
    const nearRoad = cell => cell.ground === 'road' || DIRS.some(([dq, dr]) => {
      const n = at(cell.q + dq, cell.r + dr);
      return n && n.ground === 'road';
    });
    for (let r = 0; r < ROWS; r++) for (let q = 0; q < COLS; q++) {
      const cell = at(q, r);
      if (cell._defense) continue;
      if (cell.ground === 'road') {
        if (rnd(seed, q, r, 'hh') < 0.08)
          cell.over.push(`prop_hedgehog_v${h32(seed, q, r, 'hv') % 2}_rot${(h32(seed, q, r, 'hr') % 3) * 60}.png`);
        continue;
      }
      if (!cell.open && !cell.scar && !cell.green) continue;
      const p = rnd(seed, q, r, 'px');
      if (cell.green) {
        const roadHalo = nearRoad(cell);
        if (cell._fieldParcel) {
          if (!roadHalo && p < 0.03)
            cell.over.push(`tree_v${5 + h32(seed, q, r, 'fieldTree') % 5}_rot0.png`);
          else if (p < 0.12)
            cell.over.push(`veg_v${3 + h32(seed, q, r, 'fieldVeg') % 3}_rot0.png`);
        } else {
          const gid = groveOf(cell);
          const grove = h32(seed, gid, 'groveUse') % 100 < 38;
          const treeP = grove ? 0.45 : 0.10;
          const vegP = grove ? 0.34 : 0.22;
          cell._groveParcel = gid; cell._grove = grove; cell._nearRoad = roadHalo;
          if (!roadHalo && p < treeP)
            cell.over.push(`tree_v${5 + h32(seed, q, r, 'greenTree') % 5}_rot0.png`);
          else if (p < treeP + vegP)
            cell.over.push(`veg_v${3 + h32(seed, q, r, 'greenVeg') % 3}_rot0.png`);
        }
        continue;
      }
      if (cell.scar) {
        if (p < 0.14)
          cell.over.push(`tree_v${h32(seed, q, r, 'scarTree') % 5}_rot0.png`);
        continue;
      }
      if (p < 0.05) {
        const k = (h32(seed, q, r, 'pk') % 2) ? 'sandbag' : 'barrels';
        cell.over.push(`prop_${k}_v${h32(seed, q, r, 'pv') % 2}_rot0.png`);
      } else if (cell.dist > 0.6 && p < 0.25) {
        if (rnd(seed, q, r, 'tv2') < 0.5)
          cell.over.push(`tree_v${[0, 1, 2, 0, 3, 4][h32(seed, q, r, 'tvv') % 6]}_rot0.png`);
        else cell.over.push(`veg_v${h32(seed, q, r, 'vv') % 3}_rot0.png`);
      } else if (p > 0.93) {
        cell.over.push(`veg_v${h32(seed, q, r, 'vv2') % 3}_rot0.png`);
      }
    }
    this.lastDiagnostics = diagnostics;
    return grid;
  },

  /** 地面PNGファイル名（gfile未指定セル用）。renderer が使う */
  groundFile(cell, seed) {
    return cell.gfile
      ? cell.gfile
      : `gnd_${cell.ground}_v${this.h32(seed, cell.q, cell.r, 'gv') % this.NG[cell.ground]}.png`;
  },

  BLDG_RE: /^(bldg_s\d+|church|factory)_d(\d+)_rot(\d+)\.png$/,

  /** セル内容 → TERRAIN互換オブジェクト（通行コスト・カバー・都市メタ付与） */
  terrainForCell(cell) {
    // オーガニック市街地シルエットの外側(コア+グリーンフリンジの外)は完全VOID。
    // city プロパティを付けない = TerrainRenderV7 側の「!cell継続」ガードで
    // 自動的に描画・テクスチャロード対象外になる(id:-1/cost99は既存の
    // 不可侵判定・checkDeploy/getSafeSpawnPosの拒否ロジックがそのまま効く)
    if (cell.void) return { ...TERRAIN.VOID };

    const overNames = cell.over.join(' ');
    const flatNames = cell.flat.join(' ');
    const mk = (base, over_) => ({ ...base, ...over_, city: cell });

    // 大型建造物(教会/工場): 歩兵は進入可(瓦礫を踏み越える分コスト高)。
    // 戦車は市街戦車両として非現実的なので不可侵のまま(tankBlocked)
    if (/(^|\s)(church_|factory_)/.test(overNames)) {
      return mk(TERRAIN.TOWN, { cost: 4, cover: 70, building: true, tankBlocked: true });
    }
    // 一般建物(手続き生成bldg_* / Kitbash住宅kbres_*): 歩兵は進入し壁際に
    // 隠れられる。戦車は不可侵
    if (/(^|\s)(bldg_|kbres_)/.test(overNames)) {
      return mk(TERRAIN.TOWN, { cost: 3, cover: 65, building: true, tankBlocked: true });
    }
    // ボカージュ（生垣土塁）: 不可侵
    if (/bocage_/.test(overNames)) {
      return mk(TERRAIN.TOWN, { name: 'ボカージュ', cost: 99 });
    }
    // 塹壕・タコツボ: 通行可・最高カバー
    if (/(trench_|foxhole_)/.test(flatNames)) {
      return mk(TERRAIN.TOWN, { name: '塹壕', cost: 1, cover: 55 });
    }
    // 鉄条網: 通行可だが遅い
    if (/wire_/.test(overNames)) {
      return mk(TERRAIN.DIRT, { name: '鉄条網', cost: 3, cover: 5 });
    }
    // 瓦礫: 遮蔽豊富
    if (/rubble_/.test(overNames)) {
      return mk(TERRAIN.TOWN, { cost: 2, cover: 40 });
    }
    // 野原（外周グリーンゾーン。遷移タイル含む）
    if (cell.green) {
      return mk(TERRAIN.GRASS, {});
    }
    // 荒地スカー / クレーター
    if (cell.ground === 'scar' || cell.ground === 'pair') {
      return mk(TERRAIN.DIRT, { name: '砲痕', cost: 2, cover: 15 });
    }
    // 道路・街路
    if (cell.ground === 'road' || cell.ground === 'street') {
      return mk(TERRAIN.ROAD, {});
    }
    // 石畳の空き地
    return mk(TERRAIN.DIRT, { name: '石畳', cover: 5 });
  },

  /** URLの?seed=整数をmapdebug/スクリーンショット回帰用に読む。 */
  debugSeedFromLocation() {
    if (typeof location === 'undefined' || !location.search || typeof URLSearchParams === 'undefined') return null;
    const raw = new URLSearchParams(location.search).get('seed');
    if (raw == null || !/^-?\d+$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isSafeInteger(n) ? n : null;
  },

  /**
   * 本編エントリポイント。game.map を都市マップで埋める。
   * 戻り値: 使用シード
   */
  generate(game) {
    const debugSeed = this.debugSeedFromLocation();
    const seed = this.fixedSeed != null ? this.fixedSeed
      : (debugSeed != null ? debugSeed : Math.floor(Math.random() * 99999));
    this.lastSeed = seed;
    const grid = this.genCity(seed, MAP_W, MAP_H);
    game.map = [];
    for (let q = 0; q < MAP_W; q++) {
      game.map[q] = [];
      for (let r = 0; r < MAP_H; r++) {
        game.map[q][r] = this.terrainForCell(grid.get(q + ',' + r));
      }
    }
    this.active = true;
    return seed;
  },

  /** road_*_d1/_d2 + gnd_crater_v2/v3 レンダー納品済み(2026-07-13)につき解禁 */
  GROUND_DMG_READY: true,
  ROAD_RE: /^road_(straight|corner|tee|cross)_v(\d+)(?:_d(\d+))?_rot(\d+)\.png$/,

  /**
   * 直撃ヘックスの地面を損傷させる（建物がない開けたヘックス用）。
   * - 道路: d0→d1→d2 と進行（GROUND_DMG_READY時のみ / d2カンスト）
   * - 石畳: 既存アセット gnd_crater_v0/1 へ置換（1段のみ）
   * 変更があれば {q, r, file} を返す。移動コストも荒地化する。
   */
  damageGround(game, q, r) {
    const t = game.map[q][r];
    if (!t || !t.city || t.building) return null;
    const cell = t.city;
    if (cell.ground === 'road' && this.GROUND_DMG_READY) {
      const m = (cell.gfile || '').match(this.ROAD_RE);
      if (!m) return null;
      const d = m[3] ? parseInt(m[3], 10) : 0;
      if (d >= 2) return null;
      // バリアントは損傷ごとに抽選し直す: 道路縁は「縁で静まる」原則で全バリアント
      // 接続互換なので、同じタイルでも着弾ごとに別のクレーター配置になり
      // 「同じ絵の繰り返し」を避けられる
      const nvar = { straight: 4, corner: 3, tee: 2, cross: 2 }[m[1]];
      const v = this.h32(this.lastSeed, q, r, 'rdv', d) % nvar;
      cell.gfile = `road_${m[1]}_v${v}_d${d + 1}_rot${m[4]}.png`;
      if (d + 1 >= 2) { t.cost = Math.max(t.cost, 2); t.cover = Math.max(t.cover, 15); }
      return { q, r, file: cell.gfile };
    }
    if (cell.ground === 'cobble') {
      cell.ground = 'crater';
      // v2/v3(オフセット広め)は roads_dmg バッチと同時に納品されるので同フラグで解禁
      const nCrater = this.GROUND_DMG_READY ? 4 : 2;
      cell.gfile = `gnd_crater_v${this.h32(this.lastSeed, q, r, 'cd') % nCrater}.png`;
      t.cost = Math.max(t.cost, 2);
      t.cover = Math.max(t.cover, 15);
      t.name = '砲痕';
      return { q, r, file: cell.gfile };
    }
    return null;
  },

  KBRES_RE: /^kbres_[a-e]_rot(\d+)\.png$/,

  /**
   * 建物を1段階損傷させる（d0→d1→d2、d2でカンスト）。
   * 変更があれば {q, r, file} を返し、なければ null。
   * 描画側(TerrainRenderV7.damageBuilding)が setTexture で追随する。
   * Kitbash住宅(kbres_*)は損傷段を持たないため、直撃で一発瓦礫化 —
   * 地形も建物→瓦礫(通行可・cover40)へ更新する。
   */
  damageBuilding(game, q, r) {
    const t = game.map[q][r];
    if (!t || !t.building || !t.city) return null;
    for (let i = 0; i < t.city.over.length; i++) {
      if (this.KBRES_RE.test(t.city.over[i])) {
        const next = `rubble_v${this.h32(this.lastSeed, q, r, 'kbrub') % 3}_rot${60 * (this.h32(this.lastSeed, q, r, 'kbrr') % 2)}.png`;
        t.city.over[i] = next;
        t.building = false;
        t.tankBlocked = false;
        t.cost = 2;
        t.cover = 40;
        t.name = TERRAIN.TOWN.name;
        return { q, r, file: next };
      }
      const m = t.city.over[i].match(this.BLDG_RE);
      if (!m) continue;
      const d = parseInt(m[2], 10);
      if (d >= 2) return null;
      const next = `${m[1]}_d${d + 1}_rot${m[3]}.png`;
      t.city.over[i] = next;
      return { q, r, file: next };
    }
    return null;
  }
};

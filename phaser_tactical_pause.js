'use strict';

/**
 * Tactical pause presentation shared by the product and sim battle scenes.
 * It never advances simulation state; it only reads snapshots and renders a
 * decision diagram above a desaturated battlefield.
 */
(function (global) {
  const DEPTH = 90000;
  const FRIEND = 0x72d7ff;
  const ENEMY = 0xff756d;
  const MOVE = 0x7fe7ff;
  const AIM = 0xffc35a;
  const SUPPRESS = 0xff8a38;
  const CLASH = 0xfff1a8;      // 撃ち合いの衝突点
  const LOCK = 0xff5a4a;       // 命令確定のターゲットカーソル
  const LEAD = 0xa8ffd8;       // 指揮リンク
  const FLASH_FRAMES = 48;     // ターゲットカーソルの表示フレーム数（約0.8秒）
  const COMPACT_DETAIL_AT = 24;

  /**
   * 実際に指揮を執れる分隊長か。
   *
   * isLeader だけを見ると、赤ゲージ(incap)で倒れた分隊長にも指揮官の二重丸と
   * 指揮リンクが出続ける（2026-08-04 ディレクター報告）。sim_core 側も incap を
   * 「抜けた」扱いにして後任を立てるので、表示の条件もそれに合わせる。
   */
  function isActingLeader(s) {
    return !!(s && s.isLeader && s.hp > 0 && s.state !== 'incap');
  }

  function targetIdOf(s) {
    const order = s && s.currentOrder;
    if (order && order.type === 'TARGET' && order.payload) return order.payload.targetId || null;
    return (s && s.engageTargetId) || null;
  }

  function moveGoalOf(s) {
    const path = s && s.movePath;
    if (path && path.length) return path[path.length - 1];
    const orderPath = s && s.currentOrder && s.currentOrder.type === 'MOVE_TO'
      && s.currentOrder.payload && s.currentOrder.payload.path;
    return orderPath && orderPath.length ? orderPath[orderPath.length - 1] : null;
  }

  // 直近の撃ち方。射撃の意図（照準/制圧）とは別軸で、1トリガーの弾数を表す。
  // 掃射(auto)は弾倉を一気に燃やすので、プレイヤーが気付ける所に出しておく。
  const PULL_LABEL = { single: '単射', burst: 'バースト', auto: '掃射' };
  function pullSuffix(s) {
    const label = s && PULL_LABEL[s.pullMode];
    return label ? '・' + label : '';
  }

  function describeSoldier(s, nameOf) {
    if (!s || s.hp <= 0) return { action: '戦闘不能', targetId: null, moveGoal: null };
    const targetId = targetIdOf(s);
    const moveGoal = moveGoalOf(s);
    let action;
    if (s.state === 'assault') action = '強襲中';
    else if (s.state === 'throw') action = '投擲';
    else if (s.state === 'reload') action = '再装填中';
    else if (s.state === 'pinned') action = '釘付け';
    else if (s.state === 'suppressed') action = '制圧下';
    else if (s.state === 'move' || moveGoal) action = '移動中';
    else if (s.engageHex) action = '制圧射撃' + pullSuffix(s);
    else if (targetId) action = (s.fireMode === 'suppress' ? '制圧射撃' : '照準・射撃') + pullSuffix(s);
    else if (s.fireMode === 'hold') action = '射撃待機';
    else action = '状況判断';
    const targetName = targetId && nameOf ? nameOf(targetId) : targetId;
    return { action, targetId, targetName, moveGoal };
  }

  class TacticalPauseOverlay {
    constructor(scene, options) {
      this.scene = scene;
      this.options = options || {};
      this.active = false;
      this.labels = new Map();

      this.shade = scene.add.rectangle(0, 0, 1, 1, 0x555c5b, 0.58)
        .setOrigin(0, 0).setScrollFactor(1).setDepth(DEPTH).setVisible(false);
      // 戦雲（勢力図）は最下層。線・ラベルはその上に重なる
      this.cloud = scene.add.graphics().setDepth(DEPTH + 2).setVisible(false);
      this.lines = scene.add.graphics().setDepth(DEPTH + 10).setVisible(false);
      this.frame = 0;                 // marching ants の位相
      this.flashes = new Map();       // id -> 残りフレーム（命令確定のターゲット表示）
      this._cloudAt = -1;             // 戦雲の再計算tick
      // 命令発行側（logic_battle_rtwp）から呼べるように現行インスタンスを晒す。
      // シーン参照を辿らせるとレイヤー間の結合が増えるので、口を1つだけ開ける。
      TacticalPauseOverlay.current = this;
      this.banner = scene.add.text(0, 12, 'PAUSE', {
        fontFamily: 'Share Tech Mono, monospace', fontSize: '17px',
        color: '#f2ead0', backgroundColor: 'rgba(15,20,19,0.90)',
        padding: { x: 14, y: 7 },
      }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(DEPTH + 30).setVisible(false);
      // 操作説明は既定で出さない。「何を押せば何ができるか」はチュートリアルの
      // 仕事で、常設HUDに貼っておくものではない（ゲーム完成後に別途作る）。
      // 復活させたい時は options.showHelp か TacticalPauseOverlay.showHelp = true。
      this.helpEnabled = this.options.showHelp != null
        ? !!this.options.showHelp : !!TacticalPauseOverlay.showHelp;
      this.help = scene.add.text(0, 0,
        '味方を左クリック → 移動 / 制圧 / 強襲\n右クリック: 取り消し\n分隊: F 集中射撃  A 面制圧  C 遮蔽', {
          fontFamily: 'Share Tech Mono, monospace', fontSize: '12px',
          color: '#d8e9e5', backgroundColor: 'rgba(10,15,14,0.88)',
          padding: { x: 10, y: 7 }, lineSpacing: 3,
        }).setOrigin(1, 0).setScrollFactor(0).setDepth(DEPTH + 30).setVisible(false);
      this.detail = scene.add.text(12, 0, '', {
        fontFamily: 'Share Tech Mono, monospace', fontSize: '12px',
        color: '#ffffff', backgroundColor: 'rgba(10,15,14,0.90)',
        padding: { x: 10, y: 8 }, lineSpacing: 3,
      }).setOrigin(0, 1).setScrollFactor(0).setDepth(DEPTH + 30).setVisible(false);
      this.domUi = null;
      if (typeof document !== 'undefined' && scene.game && scene.game.canvas) {
        const host = scene.game.canvas.parentElement;
        if (host) {
          const root = document.createElement('div');
          root.setAttribute('data-tactical-pause-ui', '1');
          root.style.cssText = 'display:none;position:absolute;inset:0;z-index:25;pointer-events:none;font-family:"Share Tech Mono",monospace;color:#eef6f3';
          const banner = document.createElement('div');
          banner.textContent = 'PAUSE';
          banner.style.cssText = 'position:absolute;left:50%;top:48px;transform:translateX(-50%);padding:7px 15px;background:rgba(15,20,19,.92);border:1px solid rgba(220,232,223,.65);font-size:16px;font-weight:bold;letter-spacing:1px;white-space:nowrap';
          const help = document.createElement('div');
          help.textContent = '味方を左クリック → 移動 / 制圧 / 強襲\n右クリック: 取り消し\n分隊: F 集中射撃  A 面制圧  C 遮蔽';
          help.style.cssText = 'position:absolute;right:12px;top:92px;white-space:pre-line;padding:7px 10px;background:rgba(10,15,14,.88);border-left:2px solid #7fd9e8;font-size:11px;line-height:1.5;text-align:right';
          if (!this.helpEnabled) help.style.display = 'none';
          const detail = document.createElement('div');
          // 中身が入るまで出さない。空の黒箱が画面隅に残るのを防ぐ。
          detail.style.cssText = 'display:none;position:absolute;left:12px;bottom:64px;white-space:pre-line;padding:8px 10px;background:rgba(10,15,14,.92);border-left:2px solid #7fd9e8;font-size:12px;line-height:1.45';
          root.appendChild(banner); root.appendChild(help); root.appendChild(detail);
          host.appendChild(root);
          this.domUi = { root, banner, help, detail };
        }
      }
    }

    setActive(value) {
      value = !!value;
      if (this.active === value) return;
      this.active = value;
      this.shade.setVisible(value);
      this.cloud.setVisible(value);
      this.lines.setVisible(value);
      this.banner.setVisible(value && !this.domUi);
      this.help.setVisible(value && !this.domUi && this.helpEnabled);
      this.detail.setVisible(value && !this.domUi);
      if (this.domUi) this.domUi.root.style.display = value ? 'block' : 'none';
      if (value) {
        if (this.scene.anims && this.scene.anims.pauseAll) this.scene.anims.pauseAll();
        if (this.scene.tweens && this.scene.tweens.pauseAll) this.scene.tweens.pauseAll();
      } else {
        if (this.scene.anims && this.scene.anims.resumeAll) this.scene.anims.resumeAll();
        if (this.scene.tweens && this.scene.tweens.resumeAll) this.scene.tweens.resumeAll();
      }
      if (!value) {
        this.lines.clear();
        this.cloud.clear();
        this._cloudAt = -1;
        this.labels.forEach((label) => label.setVisible(false));
      }
    }

    /** 詳細パネル。空文字なら枠ごと消す（空の黒箱を残さない）。 */
    _setDetail(text) {
      this.detail.setText(text);
      this.detail.setVisible(this.active && !this.domUi && !!text);
      if (this.domUi) this.domUi.detail.textContent = text;
      if (this.domUi) this.domUi.detail.style.display = text ? '' : 'none';
    }

    _name(id) {
      if (this.options.getDisplayName) return this.options.getDisplayName(id) || String(id);
      return String(id);
    }

    _position(id, soldier) {
      if (this.options.getPosition) {
        const p = this.options.getPosition(id, soldier);
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return p;
      }
      if (global.Renderer && global.Renderer.hexToPx && soldier) {
        return global.Renderer.hexToPx(soldier.q, soldier.r);
      }
      return null;
    }

    _label(id, team) {
      let label = this.labels.get(id);
      if (!label) {
        label = this.scene.add.text(0, 0, '', {
          fontFamily: 'Share Tech Mono, monospace', fontSize: '11px',
          color: team === 'A' ? '#d9f6ff' : '#ffe0dc',
          backgroundColor: team === 'A' ? 'rgba(10,43,54,0.92)' : 'rgba(58,18,16,0.92)',
          padding: { x: 5, y: 3 }, lineSpacing: 1,
        }).setOrigin(team === 'A' ? 1 : 0, 1).setDepth(DEPTH + 20);
        this.labels.set(id, label);
      }
      return label;
    }

    /**
     * marching ants の射線。破線が射手から標的へ**流れる**ので、静止画でも
     * どちらがどちらを撃っているかが一目で分かる（2026-08-02 ディレクター指示）。
     *
     * @param {number} stopAt 0..1。1未満なら途中で止める（撃ち合いの衝突表現用）
     */
    _line(from, to, color, width, alpha, stopAt) {
      const cam = this.scene.cameras.main;
      const zoom = Math.max(0.05, cam.zoom || 1);
      const dx = to.x - from.x, dy = to.y - from.y;
      const d = Math.hypot(dx, dy);
      if (d < 2) return;
      const nx = dx / d, ny = dy / d;
      const headGap = 9 / zoom;
      const full = Math.max(0, d - headGap);
      const reach = full * (stopAt == null ? 1 : Math.max(0, Math.min(1, stopAt)));
      const a = alpha == null ? 0.9 : alpha;

      // 破線。位相を毎フレームずらすと蟻の行進になる。
      // 破線は s = -phase + k*period に置くので、phase を**減らす**方向に動かさない
      // と蟻が標的→射手へ逆走する（2026-08-05 ディレクター指摘）。period から引いて
      // 位相を反転させることで、射手→標的の流れになる。
      const dash = 9 / zoom;
      const gap = 6 / zoom;
      const period = dash + gap;
      const phase = period - ((this.frame * (1.6 / zoom)) % period);
      this.lines.lineStyle((width || 2) / zoom, color, a);
      for (let s = -phase; s < reach; s += period) {
        const s0 = Math.max(0, s);
        const s1 = Math.min(reach, s + dash);
        if (s1 <= s0) continue;
        this.lines.beginPath();
        this.lines.moveTo(from.x + nx * s0, from.y + ny * s0);
        this.lines.lineTo(from.x + nx * s1, from.y + ny * s1);
        this.lines.strokePath();
      }

      // 標的まで届く線にだけ矢尻を置く。途中で止まる線は衝突側が印を描く
      if (stopAt == null || stopAt >= 1) {
        const end = { x: from.x + nx * full, y: from.y + ny * full };
        const size = 8 / zoom;
        this.lines.fillStyle(color, a);
        this.lines.fillTriangle(
          to.x, to.y,
          end.x - ny * size * 0.55, end.y + nx * size * 0.55,
          end.x + ny * size * 0.55, end.y - nx * size * 0.55
        );
      }
    }

    /** 撃ち合いの衝突点。両者の線がぶつかる中間にスパークを描く */
    _clash(from, to) {
      const cam = this.scene.cameras.main;
      const zoom = Math.max(0.05, cam.zoom || 1);
      const cx = (from.x + to.x) / 2, cy = (from.y + to.y) / 2;
      const r = (7 + Math.sin(this.frame * 0.25) * 2) / zoom;
      this.lines.lineStyle(2 / zoom, CLASH, 0.95);
      for (let i = 0; i < 4; i++) {
        const ang = (Math.PI / 4) * i + this.frame * 0.06;
        this.lines.beginPath();
        this.lines.moveTo(cx + Math.cos(ang) * r * 0.35, cy + Math.sin(ang) * r * 0.35);
        this.lines.lineTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
        this.lines.strokePath();
      }
    }

    /**
     * 命令が通ったことを見せるターゲットカーソル。数回点滅して消える。
     * 「ユニットをクリックしても選択できた感じがしない」への答え。
     */
    _reticle(pos, phase) {
      const cam = this.scene.cameras.main;
      const zoom = Math.max(0.05, cam.zoom || 1);
      // 点滅（速い明滅）＋ 収束（外から締まる）
      if (Math.floor(phase * 6) % 2 === 1) return;
      const r = (26 - 14 * (1 - phase)) / zoom;
      const arm = r * 0.45;
      this.lines.lineStyle(2.4 / zoom, LOCK, 0.95);
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => {
        const cx = pos.x + sx * r, cy = pos.y - 8 / zoom + sy * r;
        this.lines.beginPath();
        this.lines.moveTo(cx, cy); this.lines.lineTo(cx - sx * arm, cy);
        this.lines.moveTo(cx, cy); this.lines.lineTo(cx, cy - sy * arm);
        this.lines.strokePath();
      });
    }

    /** 命令確定のターゲット表示を出す（RTwP が命令発行時に呼ぶ） */
    flashTarget(id) {
      if (id == null) return;
      this.flashes.set(String(id), FLASH_FRAMES);
    }

    /**
     * その采配がまだ生きた敵を指しているか。
     *
     * `byId` は hp>0 の兵だけを含む。行動不能は「もう戦列に居ない」ので敵として
     * 数えない — 遺体の上にリングを残さないための判定はここが本体。
     * 名指しの的(`targetId`)が生きているならそれだけで有効とする（的が動いた
     * 直後、hex の更新が1フレーム遅れてもリングが瞬かないように）。
     */
    _planHasLiveFoe(plan, byId) {
      if (!plan || !plan.hex || !byId) return false;
      const T = (typeof SIM_TUNING !== 'undefined') ? SIM_TUNING : {};
      const radius = T.PLAN_STALE_RADIUS != null ? T.PLAN_STALE_RADIUS : 1;
      const isFoe = (s) => s && s.team !== 'A' && s.state !== 'incap';
      if (plan.targetId != null) {
        const tg = byId.get(String(plan.targetId));
        if (isFoe(tg)) return true;
      }
      let found = false;
      byId.forEach((s) => {
        if (found || !isFoe(s)) return;
        const d = Math.max(Math.abs(s.q - plan.hex.q), Math.abs(s.r - plan.hex.r),
          Math.abs((s.q + s.r) - (plan.hex.q + plan.hex.r)));
        if (d <= radius) found = true;
      });
      return found;
    }

    /**
     * 指揮官の采配（`LeaderPolicy` が state.plan へ残した計画）を描く。
     *
     *   制圧目標 = 脈打つ二重リング（そこを黙らせようとしている）
     *   制圧班   = その hex への細い実線（火力の束）
     *   突入班   = 目標へ向かう太い矢（機動の束）
     *
     * 「撃つ人」と「動く人」が分かれて見えることが、火力と機動の二本立てを
     * 理解させる唯一の手掛かりになる。
     */
    _drawPlan(plan, byId) {
      if (!plan || !plan.hex || !this.lines) return;

      // **敵の居なくなった采配は描かない。**
      //
      // state.plan は分隊長が次の采配を出した時にしか書き換わらないので、狙って
      // いた敵が倒れても計画は残る。LeaderPolicy 側でも毎サイクル検算している
      // が、それは数秒に1回・生きた分隊長が居る時だけなので「倒した瞬間に消える」
      // を保証できない。ここで毎フレーム検算するのが唯一の保証になる
      // （2026-08-05 ディレクター報告4回目「遺体の上／誰も居ない所に円が残る。
      //  ターゲット誤認のもと。即消えるようにしてほしい」）。
      if (!this._planHasLiveFoe(plan, byId)) return;

      const R = global.Renderer;
      if (!R || !R.hexToPx) return;
      const cam = this.scene.cameras.main;
      const zoom = Math.max(0.05, cam.zoom || 1);
      const at = R.hexToPx(plan.hex.q, plan.hex.r);
      if (!at) return;

      const pulse = 1 + Math.sin(this.frame * 0.12) * 0.14;
      const assaulting = plan.phase === 'assault';
      const tone = assaulting ? LOCK : SUPPRESS;
      this.lines.lineStyle(2.4 / zoom, tone, 0.9);
      this.lines.strokeCircle(at.x, at.y - 8 / zoom, (22 * pulse) / zoom);
      this.lines.lineStyle(1.2 / zoom, tone, 0.5);
      this.lines.strokeCircle(at.x, at.y - 8 / zoom, (31 * pulse) / zoom);

      (plan.baseIds || []).forEach((id) => {
        const s = byId.get(String(id));
        const p = s && this._position(String(id), s);
        if (!p) return;
        this.lines.lineStyle(1.2 / zoom, SUPPRESS, 0.42);
        this.lines.beginPath();
        this.lines.moveTo(p.x, p.y - 8 / zoom);
        this.lines.lineTo(at.x, at.y - 8 / zoom);
        this.lines.strokePath();
      });

      (plan.assaultIds || []).forEach((id) => {
        const s = byId.get(String(id));
        const p = s && this._position(String(id), s);
        if (!p) return;
        this._line(p, { x: at.x, y: at.y - 8 / zoom }, LOCK, 3.4, 0.95, 1);
      });
    }

    /**
     * 1人の兵が周囲へ及ぼす「勢力」の強さ。
     *
     * 頭数だけでは勢力図にならない（2026-08-02 ディレクター指示「敵の密集状態だけで
     * なく情報連携（統率）状態、残弾数など総合的に加味して」）。
     *   ①弾が無い兵は火力ではない
     *   ②制圧されている兵は面を維持できない
     *   ③指揮から切れた兵は組織的な圧力にならない
     * 3つを掛けるので、弾切れ・釘付け・孤立のどれか1つでも勢力は急速に痩せる。
     */
    _weightOf(s, leader) {
      const T = (typeof SIM_TUNING !== 'undefined') ? SIM_TUNING : {};
      if (!s || s.hp <= 0 || s.state === 'incap' || s.state === 'rout') return 0;

      const cap = (s.weapon && s.weapon.magCap) || 1;
      const rounds = (s.magRemaining || 0) + (s.magsLeft || 0) * cap;
      const ammo = Math.max(0.15, Math.min(1, rounds / (cap * 4)));

      const pinnedAt = T.PINNED_AT || 80;
      const steady = Math.max(0.2, 1 - (s.suppression || 0) / pinnedAt);

      let command = 0.55;   // 指揮から切れている兵の既定
      if (isActingLeader(s)) command = 1.2;
      else if (leader) {
        const d = Math.max(Math.abs(s.q - leader.q), Math.abs(s.r - leader.r),
          Math.abs((s.q + s.r) - (leader.q + leader.r)));
        const voice = T.COMMS_VOICE_RNG || 2;
        command = d <= voice ? 1.0 : Math.max(0.55, 1.0 - (d - voice) * 0.08);
      }
      return ammo * steady * command;
    }

    /**
     * 戦雲。両軍の勢力を hex 単位で積み、優勢な側の色で薄く塗る。
     * どこが「取れている」のかを、頭数ではなく**維持できる火力**で描く。
     */
    _drawCloud(soldiers, byTeamLeader) {
      const R = global.Renderer;
      if (!R || !R.hexToPx) return;
      const cam = this.scene.cameras.main;
      const zoom = Math.max(0.05, cam.zoom || 1);
      const radius = 3;
      const field = new Map();   // "q,r" -> {A, B, q, r}

      soldiers.forEach((s) => {
        const w = this._weightOf(s, byTeamLeader[s.team]);
        if (w <= 0) return;
        for (let dq = -radius; dq <= radius; dq++) {
          for (let dr = -radius; dr <= radius; dr++) {
            const dist = Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
            if (dist > radius) continue;
            const q = s.q + dq, r = s.r + dr;
            const key = q + ',' + r;
            let cell = field.get(key);
            if (!cell) { cell = { A: 0, B: 0, q: q, r: r }; field.set(key, cell); }
            cell[s.team] += w * (1 - dist / (radius + 1));
          }
        }
      });

      this.cloud.clear();
      // hex の実寸は Renderer と同じ基準を使う（別定義を持つと盤とずれる）
      const size = (typeof global.HEX_SIZE !== 'undefined' ? global.HEX_SIZE : 54) * 0.98;
      field.forEach((cell) => {
        const diff = cell.A - cell.B;
        const mag = Math.min(1, Math.abs(diff) / 1.6);
        if (mag < 0.12) return;
        const p = R.hexToPx(cell.q, cell.r);
        if (!p) return;
        this.cloud.fillStyle(diff > 0 ? FRIEND : ENEMY, mag * 0.22);
        this.cloud.beginPath();
        for (let i = 0; i < 6; i++) {
          const ang = Math.PI / 180 * (90 + 60 * i);
          const x = p.x + size * Math.cos(ang);
          const y = p.y + size * Math.sin(ang);
          if (i === 0) this.cloud.moveTo(x, y); else this.cloud.lineTo(x, y);
        }
        this.cloud.closePath();
        this.cloud.fillPath();
      });
      void zoom;
    }

    update() {
      if (!this.active) return;
      const scene = this.scene;
      const cam = scene.cameras.main;
      const zoom = Math.max(0.05, cam.zoom || 1);
      const width = cam.width || scene.scale.width;
      const height = cam.height || scene.scale.height;
      // The shade belongs to the world scene, so derive its rectangle from
      // the current world view. A scrollFactor(0) screen-sized rectangle is
      // still affected by camera zoom in Phaser 3 and turns into detached
      // horizontal / vertical blocks after a viewport change.
      const topLeft = cam.getWorldPoint(cam.x, cam.y);
      const bottomRight = cam.getWorldPoint(cam.x + width, cam.y + height);
      this.shade.setPosition(topLeft.x, topLeft.y);
      this.shade.setSize(
        Math.max(1, bottomRight.x - topLeft.x),
        Math.max(1, bottomRight.y - topLeft.y)
      );
      this.banner.setScale(1 / zoom).setPosition(width / (2 * zoom), 84 / zoom);
      this.help.setScale(1 / zoom).setPosition((width - 12) / zoom, 136 / zoom);
      this.detail.setScale(1 / zoom).setPosition(12 / zoom, (height - 12) / zoom);
      this.lines.clear();
      if (this.domUi) {
        const host = this.domUi.root.parentElement;
        const sceneWidth = Math.max(1, scene.scale.width || width);
        const hostWidth = host ? host.clientWidth : width;
        const mapDisplayWidth = Math.min(hostWidth, (width / sceneWidth) * hostWidth);
        this.domUi.banner.style.left = `${Math.round(mapDisplayWidth / 2)}px`;
        this.domUi.help.style.right = `${Math.round(Math.max(12, hostWidth - mapDisplayWidth + 12))}px`;
      }

      this.frame = (this.frame || 0) + 1;

      const soldiers = this.options.getSoldiers ? (this.options.getSoldiers() || []) : [];
      const alive = soldiers.filter((s) => s && s.hp > 0);
      const byId = new Map(alive.map((s) => [String(s.id), s]));
      const selectedId = this.options.getSelectedId ? this.options.getSelectedId() : null;
      // 矩形選択は複数。主兵(selectedId)だけ太く、残りも選択中と分かる太さで描く
      const selectedIds = this.options.getSelectedIds
        ? new Set(this.options.getSelectedIds() || []) : null;
      const hoveredId = this.options.getHoveredId ? this.options.getHoveredId() : null;
      const visible = new Set();
      const compact = alive.length >= COMPACT_DETAIL_AT;

      // 指揮官（各軍1名）。戦雲の統率係数と指揮リンクの描画に使う
      const leaders = {};
      alive.forEach((s) => { if (isActingLeader(s)) leaders[s.team] = s; });

      // 戦雲は毎フレーム組み直す必要がない。ポーズ中は盤面が動かないので間引く
      if (this.cloud && (this._cloudAt !== alive.length || this.frame % 30 === 1)) {
        this._cloudAt = alive.length;
        this._drawCloud(alive, leaders);
      }

      // 相撃ち判定: 互いに相手を狙っている対を先に洗い出す
      const aimingAt = new Map();
      alive.forEach((s) => {
        const t = targetIdOf(s);
        if (t) aimingAt.set(String(s.id), String(t));
      });
      const mutual = new Set();
      aimingAt.forEach((tid, sid) => {
        if (aimingAt.get(tid) === sid) mutual.add(sid);
      });

      // 指揮リンク: 分隊長から声の届く範囲の部下へ細い線を引く（情報連携の可視化）
      const T = (typeof SIM_TUNING !== 'undefined') ? SIM_TUNING : {};
      const voice = T.COMMS_VOICE_RNG || 2;
      Object.keys(leaders).forEach((team) => {
        const lead = leaders[team];
        const lp = this._position(String(lead.id), lead);
        if (!lp) return;
        alive.forEach((s) => {
          if (s.team !== team || s.id === lead.id) return;
          const d = Math.max(Math.abs(s.q - lead.q), Math.abs(s.r - lead.r),
            Math.abs((s.q + s.r) - (lead.q + lead.r)));
          if (d > voice) return;
          const p = this._position(String(s.id), s);
          if (!p) return;
          this.lines.lineStyle(1 / zoom, LEAD, 0.4);
          this.lines.beginPath();
          this.lines.moveTo(lp.x, lp.y - 8 / zoom);
          this.lines.lineTo(p.x, p.y - 8 / zoom);
          this.lines.strokePath();
        });
      });

      alive.forEach((s) => {
        const id = String(s.id);
        const pos = this._position(id, s);
        if (!pos) return;
        const isPrimary = (id === String(selectedId));
        const isSel = isPrimary || (selectedIds ? selectedIds.has(id) : false);
        const isHovered = (id === String(hoveredId));
        const pending = this.options.getPendingTargetId && this.options.getPendingTargetId(id, s);
        const pendingHex = this.options.getPendingTargetHex
          && this.options.getPendingTargetHex(id, s);
        const pendingMode = this.options.getPendingTargetMode
          && this.options.getPendingTargetMode(id, s);
        const pendingFiringHex = this.options.getPendingFiringHex
          && this.options.getPendingFiringHex(id, s);
        const pendingApproachPath = this.options.getPendingApproachPath
          && this.options.getPendingApproachPath(id, s);
        const showDetail = !compact || isPrimary || isHovered
          || isActingLeader(s) || !!pending || !!pendingHex;
        const info = describeSoldier(s, (targetId) => this._name(targetId));
        // The queued command is the decision being reviewed, so show it ahead
        // of an older sim intent until communications deliver the new order.
        if (pending) {
          info.targetId = pending;
          info.targetName = this._name(pending);
          info.action = '命令伝達中';
          info.moveGoal = null;
          info.targetHex = null;
        } else if (pendingHex) {
          info.targetId = null;
          info.targetName = null;
          info.moveGoal = pendingMode === 'move' ? pendingHex : null;
          info.targetHex = pendingMode === 'suppress' ? pendingHex : null;
          info.firingHex = pendingFiringHex || null;
          info.approachPath = pendingApproachPath || null;
          info.action = pendingFiringHex ? '接近→制圧（命令伝達中）' : '命令伝達中';
        }

        const leader = isActingLeader(s) ? '◈ 指揮官 ' : '';
        if (isActingLeader(s)) {
          // 指揮官は輪を二重にして、盤面のどこに居るか一目で分かるようにする
          this.lines.lineStyle(2 / zoom, LEAD, 0.9);
          this.lines.strokeCircle(pos.x, pos.y - 8 / zoom, 17 / zoom);
        }
        const targetText = info.targetId ? ` → ${info.targetName}` : '';
        if (showDetail) {
          visible.add(id);
          const label = this._label(id, s.team);
          label.setText(`${leader}${this._name(id)}\n${info.action}${targetText}`);
        label.setScale(1 / zoom);
        label.setPosition(
          pos.x + (s.team === 'A' ? -14 : 14) / zoom,
          pos.y - 24 / zoom
          ).setVisible(true);
        }

        const color = s.team === 'A' ? FRIEND : ENEMY;
        this.lines.lineStyle((isPrimary ? 3 : isSel ? 2.2 : 1.5) / zoom, color, 0.95);
        this.lines.strokeCircle(pos.x, pos.y - 8 / zoom,
          (isPrimary ? 14 : isSel ? 12 : 9) / zoom);

        if (showDetail && info.targetId) {
          const target = byId.get(String(info.targetId));
          const targetPos = target && this._position(String(target.id), target);
          if (targetPos) {
            // 撃ち合いなら互いの線を中間で止め、ぶつかる点に火花を描く。
            // 一方通行なら標的まで矢尻が届く — 向きが一目で分かる。
            const clashing = mutual.has(id);
            this._line(pos, targetPos, s.fireMode === 'suppress' ? SUPPRESS : AIM,
              2.2, 0.86, clashing ? 0.46 : 1);
            if (clashing && String(id) < String(info.targetId)) this._clash(pos, targetPos);
          }
        } else if (showDetail && info.targetHex && info.firingHex
          && global.Renderer && global.Renderer.hexToPx) {
          let cursor = pos;
          (info.approachPath || []).forEach((h) => {
            const step = global.Renderer.hexToPx(h.q, h.r);
            if (step) {
              this._line(cursor, step, MOVE, 1.8, 0.72, 0.999);
              cursor = step;
            }
          });
          const firing = global.Renderer.hexToPx(info.firingHex.q, info.firingHex.r);
          const target = global.Renderer.hexToPx(info.targetHex.q, info.targetHex.r);
          if (firing && target) {
            this.lines.lineStyle(2 / zoom, MOVE, 0.85);
            this.lines.strokeCircle(firing.x, firing.y - 8 / zoom, 12 / zoom);
            this._line(firing, target, SUPPRESS, 2.2, 0.9, 1);
          }
        } else if (showDetail && (info.targetHex || info.moveGoal)
          && global.Renderer && global.Renderer.hexToPx) {
          const goalHex = info.targetHex || info.moveGoal;
          const goal = global.Renderer.hexToPx(goalHex.q, goalHex.r);
          if (goal) this._line(pos, goal, info.targetHex ? SUPPRESS : MOVE,
            info.targetHex ? 2.2 : 2, info.targetHex ? 0.86 : 0.82);
        }
      });

      this.labels.forEach((label, id) => {
        if (!visible.has(id)) label.setVisible(false);
      });

      // 指揮官の采配を盤面へ。何を企てているかが見えないと、AIの判断は
      // 「勝手に動いた」としか読めない
      const plan = this.options.getPlan ? this.options.getPlan() : null;
      if (this._drawPlan) this._drawPlan(plan, byId);

      // 命令確定のターゲットカーソル。数回点滅して締まりながら消える
      if (this.flashes) this.flashes.forEach((left, id) => {
        const s = byId.get(id);
        const pos = s && this._position(id, s);
        if (pos) this._reticle(pos, 1 - left / FLASH_FRAMES);
        if (left <= 1) this.flashes.delete(id); else this.flashes.set(id, left - 1);
      });

      // 指揮官が今どの采配を回しているかを一行で出す
      const planLine = (plan && plan.hex)
        ? `指揮: ${plan.label} (${plan.hex.q},${plan.hex.r})`
          + (plan.assaultIds && plan.assaultIds.length
            ? ` ▸ 突入${plan.assaultIds.length}名` : ` ▸ 制圧${(plan.baseIds || []).length}名`)
        : null;

      const selected = selectedId != null ? byId.get(String(selectedId)) : null;
      if (selected) {
        const info = describeSoldier(selected, (id) => this._name(id));
        const ammo = Number.isFinite(selected.magRemaining)
          ? `${selected.magRemaining}発 + 予備${selected.magsLeft}` : '不明';
        const target = info.targetId ? this._name(info.targetId) : 'なし';
        const detailText = `選択: ${this._name(selected.id)}${isActingLeader(selected) ? ' ◈ 指揮官' : ''}\n`
          + `行動: ${info.action}   対象: ${target}\n`
          + `HP ${Math.round(selected.hp)}   制圧 ${Math.round(selected.suppression || 0)}   弾薬 ${ammo}`
          + (planLine ? `\n${planLine}` : '');
        this._setDetail(detailText);
      } else {
        // 未選択時は操作説明を出さない（チュートリアルの領分）。指揮官の采配だけ、
        // 出ている時に出す。
        this._setDetail(planLine || '');
      }
    }

    destroy() {
      if (this.active) {
        if (this.scene.anims && this.scene.anims.resumeAll) this.scene.anims.resumeAll();
        if (this.scene.tweens && this.scene.tweens.resumeAll) this.scene.tweens.resumeAll();
      }
      this.labels.forEach((label) => label.destroy());
      this.labels.clear();
      [this.shade, this.lines, this.banner, this.help, this.detail].forEach((obj) => {
        if (obj && obj.destroy) obj.destroy();
      });
      if (this.domUi && this.domUi.root.parentNode) this.domUi.root.parentNode.removeChild(this.domUi.root);
      this.domUi = null;
    }
  }

  /** 現行インスタンスへ命令確定表示を投げる（無ければ黙って何もしない） */
  TacticalPauseOverlay.flash = function (id) {
    if (TacticalPauseOverlay.current) TacticalPauseOverlay.current.flashTarget(id);
  };
  TacticalPauseOverlay.current = null;
  TacticalPauseOverlay.COMPACT_DETAIL_AT = COMPACT_DETAIL_AT;
  TacticalPauseOverlay.describeSoldier = describeSoldier;
  TacticalPauseOverlay.targetIdOf = targetIdOf;
  TacticalPauseOverlay.moveGoalOf = moveGoalOf;
  global.TacticalPauseOverlay = TacticalPauseOverlay;
})(typeof window !== 'undefined' ? window : globalThis);

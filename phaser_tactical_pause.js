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

  function describeSoldier(s, nameOf) {
    if (!s || s.hp <= 0) return { action: '戦闘不能', targetId: null, moveGoal: null };
    const targetId = targetIdOf(s);
    const moveGoal = moveGoalOf(s);
    let action;
    if (s.state === 'reload') action = '再装填中';
    else if (s.state === 'pinned') action = '釘付け';
    else if (s.state === 'suppressed') action = '制圧下';
    else if (s.state === 'move' || moveGoal) action = '移動中';
    else if (targetId) action = s.fireMode === 'suppress' ? '制圧射撃' : '照準・射撃';
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
        .setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH).setVisible(false);
      this.lines = scene.add.graphics().setDepth(DEPTH + 10).setVisible(false);
      this.banner = scene.add.text(0, 12, 'PAUSE', {
        fontFamily: 'Share Tech Mono, monospace', fontSize: '17px',
        color: '#f2ead0', backgroundColor: 'rgba(15,20,19,0.90)',
        padding: { x: 14, y: 7 },
      }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(DEPTH + 30).setVisible(false);
      this.help = scene.add.text(0, 0,
        '味方を選択 → 敵をクリック: 射撃命令\n右クリック: 移動命令  /  F: 全員集中射撃  /  S: 制圧射撃  /  C: 遮蔽', {
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
          help.textContent = '味方を選択 → 敵をクリック: 射撃命令\n右クリック: 移動命令 / F: 集中射撃 / S: 制圧射撃 / C: 遮蔽';
          help.style.cssText = 'position:absolute;right:12px;top:92px;white-space:pre-line;padding:7px 10px;background:rgba(10,15,14,.88);border-left:2px solid #7fd9e8;font-size:11px;line-height:1.5;text-align:right';
          const detail = document.createElement('div');
          detail.style.cssText = 'position:absolute;left:12px;bottom:64px;white-space:pre-line;padding:8px 10px;background:rgba(10,15,14,.92);border-left:2px solid #7fd9e8;font-size:12px;line-height:1.45';
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
      this.lines.setVisible(value);
      this.banner.setVisible(value && !this.domUi);
      this.help.setVisible(value && !this.domUi);
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
        this.labels.forEach((label) => label.setVisible(false));
      }
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

    _line(from, to, color, width, alpha) {
      const cam = this.scene.cameras.main;
      const zoom = Math.max(0.05, cam.zoom || 1);
      const dx = to.x - from.x, dy = to.y - from.y;
      const d = Math.hypot(dx, dy);
      if (d < 2) return;
      const nx = dx / d, ny = dy / d;
      const end = { x: to.x - nx * 9 / zoom, y: to.y - ny * 9 / zoom };
      this.lines.lineStyle((width || 2) / zoom, color, alpha == null ? 0.9 : alpha);
      this.lines.beginPath(); this.lines.moveTo(from.x, from.y); this.lines.lineTo(end.x, end.y); this.lines.strokePath();
      const size = 8 / zoom;
      this.lines.fillStyle(color, alpha == null ? 0.9 : alpha);
      this.lines.fillTriangle(
        to.x, to.y,
        end.x - ny * size * 0.55, end.y + nx * size * 0.55,
        end.x + ny * size * 0.55, end.y - nx * size * 0.55
      );
    }

    update() {
      if (!this.active) return;
      const scene = this.scene;
      const cam = scene.cameras.main;
      const zoom = Math.max(0.05, cam.zoom || 1);
      const width = cam.width || scene.scale.width;
      const height = cam.height || scene.scale.height;
      const zoomCover = Math.min(zoom, 1);
      this.shade.setSize(width / zoomCover, height / zoomCover);
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

      const soldiers = this.options.getSoldiers ? (this.options.getSoldiers() || []) : [];
      const alive = soldiers.filter((s) => s && s.hp > 0);
      const byId = new Map(alive.map((s) => [String(s.id), s]));
      const selectedId = this.options.getSelectedId ? this.options.getSelectedId() : null;
      const visible = new Set();

      alive.forEach((s) => {
        const id = String(s.id);
        const pos = this._position(id, s);
        if (!pos) return;
        visible.add(id);
        const pending = this.options.getPendingTargetId && this.options.getPendingTargetId(id, s);
        const info = describeSoldier(s, (targetId) => this._name(targetId));
        if (!info.targetId && pending) {
          info.targetId = pending;
          info.targetName = this._name(pending);
          info.action = '命令伝達中';
        }

        const label = this._label(id, s.team);
        const leader = s.isLeader ? '★' : '';
        const targetText = info.targetId ? ` → ${info.targetName}` : '';
        label.setText(`${leader}${this._name(id)}\n${info.action}${targetText}`);
        label.setScale(1 / zoom);
        label.setPosition(
          pos.x + (s.team === 'A' ? -14 : 14) / zoom,
          pos.y - 24 / zoom
        ).setVisible(true);

        const color = s.team === 'A' ? FRIEND : ENEMY;
        this.lines.lineStyle((id === String(selectedId) ? 3 : 1.5) / zoom, color, 0.95);
        this.lines.strokeCircle(pos.x, pos.y - 8 / zoom, (id === String(selectedId) ? 14 : 9) / zoom);

        if (info.targetId) {
          const target = byId.get(String(info.targetId));
          const targetPos = target && this._position(String(target.id), target);
          if (targetPos) this._line(pos, targetPos, s.fireMode === 'suppress' ? SUPPRESS : AIM, 2.2, 0.86);
        } else if (info.moveGoal && global.Renderer && global.Renderer.hexToPx) {
          const goal = global.Renderer.hexToPx(info.moveGoal.q, info.moveGoal.r);
          if (goal) this._line(pos, goal, MOVE, 2, 0.82);
        }
      });

      this.labels.forEach((label, id) => {
        if (!visible.has(id)) label.setVisible(false);
      });

      const selected = selectedId != null ? byId.get(String(selectedId)) : null;
      if (selected) {
        const info = describeSoldier(selected, (id) => this._name(id));
        const ammo = Number.isFinite(selected.magRemaining)
          ? `${selected.magRemaining}発 + 予備${selected.magsLeft}` : '不明';
        const target = info.targetId ? this._name(info.targetId) : 'なし';
        const detailText = `選択: ${this._name(selected.id)}${selected.isLeader ? ' ★' : ''}\n`
          + `行動: ${info.action}   対象: ${target}\n`
          + `HP ${Math.round(selected.hp)}   制圧 ${Math.round(selected.suppression || 0)}   弾薬 ${ammo}`;
        this.detail.setText(detailText);
        if (this.domUi) this.domUi.detail.textContent = detailText;
      } else {
        this.detail.setText('味方兵をクリックして命令対象を選択');
        if (this.domUi) this.domUi.detail.textContent = '味方兵をクリックして命令対象を選択';
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

  TacticalPauseOverlay.describeSoldier = describeSoldier;
  TacticalPauseOverlay.targetIdOf = targetIdOf;
  TacticalPauseOverlay.moveGoalOf = moveGoalOf;
  global.TacticalPauseOverlay = TacticalPauseOverlay;
})(typeof window !== 'undefined' ? window : globalThis);

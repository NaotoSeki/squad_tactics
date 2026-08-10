(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.BattleReview = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  let active = null;

  function plain(value) {
    const ancestors = new WeakSet();
    function clone(item, key) {
      if (typeof item === 'function' || key === '_sim') return undefined;
      if (!item || typeof item !== 'object') return item;
      if (ancestors.has(item)) return undefined;
      ancestors.add(item);
      const out = Array.isArray(item) ? [] : {};
      Object.keys(item).forEach((childKey) => {
        const child = clone(item[childKey], childKey);
        if (child !== undefined) out[childKey] = child;
      });
      ancestors.delete(item);
      return out;
    }
    return clone(value, '');
  }
  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.keys(value).forEach((key) => deepFreeze(value[key]));
    return Object.freeze(value);
  }
  function sceneState() {
    if (typeof Renderer === 'undefined' || !Renderer.game) return {};
    const scene = Renderer.game.scene && Renderer.game.scene.getScene('MainScene');
    const camera = scene && scene.cameras && scene.cameras.main;
    return camera ? { camera: { scrollX: camera.scrollX, scrollY: camera.scrollY, zoom: camera.zoom } } : {};
  }

  function capture(game, result, opts) {
    opts = opts || {};
    const selectedId = game.selectedUnit && game.selectedUnit.id;
    const renderUnits = (opts.units || game.units || []).map((unit) => {
      const copy = Object.assign({}, unit);
      if (unit._sim) copy._reviewSim = plain(unit._sim);
      return copy;
    });
    return deepFreeze({
      version: 2, renderer: 'normal-battle-scene',
      tick: Number(opts.tick != null ? opts.tick : result && result.tick) || 0,
      result: plain(result || {}), map: plain(game.map || []), units: plain(renderUnits),
      view: plain(Object.assign(sceneState(), {
        selectedId: selectedId == null ? null : String(selectedId),
        reachableHexes: game.reachableHexes || [], marchReachableHexes: game.marchReachableHexes || [],
        attackLine: game.attackLine || [], path: game.path || [], targetPreview: game.targetPreview || null,
        hoverHex: game.hoverHex || null, interactionMode: game.interactionMode || 'SELECT'
      }, opts.visual || {}))
    });
  }
  function isImmutable(snapshot) { return !!snapshot && Object.isFrozen(snapshot) && Object.isFrozen(snapshot.units) && Object.isFrozen(snapshot.map); }

  function createFrozenGame(snapshot, source) {
    const frozen = Object.create(source || null);
    frozen.map = plain(snapshot.map); frozen.units = plain(snapshot.units);
    frozen.units.forEach((unit) => { if (unit._reviewSim) unit._sim = unit._reviewSim; });
    frozen.state = 'REVIEW'; frozen._battleReviewReadOnly = true;
    frozen.reachableHexes = plain(snapshot.view.reachableHexes || []);
    frozen.marchReachableHexes = plain(snapshot.view.marchReachableHexes || []);
    frozen.attackLine = plain(snapshot.view.attackLine || []); frozen.path = plain(snapshot.view.path || []);
    frozen.targetPreview = plain(snapshot.view.targetPreview || null); frozen.hoverHex = plain(snapshot.view.hoverHex || null);
    frozen.interactionMode = 'SELECT'; frozen.pendingAction = null; frozen.selectedUnits = null;
    frozen.selectedUnit = frozen.units.find((u) => String(u.id) === snapshot.view.selectedId) || null;
    // Every mutation/command entry point is closed. Unit inspection is handled
    // by BattleLogic.onUnitClick's REVIEW branch and only changes this facade.
    ['actionMove','actionAttack','actionMelee','actionHeal','actionRepair','actionReserveMarch',
      'endTurn','runAuto','toggleAuto','swapEquipment','setMode','handleRightClick','reloadWeapon',
      'toggleFireMode','setAttackModeWithBurst','canEquipItemFromDeck','transferEquipment','moveWeaponToDeck','equipWeaponFromDeck','consumeAmmo',
      'addReinforcement','processMarchOrders','issueOrder','orderMove','orderFocusFire','orderSuppress',
      'orderTakeCover','orderAssault','beginAction','commitAction','cancelAction','setStance',
      'deployUnit','triggerBombardment','actionBombardment','useItem','discardItem'].forEach((name) => {
      frozen[name] = function () { return false; };
    });
    frozen.handleClick = function () { return false; };
    frozen.handleHover = function (hex) { this.hoverHex = hex; return false; };
    return frozen;
  }

  function restoreCamera(snapshot) {
    if (!snapshot.view.camera || typeof Renderer === 'undefined' || !Renderer.game) return;
    const scene = Renderer.game.scene && Renderer.game.scene.getScene('MainScene');
    const camera = scene && scene.cameras && scene.cameras.main;
    if (!camera) return;
    camera.setScroll(snapshot.view.camera.scrollX, snapshot.view.camera.scrollY);
    camera.setZoom(snapshot.view.camera.zoom);
  }
  function requestLayout() {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('resize'));
    if (typeof Renderer !== 'undefined' && Renderer.game && Renderer.game.scale && Renderer.game.scale.refresh) Renderer.game.scale.refresh();
  }

  function open(snapshot, resultScreen) {
    if (active || !snapshot || typeof window === 'undefined') return active;
    const live = window.gameLogic;
    const frozen = createFrozenGame(snapshot, live);
    active = { snapshot, resultScreen, live, frozen };
    if (resultScreen) resultScreen.style.display = 'none';
    window.gameLogic = frozen;
    if (typeof RtwpBattle !== 'undefined') {
      if (RtwpBattle.instance && RtwpBattle.detach) RtwpBattle.detach();
      else RtwpBattle.active = false;
    }
    if (document.body) document.body.classList.add('battle-review-active');
    restoreCamera(snapshot); requestLayout();
    const bar = document.getElementById('battle-review-return');
    if (bar) bar.style.display = 'block';
    if (frozen.updateSidebar) frozen.updateSidebar();
    return active;
  }
  function close() {
    if (!active || typeof window === 'undefined') return;
    const old = active; active = null;
    window.gameLogic = old.live;
    if (document.body) document.body.classList.remove('battle-review-active');
    const bar = document.getElementById('battle-review-return'); if (bar) bar.style.display = 'none';
    if (old.resultScreen) old.resultScreen.style.display = 'flex';
    requestLayout();
  }
  function addAction(screen, snapshot, doc) {
    doc = doc || document;
    if (!screen || !snapshot) return null;
    let button = screen.querySelector('.battle-review-action');
    if (!button) { button = doc.createElement('button'); button.type = 'button'; button.className = 'battle-review-action'; button.textContent = '終了時の戦場を確認'; screen.firstElementChild.appendChild(button); }
    button.onclick = () => open(snapshot, screen); return button;
  }
  return { plain, deepFreeze, capture, isImmutable, createFrozenGame, open, close, addAction };
}));

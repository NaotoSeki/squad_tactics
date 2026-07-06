/**
 * Phase 3: ミッション未埋め込み時のデフォルト（20×20）。
 * 本番: data/mission_pl_01.json → python scripts/embed_mission_json.js → mission_embed_pl01.js + mission_loader.js
 */
(function () {
  if (typeof window === 'undefined') return;
  if (!window.__ST_MAP__) {
    window.__ST_MAP__ = { w: 20, h: 20 };
  }
})();

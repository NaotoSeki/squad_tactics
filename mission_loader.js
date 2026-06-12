/**
 * ミッション正本: mission_embed_*.js が window.__ST_MISSION__ を定義する場合、
 * data.js より前に __ST_MAP__ / __ST_BRIEFING__ へ展開（MAP_W/MAP_H の const 評価に間に合わせる）。
 * JSON の編集 → python scripts/embed_mission_json.py で埋め込み再生成。
 */
(function () {
  if (typeof window === 'undefined') return;
  var m = window.__ST_MISSION__;
  if (!m || !m.map || typeof m.map.w !== 'number' || typeof m.map.h !== 'number') {
    return;
  }
  window.__ST_MAP__ = { w: m.map.w, h: m.map.h };
  if (m.briefing && m.briefing.lines && Array.isArray(m.briefing.lines)) {
    window.__ST_BRIEFING__ = {
      sector: m.briefing.sector != null ? m.briefing.sector : m.sector,
      lines: m.briefing.lines.slice()
    };
  }
  window.__ST_MISSION_ID__ = m.id || 'unknown';
})();

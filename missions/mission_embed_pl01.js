/** Auto from C:/Projects/squad_tactics/data/mission_pl_01.json — run: python scripts/embed_mission_json.py */
(function () {
  if (typeof window === 'undefined') return;
  window.__ST_MISSION__ = {
  "id": "pl_scale_01",
  "title": "PL スケール体験（60×100）",
  "sector": 1,
  "map": {
    "w": 60,
    "h": 100
  },
  "briefing": {
    "sector": 1,
    "lines": [
      "作戦目標: 敵小隊の退路を断ち、前線の圧力を下げる。",
      "地形: 60×100 ヘックス（ミッション JSON 指定）。",
      "装填互換の正本: cbe_weapon_ammo_explicit.json → build_pl_st_compat.py → pl_st_weapon_ammo.js（WPNS.plCompat）。"
    ]
  },
  "catalog": {
    "compatExplicitPath": "scripts/pl_decoded/cbe_weapon_ammo_explicit.json",
    "stCompatBuild": "scripts/build_pl_st_compat.py",
    "stCompatRuntime": "pl_st_weapon_ammo.js"
  },
  "validate": {
    "weaponCodesExpectPlCompat": [
      "m1",
      "m1911",
      "bar",
      "thompson",
      "k98_scope",
      "mg42",
      "luger"
    ]
  },
  "battle": {
    "enemyCount": 8,
    "enemyTemplateWeights": {
      "rifleman": 0.45,
      "gunner": 0.22,
      "sniper": 0.2,
      "tank_pz4": 0.13
    }
  }
};
})();

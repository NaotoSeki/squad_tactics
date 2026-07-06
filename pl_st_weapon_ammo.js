/** PL / CBE 弾薬行 — 厳密 cbe_weapon_ammo_explicit.json + build_pl_st_compat.py */
(function () {
  'use strict';
  const PL_ST_WEAPON_AMMO = {
  "m1911": {
    "plCbeWeaponIndex": 0,
    "plWeaponName": "M1911A1",
    "acceptsAmmoPlIndices": [
      225
    ],
    "plAmmoLabel": "45ACP-7 (単列)"
  },
  "bar": {
    "plCbeWeaponIndex": 7,
    "plWeaponName": "M1918A2 BAR",
    "acceptsAmmoPlIndices": [
      230
    ],
    "plAmmoLabel": "3006-20B ボール"
  },
  "m1": {
    "plCbeWeaponIndex": 8,
    "plWeaponName": "M1 Rifle",
    "acceptsAmmoPlIndices": [
      229,
      231
    ],
    "plAmmoLabel": "M1 ガランド 8連: 3006-5 / 3006-8（未実機最終の行は JSON 更新で差し替え可）"
  },
  "k98_scope": {
    "plCbeWeaponIndex": 6,
    "plWeaponName": "M1903A4",
    "acceptsAmmoPlIndices": [
      229,
      230,
      231
    ],
    "plAmmoLabel": "03 系: クリップ 3006-5/8 + ボール 3006-20B 等"
  },
  "thompson": {
    "plCbeWeaponIndex": 17,
    "plWeaponName": "M1A1 SMG",
    "acceptsAmmoPlIndices": [
      234,
      235,
      236,
      237
    ],
    "plAmmoLabel": "45ACP20T/30T/50T/30G — トンプソン・グリース系箱弾"
  },
  "mg42": {
    "plCbeWeaponIndex": 94,
    "plWeaponName": "MG42",
    "acceptsAmmoPlIndices": [
      272,
      273,
      274,
      275,
      276,
      277,
      288,
      289,
      290,
      295,
      296,
      389
    ],
    "plAmmoLabel": "7.92 ベルト/断片。厳密1対1は未採取 — 7.92-* 行クラスタ。次版でバイナリ狭める"
  },
  "luger": {
    "plCbeWeaponIndex": 43,
    "plWeaponName": "P08",
    "acceptsAmmoPlIndices": [
      258,
      265,
      278,
      279,
      280,
      281,
      282,
      283,
      284,
      285,
      286,
      320,
      321,
      322,
      323,
      355,
      378,
      379,
      384,
      388,
      390
    ],
    "plAmmoLabel": "9Pb 行 — 厳密はバイナリ。現状9mm Para クラスタ"
  }
};
  const PL_CBE_OR_ONLY = {
  "1": {
    "plWeaponName": "M1917 S&W",
    "acceptsAmmoPlIndices": [
      226
    ],
    "plAmmoLabel": "45ACP-3 ハーフムーンクリップ"
  },
  "2": {
    "plWeaponName": "M1917 Colt",
    "acceptsAmmoPlIndices": [
      226
    ],
    "plAmmoLabel": "45ACP-3 ハーフムーンクリップ"
  },
  "4": {
    "plWeaponName": "AN-M8",
    "acceptsAmmoPlIndices": [
      228
    ],
    "plAmmoLabel": "AN-M8-1 発煙弾/同梱弾数"
  },
  "51": {
    "plWeaponName": "27mmLeuP",
    "acceptsAmmoPlIndices": [
      266,
      267
    ],
    "plAmmoLabel": "対応弾 FLeut41(266) + 共用 Wkor361(267)"
  },
  "52": {
    "plWeaponName": "27mmP42",
    "acceptsAmmoPlIndices": [
      266,
      267
    ],
    "plAmmoLabel": "同上（PL 表記は 27mmP42 = 27mmLP42 相当）"
  },
  "54": {
    "plWeaponName": "27mmStuP",
    "acceptsAmmoPlIndices": [
      267
    ],
    "plAmmoLabel": "Wkor361(267) — ユーザー: 3種ランチャーに Wkor が通る。StuP は主に 267"
  },
  "58": {
    "plWeaponName": "Kar98k svw",
    "acceptsAmmoPlIndices": [
      272,
      303,
      304
    ],
    "plAmmoLabel": "7.92-5(272) / GPzgr(303) / GSprgr(304) — 厳格（ユーザー指定）"
  },
  "135": {
    "plWeaponName": "Breda mod30",
    "acceptsAmmoPlIndices": [
      318,
      324
    ],
    "plAmmoLabel": "6.5-6(318) / 6.5-20(324) — 厳格（ユーザー指定）"
  }
};
  const PL_CBE_EXPORT_META = {
  "squadTactics": {
    "m1911": {
      "plCbeWeaponIndex": 0,
      "plWeaponName": "M1911A1",
      "acceptsAmmoPlIndices": [
        225
      ],
      "plAmmoLabel": "45ACP-7 (単列)"
    },
    "bar": {
      "plCbeWeaponIndex": 7,
      "plWeaponName": "M1918A2 BAR",
      "acceptsAmmoPlIndices": [
        230
      ],
      "plAmmoLabel": "3006-20B ボール"
    },
    "m1": {
      "plCbeWeaponIndex": 8,
      "plWeaponName": "M1 Rifle",
      "acceptsAmmoPlIndices": [
        229,
        231
      ],
      "plAmmoLabel": "M1 ガランド 8連: 3006-5 / 3006-8（未実機最終の行は JSON 更新で差し替え可）"
    },
    "k98_scope": {
      "plCbeWeaponIndex": 6,
      "plWeaponName": "M1903A4",
      "acceptsAmmoPlIndices": [
        229,
        230,
        231
      ],
      "plAmmoLabel": "03 系: クリップ 3006-5/8 + ボール 3006-20B 等"
    },
    "thompson": {
      "plCbeWeaponIndex": 17,
      "plWeaponName": "M1A1 SMG",
      "acceptsAmmoPlIndices": [
        234,
        235,
        236,
        237
      ],
      "plAmmoLabel": "45ACP20T/30T/50T/30G — トンプソン・グリース系箱弾"
    },
    "mg42": {
      "plCbeWeaponIndex": 94,
      "plWeaponName": "MG42",
      "acceptsAmmoPlIndices": [
        272,
        273,
        274,
        275,
        276,
        277,
        288,
        289,
        290,
        295,
        296,
        389
      ],
      "plAmmoLabel": "7.92 ベルト/断片。厳密1対1は未採取 — 7.92-* 行クラスタ。次版でバイナリ狭める"
    },
    "luger": {
      "plCbeWeaponIndex": 43,
      "plWeaponName": "P08",
      "acceptsAmmoPlIndices": [
        258,
        265,
        278,
        279,
        280,
        281,
        282,
        283,
        284,
        285,
        286,
        320,
        321,
        322,
        323,
        355,
        378,
        379,
        384,
        388,
        390
      ],
      "plAmmoLabel": "9Pb 行 — 厳密はバイナリ。現状9mm Para クラスタ"
    }
  },
  "plOnlyCbeLaunchers": {
    "1": {
      "plWeaponName": "M1917 S&W",
      "acceptsAmmoPlIndices": [
        226
      ],
      "plAmmoLabel": "45ACP-3 ハーフムーンクリップ"
    },
    "2": {
      "plWeaponName": "M1917 Colt",
      "acceptsAmmoPlIndices": [
        226
      ],
      "plAmmoLabel": "45ACP-3 ハーフムーンクリップ"
    },
    "4": {
      "plWeaponName": "AN-M8",
      "acceptsAmmoPlIndices": [
        228
      ],
      "plAmmoLabel": "AN-M8-1 発煙弾/同梱弾数"
    },
    "51": {
      "plWeaponName": "27mmLeuP",
      "acceptsAmmoPlIndices": [
        266,
        267
      ],
      "plAmmoLabel": "対応弾 FLeut41(266) + 共用 Wkor361(267)"
    },
    "52": {
      "plWeaponName": "27mmP42",
      "acceptsAmmoPlIndices": [
        266,
        267
      ],
      "plAmmoLabel": "同上（PL 表記は 27mmP42 = 27mmLP42 相当）"
    },
    "54": {
      "plWeaponName": "27mmStuP",
      "acceptsAmmoPlIndices": [
        267
      ],
      "plAmmoLabel": "Wkor361(267) — ユーザー: 3種ランチャーに Wkor が通る。StuP は主に 267"
    },
    "58": {
      "plWeaponName": "Kar98k svw",
      "acceptsAmmoPlIndices": [
        272,
        303,
        304
      ],
      "plAmmoLabel": "7.92-5(272) / GPzgr(303) / GSprgr(304) — 厳格（ユーザー指定）"
    },
    "135": {
      "plWeaponName": "Breda mod30",
      "acceptsAmmoPlIndices": [
        318,
        324
      ],
      "plAmmoLabel": "6.5-6(318) / 6.5-20(324) — 厳格（ユーザー指定）"
    }
  },
  "cbeNameChainLength": 484
};
  function applyPlCompatToWpnss() {
    if (typeof WPNS === 'undefined') return;
    for (const code of Object.keys(PL_ST_WEAPON_AMMO)) {
      if (!WPNS[code]) continue;
      WPNS[code].plCompat = PL_ST_WEAPON_AMMO[code];
    }
  }
  function plCompatAcceptsCbeAmmoIndex(wpnCode, plCbeAmmoIndex) {
    const w = (typeof WPNS !== 'undefined') && WPNS[wpnCode];
    const c = w && w.plCompat;
    if (!c || !c.acceptsAmmoPlIndices) return true;
    return c.acceptsAmmoPlIndices.indexOf(plCbeAmmoIndex) >= 0;
  }
  function plOnlyLauncherAccepts(cbeWeaponIndex, plCbeAmmoIndex) {
    const k = String(cbeWeaponIndex);
    const o = PL_CBE_OR_ONLY[k];
    if (!o || !o.acceptsAmmoPlIndices) return false;
    return o.acceptsAmmoPlIndices.indexOf(plCbeAmmoIndex) >= 0;
  }
  if (typeof window !== 'undefined') {
    window.PL_ST_WEAPON_AMMO = PL_ST_WEAPON_AMMO;
    window.PL_CBE_OR_ONLY = PL_CBE_OR_ONLY;
    window.PL_CBE_EXPORT_META = PL_CBE_EXPORT_META;
    window.applyPlCompatToWpnss = applyPlCompatToWpnss;
    window.plCompatAcceptsCbeAmmoIndex = plCompatAcceptsCbeAmmoIndex;
    window.plOnlyLauncherAccepts = plOnlyLauncherAccepts;
  }
  applyPlCompatToWpnss();
})();

/**
 * 弾薬互換の実行時オーバーライド（CBE 再解釈・装填判定・ホバー表示の共通正本）。
 * build 時は data/weapon_ammo_overrides.json と同期すること。
 *
 * u27 形状フィルタ: data/pl_cbe_mag_shape.js + pl_ammo_resolve.js（false でロールバック）
 */
(function () {
    'use strict';

    /** PL CBE u16[27] 形状フィルタ（Thompson ドラム等）。false = 無効化 */
    window.FEATURE_PL_MAG_SHAPE_FILTER = true;

    /** PL CBE category_code==18 のみ主装填（銃剣・擲弾等を除外）。false = 無効化 */
    window.FEATURE_PL_CATEGORY_FILTER = true;

    /**
     * 武器 magazine_capacity（CBE +0x28）と弾 magCap の照合。
     * u27 クラスタ内で装填数一致の sibling に置換（Kar98k→7.92-5 等）。false = 無効化
     */
    window.FEATURE_PL_MAG_CAP_FILTER = true;

    /**
     * CBE mission pool + cap 照合（4240C / 38814 相当）。
     * PL_CBE_MISSION_POOL がある武器は merge 後、cat18 で magCap≠武器 cap の行を除去。
     * false = 従来の applyMagCapSubstitute のみ
     */
    window.FEATURE_PL_MISSION_POOL_CAP_FILTER = true;

    /** pass2 @ 0x1EC / loadout descriptor — 未配線（273→272 には不要） */
    window.FEATURE_PL_LOADOUT_DESCRIPTOR = false;

    /** loadout mag gate (mag&0x800F) — 未配線 */
    window.FEATURE_PL_LOADOUT_MAG_GATE = false;

    /** CBE 正本（weapon_ammo_map + ammo_indices）との intersect */
    window.FEATURE_PL_CANONICAL_AMMO_FILTER = true;

    /** cbeNameIndex → acceptsAmmo 差し替え（例外のみ。正本方針: docs/PL_AMMO_TRUTH.md） */
    window.PL_AMMO_WEAPON_OVERRIDES = {
        3: {
            acceptsAmmoPlIndices: [385, 387],
            skipCanonicalFilter: true,
            note: 'OSS: .380 ACP',
        },
        18: {
            acceptsAmmoPlIndices: [237, 235, 234],
            skipCanonicalFilter: true,
            note: 'M3 SMG: .45 ACP Grease Gun mag',
        },
        19: {
            acceptsAmmoPlIndices: [237, 235, 234],
            skipCanonicalFilter: true,
            note: 'M3A1 SMG: .45 ACP Grease Gun mag',
        },
        50: {
            acceptsAmmoPlIndices: [265],
            skipCanonicalFilter: true,
            note: 'P38: 9Pb-8W',
        },
        62: {
            acceptsAmmoPlIndices: [273, 272],
            skipCanonicalFilter: true,
            note: 'VG-1: 7.92-10G / 7.92-5',
        },
        63: {
            acceptsAmmoPlIndices: [273, 272],
            skipCanonicalFilter: true,
            note: 'VG-2: 7.92-10G / 7.92-5',
        },
        /** G43/Kar43 系: CBE は 273+274 だが 274(7.92-101) は FG42/1 専用。実機は 10G + 5発クリップ */
        67: {
            acceptsAmmoPlIndices: [273, 272],
            skipCanonicalFilter: true,
            note: 'Gew43: 7.92-10G + 7.92-5',
        },
        68: {
            acceptsAmmoPlIndices: [273, 272],
            skipCanonicalFilter: true,
            note: 'Kar43: 7.92-10G + 7.92-5',
        },
        70: {
            acceptsAmmoPlIndices: [273, 272],
            skipCanonicalFilter: true,
            note: 'Zf Gew43: 7.92-10G + 7.92-5',
        },
        /** FG42/1: 7.92-101(274) はこちら専用 + CBE 201/202 */
        71: {
            acceptsAmmoPlIndices: [274, 275, 276],
            skipCanonicalFilter: true,
            note: 'FG42/1: 7.92-101 + 7.92-201/202',
        },
        74: {
            acceptsAmmoPlIndices: [277],
            skipCanonicalFilter: true,
            note: 'MKb42(H): 7.92k-30',
        },
        127: {
            acceptsAmmoPlIndices: [318],
            skipCanonicalFilter: true,
            note: 'F. mod38: 6.5-6',
        },
        130: {
            acceptsAmmoPlIndices: [319],
            skipCanonicalFilter: true,
            note: 'F. mod38: 7.35-6',
        },
        160: {
            acceptsAmmoPlIndices: [351],
            skipCanonicalFilter: true,
            note: 'No2 Mk2: 380Mk2-1',
        },
        161: {
            acceptsAmmoPlIndices: [351],
            skipCanonicalFilter: true,
            note: 'No2 Mk1*: 380Mk2-1',
        },
        162: {
            acceptsAmmoPlIndices: [351],
            skipCanonicalFilter: true,
            note: 'No2 Mk1**: 380Mk2-1',
        },
        163: {
            acceptsAmmoPlIndices: [351],
            skipCanonicalFilter: true,
            note: 'Webley Mk4: 380Mk2-1',
        },
        164: {
            acceptsAmmoPlIndices: [262],
            skipCanonicalFilter: true,
            note: 'S&W No2: 32ACP-8W',
        },
        75: {
            acceptsAmmoPlIndices: [277],
            skipCanonicalFilter: true,
            note: 'MP43: 7.92k-30',
        },
        76: {
            acceptsAmmoPlIndices: [277],
            skipCanonicalFilter: true,
            note: 'StG44: 7.92k-30',
        },
        77: {
            acceptsAmmoPlIndices: [277],
            skipCanonicalFilter: true,
            note: 'VG1-5: 7.92k-30',
        },
    };

    /**
     * 弾種 index → 逆引き補正（weaponCbeIndices 省略時は WPNS 走査 + u27 フィルタ）
     * note: ホバー末尾の説明
     */
    window.PL_AMMO_INDEX_OVERRIDES = {
        236: {
            note: '50発ドラム（PL u27 形状フィルタで M1928A1 のみ。CBE ammo_indices には M1/M1A1 にも行あり）',
            sources: ['american_rifleman:war-drums-the-thompson-drum-magazine-in-combat', 'cbe:u16[27]'],
        },
        287: {
            note: '9mm 100発パン型マガジン（Ger Potsdam／Sten Mk2・3・5 共用。名称は小銃弾風だが SMG 用）',
        },
        273: {
            note: '7.92mm 10発クリップ（装填後の銃内は5発。Kar98 系は magazine_capacity=5）',
        },
        274: {
            note: '7.92-101（10発）— FG42/1 専用',
            weaponCbeIndices: [71],
        },
    };
})();

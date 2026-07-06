/** CBE 複合装備リンク — 主武器 + u26 弾薬箱 + 内包弾帯
 *  regen: python scripts/export_pl_composite_links.py
 */
(function () {
    'use strict';
    window.PL_COMPOSITE_BOXES = {
    "34": {
        "name": "M1 Ammobox",
        "inner": [
            240,
            241
        ],
        "usedBy": []
    },
    "35": {
        "name": "M2HB Ammobox",
        "inner": [
            242
        ],
        "usedBy": [
            20,
            22,
            23
        ]
    },
    "115": {
        "name": "PatrK41",
        "inner": [
            297,
            296
        ],
        "usedBy": []
    },
    "116": {
        "name": "PatrK15",
        "inner": [
            290,
            289
        ],
        "usedBy": [
            91,
            92,
            93,
            94,
            217
        ]
    },
    "141": {
        "name": "CM. FR 14/35",
        "inner": [
            328
        ],
        "usedBy": []
    },
    "185": {
        "name": "No8 Mk1",
        "inner": [
            359
        ],
        "usedBy": []
    },
    "201": {
        "name": "pat.1910",
        "inner": [
            375
        ],
        "usedBy": []
    },
    "202": {
        "name": "pat.DShK",
        "inner": [
            376
        ],
        "usedBy": [
            199
        ]
    },
    "208": {
        "name": "M07 PatrK",
        "inner": [
            382
        ],
        "usedBy": []
    }
};
    window.PL_COMPOSITE_U26 = {
    "20": {
        "idx": 35,
        "kind": "ammo_box",
        "name": "M2HB Ammobox",
        "inner": [
            242
        ]
    },
    "22": {
        "idx": 35,
        "kind": "ammo_box",
        "name": "M2HB Ammobox",
        "inner": [
            242
        ]
    },
    "23": {
        "idx": 35,
        "kind": "ammo_box",
        "name": "M2HB Ammobox",
        "inner": [
            242
        ]
    },
    "24": {
        "idx": 36,
        "kind": "optic",
        "name": "M3 Binocular",
        "inner": []
    },
    "87": {
        "idx": 117,
        "kind": "optic",
        "name": "Fernglas",
        "inner": []
    },
    "88": {
        "idx": 117,
        "kind": "optic",
        "name": "Fernglas",
        "inner": []
    },
    "91": {
        "idx": 116,
        "kind": "ammo_box",
        "name": "PatrK15",
        "inner": [
            290,
            289
        ]
    },
    "92": {
        "idx": 116,
        "kind": "ammo_box",
        "name": "PatrK15",
        "inner": [
            290,
            289
        ]
    },
    "93": {
        "idx": 116,
        "kind": "ammo_box",
        "name": "PatrK15",
        "inner": [
            290,
            289
        ]
    },
    "94": {
        "idx": 116,
        "kind": "ammo_box",
        "name": "PatrK15",
        "inner": [
            290,
            289
        ]
    },
    "95": {
        "idx": 117,
        "kind": "optic",
        "name": "Fernglas",
        "inner": []
    },
    "137": {
        "idx": 142,
        "kind": "optic",
        "name": "Binocolo",
        "inner": []
    },
    "179": {
        "idx": 186,
        "kind": "optic",
        "name": "Binocular",
        "inner": []
    },
    "199": {
        "idx": 202,
        "kind": "ammo_box",
        "name": "pat.DShK",
        "inner": [
            376
        ]
    },
    "200": {
        "idx": 203,
        "kind": "other",
        "name": "SP M12",
        "inner": []
    },
    "206": {
        "idx": 209,
        "kind": "other",
        "name": "Mle1903",
        "inner": []
    },
    "217": {
        "idx": 116,
        "kind": "ammo_box",
        "name": "PatrK15",
        "inner": [
            290,
            289
        ]
    }
};
})();

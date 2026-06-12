/** CBE 装備 UI 4 列 — 自動生成（手編集しない）
 *  regen: python scripts/re_cbe_equip_chain.py
 */
(function () {
    'use strict';
    window.PL_CBE_EQUIP_COLUMNS = {
    "columns": [
        {
            "col": 0,
            "resource_id": 1220,
            "ui_off": 64,
            "mask_bit": 1,
            "mask": 1,
            "kind": "weapon",
            "note": "主武器 cbe index（スカラー）"
        },
        {
            "col": 1,
            "resource_id": 1222,
            "ui_off": 72,
            "mask_bit": 2,
            "mask": 2,
            "kind": "ammo_box",
            "note": "弾薬箱 / u26 リンク — 46CD4 entry[0]"
        },
        {
            "col": 2,
            "resource_id": 1223,
            "ui_off": 80,
            "mask_bit": 3,
            "mask": 4,
            "kind": "tripod",
            "note": "三脚 Laf34 等 — 46CD4 entry[1]"
        },
        {
            "col": 3,
            "resource_id": 1224,
            "ui_off": 88,
            "mask_bit": 4,
            "mask": 8,
            "kind": "optic",
            "note": "観測鏡 / その他副装備"
        }
    ],
    "anchors": {
        "squadScan": "0x04240C",
        "write8B": "0x046866",
        "populate": "0x03C51A",
        "u26Scan": "0x046CD4",
        "f7c8": "0x00F7C8",
        "colBuild": "0x00ECCF"
    },
    "entry8": {
        "stride": 8,
        "linkAt": 0,
        "stateAt": 4,
        "u26ScanCols": [
            1,
            2
        ]
    },
    "memberFields": {
        "slotMask": {
            "off": "0xA4",
            "rule": "test(mask, roster_slot+1)"
        },
        "assignCtr": {
            "off": "0xBA",
            "rule": "per-column duplicate guard"
        },
        "itemIdx": {
            "off": "0x3E",
            "rule": "cbe index output @ 4240C"
        }
    }
};
})();

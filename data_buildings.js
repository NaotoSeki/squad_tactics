/** DATA BUILDINGS: Catalog for extracted Panzer Strike structures */
window.BUILDING_CATALOG = {
    rural_house: {
        id: "rural_house",
        width: 2,
        height: 2,
        scale: 2.0,
        originY: 0.8,
        frames: [
            "asset/buildings/rural_house_f00.png",
            "asset/buildings/rural_house_f01.png",
            "asset/buildings/rural_house_f02.png",
            "asset/buildings/rural_house_f03.png"
        ],
        footprint: [
            { dq: 0, dr: 0 },
            { dq: 1, dr: 0 },
            { dq: 0, dr: 1 },
            { dq: 1, dr: -1 }
        ]
    }
};

// Initial test placements for the generated map
window.MAP_BUILDINGS = [
    { id: "bld_1", type: "rural_house", q: 10, r: 10, state: 0 },
    { id: "bld_2", type: "rural_house", q: 15, r: 8, state: 0 }
];

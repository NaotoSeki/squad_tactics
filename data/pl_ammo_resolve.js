/** 予備弾（type:ammo）の表示名・cap を PL_AMMO_DATA / 主兵装から解決 */

function getWeaponAcceptsAmmoIndices(weapon) {
    if (!weapon) return [];
    if (Array.isArray(weapon.acceptsAmmo) && weapon.acceptsAmmo.length) return weapon.acceptsAmmo;
    const code = weapon.code;
    if (code && typeof WPNS !== 'undefined' && WPNS[code] && WPNS[code].acceptsAmmo) {
        return WPNS[code].acceptsAmmo;
    }
    const compat = weapon.plCompat;
    if (compat && compat.acceptsAmmoPlIndices && compat.acceptsAmmoPlIndices.length) {
        return compat.acceptsAmmoPlIndices;
    }
    return [];
}

/** バッグの予備弾が主兵装に装填可能か（acceptsAmmo 厳密照合） */
function isSpareAmmoCompatible(weapon, ammoItem) {
    if (!weapon || !ammoItem || ammoItem.type !== 'ammo') return false;
    if (ammoItem.ammoFor && weapon.code && ammoItem.ammoFor !== weapon.code) return false;
    const allowed = getWeaponAcceptsAmmoIndices(weapon);
    if (!allowed.length) return false;
    if (ammoItem.cbeNameIndex != null) return allowed.includes(ammoItem.cbeNameIndex);
    if (ammoItem.name && typeof PL_AMMO_DATA !== 'undefined') {
        for (let j = 0; j < allowed.length; j++) {
            const a = PL_AMMO_DATA[allowed[j]];
            if (a && a.name === ammoItem.name) return true;
        }
    }
    return false;
}

function pickAmmoPlIndex(weapon) {
    const list = weapon && weapon.acceptsAmmo;
    if (!list || !list.length) return null;
    return list[Math.floor(Math.random() * list.length)];
}

function resolveSpareAmmoSpec(weapon, ammoIdx) {
    if (!weapon) return { name: 'Mag', cap: 8, ammoIdx: null };

    const idx = (ammoIdx != null && ammoIdx !== '') ? ammoIdx : pickAmmoPlIndex(weapon);

    if (idx != null && typeof PL_AMMO_DATA !== 'undefined' && PL_AMMO_DATA[idx]) {
        const a = PL_AMMO_DATA[idx];
        return {
            name: a.name,
            cap: a.magCap || weapon.magCap || weapon.cap || 8,
            ammoIdx: idx,
            malfMod: a.malfMod
        };
    }

    const plKey = idx != null ? 'pl_' + idx : null;
    const ammoWpn = plKey && typeof WPNS !== 'undefined' ? WPNS[plKey] : null;
    if (ammoWpn && ammoWpn.name) {
        return {
            name: ammoWpn.name,
            cap: ammoWpn.magCap || weapon.magCap || weapon.cap || 8,
            ammoIdx: idx
        };
    }

    const compat = weapon.plCompat || (weapon.code && typeof WPNS !== 'undefined' && WPNS[weapon.code] && WPNS[weapon.code].plCompat);
    const label = compat && compat.plAmmoLabel;
    if (label) {
        const short = String(label).split(/[（(,／/]/)[0].trim();
        if (short && !/^(仮|非装填|補助|m8_rocket|flame)/.test(short) && short.length < 40) {
            return { name: short, cap: weapon.magCap || weapon.cap || 8, ammoIdx: idx };
        }
    }

    if (weapon.magName) return { name: weapon.magName, cap: weapon.cap || 8, ammoIdx: idx };

    const cat = weapon.plCategory;
    const byCat = { rifle: 'Clip', carbine: 'Clip', sniper: 'Clip', smg: 'Mag', mg: 'Belt', pistol: 'Mag', auto_rifle: 'Mag' };
    return { name: byCat[cat] || 'Mag', cap: weapon.cap || 8, ammoIdx: idx };
}

function buildSpareAmmoItem(weapon, ammoIdx) {
    const spec = resolveSpareAmmoSpec(weapon, ammoIdx);
    const mag = {
        type: 'ammo',
        name: spec.name,
        ammoFor: weapon.code,
        cap: spec.cap,
        current: spec.cap,
        jam: weapon.jam,
        code: 'mag'
    };
    if (spec.ammoIdx != null) mag.cbeNameIndex = spec.ammoIdx;
    if (spec.malfMod != null && weapon.jam != null) mag.jam = (weapon.jam || 0) + spec.malfMod;
    return mag;
}

/** 既存バッグ弾の汎用名（Mag/Clip）を可能なら弾種名へ更新 */
function refreshAmmoItemLabel(item, weapon) {
    if (!item || item.type !== 'ammo' || item.code !== 'mag') return;
    if (!weapon && item.ammoFor && typeof WPNS !== 'undefined') weapon = WPNS[item.ammoFor];
    if (!weapon) return;

    const generic = /^(Mag|Clip|Belt)$/i.test((item.name || '').trim());
    const allowed = weapon.acceptsAmmo;
    const idxValid = item.cbeNameIndex == null || !allowed || !allowed.length || allowed.includes(item.cbeNameIndex);
    if (!generic && idxValid && item.cbeNameIndex != null && typeof PL_AMMO_DATA !== 'undefined' && PL_AMMO_DATA[item.cbeNameIndex]) {
        const expected = PL_AMMO_DATA[item.cbeNameIndex].name;
        if (item.name === expected) return;
    }

    const spec = resolveSpareAmmoSpec(weapon, idxValid ? item.cbeNameIndex : null);
    if (!generic && idxValid && item.name && item.name !== 'Mag' && item.name !== 'Clip') return;

    item.name = spec.name;
    if (spec.ammoIdx != null) item.cbeNameIndex = spec.ammoIdx;
    if (spec.cap) {
        item.cap = spec.cap;
        if (item.current == null || item.current > spec.cap) item.current = spec.cap;
    }
}

window.getWeaponAcceptsAmmoIndices = getWeaponAcceptsAmmoIndices;
window.isSpareAmmoCompatible = isSpareAmmoCompatible;
window.pickAmmoPlIndex = pickAmmoPlIndex;
window.resolveSpareAmmoSpec = resolveSpareAmmoSpec;
window.buildSpareAmmoItem = buildSpareAmmoItem;
window.refreshAmmoItemLabel = refreshAmmoItemLabel;

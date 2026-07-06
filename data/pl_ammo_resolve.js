/** 予備弾（type:ammo）の表示名・cap を PL_AMMO_DATA / 主兵装から解決 */

function getWeaponAcceptsAmmoIndices(weapon) {
    if (!weapon) return [];
    let indices = [];
    if (Array.isArray(weapon.acceptsAmmo) && weapon.acceptsAmmo.length) {
        indices = weapon.acceptsAmmo.slice();
    } else {
        const code = weapon.code;
        if (code && typeof WPNS !== 'undefined' && WPNS[code] && WPNS[code].acceptsAmmo) {
            indices = WPNS[code].acceptsAmmo.slice();
        } else {
            const compat = weapon.plCompat;
            if (compat && compat.acceptsAmmoPlIndices && compat.acceptsAmmoPlIndices.length) {
                indices = compat.acceptsAmmoPlIndices.slice();
            }
        }
    }
    return finalizeWeaponAmmoIndices(weapon, indices);
}

function getWeaponCbeIndex(weapon) {
    if (!weapon) return null;
    if (weapon.cbeNameIndex != null) return Number(weapon.cbeNameIndex);
    if (weapon.code && weapon.code.startsWith('pl_')) {
        const n = parseInt(weapon.code.slice(3), 10);
        return isNaN(n) ? null : n;
    }
    if (weapon.plCbeWeaponIndex != null) return Number(weapon.plCbeWeaponIndex);
    return null;
}

function isValidAmmoPlIndex(idx) {
    if (idx == null || idx === '') return false;
    const n = Number(idx);
    if (!Number.isFinite(n)) return false;
    if (typeof PL_AMMO_DATA !== 'undefined' && PL_AMMO_DATA[n]) return true;
    return false;
}

function filterValidAmmoIndices(indices) {
    const out = [];
    const seen = new Set();
    for (let i = 0; i < indices.length; i++) {
        const n = Number(indices[i]);
        if (!isValidAmmoPlIndex(n) || seen.has(n)) continue;
        seen.add(n);
        out.push(n);
    }
    return out;
}

function applyWeaponAmmoOverrides(weapon, indices) {
    const wi = getWeaponCbeIndex(weapon);
    const ov = (typeof window !== 'undefined' && window.PL_AMMO_WEAPON_OVERRIDES)
        ? window.PL_AMMO_WEAPON_OVERRIDES[wi] : null;
    if (ov && Array.isArray(ov.acceptsAmmoPlIndices) && ov.acceptsAmmoPlIndices.length) {
        return ov.acceptsAmmoPlIndices.slice();
    }
    return indices;
}

/** CBE u16[27] — PL 装填 UI 形状フィルタ（武器側） */
function getWeaponMagShapeFlag(weaponCbeIdx) {
    if (weaponCbeIdx == null) return null;
    const m = (typeof window !== 'undefined' && window.PL_CBE_MAG_SHAPE_WEAPONS)
        ? window.PL_CBE_MAG_SHAPE_WEAPONS : null;
    if (!m) return null;
    let v = m[weaponCbeIdx];
    if (v == null) v = m[String(weaponCbeIdx)];
    return v != null ? Number(v) : null;
}

/** CBE u16[27] — 弾薬行 */
function getAmmoMagShapeFlag(ammoPlIdx) {
    if (ammoPlIdx == null) return null;
    const m = (typeof window !== 'undefined' && window.PL_CBE_MAG_SHAPE_AMMO)
        ? window.PL_CBE_MAG_SHAPE_AMMO : null;
    if (!m) return null;
    let v = m[ammoPlIdx];
    if (v == null) v = m[String(ammoPlIdx)];
    return v != null ? Number(v) : null;
}

function isMagShapeFilterEnabled() {
    if (typeof window !== 'undefined' && window.FEATURE_PL_MAG_SHAPE_FILTER === false) return false;
    return !!(typeof window !== 'undefined' && window.PL_CBE_MAG_SHAPE_WEAPONS && window.PL_CBE_MAG_SHAPE_AMMO);
}

/**
 * PL 形状フィルタ: weapon.u27==65 なら全形状可、否则 weapon.u27==ammo.u27
 * @see docs/PL_AMMO_UI_FILTER.md
 */
function passesMagShapeFilter(weaponCbeIdx, ammoPlIdx) {
    if (!isMagShapeFilterEnabled()) return true;
    const ws = getWeaponMagShapeFlag(weaponCbeIdx);
    const as = getAmmoMagShapeFlag(ammoPlIdx);
    if (ws == null || as == null) return true;
    const drum = (typeof window !== 'undefined' && window.PL_CBE_MAG_SHAPE_DRUM_RECEIVER != null)
        ? Number(window.PL_CBE_MAG_SHAPE_DRUM_RECEIVER) : 65;
    if (ws === drum) return true;
    return ws === as;
}

function applyMagShapeFilter(weapon, indices) {
    if (!isMagShapeFilterEnabled() || !indices || !indices.length) return indices;
    const wi = getWeaponCbeIndex(weapon);
    if (wi == null) return indices;
    const ov = (typeof window !== 'undefined' && window.PL_AMMO_WEAPON_OVERRIDES)
        ? window.PL_AMMO_WEAPON_OVERRIDES[wi] : null;
    if (ov && ov.skipMagShapeFilter) return indices;
    return indices.filter(function (ai) { return passesMagShapeFilter(wi, ai); });
}

function isMagCapFilterEnabled() {
    if (typeof window !== 'undefined' && window.FEATURE_PL_MAG_CAP_FILTER === false) return false;
    return true;
}

function isMissionPoolCapFilterEnabled() {
    if (typeof window !== 'undefined' && window.FEATURE_PL_MISSION_POOL_CAP_FILTER === false) return false;
    return !!(typeof window !== 'undefined' && window.PL_CBE_MISSION_POOL);
}

function getMissionPoolIndices(weaponCbeIdx) {
    if (weaponCbeIdx == null) return null;
    const m = (typeof window !== 'undefined' && window.PL_CBE_MISSION_POOL)
        ? window.PL_CBE_MISSION_POOL : null;
    if (!m) return null;
    const row = m[weaponCbeIdx] || m[String(weaponCbeIdx)];
    return Array.isArray(row) && row.length ? row.slice() : null;
}

function weaponHasMissionPool(weapon) {
    const wi = getWeaponCbeIndex(weapon);
    const pool = getMissionPoolIndices(wi);
    return !!(pool && pool.length);
}

/** seg132 / DS:0x270 相当 — pool 登録武器は L1 列を起点（ST マスタより優先） */
function mergeMissionPoolIndices(weapon, indices) {
    if (!isMissionPoolCapFilterEnabled()) return indices;
    const pool = getMissionPoolIndices(getWeaponCbeIndex(weapon));
    if (!pool || !pool.length) return indices;
    return pool.slice();
}

/** 4240C / 38814 相当 — cat18 で pack cap ≠ 武器 cap を drop（pool 登録武器のみ） */
function applyMissionPoolCapFilter(weapon, indices) {
    if (!isMissionPoolCapFilterEnabled() || !indices || !indices.length) return indices;
    if (!weaponHasMissionPool(weapon)) return indices;
    const wcap = getWeaponMagCap(weapon);
    if (wcap == null) return indices;
    const out = [];
    const seen = {};
    for (let i = 0; i < indices.length; i++) {
        const ai = Number(indices[i]);
        if (getCbeItemCategory(ai) !== 18) {
            if (!seen[ai]) { seen[ai] = true; out.push(ai); }
            continue;
        }
        const acap = getAmmoMagCapFromData(ai);
        if (acap === wcap && !seen[ai]) {
            seen[ai] = true;
            out.push(ai);
        }
    }
    return out.length ? out : indices;
}

function getWeaponMagCap(weapon) {
    if (!weapon) return null;
    if (weapon.magCap != null) return Number(weapon.magCap);
    if (weapon.cap != null) return Number(weapon.cap);
    return null;
}

function getAmmoMagCapFromData(ammoIdx) {
    if (typeof PL_AMMO_DATA === 'undefined' || !PL_AMMO_DATA[ammoIdx]) return null;
    const c = PL_AMMO_DATA[ammoIdx].magCap;
    return c != null ? Number(c) : null;
}

function ammoNamePrefix(name) {
    if (!name) return '';
    const i = String(name).lastIndexOf('-');
    return i > 0 ? String(name).slice(0, i) : String(name);
}

function findMagCapSubstitute(wi, ai, wcap) {
    if (wcap == null || typeof PL_AMMO_DATA === 'undefined') return null;
    const prefix = ammoNamePrefix(resolveAmmoNameByIndex(ai));
    let exactPrefix = null;
    let exactU27 = null;
    let minusOne = null;
    for (const key in PL_AMMO_DATA) {
        if (!Object.prototype.hasOwnProperty.call(PL_AMMO_DATA, key)) continue;
        const idx = Number(key);
        if (!passesCategoryLoadFilter(idx)) continue;
        if (!passesMagShapeFilter(wi, idx)) continue;
        const cap = getAmmoMagCapFromData(idx);
        const nm = PL_AMMO_DATA[key].name || '';
        if (cap === wcap) {
            exactU27 = exactU27 == null ? idx : Math.min(exactU27, idx);
            if (prefix && nm.indexOf(prefix) === 0) {
                exactPrefix = exactPrefix == null ? idx : Math.min(exactPrefix, idx);
            }
        }
        if (prefix && nm.indexOf(prefix) === 0 && /-1$/.test(nm)) minusOne = idx;
    }
    if (exactPrefix != null) return exactPrefix;
    if (minusOne != null) return minusOne;
    return exactU27;
}

/** 武器装填数 vs 弾 pack — u27 クラスタ内置換（複数 cat18 弾種はそのまま） */
function applyMagCapSubstitute(weapon, indices) {
    if (!isMagCapFilterEnabled() || !indices || !indices.length) return indices;
    if (isMissionPoolCapFilterEnabled() && weaponHasMissionPool(weapon)) return indices;
    const wi = getWeaponCbeIndex(weapon);
    const wcap = getWeaponMagCap(weapon);
    if (wi == null || wcap == null) return indices;
    const cat18 = indices.filter(function (ai) {
        return getCbeItemCategory(ai) === 18;
    });
    const caps = {};
    for (let i = 0; i < cat18.length; i++) {
        const c = getAmmoMagCapFromData(cat18[i]);
        if (c != null) caps[c] = true;
    }
    const capKeys = Object.keys(caps);
    const multiCapOptions = cat18.length > 1 && capKeys.length > 1;

    const out = [];
    const seen = {};
    for (let i = 0; i < indices.length; i++) {
        let ai = Number(indices[i]);
        if (getCbeItemCategory(ai) !== 18) {
            if (!seen[ai]) { seen[ai] = true; out.push(ai); }
            continue;
        }
        const acap = getAmmoMagCapFromData(ai);
        if (acap != null && wcap != null && acap > wcap && !multiCapOptions) {
            const sub = findMagCapSubstitute(wi, ai, wcap);
            if (sub != null) ai = sub;
        }
        if (!seen[ai]) { seen[ai] = true; out.push(ai); }
    }
    return out;
}

/** CBE u16[1] category_code — 第2フィルタ */
function getCbeItemCategory( idx) {
    if (idx == null) return null;
    const m = (typeof window !== 'undefined' && window.PL_CBE_ITEM_CATEGORIES)
        ? window.PL_CBE_ITEM_CATEGORIES : null;
    if (!m) return null;
    const row = m[idx] || m[String(idx)];
    return row && row.cat != null ? Number(row.cat) : null;
}

function getCbeItemCategoryInfo(idx) {
    if (idx == null) return null;
    const m = (typeof window !== 'undefined' && window.PL_CBE_ITEM_CATEGORIES)
        ? window.PL_CBE_ITEM_CATEGORIES : null;
    if (!m) return null;
    return m[idx] || m[String(idx)] || null;
}

function isCategoryLoadFilterEnabled() {
    if (typeof window !== 'undefined' && window.FEATURE_PL_CATEGORY_FILTER === false) return false;
    return !!(typeof window !== 'undefined' && window.PL_CBE_ITEM_CATEGORIES);
}

/**
 * PL 第2フィルタ: category_code==18 (ammo) のみ主装填候補。
 * Messer(24)・擲弾(19)・手榴(20) 等は ammo_indices にあっても除外。
 * @see docs/PL_SLOT_FILTER.md
 */
function passesCategoryLoadFilter(ammoPlIdx) {
    if (!isCategoryLoadFilterEnabled()) return true;
    const cat = getCbeItemCategory(ammoPlIdx);
    if (cat == null) return isValidAmmoPlIndex(ammoPlIdx);
    const loadable = (typeof window !== 'undefined' && window.PL_CBE_LOADABLE_AMMO_CATEGORY != null)
        ? Number(window.PL_CBE_LOADABLE_AMMO_CATEGORY) : 18;
    return cat === loadable;
}

function applyCategoryLoadFilter(indices) {
    if (!isCategoryLoadFilterEnabled() || !indices || !indices.length) return indices;
    return indices.filter(passesCategoryLoadFilter);
}

/** CBE 正本 intersect — pl_cbe_weapon_ammo_canonical.js */
function isCanonicalAmmoFilterEnabled() {
    if (typeof window !== 'undefined' && window.FEATURE_PL_CANONICAL_AMMO_FILTER === false) return false;
    return !!(typeof window !== 'undefined' && window.PL_CBE_WEAPON_AMMO_CANONICAL);
}

function getCanonicalAmmoIndices(weaponCbeIdx) {
    if (weaponCbeIdx == null) return null;
    const m = (typeof window !== 'undefined' && window.PL_CBE_WEAPON_AMMO_CANONICAL)
        ? window.PL_CBE_WEAPON_AMMO_CANONICAL : null;
    if (!m) return null;
    const row = m[weaponCbeIdx] || m[String(weaponCbeIdx)];
    return Array.isArray(row) && row.length ? row.slice() : null;
}

function applyCanonicalAmmoFilter(weapon, indices) {
    if (!isCanonicalAmmoFilterEnabled() || !indices || !indices.length) return indices;
    if (isMissionPoolCapFilterEnabled() && weaponHasMissionPool(weapon)) return indices;
    const wi = getWeaponCbeIndex(weapon);
    if (wi == null) return indices;
    const ov = (typeof window !== 'undefined' && window.PL_AMMO_WEAPON_OVERRIDES)
        ? window.PL_AMMO_WEAPON_OVERRIDES[wi] : null;
    if (ov && ov.skipCanonicalFilter) return indices;
    const canonical = getCanonicalAmmoIndices(wi);
    if (!canonical || !canonical.length) return indices;
    const allowed = new Set(canonical.map(Number));
    const filtered = indices.filter(function (ai) { return allowed.has(Number(ai)); });
    if (filtered.length > 0) return filtered;
    if (indices.length > canonical.length) return canonical.slice();
    return indices;
}

/** 武器の付属スロット（cat!=18）— 銃剣・擲弾・手榴等 */
function getWeaponAuxSlotRefs(weapon) {
    const wi = getWeaponCbeIndex(weapon);
    if (wi == null || typeof window.PL_CBE_WEAPON_SLOTS === 'undefined') return [];
    const slots = window.PL_CBE_WEAPON_SLOTS[wi] || window.PL_CBE_WEAPON_SLOTS[String(wi)];
    if (!slots || !slots.length) return [];
    const loadable = (typeof window !== 'undefined' && window.PL_CBE_LOADABLE_AMMO_CATEGORY != null)
        ? Number(window.PL_CBE_LOADABLE_AMMO_CATEGORY) : 18;
    return slots.filter(function (s) { return s && s.cat !== loadable; });
}

/** u26 弾薬箱リンク — pl_composite_links.js */
function getCompositeU26Link(weaponCbeIdx) {
    if (weaponCbeIdx == null) return null;
    const m = (typeof window !== 'undefined' && window.PL_COMPOSITE_U26)
        ? window.PL_COMPOSITE_U26 : null;
    if (!m) return null;
    return m[weaponCbeIdx] || m[String(weaponCbeIdx)] || null;
}

function getCompositeBoxInnerRaw(boxIdx) {
    if (boxIdx == null) return [];
    const m = (typeof window !== 'undefined' && window.PL_COMPOSITE_BOXES)
        ? window.PL_COMPOSITE_BOXES : null;
    if (!m) return [];
    const row = m[boxIdx] || m[String(boxIdx)];
    if (!row || !Array.isArray(row.inner)) return [];
    return row.inner.slice();
}

function isCompositeAmmoExpansionEnabled() {
    if (typeof window !== 'undefined' && window.FEATURE_PL_COMPOSITE_AMMO === false) return false;
    return !!(typeof window !== 'undefined' && window.PL_COMPOSITE_U26);
}

/**
 * MG 等: u26→PatrK15 等 ammo_box の内包弾帯を acceptsAmmo に union。
 * @see docs/PL_WEAPON_COMPOSITE_LINK.md
 */
function applyCompositeAmmoExpansion(weapon, indices) {
    if (!isCompositeAmmoExpansionEnabled() || !indices) return indices;
    const wi = getWeaponCbeIndex(weapon);
    if (wi == null) return indices;
    const link = getCompositeU26Link(wi);
    if (!link || link.kind !== 'ammo_box') return indices;
    let inner = Array.isArray(link.inner) ? link.inner.slice() : getCompositeBoxInnerRaw(link.idx);
    inner = applyCategoryLoadFilter(inner);
    inner = filterValidAmmoIndices(inner);
    inner = applyMagShapeFilter(weapon, inner);
    if (!inner.length) return indices;
    const out = indices.slice();
    const seen = new Set(out.map(Number));
    for (let i = 0; i < inner.length; i++) {
        const ai = Number(inner[i]);
        if (seen.has(ai)) continue;
        seen.add(ai);
        out.push(ai);
    }
    return out;
}

/** 複合装備メタ（主弾 / u26 箱 / 箱内）— UI 向け */
function getWeaponCompositeLoadout(weapon) {
    const wi = getWeaponCbeIndex(weapon);
    if (wi == null) return null;
    const link = getCompositeU26Link(wi);
    const aux = getWeaponAuxSlotRefs(weapon);
    const compat = getWeaponAuxCompat(wi);
    return {
        weaponIdx: wi,
        u26: link ? { idx: link.idx, kind: link.kind, name: link.name || null } : null,
        boxInner: link && link.kind === 'ammo_box'
            ? filterValidAmmoIndices(applyCategoryLoadFilter(link.inner || getCompositeBoxInnerRaw(link.idx)))
            : [],
        auxSlots: aux,
        tripodCbe: compat ? compat.tripodCbe : null,
        ammoBoxCbe: compat ? compat.ammoBoxCbe : null,
        opticCbe: compat ? compat.opticCbe : null
    };
}

/** @ 0x422B8 — 副装備互換（col1 弾薬箱 / col2 三脚 / col3 観測鏡） */
function getWeaponAuxCompat(weaponCbeIdx) {
    if (weaponCbeIdx == null || typeof window.PL_CBE_AUX_COMPAT === 'undefined') return null;
    const m = window.PL_CBE_AUX_COMPAT;
    return m[weaponCbeIdx] || m[String(weaponCbeIdx)] || null;
}

function getTripodCbeForWeapon(weapon) {
    const wi = getWeaponCbeIndex(weapon);
    if (wi == null) return null;
    const row = getWeaponAuxCompat(wi);
    if (row && row.tripodCbe != null) return Number(row.tripodCbe);
    const tmap = (typeof window !== 'undefined' && window.PL_CBE_TRIPOD_FOR_WEAPON)
        ? window.PL_CBE_TRIPOD_FOR_WEAPON : null;
    if (!tmap) return null;
    const v = tmap[wi] || tmap[String(wi)];
    return v != null ? Number(v) : null;
}

/**
 * 422B8 簡約: 主武器 + 副装備 cbe index が装備列と整合するか。
 * @param {string} columnKind weapon|ammo_box|tripod|optic
 */
function isAuxEquipCompatibleWithWeapon(weapon, auxCbeIdx, columnKind) {
    const wi = getWeaponCbeIndex(weapon);
    if (wi == null || auxCbeIdx == null) return false;
    const aux = Number(auxCbeIdx);
    const row = getWeaponAuxCompat(wi);
    const link = getCompositeU26Link(wi);
    const kind = columnKind || 'other';

    if (kind === 'ammo_box' || kind === 'col1') {
        if (row && row.ammoBoxCbe != null) return aux === Number(row.ammoBoxCbe);
        if (link && link.kind === 'ammo_box') return aux === Number(link.idx);
        return false;
    }
    if (kind === 'tripod' || kind === 'col2') {
        const trip = getTripodCbeForWeapon(weapon);
        return trip != null && aux === trip;
    }
    if (kind === 'optic' || kind === 'col3') {
        if (row && row.opticCbe != null) return aux === Number(row.opticCbe);
        if (link && link.kind === 'optic') return aux === Number(link.idx);
        return false;
    }
    if (kind === 'weapon' || kind === 'col0') {
        return getWeaponAcceptsAmmoIndices(weapon).includes(aux);
    }
    if (link && link.kind === 'ammo_box' && aux === Number(link.idx)) return true;
    if (link && link.kind === 'optic' && aux === Number(link.idx)) return true;
    const auxRefs = getWeaponAuxSlotRefs(weapon);
    return auxRefs.some(function (s) { return s && Number(s.ref) === aux; });
}

function finalizeWeaponAmmoIndices(weapon, indices) {
    let out = applyWeaponAmmoOverrides(weapon, indices);
    out = applyCanonicalAmmoFilter(weapon, out);
    out = mergeMissionPoolIndices(weapon, out);
    out = applyCategoryLoadFilter(out);
    out = filterValidAmmoIndices(out);
    out = applyMagShapeFilter(weapon, out);
    out = applyMissionPoolCapFilter(weapon, out);
    out = applyMagCapSubstitute(weapon, out);
    out = applyCompositeAmmoExpansion(weapon, out);
    return out;
}

function getAmmoIndexOverride(ammoIdx) {
    const ov = (typeof window !== 'undefined' && window.PL_AMMO_INDEX_OVERRIDES)
        ? window.PL_AMMO_INDEX_OVERRIDES[ammoIdx] : null;
    return ov || null;
}

function resolveWeaponNameByCbeIndex(wi) {
    const code = 'pl_' + wi;
    if (typeof WPNS !== 'undefined' && WPNS[code] && WPNS[code].name) {
        return String(WPNS[code].name).replace(/\s+/g, ' ').trim();
    }
    return null;
}

function formatAmmoIndexLine(idx) {
    const name = resolveAmmoNameByIndex(idx);
    if (!name) return null;
    const row = (typeof PL_AMMO_DATA !== 'undefined') ? PL_AMMO_DATA[idx] : null;
    const pack = row && row.magCap;
    return pack ? (name + ' (' + pack + '発/パック)') : name;
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
    const wcap = getWeaponMagCap(weapon);
    if (wcap != null && typeof PL_AMMO_DATA !== 'undefined') {
        for (let i = 0; i < list.length; i++) {
            const cap = getAmmoMagCapFromData(list[i]);
            if (cap === wcap) return list[i];
        }
    }
    return list[0];
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

function syncWeaponAcceptsAmmo(weapon) {
    if (!weapon || !weapon.code) return weapon;
    const master = typeof WPNS !== 'undefined' ? WPNS[weapon.code] : null;
    if (master && Array.isArray(master.acceptsAmmo) && master.acceptsAmmo.length) {
        weapon.acceptsAmmo = finalizeWeaponAmmoIndices(weapon, master.acceptsAmmo.slice());
    } else if (Array.isArray(weapon.acceptsAmmo)) {
        weapon.acceptsAmmo = finalizeWeaponAmmoIndices(weapon, weapon.acceptsAmmo.slice());
    }
    return weapon;
}

function spareMagHasRounds(item) {
    return item && (item.current == null || item.current > 0);
}

/**
 * 主兵装に装填可能な予備弾を LOADOUT(hands[1-2]) → バックパック の順で検索
 * @returns {{where:'main'|'bag',index:number,item:Object}|null}
 */
function findCompatibleSpareMagSlot(unit, weapon) {
    if (!unit || !weapon) return null;
    const w = syncWeaponAcceptsAmmo(weapon);
    for (let i = 1; i < 3; i++) {
        const item = unit.hands && unit.hands[i];
        if (spareMagHasRounds(item) && isSpareAmmoCompatible(w, item)) {
            return { where: 'main', index: i, item };
        }
    }
    if (unit.bag) {
        for (let bi = 0; bi < unit.bag.length; bi++) {
            const item = unit.bag[bi];
            if (spareMagHasRounds(item) && isSpareAmmoCompatible(w, item)) {
                return { where: 'bag', index: bi, item };
            }
        }
    }
    return null;
}

function clearSpareMagSlot(unit, where, index) {
    if (!unit) return;
    if (where === 'main') unit.hands[index] = null;
    else unit.bag[index] = null;
}

function countCompatibleSpareMags(unit, weapon) {
    if (!unit || !weapon) return 0;
    const w = syncWeaponAcceptsAmmo(weapon);
    let n = 0;
    for (let i = 1; i < 3; i++) {
        const item = unit.hands && unit.hands[i];
        if (spareMagHasRounds(item) && isSpareAmmoCompatible(w, item)) n++;
    }
    if (unit.bag) {
        n += unit.bag.filter(it => it && spareMagHasRounds(it) && isSpareAmmoCompatible(w, it)).length;
    }
    return n;
}

/** 予備弾マガジンを消費して主兵装へ装填（全銃種共通） */
function applySpareMagToPrimary(primary, weapon, mag) {
    if (!primary || !mag) return;
    const w = syncWeaponAcceptsAmmo(weapon || primary);
    if (typeof PlMgTripod !== 'undefined' && PlMgTripod.usesBeltReserve(w.code) && primary.reserve !== undefined) {
        const beltRounds = mag.cap || mag.current || 50;
        primary.reserve = (primary.reserve || 0) + beltRounds;
        const fill = Math.min(primary.cap || w.cap || 50, primary.reserve);
        primary.current = fill;
        primary.reserve = Math.max(0, primary.reserve - fill);
        return;
    }
    const gunCap = primary.cap || w.cap || 1;
    const fromMag = mag.cap != null ? mag.cap : gunCap;
    primary.current = Math.min(gunCap, fromMag);
}

function findMortarShellTotal(unit) {
    let total = 0;
    const add = (i) => {
        if (i && i.code === 'mortar_shell_box') total += (i.current || 0);
    };
    (unit.bag || []).forEach(add);
    (unit.hands || []).forEach(add);
    return total;
}

function sanitizeAmmoSlot(unit, weapon, where, index) {
    const item = where === 'main' ? unit.hands[index] : unit.bag[index];
    if (!item || item.type !== 'ammo') return;
    if (!isSpareAmmoCompatible(weapon, item)) {
        if (where === 'main') unit.hands[index] = null;
        else unit.bag[index] = null;
    } else {
        refreshAmmoItemLabel(item, weapon);
    }
}

/** LOADOUT＋バックパックの予備弾を主兵装 acceptsAmmo に合わせて整理 */
function sanitizeUnitSpareAmmo(unit) {
    if (!unit || !unit.hands || !unit.hands[0] || unit.def?.isTank) return;
    const w = syncWeaponAcceptsAmmo(unit.hands[0]);
    if (!w.code || w.type !== 'bullet') return;

    if (!unit.bag) unit.bag = [];
    while (unit.bag.length < 4) unit.bag.push(null);

    for (let i = 1; i < 3; i++) sanitizeAmmoSlot(unit, w, 'main', i);
    for (let i = 0; i < unit.bag.length; i++) sanitizeAmmoSlot(unit, w, 'bag', i);

    const want = Math.min(4, (w.mag || 2) + 1);
    let have = countCompatibleSpareMags(unit, w);
    for (; have < want; have++) {
        let slot = unit.bag.findIndex(x => !x);
        if (slot < 0 && unit.bag.length < 4) {
            unit.bag.push(null);
            slot = unit.bag.length - 1;
        }
        if (slot < 0) break;
        unit.bag[slot] = buildSpareAmmoItem(w);
    }
}

function sanitizeUnitBagAmmo(unit) {
    sanitizeUnitSpareAmmo(unit);
}

/** PL 弾種 index → 表示名（PL_AMMO_DATA 正本 + 紛らわしい名称ヒント） */
function resolveAmmoNameByIndex(cbeIndex) {
    if (cbeIndex == null || cbeIndex === '') return null;
    const idx = Number(cbeIndex);
    if (!Number.isFinite(idx)) return null;
    const hints = (typeof window !== 'undefined' && window.PL_AMMO_DISPLAY_HINTS)
        ? window.PL_AMMO_DISPLAY_HINTS : null;
    const hint = hints && (hints[idx] || hints[String(idx)]);
    if (hint && hint.displayName) return hint.displayName;
    if (typeof PL_AMMO_DATA !== 'undefined' && PL_AMMO_DATA[idx] && PL_AMMO_DATA[idx].name) {
        return PL_AMMO_DATA[idx].name;
    }
    const plKey = 'pl_' + idx;
    if (typeof WPNS !== 'undefined' && WPNS[plKey] && WPNS[plKey].name) {
        return WPNS[plKey].name;
    }
    return null;
}

function findAmmoIndexByName(name) {
    if (!name || typeof PL_AMMO_DATA === 'undefined') return null;
    const n = String(name).trim();
    for (const k of Object.keys(PL_AMMO_DATA)) {
        if (PL_AMMO_DATA[k].name === n) return Number(k);
    }
    return null;
}

function isLoadoutCompatWeaponEntry(w) {
    if (!w || w.partType) return false;
    if (w.type === 'part' || w.type === 'melee') return false;
    return getWeaponAcceptsAmmoIndices(w).length > 0;
}

let weaponsByAmmoIndexCache = null;

function invalidateWeaponsByAmmoIndexCache() {
    weaponsByAmmoIndexCache = null;
}

function getWeaponsByAmmoIndexCache() {
    if (weaponsByAmmoIndexCache) return weaponsByAmmoIndexCache;
    weaponsByAmmoIndexCache = {};
    if (typeof WPNS === 'undefined') return weaponsByAmmoIndexCache;
    for (const code of Object.keys(WPNS)) {
        const w = WPNS[code];
        if (!isLoadoutCompatWeaponEntry(w)) continue;
        const base = Object.assign({}, w, { code: code });
        const indices = getWeaponAcceptsAmmoIndices(base);
        const wname = String(w.name || code).replace(/\s+/g, ' ').trim();
        for (let i = 0; i < indices.length; i++) {
            const idx = indices[i];
            if (!weaponsByAmmoIndexCache[idx]) weaponsByAmmoIndexCache[idx] = [];
            if (weaponsByAmmoIndexCache[idx].indexOf(wname) < 0) {
                weaponsByAmmoIndexCache[idx].push(wname);
            }
        }
    }
    for (const k of Object.keys(weaponsByAmmoIndexCache)) {
        weaponsByAmmoIndexCache[k].sort(function (a, b) { return a.localeCompare(b); });
    }
    return weaponsByAmmoIndexCache;
}

function getCompatibleWeaponNamesForAmmo(ammoItem) {
    if (!ammoItem) return [];
    let idx = ammoItem.cbeNameIndex;
    if (idx == null && ammoItem.name) idx = findAmmoIndexByName(ammoItem.name);
    if (idx == null) return [];
    idx = Number(idx);
    const ammoOv = getAmmoIndexOverride(idx);
    if (ammoOv && Array.isArray(ammoOv.weaponCbeIndices) && ammoOv.weaponCbeIndices.length) {
        const names = [];
        for (let i = 0; i < ammoOv.weaponCbeIndices.length; i++) {
            const n = resolveWeaponNameByCbeIndex(ammoOv.weaponCbeIndices[i]);
            if (n && names.indexOf(n) < 0) names.push(n);
        }
        return names.sort(function (a, b) { return a.localeCompare(b); });
    }
    const cache = getWeaponsByAmmoIndexCache();
    return (cache[idx] || []).slice();
}

/** 主兵装・副装備スロット向け: acceptsAmmo に基づく弾種名一覧 */
function getCompatibleAmmoNamesForWeapon(weapon) {
    if (!weapon) return [];
    const base = (weapon.code && typeof WPNS !== 'undefined' && WPNS[weapon.code])
        ? Object.assign({}, WPNS[weapon.code], weapon) : weapon;
    syncWeaponAcceptsAmmo(base);
    const indices = getWeaponAcceptsAmmoIndices(base);
    const names = [];
    const seen = new Set();
    for (let i = 0; i < indices.length; i++) {
        const n = resolveAmmoNameByIndex(indices[i]);
        if (n && !seen.has(n)) {
            seen.add(n);
            names.push(n);
        }
    }
    return names;
}

/** ホバー用: 弾種行（パック発数付き） */
function getCompatibleAmmoLinesForWeapon(weapon) {
    if (!weapon) return [];
    const base = (weapon.code && typeof WPNS !== 'undefined' && WPNS[weapon.code])
        ? Object.assign({}, WPNS[weapon.code], weapon) : weapon;
    syncWeaponAcceptsAmmo(base);
    const indices = getWeaponAcceptsAmmoIndices(base);
    const lines = [];
    const seen = new Set();
    for (let i = 0; i < indices.length; i++) {
        const line = formatAmmoIndexLine(indices[i]);
        if (line && !seen.has(line)) {
            seen.add(line);
            lines.push(line);
        }
    }
    return lines;
}

function isLoadoutAmmoItem(item) {
    return !!(item && (item.type === 'ammo' || item.code === 'mag' || item.code === 'mortar_shell_box'));
}

function isLoadoutWeaponItem(item) {
    if (!item || item.partType) return false;
    if (isLoadoutAmmoItem(item)) return false;
    return getCompatibleAmmoNamesForWeapon(item).length > 0;
}

/** 付属スロット category — プレイヤー向け（内部 catName は開発用） */
function formatAuxSlotCatLabel(slot) {
    if (!slot) return '';
    const labels = {
        bayonet_knife: '銃剣',
        rifle_grenade: '擲弾',
        hand_grenade: '手榴',
        smoke: '発煙',
        smoke_grenade: '発煙',
        grenade_launcher_ammo: '擲弾',
        ammo_box: '弾薬箱',
        tripod: '三脚',
        mounted_weapon: '固定火器',
    };
    const cn = slot.catName;
    if (cn && labels[cn]) return labels[cn];
    if (slot.cat === 24) return '銃剣';
    if (slot.cat === 19) return '擲弾';
    if (slot.cat === 20) return '手榴';
    return cn || String(slot.cat != null ? slot.cat : '');
}

/** LOADOUT ホバー用テキスト（武器→弾、弾→銃） */
function getLoadoutCompatTooltipText(item) {
    if (!item) return null;
    if (isLoadoutAmmoItem(item)) {
        const weapons = getCompatibleWeaponNamesForAmmo(item);
        if (!weapons.length) return null;
        let idx = item.cbeNameIndex;
        if (idx == null && item.name) idx = findAmmoIndexByName(item.name);
        let text = '適合銃:\n' + weapons.join('\n');
        const ammoOv = idx != null ? getAmmoIndexOverride(Number(idx)) : null;
        if (ammoOv && ammoOv.note) text += '\n\n' + ammoOv.note;
        return text;
    }
    if (isLoadoutWeaponItem(item)) {
        const ammoLines = getCompatibleAmmoLinesForWeapon(item);
        const aux = (typeof getWeaponAuxSlotRefs === 'function') ? getWeaponAuxSlotRefs(item) : [];
        if (!ammoLines.length && !aux.length) return null;
        let text = '';
        if (ammoLines.length) {
            text = '適合弾:\n' + ammoLines.join('\n');
        }
        if (aux.length) {
            const auxLines = aux.map(function (s) {
                return (s.name || '?') + ' (' + formatAuxSlotCatLabel(s) + ')';
            });
            text += (text ? '\n\n' : '') + '付属装備:\n' + auxLines.join('\n');
        }
        const chamber = item.magCap != null ? item.magCap : item.cap;
        if (chamber != null && chamber > 0) {
            text += '\n\n銃内装弾: ' + chamber + '発';
        }
        return text || null;
    }
    return null;
}

function ensureLoadoutTooltipEl() {
    let el = document.getElementById('loadout-compat-tooltip');
    if (el) return el;
    if (!document.getElementById('loadout-compat-tooltip-style')) {
        const st = document.createElement('style');
        st.id = 'loadout-compat-tooltip-style';
        st.textContent = [
            '#loadout-compat-tooltip {',
            '  position: fixed; z-index: 100000; pointer-events: none;',
            '  max-width: 300px; max-height: 220px; overflow-y: auto;',
            '  padding: 6px 8px; background: rgba(12, 12, 18, 0.96);',
            '  border: 1px solid #666; color: #ddd; font-size: 11px; line-height: 1.4;',
            '  font-family: sans-serif; border-radius: 3px;',
            '  white-space: pre-wrap; box-shadow: 0 2px 10px rgba(0,0,0,0.55);',
            '}',
        ].join('\n');
        document.head.appendChild(st);
    }
    el = document.createElement('div');
    el.id = 'loadout-compat-tooltip';
    el.style.display = 'none';
    document.body.appendChild(el);
    return el;
}

function loadoutTooltipClientXY(pointerOrEvent) {
    if (!pointerOrEvent) return { x: 0, y: 0 };
    const ev = pointerOrEvent.event || pointerOrEvent;
    const x = (ev && ev.clientX != null) ? ev.clientX : (pointerOrEvent.clientX != null ? pointerOrEvent.clientX : pointerOrEvent.x);
    const y = (ev && ev.clientY != null) ? ev.clientY : (pointerOrEvent.clientY != null ? pointerOrEvent.clientY : pointerOrEvent.y);
    return { x: x + 14, y: y + 14 };
}

function showLoadoutCompatTooltip(pointerOrEvent, text) {
    if (!text) return;
    const el = ensureLoadoutTooltipEl();
    el.textContent = text;
    el.style.display = 'block';
    moveLoadoutCompatTooltip(pointerOrEvent);
}

function moveLoadoutCompatTooltip(pointerOrEvent) {
    const el = document.getElementById('loadout-compat-tooltip');
    if (!el || el.style.display === 'none') return;
    const pos = loadoutTooltipClientXY(pointerOrEvent);
    el.style.left = Math.min(pos.x, window.innerWidth - el.offsetWidth - 8) + 'px';
    el.style.top = Math.min(pos.y, window.innerHeight - el.offsetHeight - 8) + 'px';
}

function hideLoadoutCompatTooltip() {
    const el = document.getElementById('loadout-compat-tooltip');
    if (el) el.style.display = 'none';
}

function loadoutCompatTooltipAttrEscape(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/\n/g, '&#10;');
}

function loadoutCompatTooltipAttrUnescape(text) {
    return String(text).replace(/&#10;/g, '\n');
}

function showLoadoutCompatTooltipFromEl(el, ev) {
    if (!el) return;
    const raw = el.getAttribute('data-loadout-tip');
    if (!raw) return;
    showLoadoutCompatTooltip(ev, loadoutCompatTooltipAttrUnescape(raw));
}

window.getWeaponCompositeLoadout = getWeaponCompositeLoadout;
window.getWeaponAuxCompat = getWeaponAuxCompat;
window.getTripodCbeForWeapon = getTripodCbeForWeapon;
window.isAuxEquipCompatibleWithWeapon = isAuxEquipCompatibleWithWeapon;
window.getWeaponAcceptsAmmoIndices = getWeaponAcceptsAmmoIndices;
window.passesMagShapeFilter = passesMagShapeFilter;
window.isMagShapeFilterEnabled = isMagShapeFilterEnabled;
window.passesCategoryLoadFilter = passesCategoryLoadFilter;
window.isCategoryLoadFilterEnabled = isCategoryLoadFilterEnabled;
window.getWeaponAuxSlotRefs = getWeaponAuxSlotRefs;
window.getCbeItemCategoryInfo = getCbeItemCategoryInfo;
window.isSpareAmmoCompatible = isSpareAmmoCompatible;
window.syncWeaponAcceptsAmmo = syncWeaponAcceptsAmmo;
window.findCompatibleSpareMagSlot = findCompatibleSpareMagSlot;
window.clearSpareMagSlot = clearSpareMagSlot;
window.countCompatibleSpareMags = countCompatibleSpareMags;
window.applySpareMagToPrimary = applySpareMagToPrimary;
window.findMortarShellTotal = findMortarShellTotal;
window.sanitizeUnitSpareAmmo = sanitizeUnitSpareAmmo;
window.pickAmmoPlIndex = pickAmmoPlIndex;
window.resolveSpareAmmoSpec = resolveSpareAmmoSpec;
window.buildSpareAmmoItem = buildSpareAmmoItem;
window.refreshAmmoItemLabel = refreshAmmoItemLabel;
window.sanitizeUnitBagAmmo = sanitizeUnitBagAmmo;
window.resolveAmmoNameByIndex = resolveAmmoNameByIndex;
window.getCompatibleAmmoNamesForWeapon = getCompatibleAmmoNamesForWeapon;
window.getCompatibleAmmoLinesForWeapon = getCompatibleAmmoLinesForWeapon;
window.getCompatibleWeaponNamesForAmmo = getCompatibleWeaponNamesForAmmo;
window.getLoadoutCompatTooltipText = getLoadoutCompatTooltipText;
window.showLoadoutCompatTooltip = showLoadoutCompatTooltip;
window.moveLoadoutCompatTooltip = moveLoadoutCompatTooltip;
window.hideLoadoutCompatTooltip = hideLoadoutCompatTooltip;
window.showLoadoutCompatTooltipFromEl = showLoadoutCompatTooltipFromEl;
window.loadoutCompatTooltipAttrEscape = loadoutCompatTooltipAttrEscape;

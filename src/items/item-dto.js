/**
 * Item DTO — converts internal ParsedItem to a portable trade DTO.
 *
 * TradeItemDTO is the format sent to the backend for the trade system.
 */
import { getItemIconPath } from './item-icon.js';
import { serializeItem } from './item-serializer.js';
// ─── Public API ─────────────────────────────────────────────────
/**
 * Convert a parsed item to a TradeItemDTO.
 *
 * @param item      The parsed item.
 * @param allItems  All items dict (for socketed sub-item lookup and serialization).
 * @param gd        GameData instance.
 */
export function toTradeDTO(item, allItems, gd) {
    const baseEntry = gd.items[item.base];
    const base = baseEntry ? baseEntry : undefined;
    const { w, h } = getItemSize(base);
    // Resolve display name
    const displayName = resolveDisplayName(item, gd);
    // Build socketed sub-DTOs
    const socketedDTOs = [];
    if (item.socketedItems) {
        for (const sid of item.socketedItems) {
            const sockItem = allItems[sid];
            if (sockItem) {
                socketedDTOs.push(toTradeDTO(sockItem, allItems, gd));
            }
        }
    }
    // Serialize token
    const token = serializeItem(item, allItems, gd);
    return {
        token,
        baseCode: item.base,
        displayName,
        quality: item.quality,
        ilvl: item.ilvl,
        ethereal: item.ethereal,
        sockets: item.sockets,
        uniqueId: item.unique,
        width: w,
        height: h,
        iconPath: getItemIconPath(item, gd),
        stats: { ...item.stats },
        socketedItems: socketedDTOs,
    };
}
// ─── Helpers ────────────────────────────────────────────────────
/** Get item dimensions from base data. */
function getItemSize(base) {
    const w = base?.invwidth || 1;
    const h = base?.invheight || 1;
    return { w, h };
}
/** Resolve human-readable display name. */
function resolveDisplayName(item, gd) {
    // If item has an explicit name (rare/crafted)
    if (item.name)
        return item.name;
    // Unique/set/runeword items: look up in GameData
    if (item.unique) {
        const name = lookupName(item.unique, gd);
        if (name)
            return name;
    }
    // Fall back to base item name from locale
    const baseEntry = gd.items[item.base];
    const base = baseEntry ? baseEntry : undefined;
    const namestr = base?.namestr;
    if (namestr) {
        const localized = gd.locale.strings[namestr];
        if (localized)
            return localized;
        return namestr;
    }
    return item.base;
}
/** Look up an item name from the locale by its unique/set/runeword key. */
function lookupName(key, gd) {
    // Try direct locale lookup
    const direct = gd.locale.strings[key];
    if (direct)
        return direct;
    // Try uniqueItems / setItems tables if available
    const tables = ['uniqueItems', 'setItems'];
    for (const table of tables) {
        const dict = gd[table];
        if (dict?.[key]) {
            const nameStr = dict[key].namestr;
            if (nameStr) {
                const localized = gd.locale.strings[nameStr];
                if (localized)
                    return localized;
                return nameStr;
            }
        }
    }
    return null;
}
//# sourceMappingURL=item-dto.js.map
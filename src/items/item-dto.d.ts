/**
 * Item DTO — converts internal ParsedItem to a portable trade DTO.
 *
 * TradeItemDTO is the format sent to the backend for the trade system.
 */
import type { GameData } from '../game-data/game-data.js';
import type { BinaryParsedItem } from '../formats/item-parser.js';
/** Quality enum for trade DTO (matches internal quality values). */
export type ItemQuality = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
/** Trade item DTO — portable representation for the backend. */
export interface TradeItemDTO {
    /** Base64 token for full item reconstruction: `d2r1:<base64>` */
    token: string;
    /** 3-character item base code. */
    baseCode: string;
    /** Human-readable display name. */
    displayName: string;
    /** Item quality (1-9). */
    quality: ItemQuality;
    /** Item level. */
    ilvl: number;
    /** Is ethereal? */
    ethereal: boolean;
    /** Number of sockets (total, including filled). */
    sockets: number;
    /** Unique/set/runeword identifier. */
    uniqueId?: string;
    /** Width in grid cells. */
    width: number;
    /** Height in grid cells. */
    height: number;
    /** HD icon path key (for hditemlib.json lookup). */
    iconPath: string | null;
    /** Key stats for search/filtering. */
    stats: Record<string, number>;
    /** Socketed sub-items (runes/gems). */
    socketedItems: TradeItemDTO[];
}
/**
 * Convert a parsed item to a TradeItemDTO.
 *
 * @param item      The parsed item.
 * @param allItems  All items dict (for socketed sub-item lookup and serialization).
 * @param gd        GameData instance.
 */
export declare function toTradeDTO(item: BinaryParsedItem, allItems: Record<number | string, BinaryParsedItem>, gd: GameData): TradeItemDTO;
//# sourceMappingURL=item-dto.d.ts.map
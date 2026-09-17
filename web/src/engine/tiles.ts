/**
 * Tile identifiers and helpers.
 *
 * Standard tile kinds are indexed 0..33:
 *   0..8   characters (萬)  m1..m9
 *   9..17  dots (筒)        p1..p9
 *   18..26 bamboo (索)      s1..s9
 *   27..30 winds            E S W N
 *   31..33 dragons          C (red 中), F (green 發), P (white 白)
 * Bonus tiles are 34..41:
 *   34..37 flowers          f1..f4 (梅蘭菊竹, matched to E S W N seats)
 *   38..41 seasons          g1..g4 (春夏秋冬, matched to E S W N seats)
 */
export type TileId = number;

export const NUM_TILES = 34;
export const NUM_ALL = 42;

export const WIND_E = 27;
export const WIND_S = 28;
export const WIND_W = 29;
export const WIND_N = 30;
export const DRAGON_RED = 31;
export const DRAGON_GREEN = 32;
export const DRAGON_WHITE = 33;
export const FLOWER_BASE = 34;
export const SEASON_BASE = 38;

export const DRAGONS: TileId[] = [DRAGON_RED, DRAGON_GREEN, DRAGON_WHITE];
export const WINDS: TileId[] = [WIND_E, WIND_S, WIND_W, WIND_N];
export const TERMINALS_AND_HONORS: TileId[] = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

export type Suit = 'm' | 'p' | 's';
export const SUITS: Suit[] = ['m', 'p', 's'];
export const SUIT_BASE: Record<Suit, number> = { m: 0, p: 9, s: 18 };

export function isSuited(t: TileId): boolean { return t >= 0 && t < 27; }
export function isHonor(t: TileId): boolean { return t >= 27 && t < 34; }
export function isWind(t: TileId): boolean { return t >= 27 && t < 31; }
export function isDragon(t: TileId): boolean { return t >= 31 && t < 34; }
export function isBonus(t: TileId): boolean { return t >= 34 && t < 42; }
export function isFlower(t: TileId): boolean { return t >= 34 && t < 38; }
export function isSeason(t: TileId): boolean { return t >= 38 && t < 42; }
export function suitOf(t: TileId): Suit | null { return isSuited(t) ? SUITS[Math.floor(t / 9)] : null; }
/** 1..9 for suited tiles, 1..4 winds, 1..3 dragons, 1..4 flowers/seasons. */
export function rankOf(t: TileId): number {
  if (isSuited(t)) return (t % 9) + 1;
  if (isWind(t)) return t - 26;
  if (isDragon(t)) return t - 30;
  if (isFlower(t)) return t - 33;
  return t - 37;
}
export function isTerminal(t: TileId): boolean { return isSuited(t) && (t % 9 === 0 || t % 9 === 8); }
export function isTerminalOrHonor(t: TileId): boolean { return isTerminal(t) || isHonor(t); }
/** Seat index 0..3 (E S W N) that a flower/season tile belongs to, or -1. */
export function bonusSeat(t: TileId): number { return isBonus(t) ? (t - 34) % 4 : -1; }

export const TILE_CODES: string[] = [
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `m${n}`),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `p${n}`),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `s${n}`),
  'E', 'S', 'W', 'N', 'C', 'F', 'P',
  'f1', 'f2', 'f3', 'f4', 'g1', 'g2', 'g3', 'g4',
];

const ZH_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
export const TILE_NAMES_ZH: string[] = [
  ...ZH_NUM.map((z) => `${z}萬`),
  ...ZH_NUM.map((z) => `${z}筒`),
  ...ZH_NUM.map((z) => `${z}索`),
  '東', '南', '西', '北', '中', '發', '白',
  '梅', '蘭', '菊', '竹', '春', '夏', '秋', '冬',
];
export const TILE_NAMES_EN: string[] = [
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${n} Character`),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${n} Dot`),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${n} Bamboo`),
  'East', 'South', 'West', 'North', 'Red Dragon', 'Green Dragon', 'White Dragon',
  'Plum', 'Orchid', 'Chrysanthemum', 'Bamboo Flower', 'Spring', 'Summer', 'Autumn', 'Winter',
];
export const WIND_NAMES = ['East', 'South', 'West', 'North'];
export const WIND_NAMES_ZH = ['東', '南', '西', '北'];

export function tileFromCode(code: string): TileId {
  const i = TILE_CODES.indexOf(code);
  if (i < 0) throw new Error(`Unknown tile code: ${code}`);
  return i;
}

/**
 * Parse a compact hand string such as "123m 456p 77s EEE C" or "1m2m3m".
 * Digits followed by a suit letter (m/p/s) are suited tiles; E S W N C F P are honors;
 * f1..f4 / g1..g4 are flowers and seasons. Whitespace is ignored.
 */
export function parseHand(str: string): TileId[] {
  const out: TileId[] = [];
  let digits: number[] = [];
  const s = str.replace(/\s+/g, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch >= '1' && ch <= '9') { digits.push(Number(ch)); continue; }
    if (ch === 'm' || ch === 'p' || ch === 's') {
      if (digits.length === 0) throw new Error(`Suit letter without digits at ${i}`);
      for (const d of digits) out.push(SUIT_BASE[ch] + d - 1);
      digits = [];
      continue;
    }
    if (ch === 'f' || ch === 'g') {
      const d = Number(s[i + 1]);
      if (!(d >= 1 && d <= 4)) throw new Error(`Bad bonus tile at ${i}`);
      out.push((ch === 'f' ? FLOWER_BASE : SEASON_BASE) + d - 1);
      i++;
      continue;
    }
    const idx = 'ESWNCFP'.indexOf(ch);
    if (idx < 0) throw new Error(`Unknown tile char '${ch}' at ${i}`);
    out.push(27 + idx);
  }
  if (digits.length) throw new Error('Trailing digits without suit letter');
  return out;
}

export function handToString(tiles: TileId[]): string {
  return tiles.map((t) => TILE_CODES[t]).join(' ');
}

/** 34-length count vector of standard tiles (bonus tiles ignored). */
export function countsFrom(tiles: TileId[]): number[] {
  const c = new Array<number>(NUM_TILES).fill(0);
  for (const t of tiles) if (t < NUM_TILES) c[t]++;
  return c;
}

export function tilesFromCounts(c: number[]): TileId[] {
  const out: TileId[] = [];
  for (let i = 0; i < c.length; i++) for (let k = 0; k < c[i]; k++) out.push(i);
  return out;
}

export function sortTiles(tiles: TileId[]): TileId[] {
  return [...tiles].sort((a, b) => a - b);
}

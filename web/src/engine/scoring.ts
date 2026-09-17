/**
 * Hong Kong mahjong fan scoring for a complete hand.
 *
 * Values follow the commonly played table (see README); every value is a field of
 * RuleSet so house rules can be applied from the settings screen.
 */
import {
  DRAGONS, NUM_TILES, WINDS, bonusSeat, countsFrom, isDragon, isFlower, isHonor, isSeason,
  isSuited, isTerminal, isTerminalOrHonor, isWind, type TileId,
} from './tiles';

export interface Meld {
  kind: 'chow' | 'pung' | 'kong';
  /** Lowest tile of a chow, or the tile of a pung/kong. */
  tile: TileId;
  /** True for a concealed kong (declared, but does not break a concealed hand). */
  concealed?: boolean;
}

export interface Hand {
  /** Tiles in hand (not declared as melds). 13 - 3*melds tiles when waiting, one more after a draw. */
  concealed: TileId[];
  melds: Meld[];
  /** Flowers and seasons (34..41). */
  bonus: TileId[];
}

export interface RuleSet {
  commonHand: number; allPungs: number; halfFlush: number; fullFlush: number;
  mixedOrphans: number; pureOrphans: number;
  smallDragons: number; greatDragons: number; smallWinds: number; greatWinds: number;
  allHonors: number; sevenPairs: number; thirteenOrphans: number; nineGates: number;
  fourConcealedPungs: number; allKongs: number;
  dragonPung: number; seatWind: number; prevailingWind: number;
  selfDraw: number; concealed: number;
  noFlowers: number; seatFlower: number; allFlowers: number;
  robbingKong: number; lastTile: number; kongReplacement: number;
  /** Maximum (limit) fan. */
  limit: number;
}

export const DEFAULT_RULES: RuleSet = {
  commonHand: 1, allPungs: 3, halfFlush: 3, fullFlush: 7,
  mixedOrphans: 1, pureOrphans: 10,
  smallDragons: 5, greatDragons: 8, smallWinds: 6, greatWinds: 13,
  allHonors: 10, sevenPairs: 4, thirteenOrphans: 13, nineGates: 10,
  fourConcealedPungs: 10, allKongs: 13,
  dragonPung: 1, seatWind: 1, prevailingWind: 1,
  selfDraw: 1, concealed: 1,
  noFlowers: 1, seatFlower: 1, allFlowers: 2,
  robbingKong: 1, lastTile: 1, kongReplacement: 1,
  limit: 13,
};

export type PatternKey =
  | keyof RuleSet | 'seatSeason' | 'allSeasons' | 'redDragon' | 'greenDragon' | 'whiteDragon';

export interface FanItem { key: PatternKey; name: string; nameZh: string; fan: number }

export const PATTERN_NAMES: Record<string, [string, string]> = {
  commonHand: ['Common Hand (all chows)', '平糊'],
  allPungs: ['All Triplets', '對對糊'],
  halfFlush: ['Mixed One Suit', '混一色'],
  fullFlush: ['All One Suit', '清一色'],
  mixedOrphans: ['Mixed Orphans', '混么九'],
  pureOrphans: ['Pure Orphans', '清么九'],
  smallDragons: ['Small Three Dragons', '小三元'],
  greatDragons: ['Great Three Dragons', '大三元'],
  smallWinds: ['Small Four Winds', '小四喜'],
  greatWinds: ['Great Four Winds', '大四喜'],
  allHonors: ['All Honors', '字一色'],
  sevenPairs: ['Seven Pairs', '七對子'],
  thirteenOrphans: ['Thirteen Orphans', '十三么'],
  nineGates: ['Nine Gates', '九蓮寶燈'],
  fourConcealedPungs: ['Four Concealed Triplets', '四暗刻'],
  allKongs: ['All Kongs', '十八羅漢'],
  redDragon: ['Red Dragon Triplet', '紅中'],
  greenDragon: ['Green Dragon Triplet', '發財'],
  whiteDragon: ['White Dragon Triplet', '白板'],
  seatWind: ['Seat Wind Triplet', '門風'],
  prevailingWind: ['Prevailing Wind Triplet', '圈風'],
  selfDraw: ['Self-Draw', '自摸'],
  concealed: ['Concealed Hand', '門前清'],
  noFlowers: ['No Flowers', '無花'],
  seatFlower: ['Seat Flower', '正花'],
  seatSeason: ['Seat Season', '正花'],
  allFlowers: ['All Four Flowers', '一台花'],
  allSeasons: ['All Four Seasons', '一台花'],
  robbingKong: ['Robbing the Kong', '搶槓'],
  lastTile: ['Last Tile', '海底撈月'],
  kongReplacement: ['Win on Kong Replacement', '槓上開花'],
};

const LIMIT_KEYS = new Set<string>([
  'pureOrphans', 'greatDragons', 'smallWinds', 'greatWinds', 'allHonors', 'thirteenOrphans',
  'nineGates', 'fourConcealedPungs', 'allKongs',
]);

export function makeItem(key: PatternKey, rules: RuleSet, fanOverride?: number): FanItem {
  const [name, nameZh] = PATTERN_NAMES[key];
  let fan: number;
  if (fanOverride != null) fan = fanOverride;
  else if (key === 'seatSeason') fan = rules.seatFlower;
  else if (key === 'allSeasons') fan = rules.allFlowers;
  else if (key === 'redDragon' || key === 'greenDragon' || key === 'whiteDragon') fan = rules.dragonPung;
  else fan = rules[key as keyof RuleSet];
  return { key, name, nameZh, fan };
}

export function dragonItem(tile: TileId, rules: RuleSet): FanItem {
  const key: PatternKey = tile === DRAGONS[0] ? 'redDragon' : tile === DRAGONS[1] ? 'greenDragon' : 'whiteDragon';
  return makeItem(key, rules);
}

/** Fan items for a pung/kong of `tile` (dragon, seat wind, prevailing wind). */
export function valuePungItems(tile: TileId, seatWind: number, prevailingWind: number, rules: RuleSet): FanItem[] {
  const out: FanItem[] = [];
  if (isDragon(tile)) out.push(dragonItem(tile, rules));
  if (isWind(tile)) {
    if (tile === WINDS[seatWind]) out.push(makeItem('seatWind', rules));
    if (tile === WINDS[prevailingWind]) out.push(makeItem('prevailingWind', rules));
  }
  return out;
}

/** Fan items from flowers/seasons held. */
export function bonusItems(bonus: TileId[], seatWind: number, rules: RuleSet): FanItem[] {
  const out: FanItem[] = [];
  if (bonus.length === 0) { out.push(makeItem('noFlowers', rules)); return out; }
  const flowers = bonus.filter(isFlower);
  const seasons = bonus.filter(isSeason);
  if (new Set(flowers).size === 4) out.push(makeItem('allFlowers', rules));
  else if (flowers.some((t) => bonusSeat(t) === seatWind)) out.push(makeItem('seatFlower', rules));
  if (new Set(seasons).size === 4) out.push(makeItem('allSeasons', rules));
  else if (seasons.some((t) => bonusSeat(t) === seatWind)) out.push(makeItem('seatSeason', rules));
  return out;
}

export function sumFan(items: FanItem[], rules: RuleSet): { raw: number; fan: number; limitHand: boolean } {
  const raw = items.reduce((a, b) => a + b.fan, 0);
  return { raw, fan: Math.min(raw, rules.limit), limitHand: items.some((i) => LIMIT_KEYS.has(i.key)) };
}

export interface WinContext {
  seatWind: number; prevailingWind: number;
  selfDraw: boolean;
  robbingKong?: boolean; lastTile?: boolean; kongReplacement?: boolean;
  /** The tile that completed the hand (used for Four Concealed Triplets). */
  winningTile?: TileId;
}

export interface SetDef { kind: 'chow' | 'pung' | 'kong'; tile: TileId; concealed: boolean }

export interface ScoreResult {
  valid: boolean;
  kind: 'standard' | 'sevenPairs' | 'thirteenOrphans' | 'none';
  items: FanItem[];
  /** Fan after applying the limit. */
  fan: number;
  rawFan: number;
  limitHand: boolean;
  sets?: SetDef[];
  pair?: TileId;
}

function decomposeStandard(counts: number[]): { sets: SetDef[]; pair: TileId }[] {
  const results: { sets: SetDef[]; pair: TileId }[] = [];
  const c = counts.slice();
  for (let p = 0; p < NUM_TILES; p++) {
    if (c[p] < 2) continue;
    c[p] -= 2;
    const sets: SetDef[] = [];
    const rec = (i: number): void => {
      while (i < NUM_TILES && c[i] === 0) i++;
      if (i === NUM_TILES) { results.push({ sets: sets.slice(), pair: p }); return; }
      if (c[i] >= 3) {
        c[i] -= 3; sets.push({ kind: 'pung', tile: i, concealed: true }); rec(i); sets.pop(); c[i] += 3;
      }
      if (i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
        c[i]--; c[i + 1]--; c[i + 2]--;
        sets.push({ kind: 'chow', tile: i, concealed: true }); rec(i); sets.pop();
        c[i]++; c[i + 1]++; c[i + 2]++;
      }
    };
    rec(0);
    c[p] += 2;
  }
  return results;
}

function setTiles(s: SetDef): TileId[] {
  return s.kind === 'chow' ? [s.tile, s.tile + 1, s.tile + 2] : [s.tile, s.tile, s.tile];
}

function suitPattern(tiles: TileId[]): { suits: Set<number>; honors: boolean } {
  const suits = new Set<number>();
  let honors = false;
  for (const t of tiles) { if (isSuited(t)) suits.add(Math.floor(t / 9)); else if (isHonor(t)) honors = true; }
  return { suits, honors };
}

function flushItems(tiles: TileId[], rules: RuleSet): FanItem[] {
  const { suits, honors } = suitPattern(tiles);
  if (suits.size === 0 && honors) return [makeItem('allHonors', rules)];
  if (suits.size === 1) return [makeItem(honors ? 'halfFlush' : 'fullFlush', rules)];
  return [];
}

function situationalItems(hand: Hand, ctx: WinContext, rules: RuleSet, inherentlyConcealed: boolean): FanItem[] {
  const items: FanItem[] = [];
  const exposed = hand.melds.some((m) => !(m.kind === 'kong' && m.concealed));
  if (!exposed && !inherentlyConcealed) items.push(makeItem('concealed', rules));
  if (ctx.selfDraw) items.push(makeItem('selfDraw', rules));
  if (ctx.robbingKong) items.push(makeItem('robbingKong', rules));
  if (ctx.lastTile) items.push(makeItem('lastTile', rules));
  if (ctx.kongReplacement) items.push(makeItem('kongReplacement', rules));
  items.push(...bonusItems(hand.bonus, ctx.seatWind, rules));
  return items;
}

function scoreStandard(sets: SetDef[], pair: TileId, hand: Hand, ctx: WinContext, rules: RuleSet): FanItem[] {
  const items: FanItem[] = [];
  const allTiles = [...sets.flatMap(setTiles), pair, pair];
  const allChows = sets.every((s) => s.kind === 'chow');
  const allPungs = sets.every((s) => s.kind !== 'chow');
  const noExposed = hand.melds.every((m) => m.kind === 'kong' && m.concealed) ;
  const suitInfo = suitPattern(allTiles);

  // Nine Gates: concealed, one suit, 1112345678999 + any tile of that suit.
  let nineGates = false;
  if (noExposed && hand.melds.length === 0 && suitInfo.suits.size === 1 && !suitInfo.honors) {
    const base = [...suitInfo.suits][0] * 9;
    const c = countsFrom(allTiles);
    const need = [3, 1, 1, 1, 1, 1, 1, 1, 3];
    let extra = 0;
    let ok = true;
    for (let i = 0; i < 9; i++) { const d = c[base + i] - need[i]; if (d < 0) ok = false; extra += d; }
    nineGates = ok && extra === 1;
  }

  const dragonPungs = sets.filter((s) => s.kind !== 'chow' && isDragon(s.tile)).length;
  const windPungs = sets.filter((s) => s.kind !== 'chow' && isWind(s.tile)).length;

  if (nineGates) items.push(makeItem('nineGates', rules));
  else items.push(...flushItems(allTiles, rules));

  if (sets.every((s) => s.kind === 'kong')) items.push(makeItem('allKongs', rules));
  if (allPungs && allTiles.every(isTerminalOrHonor)) {
    if (allTiles.every(isTerminal)) items.push(makeItem('pureOrphans', rules));
    else if (allTiles.some(isTerminal)) { items.push(makeItem('allPungs', rules)); items.push(makeItem('mixedOrphans', rules)); }
    // all honors: already a limit hand via flushItems; no separate all-pungs
  } else if (allPungs) {
    items.push(makeItem('allPungs', rules));
  } else if (allChows) {
    items.push(makeItem('commonHand', rules));
  }

  if (allPungs && sets.every((s) => s.concealed)) {
    const winOnPair = ctx.winningTile == null || ctx.winningTile === pair;
    if (ctx.selfDraw || winOnPair) items.push(makeItem('fourConcealedPungs', rules));
  }

  if (dragonPungs === 3) items.push(makeItem('greatDragons', rules));
  else if (dragonPungs === 2 && isDragon(pair)) items.push(makeItem('smallDragons', rules));
  else for (const s of sets) if (s.kind !== 'chow' && isDragon(s.tile)) items.push(dragonItem(s.tile, rules));

  if (windPungs === 4) items.push(makeItem('greatWinds', rules));
  else if (windPungs === 3 && isWind(pair)) items.push(makeItem('smallWinds', rules));
  else for (const s of sets) if (s.kind !== 'chow' && isWind(s.tile)) {
    if (s.tile === WINDS[ctx.seatWind]) items.push(makeItem('seatWind', rules));
    if (s.tile === WINDS[ctx.prevailingWind]) items.push(makeItem('prevailingWind', rules));
  }

  items.push(...situationalItems(hand, ctx, rules, nineGates || items.some((i) => i.key === 'fourConcealedPungs')));
  return items;
}

/** Score a complete hand. Returns the highest-scoring interpretation. */
export function scoreHand(hand: Hand, ctx: WinContext, rules: RuleSet = DEFAULT_RULES): ScoreResult {
  const counts = countsFrom(hand.concealed);
  const total = hand.concealed.length + 3 * hand.melds.length;
  const none: ScoreResult = { valid: false, kind: 'none', items: [], fan: 0, rawFan: 0, limitHand: false };
  if (total !== 14) return none;
  let best: ScoreResult = none;
  const consider = (r: ScoreResult): void => { if (!best.valid || r.fan > best.fan || (r.fan === best.fan && r.rawFan > best.rawFan)) best = r; };

  const exposedSets: SetDef[] = hand.melds.map((m) => ({ kind: m.kind, tile: m.tile, concealed: m.kind === 'kong' && !!m.concealed }));
  for (const d of decomposeStandard(counts)) {
    const sets = [...exposedSets, ...d.sets];
    const items = scoreStandard(sets, d.pair, hand, ctx, rules);
    const { raw, fan, limitHand } = sumFan(items, rules);
    consider({ valid: true, kind: 'standard', items, fan, rawFan: raw, limitHand, sets, pair: d.pair });
  }

  if (hand.melds.length === 0) {
    if (rules.sevenPairs > 0) {
      let pairs = 0;
      for (let i = 0; i < NUM_TILES; i++) if (counts[i] === 2) pairs++;
      if (pairs === 7) {
        const items = [makeItem('sevenPairs', rules), ...flushItems(hand.concealed, rules), ...situationalItems(hand, ctx, rules, true)];
        const { raw, fan, limitHand } = sumFan(items, rules);
        consider({ valid: true, kind: 'sevenPairs', items, fan, rawFan: raw, limitHand });
      }
    }
    let kinds = 0;
    let dup = 0;
    let onlyOrphans = true;
    for (let i = 0; i < NUM_TILES; i++) {
      if (counts[i] === 0) continue;
      if (!isTerminalOrHonor(i)) { onlyOrphans = false; break; }
      kinds++;
      if (counts[i] === 2) dup++;
    }
    if (onlyOrphans && kinds === 13 && dup === 1) {
      const items = [makeItem('thirteenOrphans', rules), ...situationalItems(hand, ctx, rules, true)];
      const { raw, fan, limitHand } = sumFan(items, rules);
      consider({ valid: true, kind: 'thirteenOrphans', items, fan, rawFan: raw, limitHand });
    }
  }
  return best;
}

/**
 * Planner: given the current hand and a minimum fan, enumerate target hand patterns,
 * measure how far the hand is from each (shanten), estimate the fan each guarantees on
 * completion, and rank the options. Also recommends discards and lists useful draws.
 */
import {
  DRAGONS, NUM_TILES, WINDS, countsFrom, isHonor, isSuited, isTerminal, isTerminalOrHonor,
  isWind, type TileId,
} from './tiles';
import {
  IMPOSSIBLE, SHAPE_ANY, SHAPE_CHOWS, SHAPE_PUNGS, sevenPairsShanten, stdShanten,
  thirteenOrphansShanten, type ShapeFlags,
} from './shanten';
import {
  DEFAULT_RULES, bonusItems, dragonItem, makeItem, scoreHand, sumFan, type FanItem, type Hand,
  type RuleSet, type ScoreResult,
} from './scoring';

export interface PlanContext {
  seatWind: number;
  prevailingWind: number;
  minFan: number;
  rules?: RuleSet;
  /** Maximum number of options to return (default 8). */
  maxOptions?: number;
}

export interface DrawInfo { tile: TileId; remaining: number }

export interface PlanOption {
  id: string;
  title: string;
  /** Guaranteed fan items on completion (flowers and concealed included when applicable). */
  items: FanItem[];
  fan: number;
  fanSelfDraw: number;
  /** -1 complete, 0 ready, n = n exchanges from ready. */
  shanten: number;
  /** Number of tiles still needed to complete (shanten + 1, 0 when complete). */
  tilesAway: number;
  qualifies: boolean;
  qualifiesSelfDraw: boolean;
  /** Recommended discards, best first. For a 13-tile hand these are the tiles not contributing. */
  discards: TileId[];
  /** Tiles that bring the hand closer, with copies not visible in your hand. */
  draws: DrawInfo[];
  /** Concealed tiles worth keeping. */
  keep: TileId[];
  requiresConcealed: boolean;
  level: number;
}

export interface PlanResult {
  /** Score of the hand if it is already complete (14 tiles). */
  complete: ScoreResult | null;
  /** True when the hand holds a drawn tile and must discard. */
  mustDiscard: boolean;
  options: PlanOption[];
  /** Options that reach the minimum only with a self-draw bonus. */
  nearMisses: PlanOption[];
  /** Best options below the minimum (shown when nothing qualifies). */
  fallback: PlanOption[];
}

type Flush =
  | null
  | { kind: 'half' | 'full'; suit: number }
  | { kind: 'honors' }
  | { kind: 'mixedOrphans' }
  | { kind: 'pureOrphans' };

interface Strategy {
  shape: 'any' | 'pungs' | 'chows' | 'sevenPairs' | 'thirteenOrphans';
  flush: Flush;
  forcedPungs: TileId[];
  forcedPair: TileId | null;
  special: null | 'smallDragons' | 'greatDragons' | 'smallWinds' | 'greatWinds';
}

const SUIT_NAMES = ['Characters', 'Dots', 'Bamboo'];
const SUIT_NAMES_ZH = ['萬', '筒', '索'];

function allowedMask(flush: Flush): boolean[] {
  const mask = new Array<boolean>(NUM_TILES).fill(true);
  if (!flush) return mask;
  for (let i = 0; i < NUM_TILES; i++) {
    switch (flush.kind) {
      case 'half': mask[i] = isHonor(i) || Math.floor(i / 9) === flush.suit; break;
      case 'full': mask[i] = isSuited(i) && Math.floor(i / 9) === flush.suit; break;
      case 'honors': mask[i] = isHonor(i); break;
      case 'mixedOrphans': mask[i] = isTerminalOrHonor(i); break;
      case 'pureOrphans': mask[i] = isTerminal(i); break;
    }
  }
  return mask;
}

function meldTiles(m: { kind: string; tile: TileId }): TileId[] {
  return m.kind === 'chow' ? [m.tile, m.tile + 1, m.tile + 2] : [m.tile, m.tile, m.tile];
}

function subsets<T>(arr: T[]): T[][] {
  const out: T[][] = [[]];
  for (const x of arr) { const n = out.length; for (let i = 0; i < n; i++) out.push([...out[i], x]); }
  return out;
}

function enumerateStrategies(hand: Hand, ctx: PlanContext, rules: RuleSet): Strategy[] {
  const counts = countsFrom(hand.concealed);
  const exposedPungTiles = new Set(hand.melds.filter((m) => m.kind !== 'chow').map((m) => m.tile));
  const totalCount = (t: TileId): number => counts[t] + (exposedPungTiles.has(t) ? 3 : 0);
  const valueTiles = [...DRAGONS, WINDS[ctx.seatWind], WINDS[ctx.prevailingWind]].filter((t, i, a) => a.indexOf(t) === i);
  const forceable = valueTiles.filter((t) => counts[t] >= 1 && !exposedPungTiles.has(t));
  const flushes: Flush[] = [null, ...[0, 1, 2].map((s) => ({ kind: 'half' as const, suit: s })), ...[0, 1, 2].map((s) => ({ kind: 'full' as const, suit: s })), { kind: 'honors' }, { kind: 'mixedOrphans' }, { kind: 'pureOrphans' }];
  const strategies: Strategy[] = [];

  for (const flush of flushes) {
    const mask = allowedMask(flush);
    const shapes: Strategy['shape'][] = flush && (flush.kind === 'honors' || flush.kind === 'mixedOrphans' || flush.kind === 'pureOrphans') ? ['pungs'] : ['any', 'pungs', 'chows'];
    for (const shape of shapes) {
      const forcedSets = shape === 'chows' ? [[]] : subsets(forceable.filter((t) => mask[t]));
      for (const forcedPungs of forcedSets) {
        strategies.push({ shape, flush, forcedPungs, forcedPair: null, special: null });
      }
      if (shape === 'chows' || (flush && flush.kind === 'full') || (flush && flush.kind === 'pureOrphans')) continue;
      // Dragon and wind specials
      const dragonsHeld = DRAGONS.reduce((a, t) => a + totalCount(t), 0);
      if (dragonsHeld >= 3) {
        strategies.push({ shape, flush, forcedPungs: DRAGONS.filter((t) => !exposedPungTiles.has(t)), forcedPair: null, special: 'greatDragons' });
        for (const pair of DRAGONS) {
          if (exposedPungTiles.has(pair)) continue;
          strategies.push({ shape, flush, forcedPungs: DRAGONS.filter((t) => t !== pair && !exposedPungTiles.has(t)), forcedPair: pair, special: 'smallDragons' });
        }
      }
      const windsHeld = WINDS.reduce((a, t) => a + totalCount(t), 0);
      if (windsHeld >= 4) {
        strategies.push({ shape, flush, forcedPungs: WINDS.filter((t) => !exposedPungTiles.has(t)), forcedPair: null, special: 'greatWinds' });
        for (const pair of WINDS) {
          if (exposedPungTiles.has(pair)) continue;
          strategies.push({ shape, flush, forcedPungs: WINDS.filter((t) => t !== pair && !exposedPungTiles.has(t)), forcedPair: pair, special: 'smallWinds' });
        }
      }
    }
  }
  if (hand.melds.length === 0) {
    if (rules.sevenPairs > 0) {
      for (const flush of flushes) {
        if (flush && (flush.kind === 'mixedOrphans' || flush.kind === 'pureOrphans')) continue;
        strategies.push({ shape: 'sevenPairs', flush, forcedPungs: [], forcedPair: null, special: null });
      }
    }
    strategies.push({ shape: 'thirteenOrphans', flush: null, forcedPungs: [], forcedPair: null, special: null });
  }
  return strategies;
}

function compatible(s: Strategy, hand: Hand, mask: boolean[]): boolean {
  if (s.shape === 'sevenPairs' || s.shape === 'thirteenOrphans') return hand.melds.length === 0;
  for (const m of hand.melds) {
    if (s.shape === 'pungs' && m.kind === 'chow') return false;
    if (s.shape === 'chows' && m.kind !== 'chow') return false;
    if (!meldTiles(m).every((t) => mask[t])) return false;
  }
  return true;
}

function strategyItems(s: Strategy, hand: Hand, ctx: PlanContext, rules: RuleSet): { items: FanItem[]; requiresConcealed: boolean } {
  const items: FanItem[] = [];
  const exposedPungs = hand.melds.filter((m) => m.kind !== 'chow').map((m) => m.tile);
  const flush = s.flush;
  if (s.shape === 'sevenPairs') items.push(makeItem('sevenPairs', rules));
  if (s.shape === 'thirteenOrphans') items.push(makeItem('thirteenOrphans', rules));
  if (s.shape === 'chows') items.push(makeItem('commonHand', rules));
  if (flush?.kind === 'half') items.push(makeItem('halfFlush', rules));
  if (flush?.kind === 'full') items.push(makeItem('fullFlush', rules));
  if (flush?.kind === 'honors') items.push(makeItem('allHonors', rules));
  if (flush?.kind === 'pureOrphans') items.push(makeItem('pureOrphans', rules));
  if (s.shape === 'pungs' && flush?.kind !== 'honors' && flush?.kind !== 'pureOrphans') items.push(makeItem('allPungs', rules));
  if (flush?.kind === 'mixedOrphans') items.push(makeItem('mixedOrphans', rules));

  if (s.special) items.push(makeItem(s.special, rules));
  const pungTiles = [...s.forcedPungs, ...exposedPungs];
  if (s.shape !== 'sevenPairs' && s.shape !== 'thirteenOrphans') {
    for (const t of pungTiles) {
      if (DRAGONS.includes(t) && (s.special === 'smallDragons' || s.special === 'greatDragons')) continue;
      if (isWind(t) && (s.special === 'smallWinds' || s.special === 'greatWinds')) continue;
      if (DRAGONS.includes(t)) items.push(dragonItem(t, rules));
      if (t === WINDS[ctx.seatWind]) items.push(makeItem('seatWind', rules));
      if (t === WINDS[ctx.prevailingWind]) items.push(makeItem('prevailingWind', rules));
    }
  }
  const exposed = hand.melds.some((m) => !(m.kind === 'kong' && m.concealed));
  const inherentlyConcealed = s.shape === 'sevenPairs' || s.shape === 'thirteenOrphans';
  const requiresConcealed = !exposed && !inherentlyConcealed;
  if (requiresConcealed) items.push(makeItem('concealed', rules));
  items.push(...bonusItems(hand.bonus, ctx.seatWind, rules));
  return { items, requiresConcealed };
}

function strategyTitle(s: Strategy, items: FanItem[]): string {
  const parts: string[] = [];
  const fl = s.flush;
  for (const it of items) {
    if (it.key === 'concealed' || it.key === 'noFlowers' || it.key === 'seatFlower' || it.key === 'seatSeason' || it.key === 'allFlowers' || it.key === 'allSeasons') continue;
    if ((it.key === 'halfFlush' || it.key === 'fullFlush') && fl && (fl.kind === 'half' || fl.kind === 'full')) {
      parts.push(`${it.name} (${SUIT_NAMES[fl.suit]} ${SUIT_NAMES_ZH[fl.suit]})`);
      continue;
    }
    parts.push(it.name);
  }
  return parts.length ? parts.join(' + ') : 'Any hand (chicken hand)';
}

function uselessness(t: TileId, counts: number[], mask: boolean[]): number {
  let score = mask[t] ? 0 : 100;
  if (isHonor(t)) score += 10;
  else if (isTerminal(t)) score += 4;
  let neighbors = (counts[t] - 1) * 3;
  if (isSuited(t)) {
    const base = Math.floor(t / 9) * 9;
    for (let d = -2; d <= 2; d++) {
      if (d === 0) continue;
      const u = t + d;
      if (u >= base && u < base + 9) neighbors += counts[u] * (Math.abs(d) === 1 ? 2 : 1);
    }
  }
  return score - neighbors;
}

interface Candidate {
  s: Strategy;
  mask: boolean[];
  sh: (c: number[]) => number;
  shanten: number;
  discards: TileId[];
  base: number[];
  items: FanItem[];
  fan: number;
  fanSelfDraw: number;
  requiresConcealed: boolean;
  level: number;
  order: number;
}

/** Analyse the hand and rank ways to reach the minimum fan. */
export function planOptions(hand: Hand, ctx: PlanContext): PlanResult {
  const rules = ctx.rules ?? DEFAULT_RULES;
  const counts = countsFrom(hand.concealed);
  const total = hand.concealed.length + 3 * hand.melds.length;
  const mustDiscard = total === 14;
  const complete = mustDiscard ? scoreHand(hand, { seatWind: ctx.seatWind, prevailingWind: ctx.prevailingWind, selfDraw: false }, rules) : null;
  const held = countsFrom([...hand.concealed, ...hand.melds.flatMap(meldTiles)]);

  // Phase 1: shanten (and best discard) for every strategy.
  const cands: Candidate[] = [];
  const seen = new Set<string>();
  for (const s of enumerateStrategies(hand, ctx, rules)) {
    const mask = allowedMask(s.flush);
    if (!compatible(s, hand, mask)) continue;
    const id = JSON.stringify([s.shape, s.flush, s.forcedPungs, s.forcedPair, s.special]);
    if (seen.has(id)) continue;
    seen.add(id);
    const flags: ShapeFlags = s.shape === 'pungs' ? SHAPE_PUNGS : s.shape === 'chows' ? SHAPE_CHOWS : SHAPE_ANY;
    const exposedMelds = hand.melds.length;
    const sh = (c: number[]): number => {
      if (s.shape === 'sevenPairs') return sevenPairsShanten(c, mask);
      if (s.shape === 'thirteenOrphans') return thirteenOrphansShanten(c);
      return stdShanten(c, { flags, allowed: mask, forcedPungs: s.forcedPungs, forcedPair: s.forcedPair, exposedMelds });
    };
    let shanten: number;
    let discards: TileId[] = [];
    let base = counts;
    if (mustDiscard) {
      let bestSh = IMPOSSIBLE;
      const cand: { t: TileId; sh: number }[] = [];
      for (let t = 0; t < NUM_TILES; t++) {
        if (counts[t] === 0) continue;
        counts[t]--;
        const v = sh(counts);
        counts[t]++;
        cand.push({ t, sh: v });
        if (v < bestSh) bestSh = v;
      }
      shanten = bestSh;
      discards = cand.filter((c) => c.sh === bestSh).map((c) => c.t).sort((a, b) => uselessness(b, counts, mask) - uselessness(a, counts, mask));
      if (discards.length) { base = counts.slice(); base[discards[0]]--; }
    } else {
      shanten = sh(counts);
    }
    if (shanten >= IMPOSSIBLE) continue;
    const { items, requiresConcealed } = strategyItems(s, hand, ctx, rules);
    const { fan } = sumFan(items, rules);
    const fanSelfDraw = Math.min(fan + rules.selfDraw, rules.limit);
    const level = (s.shape === 'any' ? 0 : 1) + (s.flush ? (s.flush.kind === 'half' ? 1 : 2) : 0) + s.forcedPungs.length + (s.forcedPair != null ? 1 : 0);
    cands.push({ s, mask, sh, shanten, discards, base, items, fan, fanSelfDraw, requiresConcealed, level, order: cands.length });
  }

  // Phase 2: dominance pruning and ranking.
  const tilesAway = (c: Candidate): number => Math.max(0, c.shanten + 1);
  const qualifies = (c: Candidate): boolean => c.fan >= ctx.minFan;
  const pruned = cands.filter((a) => !cands.some((b) => b !== a && qualifies(b) === qualifies(a) && tilesAway(b) <= tilesAway(a) && b.fan >= a.fan && b.level <= a.level && (tilesAway(b) < tilesAway(a) || b.fan > a.fan || b.level < a.level || b.order < a.order)));
  const byRank = (x: Candidate, y: Candidate): number => tilesAway(x) - tilesAway(y) || y.fan - x.fan || x.level - y.level;
  const max = ctx.maxOptions ?? 8;
  const top = pruned.filter(qualifies).sort(byRank).slice(0, max);
  const near = pruned.filter((c) => !qualifies(c) && c.fanSelfDraw >= ctx.minFan).sort(byRank).slice(0, 3);
  const fall = pruned.filter((c) => c.fanSelfDraw < ctx.minFan).sort(byRank).slice(0, 3);

  // Phase 3: discard / draw details only for the options we show.
  const detail = (c: Candidate): PlanOption => {
    let discards = c.discards;
    if (!mustDiscard) {
      const dead: TileId[] = [];
      for (let t = 0; t < NUM_TILES; t++) {
        if (counts[t] === 0) continue;
        counts[t]--;
        if (c.sh(counts) === c.shanten) dead.push(t);
        counts[t]++;
      }
      discards = dead.sort((a, b) => uselessness(b, counts, c.mask) - uselessness(a, counts, c.mask));
    }
    const draws: DrawInfo[] = [];
    if (c.shanten >= 0) {
      const b = c.base.slice();
      for (let t = 0; t < NUM_TILES; t++) {
        if (!c.mask[t] && c.s.shape !== 'thirteenOrphans') continue;
        b[t]++;
        const v = c.sh(b);
        b[t]--;
        if (v < c.shanten) draws.push({ tile: t, remaining: Math.max(0, 4 - held[t]) });
      }
      // Most useful first: tiles that pair up or extend what is already held, then honours.
      const affinity = (t: TileId): number => {
        let a = c.base[t] * 3;
        if (isSuited(t)) {
          const lo = Math.floor(t / 9) * 9;
          for (let d = -2; d <= 2; d++) {
            const u = t + d;
            if (d !== 0 && u >= lo && u < lo + 9) a += c.base[u] * (Math.abs(d) === 1 ? 2 : 1);
          }
        }
        return a;
      };
      draws.sort((x, y) => affinity(y.tile) - affinity(x.tile) || y.remaining - x.remaining || x.tile - y.tile);
    }
    const discardSet = new Set(mustDiscard ? discards.slice(0, 1) : discards);
    const keep = hand.concealed.filter((t) => !discardSet.has(t));
    return {
      id: JSON.stringify([c.s.shape, c.s.flush, c.s.forcedPungs, c.s.forcedPair, c.s.special]),
      title: strategyTitle(c.s, c.items), items: c.items, fan: c.fan, fanSelfDraw: c.fanSelfDraw,
      shanten: c.shanten, tilesAway: tilesAway(c),
      qualifies: qualifies(c), qualifiesSelfDraw: c.fanSelfDraw >= ctx.minFan,
      discards, draws, keep, requiresConcealed: c.requiresConcealed, level: c.level,
    };
  };
  return { complete, mustDiscard, options: top.map(detail), nearMisses: near.map(detail), fallback: fall.map(detail) };
}

/**
 * Constrained shanten ("tiles away from ready") calculator.
 *
 * shanten = -1 complete, 0 ready (waiting on one tile), 1 one exchange away, ...
 *
 * The standard-hand model is 4 sets + 1 pair. Progress value is 2 per complete set,
 * 1 per partial set (two tiles that can become a set), 1 for the pair, with the
 * constraint that complete + partial sets cannot exceed the available set slots.
 * shanten = 8 - value.
 *
 * Constraints supported (so the planner can ask "how far am I from a Half Flush
 * All-Pungs hand with a Red Dragon pung?"):
 *  - shape flags: allow chows / allow pungs
 *  - allowed mask: tiles outside the mask are treated as if not held
 *  - forced pungs / forced pair: sets that must appear in the final hand
 *  - exposed melds: already-complete sets that occupy slots
 */
import { NUM_TILES, TERMINALS_AND_HONORS, type TileId } from './tiles';

export interface ShapeFlags { allowChow: boolean; allowPung: boolean }
export const SHAPE_ANY: ShapeFlags = { allowChow: true, allowPung: true };
export const SHAPE_PUNGS: ShapeFlags = { allowChow: false, allowPung: true };
export const SHAPE_CHOWS: ShapeFlags = { allowChow: true, allowPung: false };

export const IMPOSSIBLE = 99;

interface Combo { m: number; t: number }
const comboCache = new Map<string, Combo[]>();

/** Pareto-optimal (complete sets, partial sets) combinations for one suit group. */
function groupCombos(counts: number[], honor: boolean, flags: ShapeFlags): Combo[] {
  const key = counts.join('') + (honor ? 'h' : 's') + (flags.allowChow ? 'c' : '-') + (flags.allowPung ? 'p' : '-');
  const hit = comboCache.get(key);
  if (hit) return hit;
  const c = counts.slice();
  const n = c.length;
  const allowChow = flags.allowChow && !honor;
  const allowPung = flags.allowPung;
  const found = new Set<number>();
  const seen = new Set<string>();
  const rec = (i: number, m: number, t: number): void => {
    while (i < n && c[i] === 0) i++;
    if (i === n) { found.add(m * 16 + t); return; }
    const sk = `${i},${m},${t},${c.join('')}`;
    if (seen.has(sk)) return;
    seen.add(sk);
    // leave one copy of this tile unused
    c[i]--; rec(i, m, t); c[i]++;
    if (allowPung && c[i] >= 3) { c[i] -= 3; rec(i, m + 1, t); c[i] += 3; }
    if (allowChow && i + 2 < n && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--; c[i + 1]--; c[i + 2]--; rec(i, m + 1, t); c[i]++; c[i + 1]++; c[i + 2]++;
    }
    if (allowPung && c[i] >= 2) { c[i] -= 2; rec(i, m, t + 1); c[i] += 2; }
    if (allowChow && i + 1 < n && c[i + 1] > 0) { c[i]--; c[i + 1]--; rec(i, m, t + 1); c[i]++; c[i + 1]++; }
    if (allowChow && i + 2 < n && c[i + 2] > 0) { c[i]--; c[i + 2]--; rec(i, m, t + 1); c[i]++; c[i + 2]++; }
  };
  rec(0, 0, 0);
  const all = [...found].map((v) => ({ m: v >> 4, t: v & 15 }));
  const pareto = all.filter((a) => !all.some((b) => (b.m > a.m && b.t >= a.t) || (b.m >= a.m && b.t > a.t)));
  comboCache.set(key, pareto);
  return pareto;
}

interface GroupCombos { g: Combo[][]; }

function groupsFor(c: number[], flags: ShapeFlags): GroupCombos {
  return {
    g: [
      groupCombos(c.slice(0, 9), false, flags),
      groupCombos(c.slice(9, 18), false, flags),
      groupCombos(c.slice(18, 27), false, flags),
      groupCombos(c.slice(27, 34), true, flags),
    ],
  };
}

/**
 * Best "tiles accounted for" score for the concealed tiles.
 *
 * score = tiles inside complete/partial sets (+ the pair) + loose usable tiles that can
 * seed an empty set slot or the pair. `slots` is the number of set slots the concealed
 * tiles may fill; `total` is the number of usable concealed tiles (after removing the pair
 * when `pairUsed`); `openPair` is 1 when the hand still needs a pair and a loose tile may
 * seed it.
 */
function bestScore(gc: GroupCombos, slots: number, total: number, pairUsed: boolean, openPair: number): number {
  let best = 0;
  const [g0, g1, g2, g3] = gc.g;
  for (const a of g0) for (const b of g1) for (const d of g2) for (const e of g3) {
    const m = Math.min(slots, a.m + b.m + d.m + e.m);
    const t = Math.min(slots - m, a.t + b.t + d.t + e.t);
    const used = 3 * m + 2 * t;
    const loose = total - used;
    const open = slots - m - t + openPair;
    const v = used + (pairUsed ? 2 : 0) + Math.min(loose, open);
    if (v > best) best = v;
  }
  return best;
}

export interface StdSpec {
  flags?: ShapeFlags;
  /** Tiles outside the mask are ignored (treated as tiles to discard). */
  allowed?: ArrayLike<boolean> | null;
  /** Tiles that must end up as pungs/kongs in the final hand. */
  forcedPungs?: TileId[];
  /** Tile that must be the pair of the final hand. */
  forcedPair?: TileId | null;
  /** Number of exposed (or concealed-declared) melds, each occupying a set slot. */
  exposedMelds?: number;
}

/**
 * Shanten for a standard 4-sets-plus-pair hand under the given constraints.
 * Computed as (tiles still needed to complete 14) - 1, so it stays correct when
 * fewer than 13 tiles are usable.
 */
export function stdShanten(counts: number[], spec: StdSpec = {}): number {
  const flags = spec.flags ?? SHAPE_ANY;
  const c = counts.slice(0, NUM_TILES);
  if (spec.allowed) for (let i = 0; i < NUM_TILES; i++) if (!spec.allowed[i]) c[i] = 0;
  const exposed = spec.exposedMelds ?? 0;
  let slots = 4 - exposed;
  let inStructure = 3 * exposed;
  for (const t of spec.forcedPungs ?? []) {
    const k = Math.min(3, c[t]);
    c[t] -= k;
    inStructure += k;
    slots--;
  }
  if (slots < 0) return IMPOSSIBLE;
  let pairReserved = false;
  if (spec.forcedPair != null) {
    const k = Math.min(2, c[spec.forcedPair]);
    c[spec.forcedPair] -= k;
    inStructure += k;
    pairReserved = true;
  }
  let total = 0;
  for (let i = 0; i < NUM_TILES; i++) total += c[i];
  let best = bestScore(groupsFor(c, flags), slots, total, false, pairReserved ? 0 : 1);
  if (!pairReserved) {
    for (let i = 0; i < NUM_TILES; i++) {
      if (c[i] >= 2) {
        c[i] -= 2;
        const v = bestScore(groupsFor(c, flags), slots, total - 2, true, 0);
        if (v > best) best = v;
        c[i] += 2;
      }
    }
  }
  return 13 - inStructure - best;
}

/** Shanten for Seven Pairs (seven distinct pairs, fully concealed). */
export function sevenPairsShanten(counts: number[], allowed?: ArrayLike<boolean> | null): number {
  let pairs = 0;
  let kinds = 0;
  for (let i = 0; i < NUM_TILES; i++) {
    if (allowed && !allowed[i]) continue;
    if (counts[i] >= 2) pairs++;
    if (counts[i] >= 1) kinds++;
  }
  return 6 - pairs + Math.max(0, 7 - kinds);
}

/** Shanten for Thirteen Orphans. */
export function thirteenOrphansShanten(counts: number[]): number {
  let kinds = 0;
  let hasPair = false;
  for (const t of TERMINALS_AND_HONORS) {
    if (counts[t] >= 1) kinds++;
    if (counts[t] >= 2) hasPair = true;
  }
  return 13 - kinds - (hasPair ? 1 : 0);
}

/** Clear the memo cache (mainly for tests / memory pressure). */
export function clearShantenCache(): void { comboCache.clear(); }

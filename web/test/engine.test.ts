import { describe, expect, it } from 'vitest';
import { countsFrom, parseHand, DRAGON_RED, WIND_E, WIND_S, TILE_CODES } from '../src/engine/tiles';
import { SHAPE_CHOWS, SHAPE_PUNGS, sevenPairsShanten, stdShanten, thirteenOrphansShanten } from '../src/engine/shanten';
import { scoreHand, DEFAULT_RULES } from '../src/engine/scoring';
import { planOptions } from '../src/engine/planner';

const h = (s: string) => countsFrom(parseHand(s));

describe('tiles', () => {
  it('parses and round-trips codes', () => {
    const t = parseHand('123m 456p 789s ESWN CFP f1 g4');
    expect(t.length).toBe(18);
    expect(t.map((x) => TILE_CODES[x]).join(' ')).toBe('m1 m2 m3 p4 p5 p6 s7 s8 s9 E S W N C F P f1 g4');
  });
});

describe('shanten', () => {
  it('complete and ready hands', () => {
    expect(stdShanten(h('123m 456m 789m 123p 55s'))).toBe(-1);
    expect(stdShanten(h('123m 456m 789m 123p 5s'))).toBe(0);
    expect(stdShanten(h('123m 456m 789m 12p 5s'))).toBe(1);
  });
  it('shape constraints', () => {
    const c = h('111m 222m 333m 444p 55s');
    expect(stdShanten(c, { flags: SHAPE_PUNGS })).toBe(-1);
    expect(stdShanten(c, { flags: SHAPE_CHOWS })).toBe(1); // 444p cannot be a chow: one 4p seeds a new chow
    const seq = h('123m 123m 123m 456p 55s');
    expect(stdShanten(seq, { flags: SHAPE_CHOWS })).toBe(-1);
    expect(stdShanten(seq, { flags: SHAPE_PUNGS })).toBe(1);
    const chowy = h('123m 456m 789m 123p 55s');
    expect(stdShanten(chowy, { flags: SHAPE_PUNGS })).toBe(7);
  });
  it('allowed mask (flush)', () => {
    const c = h('123m 456m 789m 123p 55s');
    const onlyM = new Array(34).fill(false).map((_, i) => i < 9);
    // keep 9 characters (3 sets), need 4th set + pair: 3 tiles + 2 -> 4 shanten
    expect(stdShanten(c, { allowed: onlyM })).toBe(4);
  });
  it('forced pung', () => {
    const c = h('123m 456m 789m 12p C');
    expect(stdShanten(c, { forcedPungs: [DRAGON_RED] })).toBe(2);
    expect(stdShanten(h('123m 456m 789m 5p CC'), { forcedPungs: [DRAGON_RED] })).toBe(1);
    expect(stdShanten(h('123m 456m 789m 5p CCC'), { forcedPungs: [DRAGON_RED] })).toBe(0);
  });
  it('exposed melds occupy slots', () => {
    expect(stdShanten(h('123m 55s'), { exposedMelds: 3 })).toBe(-1);
    expect(stdShanten(h('12m 55s'), { exposedMelds: 3 })).toBe(0);
  });
  it('seven pairs and thirteen orphans', () => {
    expect(sevenPairsShanten(h('11m 22m 33m 44p 55p 66s 7s'))).toBe(0);
    expect(sevenPairsShanten(h('11m 22m 33m 44p 55p 66s 77s'))).toBe(-1);
    expect(thirteenOrphansShanten(h('19m 19p 19s ESWN CFP'))).toBe(0);
    expect(thirteenOrphansShanten(h('19m 19p 19s ESWN CFPP'))).toBe(-1);
    expect(thirteenOrphansShanten(h('19m 19p 19s ESWN CF 5p'))).toBe(1);
  });
});

describe('scoring', () => {
  const ctx = { seatWind: 0, prevailingWind: 1, selfDraw: false };
  it('all pungs beats all chows for 111222333', () => {
    const r = scoreHand({ concealed: parseHand('111m 222m 333m 444p 55s'), melds: [], bonus: [] }, ctx);
    expect(r.valid).toBe(true);
    expect(r.items.map((i) => i.key)).toContain('allPungs');
    // allPungs 3 + fourConcealedPungs? not self-draw and win tile unknown -> assume pair -> yes 10 -> capped
    expect(r.fan).toBeGreaterThanOrEqual(3);
  });
  it('half flush with dragon pung, concealed, no flowers', () => {
    const r = scoreHand({ concealed: parseHand('123m 456m 789m CCC 11m'), melds: [], bonus: [] }, ctx);
    expect(r.valid).toBe(true);
    const keys = r.items.map((i) => i.key);
    expect(keys).toContain('halfFlush');
    expect(keys).toContain('redDragon');
    expect(keys).toContain('concealed');
    expect(keys).toContain('noFlowers');
    expect(r.fan).toBe(3 + 1 + 1 + 1);
  });
  it('exposed melds, seat and prevailing wind, flowers', () => {
    const r = scoreHand(
      { concealed: parseHand('123p 456s 77s'), melds: [{ kind: 'pung', tile: WIND_E }, { kind: 'pung', tile: WIND_S }], bonus: [34, 38] },
      ctx,
    );
    expect(r.valid).toBe(true);
    const keys = r.items.map((i) => i.key);
    expect(keys).toContain('seatWind');
    expect(keys).toContain('prevailingWind');
    expect(keys).toContain('seatFlower');
    expect(keys).not.toContain('concealed');
    expect(r.fan).toBe(1 + 1 + 1 + 1); // seat wind, prevailing wind, seat flower, seat season
  });
  it('full flush all chows', () => {
    const r = scoreHand({ concealed: parseHand('123m 456m 789m 234m 55m'), melds: [], bonus: [] }, { ...ctx, selfDraw: true });
    expect(r.fan).toBe(7 + 1 + 1 + 1 + 1); // fullFlush + commonHand + concealed + selfDraw + noFlowers
  });
  it('seven pairs and thirteen orphans', () => {
    const sp = scoreHand({ concealed: parseHand('11m 22m 33m 44p 55p 66s 77s'), melds: [], bonus: [] }, ctx);
    expect(sp.kind).toBe('sevenPairs');
    expect(sp.fan).toBe(DEFAULT_RULES.sevenPairs + 1);
    const to = scoreHand({ concealed: parseHand('19m 19p 19s ESWN CFPP'), melds: [], bonus: [] }, ctx);
    expect(to.kind).toBe('thirteenOrphans');
    expect(to.fan).toBe(13);
  });
  it('great dragons is a limit hand', () => {
    const r = scoreHand({ concealed: parseHand('CCC FFF PPP 123m 55m'), melds: [], bonus: [] }, ctx);
    expect(r.items.map((i) => i.key)).toContain('greatDragons');
    expect(r.fan).toBeGreaterThanOrEqual(8);
  });
  it('rejects wrong tile count', () => {
    expect(scoreHand({ concealed: parseHand('123m'), melds: [], bonus: [] }, ctx).valid).toBe(false);
  });
});

describe('planner', () => {
  it('finds options for a 13-tile hand and ranks by distance', () => {
    const hand = { concealed: parseHand('123m 456m 789m 12p C'), melds: [], bonus: [] };
    const r = planOptions(hand, { seatWind: 0, prevailingWind: 0, minFan: 3 });
    expect(r.mustDiscard).toBe(false);
    expect(r.options.length).toBeGreaterThan(0);
    for (let i = 1; i < r.options.length; i++) expect(r.options[i].tilesAway).toBeGreaterThanOrEqual(r.options[i - 1].tilesAway);
    for (const o of r.options) expect(o.fan).toBeGreaterThanOrEqual(3);
    const best = r.options[0];
    expect(best.draws.length).toBeGreaterThan(0);
  });
  it('recommends a discard for a 14-tile hand', () => {
    const hand = { concealed: parseHand('123m 456m 789m 12p C 9s 5p'), melds: [], bonus: [] };
    const r = planOptions(hand, { seatWind: 0, prevailingWind: 0, minFan: 1 });
    expect(r.mustDiscard).toBe(true);
    expect(r.complete?.valid).toBe(false);
    const best = r.options[0];
    expect(best.discards.length).toBeGreaterThan(0);
  });
  it('reports a complete winning hand', () => {
    const hand = { concealed: parseHand('123m 456m 789m CCC 11m'), melds: [], bonus: [] };
    const r = planOptions(hand, { seatWind: 0, prevailingWind: 0, minFan: 3 });
    expect(r.complete?.valid).toBe(true);
    expect(r.complete?.fan).toBe(6);
  });
  it('is fast enough', () => {
    const hand = { concealed: parseHand('1m 3m 5m 2p 4p 6p 7s 9s E S W C F'), melds: [], bonus: [] };
    const t0 = performance.now();
    planOptions(hand, { seatWind: 0, prevailingWind: 0, minFan: 3 });
    const ms = performance.now() - t0;
    console.log(`planOptions took ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(2000);
  });
});

describe('shanten (needed-tiles formulation)', () => {
  it('forced pair', () => {
    expect(stdShanten(h('123m 456m 789m 123p 5s'), { forcedPair: 22 })).toBe(0); // 5s = tile 22
    expect(stdShanten(h('123m 456m 789m 123p 55s'), { forcedPair: 22 })).toBe(-1);
    expect(stdShanten(h('123m 456m 789m 123p 5s'), { forcedPair: WIND_E })).toBe(1);
  });
  it('fewer usable tiles increases shanten', () => {
    const onlyM = new Array(34).fill(false).map((_, i) => i < 9);
    expect(stdShanten(h('123m 456m 789m 1m 5p 6p 7p'), { allowed: onlyM })).toBe(3); // 10 usable: 3 sets + loose 1m seeds pair -> need 4 more
    expect(stdShanten(h('123m 456m 789m 11m 5p 6p'), { allowed: onlyM })).toBe(2);
  });
  it('12-tile hand after a discard is one further away than the 13-tile ready hand', () => {
    expect(stdShanten(h('123m 456m 789m 123p'))).toBe(1);
  });
  it('honours the seat wind constant', () => {
    expect(WIND_S).toBe(28);
  });
});

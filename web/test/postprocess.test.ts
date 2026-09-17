import { describe, expect, it } from 'vitest';
import { HandStabilizer, LockTracker, filterBySize, nms, orderDetections, regionOf, type Detection } from '../src/vision/postprocess';

const box = (cls: number, x: number, y: number, w = 40, h = 56, score = 0.9): Detection => ({ cls, score, x1: x, y1: y, x2: x + w, y2: y + h });

describe('filterBySize', () => {
  it('drops boxes much larger or smaller than the typical tile', () => {
    const tiles = [0, 1, 2, 3, 4].map((i) => box(i, i * 50, 100));
    const card = box(9, 300, 0, 160, 220); // a playing card / box in the background
    const speck = box(10, 10, 10, 8, 10);
    expect(filterBySize([...tiles, card, speck]).map((d) => d.cls)).toEqual([0, 1, 2, 3, 4]);
  });
  it('leaves small sets alone', () => {
    const dets = [box(0, 0, 0), box(1, 0, 0, 200, 300)];
    expect(filterBySize(dets)).toHaveLength(2);
  });
});

describe('regionOf', () => {
  it('pads the union of the boxes by one tile width and clamps to the frame', () => {
    const r = regionOf([box(0, 50, 100), box(1, 100, 100), box(2, 150, 100)], 640, 480, 1)!;
    expect(r).toEqual({ x: 10, y: 60, w: 220, h: 136 });
    const edge = regionOf([box(0, 5, 5)], 640, 480, 1)!;
    expect(edge.x).toBe(0);
    expect(edge.y).toBe(0);
  });
  it('is null without detections', () => {
    expect(regionOf([], 640, 480)).toBeNull();
  });
});

describe('LockTracker', () => {
  it('locks after the same multiset has been held long enough', () => {
    const t = new LockTracker(1000, 3);
    expect(t.push([1, 2, 3], 0)).toBe(false);
    expect(t.push([3, 2, 1], 500)).toBe(false); // order does not matter
    expect(t.push([1, 2, 3], 900)).toBe(false); // 3 frames but < 1 s
    expect(t.push([1, 2, 3], 1000)).toBe(true);
  });
  it('restarts when the tiles change', () => {
    const t = new LockTracker(1000, 2);
    t.push([1, 2], 0);
    t.push([1, 2], 600);
    expect(t.push([1, 3], 1200)).toBe(false);
    expect(t.push([1, 3], 1800)).toBe(false);
    expect(t.push([1, 3], 2200)).toBe(true);
  });
});

describe('nms', () => {
  it('keeps the highest-scoring of overlapping boxes regardless of class', () => {
    const kept = nms([box(1, 0, 0, 40, 56, 0.6), box(2, 2, 1, 40, 56, 0.9), box(3, 100, 0)], 0.5);
    expect(kept.map((d) => d.cls)).toEqual([2, 3]);
  });
});

describe('orderDetections', () => {
  it('reads rows top to bottom and left to right', () => {
    const dets = [box(5, 200, 100), box(6, 40, 100), box(7, 120, 104), box(8, 300, 10), box(9, 10, 12)];
    expect(orderDetections(dets).map((d) => d.cls)).toEqual([9, 8, 6, 7, 5]);
  });
  it('handles empty input', () => {
    expect(orderDetections([])).toEqual([]);
  });
});

describe('HandStabilizer', () => {
  it('ignores a single dropped frame', () => {
    const s = new HandStabilizer(5, 42);
    const full = [box(0, 0, 0), box(0, 50, 0), box(9, 100, 0)];
    s.push(full); s.push(full);
    const dropped = s.push([box(0, 0, 0)]);
    expect(dropped[0]).toBe(2);
    expect(dropped[9]).toBe(1);
  });
  it('follows a real change after enough frames', () => {
    const s = new HandStabilizer(3, 42);
    s.push([box(0, 0, 0)]); s.push([box(0, 0, 0)]);
    s.push([box(1, 0, 0)]); s.push([box(1, 0, 0)]);
    const out = s.push([box(1, 0, 0)]);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(1);
  });
});

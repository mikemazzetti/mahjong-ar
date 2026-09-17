/** Pure post-processing helpers for detector output (no runtime dependency). */

export interface Detection {
  /** Class index = TileId (0..41). */
  cls: number;
  score: number;
  /** Box in source-image pixels. */
  x1: number; y1: number; x2: number; y2: number;
}

function iou(a: Detection, b: Detection): number {
  const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = ix * iy;
  const ua = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
  return ua <= 0 ? 0 : inter / ua;
}

/** Class-agnostic non-maximum suppression (tiles never overlap each other). */
export function nms(dets: Detection[], iouThr: number): Detection[] {
  const sorted = [...dets].sort((a, b) => b.score - a.score);
  const kept: Detection[] = [];
  for (const d of sorted) {
    if (kept.every((k) => iou(k, d) < iouThr)) kept.push(d);
  }
  return kept;
}

/**
 * Drops boxes whose area is far from the median box area. Tiles in one photo are all
 * about the same size, so this rejects cards, boxes, chips and other lookalikes in the
 * background. Only applied once enough tiles are in view for the median to be meaningful.
 */
export function filterBySize(dets: Detection[], lo = 0.5, hi = 2.0, minCount = 5): Detection[] {
  if (dets.length < minCount) return dets;
  const area = (d: Detection): number => (d.x2 - d.x1) * (d.y2 - d.y1);
  const areas = dets.map(area).sort((a, b) => a - b);
  const median = areas[Math.floor(areas.length / 2)];
  return dets.filter((d) => area(d) >= median * lo && area(d) <= median * hi);
}

export interface Region { x: number; y: number; w: number; h: number }

/**
 * The area of the frame that holds the detected tiles, padded by `margin` tile widths
 * and clamped to the frame. Running the detector again on just this region gives it a
 * zoomed-in view, which recovers small or low-contrast tiles (e.g. white dragons).
 */
export function regionOf(dets: Detection[], frameW: number, frameH: number, margin = 1): Region | null {
  if (dets.length === 0) return null;
  const widths = dets.map((d) => d.x2 - d.x1).sort((a, b) => a - b);
  const pad = widths[Math.floor(widths.length / 2)] * margin;
  const x1 = Math.max(0, Math.min(...dets.map((d) => d.x1)) - pad);
  const y1 = Math.max(0, Math.min(...dets.map((d) => d.y1)) - pad);
  const x2 = Math.min(frameW, Math.max(...dets.map((d) => d.x2)) + pad);
  const y2 = Math.min(frameH, Math.max(...dets.map((d) => d.y2)) + pad);
  if (x2 - x1 < 8 || y2 - y1 < 8) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/**
 * Reports when the same multiset of tiles has been seen continuously for `holdMs`
 * (and at least `minFrames` frames), so the scan can stop by itself.
 */
export class LockTracker {
  private key = '';
  private since = 0;
  private frames = 0;
  constructor(private holdMs = 1000, private minFrames = 3) {}

  /** Returns true once the multiset in `tiles` has been stable long enough. */
  push(tiles: number[], now: number): boolean {
    const key = [...tiles].sort((a, b) => a - b).join(',');
    if (key !== this.key) {
      this.key = key;
      this.since = now;
      this.frames = 1;
      return false;
    }
    this.frames++;
    return now - this.since >= this.holdMs && this.frames >= this.minFrames;
  }

  reset(): void { this.key = ''; this.since = 0; this.frames = 0; }
}

/**
 * Order detections the way a player reads a hand: row by row (top to bottom),
 * left to right within a row.
 */
export function orderDetections(dets: Detection[]): Detection[] {
  if (dets.length === 0) return [];
  const heights = dets.map((d) => d.y2 - d.y1).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)];
  const rows: Detection[][] = [];
  for (const d of [...dets].sort((a, b) => (a.y1 + a.y2) - (b.y1 + b.y2))) {
    const cy = (d.y1 + d.y2) / 2;
    const row = rows.find((r) => Math.abs((r[0].y1 + r[0].y2) / 2 - cy) < medianH * 0.6);
    if (row) row.push(d); else rows.push([d]);
  }
  return rows.flatMap((r) => r.sort((a, b) => a.x1 - b.x1));
}

/**
 * Smooths per-frame detections: keeps the last N frames and reports the median
 * count of each tile class, so a single missed frame does not change the hand.
 */
export class HandStabilizer {
  private frames: number[][] = [];
  constructor(private window = 5, private numClasses = 42) {}

  push(dets: Detection[]): number[] {
    const counts = new Array<number>(this.numClasses).fill(0);
    for (const d of dets) counts[d.cls]++;
    this.frames.push(counts);
    if (this.frames.length > this.window) this.frames.shift();
    const out = new Array<number>(this.numClasses).fill(0);
    for (let c = 0; c < this.numClasses; c++) {
      const vals = this.frames.map((f) => f[c]).sort((a, b) => a - b);
      out[c] = vals[Math.floor(vals.length / 2)];
    }
    return out;
  }

  reset(): void { this.frames = []; }
}

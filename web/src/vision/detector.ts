/**
 * On-device tile detector: runs a YOLO-style ONNX model with onnxruntime-web.
 *
 * The model is exported without built-in NMS and outputs [1, 4 + numClasses, N]
 * (cx, cy, w, h, class scores...) in letterboxed input pixel coordinates.
 */
import * as ort from 'onnxruntime-web';
import { TILE_CODES } from '../engine/tiles';
import { nms, type Detection, type Region } from './postprocess';

export { nms, orderDetections, filterBySize, regionOf, HandStabilizer, LockTracker, type Detection, type Region } from './postprocess';


export interface DetectorOptions {
  modelUrl: string;
  inputSize?: number;
  scoreThreshold?: number;
  iouThreshold?: number;
  /** Execution providers in order of preference. */
  providers?: ('webgpu' | 'wasm')[];
  wasmPaths?: string;
}

export type FrameSource = HTMLVideoElement | HTMLCanvasElement | HTMLImageElement | ImageBitmap;

export class TileDetector {
  private session: ort.InferenceSession;
  private canvas: OffscreenCanvas | HTMLCanvasElement;
  private ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  readonly inputSize: number;
  readonly provider: string;
  private scoreThreshold: number;
  private iouThreshold: number;
  private input: Float32Array;
  private busy = false;

  private constructor(session: ort.InferenceSession, provider: string, opts: DetectorOptions) {
    this.session = session;
    this.provider = provider;
    this.inputSize = opts.inputSize ?? TileDetector.modelInputSize(session) ?? 640;
    this.scoreThreshold = opts.scoreThreshold ?? 0.35;
    this.iouThreshold = opts.iouThreshold ?? 0.5;
    const s = this.inputSize;
    this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(s, s) : Object.assign(document.createElement('canvas'), { width: s, height: s });
    const c = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!c) throw new Error('2D canvas context unavailable');
    this.ctx = c as OffscreenCanvasRenderingContext2D;
    this.input = new Float32Array(3 * s * s);
  }

  /** Reads the spatial input size from the model metadata (e.g. [1,3,512,512]). */
  private static modelInputSize(session: ort.InferenceSession): number | null {
    try {
      const meta = (session as unknown as { inputMetadata?: { shape?: unknown[] }[] }).inputMetadata;
      const shape = meta?.[0]?.shape;
      const n = shape?.[shape.length - 1];
      return typeof n === 'number' && n > 0 ? n : null;
    } catch {
      return null;
    }
  }

  static async load(opts: DetectorOptions): Promise<TileDetector> {
    if (opts.wasmPaths) ort.env.wasm.wasmPaths = opts.wasmPaths;
    ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 2);
    const providers = opts.providers ?? (('gpu' in navigator) ? ['webgpu', 'wasm'] : ['wasm']);
    let lastErr: unknown;
    for (const ep of providers) {
      try {
        const session = await ort.InferenceSession.create(opts.modelUrl, {
          executionProviders: [ep],
          graphOptimizationLevel: 'all',
        });
        return new TileDetector(session, ep, opts);
      } catch (e) {
        lastErr = e;
        console.warn(`[detector] ${ep} failed, trying next`, e);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Could not create inference session');
  }

  get isBusy(): boolean { return this.busy; }

  /**
   * Run detection on a frame, or on a sub-rectangle of it when `region` is given
   * (a zoomed second pass). Returns boxes in source pixel coordinates either way.
   */
  async detect(src: FrameSource, srcW: number, srcH: number, region?: Region): Promise<Detection[]> {
    if (this.busy) return [];
    this.busy = true;
    try {
      const s = this.inputSize;
      const r = region ?? { x: 0, y: 0, w: srcW, h: srcH };
      const scale = Math.min(s / r.w, s / r.h);
      const dw = Math.round(r.w * scale);
      const dh = Math.round(r.h * scale);
      const padX = Math.floor((s - dw) / 2);
      const padY = Math.floor((s - dh) / 2);
      const ctx = this.ctx as CanvasRenderingContext2D;
      ctx.fillStyle = '#727272';
      ctx.fillRect(0, 0, s, s);
      ctx.drawImage(src as CanvasImageSource, r.x, r.y, r.w, r.h, padX, padY, dw, dh);
      const img = ctx.getImageData(0, 0, s, s).data;
      const area = s * s;
      const inp = this.input;
      for (let i = 0, p = 0; i < area; i++, p += 4) {
        inp[i] = img[p] / 255;
        inp[i + area] = img[p + 1] / 255;
        inp[i + 2 * area] = img[p + 2] / 255;
      }
      const tensor = new ort.Tensor('float32', inp, [1, 3, s, s]);
      const feeds: Record<string, ort.Tensor> = { [this.session.inputNames[0]]: tensor };
      const out = await this.session.run(feeds);
      const data = out[this.session.outputNames[0]];
      const [, ch, n] = data.dims as number[];
      const arr = data.data as Float32Array;
      const nc = ch - 4;
      const dets: Detection[] = [];
      for (let j = 0; j < n; j++) {
        let best = 0;
        let bestCls = -1;
        for (let k = 0; k < nc; k++) {
          const v = arr[(4 + k) * n + j];
          if (v > best) { best = v; bestCls = k; }
        }
        if (best < this.scoreThreshold) continue;
        const cx = arr[j];
        const cy = arr[n + j];
        const w = arr[2 * n + j];
        const h = arr[3 * n + j];
        dets.push({
          cls: bestCls,
          score: best,
          x1: (cx - w / 2 - padX) / scale + r.x,
          y1: (cy - h / 2 - padY) / scale + r.y,
          x2: (cx + w / 2 - padX) / scale + r.x,
          y2: (cy + h / 2 - padY) / scale + r.y,
        });
      }
      return nms(dets, this.iouThreshold);
    } finally {
      this.busy = false;
    }
  }
}

export function detectionLabel(d: Detection): string {
  return TILE_CODES[d.cls] ?? String(d.cls);
}


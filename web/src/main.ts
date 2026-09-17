import './style.css';
import { planOptions, type PlanOption, type PlanResult } from './engine/planner';
import { DEFAULT_RULES, type Meld, type RuleSet, type ScoreResult } from './engine/scoring';
import { NUM_TILES, WIND_NAMES, WIND_NAMES_ZH, isBonus, isSuited, parseHand, rankOf, sortTiles, type TileId } from './engine/tiles';
import { tileHTML, tilesHTML } from './ui/tiles';
import { loadState, saveState } from './state';
import { startCamera, type CameraHandle } from './vision/camera';
import { HandStabilizer, LockTracker, TileDetector, filterBySize, orderDetections, regionOf, type Detection, type FrameSource } from './vision/detector';

const state = loadState();
const app = document.getElementById('app')!;
app.innerHTML = `
<header class="topbar">
  <h1>Mahjong Fan Planner</h1>
  <span class="spacer"></span>
  <label>Min fan <input id="minFan" type="number" min="0" max="13" inputmode="numeric" /></label>
  <button id="settingsBtn" class="small" aria-label="Table rules">Rules</button>
</header>
<main>
  <section class="card">
    <h2>Camera</h2>
    <div class="viewport" id="viewport">
      <video id="video" playsinline muted></video>
      <canvas id="overlay"></canvas>
      <div class="placeholder" id="placeholder">Start the camera and point it at your tiles,<br/>or choose a photo.</div>
    </div>
    <div class="row" style="margin-top:8px">
      <button id="camBtn" class="primary">Start camera</button>
      <input id="photoInput" type="file" accept="image/*" hidden />
      <button id="photoBtn" type="button">Photo…</button>
      <button id="useBtn" disabled>Use these tiles</button>
      <span id="modelStatus" class="status">Loading detector…</span>
    </div>
    <div id="livePreview" class="tilestrip" style="margin-top:8px"><span class="empty">Detected tiles appear here.</span></div>
  </section>
  <section class="card">
    <div class="row between"><h2>Your hand <span id="handCount" class="status"></span></h2><button id="clearBtn" class="small">Clear</button></div>
    <div id="handStrip" class="tilestrip"></div>
    <div id="meldStrip" class="meldstrip"></div>
    <div id="bonusStrip" class="tilestrip" style="min-height:0"></div>
    <div class="row" style="margin-top:10px">
      <label class="status">Add as
        <select id="addMode">
          <option value="hand">Concealed tile</option>
          <option value="pung">Exposed pung (3)</option>
          <option value="chow">Exposed chow (3, starting at tile)</option>
          <option value="kong">Exposed kong (4)</option>
          <option value="ckong">Concealed kong (4)</option>
        </select>
      </label>
      <span class="row" style="flex:1; flex-wrap:nowrap"><input id="textEntry" class="textentry" placeholder="Or type tiles: 123m 456p 77s EEE C f1" /><button id="applyText" class="small" type="button">Apply</button></span>
    </div>
    <div id="picker" class="picker"></div>
    <p class="hint">Tap a tile in your hand to remove it. Flowers and seasons always go to the bonus row.</p>
  </section>
  <section class="card">
    <h2>How to reach <span id="minFanLabel"></span> fan</h2>
    <div id="analysis"></div>
  </section>
</main>
<dialog id="settings">
  <form method="dialog">
    <h3>Table rules</h3>
    <label>Minimum fan to win <input id="sMinFan" type="number" min="0" max="13" /></label>
    <label>Limit (maximum) fan <select id="sLimit"><option value="10">10</option><option value="13">13</option></select></label>
    <label>Your seat wind <select id="sSeat"></select></label>
    <label>Prevailing (round) wind <select id="sPrev"></select></label>
    <label>Seven Pairs allowed <input id="sSeven" type="checkbox" /></label>
    <label>Detector confidence <input id="sConf" type="range" min="0.2" max="0.8" step="0.05" /></label>
    <div class="row" style="justify-content:flex-end"><button value="cancel">Cancel</button><button value="ok" class="primary">Save</button></div>
  </form>
</dialog>`;

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = app.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};

const els = {
  minFan: $<HTMLInputElement>('#minFan'),
  minFanLabel: $('#minFanLabel'),
  settingsBtn: $('#settingsBtn'),
  settings: $<HTMLDialogElement>('#settings'),
  sMinFan: $<HTMLInputElement>('#sMinFan'),
  sLimit: $<HTMLSelectElement>('#sLimit'),
  sSeat: $<HTMLSelectElement>('#sSeat'),
  sPrev: $<HTMLSelectElement>('#sPrev'),
  sSeven: $<HTMLInputElement>('#sSeven'),
  sConf: $<HTMLInputElement>('#sConf'),
  viewport: $('#viewport'),
  video: $<HTMLVideoElement>('#video'),
  overlay: $<HTMLCanvasElement>('#overlay'),
  camBtn: $<HTMLButtonElement>('#camBtn'),
  photoInput: $<HTMLInputElement>('#photoInput'),
  photoBtn: $<HTMLButtonElement>('#photoBtn'),
  useBtn: $<HTMLButtonElement>('#useBtn'),
  modelStatus: $('#modelStatus'),
  livePreview: $('#livePreview'),
  handCount: $('#handCount'),
  handStrip: $('#handStrip'),
  meldStrip: $('#meldStrip'),
  bonusStrip: $('#bonusStrip'),
  addMode: $<HTMLSelectElement>('#addMode'),
  textEntry: $<HTMLInputElement>('#textEntry'),
  applyText: $<HTMLButtonElement>('#applyText'),
  picker: $('#picker'),
  clearBtn: $('#clearBtn'),
  analysis: $('#analysis'),
};

// ---------- helpers ----------
function rules(): RuleSet {
  return { ...DEFAULT_RULES, limit: state.settings.limit, sevenPairs: state.settings.sevenPairs ? DEFAULT_RULES.sevenPairs : 0 };
}
function meldTiles(m: Meld): TileId[] {
  if (m.kind === 'chow') return [m.tile, m.tile + 1, m.tile + 2];
  return m.kind === 'kong' ? [m.tile, m.tile, m.tile, m.tile] : [m.tile, m.tile, m.tile];
}
function heldCounts(): number[] {
  const c = new Array<number>(42).fill(0);
  for (const t of state.hand.concealed) c[t]++;
  for (const m of state.hand.melds) for (const t of meldTiles(m)) c[t]++;
  for (const t of state.hand.bonus) c[t]++;
  return c;
}
function handTotal(): number { return state.hand.concealed.length + 3 * state.hand.melds.length; }
function persist(): void { saveState(state); }

// ---------- hand editor ----------
function renderHand(): void {
  const h = state.hand;
  els.handStrip.innerHTML = h.concealed.length
    ? sortTiles(h.concealed).map((t) => tileHTML(t, 'clickable')).join('')
    : '<span class="empty">No tiles yet. Scan, type, or tap tiles below.</span>';
  els.meldStrip.innerHTML = h.melds.map((m, i) => `<span class="meld ${m.kind === 'kong' && m.concealed ? 'concealed' : ''}" data-meld="${i}"><small>${m.kind === 'kong' && m.concealed ? 'concealed kong' : m.kind}</small>${tilesHTML(meldTiles(m), 'sm clickable')}</span>`).join('');
  els.bonusStrip.innerHTML = h.bonus.length ? `<span class="status" style="margin-right:6px">Bonus</span>${sortTiles(h.bonus).map((t) => tileHTML(t, 'sm clickable')).join('')}` : '';
  const total = handTotal();
  els.handCount.textContent = `(${total}/13${total === 14 ? ' + drawn tile' : ''})`;
  renderPicker();
  renderAnalysis();
  persist();
}

function renderPicker(): void {
  const held = heldCounts();
  const total = handTotal();
  const mode = els.addMode.value;
  const canAdd = (t: TileId): boolean => {
    if (isBonus(t)) return held[t] === 0;
    if (mode === 'hand') return held[t] < 4 && total < 14;
    if (mode === 'pung') return held[t] <= 1 && total <= 11;
    if (mode === 'chow') return isSuited(t) && rankOf(t) <= 7 && held[t] < 4 && held[t + 1] < 4 && held[t + 2] < 4 && total <= 11;
    return held[t] === 0 && total <= 11; // kongs
  };
  const rows: string[] = [];
  for (let s = 0; s < 3; s++) rows.push(Array.from({ length: 9 }, (_, i) => tileHTML(s * 9 + i, `clickable pick ${canAdd(s * 9 + i) ? '' : 'disabled'}`)).join(''));
  rows.push(`<div class="honors">${Array.from({ length: 7 }, (_, i) => tileHTML(27 + i, `clickable pick ${canAdd(27 + i) ? '' : 'disabled'}`)).join('')}</div>`);
  rows.push(`<div class="honors">${Array.from({ length: 8 }, (_, i) => tileHTML(34 + i, `clickable pick ${canAdd(34 + i) ? '' : 'disabled'}`)).join('')}</div>`);
  els.picker.innerHTML = rows.join('');
}

function addTile(t: TileId): void {
  const h = state.hand;
  const mode = els.addMode.value;
  if (isBonus(t)) { if (!h.bonus.includes(t)) h.bonus.push(t); renderHand(); return; }
  if (mode === 'hand') h.concealed.push(t);
  else if (mode === 'pung') h.melds.push({ kind: 'pung', tile: t });
  else if (mode === 'chow') h.melds.push({ kind: 'chow', tile: t });
  else if (mode === 'kong') h.melds.push({ kind: 'kong', tile: t });
  else h.melds.push({ kind: 'kong', tile: t, concealed: true });
  renderHand();
}

els.picker.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('.tile.pick');
  if (!el || el.classList.contains('disabled')) return;
  addTile(Number(el.dataset.tile));
});
els.handStrip.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('.tile');
  if (!el) return;
  const t = Number(el.dataset.tile);
  const i = state.hand.concealed.indexOf(t);
  if (i >= 0) state.hand.concealed.splice(i, 1);
  renderHand();
});
els.meldStrip.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('.meld');
  if (!el) return;
  state.hand.melds.splice(Number(el.dataset.meld), 1);
  renderHand();
});
els.bonusStrip.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('.tile');
  if (!el) return;
  const i = state.hand.bonus.indexOf(Number(el.dataset.tile));
  if (i >= 0) state.hand.bonus.splice(i, 1);
  renderHand();
});
els.addMode.addEventListener('change', renderPicker);
els.clearBtn.addEventListener('click', () => { state.hand = { concealed: [], melds: [], bonus: [] }; renderHand(); });
function applyText(): void {
  if (!els.textEntry.value.trim()) return;
  try {
    const tiles = parseHand(els.textEntry.value);
    state.hand.concealed = tiles.filter((t) => t < NUM_TILES);
    state.hand.bonus = tiles.filter(isBonus);
    els.textEntry.value = '';
    renderHand();
  } catch (err) {
    els.textEntry.setCustomValidity(String((err as Error).message));
    els.textEntry.reportValidity();
    setTimeout(() => els.textEntry.setCustomValidity(''), 1500);
  }
}
els.textEntry.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyText(); });
els.textEntry.addEventListener('change', applyText);
els.applyText.addEventListener('click', applyText);

// ---------- analysis ----------
function awayText(o: PlanOption): string {
  if (o.shanten < 0) return 'Complete';
  if (o.shanten === 0) return 'Ready — waiting';
  return `${o.tilesAway} tiles away`;
}
function optionHTML(o: PlanOption, mustDiscard: boolean, cls: string): string {
  const itemChips = o.items.map((i) => `<span class="chip ${i.fan >= 3 ? 'main' : ''}">${i.nameZh} ${i.name} +${i.fan}</span>`).join('');
  const discardLbl = mustDiscard ? 'Discard' : 'Not needed';
  const shownDiscards = mustDiscard ? o.discards.slice(0, 3) : o.discards.slice(0, 8);
  const moreDiscards = !mustDiscard && o.discards.length > 8 ? `<span class="hint">+${o.discards.length - 8} more</span>` : '';
  const discards = o.discards.length ? `<div class="line"><span class="lbl">${discardLbl}</span>${tilesHTML(shownDiscards, 'sm')}${mustDiscard && o.discards.length > 1 ? '<span class="hint">(any of these)</span>' : ''}${moreDiscards}</div>` : '';
  const MAX_DRAWS = 12;
  const shownDraws = o.draws.slice(0, MAX_DRAWS);
  const moreDraws = o.draws.length > MAX_DRAWS ? `<span class="hint">+${o.draws.length - MAX_DRAWS} more</span>` : '';
  const draws = o.draws.length ? `<div class="line"><span class="lbl">Draw</span>${shownDraws.map((d) => `<span class="draw">${tileHTML(d.tile, 'sm')}<sub>×${d.remaining}</sub></span>`).join('')}${moreDraws}</div>` : '';
  const selfDraw = o.fanSelfDraw > o.fan ? ` <small>(${o.fanSelfDraw} if self-drawn)</small>` : '';
  const conc = o.requiresConcealed ? '<span class="hint">Counts on staying concealed (no calls).</span>' : '';
  return `<article class="option ${cls}"><header><span class="away ${o.shanten <= 0 ? 'ready' : ''}">${awayText(o)}</span><span class="fan">${o.fan} fan${selfDraw}</span></header><h3>${o.title}</h3><div class="items">${itemChips}</div>${discards}${draws}${conc}</article>`;
}
function completeHTML(r: ScoreResult, minFan: number): string {
  const ok = r.fan >= minFan;
  const list = r.items.map((i) => `<li>${i.nameZh} ${i.name}: +${i.fan}</li>`).join('');
  return `<div class="complete ${ok ? '' : 'short'}"><strong>${ok ? 'Winning hand' : 'Complete shape, but below the minimum'}: ${r.fan} fan${r.limitHand ? ' (limit hand)' : ''}</strong><div class="hint">${ok ? `Meets the ${minFan} fan minimum. Self-draw adds +${DEFAULT_RULES.selfDraw}.` : `You need ${minFan} fan; keep building toward one of the options below.`}</div><ul>${list}</ul></div>`;
}
let lastPlan: PlanResult | null = null;
function renderAnalysis(): void {
  const s = state.settings;
  els.minFanLabel.textContent = String(s.minFan);
  els.minFan.value = String(s.minFan);
  const total = handTotal();
  if (total < 13) { els.analysis.innerHTML = `<p class="note">Add ${13 - total} more tile${13 - total === 1 ? '' : 's'} (13 in hand, or 14 with a drawn tile) to see options.</p>`; return; }
  if (total > 14) { els.analysis.innerHTML = '<p class="note">Too many tiles: a hand is 13 tiles plus at most one drawn tile.</p>'; return; }
  const t0 = performance.now();
  const plan = planOptions(state.hand, { seatWind: s.seatWind, prevailingWind: s.prevailingWind, minFan: s.minFan, rules: rules(), maxOptions: 8 });
  lastPlan = plan;
  const ms = performance.now() - t0;
  let html = '';
  if (plan.complete?.valid) html += completeHTML(plan.complete, s.minFan);
  if (plan.options.length) {
    html += `<div class="section-title">Options that reach ${s.minFan} fan</div>` + plan.options.map((o) => optionHTML(o, plan.mustDiscard, 'ok')).join('');
  } else {
    html += `<p class="note">No pattern reaches ${s.minFan} fan from this hand within reach.</p>`;
  }
  if (plan.nearMisses.length) html += '<div class="section-title">Reach the minimum only with self-draw</div>' + plan.nearMisses.map((o) => optionHTML(o, plan.mustDiscard, 'near')).join('');
  if (!plan.options.length && plan.fallback.length) html += '<div class="section-title">Closest hands (below minimum)</div>' + plan.fallback.map((o) => optionHTML(o, plan.mustDiscard, '')).join('');
  html += `<p class="hint">Seat wind ${WIND_NAMES_ZH[s.seatWind]} ${WIND_NAMES[s.seatWind]}, prevailing ${WIND_NAMES_ZH[s.prevailingWind]} ${WIND_NAMES[s.prevailingWind]}. Analysed in ${ms.toFixed(0)} ms.</p>`;
  els.analysis.innerHTML = html;
}
void lastPlan;

// ---------- settings ----------
for (const sel of [els.sSeat, els.sPrev]) sel.innerHTML = WIND_NAMES.map((w, i) => `<option value="${i}">${WIND_NAMES_ZH[i]} ${w}</option>`).join('');
els.settingsBtn.addEventListener('click', () => {
  const s = state.settings;
  els.sMinFan.value = String(s.minFan);
  els.sLimit.value = String(s.limit);
  els.sSeat.value = String(s.seatWind);
  els.sPrev.value = String(s.prevailingWind);
  els.sSeven.checked = s.sevenPairs;
  els.sConf.value = String(s.confidence);
  els.settings.showModal();
});
els.settings.addEventListener('close', () => {
  if (els.settings.returnValue !== 'ok') return;
  state.settings = {
    minFan: clamp(Number(els.sMinFan.value), 0, 13),
    limit: Number(els.sLimit.value),
    seatWind: Number(els.sSeat.value),
    prevailingWind: Number(els.sPrev.value),
    sevenPairs: els.sSeven.checked,
    confidence: Number(els.sConf.value),
  };
  persist();
  renderAnalysis();
});
els.minFan.addEventListener('change', () => {
  state.settings.minFan = clamp(Number(els.minFan.value) || 0, 0, 13);
  persist();
  renderAnalysis();
});
function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }

// ---------- camera + detector ----------
let detector: TileDetector | null = null;
let camera: CameraHandle | null = null;
let running = false;
const stabilizer = new HandStabilizer(5);
// The scan stops by itself once a full hand (13 or 14 tiles) has read the same for a second.
const locker = new LockTracker(1000, 3);
let candidateTiles: TileId[] = [];
let lastOrdered: TileId[] = [];

/**
 * Detection with a zoomed second pass: after a full-frame pass, re-run the model on just
 * the area holding the tiles so each tile covers more pixels. Size outliers (cards, boxes,
 * chips in the background) are dropped in both passes.
 */
async function detectSmart(src: FrameSource, w: number, h: number): Promise<Detection[]> {
  if (!detector) return [];
  let dets = filterBySize(await detector.detect(src, w, h));
  const region = regionOf(dets, w, h, 1);
  if (region && dets.length >= 4 && region.w * region.h < 0.6 * w * h) {
    const zoomed = filterBySize(await detector.detect(src, w, h, region));
    if (zoomed.length >= dets.length) dets = zoomed;
  }
  return dets;
}

async function loadDetector(): Promise<void> {
  const url = `${import.meta.env.BASE_URL}models/tiles.onnx`;
  try {
    const head = await fetch(url, { method: 'HEAD' });
    if (!head.ok || (head.headers.get('content-type') ?? '').includes('text/html')) throw new Error('model missing');
    // Vite dev cannot import modules from /public, so use the package files there; the build serves /ort/.
    const wasmPaths = import.meta.env.DEV ? '/node_modules/onnxruntime-web/dist/' : `${import.meta.env.BASE_URL}ort/`;
    detector = await TileDetector.load({ modelUrl: url, wasmPaths, scoreThreshold: state.settings.confidence });
    els.modelStatus.textContent = `Detector ready (${detector.provider === 'webgpu' ? 'GPU' : 'CPU'}, ${detector.inputSize} px)`;
  } catch (e) {
    console.warn(e);
    els.modelStatus.textContent = 'Detector model not installed — enter tiles manually.';
  }
}

function setCandidates(tiles: TileId[]): void {
  candidateTiles = tiles;
  els.livePreview.innerHTML = tiles.length ? tilesHTML(tiles, 'sm') : '<span class="empty">No tiles detected yet.</span>';
  els.useBtn.disabled = tiles.length === 0;
}

function drawDetections(dets: Detection[], w: number, h: number, background?: CanvasImageSource): void {
  const c = els.overlay;
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  if (background) ctx.drawImage(background, 0, 0, w, h);
  const lw = Math.max(2, Math.round(w / 320));
  ctx.lineWidth = lw;
  ctx.font = `${Math.max(12, Math.round(w / 40))}px -apple-system, sans-serif`;
  for (const d of dets) {
    const color = d.cls >= 34 ? '#f1c40f' : d.cls >= 27 ? '#ffffff' : d.cls >= 18 ? '#2ecc71' : d.cls >= 9 ? '#3498db' : '#e74c3c';
    ctx.strokeStyle = color;
    ctx.strokeRect(d.x1, d.y1, d.x2 - d.x1, d.y2 - d.y1);
    const label = labelFor(d.cls);
    const tw = ctx.measureText(label).width + 8;
    const th = Math.max(14, Math.round(w / 34));
    ctx.fillStyle = color;
    ctx.fillRect(d.x1, Math.max(0, d.y1 - th), tw, th);
    ctx.fillStyle = '#000';
    ctx.fillText(label, d.x1 + 4, Math.max(th - 4, d.y1 - 4));
  }
}
const LABELS = ['一萬', '二萬', '三萬', '四萬', '五萬', '六萬', '七萬', '八萬', '九萬', '1筒', '2筒', '3筒', '4筒', '5筒', '6筒', '7筒', '8筒', '9筒', '1索', '2索', '3索', '4索', '5索', '6索', '7索', '8索', '9索', '東', '南', '西', '北', '中', '發', '白', '梅', '蘭', '菊', '竹', '春', '夏', '秋', '冬'];
function labelFor(cls: number): string { return LABELS[cls] ?? String(cls); }

async function loop(): Promise<void> {
  if (!running || !camera || !detector) return;
  const v = els.video;
  if (v.readyState >= 2 && !detector.isBusy) {
    try {
      const dets = await detectSmart(v, v.videoWidth, v.videoHeight);
      drawDetections(dets, v.videoWidth, v.videoHeight);
      const counts = stabilizer.push(dets);
      lastOrdered = orderDetections(dets).map((d) => d.cls);
      const tiles: TileId[] = [];
      counts.forEach((n, t) => { for (let k = 0; k < n; k++) tiles.push(t); });
      const stdCount = tiles.filter((t) => t < NUM_TILES).length;
      // With more tiles in view than a hand holds, keep the reading order of the latest frame.
      setCandidates(stdCount > 14 ? lastOrdered : tiles);
      const fullHand = stdCount === 13 || stdCount === 14;
      const stable = locker.push(tiles, performance.now());
      if (fullHand && stable && lastOrdered.length === tiles.length) {
        lockScan(dets, lastOrdered);
        return;
      }
      if (!fullHand) locker.reset();
      els.modelStatus.textContent = fullHand ? 'Hold still…' : `Scanning: ${stdCount} tiles in view`;
    } catch (e) {
      console.error(e);
      els.modelStatus.textContent = `Detector error: ${(e as Error).message}`;
      running = false;
    }
  }
  if (running) setTimeout(() => void loop(), 60);
}

/** Freeze the current frame with its boxes, stop the camera and hand the tiles to the analysis. */
function lockScan(dets: Detection[], ordered: TileId[]): void {
  const v = els.video;
  drawDetections(dets, v.videoWidth, v.videoHeight, v);
  stopCam(true);
  els.viewport.classList.add('live');
  els.video.style.display = 'none';
  els.camBtn.textContent = 'Rescan';
  setCandidates(ordered);
  applyCandidates();
  const std = ordered.filter((t) => t < NUM_TILES).length;
  els.modelStatus.textContent = `Locked ${std} tiles. Fix any misread tile below, or tap Rescan.`;
  if (navigator.vibrate) navigator.vibrate(60);
}

async function startCam(): Promise<void> {
  try {
    els.camBtn.disabled = true;
    camera = await startCamera(els.video);
    els.viewport.classList.add('live');
    els.video.style.display = '';
    els.camBtn.textContent = 'Stop camera';
    stabilizer.reset();
    locker.reset();
    running = true;
    if (!detector) els.modelStatus.textContent = 'Camera on, but no detector model installed.';
    void loop();
  } catch (e) {
    els.modelStatus.textContent = `Camera error: ${(e as Error).message}`;
  } finally {
    els.camBtn.disabled = false;
  }
}
function stopCam(keepOverlay = false): void {
  running = false;
  camera?.stop();
  camera = null;
  els.viewport.classList.remove('live');
  els.camBtn.textContent = 'Start camera';
  if (!keepOverlay) {
    const ctx = els.overlay.getContext('2d');
    ctx?.clearRect(0, 0, els.overlay.width, els.overlay.height);
  }
}
els.camBtn.addEventListener('click', () => { if (camera) stopCam(); else void startCam(); });

els.photoBtn.addEventListener('click', () => els.photoInput.click());
async function analysePhoto(blob: Blob): Promise<void> {
  if (camera) stopCam();
  const bmp = await createImageBitmap(blob);
  els.viewport.classList.add('live');
  els.video.style.display = 'none';
  if (!detector) { drawDetections([], bmp.width, bmp.height, bmp); els.modelStatus.textContent = 'No detector model installed.'; return; }
  els.modelStatus.textContent = 'Detecting…';
  const t0 = performance.now();
  const dets = orderDetections(await detectSmart(bmp, bmp.width, bmp.height));
  const ms = Math.round(performance.now() - t0);
  drawDetections(dets, bmp.width, bmp.height, bmp);
  setCandidates(dets.map((d) => d.cls));
  els.modelStatus.textContent = `Found ${dets.length} tile${dets.length === 1 ? '' : 's'} in ${ms} ms (${detector.provider === 'webgpu' ? 'GPU' : 'CPU'}, ${detector.inputSize} px).`;
}
els.photoInput.addEventListener('change', async () => {
  const file = els.photoInput.files?.[0];
  if (!file) return;
  await analysePhoto(file);
  els.photoInput.value = '';
});
// Dev aid: ?img=<url> analyses an image without the file picker.
const imgParam = new URLSearchParams(location.search).get('img');

function applyCandidates(): void {
  const std = candidateTiles.filter((t) => t < NUM_TILES);
  const bonus = candidateTiles.filter(isBonus);
  const room = Math.max(0, 14 - 3 * state.hand.melds.length);
  state.hand.concealed = std.slice(0, room);
  state.hand.bonus = [...new Set(bonus)];
  renderHand();
  els.analysis.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
els.useBtn.addEventListener('click', applyCandidates);

// ---------- boot ----------
renderHand();
void loadDetector().then(async () => {
  if (imgParam) {
    const res = await fetch(imgParam);
    if (res.ok) await analysePhoto(await res.blob());
  }
});

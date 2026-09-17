import type { Hand } from './engine/scoring';

export interface Settings {
  minFan: number;
  limit: number;
  seatWind: number;
  prevailingWind: number;
  sevenPairs: boolean;
  /** Detector confidence threshold. */
  confidence: number;
}

export interface AppState { settings: Settings; hand: Hand }

const KEY = 'mahjong-ar-state-v1';

export const DEFAULT_SETTINGS: Settings = {
  minFan: 3, limit: 13, seatWind: 0, prevailingWind: 0, sevenPairs: true, confidence: 0.4,
};

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<AppState>;
      return {
        settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) },
        hand: { concealed: p.hand?.concealed ?? [], melds: p.hand?.melds ?? [], bonus: p.hand?.bonus ?? [] },
      };
    }
  } catch { /* ignore */ }
  return { settings: { ...DEFAULT_SETTINGS }, hand: { concealed: [], melds: [], bonus: [] } };
}

export function saveState(s: AppState): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

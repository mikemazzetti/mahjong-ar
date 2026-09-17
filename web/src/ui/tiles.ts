import { TILE_NAMES_EN, isBonus, isDragon, isFlower, isSuited, isWind, rankOf, suitOf, type TileId } from '../engine/tiles';

const SUIT_CHAR = { m: '萬', p: '筒', s: '索' } as const;
const HONOR_CHAR = ['東', '南', '西', '北', '中', '發', '白'];
const BONUS_CHAR = ['梅', '蘭', '菊', '竹', '春', '夏', '秋', '冬'];

/** Render a tile as an inline HTML element. */
export function tileHTML(t: TileId, extra = ''): string {
  const name = TILE_NAMES_EN[t] ?? '';
  if (isSuited(t)) {
    const s = suitOf(t)!;
    return `<span class="tile suit-${s} ${extra}" data-tile="${t}" title="${name}"><b>${rankOf(t)}</b><i>${SUIT_CHAR[s]}</i></span>`;
  }
  if (isWind(t)) return `<span class="tile wind ${extra}" data-tile="${t}" title="${name}"><b class="big">${HONOR_CHAR[t - 27]}</b></span>`;
  if (isDragon(t)) {
    const cls = t === 31 ? 'red' : t === 32 ? 'green' : 'white';
    return `<span class="tile dragon-${cls} ${extra}" data-tile="${t}" title="${name}"><b class="big">${HONOR_CHAR[t - 27]}</b></span>`;
  }
  if (isBonus(t)) {
    return `<span class="tile bonus ${extra}" data-tile="${t}" title="${name}"><b class="big">${BONUS_CHAR[t - 34]}</b><i>${isFlower(t) ? '花' : '季'}</i></span>`;
  }
  return `<span class="tile ${extra}" data-tile="${t}">?</span>`;
}

export function tilesHTML(tiles: TileId[], extra = ''): string {
  return tiles.map((t) => tileHTML(t, extra)).join('');
}

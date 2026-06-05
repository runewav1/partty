import type { IBufferCell } from "@xterm/xterm";

/** Standard xterm 256-color cube + grayscale (indices 16–255). */
export function paletteIndexToRgb(index: number): [number, number, number] {
  if (index < 0) return [180, 180, 188];
  if (index < 16) {
    const table: [number, number, number][] = [
      [0, 0, 0],
      [205, 49, 49],
      [13, 188, 121],
      [229, 190, 0],
      [36, 114, 200],
      [188, 63, 188],
      [17, 168, 205],
      [229, 229, 229],
      [102, 102, 102],
      [241, 76, 76],
      [35, 209, 139],
      [245, 245, 67],
      [59, 142, 234],
      [214, 112, 214],
      [41, 184, 219],
      [229, 229, 229],
    ];
    return table[index] ?? [200, 200, 208];
  }
  if (index >= 232) {
    const g = 8 + (index - 232) * 10;
    return [g, g, g];
  }
  let i = index - 16;
  const r = Math.floor(i / 36) % 6;
  const g = Math.floor(i / 6) % 6;
  const b = i % 6;
  const v = [0, 95, 135, 175, 215, 255];
  return [v[r]!, v[g]!, v[b]!];
}

function fgRgb(cell: IBufferCell, defaultRgb: [number, number, number]): [number, number, number] {
  if (cell.isFgRGB()) {
    const c = cell.getFgColor();
    return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  }
  if (cell.isFgPalette()) {
    return paletteIndexToRgb(cell.getFgColor());
  }
  return defaultRgb;
}

function bgRgb(cell: IBufferCell, defaultRgb: [number, number, number]): [number, number, number] {
  if (cell.isBgRGB()) {
    const c = cell.getBgColor();
    return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  }
  if (cell.isBgPalette()) {
    return paletteIndexToRgb(cell.getBgColor());
  }
  return defaultRgb;
}

/** Pick a visible “ink” color for minimap pixels (handles inverse video). */
export function cellInkRgb(
  cell: IBufferCell,
  defaultFg: [number, number, number],
  defaultBg: [number, number, number],
): [number, number, number] {
  if (cell.isInverse()) {
    return bgRgb(cell, defaultBg);
  }
  return fgRgb(cell, defaultFg);
}

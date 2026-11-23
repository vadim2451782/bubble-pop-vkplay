/**
 * Hexagonal bubble grid.
 *
 * Layout: even rows (0, 2, 4...) hold COLS cells and start at the left edge.
 * Odd rows are shifted right by one radius and hold COLS - 1 cells, producing
 * the classic staggered brick pattern of bubble shooters.
 *
 * A cell stores a colour id (string) or null. The module is pure: no DOM.
 */
import { COLS, COLORS } from './config.js';

export const ROW_WIDTH = (r) => (r % 2 === 0 ? COLS : COLS - 1);

/** Neighbour offsets depend on the row parity. */
export function neighborsOf(r, c) {
  if (r % 2 === 0) {
    return [
      [r, c - 1],
      [r, c + 1],
      [r - 1, c - 1],
      [r - 1, c],
      [r + 1, c - 1],
      [r + 1, c],
    ];
  }
  return [
    [r, c - 1],
    [r, c + 1],
    [r - 1, c],
    [r - 1, c + 1],
    [r + 1, c],
    [r + 1, c + 1],
  ];
}

const CHAR_TO_COLOR = Object.fromEntries(COLORS.map((c, i) => [String(i + 1), c.id]));

/** Parse one pattern row ("1122..3") into colour ids. */
export function parsePatternRow(row) {
  return [...row].map((ch) => (ch === '.' || ch === ' ' ? null : CHAR_TO_COLOR[ch] || null));
}

/** Remove bubbles that are not connected to the ceiling. Used while designing
 *  levels so no level can start with floating pieces. */
export function connectPattern(pattern) {
  const rows = pattern.map(parsePatternRow);
  const seen = new Set();
  const queue = [];
  rows.forEach((row, c) => {
    if (row[c]) {
      seen.add(`0:${c}`);
      queue.push([0, c]);
    }
  });
  while (queue.length) {
    const [r, c] = queue.pop();
    for (const [nr, nc] of neighborsOf(r, c)) {
      if (nr < 0 || nr >= rows.length) continue;
      if (nc < 0 || nc >= rows[nr].length) continue;
      if (!rows[nr][nc]) continue;
      const key = `${nr}:${nc}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push([nr, nc]);
    }
  }
  return rows.map((row, r) =>
    row.map((color, c) => (color && seen.has(`${r}:${c}`) ? color : null)),
  );
}

export class BubbleGrid {
  constructor(layout = null) {
    this.layout = layout;
    this.rows = [];
    const maxRows = Math.max(1, layout?.maxRows || 20);
    for (let r = 0; r < maxRows; r += 1) this.rows.push(new Array(ROW_WIDTH(r)).fill(null));
  }

  static fromPattern(layout, pattern) {
    const grid = new BubbleGrid(layout);
    pattern.forEach((row, r) => {
      grid.ensureRow(r);
      let c = 0;
      for (const color of parsePatternRow(row)) {
        if (c >= grid.rows[r].length) break;
        grid.rows[r][c] = color;
        c += 1;
      }
    });
    return grid;
  }

  ensureRow(r) {
    while (this.rows.length <= r) {
      this.rows.push(new Array(ROW_WIDTH(this.rows.length)).fill(null));
    }
  }

  /**
   * Grow the grid to a new row budget. The board is allocated once, from the
   * layout that existed when the level started; after the player resizes the
   * window (or enters fullscreen) the layout allows more rows, and without
   * this the stack simply cannot descend any further — the level then never
   * reaches the danger line and never ends.
   */
  ensureCapacity(count) {
    const want = Math.max(1, Math.round(Number(count) || 0));
    while (this.rows.length < want) {
      this.rows.push(new Array(ROW_WIDTH(this.rows.length)).fill(null));
    }
    return this.rows.length;
  }

  inBounds(r, c) {
    return r >= 0 && r < this.rows.length && c >= 0 && c < this.rows[r].length;
  }

  get(r, c) {
    return this.inBounds(r, c) ? this.rows[r][c] : null;
  }

  set(r, c, color) {
    if (!this.inBounds(r, c)) return false;
    this.rows[r][c] = color;
    return true;
  }

  add(r, c, color) {
    this.ensureRow(r);
    if (c < 0 || c >= this.rows[r].length) return false;
    if (this.rows[r][c]) return false;
    this.rows[r][c] = color;
    return true;
  }

  removeCells(cells) {
    for (const { r, c } of cells) {
      if (this.inBounds(r, c)) this.rows[r][c] = null;
    }
  }

  count() {
    let n = 0;
    for (const row of this.rows) for (const cell of row) if (cell) n += 1;
    return n;
  }

  colorsPresent() {
    const set = new Set();
    for (const row of this.rows) for (const cell of row) if (cell) set.add(cell);
    return [...set];
  }

  forEachOccupied(fn) {
    this.rows.forEach((row, r) => {
      row.forEach((color, c) => {
        if (color) fn(color, r, c);
      });
    });
  }

  neighbors(r, c) {
    return neighborsOf(r, c).filter(([nr, nc]) => this.inBounds(nr, nc));
  }

  emptyNeighbors(r, c) {
    return this.neighbors(r, c).filter(([nr, nc]) => !this.rows[nr][nc]);
  }

  hasOccupiedNeighbor(r, c) {
    return this.neighbors(r, c).some(([nr, nc]) => this.rows[nr][nc]);
  }

  /** All cells of the same colour connected to (r, c), including itself. */
  sameColorCells(r, c) {
    const color = this.get(r, c);
    if (!color) return [];
    const seen = new Set([`${r}:${c}`]);
    const stack = [[r, c]];
    const cells = [];
    while (stack.length) {
      const [cr, cc] = stack.pop();
      cells.push({ r: cr, c: cc });
      for (const [nr, nc] of this.neighbors(cr, cc)) {
        const key = `${nr}:${nc}`;
        if (seen.has(key)) continue;
        if (this.rows[nr][nc] === color) {
          seen.add(key);
          stack.push([nr, nc]);
        }
      }
    }
    return cells;
  }

  /** Occupied bubbles that lost their connection to the ceiling. */
  findFloating() {
    const seen = new Set();
    const stack = [];
    this.rows[0].forEach((color, c) => {
      if (color) {
        seen.add(`0:${c}`);
        stack.push([0, c]);
      }
    });
    while (stack.length) {
      const [r, c] = stack.pop();
      for (const [nr, nc] of this.neighbors(r, c)) {
        if (!this.rows[nr][nc]) continue;
        const key = `${nr}:${nc}`;
        if (seen.has(key)) continue;
        seen.add(key);
        stack.push([nr, nc]);
      }
    }
    const floating = [];
    this.forEachOccupied((color, r, c) => {
      if (!seen.has(`${r}:${c}`)) floating.push({ r, c });
    });
    return floating;
  }

  /** Highest occupied row index, or -1 for an empty board. */
  lowestRow() {
    for (let r = this.rows.length - 1; r >= 0; r -= 1) {
      if (this.rows[r].some(Boolean)) return r;
    }
    return -1;
  }

  cloneRows() {
    return this.rows.map((row) => row.slice());
  }
}

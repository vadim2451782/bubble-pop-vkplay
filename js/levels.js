/**
 * Level catalogue. Every level is built deterministically from a shape mask and
 * a colour pattern, then cleaned up so that no bubble starts disconnected from
 * the ceiling. Row strings use digits 1..6 for colours and '.' for an empty cell.
 */
import { COLS, COLORS, MAX_LEVEL } from './config.js';
import { connectPattern } from './grid.js';

const ROW_WIDTH = (r) => (r % 2 === 0 ? COLS : COLS - 1);
const MID = (w) => (w - 1) / 2;

/** Ten themed worlds of ten levels each are repeated as chapters: 100 worlds,
 *  1000 levels in total. Level map groups them by world. */
export const LEVELS_PER_WORLD = 10;

const BASE_WORLDS = [
  { name: 'Карамельная бухта', icon: 'i-world-sweet', tint: 'rgba(255, 143, 177, 0.16)', glow: 'rgba(255, 143, 177, 0.42)' },
  { name: 'Мыльная роща', icon: 'i-world-bubble', tint: 'rgba(126, 231, 200, 0.14)', glow: 'rgba(126, 231, 200, 0.4)' },
  { name: 'Радужные горы', icon: 'i-rainbow', tint: 'rgba(178, 141, 255, 0.16)', glow: 'rgba(178, 141, 255, 0.42)' },
  { name: 'Леденцовый сад', icon: 'i-world-candy', tint: 'rgba(255, 209, 102, 0.15)', glow: 'rgba(255, 209, 102, 0.42)' },
  { name: 'Пузырьковый город', icon: 'i-world-city', tint: 'rgba(110, 199, 245, 0.15)', glow: 'rgba(110, 199, 245, 0.4)' },
  { name: 'Космические пузыри', icon: 'i-world-planet', tint: 'rgba(167, 139, 250, 0.17)', glow: 'rgba(167, 139, 250, 0.44)' },
  { name: 'Подводный мир', icon: 'i-world-fish', tint: 'rgba(45, 212, 191, 0.15)', glow: 'rgba(45, 212, 191, 0.4)' },
  { name: 'Замок сладостей', icon: 'i-world-castle', tint: 'rgba(244, 114, 182, 0.15)', glow: 'rgba(244, 114, 182, 0.42)' },
  { name: 'Облачный край', icon: 'i-world-cloud', tint: 'rgba(165, 180, 252, 0.16)', glow: 'rgba(165, 180, 252, 0.42)' },
  { name: 'Звёздная фиеста', icon: 'i-world-party', tint: 'rgba(255, 224, 102, 0.15)', glow: 'rgba(255, 224, 102, 0.45)' },
];

const WORLD_COUNT = Math.ceil(MAX_LEVEL / LEVELS_PER_WORLD);

export const WORLDS = Array.from({ length: WORLD_COUNT }, (_, chapter) => {
  const base = BASE_WORLDS[chapter % BASE_WORLDS.length];
  const cycle = Math.floor(chapter / BASE_WORLDS.length);
  return {
    ...base,
    name: cycle === 0 ? base.name : `${base.name} · ${cycle + 1}`,
  };
});

/* ------------------------------------------------------------------ shapes */

const SHAPES = {
  full: () => true,

  pyramid: (r, c, w) => {
    if (r === 0) return true;
    return Math.abs(c - MID(w)) <= (w - 1) / 2 - r * 0.8;
  },

  diamond: (r, c, w) => {
    const d = Math.abs(c - MID(w));
    const grow = Math.min(5.6, 1.4 + r * 1.1);
    const shrink = r > 4 ? (r - 4) * 1.15 : 0;
    return d <= grow - shrink;
  },

  columns: (r, c) => c % 3 !== 2,

  wave: (r, c) => r <= 2 + Math.round(2.4 + 2.2 * Math.sin(c * 0.8 + 0.5)),

  ring: (r, c, w) => !(r >= 2 && r <= 4 && c >= 3 && c <= w - 4),

  shield: (r, c, w, rows) => {
    if (r <= 2) return true;
    const t = (r - 2) / Math.max(1, rows - 2);
    return Math.abs(c - MID(w)) <= (w / 2) * (1 - t * 0.88);
  },

  zigzag: (r, c) => r <= 2 + (Math.floor(c / 2) % 2 ? 2 : 4),

  towers: (r, c, w) => c <= 2 || c >= w - 3 || r <= 1,

  bowl: (r, c, w) => r <= 1 || c <= 2 || c >= w - 3,

  honeycomb: (r, c) =>
    !((r % 2 === 0 && c % 4 === 2) || (r % 2 === 1 && c % 4 === 0)),

  star: (r, c, w) => {
    if (r <= 1) return true;
    const dx = (c - MID(w)) / (w / 2);
    const dy = (r - 2.4) / 6;
    const dist = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const edge = 0.58 + 0.3 * Math.cos(5 * angle - Math.PI / 2);
    return dist <= edge;
  },

  arch: (r, c, w) => {
    const nx = Math.abs(c - MID(w)) / (w / 2);
    return r <= 2 + nx * 1.6 || (r <= 6 && nx < 0.34);
  },

  maze: (r, c) =>
    !(r > 1 && (r + Math.floor(c / 2)) % 3 === 0 && c % 3 !== 0),

  butterfly: (r, c, w) => {
    if (r <= 1) return true;
    return Math.abs(c - MID(w)) > 1.2;
  },

  snowflake: (r, c, w) => {
    if (r <= 1) return true;
    const d = Math.abs(c - MID(w));
    if (d < 1.6) return true;
    if (r % 3 === 0) return true;
    return d > w / 2 - 1.4;
  },

  vortex: (r, c, w) => {
    if (r <= 1) return true;
    return (r + Math.round(Math.abs(c - MID(w)))) % 4 !== 3;
  },

  fortress: (r, c, w) => {
    if (r <= 1) return true;
    if (c <= 1 || c >= w - 2) return true;
    if (r >= 4 && r <= 6 && c >= 3 && c <= w - 4) return true;
    return r <= 3;
  },

  crystal: (r, c, w) => {
    const half = Math.min(5.5, 1.4 + r * 0.95);
    return Math.abs(c - MID(w)) <= half && !(r > 2 && (r + c) % 4 === 0);
  },

  ocean: (r, c) => {
    if (r <= 2) return true;
    if (r > 8) return false;
    const bottom = 4 + Math.round(1.7 * Math.sin(c * 0.9 + 1));
    return r <= bottom;
  },

  space: (r, c) => {
    if (r <= 1) return true;
    return !((r + c * 3) % 7 === 0 && r > 2);
  },
};

/* ---------------------------------------------------------------- palettes */

function hash(r, c, seed) {
  let h = (seed ^ Math.imul(r + 17, 374761393) ^ Math.imul(c + 31, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

const COLOR_STYLES = {
  groups: (r, c, n) => (Math.floor(r / 2) + Math.floor(c / 3)) % n,
  checker: (r, c, n) => (r + c) % n,
  diagonal: (r, c, n) => (r + c * 2) % n,
  vertical: (r, c, n) => Math.floor(c / 2) % n,
  rings: (r, c, n) => (Math.abs(c - MID(COLS)) + r) % n,
  mosaic: (r, c, n, seed) => hash(r, c, seed) % n,
  spiral: (r, c, n) => (r + Math.round(Math.abs(c - MID(COLS)) * 0.8)) % n,
  waves: (r, c, n) => (r + Math.floor(c / 3)) % n,
};

/* ------------------------------------------------------------------- specs */

const SPECS = [
  { name: 'Первый залп', rows: 4, colors: 3, shape: 'full', style: 'groups', shots: 34 },
  { name: 'Радужный старт', rows: 5, colors: 3, shape: 'full', style: 'checker', shots: 38 },
  { name: 'Шахматный двор', rows: 5, colors: 4, shape: 'full', style: 'checker', shots: 38 },
  { name: 'Пирамида', rows: 6, colors: 4, shape: 'pyramid', style: 'groups', shots: 36 },
  { name: 'Алмаз', rows: 7, colors: 4, shape: 'diamond', style: 'diagonal', shots: 36 },
  { name: 'Колонны', rows: 7, colors: 4, shape: 'columns', style: 'vertical', shots: 36 },
  { name: 'Волны', rows: 7, colors: 4, shape: 'wave', style: 'groups', shots: 38 },
  { name: 'Кольцо', rows: 7, colors: 5, shape: 'ring', style: 'rings', shots: 36 },
  { name: 'Щит', rows: 8, colors: 5, shape: 'shield', style: 'diagonal', shots: 38 },
  { name: 'Зигзаг', rows: 8, colors: 5, shape: 'zigzag', style: 'checker', shots: 40 },
  { name: 'Две башни', rows: 8, colors: 5, shape: 'towers', style: 'groups', shots: 38 },
  { name: 'Чаша', rows: 8, colors: 5, shape: 'bowl', style: 'mosaic', shots: 40 },
  { name: 'Соты', rows: 8, colors: 5, shape: 'honeycomb', style: 'mosaic', shots: 40 },
  { name: 'Звезда', rows: 8, colors: 5, shape: 'star', style: 'diagonal', shots: 38 },
  { name: 'Арка', rows: 8, colors: 6, shape: 'arch', style: 'rings', shots: 38 },
  { name: 'Лабиринт', rows: 9, colors: 6, shape: 'maze', style: 'mosaic', shots: 42 },
  { name: 'Бабочка', rows: 9, colors: 6, shape: 'butterfly', style: 'diagonal', shots: 42 },
  { name: 'Снежинка', rows: 9, colors: 6, shape: 'snowflake', style: 'rings', shots: 42 },
  { name: 'Вихрь', rows: 9, colors: 6, shape: 'vortex', style: 'spiral', shots: 44 },
  { name: 'Крепость', rows: 9, colors: 6, shape: 'fortress', style: 'groups', shots: 44 },
  { name: 'Кристалл', rows: 10, colors: 6, shape: 'crystal', style: 'mosaic', shots: 46 },
  { name: 'Океан', rows: 10, colors: 6, shape: 'ocean', style: 'waves', shots: 48 },
  { name: 'Космос', rows: 10, colors: 6, shape: 'space', style: 'mosaic', shots: 48 },
  { name: 'Финал', rows: 10, colors: 6, shape: 'full', style: 'checker', shots: 52 },
];

/* The first 24 levels are hand-tuned; the remaining 76 continue the ten themed
 * worlds. Each is still built by the same deterministic pipeline, so every
 * pattern is connected to the ceiling and every level has a generous shot
 * budget for its bubble count. */
const LATE_SHAPES = [
  'full', 'pyramid', 'diamond', 'columns', 'wave', 'shield', 'zigzag',
  'towers', 'bowl', 'honeycomb', 'star', 'arch', 'maze', 'butterfly',
  'snowflake', 'vortex', 'fortress', 'crystal', 'ocean', 'space',
];
const LATE_STYLES = ['groups', 'checker', 'diagonal', 'vertical', 'rings', 'mosaic', 'spiral', 'waves'];

// The rest of the catalogue continues the themed chapters up to MAX_LEVEL.
// Rows, colours and the shot budget grow slowly, shapes and colour styles
// rotate, so a thousand levels do not repeat the same board twice in a row.
for (let i = SPECS.length; i < MAX_LEVEL; i += 1) {
  const world = Math.floor(i / LEVELS_PER_WORLD);
  const within = i % LEVELS_PER_WORLD;
  SPECS.push({
    name: `${WORLDS[world].name} · ${within + 1}`,
    rows: Math.min(10, 6 + Math.floor((i / 9) % 5)),
    colors: Math.min(6, 3 + Math.floor((i / 16) % 4)),
    shape: LATE_SHAPES[(i * 7 + world) % LATE_SHAPES.length],
    style: LATE_STYLES[(i + within * 3) % LATE_STYLES.length],
    shots: 34 + Math.floor(i / 25) + Math.floor(within / 2),
  });
}

function buildLevel(spec, index) {
  const id = index + 1;
  const seedId = spec.seedId ?? id;
  const seed = seedId * 7919 + 12345;
  const colorOf = COLOR_STYLES[spec.style] || COLOR_STYLES.checker;

  const paint = (shapeName, rowCount) => {
    const shape = SHAPES[shapeName] || SHAPES.full;
    const raw = [];
    for (let r = 0; r < rowCount; r += 1) {
      const w = ROW_WIDTH(r);
      let row = '';
      for (let c = 0; c < w; c += 1) {
        if (!shape(r, c, w, rowCount)) {
          row += '.';
          continue;
        }
        const idx = ((colorOf(r, c, spec.colors, seed) % spec.colors) + spec.colors) % spec.colors;
        row += String(idx + 1);
      }
      raw.push(row);
    }
    const connected = connectPattern(raw);
    const rows = connected.map((row) =>
      row
        .map((colorId) => {
          if (!colorId) return '.';
          return String(COLORS.findIndex((c) => c.id === colorId) + 1);
        })
        .join(''),
    );
    while (rows.length && ![...rows[rows.length - 1]].some((ch) => ch !== '.')) {
      rows.pop();
    }
    const bubbles = rows.reduce((n, row) => n + [...row].filter((ch) => ch !== '.').length, 0);
    return { rows, bubbles };
  };

  let { rows, bubbles: totalBubbles } = paint(spec.shape, spec.rows);
  // Sparse shapes (pyramid, ring, towers) leave holes that make a level feel
  // empty. Fill them from the ceiling down until the board is dense enough —
  // the silhouette survives, the board just has more bubbles to pop.
  const TARGET_BUBBLES = 60;
  const densify = (pattern) => {
    const grid = pattern.map((row) => [...row].map((ch) => (ch === '.' ? null : ch)));
    let count = grid.flat().filter(Boolean).length;
    let guard = 0;
    while (count < TARGET_BUBBLES && guard < 600) {
      guard += 1;
      const candidates = [];
      for (let r = 0; r < grid.length; r += 1) {
        for (let c = 0; c < grid[r].length; c += 1) {
          if (grid[r][c]) continue;
          // Same neighbour rule the engine uses: even rows connect to c-1/c
          // above, odd rows to c/c+1. Filling by any other rule would leave
          // bubbles that look attached but count as floating.
          const upper = r === 0 ? [] : (r % 2 === 0 ? [c - 1, c] : [c, c + 1]);
          const above = r === 0
            ? true
            : upper.some((cc) => cc >= 0 && cc < (grid[r - 1]?.length || 0) && grid[r - 1][cc]);
          if (above) candidates.push([r, c]);
        }
      }
      if (!candidates.length) break;
      const [r, c] = candidates[(seed + guard * 31) % candidates.length];
      grid[r][c] = String(((seed + guard * 7) % spec.colors) + 1);
      count += 1;
    }
    return grid.map((row) => row.map((ch) => ch || '.').join(''));
  };

  rows = densify(rows);
  totalBubbles = rows.reduce((n, row) => n + [...row].filter((ch) => ch !== '.').length, 0);
  if (totalBubbles < 45) {
    ({ rows, bubbles: totalBubbles } = paint('full', Math.min(10, Math.max(7, spec.rows + 2))));
  }

  const baseShots = Math.max(spec.shots, Math.ceil(totalBubbles * 1.15) + 36);
  // Shorter levels: the budget is halved (with a small floor so a level is
  // never unplayable by construction).
  const shots = Math.max(12, Math.round(baseShots / 2));
  const palette = COLORS.slice(0, spec.colors).map((c) => c.id);

  return {
    id,
    name: spec.finalName || spec.name,
    rows,
    colors: spec.colors,
    palette,
    shots,
    totalBubbles,
    seed,
    seedId,
    difficulty: spec.difficulty ?? 0,
    hint: `${totalBubbles} шариков · ${shots} ходов`,
  };
}

// Give every spec a stable pattern seed before anything is reordered.
SPECS.forEach((spec, index) => {
  if (!spec.seedId) spec.seedId = index + 1;
});

// Draft levels are only used to estimate structural difficulty. The final
// catalogue is rebuilt in ascending difficulty with the same seeds, so the
// patterns do not change.
const DRAFT = SPECS.map((spec, index) => buildLevel(spec, index));
const RANKED = DRAFT.map((level, index) => ({
  spec: SPECS[index],
  level,
  difficulty:
    level.totalBubbles * 0.55 +
    level.colors * 7 +
    level.rows.length * 2 +
    (level.totalBubbles / Math.max(1, level.rows.length * 10.5)) * 30 -
    level.shots * 0.25,
}))
  .sort((a, b) => a.difficulty - b.difficulty || a.spec.seedId - b.spec.seedId)
  .map((entry, index) => {
    const world = Math.floor(index / LEVELS_PER_WORLD);
    return {
      ...entry.spec,
      seedId: entry.spec.seedId,
      finalName: `${WORLDS[world].name} · ${(index % LEVELS_PER_WORLD) + 1}`,
      difficulty: Math.round(entry.difficulty * 100) / 100,
    };
  });

export const LEVELS = RANKED.map((spec, index) => buildLevel(spec, index));

export function getLevel(id) {
  const level = LEVELS.find((l) => l.id === id) || LEVELS[0];
  return level;
}

export function getNextLevel(id) {
  return LEVELS.find((l) => l.id === id + 1) || null;
}

export function levelCount() {
  return LEVELS.length;
}

export { MAX_LEVEL };

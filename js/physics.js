/**
 * Pure geometry: aiming ray, wall bounces, collision detection and snap-cell
 * selection. No DOM, no rendering.
 */
import { COLS, TUNING } from './config.js';
import { ROW_WIDTH } from './grid.js';

export function cellCenter(layout, r, c) {
  return { x: layout.cellX(r, c), y: layout.cellY(r) };
}

export function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

function cumulativeDistances(points) {
  const distances = [0];
  for (let i = 1; i < points.length; i += 1) {
    distances.push(
      distances[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y),
    );
  }
  return distances;
}

/**
 * Swept circle-vs-segment intersection. The projectile travels from A to B
 * during one substep; the target is a circle of `radius` around C. Returns the
 * first entry point, so a fast projectile cannot tunnel through a bubble and a
 * projectile outside the radius is never considered a hit.
 */
export function segmentCircleHit(ax, ay, bx, by, cx, cy, radius) {
  const dx = bx - ax;
  const dy = by - ay;
  const fx = ax - cx;
  const fy = ay - cy;
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;

  if (a === 0) {
    if (c > 0) return null;
    return { hit: true, t: 0, x: ax, y: ay, distance: Math.sqrt(Math.max(0, c)) };
  }

  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;

  const sqrt = Math.sqrt(discriminant);
  let t = (-b - sqrt) / (2 * a);
  if (t < 0) {
    // The segment starts inside the collision circle (or the circle is behind
    // the start); only the former is a valid contact.
    if (c > 0) return null;
    t = 0;
  }
  if (t > 1) return null;

  return {
    hit: true,
    t,
    x: ax + dx * t,
    y: ay + dy * t,
    distance: radius,
  };
}

/** Nearest legal empty cell to `contact`.
 *
 *  - A bubble hit prefers the empty neighbours of the bubble that was hit.
 *  - A ceiling hit prefers empty cells of the ceiling row.
 *  - A safety fallback (only if those are all full) picks the nearest empty
 *    cell that actually touches another bubble, never a random top-row cell.
 */
export function findSnapCell(grid, layout, contact, hitCell, options = {}) {
  const atCeiling = options.ceiling === true;
  let candidates = [];

  if (hitCell) {
    for (const [r, c] of grid.neighbors(hitCell.r, hitCell.c)) {
      if (!grid.get(r, c)) candidates.push({ r, c });
    }
  }

  if (!candidates.length && atCeiling && grid.rows[0]) {
    grid.rows[0].forEach((_, c) => {
      if (!grid.get(0, c)) candidates.push({ r: 0, c });
    });
  }

  if (!candidates.length) {
    // Walk up to the row budget of the current layout, not just the rows the
    // grid happens to hold: after a resize the board is deeper than the array
    // that was allocated when the level started.
    const rowBudget = Math.max(grid.rows.length, layout.maxRows || 0);
    for (let r = 0; r < rowBudget; r += 1) {
      const width = grid.rows[r] ? grid.rows[r].length : ROW_WIDTH(r);
      for (let c = 0; c < width; c += 1) {
        if (grid.get(r, c)) continue;
        if (grid.hasOccupiedNeighbor(r, c)) candidates.push({ r, c });
      }
    }
  }

  // Never snap below the playable stack.
  candidates = candidates.filter(({ r }) => r < layout.maxRows);
  if (!candidates.length) return null;

  let best = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const x = layout.cellX(candidate.r, candidate.c);
    const y = layout.cellY(candidate.r);
    const distance = (x - contact.x) ** 2 + (y - contact.y) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

/**
 * Trace a shot from `start` at `angle` (radians, -PI..0 points upward).
 * The projectile keeps flying and bouncing off side walls until it hits the
 * ceiling or a bubble. There is intentionally no bounce limit: a real bubble
 * shooter must never stop mid-air and teleport the bubble to the top row.
 *
 * Returns the polyline (used for animation), the hit bubble (if any), the
 * contact type and the cell where the projectile lands.
 */
export function traceShot(grid, layout, start, angle, options = {}) {
  const R = layout.radius;
  const step = Math.max(1, R * 0.18);
  const maxSteps = options.maxSteps ?? TUNING.maxTraceSteps;
  const left = layout.left;
  const right = layout.left + R * 2 * COLS;
  const ceiling = layout.top;

  let x = start.x;
  let y = start.y;
  let dx = Math.cos(angle);
  let dy = Math.sin(angle);
  let bounces = 0;

  const points = [{ x, y }];
  const bounceIndices = [];

  const finalize = (contact, contactType, hitCell, snap, exhausted = false) => {
    const distances = cumulativeDistances(points);
    return {
      points,
      contact,
      contactType,
      hitCell,
      snap,
      bounces,
      angle,
      length: distances[distances.length - 1] || 0,
      start,
      exhausted,
      bouncePoints: bounceIndices.map((index) => ({
        ...points[index],
        distance: distances[index],
      })),
    };
  };

  // Each bubble is shrunk by a small inset so a shot can slip through narrow
  // gaps. The inset grows with the bubble: a fixed 4 px is a different
  // percentage of a 22 px mobile bubble and of a 34 px desktop one, and the
  // shot mysteriously stopped squeezing through gaps on big screens.
  const inset = Math.max(TUNING.collisionInset, R * 0.18);
  const collisionRadius = Math.max(4, (R - inset) * 2);

  for (let i = 0; i < maxSteps; i += 1) {
    let nx = x + dx * step;
    let ny = y + dy * step;
    let ceilingReached = false;

    // End the segment exactly at the first ceiling contact so a bubble just
    // below the ceiling is checked before the ceiling itself.
    if (dy < 0 && ny - R <= ceiling) {
      const t = (ceiling + R - y) / (ny - y);
      if (t >= 0 && t <= 1) {
        nx = x + (nx - x) * t;
        ny = ceiling + R;
        ceilingReached = true;
      }
    }

    let reflected = false;
    if (dx < 0 && nx - R < left) {
      nx = left + R;
      reflected = true;
    } else if (dx > 0 && nx + R > right) {
      nx = right - R;
      reflected = true;
    }

    // Swept collision against every bubble on this substep. Only the first
    // real intersection with the shrunk collision circles counts.
    let hit = null;
    let hitT = Infinity;
    grid.forEachOccupied((color, r, c) => {
      const cx = layout.cellX(r, c);
      const cy = layout.cellY(r);
      const result = segmentCircleHit(x, y, nx, ny, cx, cy, collisionRadius);
      if (result && result.t < hitT) {
        hitT = result.t;
        hit = { r, c, color, x: result.x, y: result.y };
      }
    });

    if (hit) {
      const contact = { x: hit.x, y: hit.y };
      points.push(contact);
      return finalize(
        contact,
        'bubble',
        { r: hit.r, c: hit.c },
        findSnapCell(grid, layout, contact, hit, { ceiling: false }),
      );
    }

    if (ceilingReached) {
      const contact = { x: nx, y: ny };
      points.push(contact);
      return finalize(
        contact,
        'ceiling',
        null,
        findSnapCell(grid, layout, contact, null, { ceiling: true }),
      );
    }

    x = nx;
    y = ny;
    points.push({ x, y });

    if (reflected) {
      dx = -dx;
      bounces += 1;
      bounceIndices.push(points.length - 1);
    }
  }

  // Defensive fallback for a malformed angle that never reaches the board.
  // Never invent a snap cell here: that is exactly what used to teleport the
  // projectile to the top after too many wall bounces.
  return finalize({ x, y }, 'none', null, null, true);
}

/** Find the occupied bubble under a canvas point. */
export function bubbleAtPoint(grid, layout, x, y, tolerance = 1.05) {
  let best = null;
  let bestDistance = Infinity;
  const limit = layout.radius * tolerance;
  grid.forEachOccupied((color, r, c) => {
    const cx = layout.cellX(r, c);
    const cy = layout.cellY(r);
    const distance = Math.hypot(x - cx, y - cy);
    if (distance <= limit && distance < bestDistance) {
      bestDistance = distance;
      best = { r, c, color };
    }
  });
  return best;
}

/** Clamp an aiming angle to the upward fan. */
export function clampAimAngle(angle, margin = TUNING.minAngle) {
  const min = -Math.PI + margin;
  const max = -margin;
  return Math.min(max, Math.max(min, angle));
}

/** Canvas position of a cell's centre. Kept for renderers/tests. */
export function cellPosition(layout, cell) {
  return cellCenter(layout, cell.r, cell.c);
}

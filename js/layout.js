/**
 * Board layout derived from the canvas size. Pure maths: used by the engine,
 * the renderer and the tests.
 */
import { COLS } from './config.js';

export function createLayout(fieldWidth, fieldHeight, levelRows = 4) {
  const width = Math.max(240, fieldWidth || 0);
  const height = Math.max(320, fieldHeight || 0);
  const pad = Math.max(4, Math.min(12, width * 0.022));
  const boardWidth = width - pad * 2;

  let radius = boardWidth / (2 * COLS);
  const shooterZone = Math.max(62, Math.min(104, height * 0.135));
  const top = Math.max(6, Math.min(16, height * 0.015));
  const rowHeightFactor = Math.sqrt(3);

  // Make sure the level's initial rows fit above the shooter area.
  const usable = height - shooterZone - top - radius * 2;
  const maxRadiusForHeight = usable / (Math.max(1, levelRows - 1) * rowHeightFactor + 2);
  radius = Math.min(radius, maxRadiusForHeight);
  radius = Math.max(7, Math.min(34, radius));

  const rowHeight = radius * rowHeightFactor;
  const shooterY = height - shooterZone * 0.56;
  const dangerY = shooterY - radius * 2.15;

  // Keep one row below the danger line: this lets a bubble actually reach the
  // line (and trigger the overflow loss) instead of the grid silently ending
  // one row too early.
  const maxRows = Math.max(
    levelRows,
    Math.floor((dangerY - top - radius * 2) / rowHeight) + 2,
  );

  const boardLeft = (width - radius * 2 * COLS) / 2;

  const layout = {
    width,
    height,
    radius,
    rowHeight,
    cols: COLS,
    left: boardLeft,
    right: boardLeft + radius * 2 * COLS,
    top,
    shooterX: width / 2,
    shooterY,
    dangerY,
    maxRows,
    rowWidth: (r) => (r % 2 === 0 ? COLS : COLS - 1),
    cellX: (r, c) => boardLeft + radius + c * radius * 2 + (r % 2 ? radius : 0),
    cellY: (r) => top + radius + r * rowHeight,
  };
  return layout;
}

/** Where the loaded bubble sits for a given aiming angle. Shared by the engine
 *  and the renderer so the flight always starts exactly at the visible bubble. */
export function shooterMuzzle(layout, angle) {
  const offset = layout.radius * 1.62;
  return {
    x: layout.shooterX + Math.cos(angle) * offset,
    y: layout.shooterY + Math.sin(angle) * offset,
  };
}

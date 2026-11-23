/**
 * Canvas 2D presentation layer: glossy bubble sprites, animated cannon,
 * aiming dots, particles, falling bubbles, screen shake and the HUD-ish bits
 * that live on the play surface.
 */
import { COLORS, COLOR_BY_ID, RAINBOW } from './config.js';

const TAU = Math.PI * 2;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};

function rgba(hex, alpha) {
  const value = hex.replace('#', '');
  const n = parseInt(value.length === 3 ? value.split('').map((c) => c + c).join('') : value, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function pointAt(points, distance) {
  let travelled = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const segment = Math.hypot(b.x - a.x, b.y - a.y);
    if (travelled + segment >= distance) {
      const t = segment ? (distance - travelled) / segment : 0;
      return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
    }
    travelled += segment;
  }
  return points[points.length - 1];
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/* --------------------------------------------------------------- paints --- */

function paintSphere(g, cx, cy, R, color) {
  // Contact shadow under the bubble.
  g.save();
  g.beginPath();
  g.arc(cx, cy + R * 0.06, R * 0.97, 0, TAU);
  g.fillStyle = 'rgba(1, 8, 26, 0.5)';
  g.shadowColor = 'rgba(0, 5, 20, 0.55)';
  g.shadowBlur = R * 0.4;
  g.shadowOffsetY = R * 0.14;
  g.fill();
  g.restore();

  g.save();
  g.beginPath();
  g.arc(cx, cy, R * 0.985, 0, TAU);
  g.clip();

  const grad = g.createRadialGradient(
    cx - R * 0.38,
    cy - R * 0.44,
    R * 0.06,
    cx - R * 0.02,
    cy + R * 0.06,
    R * 1.1,
  );
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.07, color.light);
  grad.addColorStop(0.3, color.base);
  grad.addColorStop(0.68, color.base);
  grad.addColorStop(0.88, color.dark);
  grad.addColorStop(1, color.deep);
  g.fillStyle = grad;
  g.fillRect(cx - R, cy - R, R * 2, R * 2);

  // Darker lower-right rim for volume.
  const rim = g.createRadialGradient(
    cx + R * 0.18,
    cy + R * 0.2,
    R * 0.45,
    cx,
    cy,
    R * 1.02,
  );
  rim.addColorStop(0, 'rgba(0,0,0,0)');
  rim.addColorStop(0.72, 'rgba(0,0,0,0.04)');
  rim.addColorStop(1, 'rgba(0,0,0,0.34)');
  g.fillStyle = rim;
  g.fillRect(cx - R, cy - R, R * 2, R * 2);

  // Warm bounce light from below.
  const bounce = g.createRadialGradient(
    cx - R * 0.08,
    cy + R * 0.85,
    R * 0.02,
    cx - R * 0.08,
    cy + R * 0.72,
    R * 0.72,
  );
  bounce.addColorStop(0, rgba(color.light, 0.55));
  bounce.addColorStop(0.55, rgba(color.light, 0.12));
  bounce.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = bounce;
  g.fillRect(cx - R, cy - R, R * 2, R * 2);

  // Rim light, top-left.
  g.beginPath();
  g.arc(cx, cy, R * 0.93, Math.PI * 1.02, Math.PI * 1.58);
  g.strokeStyle = 'rgba(255,255,255,0.5)';
  g.lineWidth = R * 0.055;
  g.lineCap = 'round';
  g.stroke();

  // Reflected light, bottom edge.
  g.beginPath();
  g.arc(cx, cy, R * 0.9, Math.PI * 0.18, Math.PI * 0.6);
  g.strokeStyle = rgba(color.light, 0.32);
  g.lineWidth = R * 0.07;
  g.stroke();
  g.restore();

  // Big soft specular.
  g.save();
  g.translate(cx - R * 0.34, cy - R * 0.42);
  g.rotate(-0.55);
  const spec = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.33);
  spec.addColorStop(0, 'rgba(255,255,255,0.98)');
  spec.addColorStop(0.55, 'rgba(255,255,255,0.6)');
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  g.beginPath();
  g.ellipse(0, 0, R * 0.34, R * 0.18, 0, 0, TAU);
  g.fillStyle = spec;
  g.fill();
  g.restore();

  // Tiny sparkle.
  g.beginPath();
  g.arc(cx - R * 0.55, cy - R * 0.1, R * 0.055, 0, TAU);
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.fill();

  // Thin outline.
  g.beginPath();
  g.arc(cx, cy, R * 0.985, 0, TAU);
  g.strokeStyle = 'rgba(4, 12, 36, 0.3)';
  g.lineWidth = R * 0.025;
  g.stroke();
}

function paintRainbow(g, cx, cy, R) {
  g.save();
  g.beginPath();
  g.arc(cx, cy + R * 0.06, R * 0.97, 0, TAU);
  g.fillStyle = 'rgba(1, 8, 26, 0.5)';
  g.shadowColor = 'rgba(0, 5, 20, 0.55)';
  g.shadowBlur = R * 0.45;
  g.shadowOffsetY = R * 0.14;
  g.fill();
  g.restore();

  g.save();
  g.beginPath();
  g.arc(cx, cy, R * 0.985, 0, TAU);
  g.clip();

  if (typeof g.createConicGradient === 'function') {
    const conic = g.createConicGradient(-Math.PI / 2, cx, cy);
    const stops = ['#ff3d5f', '#ff8f3d', '#ffd93d', '#3ddc84', '#3aa0ff', '#a95bff', '#ff3d5f'];
    stops.forEach((color, i) => conic.addColorStop(i / (stops.length - 1), color));
    g.fillStyle = conic;
    g.fillRect(cx - R, cy - R, R * 2, R * 2);
  } else {
    const colors = ['#ff3d5f', '#ff8f3d', '#ffd93d', '#3ddc84', '#3aa0ff', '#a95bff'];
    colors.forEach((color, i) => {
      g.beginPath();
      g.moveTo(cx, cy);
      g.arc(cx, cy, R, (i / colors.length) * TAU, ((i + 1) / colors.length) * TAU);
      g.closePath();
      g.fillStyle = color;
      g.fill();
    });
  }

  const gloss = g.createRadialGradient(
    cx - R * 0.36,
    cy - R * 0.44,
    R * 0.04,
    cx,
    cy + R * 0.05,
    R * 1.12,
  );
  gloss.addColorStop(0, 'rgba(255,255,255,0.95)');
  gloss.addColorStop(0.18, 'rgba(255,255,255,0.36)');
  gloss.addColorStop(0.55, 'rgba(255,255,255,0)');
  gloss.addColorStop(1, 'rgba(0,0,40,0.42)');
  g.fillStyle = gloss;
  g.fillRect(cx - R, cy - R, R * 2, R * 2);

  g.beginPath();
  g.arc(cx, cy, R * 0.9, Math.PI * 1.02, Math.PI * 1.58);
  g.strokeStyle = 'rgba(255,255,255,0.7)';
  g.lineWidth = R * 0.06;
  g.stroke();
  g.restore();

  g.save();
  g.translate(cx - R * 0.33, cy - R * 0.42);
  g.rotate(-0.55);
  g.beginPath();
  g.ellipse(0, 0, R * 0.3, R * 0.15, 0, 0, TAU);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.fill();
  g.restore();
}

/* ------------------------------------------------------------- renderer --- */

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.time = 0;
    this.game = null;
    this.layout = null;
    /** Cosmetic skin of the cannon barrel (null = default steel). */
    this.skinColor = null;
    this.sprites = new Map();
    this.stars = [];
    this.particles = [];
    this.rings = [];
    this.falling = [];
    this.floaters = [];
    this.streaks = [];
    this.shakeAmount = 0;
    this.flashAlpha = 0;
    this.flashColor = '#ffffff';
    this.introStart = -10;
    this.intro = false;
    this.lastGridCount = 0;
  }

  resize(width, height) {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (!width || !height) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.sprites.clear();
    this.makeStars();
    // Sprites are pixel-bound to the previous size: rebuild them for the new
    // radius and pixel ratio, otherwise bubbles are drawn at the old scale.
    if (this.layout) this.ensureSprites();
  }

  makeStars() {
    this.stars = [];
    const count = 34;
    for (let i = 0; i < count; i += 1) {
      this.stars.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height * 0.8,
        r: 0.5 + Math.random() * 1.4,
        phase: Math.random() * TAU,
        speed: 0.4 + Math.random() * 1.2,
      });
    }
  }

  setLevel(game) {
    this.game = game;
    this.layout = game.layout;
    this.sprites.clear();
    this.particles = [];
    this.rings = [];
    this.falling = [];
    this.floaters = [];
    this.streaks = [];
    this.shakeAmount = 0;
    this.flashAlpha = 0;
    this.intro = true;
    this.introStart = this.time + 0.05;
    this.lastGridCount = game.grid.count();
    this.ensureSprites();
  }

  ensureSprites() {
    if (!this.layout) return;
    const radiusKey = Math.round(this.layout.radius * 2);
    if (this.sprites.has(`r:${radiusKey}`)) return;
    this.sprites.clear();
    this.sprites.set(`r:${radiusKey}`, true);
    for (const color of COLORS) {
      this.sprites.set(color.id, this.makeBubbleSprite(color));
    }
    this.sprites.set(RAINBOW, this.makeRainbowSprite());
  }

  makeBubbleSprite(color) {
    const R = this.layout.radius;
    const pad = Math.ceil(R * 0.24) + 2;
    const cssSize = R * 2 + pad * 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.round(cssSize * this.dpr));
    canvas.height = Math.max(2, Math.round(cssSize * this.dpr));
    const g = canvas.getContext('2d');
    g.scale(this.dpr, this.dpr);
    paintSphere(g, R + pad, R + pad, R, color);
    return { canvas, pad, size: cssSize, radius: R };
  }

  makeRainbowSprite() {
    const R = this.layout.radius;
    const pad = Math.ceil(R * 0.24) + 2;
    const cssSize = R * 2 + pad * 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.round(cssSize * this.dpr));
    canvas.height = Math.max(2, Math.round(cssSize * this.dpr));
    const g = canvas.getContext('2d');
    g.scale(this.dpr, this.dpr);
    paintRainbow(g, R + pad, R + pad, R);
    return { canvas, pad, size: cssSize, radius: R };
  }

  spriteFor(colorId) {
    if (colorId === RAINBOW) return this.sprites.get(RAINBOW) || null;
    return this.sprites.get(colorId) || this.sprites.get(COLORS[0].id) || null;
  }

  drawSpriteAt(colorId, x, y, radius = this.layout.radius, alpha = 1, scale = 1) {
    const sprite = this.spriteFor(colorId);
    if (!sprite) return;
    const ctx = this.ctx;
    const base = sprite.radius || this.layout.radius;
    const factor = (radius * scale) / base;
    const drawSize = sprite.size * factor;
    ctx.save();
    if (alpha !== 1) ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.drawImage(sprite.canvas, x - drawSize / 2, y - drawSize / 2, drawSize, drawSize);
    ctx.restore();
  }

  getNextBubblePosition() {
    const R = this.layout.radius;
    return {
      x: this.layout.shooterX + R * 3.55,
      y: this.layout.shooterY - R * 0.15,
      radius: R * 0.82,
    };
  }

  getMuzzle(angle) {
    const R = this.layout.radius;
    return {
      x: this.layout.shooterX + Math.cos(angle) * R * 1.62,
      y: this.layout.shooterY + Math.sin(angle) * R * 1.62,
    };
  }

  /* ------------------------------------------------------------- effects */

  addParticles(x, y, colorId, count = 12, power = 1) {
    const color = COLOR_BY_ID[colorId] || COLORS[0];
    const R = this.layout.radius;
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * TAU;
      const speed = (40 + Math.random() * 190) * power;
      const life = 0.35 + Math.random() * 0.45;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 30,
        gravity: 520,
        radius: (1.2 + Math.random() * 3.1) * (R / 17),
        life,
        maxLife: life,
        color: Math.random() > 0.45 ? color.base : color.light,
        glow: Math.random() > 0.4,
      });
    }
  }

  popCells(cells, colorId, game) {
    if (!cells || !cells.length) return;
    const color = COLOR_BY_ID[colorId] || COLORS[0];
    const R = this.layout.radius;
    cells.forEach((cell, index) => {
      const x = this.layout.cellX(cell.r, cell.c);
      const y = this.layout.cellY(cell.r);
      this.rings.push({
        x,
        y,
        radius: R * 0.55,
        maxRadius: R * 1.8,
        life: 0.32,
        maxLife: 0.32,
        color: color.base,
      });
      this.addParticles(x, y, colorId, 9 + Math.min(6, index), 1);
    });
    const average = cells.reduce(
      (acc, cell) => ({ x: acc.x + this.layout.cellX(cell.r, cell.c), y: acc.y + this.layout.cellY(cell.r) }),
      { x: 0, y: 0 },
    );
    average.x /= cells.length;
    average.y /= cells.length;
    this.addParticles(average.x, average.y, colorId, 6, 0.7);
  }

  fallCells(cells, game) {
    if (!cells || !cells.length) return;
    const R = this.layout.radius;
    for (const cell of cells) {
      this.falling.push({
        x: this.layout.cellX(cell.r, cell.c),
        y: this.layout.cellY(cell.r),
        vx: (Math.random() - 0.5) * 110,
        vy: -40 - Math.random() * 90,
        gravity: 1500,
        color: cell.color,
        radius: R,
        rotation: (Math.random() - 0.5) * 2,
        spin: (Math.random() - 0.5) * 5,
        life: 3,
      });
    }
  }

  addFloater(x, y, text, color = '#ffe28d') {
    this.floaters.push({
      x,
      y,
      text,
      color,
      life: 0.9,
      maxLife: 0.9,
    });
  }

  ring(x, y, colorId, maxRadius = this.layout.radius * 3) {
    const color = COLOR_BY_ID[colorId] || COLORS[0];
    this.rings.push({
      x,
      y,
      radius: this.layout.radius * 0.4,
      maxRadius,
      life: 0.5,
      maxLife: 0.5,
      color: color.light,
    });
  }

  shake(amount = 6) {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  flash(alpha = 0.25, color = '#ffffff') {
    this.flashAlpha = Math.max(this.flashAlpha, alpha);
    this.flashColor = color;
  }

  addStreak(x1, y1, x2, y2, color, width = 5, life = 0.4) {
    this.streaks.push({ x1, y1, x2, y2, color, width, life, maxLife: life });
  }

  update(dt) {
    this.time += dt;
    const step = Math.min(dt, 0.05);

    for (const particle of this.particles) {
      particle.vy += particle.gravity * step;
      particle.x += particle.vx * step;
      particle.y += particle.vy * step;
      particle.vx *= 0.99;
      particle.life -= step;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    for (const ring of this.rings) {
      ring.life -= step;
      const progress = 1 - ring.life / ring.maxLife;
      ring.radius = lerp(this.layout.radius * 0.4, ring.maxRadius, progress);
    }
    this.rings = this.rings.filter((r) => r.life > 0);

    for (const bubble of this.falling) {
      bubble.vy += bubble.gravity * step;
      bubble.x += bubble.vx * step;
      bubble.y += bubble.vy * step;
      bubble.rotation += bubble.spin * step;
      bubble.life -= step;
    }
    this.falling = this.falling.filter((b) => b.life > 0 && b.y < this.height + b.radius * 4);

    for (const floater of this.floaters) {
      floater.y -= 42 * step;
      floater.life -= step;
    }
    this.floaters = this.floaters.filter((f) => f.life > 0);

    for (const streak of this.streaks) streak.life -= step;
    this.streaks = this.streaks.filter((s) => s.life > 0);

    this.shakeAmount *= Math.pow(0.0025, step);
    if (this.shakeAmount < 0.1) this.shakeAmount = 0;
    this.flashAlpha *= Math.pow(0.001, step);
    if (this.flashAlpha < 0.01) this.flashAlpha = 0;
  }

  /* ---------------------------------------------------------------- draw */

  draw(view = {}) {
    if (!this.layout) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.save();
    const shakeX = this.shakeAmount ? (Math.random() - 0.5) * this.shakeAmount : 0;
    const shakeY = this.shakeAmount ? (Math.random() - 0.5) * this.shakeAmount : 0;
    ctx.translate(shakeX, shakeY);

    this.drawBackground();
    this.drawAim(view);
    this.drawGrid(view);
    this.drawFalling();
    this.drawStreaks();
    this.drawProjectile(view);
    this.drawParticles();
    this.drawShooter(view);
    this.drawBoosterTarget(view);
    this.drawFloaters();

    ctx.restore();
    this.drawFlash();
  }

  drawBackground() {
    const ctx = this.ctx;
    const { width: w, height: h } = this;

    for (const star of this.stars) {
      const twinkle = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(this.time * star.speed + star.phase));
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r, 0, TAU);
      ctx.fillStyle = `rgba(200, 230, 255, ${twinkle * 0.45})`;
      ctx.fill();
    }

    const glow = ctx.createRadialGradient(w * 0.5, h * 0.12, 10, w * 0.5, h * 0.12, h * 0.55);
    glow.addColorStop(0, 'rgba(112, 186, 255, 0.12)');
    glow.addColorStop(0.55, 'rgba(60, 130, 255, 0.04)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    // Ceiling rail.
    const railY = this.layout.top;
    const rail = ctx.createLinearGradient(this.layout.left, 0, this.layout.right, 0);
    rail.addColorStop(0, 'rgba(126, 200, 255, 0)');
    rail.addColorStop(0.2, 'rgba(126, 200, 255, 0.45)');
    rail.addColorStop(0.5, 'rgba(190, 232, 255, 0.75)');
    rail.addColorStop(0.8, 'rgba(126, 200, 255, 0.45)');
    rail.addColorStop(1, 'rgba(126, 200, 255, 0)');
    ctx.fillStyle = rail;
    ctx.fillRect(this.layout.left, railY - 1, this.layout.right - this.layout.left, 1.5);

    // Danger line.
    const dangerY = this.layout.dangerY;
    ctx.save();
    ctx.setLineDash([5, 8]);
    ctx.lineDashOffset = -this.time * 12;
    ctx.strokeStyle = 'rgba(255, 128, 150, 0.22)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(this.layout.left + 4, dangerY);
    ctx.lineTo(this.layout.right - 4, dangerY);
    ctx.stroke();
    ctx.restore();
  }

  drawAim(view) {
    if (!this.layout) return;
    const game = this.game;
    if (!game || game.phase !== 'aim' || view.flying || view.boosterMode) return;
    const trace = view.aimTrace;
    if (!trace || !trace.points || trace.points.length < 2) return;

    const ctx = this.ctx;
    const R = this.layout.radius;
    const rocket = game.isRocket();
    const colorId = view.rainbow ? RAINBOW : game.current;
    const color = rocket
      ? { light: '#ffe0a8', base: '#ff9a3d' }
      : colorId === RAINBOW
        ? null
        : COLOR_BY_ID[colorId];
    const active = view.aiming ? 1 : 0.62;

    // Thin guiding line.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(trace.points[0].x, trace.points[0].y);
    for (let i = 1; i < trace.points.length; i += 1) {
      ctx.lineTo(trace.points[i].x, trace.points[i].y);
    }
    ctx.strokeStyle = color
      ? rgba(color.light, 0.28 * active)
      : `hsla(${(this.time * 90) % 360}, 90%, 75%, ${0.3 * active})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // Dotted direction markers.
    const spacing = Math.max(14, R * 0.95);
    for (let distance = spacing * 0.9; distance < trace.length; distance += spacing) {
      const point = pointAt(trace.points, distance);
      const fade = 1 - distance / Math.max(trace.length, 1);
      const radius = R * (0.1 + 0.035 * fade) * (active > 0.8 ? 1 : 0.85);
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, TAU);
      ctx.fillStyle = color
        ? rgba(color.light, (0.35 + 0.45 * fade) * active)
        : `hsla(${(this.time * 90 + distance) % 360}, 95%, 72%, ${(0.4 + 0.45 * fade) * active})`;
      ctx.fill();
    }

    // No ghost bubble and no attachment marker at the landing cell: only the
    // dotted centre trajectory is drawn.
  }

  drawGrid(view) {
    const game = this.game;
    if (!game) return;
    const ctx = this.ctx;
    const R = this.layout.radius;
    const introElapsed = this.time - this.introStart;

    game.grid.forEachOccupied((color, r, c) => {
      let x = this.layout.cellX(r, c);
      let y = this.layout.cellY(r);
      let scale = 1;
      let alpha = 1;

      if (this.intro) {
        const delay = Math.min(0.45, r * 0.035 + c * 0.012);
        const t = clamp((introElapsed - delay) / 0.38, 0, 1);
        if (t <= 0) return;
        scale = easeOutBack(t);
        alpha = clamp(t * 1.6, 0, 1);
      }

      // Gentle breathing so the board does not feel like a static picture.
      const breathe = 1 + Math.sin(this.time * 1.8 + r * 0.55 + c * 0.4) * 0.006;
      scale *= breathe;

      this.drawSpriteAt(color, x, y, R, alpha, scale);
    });

    if (this.intro && introElapsed > 1.2) this.intro = false;
  }

  drawFalling() {
    for (const bubble of this.falling) {
      const alpha = clamp(bubble.life, 0, 1);
      if (bubble.y > this.height + bubble.radius * 2) continue;
      this.ctx.save();
      this.ctx.globalAlpha = alpha;
      this.ctx.translate(bubble.x, bubble.y);
      this.ctx.rotate(bubble.rotation);
      this.ctx.translate(-bubble.x, -bubble.y);
      this.drawSpriteAt(bubble.color, bubble.x, bubble.y, bubble.radius, alpha);
      this.ctx.restore();
    }
  }

  drawRocketAt(x, y, R, angle = -Math.PI / 2, alpha = 1) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + Math.PI / 2);
    ctx.globalAlpha *= alpha;
    ctx.shadowColor = 'rgba(255, 164, 63, 0.8)';
    ctx.shadowBlur = R * 0.8;

    // Flame.
    const flicker = 0.82 + Math.sin(this.time * 24) * 0.18;
    const flame = ctx.createLinearGradient(0, R * 0.55, 0, R * 1.7);
    flame.addColorStop(0, 'rgba(255, 240, 160, 0.95)');
    flame.addColorStop(0.45, 'rgba(255, 151, 44, 0.9)');
    flame.addColorStop(1, 'rgba(255, 74, 38, 0)');
    ctx.beginPath();
    ctx.moveTo(-R * 0.24, R * 0.6);
    ctx.quadraticCurveTo(-R * 0.42, R * 1.05, 0, R * (1.25 + flicker * 0.4));
    ctx.quadraticCurveTo(R * 0.42, R * 1.05, R * 0.24, R * 0.6);
    ctx.closePath();
    ctx.fillStyle = flame;
    ctx.fill();

    // Fins.
    ctx.fillStyle = '#ff7a2f';
    ctx.beginPath();
    ctx.moveTo(-R * 0.32, R * 0.28);
    ctx.lineTo(-R * 0.78, R * 0.86);
    ctx.lineTo(-R * 0.3, R * 0.78);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(R * 0.32, R * 0.28);
    ctx.lineTo(R * 0.78, R * 0.86);
    ctx.lineTo(R * 0.3, R * 0.78);
    ctx.closePath();
    ctx.fill();

    // Body.
    const body = ctx.createLinearGradient(-R * 0.4, 0, R * 0.4, 0);
    body.addColorStop(0, '#ffe6a8');
    body.addColorStop(0.4, '#ffbd63');
    body.addColorStop(1, '#e96a28');
    roundRect(ctx, -R * 0.34, -R * 0.82, R * 0.68, R * 1.56, R * 0.32);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 246, 212, 0.7)';
    ctx.lineWidth = Math.max(1, R * 0.07);
    ctx.stroke();

    // Nose cone.
    ctx.beginPath();
    ctx.moveTo(0, -R * 1.18);
    ctx.lineTo(R * 0.34, -R * 0.72);
    ctx.lineTo(-R * 0.34, -R * 0.72);
    ctx.closePath();
    ctx.fillStyle = '#ffd27a';
    ctx.fill();

    // Window.
    ctx.beginPath();
    ctx.arc(0, -R * 0.12, R * 0.17, 0, TAU);
    ctx.fillStyle = '#5fc7ff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = Math.max(1, R * 0.05);
    ctx.stroke();

    ctx.restore();
  }

  drawProjectile(view) {
    if (!view.flying) return;
    const { trace, progress } = view.flying;
    if (!trace || !trace.points) return;
    const R = this.layout.radius;
    const distance = trace.length * clamp(progress, 0, 1);
    const head = pointAt(trace.points, distance);
    const rainbow = trace.rainbow;

    if (trace.rocket) {
      const before = pointAt(trace.points, Math.max(0, distance - R * 0.8));
      const after = pointAt(trace.points, Math.min(trace.length, distance + R * 0.8));
      const tangent = Math.atan2(after.y - before.y, after.x - before.x) || trace.angle;
      const ctx = this.ctx;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 1; i <= 5; i += 1) {
        const d = distance - i * R * 0.6;
        if (d <= 0) break;
        const point = pointAt(trace.points, d);
        ctx.beginPath();
        ctx.arc(point.x, point.y, R * (0.22 - i * 0.025), 0, TAU);
        ctx.fillStyle = `rgba(255, 170, 70, ${0.28 - i * 0.04})`;
        ctx.fill();
      }
      ctx.restore();
      this.drawRocketAt(head.x, head.y, R, tangent, 1);
      return;
    }

    const colorId = rainbow ? RAINBOW : trace.shotColor;

    // Motion trail.
    for (let i = 1; i <= 4; i += 1) {
      const d = distance - i * R * 0.55;
      if (d <= 0) break;
      const point = pointAt(trace.points, d);
      this.drawSpriteAt(colorId, point.x, point.y, R * (0.82 - i * 0.12), 0.16 - i * 0.028);
    }

    this.ctx.save();
    this.ctx.shadowColor = rainbow ? 'rgba(255, 190, 255, 0.75)' : 'rgba(180, 230, 255, 0.7)';
    this.ctx.shadowBlur = R * 0.9;
    this.drawSpriteAt(colorId, head.x, head.y, R, 1);
    this.ctx.restore();
  }

  drawParticles() {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const ring of this.rings) {
      const alpha = clamp(ring.life / ring.maxLife, 0, 1);
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.radius, 0, TAU);
      ctx.strokeStyle = rgba(ring.color, alpha * 0.55);
      ctx.lineWidth = 2.4 * alpha + 0.4;
      ctx.stroke();
    }
    for (const particle of this.particles) {
      const alpha = clamp(particle.life / particle.maxLife, 0, 1);
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.radius * (0.5 + alpha * 0.7), 0, TAU);
      ctx.fillStyle = rgba(particle.color, alpha * 0.9);
      ctx.fill();
      if (particle.glow) {
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.radius * 2.2, 0, TAU);
        ctx.fillStyle = rgba(particle.color, alpha * 0.12);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawStreaks() {
    if (!this.streaks.length) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const streak of this.streaks) {
      const alpha = clamp(streak.life / streak.maxLife, 0, 1);
      const grad = ctx.createLinearGradient(streak.x1, streak.y1, streak.x2, streak.y2);
      grad.addColorStop(0, rgba(streak.color, 0));
      grad.addColorStop(0.5, rgba(streak.color, alpha * 0.75));
      grad.addColorStop(1, rgba(streak.color, 0));
      ctx.strokeStyle = grad;
      ctx.lineWidth = Math.max(0.5, streak.width * alpha);
      ctx.beginPath();
      ctx.moveTo(streak.x1, streak.y1);
      ctx.lineTo(streak.x2, streak.y2);
      ctx.stroke();
      ctx.strokeStyle = rgba('#ffffff', alpha * 0.18);
      ctx.lineWidth = Math.max(0.4, streak.width * alpha * 0.28);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Cannon skin: recolours the barrel highlight and the muzzle ring. */
  setSkin(color) {
    this.skinColor = color || null;
  }

  mixSkin(base, fallback) {
    const parse = (hex) => {
      const text = String(hex).replace('#', '');
      if (text.length !== 6) return null;
      return [0, 2, 4].map((i) => parseInt(text.slice(i, i + 2), 16));
    };
    const a = parse(base);
    const b = parse(fallback);
    if (!a || !b) return fallback;
    const mixed = a.map((value, index) => Math.round(value * 0.55 + b[index] * 0.45));
    return `rgb(${mixed[0]}, ${mixed[1]}, ${mixed[2]})`;
  }
  drawShooter(view) {
    const ctx = this.ctx;
    const layout = this.layout;
    const R = layout.radius;
    const angle = view.aimAngle ?? -Math.PI / 2;
    const muzzle = this.getMuzzle(angle);
    const pivotX = layout.shooterX;
    const pivotY = layout.shooterY + R * 0.35;
    const rocket = !!this.game?.isRocket();
    const colorId = view.rainbow ? RAINBOW : this.game?.current;
    const color = rocket
      ? { base: '#ff9a3d', light: '#ffe0a8' }
      : colorId && colorId !== RAINBOW
        ? COLOR_BY_ID[colorId]
        : null;

    // Soft glow under the cannon.
    const underGlow = ctx.createRadialGradient(pivotX, pivotY + R * 0.2, 2, pivotX, pivotY + R * 0.2, R * 3.4);
    underGlow.addColorStop(0, color ? rgba(color.base, 0.22) : 'rgba(150, 210, 255, 0.18)');
    underGlow.addColorStop(0.55, 'rgba(70, 140, 255, 0.06)');
    underGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = underGlow;
    ctx.fillRect(pivotX - R * 3.4, pivotY - R * 3.4, R * 6.8, R * 6.8);

    // Base plate.
    ctx.save();
    ctx.translate(pivotX, pivotY + R * 0.35);
    ctx.beginPath();
    ctx.ellipse(0, 0, R * 2.15, R * 1.5, 0, 0, TAU);
    const plate = ctx.createLinearGradient(0, -R * 1.4, 0, R * 1.4);
    plate.addColorStop(0, '#486a9f');
    plate.addColorStop(0.35, '#294b82');
    plate.addColorStop(1, '#0a1c40');
    ctx.fillStyle = plate;
    ctx.shadowColor = 'rgba(0, 5, 22, 0.55)';
    ctx.shadowBlur = R * 0.7;
    ctx.shadowOffsetY = R * 0.24;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.beginPath();
    ctx.ellipse(0, -R * 0.1, R * 1.7, R * 1.12, 0, 0, TAU);
    const inner = ctx.createLinearGradient(0, -R, 0, R);
    inner.addColorStop(0, '#173866');
    inner.addColorStop(1, '#081833');
    ctx.fillStyle = inner;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, -R * 0.28, R * 1.35, R * 0.88, 0, 0, TAU);
    ctx.strokeStyle = 'rgba(142, 198, 255, 0.24)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Four bolts.
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * TAU + Math.PI / 4;
      const bx = Math.cos(a) * R * 1.6;
      const by = Math.sin(a) * R * 0.94;
      ctx.beginPath();
      ctx.arc(bx, by, R * 0.1, 0, TAU);
      ctx.fillStyle = 'rgba(180, 215, 255, 0.35)';
      ctx.fill();
    }
    ctx.restore();

    // Barrel.
    ctx.save();
    ctx.translate(pivotX, pivotY);
    ctx.rotate(angle + Math.PI / 2);
    const barrelLength = R * 2.2;
    const barrelWidth = R * 1.02;
    roundRect(ctx, -barrelWidth / 2, -barrelLength + R * 0.2, barrelWidth, barrelLength, R * 0.4);
    const barrel = ctx.createLinearGradient(-barrelWidth / 2, 0, barrelWidth / 2, 0);
    barrel.addColorStop(0, '#0c1f43');
    barrel.addColorStop(0.28, this.skinColor ? this.mixSkin(this.skinColor, '#3f639b') : '#3f639b');
    barrel.addColorStop(0.5, '#7598c8');
    barrel.addColorStop(0.72, '#2c4c7e');
    barrel.addColorStop(1, '#0a1938');
    ctx.fillStyle = barrel;
    ctx.fill();
    ctx.strokeStyle = 'rgba(170, 210, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Muzzle ring.
    roundRect(ctx, -barrelWidth * 0.64, -barrelLength + R * 0.02, barrelWidth * 1.28, R * 0.38, R * 0.18);
    const rim = ctx.createLinearGradient(0, -barrelLength, 0, -barrelLength + R * 0.4);
    rim.addColorStop(0, this.skinColor || '#a9cdf7');
    rim.addColorStop(1, '#3d6194');
    ctx.fillStyle = rim;
    ctx.fill();
    ctx.restore();

    // Loaded bubble / rainbow / rocket.
    if (!view.flying && this.game?.phase === 'aim') {
      const pulse = 1 + Math.sin(this.time * 4) * 0.012;
      if (rocket) {
        this.drawRocketAt(muzzle.x, muzzle.y, R * pulse, angle, 1);
      } else if (colorId === RAINBOW) {
        ctx.save();
        ctx.shadowColor = `hsla(${(this.time * 120) % 360}, 95%, 70%, 0.85)`;
        ctx.shadowBlur = R * 1.1;
        this.drawSpriteAt(RAINBOW, muzzle.x, muzzle.y, R * pulse, 1);
        ctx.restore();
      } else if (colorId) {
        this.drawSpriteAt(colorId, muzzle.x, muzzle.y, R * pulse, 1);
      }
    }

    // Next bubble with swap arrows.
    const next = this.getNextBubblePosition();
    const nextHovered = view.nextHovered;
    ctx.save();
    ctx.translate(next.x, next.y);
    // Small pedestal.
    ctx.beginPath();
    ctx.ellipse(0, next.radius * 0.95, next.radius * 1.15, next.radius * 0.42, 0, 0, TAU);
    ctx.fillStyle = 'rgba(8, 24, 58, 0.72)';
    ctx.strokeStyle = 'rgba(139, 190, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();
    const nextScale = nextHovered ? 1.1 : 1;
    if (this.game?.next) {
      this.drawSpriteAt(
        this.game.next,
        0,
        -next.radius * 0.15,
        next.radius * nextScale,
        0.96,
      );
    }
    // Swap glyph.
    const arrowRadius = next.radius * 1.32;
    ctx.strokeStyle = nextHovered ? 'rgba(255, 228, 150, 0.95)' : 'rgba(196, 223, 255, 0.6)';
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, -next.radius * 0.15, arrowRadius, -0.55, 0.9);
    ctx.stroke();
    const endAngle = 0.9;
    const ax = Math.cos(endAngle) * arrowRadius;
    const ay = Math.sin(endAngle) * arrowRadius - next.radius * 0.15;
    ctx.beginPath();
    ctx.moveTo(ax - 3, ay - 1);
    ctx.lineTo(ax + 2, ay + 4);
    ctx.lineTo(ax - 5, ay + 5);
    ctx.closePath();
    ctx.fillStyle = nextHovered ? 'rgba(255, 228, 150, 0.95)' : 'rgba(196, 223, 255, 0.6)';
    ctx.fill();
    // Second arrow arc.
    ctx.beginPath();
    ctx.arc(0, -next.radius * 0.15, arrowRadius, Math.PI - 0.55, Math.PI + 0.9);
    ctx.stroke();
    ctx.restore();

    if (nextHovered) {
      ctx.beginPath();
      ctx.arc(next.x, next.y - next.radius * 0.15, next.radius * 1.55, 0, TAU);
      ctx.strokeStyle = 'rgba(255, 220, 120, 0.35)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  drawRainbowDisc(x, y, R, alpha = 1) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (typeof ctx.createConicGradient === 'function') {
      const conic = ctx.createConicGradient(-Math.PI / 2 + this.time, x, y);
      const stops = ['#ff3d5f', '#ff8f3d', '#ffd93d', '#3ddc84', '#3aa0ff', '#a95bff', '#ff3d5f'];
      stops.forEach((color, i) => conic.addColorStop(i / (stops.length - 1), color));
      ctx.beginPath();
      ctx.arc(x, y, R, 0, TAU);
      ctx.fillStyle = conic;
      ctx.fill();
    } else {
      this.drawSpriteAt(RAINBOW, x, y, R, alpha);
    }
    ctx.restore();
  }

  drawBoosterTarget(view) {
    if (!view.boosterMode) return;
    const ctx = this.ctx;
    const cell = view.hoverCell;
    if (!cell) return;
    const x = this.layout.cellX(cell.r, cell.c);
    const y = this.layout.cellY(cell.r);
    const R = this.layout.radius;
    const pulse = 1 + Math.sin(this.time * 7) * 0.08;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(this.time * 0.8);
    ctx.setLineDash([R * 0.32, R * 0.28]);
    ctx.strokeStyle = 'rgba(255, 224, 130, 0.95)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(0, 0, R * 1.32 * pulse, 0, TAU);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    ctx.arc(x, y, R * 1.25, 0, TAU);
    ctx.fillStyle = '#ffd35c';
    ctx.fill();
    ctx.restore();
  }

  drawFloaters() {
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const floater of this.floaters) {
      const alpha = clamp(floater.life / floater.maxLife, 0, 1);
      const size = Math.max(13, this.layout.radius * 0.95);
      ctx.font = `800 ${size}px "Segoe UI", -apple-system, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = `rgba(7, 18, 46, ${alpha * 0.75})`;
      ctx.strokeText(floater.text, floater.x, floater.y);
      ctx.fillStyle = floater.color;
      ctx.globalAlpha = alpha;
      ctx.fillText(floater.text, floater.x, floater.y);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  drawFlash() {
    if (this.flashAlpha <= 0.01) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = clamp(this.flashAlpha, 0, 1);
    ctx.fillStyle = this.flashColor;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();
  }
}

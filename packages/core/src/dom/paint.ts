/**
 * The canvas renderer, the default for live avatars: paints flat avatar frames
 * to one canvas, so an avatar costs one compositor layer and one small bitmap
 * however many slices it shows. Equal geometry shares its parsed paths.
 *
 * The bitmap covers what the frames actually paint, plus slack, and only grows
 * while the avatar's size and the pixel ratio stay the same. A GPU canvas that
 * animates antialiased paths holds several times its bitmap in video memory,
 * so covering every possible view up front (avatarExtent, kept as the upper
 * bound) would cost about three times as much.
 *
 * The canvas sits in a wrapper at the host's content box, as the scene does,
 * overhangs it by the avatar's reach and ignores the pointer.
 */
import { avatarExtent } from '../render.ts';
import type { AvatarFrame, EyeGloss, EyeMark, EyeSpotlight, FramePath, Matrix } from '../render.ts';
import type { AvatarDefinition } from '../types.ts';

/** A square in viewBox units. */
export interface Square {
  x: number;
  y: number;
  size: number;
}

/** An axis-aligned box in viewBox units; empty when x0 > x1. */
export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Slack around a frame's bounds when the bitmap is laid out, viewBox units: idle motion and gaze stay inside it. */
export const FIT_SLACK = 8;
/** Margin a frame keeps from the bitmap's edge for antialiasing, viewBox units. */
export const FIT_PAD = 1;

/**
 * The square to lay the bitmap out over: `prev` while it still holds `b`, else `prev` grown to
 * hold `b` with slack. Never larger than `cap` unless `b` itself leaves `cap`.
 */
export function fitSquare(prev: Square | null, b: Bounds, cap: Square): Square {
  if (!(b.x0 <= b.x1 && b.y0 <= b.y1)) return prev ?? cap;
  if (
    prev &&
    b.x0 - FIT_PAD >= prev.x &&
    b.y0 - FIT_PAD >= prev.y &&
    b.x1 + FIT_PAD <= prev.x + prev.size &&
    b.y1 + FIT_PAD <= prev.y + prev.size
  ) {
    return prev;
  }
  let x0 = b.x0 - FIT_SLACK, y0 = b.y0 - FIT_SLACK, x1 = b.x1 + FIT_SLACK, y1 = b.y1 + FIT_SLACK;
  if (prev) {
    x0 = Math.min(x0, prev.x);
    y0 = Math.min(y0, prev.y);
    x1 = Math.max(x1, prev.x + prev.size);
    y1 = Math.max(y1, prev.y + prev.size);
  }
  const size = Math.max(x1 - x0, y1 - y0);
  const inCap = b.x0 >= cap.x && b.y0 >= cap.y && b.x1 <= cap.x + cap.size && b.y1 <= cap.y + cap.size;
  if (size >= cap.size && inCap) return cap;
  return { x: (x0 + x1 - size) / 2, y: (y0 + y1 - size) / 2, size };
}

interface Section {
  path: Path2D;
  rule: CanvasFillRule;
}

const MAX_SECTIONS = 4096;
const sections = new Map<string, Section>();

let supported: boolean | undefined;
/** Whether this environment can paint avatars: a 2D canvas and Path2D (jsdom has neither). */
export function canvasSupported(): boolean {
  if (supported === undefined) {
    // Path2D first: asking jsdom for a context logs a "not implemented" error.
    supported = typeof Path2D !== 'undefined' && typeof document !== 'undefined' && !!document.createElement('canvas').getContext('2d');
  }
  return supported;
}

/**
 * Each shape's matrix with the frame's root motion applied, and the bounds of everything the frame
 * paints, in viewBox units. Pure.
 */
export function framePlacement(frame: AvatarFrame): { matrices: Matrix[]; bounds: Bounds } {
  const boxes = new Map(frame.paths.map((p) => [p.id, p.box]));
  const [ra, rb, rc, rd, re, rf] = frame.root;
  const bounds: Bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const add = (m: Matrix, x: number, y: number) => {
    const X = m[0] * x + m[2] * y + m[4], Y = m[1] * x + m[3] * y + m[5];
    if (X < bounds.x0) bounds.x0 = X;
    if (X > bounds.x1) bounds.x1 = X;
    if (Y < bounds.y0) bounds.y0 = Y;
    if (Y > bounds.y1) bounds.y1 = Y;
  };
  const matrices = frame.shapes.map((shape) => {
    const [a, b, c, d, e, f] = shape.matrix;
    const m: Matrix = [ra * a + rc * b, rb * a + rd * b, ra * c + rc * d, rb * c + rd * d, ra * e + rc * f + re, rb * e + rd * f + rf];
    const box = shape.kind === 'slice' ? boxes.get(shape.path) : shape.kind === 'eye' ? eyeBox(shape.mark) : shape.box;
    if (box) {
      add(m, box.x, box.y);
      add(m, box.x + box.w, box.y);
      add(m, box.x, box.y + box.h);
      add(m, box.x + box.w, box.y + box.h);
    }
    return m;
  });
  if (frame.shadow) {
    const { cx, cy, rx, ry } = frame.shadow;
    if (cx - rx < bounds.x0) bounds.x0 = cx - rx;
    if (cx + rx > bounds.x1) bounds.x1 = cx + rx;
    if (cy + ry > bounds.y1) bounds.y1 = cy + ry;
    if (cy - ry < bounds.y0) bounds.y0 = cy - ry;
  }
  return { matrices, bounds };
}

function eyeBox(mark: EyeMark): FramePath['box'] {
  if (mark.shape === 'pill') return { x: mark.x, y: mark.y, w: mark.width, h: mark.height };
  // Quadratics lie within their points' hull; an arc's stroke reaches half its width past it.
  const reach = mark.shape === 'arc' ? mark.strokeWidth : 0;
  const n = (mark.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const xs = n.filter((_, i) => i % 2 === 0), ys = n.filter((_, i) => i % 2 === 1);
  const x = Math.min(...xs) - reach, y = Math.min(...ys) - reach;
  return { x, y, w: Math.max(...xs) + reach - x, h: Math.max(...ys) + reach - y };
}

/** One of an eye's lights or its shadow, left as the fill style's own color at this opacity. */
function spot(ctx: CanvasRenderingContext2D, s: EyeSpotlight, color: string) {
  if (s.opacity <= 0.005) return;
  ctx.fillStyle = color;
  ctx.globalAlpha = s.opacity;
  ctx.beginPath();
  ctx.ellipse(s.cx, s.cy, s.rx, s.ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** An eye with its depth: the shadow it sits in, the eye in `ink`, then the light on it. */
function glossyEye(ctx: CanvasRenderingContext2D, mark: EyeMark, gloss: EyeGloss | undefined, ink: string, socket = true) {
  if (gloss && socket) spot(ctx, gloss.socket, '#000');
  ctx.fillStyle = ink;
  eye(ctx, mark);
  if (!gloss) return;
  spot(ctx, gloss.sheen, '#fff');
  spot(ctx, gloss.glint, '#fff');
  spot(ctx, gloss.spark, '#fff');
}

function eye(ctx: CanvasRenderingContext2D, mark: EyeMark) {
  if (mark.shape === 'path') {
    ctx.fill(new Path2D(mark.d));
    return;
  }
  if (mark.shape === 'arc') {
    ctx.lineWidth = mark.strokeWidth;
    ctx.stroke(new Path2D(mark.d));
    return;
  }
  const { x, y, width: w, height: h, radius: rx, radiusY: ry } = mark;
  ctx.beginPath();
  // An oval: a round rect whose corners take up the whole box, or an ellipse where there is none
  // (Safari before 16 and Firefox before 112).
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, [{ x: rx, y: ry }]);
  else ctx.ellipse(x + w / 2, y + h / 2, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** A mounted canvas and the square and size its bitmap was last laid out at. */
export interface CanvasSurface {
  key: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  cap: Square;
  fit: Square | null;
  layout: string;
  left: number;
  top: number;
}

export function mountCanvas(el: HTMLElement, key: string, definition: AvatarDefinition, depth: number | undefined): CanvasSurface {
  const cap = avatarExtent(definition, depth);
  const wrap = document.createElement('div');
  // In flow at the content box, like the scene's root, so the host's padding and border place it.
  wrap.style.cssText = 'position:relative;width:100%;height:100%;pointer-events:none';
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute';
  wrap.append(canvas);
  el.replaceChildren(wrap);
  return { key, canvas, ctx: canvas.getContext('2d'), cap, fit: null, layout: '', left: 0, top: 0 };
}

/** Paint one frame `size` CSS pixels wide. `fill` and `ink` override the frame's colors with any canvas color. */
export function paintCanvas(surface: CanvasSurface, frame: AvatarFrame, size: number, fill = frame.color, ink = frame.ink) {
  const { canvas, ctx } = surface;
  if (!ctx || size <= 0) return;
  const dpr = window.devicePixelRatio || 1;
  const scale = (size / 100) * dpr;
  const layout = `${size}|${dpr}`;
  if (sections.size > MAX_SECTIONS) sections.clear();
  for (const { id, d, evenOdd } of frame.paths) {
    if (!sections.has(id)) sections.set(id, { path: new Path2D(d), rule: evenOdd ? 'evenodd' : 'nonzero' });
  }
  const { matrices, bounds } = framePlacement(frame);
  const fit = fitSquare(surface.layout === layout ? surface.fit : null, bounds, surface.cap);
  if (surface.layout === layout && fit === surface.fit) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  } else {
    // Whole device pixels, so the bitmap is never resampled. Setting the width also clears it.
    surface.layout = layout;
    surface.fit = fit;
    surface.left = Math.floor(fit.x * scale);
    surface.top = Math.floor(fit.y * scale);
    const bitmap = Math.ceil(fit.size * scale) + 1;
    canvas.width = canvas.height = bitmap;
    canvas.style.left = `${surface.left / dpr}px`;
    canvas.style.top = `${surface.top / dpr}px`;
    canvas.style.width = canvas.style.height = `${bitmap / dpr}px`;
  }

  ctx.lineCap = 'round';
  ctx.strokeStyle = ink;
  ctx.fillStyle = fill;
  // A shaded frame's cross-sections carry their own colors, worked out from the frame's color.
  const shaded = fill === frame.color;
  let current = fill;
  // Shapes run in the thousands per second across a page: one setTransform each beats save/restore.
  const paintShape = (i: number) => {
    const shape = frame.shapes[i], m = matrices[i];
    ctx.setTransform(scale * m[0], scale * m[1], scale * m[2], scale * m[3], scale * m[4] - surface.left, scale * m[5] - surface.top);
    if (shape.kind === 'slice') {
      const section = sections.get(shape.path) as Section;
      const want = shaded && shape.fill ? shape.fill : fill;
      if (shaded && shape.fill && shape.fade) {
        // A limb where it leaves the body: from the body's shade into its own.
        const g = shape.fade, paint = ctx.createLinearGradient(g.x1, g.y1, g.x2, g.y2);
        paint.addColorStop(0, g.from);
        paint.addColorStop(1, shape.fill);
        ctx.fillStyle = paint;
        current = '';
      } else if (want !== current) ctx.fillStyle = current = want;
      ctx.fill(section.path, section.rule);
    } else if (shape.kind === 'eye') {
      glossyEye(ctx, shape.mark, shape.gloss, ink);
      ctx.fillStyle = current = fill;
    } else {
      const g = shape.gradient;
      const paint = ctx.createLinearGradient(g.x1, g.y1, g.x2, g.y2);
      g.stops.forEach((c, i) => paint.addColorStop(i / (g.stops.length - 1), c));
      ctx.fillStyle = paint;
      ctx.fill(new Path2D(shape.d));
      ctx.fillStyle = current = fill;
    }
  };
  const lit = !!frame.light || !!frame.grain;
  if (!lit && !frame.shadow) {
    for (let i = 0; i < frame.shapes.length; i++) paintShape(i);
    return;
  }

  // Lit, grained or shadowed: the body goes first, so light and grain can fall on it alone. What is
  // behind it (ribbons, then the shadow) is slipped underneath after, and the rest goes on top.
  const isBody = (i: number) => {
    const shape = frame.shapes[i];
    return shape.kind === 'eye' || (shape.kind === 'slice' && !shape.key.startsWith('mark-'));
  };
  for (let i = 0; i < frame.shapes.length; i++) if (isBody(i)) paintShape(i);
  if (lit) paintSurface();
  ctx.globalCompositeOperation = 'destination-over';
  for (let i = frame.shapes.length - 1; i >= 0; i--) {
    const shape = frame.shapes[i];
    if (shape.kind === 'ribbon' && !shape.front) paintShape(i);
  }
  if (frame.shadow) {
    // A unit circle fading outward, squashed to the shadow's ellipse.
    const { cx, cy, rx, ry, opacity } = frame.shadow;
    ctx.setTransform(scale * rx, 0, 0, scale * ry, scale * cx - surface.left, scale * cy - surface.top);
    const soft = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    soft.addColorStop(0, `rgba(0,0,0,${opacity})`);
    soft.addColorStop(0.6, `rgba(0,0,0,${opacity * 0.45})`);
    soft.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = soft;
    ctx.fillRect(-1, -1, 2, 2);
  }

  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = current = fill;
  for (let i = 0; i < frame.shapes.length; i++) {
    const shape = frame.shapes[i];
    if (!isBody(i) && !(shape.kind === 'ribbon' && !shape.front)) paintShape(i);
  }

  function paintSurface() {
    // Grain and light go only over what was painted.
    if (!ctx) return;
    ctx.globalCompositeOperation = 'source-atop';
  if (frame.grain) {
    const speckle = grainPattern(ctx);
    if (speckle) {
      const [a, b, c, d, e, f] = frame.root;
      // In the body's own space, so the speckles hop and lean with it.
      ctx.setTransform(scale * a, scale * b, scale * c, scale * d, scale * e - surface.left, scale * f - surface.top);
      ctx.globalAlpha = frame.grain;
      ctx.fillStyle = speckle;
      ctx.fillRect(-100, -100, 300, 300);
      ctx.globalAlpha = 1;
      // The eyes are ink, not stone: over the speckles again.
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = ink;
      for (let i = 0; i < frame.shapes.length; i++) {
        const shape = frame.shapes[i], m = matrices[i];
        if (shape.kind !== 'eye') continue;
        ctx.setTransform(scale * m[0], scale * m[1], scale * m[2], scale * m[3], scale * m[4] - surface.left, scale * m[5] - surface.top);
        glossyEye(ctx, shape.mark, shape.gloss, ink, false);
      }
      ctx.globalCompositeOperation = 'source-atop';
    }
  }
  if (frame.light) {
    const l = frame.light;
    ctx.setTransform(scale, 0, 0, scale, -surface.left, -surface.top);
    const paint = ctx.createLinearGradient(l.x1, l.y1, l.x2, l.y2);
    for (const st of l.stops) paint.addColorStop(st.at, withAlpha(st.color, st.opacity));
    ctx.fillStyle = paint;
    ctx.fillRect(fit.x - 1, fit.y - 1, fit.size + 2, fit.size + 2);
  }
  ctx.globalCompositeOperation = 'source-over';
  }
}

function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Viewbox units per pixel of the grain tile: a speckle is about a third of a unit. */
const GRAIN_UNIT = 0.3;
const GRAIN_TILE = 256;
let grainTile: HTMLCanvasElement | null | undefined;

/** Dark and a few light speckles of mixed size on a clear tile; the same every time. */
function grainPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (grainTile === undefined) {
    grainTile = document.createElement('canvas');
    grainTile.width = grainTile.height = GRAIN_TILE;
    const g = grainTile.getContext('2d');
    if (!g) grainTile = null;
    else {
      let seed = 0x2f6e2b1;
      const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
      for (let i = 0; i < 5200; i++) {
        const x = rnd() * GRAIN_TILE, y = rnd() * GRAIN_TILE, big = rnd() < 0.06, light = rnd() < 0.3;
        const r = big ? 1.4 + rnd() * 1.6 : 0.5 + rnd() * 0.7;
        g.fillStyle = light ? `rgba(255,255,255,${0.25 + rnd() * 0.3})` : `rgba(40,30,20,${big ? 0.3 + rnd() * 0.25 : 0.18 + rnd() * 0.3})`;
        // Wrapped at the edges, so the tile repeats without a seam.
        for (const ox of [0, GRAIN_TILE, -GRAIN_TILE]) for (const oy of [0, GRAIN_TILE, -GRAIN_TILE]) {
          if (x + ox < -4 || x + ox > GRAIN_TILE + 4 || y + oy < -4 || y + oy > GRAIN_TILE + 4) continue;
          g.beginPath();
          g.ellipse(x + ox, y + oy, r, r * (0.6 + rnd() * 0.4), rnd() * Math.PI, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
  }
  if (!grainTile) return null;
  const pattern = ctx.createPattern(grainTile, 'repeat');
  if (pattern && typeof DOMMatrix !== 'undefined') pattern.setTransform(new DOMMatrix([GRAIN_UNIT, 0, 0, GRAIN_UNIT, 0, 0]));
  return pattern;
}

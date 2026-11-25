/**
 * The outline of one eye for any look. The open oval, the happy eye (its lower lid pushed up into
 * a dome) and the waiting eye (its upper lid half down) are each walked as a closed outline from
 * the top centre, clockwise, at even steps; mixing them point by point gives every shape in
 * between, so a change of state or mood morphs the eyes instead of swapping them. All three lie
 * inside the open oval, so they keep the room validation leaves for it.
 */
import type { EyeLook } from './motion.ts';
import type { Point } from './path.ts';

/** Where one eye is drawn this frame, in its face plane (viewBox units). */
export interface EyeSpot {
  /** Centre, gaze included. */
  x: number;
  y: number;
  /** Contract size: the happy arc and the slit are measured from it. */
  w: number;
  h: number;
  /** Width and full height of the open eye as drawn: an oval, wider and shorter than the contract's pill. */
  pw: number;
  ph: number;
  /** Height of the open eye after blink and squint, and how far that moves it down. */
  open: number;
  shift: number;
}

/** Points per outline. */
const STEPS = 40;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** `count` points at even steps along a closed polyline, the first one at its first point. */
function resample(pts: Point[], count: number): Point[] {
  const n = pts.length;
  const at: number[] = [0];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    at.push(at[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = at[n];
  const out: Point[] = [];
  let i = 0;
  for (let k = 0; k < count; k++) {
    const s = (k / count) * total;
    while (i < n - 1 && at[i + 1] < s) i++;
    const a = pts[i], b = pts[(i + 1) % n];
    const u = at[i + 1] > at[i] ? (s - at[i]) / (at[i + 1] - at[i]) : 0;
    out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
  }
  return out;
}

/** The open eye: an ellipse `w` wide and `h` tall about (cx, cy), from the top centre, clockwise. */
function oval(cx: number, cy: number, w: number, h: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < 28; i++) {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / 28;
    pts.push([cx + (Math.cos(a) * w) / 2, cy + (Math.sin(a) * h) / 2]);
  }
  return pts;
}

/** How far below its centre a happy eye's corners sit, and how far its lower lid rises between them (shares of its height). */
const HAPPY = { corner: 0.2, rise: 0.36 } as const;
/** Where a waiting eye's upper lid meets its rim: angles on the oval at the right and at the left, so the lid tips. */
const LID = { right: -0.1, left: Math.PI + 0.28 } as const;

/**
 * The happy eye: the top of the oval, with the lower lid pushed up into it by the cheek, so what
 * shows is a dome with a curved-in base. From the top centre, clockwise.
 */
function dome(e: EyeSpot): Point[] {
  const cut = Math.asin(2 * HAPPY.corner);
  const at = (a: number): Point => [e.x + (Math.cos(a) * e.pw) / 2, e.y + (Math.sin(a) * e.ph) / 2];
  const right = at(cut), left = at(Math.PI - cut);
  const peak = right[1] - HAPPY.rise * e.ph;
  const pts: Point[] = [];
  for (let i = 0; i <= 8; i++) pts.push(at(-Math.PI / 2 + ((cut + Math.PI / 2) * i) / 8));
  // The lid, right to left: a quadratic that rises in the middle.
  for (let i = 1; i < 10; i++) {
    const t = i / 10, m = 1 - t;
    pts.push([m * m * right[0] + 2 * m * t * e.x + t * t * left[0], m * m * right[1] + 2 * m * t * peak + t * t * left[1]]);
  }
  for (let i = 0; i < 8; i++) pts.push(at(Math.PI - cut + ((cut + Math.PI / 2) * i) / 8));
  return pts;
}

/**
 * The waiting eye: the upper lid half down and tipped, so what shows is the lower part of the
 * oval under a straight lid. A blink lowers the whole eye, as it does the open one. From the
 * middle of the lid, clockwise.
 */
function lidded(e: EyeSpot): Point[] {
  const cy = e.y + e.shift;
  const at = (a: number): Point => [e.x + (Math.cos(a) * e.pw) / 2, cy + (Math.sin(a) * e.open) / 2];
  const right = at(LID.right), left = at(LID.left);
  const pts: Point[] = [[(left[0] + right[0]) / 2, (left[1] + right[1]) / 2]];
  for (let i = 0; i <= 18; i++) pts.push(at(LID.right + ((LID.left - LID.right) * i) / 18));
  return pts;
}

/** Whether a look is exactly the open eye or exactly the happy one. */
export function plainLook(look: EyeLook): 'pill' | 'arc' | null {
  if (look.arc >= 1) return 'arc';
  return look.arc <= 0 && look.slit <= 0 ? 'pill' : null;
}

/** The outline of one eye, closed, clockwise from the top: the open oval, the happy dome and the lidded eye mixed by the look. */
export function eyeOutline(look: EyeLook, e: EyeSpot): Point[] {
  const a = clamp(look.arc, 0, 1), s = clamp(look.slit, 0, 1 - a);
  const shapes: [number, Point[]][] = [[1 - a - s, oval(e.x, e.y + e.shift, e.pw, e.open)], [a, dome(e)], [s, lidded(e)]];
  const out: Point[] = Array.from({ length: STEPS }, () => [0, 0]);
  for (const [weight, shape] of shapes) {
    if (weight <= 0) continue;
    resample(shape, STEPS).forEach(([x, y], i) => {
      out[i][0] += x * weight;
      out[i][1] += y * weight;
    });
  }
  return out;
}

const f = (n: number) => {
  const r = Math.round(n * 100) / 100;
  return (Object.is(r, -0) ? 0 : r).toString();
};

/** A smooth closed path through an outline: a quadratic per point, joined at the midpoints. Absolute M, Q and Z only. */
export function outlinePath(pts: Point[]): string {
  const n = pts.length;
  const mid = (i: number): Point => {
    const a = pts[i % n], b = pts[(i + 1) % n];
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  };
  const start = mid(n - 1);
  let d = `M${f(start[0])} ${f(start[1])}`;
  for (let i = 0; i < n; i++) {
    const m = mid(i);
    d += `Q${f(pts[i][0])} ${f(pts[i][1])} ${f(m[0])} ${f(m[1])}`;
  }
  return `${d}Z`;
}

/** The path of one eye for any look but the plain open one. */
export function eyePath(look: EyeLook, e: EyeSpot): string {
  return outlinePath(eyeOutline(look, e));
}

/**
 * Renderers for a validated silhouette + eye placement with implied volume
 * (see volume.ts). One body color, flat unless `shading`, `grain` or `shadow`
 * ask for more, and two dark oval eyes with a shadow round them and highlights
 * on them. Output is built only from numbers and the renderer's own markup.
 *
 * - avatarFrame: one frame flattened to plain data (paths, matrices, eyes),
 *   for any vector renderer.
 * - renderAvatarSvg: a standalone still, serialized from avatarFrame. Cross-sections of the stack that
 *   faces the viewer are projected orthographically and painted back to front.
 * - renderAvatarScene + sceneFrame: a CSS 3D scene. Every cross-section is its
 *   own small SVG placed once with a 3D transform; animating, turning and
 *   recoloring only change a few CSS transforms, and the browser's compositor
 *   does projection and occlusion. Each visible slice costs a compositor layer,
 *   so mountAvatar paints live avatars to one canvas by default and only uses
 *   the scene with `renderer: 'scene'`.
 *
 * A state can draw more than the body (see effects.ts): ribbons behind and in front of it, and
 * the marks a thinking or blocked bot turns into. Those stay where they are while the body hops
 * and rolls.
 */
import { mix, oklch, parseHex, toHex, toOklch } from './color.ts';
import type { Rgb } from './color.ts';
import { bodyScale, markParts, ribbonPieces, ribbonReach, rimOf } from './effects.ts';
import type { Rim } from './effects.ts';
import type { Box } from './effects.ts';
import { eyePath, plainLook } from './eyes.ts';
import type { EyeSpot } from './eyes.ts';
import { computePose, hashString, noise } from './motion.ts';
import type { EyeLook, Limbs, Pose } from './motion.ts';
import type { Bounds, Point } from './path.ts';
import { EYE_H, EYE_W, GAZE_X, GAZE_Y, HAPPY_ARC, analyzeBody, eyeCenters, gazeRange, validateAvatar } from './validate.ts';
import type { GazeRange } from './validate.ts';
import { buildVolume } from './volume.ts';
import type { EyePlane, Vec3, Volume, VolumeSlice } from './volume.ts';
import type { AvatarDefinition, RenderOptions } from './types.ts';

export const DEFAULT_COLOR = '#ff6a1a';
export const DEFAULT_EYE_COLOR = '#151515';
/**
 * The open eye as drawn, against the contract's 4 × 11 pill: this many times as wide and as tall.
 * A rounder eye reads as a bead in the body; it stays inside the room validation keeps for the
 * pill and the happy arc.
 */
const EYE_OVAL = { wide: 1.5, tall: 0.8 } as const;

/** `depth` option value that maps to the natural inferred volume. */
export const DEFAULT_DEPTH = 6;
const MAX_DEPTH = 14;
/**
 * CSS eyes sit this far above the surface so they never touch the body planes. iOS WebKit treats planes
 * closer than about a pixel as one and may draw the body over an eye (0.3 did: a band of the
 * barbell's bar through one eye), so the gap is a few pixels at the stage's size. Turned, an eye
 * drifts lift × sin(angle) from its spot: under half a unit at rest, about one at 45°.
 */
const CSS_EYE_LIFT = 1.5;

interface Prepared {
  def: AvatarDefinition;
  vol: Volume;
  range: GazeRange;
  seed: number;
  /** Prefix for SVG ids; equal geometry and depth always give equal ids, so repeats on a page are safe. */
  id: string;
  /** Stable SVG id per distinct cross-section path, assigned once. */
  ids: Map<string, string>;
  /** Slices kept at a rendered size, per stack, keyed by stack and rounded size. */
  detail: Map<string, boolean[]>;
  /** Where the ribbons' hoops are centred and how far the body reaches from there (see ribbonRims). */
  rims: () => { work: Rim; cage: Rim };
  /** How far each arm of a rigged body can be raised and bent before it runs into the head (see armReach). */
  reach: () => { l?: ArmReach; r?: ArmReach };
}

const cache = new Map<string, Prepared>();

const f = (n: number) => {
  const r = Math.round(n * 100) / 100;
  return (Object.is(r, -0) ? 0 : r).toString();
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function depthOption(options: RenderOptions): number {
  const d = clamp(Number.isFinite(options.depth) ? (options.depth as number) : DEFAULT_DEPTH, 0, MAX_DEPTH);
  return Math.round(d * 2) / 2;
}

const lazy = <T>(make: () => T): (() => T) => {
  let value: T | undefined;
  return () => (value ??= make());
};

/**
 * How far the body reaches from the middle of its box, for a working turn's hoop and for a
 * celebration's cage. The hoops' centre hops and stretches with the body (see ribbonsFollow) but
 * does not lean or sway with it, so each is measured over the leans its state takes, the body
 * stretched about the centre: a working bot leans 2.4° to 6.6° and squashes to 98%; a celebrating
 * one sways ±1.7° and stretches up to 5.5%. The hoops stand just outside that, so the body never
 * moves through a point where a ribbon passes behind it.
 */
export function ribbonRims(polys: Point[][], b: Bounds): { work: Rim; cage: Rim } {
  const [cx, cy] = pivotOf(b);
  const bx = (b.minX + b.maxX) / 2, by = b.maxY;
  /** The body leaned by each of `rolls` (degrees, about its base) and stretched by each of `sys` about the centre. */
  const posed = (rolls: number[], sys: number[]) => {
    const out: Point[][][] = [];
    for (const roll of rolls) {
      const r = (roll * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
      for (const k of sys) {
        out.push(polys.map((poly) => poly.map(([x, y]): Point => {
          const lx = bx + c * (x - bx) - sn * (y - by), ly = by + sn * (x - bx) + c * (y - by);
          return [cx + 1.01 * (lx - cx), cy + k * (ly - cy)];
        })));
      }
    }
    return out;
  };
  return { work: rimOf(posed([2.4, 4.5, 6.6], [0.98, 1]), cx, cy), cage: rimOf(posed([-1.7, 0, 1.7], [0.99, 1.055]), cx, cy) };
}

/**
 * The rim moved to where the hoops' centre is in this pose: it hops and stretches with the body
 * (the root motion's lift and scale about the base) but does not lean or sway with it.
 */
export function ribbonsFollow(rim: Rim, pose: Pick<Pose, 'lift' | 'sx' | 'sy'>, b: Bounds): Rim {
  const bx = (b.minX + b.maxX) / 2, by = b.maxY;
  return { ...rim, cx: bx + pose.sx * (rim.cx - bx), cy: by + pose.sy * (rim.cy - by) + pose.lift };
}

function prepare(definition: AvatarDefinition, depth: number): Prepared {
  // A character keeps its proportions: a head drawn round is a ball, never stretched front to back.
  if (definition?.rig?.length) depth = Math.min(depth, DEFAULT_DEPTH);
  const key = JSON.stringify([definition?.id, definition?.name, definition?.body?.path, definition?.eyes, definition?.rig, depth]);
  const hit = cache.get(key);
  if (hit) return hit;
  const res = validateAvatar(definition);
  if (!res.ok) throw new Error(`Invalid avatar definition: ${res.errors.join('; ')}`);
  const def = res.value;
  const body = analyzeBody(def.body.path);
  const vol = buildVolume(def, depth / DEFAULT_DEPTH, body);
  const id = `oba-${hashString(`${def.id}|${def.body.path}|${depth}`).toString(36)}`;
  const ids = new Map<string, string>();
  for (const part of vol.parts) for (const s of [...part.zSlices, ...part.xSlices, ...(part.ySlices ?? [])]) if (!ids.has(s.d)) ids.set(s.d, `${id}-${ids.size}`);
  const prepared: Prepared = {
    def,
    vol,
    range: gazeRange(body.polys, { ...def.eyes, scale: vol.eyeScale }),
    seed: hashString(def.id),
    id,
    ids,
    detail: new Map(),
    rims: lazy(() => ribbonRims(body.polys, vol.bounds)),
    reach: lazy(() => ({ l: armReach(def, vol, 'l'), r: armReach(def, vol, 'r') })),
  };
  if (cache.size >= 64) cache.delete(cache.keys().next().value as string);
  cache.set(key, prepared);
  return prepared;
}

/** The validated definition and its cached volume, exactly as the renderers use them. Throws if invalid. */
export function preparedVolume(definition: AvatarDefinition, depth?: number): { def: AvatarDefinition; vol: Volume } {
  const p = prepare(definition, depthOption({ depth }));
  return { def: p.def, vol: p.vol };
}

function poseOf(p: Prepared, options: RenderOptions): Pose {
  return computePose({
    seed: p.seed,
    time: Number.isFinite(options.time) ? (options.time as number) : 0,
    state: options.state,
    mood: options.mood,
    motion: options.motion,
    stateAge: options.stateAge,
    gaze: options.gaze,
    reducedMotion: options.reducedMotion === true,
    view: options.view,
    blend: options.motionBlend,
    rigged: !!p.def.rig?.length,
  });
}

// ---------------------------------------------------------------------------
// Rig: parts that turn about joints

/** A rigid move in model space: p' = r·p + t, r a 3 × 3 rotation in row order. */
interface Rigid {
  r: number[];
  t: Vec3;
}

const moved = (g: Rigid, [x, y, z]: Vec3): Vec3 => [
  g.r[0] * x + g.r[1] * y + g.r[2] * z + g.t[0],
  g.r[3] * x + g.r[4] * y + g.r[5] * z + g.t[1],
  g.r[6] * x + g.r[7] * y + g.r[8] * z + g.t[2],
];

/** `a` after `b`. */
function after(a: Rigid, b: Rigid): Rigid {
  const r = new Array<number>(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a.r[i * 3] * b.r[j] + a.r[i * 3 + 1] * b.r[3 + j] + a.r[i * 3 + 2] * b.r[6 + j];
  return { r, t: moved(a, b.t) };
}

/**
 * A turn about the joint at (px, py) on the mid-plane: first `swing` degrees about the horizontal
 * axis (a limb that hangs down comes toward the viewer), then `turn` degrees in the plane of the
 * drawing, clockwise on screen.
 */
function joint(px: number, py: number, turn: number, swing: number): Rigid {
  const a = (turn * Math.PI) / 180, b = (swing * Math.PI) / 180;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  const r = [ca, -sa * cb, sa * sb, sa, ca * cb, -ca * sb, 0, sb, cb];
  const g: Rigid = { r, t: [0, 0, 0] };
  const [x, y] = moved(g, [px, py, 0]);
  g.t = [px - x, py - y, -(r[6] * px + r[7] * py)];
  return g;
}

/**
 * How far an arm goes before it meets the head: `max` is the highest it can be raised out straight,
 * and `lo`/`hi` how far its forearm can then bend each way, every REACH_STEP degrees of raise from 0.
 */
interface ArmReach { max: number; lo: number[]; hi: number[] }
const REACH_STEP = 5;
/** Room kept between an arm and the head, viewBox units. */
const REACH_GAP = 0.8;
/** Over how many degrees a raise eases into its limit instead of stopping dead. */
const REACH_EASE = 22;

/**
 * A character's head is often wider than its shoulders, so an arm raised overhead would pass
 * through it. Measured once per character, on the drawing: the arm is turned up a step at a time
 * until its elbow or hand would touch the head (or what the head wears), and at each step the
 * forearm is bent each way until the hand would.
 */
function armReach(def: AvatarDefinition, vol: Volume, side: 'l' | 'r'): ArmReach | undefined {
  const rig = def.rig ?? [];
  const sh = rig.find((j) => j.role === `arm-${side}`), fo = rig.find((j) => j.role === `forearm-${side}`);
  const heads = rig.filter((j) => j.role === 'head').map((j) => vol.parts[j.part]);
  if (!sh || !fo || !heads.length) return undefined;
  const arm = vol.parts[sh.part], fore = vol.parts[fo.part];
  const sign = side === 'l' ? 1 : -1;
  const ring = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
  const touches = (x: number, y: number, r: number) =>
    heads.some((h) => x + r > h.bounds.minX && x - r < h.bounds.maxX && y + r > h.bounds.minY && y - r < h.bounds.maxY && ring.some(([dx, dy]) => h.height(x + dx * r, y + dy * r) > 0));
  // Along the forearm from the elbow: its middle, and the hand at its end.
  const tip: Point = [fo.x + (fore.center[0] - fo.x) * 2, fo.y + (fore.center[1] - fo.y) * 2];
  const along = (t: number): Vec3 => [fo.x + (tip[0] - fo.x) * t, fo.y + (tip[1] - fo.y) * t, 0];
  const ra = arm.thickness / 2 + REACH_GAP, rf = fore.thickness / 2 + REACH_GAP;
  const clear = (raise: number, bend: number): boolean => {
    const up = joint(sh.x, sh.y, sign * raise, 0), on = after(up, joint(fo.x, fo.y, sign * bend, 0));
    const elbow = moved(up, [fo.x, fo.y, 0]);
    if (touches(elbow[0], elbow[1], ra)) return false;
    for (const t of [0.45, 0.78]) {
      const q = moved(on, along(t));
      if (touches(q[0], q[1], rf)) return false;
    }
    return true;
  };
  if (!clear(0, 0)) return undefined;
  let max = 0;
  while (max < 180 && clear(max + 1, 0)) max++;
  const lo: number[] = [], hi: number[] = [];
  for (let a = 0; a < max + REACH_STEP; a += REACH_STEP) {
    const raise = Math.min(a, max);
    let down = 0, upTo = 0;
    while (down > -150 && clear(raise, down - 3)) down -= 3;
    while (upTo < 150 && clear(raise, upTo + 3)) upTo += 3;
    lo.push(down); hi.push(upTo);
  }
  return { max, lo, hi };
}

/** An arm's raise and bend, held within its reach: the raise eases into its limit, the bend stops at its own. */
function withinReach(reach: ArmReach | undefined, raise: number, bend: number): [number, number] {
  if (!reach || raise <= 0) return [raise, bend];
  const knee = Math.max(0, reach.max - REACH_EASE);
  const a = raise <= knee ? raise : knee + (reach.max - knee) * (1 - Math.exp(-(raise - knee) / Math.max(1, reach.max - knee)));
  const at = Math.min(reach.lo.length - 1, a / REACH_STEP), i = Math.min(reach.lo.length - 2, Math.floor(at)), u = at - i;
  const lo = reach.lo.length > 1 ? reach.lo[i] + (reach.lo[i + 1] - reach.lo[i]) * u : reach.lo[0];
  const hi = reach.hi.length > 1 ? reach.hi[i] + (reach.hi[i + 1] - reach.hi[i]) * u : reach.hi[0];
  return [a, Math.min(hi, Math.max(lo, bend))];
}

/** How much better another stack must face the viewer before a limb leaves the view's own. */
const STACK_KEEP = 0.12;

/**
 * Which stack of cross-sections a turned limb is drawn with: the one whose planes face the viewer
 * most squarely once the limb has turned. Drawn with planes seen edge-on, a limb falls apart into
 * stripes with gaps between them. The view's own stack is kept while it is nearly as good, so a
 * limb at rest matches the body it hangs from.
 */
function limbStack(vol: Volume, v: ViewBasis, stack: 'z' | 'x', part: number, g: Rigid | undefined): 'z' | 'x' | 'y' {
  if (!g || !vol.parts[part].ySlices?.length) return stack;
  const facing = { x: Math.abs(facingOf(v, [g.r[0], g.r[3], g.r[6]])), y: Math.abs(facingOf(v, [g.r[1], g.r[4], g.r[7]])), z: Math.abs(facingOf(v, [g.r[2], g.r[5], g.r[8]])) };
  const best = facing.x > facing.y ? (facing.x > facing.z ? 'x' : 'z') : facing.y > facing.z ? 'y' : 'z';
  return facing[stack] >= facing[best] - STACK_KEEP ? stack : best;
}

/**
 * The shoes of a rigged body, by part index, each with its side: of the parts a shin's joint
 * carries, the lowest. A shoe can turn on the ball of its foot on its own (see Limbs.footL).
 */
function shoes(def: AvatarDefinition, vol: Volume): Map<number, 'l' | 'r'> {
  const found = new Map<number, 'l' | 'r'>();
  for (const side of ['l', 'r'] as const) {
    const parts = (def.rig ?? []).filter((j) => j.role === `shin-${side}`).map((j) => j.part);
    if (parts.length < 2) continue;
    found.set(parts.reduce((low, i) => (vol.parts[i].bounds.maxY > vol.parts[low].bounds.maxY ? i : low)), side);
  }
  return found;
}

/**
 * The move each rigged part is ordered by, front to back. A shoe goes by its shin's: tipped on the
 * ball of its foot it would otherwise jump in front of the shin it hangs from, or behind it, part
 * way through a tap.
 */
function orderMoves(def: AvatarDefinition, vol: Volume, moves: Map<number, Rigid>): Map<number, Rigid> {
  const order = new Map(moves);
  for (const [part, side] of shoes(def, vol)) {
    const shin = (def.rig ?? []).find((j) => j.role === `shin-${side}` && j.part !== part);
    const g = shin && moves.get(shin.part);
    if (g) order.set(part, g);
  }
  return order;
}

/** A heel lifted `degrees`: a turn about the ball of the foot, toward the front of the shoe where it meets the ground. */
function heelLift(part: Volume['parts'][number], degrees: number): Rigid {
  const b = (-degrees * Math.PI) / 180, cb = Math.cos(b), sb = Math.sin(b);
  const r = [1, 0, 0, 0, cb, -sb, 0, sb, cb];
  const py = part.bounds.maxY, pz = part.depth / 4;
  return { r, t: [0, py - (cb * py - sb * pz), pz - (sb * py + cb * pz)] };
}

/** Where each rigged part is moved to in this pose, by part index; parts without a joint are absent. */
function rigMoves(def: AvatarDefinition, vol: Volume, pose: Limbs, reach?: { l?: ArmReach; r?: ArmReach }): Map<number, Rigid> {
  // An arm held out in front of the body is clear of the head by where it is, not by how it is turned.
  const [armL, foreL] = pose.armLz > 3 ? [pose.armL, pose.foreL] : withinReach(reach?.l, pose.armL, pose.foreL);
  const [armR, foreR] = pose.armRz > 3 ? [pose.armR, pose.foreR] : withinReach(reach?.r, pose.armR, pose.foreR);
  const limbs = { ...pose, armL, foreL, armR, foreR };
  const rig = def.rig ?? [];
  const at = (role: string) => rig.find((j) => j.role === role);
  const own: Record<string, [number, number]> = {
    head: [limbs.head, 0],
    'arm-l': [limbs.armL, limbs.armLs], 'arm-r': [-limbs.armR, limbs.armRs],
    'forearm-l': [limbs.foreL, limbs.foreLs], 'forearm-r': [-limbs.foreR, limbs.foreRs],
    'leg-l': [limbs.legL, limbs.legLs], 'leg-r': [-limbs.legR, limbs.legRs],
    'shin-l': [0, limbs.shinL], 'shin-r': [0, limbs.shinR],
  };
  const parent: Record<string, string> = { 'forearm-l': 'arm-l', 'forearm-r': 'arm-r', 'shin-l': 'leg-l', 'shin-r': 'leg-r' };
  const moves = new Map<number, Rigid>();
  for (const j of rig) {
    let g = joint(j.x, j.y, own[j.role][0], own[j.role][1]);
    const up = at(parent[j.role]);
    if (up) g = after(joint(up.x, up.y, own[up.role][0], own[up.role][1]), g);
    // An arm held out in front of the body: the whole of it, forearm and all.
    const lift = j.role.endsWith('arm-l') ? limbs.armLz : j.role.endsWith('arm-r') ? limbs.armRz : 0;
    if (lift) g = { r: g.r, t: [g.t[0], g.t[1], g.t[2] + lift] };
    moves.set(j.part, g);
  }
  // A shoe turns on the ball of its foot first, then goes where its leg takes it.
  for (const [part, side] of shoes(def, vol)) {
    const heel = side === 'l' ? limbs.footL : limbs.footR;
    if (heel) moves.set(part, after(moves.get(part) as Rigid, heelLift(vol.parts[part], heel)));
  }
  return moves;
}

/** The projection of a plane's local coordinates once its part has been moved: still one affine map. */
function movedMatrix(v: ViewBasis, pivot: Point, g: Rigid, to3: (a: number, b: number) => Vec3): M {
  const o = projectPoint(v, moved(g, to3(0, 0)), pivot), x = projectPoint(v, moved(g, to3(1, 0)), pivot), y = projectPoint(v, moved(g, to3(0, 1)), pivot);
  return [x[0] - o[0], x[1] - o[1], y[0] - o[0], y[1] - o[1], o[0], o[1]];
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// ---------------------------------------------------------------------------
// View math

type M = Matrix;
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const translate = (x: number, y: number): M => [1, 0, 0, 1, x, y];
const about = (x: number, y: number, m: M): M => mul(translate(x, y), mul(m, translate(-x, -y)));
const invert = ([a, b, c, d, e, g]: M): M => {
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * g - d * e) / det, (b * e - a * g) / det];
};
const mat = (m: M) => `matrix(${m.map((v, i) => (i < 4 ? (Math.round(v * 10000) / 10000).toString() : f(v))).join(' ')})`;

export interface ViewBasis {
  cY: number;
  sY: number;
  cP: number;
  sP: number;
  /** cos(yaw)·cos(pitch): > 0 when the front faces the viewer. */
  facing: number;
}

export function viewBasis(yaw: number, pitch: number): ViewBasis {
  const cY = Math.cos(yaw), cP = Math.cos(pitch);
  return { cY, sY: Math.sin(yaw), cP, sP: Math.sin(pitch), facing: cY * cP };
}

/** Toward-viewer component of a model-space direction under this view (1 = straight at the viewer). */
export function facingOf(v: ViewBasis, [x, y, z]: Vec3): number {
  return v.sP * y + v.cP * (-v.sY * x + v.cY * z);
}

/** The signed projected area of a unit of eye plane goes to zero at the limb. */
function eyeVisible(v: ViewBasis, plane: EyePlane): boolean {
  return facingOf(v, [-plane.dzdx, -plane.dzdy, 1]) > 1e-6;
}

function eyeMatrix(v: ViewBasis, { x, y, z, dzdx, dzdy }: EyePlane, pivot: Point): M {
  const m = planeMatrix(v, z - x * dzdx - y * dzdy, pivot);
  m[0] += v.sY * dzdx;
  m[1] -= v.cY * v.sP * dzdx;
  m[2] += v.sY * dzdy;
  m[3] -= v.cY * v.sP * dzdy;
  return m;
}

/** Which slice stack faces the viewer more: front-facing z-planes or side-facing x-planes. */
export function activeStack(v: ViewBasis): 'z' | 'x' {
  return Math.abs(v.cY) >= Math.abs(v.sY) ? 'z' : 'x';
}

/**
 * Orthographic projection of the plane at depth z, pivoting on `pivot` at z = 0.
 * Yaw turns about the vertical axis, then pitch tips about the horizontal axis.
 */
export function planeMatrix(v: ViewBasis, z: number, pivot: Point): M {
  const [cx, cy] = pivot;
  return [
    v.cY, v.sY * v.sP, 0, v.cP,
    cx - v.cY * cx + v.sY * z,
    cy - v.cP * cy - v.sY * v.sP * cx - v.cY * v.sP * z,
  ];
}

/** Projection of the side plane x = x0, whose local coordinates are (u = -z, y). */
export function sidePlaneMatrix(v: ViewBasis, x0: number, pivot: Point): M {
  const [cx, cy] = pivot;
  return [-v.sY, v.cY * v.sP, 0, v.cP, cx + v.cY * (x0 - cx), cy - v.cP * cy + v.sY * v.sP * (x0 - cx)];
}

/** Project a 3D point: screen x, screen y and depth toward the viewer. */
export function projectPoint(v: ViewBasis, [x, y, z]: Vec3, pivot: Point): Vec3 {
  const m = planeMatrix(v, z, pivot);
  const X = x - pivot[0], Y = y - pivot[1];
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5], v.sP * Y + v.cP * (-v.sY * X + v.cY * z)];
}

function rootMatrix(pose: Pose, b: Bounds): M {
  const bx = (b.minX + b.maxX) / 2, by = b.maxY;
  const r = (pose.roll * Math.PI) / 180;
  const rot: M = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
  return mul(translate(0, pose.lift), about(bx, by, mul(rot, [pose.sx, 0, 0, pose.sy, 0, 0])));
}

const pivotOf = (b: Bounds): Point => [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];

/** The hop and the share of a point's distance from the base that roll and squash can move it. */
const POSE_LIFT = 4;
const POSE_SWAY = 0.2;

/**
 * A square of viewBox units that holds the avatar at every view and pose. Throws if invalid. The
 * canvas renderer uses it only as an upper bound: it sizes each bitmap to what is actually painted.
 */
export function avatarExtent(definition: AvatarDefinition, depth?: number): { x: number; y: number; size: number } {
  const p = prepare(definition, depthOption({ depth }));
  const { vol } = p;
  const b = vol.bounds;
  const [cx, cy] = pivotOf(b);
  const radius = Math.hypot(b.maxX - b.minX, b.maxY - b.minY, Math.max(...vol.parts.map((part) => part.depth)) + 2 * CSS_EYE_LIFT) / 2;
  // Ribbons reach their hoop plus their band from the middle of the body's box, and keep the
  // canvas's antialiasing margin (FIT_PAD) inside.
  const { work, cage } = p.rims();
  // The hoops' centre also hops and stretches with the body: as far as the body's own pose moves it.
  const reach = (rim: Rim) => {
    const r = ribbonReach(rim.max);
    return Math.hypot(rim.cx - cx, rim.cy - cy) + POSE_LIFT + POSE_SWAY * Math.abs(b.maxY - rim.cy) + r.radius + r.band + 1.2;
  };
  const half = Math.max(radius + POSE_LIFT + POSE_SWAY * (radius + b.maxY - cy), reach(work), reach(cage));
  return { x: cx - half, y: cy - half, size: 2 * half };
}

/**
 * Every cross-section a view draws, with its projection: the stack facing the
 * viewer, minus z-slices hidden behind the core (they add nothing to the
 * silhouette or the paint). Their union is the silhouette on screen.
 */
function drawnSlices(p: Prepared, v: ViewBasis, size: number | undefined, visit: (s: VolumeSlice, m: M, part: number, index: number) => void, whole?: (part: number) => boolean, stackOf?: (part: number) => 'z' | 'x' | 'y') {
  const { vol } = p;
  const stack = activeStack(v);
  const pivot = pivotOf(vol.bounds);
  const drawn = sliceCull(v);
  const kept = sliceDetail(p, stack, size);
  let k = 0;
  vol.parts.forEach((part, i) => {
    const own = stackOf?.(i) ?? stack;
    const first = k;
    k += (stack === 'z' ? part.zSlices : part.xSlices).length;
    if (own !== stack) {
      // A limb turned so that the view's own stack is edge-on: all of the stack that faces the viewer.
      (own === 'z' ? part.zSlices : own === 'x' ? part.xSlices : (part.ySlices ?? [])).forEach((s, j) => visit(s, own === 'z' ? planeMatrix(v, s.at, pivot) : sidePlaneMatrix(v, s.at, pivot), i, j));
      return;
    }
    (stack === 'z' ? part.zSlices : part.xSlices).forEach((s, j) => {
      // A part turned out of the plane shows cross-sections the plain view would hide: keep them all.
      if (!kept[first + j] || (!whole?.(i) && !drawn(s))) return;
      visit(s, stack === 'z' ? planeMatrix(v, s.at, pivot) : sidePlaneMatrix(v, s.at, pivot), i, j);
    });
  });
}

/** Whether a slice of the active stack shows: z-slices hidden behind the core are skipped. */
function sliceCull(v: ViewBasis): (s: VolumeSlice) => boolean {
  // Screen shift per unit of depth, and the smallest on-screen size of an in-plane inset.
  const sweep = Math.hypot(v.sY, v.cY * v.sP);
  const inset = Math.min(Math.abs(v.cY), Math.abs(v.cP));
  return (s) => s.axis !== 'z' || s.inset <= 0 || Math.abs(s.at) * sweep > s.inset * inset;
}

// ---------------------------------------------------------------------------
// Eyes (shared by both renderers, in face-plane coordinates)

interface EyeState {
  /** Neutral center and contract size (the happy arc and the slit are measured from it). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The open eye as drawn: an oval this wide and tall. */
  pw: number;
  ph: number;
  /** Gaze offset. */
  dx: number;
  dy: number;
  /** Drawn pill height after blink/squint, and its downward shift (lids close toward a point below center). */
  open: number;
  shift: number;
  look: EyeLook;
  /** The plain pill or the plain happy arc, drawn as such; null for every other look (a path). */
  plain: 'pill' | 'arc' | null;
}

function eyeStates(p: Prepared, pose: Pose): [EyeState, EyeState] {
  const s = p.vol.eyeScale;
  const w = EYE_W * s, h = EYE_H * s;
  // Drawn rounder than the contract's tall pill: wider (as far as the gap between the eyes allows) and shorter.
  const pw = Math.min(w * EYE_OVAL.wide, p.def.eyes.spacing * 0.8), ph = h * EYE_OVAL.tall;
  const r = p.range;
  const dx = pose.gazeX * (pose.gazeX >= 0 ? r.right : r.left) * GAZE_X * s;
  const dy = pose.gazeY * (pose.gazeY >= 0 ? r.down : r.up) * GAZE_Y * s;
  const centers = eyeCenters(p.def.eyes);
  const plain = plainLook(pose.eyes);
  return ([0, 1] as const).map((i) => {
    const squint = i === 0 ? pose.squintL : pose.squintR;
    // A blink closes the oval to a low lens, never to nothing.
    const open = Math.max(ph * Math.max(0.09, (1 - pose.blink) * (1 - squint * 0.4)), pw * 0.24);
    return { x: centers[i][0], y: centers[i][1], w, h, pw, ph, dx, dy, open, shift: (ph - open) * 0.18, look: pose.eyes, plain };
  }) as [EyeState, EyeState];
}

/** Where an eye is drawn: with its gaze offset, or without it where a transform applies the gaze. */
function eyeSpot(e: EyeState, gaze: boolean): EyeSpot {
  return { x: e.x + (gaze ? e.dx : 0), y: e.y + (gaze ? e.dy : 0), w: e.w, h: e.h, pw: e.pw, ph: e.ph, open: e.open, shift: e.shift };
}

function happyArc(e: EyeState): string {
  const ex = e.x + e.dx, ey = e.y + e.dy;
  const hw = e.w * HAPPY_ARC.halfWidth, base = ey + e.h * HAPPY_ARC.base;
  return `M${f(ex - hw)} ${f(base)}Q${f(ex)} ${f(ey - e.h * HAPPY_ARC.peak)} ${f(ex + hw)} ${f(base)}`;
}

function eyeMark(e: EyeState): EyeMark {
  if (e.plain !== 'pill') return { shape: 'path', d: eyePath(e.look, eyeSpot(e, true)) };
  const cx = e.x + e.dx, cy = e.y + e.dy + e.shift;
  return { shape: 'pill', x: cx - e.pw / 2, y: cy - e.open / 2, width: e.pw, height: e.open, radius: e.pw / 2, radiusY: e.open / 2 };
}

/**
 * What makes an eye a glossy bead set into the body instead of a flat mark: a shadow round it and
 * the light on it. Only an open eye has them; they fade as it turns into an arc or a slit and
 * close with it when it blinks. The light stays to the upper left while the eye looks about.
 */
function eyeGloss(e: EyeState): EyeGloss | undefined {
  // How much of each look: open, happy (the top of the eye shows) and lidded (the bottom does).
  const happy = clamp(e.look.arc, 0, 1), lidded = clamp(e.look.slit, 0, 1 - happy), open = 1 - happy - lidded;
  const cx = e.x + e.dx, wide = e.pw;
  // A happy eye does not blink: it keeps its full height.
  const tall = mix1(e.open, e.ph, happy), cy = e.y + e.dy + mix1(e.shift, 0, happy);
  const lid = clamp((tall / e.ph) * 1.6, 0, 1);
  const rim = 0.08 * wide + 0.25;
  return {
    // The shadow belongs to the whole socket; a part-closed eye has a lid over it instead.
    socket: { cx, cy: cy + 0.03 * tall, rx: wide / 2 + rim, ry: tall / 2 + rim, opacity: 0.22 * open },
    // The sheen lies across the top: it draws up into a happy eye's dome and is under a lowered lid.
    sheen: { cx: cx - 0.06 * wide - 0.2 * e.dx, cy: cy - mix1(0.16, 0.27, happy) * tall, rx: mix1(0.37, 0.3, happy) * wide, ry: mix1(0.29, 0.14, happy) * tall, opacity: 0.17 * (open + happy) },
    // The highlight stays with what shows: upper left, or just under the lid.
    glint: { cx: cx - 0.17 * wide - 0.25 * e.dx, cy: cy + mix1(-0.23, 0.1, lidded) * tall - 0.2 * e.dy * lid, rx: 0.15 * wide, ry: Math.min(0.17 * wide, mix1(0.2, 0.13, happy + lidded) * tall), opacity: 0.95 * lid },
    // The second one is low on the eye: a happy eye's lid covers it.
    spark: { cx: cx + 0.19 * wide - 0.15 * e.dx, cy: cy + 0.25 * tall, rx: 0.065 * wide, ry: Math.min(0.065 * wide, 0.1 * tall), opacity: 0.55 * (open + lidded) * lid },
  };
}

const mix1 = (a: number, b: number, k: number) => a + (b - a) * k;

function colors(options: RenderOptions): { color: string; ink: string } {
  return {
    color: toHex(parseHex(options.color) ?? (parseHex(DEFAULT_COLOR) as Rgb)),
    ink: toHex(parseHex(options.eyeColor) ?? (parseHex(DEFAULT_EYE_COLOR) as Rgb)),
  };
}

// ---------------------------------------------------------------------------
// Flat frames: the whole projected avatar as plain data

/** 2D affine matrix in SVG order (a b c d e f). */
export type Matrix = [number, number, number, number, number, number];

/**
 * How one eye is drawn, in its face plane's coordinates (viewBox units): the plain pill, the
 * plain happy arc (stroked, round caps), or for every other look a filled outline (a waiting
 * bot's slits, and every shape on the way from one look to the next).
 */
export type EyeMark =
  /** The open eye: an oval in the box x, y, width, height (`radius` and `radiusY` are its half width and half height). */
  | { shape: 'pill'; x: number; y: number; width: number; height: number; radius: number; radiusY: number }
  | { shape: 'arc'; d: string; strokeWidth: number }
  | { shape: 'path'; d: string };

/** An ellipse of light or shadow on an eye. */
export interface EyeSpotlight {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  opacity: number;
}

export interface EyeGloss {
  /** The shadow round the eye, a little bigger than it: the eye sits in the body. */
  socket: EyeSpotlight;
  /** A broad soft light across the upper half. */
  sheen: EyeSpotlight;
  /** The bright highlight, upper left. */
  glint: EyeSpotlight;
  /** A small second highlight, lower right. */
  spark: EyeSpotlight;
}

export type FrameShape =
  | {
      kind: 'slice';
      /** Stable across frames for the same cross-section: use it as a key in retained renderers. */
      key: string;
      /** Id of an entry in AvatarFrame.paths. */
      path: string;
      matrix: Matrix;
      /** With `shading`: this cross-section's own color, in place of AvatarFrame.color. */
      fill?: string;
      /**
       * With `shading`, on a limb where it leaves the body: the fill runs from `from` at (x1, y1)
       * to `fill` at (x2, y2), in the path's own coordinates, and stays at each beyond its end.
       */
      fade?: { from: string; x1: number; y1: number; x2: number; y2: number };
    }
  | {
      kind: 'eye';
      key: 'eye-0' | 'eye-1';
      matrix: Matrix;
      mark: EyeMark;
      /**
       * An open eye's depth, in the mark's coordinates: paint `socket` (black) under the mark, then
       * `sheen`, `glint` and `spark` (white) over it, each at its opacity.
       */
      gloss?: EyeGloss;
    }
  | {
      /**
       * A piece of a ribbon: fill `d` in `fill`. Each ribbon has a hue of its own, set apart from
       * the body's; a piece `front` of the body is lighter than one behind it.
       */
      kind: 'ribbon';
      key: string;
      d: string;
      box: { x: number; y: number; w: number; h: number };
      matrix: Matrix;
      front: boolean;
      /** The ribbon's colour where it is plainest (the middle of its gradient). */
      fill: string;
      /**
       * A linear gradient along the whole ribbon, in the same coordinates as `d`: from its tail
       * (x1, y1) to its head (x2, y2), the stops evenly spaced. Every piece of a ribbon shares it.
       */
      gradient: { x1: number; y1: number; x2: number; y2: number; stops: string[] };
    };

/** One cross-section outline, shared by every shape that draws it. */
export interface FramePath {
  id: string;
  d: string;
  evenOdd: boolean;
  box: { x: number; y: number; w: number; h: number };
  /** Set on a mark's part that is a circle or an upright capsule filling `box` (see MarkPart). */
  round?: boolean;
}

/**
 * One frame of the avatar flattened onto the screen: every cross-section the
 * view draws with its projection, and the visible eyes, sorted back to front,
 * between the ribbons behind the body and those in front of it. The marks of
 * `thinking` and `blocked` are listed as slices too, in place of the body.
 * Painting them in order (body paths in `color`, eyes in `ink`) inside the
 * `root` transform and a 0 0 100 100 viewBox gives the avatar exactly as
 * renderAvatarSvg draws it. Plain numbers and path strings, so any vector
 * renderer (SVG, canvas, Skia, react-native-svg) can draw it.
 */
export interface AvatarFrame {
  name: string;
  color: string;
  ink: string;
  /**
   * Distinct cross-section paths this frame uses; ids are stable for equal geometry and depth.
   * `box` bounds `d` in its own coordinates, before a shape's matrix.
   */
  paths: FramePath[];
  /** 2D motion (hop, roll, squash) about the base of the body, applied to every shape. */
  root: Matrix;
  /** Back to front. */
  shapes: FrameShape[];
  /**
   * The body as one surface, for a renderer that draws it in 3D instead of as slices (the fluffy
   * material): the view's rotation, the body's scale as it gives way to a mark, and both eyes,
   * including an eye `shapes` leaves out because its spot faces away.
   */
  surface: { view: ViewBasis; scale: number; eyes: SurfaceEye[]; pieces?: SurfacePiece[] };
  /**
   * With `shading`: light from the upper left, as a linear gradient in viewBox coordinates (outside
   * `root`) to paint over everything the shapes covered, and only there.
   */
  light?: { x1: number; y1: number; x2: number; y2: number; stops: { at: number; color: string; opacity: number }[] };
  /** With `grain`: how strong the speckles on the body are, 0..1. They move with `root`. */
  grain?: number;
  /** With `shadow`: an ellipse on the ground, outside `root`, fading from `opacity` at its center to nothing. Paint it first. */
  shadow?: { cx: number; cy: number; rx: number; ry: number; opacity: number };
}

/**
 * A rigged character's body is not one surface: its limbs turn on their joints. For a renderer
 * that draws surfaces it comes in pieces, back to front, each a set of the volume's parts that
 * move as one (the trunk, the head, an upper arm, a shin with its shoe).
 */
export interface SurfacePiece {
  /** Indices into the volume's parts. */
  parts: number[];
  /** The piece as the viewer sees it: this view of it, then turned `roll` radians on screen (clockwise). */
  view: ViewBasis;
  roll: number;
  /** Where the middle of the piece's bounds (at depth 0) lands, viewBox units, inside `root`. */
  x: number;
  y: number;
  /** The piece carries the eyes. */
  eyes: boolean;
  /** Where its joints have moved the piece from how it is drawn: a rotation, row by row, then a shift. None for the trunk. */
  move?: { r: number[]; t: Vec3 };
}

/**
 * An eye on the body's surface, in face coordinates: its mark where it rests, and how far its
 * gaze has moved it from there. Apart, so a renderer can tell a moving eye from a changing one.
 */
export interface SurfaceEye {
  mark: EyeMark;
  dx: number;
  dy: number;
}

/** Compute one flat frame of a definition. Throws if the definition is invalid. */
export function avatarFrame(definition: AvatarDefinition, options: RenderOptions = {}): AvatarFrame {
  return flatFrame(definition, options, undefined);
}

/**
 * avatarFrame for a live avatar drawn `options.size` CSS pixels wide: like the scene, it skips
 * cross-sections that would sit less than a pixel apart. Internal to the live renderers, so
 * `size` never changes what avatarFrame returns to custom renderers.
 */
export function liveFrame(definition: AvatarDefinition, options: RenderOptions = {}): AvatarFrame {
  return flatFrame(definition, options, options.size);
}

/**
 * The ribbons are steps along a ramp of the body's own color, painter's style: each step is
 * RAMP_LIGHT lighter or darker in OKLCH and turns RAMP_HUE degrees with it, toward yellow as it
 * lightens and toward blue as it darkens. Steps run +1, -1, +2, -2 and so on, skipping any that
 * would leave RAMP_RANGE, so a working bot's three are one lighter, one darker and one lighter
 * still on most bodies. A body lighter or darker than the range steps from its edge instead, so
 * a white body's ribbons are all well darker than it, and a black one's well lighter.
 */
const RAMP_LIGHT = 0.09;
const RAMP_HUE = 14;
// Six steps wide: room for five besides the body's own, wherever it starts. Past it shades wash
// out toward white or sink toward black.
const RAMP_RANGE = [0.36, 0.9] as const;
const WARM = 100;
const palettes = new Map<string, Rgb[][]>();
/**
 * How far a ribbon's colour runs from its tail (its shade) to its head: further from the body's
 * lightness by GRADIENT_LIGHT, turning GRADIENT_HUE degrees with it (warmer as it lightens,
 * cooler as it darkens). GRADIENT_STOPS colours along the way.
 */
const GRADIENT_LIGHT = 0.13;
const GRADIENT_HUE = 25;
const GRADIENT_STOPS = 5;
/** Below this chroma a body counts as white, gray or black, and its ribbons are grays with this much tint. */
const NEUTRAL = 0.04;
const NEUTRAL_TINT = 0.025;
/**
 * Which shades (by their order along the ramp: +1, -1, +2, -2, +3 on most bodies) each band's lanes
 * take, a working bot's band first. A celebration's two bands lean to the lighter shades, so the
 * cage stays bright against a dark page.
 */
const BAND_SHADES = [[0, 1, 2], [2, 0, 3], [1, 2, 0]] as const;

/** Turn hue `h` by up to `by` degrees toward hue `to`, never past it. */
function turnToward(h: number, to: number, by: number): number {
  const d = ((to - h + 540) % 360) - 180;
  return (h + Math.sign(d) * Math.min(Math.abs(d), by) + 360) % 360;
}

/**
 * The colors of the ribbons on a body this color, one per band and lane (see BAND_SHADES): five
 * steps along its own ramp (see RAMP_LIGHT), at least as vivid as the body. A white, gray or
 * black body gets grays: lighter or darker than it, with just a hint of a hue its seed picks.
 * A piece behind the body is a shade deeper than one in front of it.
 */
/** The colour `t` (0..1) of the way along a colour run, in sRGB between its stops. */
function runAt(run: Rgb[], t: number): string {
  const x = clamp(t, 0, 1) * (run.length - 1), n = Math.min(Math.floor(x), run.length - 2);
  return toHex(mix(run[n], run[n + 1], x - n));
}

function ribbonPalette(color: string | undefined, seed: number): Rgb[][] {
  const key = `${color}|${seed}`;
  let palette = palettes.get(key);
  if (palette) return palette;
  const [light, chroma, hue] = toOklch(parseHex(color) ?? (parseHex(DEFAULT_COLOR) as Rgb));
  // A seed's hue skips the yellows (80 to 130), whose darker steps turn olive.
  const neutral = chroma < NEUTRAL;
  const base = neutral ? (130 + noise(seed, 500) * 310) % 360 : hue;
  const c = neutral ? NEUTRAL_TINT : Math.max(chroma, 0.17);
  const from = Math.min(RAMP_RANGE[1], Math.max(RAMP_RANGE[0], light));
  const steps: number[] = [];
  for (let k = 1; steps.length < 5 && k < 10; k++) {
    for (const step of [k, -k]) {
      const l = from + step * RAMP_LIGHT;
      if (steps.length < 5 && l >= RAMP_RANGE[0] - 1e-9 && l <= RAMP_RANGE[1] + 1e-9) steps.push(step);
    }
  }
  while (steps.length < 5) steps.push(steps[steps.length - 1] ?? 1);
  const shades = steps.map((step) => {
    const l = from + step * RAMP_LIGHT;
    const h = turnToward(base, step > 0 ? WARM : WARM + 180, RAMP_HUE * Math.abs(step));
    // Tail to head, away from the body's lightness: lighter and warmer, or darker and cooler.
    const away = step > 0 ? 1 : -1;
    const run = Array.from({ length: GRADIENT_STOPS }, (_, n) => {
      const t = n / (GRADIENT_STOPS - 1);
      const hue = turnToward(h, away > 0 ? WARM : WARM + 180, GRADIENT_HUE * t);
      return oklch(clamp(l + away * GRADIENT_LIGHT * t, 0.26, 0.9), c, hue);
    });
    return { step, run };
  });
  // Each band takes three of the shades, lightest on the inside lane to darkest on the outside.
  palette = BAND_SHADES.flatMap((pick) => pick.map((n) => shades[n]).sort((x, y) => y.step - x.step).map(({ run }) => run));
  if (palettes.size >= 64) palettes.clear();
  palettes.set(key, palette);
  return palette;
}

/** What a frame draws besides the body, in viewBox units outside the body's own motion. */
interface Effects {
  /** How much of its size the body keeps while it gives way to a mark (0 = gone). */
  body: number;
  ribbons: { d: string; box: Box; front: boolean; fill: string; gradient: RibbonGradient }[];
  marks: { id: string; d: string; box: Box; matrix: M; round: boolean }[];
}

/**
 * A mark's part in a path id, after the avatar's own prefix. A body's slices are numbered, so a
 * part's name must not be a number, and it goes into markup, so it must be plain: a name of
 * letters and digits that starts with a letter is kept (the built-in parts' are), and any other
 * is replaced by a hash of it, set apart by a hyphen no kept name has.
 */
function markId(shape: string): string {
  return /^[A-Za-z][A-Za-z0-9]*$/.test(shape) ? shape : `m-${hashString(String(shape)).toString(36)}`;
}

function effectsOf(p: Prepared, pose: Pose, options: RenderOptions): Effects {
  const b = p.vol.bounds;
  const time = Number.isFinite(options.time) ? (options.time as number) : 0;
  const still = options.reducedMotion === true;
  const [cx, cy] = pivotOf(b);
  return {
    body: bodyScale(pose.marks),
    // No ribbons are out below a presence of 0.01 (see ribbonPieces), so their rims are not measured for it.
    ribbons: still || pose.ribbons <= 0.01 ? [] : ribbonPieces(b, pose.ribbons, p.seed, time, pose.sweep, pose.cage, ribbonsFollow(pose.cage >= 0.5 ? p.rims().cage : p.rims().work, pose, b)).map((r) => {
      const hue = ribbonPalette(options.color, p.seed)[r.ribbon];
      // The piece's stretch of its ribbon's colour run, front and back alike.
      const [s0, s1] = r.along;
      const stops = [s0, (s0 + s1) / 2, s1].map((t) => runAt(hue, t));
      // A gradient needs some length; a piece too short to have one takes its middle colour.
      const long = Math.hypot(r.to[0] - r.from[0], r.to[1] - r.from[1]) > 0.01;
      return {
        d: r.d, box: r.box, front: r.front, fill: stops[1],
        gradient: long ? { x1: r.from[0], y1: r.from[1], x2: r.to[0], y2: r.to[1], stops } : { x1: r.from[0], y1: r.from[1], x2: r.from[0] + 0.01, y2: r.from[1], stops: [stops[1], stops[1], stops[1]] },
      };
    }),
    marks: markParts(b, pose.marks, p.seed, time, still).map((part) => {
      const turn: M = [Math.cos(part.turn), Math.sin(part.turn), -Math.sin(part.turn), Math.cos(part.turn), 0, 0];
      return {
        id: `${p.id}-${markId(part.shape)}`,
        d: part.d,
        box: part.box,
        round: part.round === true,
        matrix: mul(about(cx, cy, turn), mul(translate(part.x, part.y), [part.scale, 0, 0, part.scale, 0, 0])),
      };
    }),
  };
}

/** Shade levels between the furthest and the nearest cross-section. */
const SHADE_LEVELS = 32;
/** At full shading: how much darker (OKLCH lightness) the furthest cross-section is, and how much lighter the nearest. */
const SHADE_DARK = 0.3;
const SHADE_LIGHT = 0.06;
const shadeRamps = new Map<string, string[]>();

/** The body color at each shade level, furthest first: darker and a little cooler toward the back. */
function shadeRamp(color: string, amount: number): string[] {
  const key = `${color}|${amount}`;
  let ramp = shadeRamps.get(key);
  if (!ramp) {
    const [L, C, h] = toOklch(parseHex(color) as Rgb);
    ramp = Array.from({ length: SHADE_LEVELS + 1 }, (_, i) => {
      const t = i / SHADE_LEVELS;
      const light = L - amount * SHADE_DARK * (1 - t) ** 1.25 + amount * SHADE_LIGHT * Math.max(0, (t - 0.75) / 0.25) ** 2;
      return toHex(oklch(clamp(light, 0.04, 0.985), C * (1 + 0.12 * amount * (1 - t)), h - 8 * amount * (1 - t)));
    });
    if (shadeRamps.size >= 64) shadeRamps.clear();
    shadeRamps.set(key, ramp);
  }
  return ramp;
}

/**
 * How much of a cross-section's shade comes from where it lies within its own part, the rest from
 * where it lies in the whole body. Its own part gives every limb a darker rim and a lighter
 * middle, which sets it off from the body it rests against; the whole body keeps a far arm
 * darker than a near one.
 */
const SHADE_OWN = 0.55;

/**
 * Which parts of a rigged body are shaded as one: an upper arm with its forearm, a thigh with its
 * shin and shoe, a head with what it wears. Shaded apart, each would end in its own darker rim
 * and the limb would show a seam at every elbow and knee.
 */
/**
 * Where each limb part's depth is taken: at the joint it shares with the rest of its limb (the
 * elbow for an upper arm and its forearm, the knee for a thigh, its shin and the shoe). Taken at
 * each part's own middle, two parts turned differently would lie at different depths where they
 * meet, and the nearer would show its rounded end over the other.
 */
function limbKeys(def: AvatarDefinition): Map<number, Point> | undefined {
  if (!def.rig?.length) return undefined;
  const keys = new Map<number, Point>();
  for (const j of def.rig) {
    if (j.role === 'head') continue;
    const lower = j.role.startsWith('arm') || j.role.startsWith('leg') ? def.rig.find((k) => k.role === j.role.replace('arm', 'forearm').replace('leg', 'shin')) : j;
    if (lower) keys.set(j.part, [lower.x, lower.y]);
  }
  return keys;
}

/** How far along a limb, in its own widths, the body's shade gives way to the limb's. */
const ROOT_FADE = 1.5;

/**
 * Where a limb leaves the body it takes the body's shade there and eases into its own a little way
 * along. Shaded on its own from the start, its round end shows on the body as a rim, like a ball of
 * clay pressed on; this way it grows out of the body instead.
 */
function fadeRoots(items: { depth: number; part?: number; at?: number; axis?: 'x' | 'y' | 'z'; shape: FrameShape }[], def: AvatarDefinition, vol: Volume): void {
  if (!def.rig?.length) return;
  const jointed = new Set(def.rig.map((j) => j.part));
  for (const root of def.rig) {
    if (!root.role.startsWith('arm') && !root.role.startsWith('leg')) continue;
    // The trunk under the joint: the part without a joint that stands highest there.
    let trunk = -1, top = 0;
    vol.parts.forEach((part, i) => {
      const h = jointed.has(i) ? 0 : part.height(root.x, root.y);
      if (h > top) { top = h; trunk = i; }
    });
    if (trunk < 0) continue;
    const lower = def.rig.find((k) => k.role === root.role.replace('arm', 'forearm').replace('leg', 'shin'));
    const part = vol.parts[root.part];
    const to: Point = lower ? [lower.x, lower.y] : part.center;
    const len = Math.hypot(to[0] - root.x, to[1] - root.y);
    if (len < 1) continue;
    const reach = Math.min(len, ROOT_FADE * part.thickness);
    const ux = (to[0] - root.x) / len, uy = (to[1] - root.y) / len;
    for (const it of items) {
      if (it.part !== root.part || it.shape.kind !== 'slice' || !it.shape.fill || it.axis === 'y') continue;
      // The trunk's cross-section that makes its surface at the joint, as this stack cuts it.
      let from: string | undefined, best = Infinity;
      for (const other of items) {
        if (other.part !== trunk || other.shape.kind !== 'slice' || !other.shape.fill || other.axis !== it.axis) continue;
        const d = it.axis === 'z' ? ((other.at as number) <= top ? top - (other.at as number) : Infinity) : Math.abs((other.at as number) - root.x);
        if (d < best) { best = d; from = other.shape.fill; }
      }
      if (!from || from === it.shape.fill) continue;
      it.shape.fade = it.axis === 'z'
        ? { from, x1: root.x, y1: root.y, x2: root.x + ux * reach, y2: root.y + uy * reach }
        : { from, x1: 0, y1: root.y, x2: 0, y2: root.y + (Math.abs(uy) < 0.2 ? 0.2 * (uy < 0 ? -1 : 1) : uy) * reach };
    }
  }
}

function shadeGroups(def: AvatarDefinition): Map<number, string> | undefined {
  if (!def.rig?.length) return undefined;
  const groups = new Map<number, string>();
  for (const j of def.rig) groups.set(j.part, j.role.replace('forearm', 'arm').replace('shin', 'leg'));
  return groups;
}

/** Give each cross-section its shade by how near the viewer it is. `items` are sorted back to front. */
function shadeSlices(items: { depth: number; part?: number; shape: FrameShape }[], color: string, shading: number | undefined, groups?: Map<number, string>) {
  const amount = clamp(Number.isFinite(shading) ? (shading as number) : 0, 0, 1);
  if (amount <= 0) return;
  let min = Infinity, max = -Infinity;
  for (const it of items) {
    if (it.shape.kind !== 'slice') continue;
    if (it.depth < min) min = it.depth;
    if (it.depth > max) max = it.depth;
  }
  if (!(max - min > 0.5)) return;
  // Each part's own nearest and furthest cross-section.
  const own = new Map<number, [number, number]>();
  for (const it of items) {
    if (it.shape.kind !== 'slice' || it.part === undefined) continue;
    const range = own.get(it.part);
    if (!range) own.set(it.part, [it.depth, it.depth]);
    else {
      if (it.depth < range[0]) range[0] = it.depth;
      if (it.depth > range[1]) range[1] = it.depth;
    }
  }
  // The parts of one limb are shaded on one scale, that of the deepest of them, each about its own
  // middle: where two of them meet, cross-sections at the same depth are the same shade.
  const span = new Map<number | string, number>();
  for (const [part, range] of own) {
    const g = groups?.get(part) ?? part;
    span.set(g, Math.max(span.get(g) ?? 0, range[1] - range[0]));
  }
  const ramp = shadeRamp(color, Math.round(amount * 20) / 20);
  for (const it of items) {
    if (it.shape.kind !== 'slice') continue;
    const whole = (it.depth - min) / (max - min);
    const range = it.part === undefined ? undefined : own.get(it.part);
    const scale = it.part === undefined ? 0 : (span.get(groups?.get(it.part) ?? it.part) as number);
    // A part that is the whole body, or too thin to have a range, takes the body's shade alone.
    const t = range && own.size > 1 && scale > 0.5 ? whole + (0.5 + (it.depth - (range[0] + range[1]) / 2) / scale - whole) * SHADE_OWN : whole;
    it.shape.fill = ramp[Math.round(clamp(t, 0, 1) * SHADE_LEVELS)];
  }
}

/** Which piece lies over which where neither is in front: legs under the trunk, arms over it, the head over them all. */
const PIECE_RANK: Record<string, number> = { shin: 0, leg: 1, trunk: 2, arm: 3, forearm: 4, head: 5 };
/** A piece this far in front of the mid-plane or behind it, viewBox units, is ordered by that instead. */
const PIECE_CLEAR = 0.75;

/**
 * The pieces of a rigged body (see SurfacePiece), back to front. Each is one image, so they cannot
 * be ordered slice by slice as the flat body is: a piece its joint has brought forward (a hand to
 * the chin) or back goes by how far, and the rest in a fixed order.
 */
function surfacePieces(def: AvatarDefinition, vol: Volume, v: ViewBasis, pivot: Point, moves: Map<number, Rigid>, ordered: Map<number, Rigid>): SurfacePiece[] {
  const feet = shoes(def, vol);
  // A shoe is a piece of its own: it may turn while its shin does not.
  const roles = new Map((def.rig ?? []).map((j) => [j.part, feet.has(j.part) ? `${j.role}:shoe` : (j.role as string)]));
  const groups = new Map<string, number[]>();
  vol.parts.forEach((_, i) => {
    const role = roles.get(i) ?? 'trunk';
    groups.set(role, [...(groups.get(role) ?? []), i]);
  });
  // The view as a rotation: rows are screen x, screen y and depth toward the viewer.
  const view = [v.cY, 0, v.sY, v.sY * v.sP, v.cP, -v.cY * v.sP, -v.cP * v.sY, v.sP, v.cP * v.cY];
  return [...groups.entries()]
    .map(([role, parts]) => {
      const g = moves.get(parts[0]);
      const b = parts.map((i) => vol.parts[i].bounds);
      const cx = (Math.min(...b.map((q) => q.minX)) + Math.max(...b.map((q) => q.maxX))) / 2;
      const cy = (Math.min(...b.map((q) => q.minY)) + Math.max(...b.map((q) => q.maxY))) / 2;
      const mid: Vec3 = g ? moved(g, [cx, cy, 0]) : [cx, cy, 0];
      const [x, y] = projectPoint(v, mid, pivot);
      const k = ordered.get(parts[0]);
      const z = k ? moved(k, [cx, cy, 0])[2] : 0;
      const depth = Math.abs(z) < PIECE_CLEAR ? 0 : v.facing * z;
      // The piece's own turn, then the view: again a view (a yaw and a pitch), turned on screen.
      const t = new Array<number>(9);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) t[i * 3 + j] = g ? view[i * 3] * g.r[j] + view[i * 3 + 1] * g.r[3 + j] + view[i * 3 + 2] * g.r[6 + j] : view[i * 3 + j];
      const sP = clamp(t[7], -1, 1), cP = Math.sqrt(1 - sP * sP);
      const [sY, cY] = cP > 1e-6 ? [-t[6] / cP, t[8] / cP] : [0, 1];
      const roll = Math.atan2(t[3] * cY + t[5] * sY, t[0] * cY + t[2] * sY);
      return { parts, view: { cY, sY, cP, sP, facing: cY * cP }, roll, x, y, eyes: parts.includes(vol.eyePart), ...(g ? { move: { r: g.r, t: g.t } } : {}), depth, rank: PIECE_RANK[role.split('-')[0]] ?? 2 };
    })
    .sort((a, c) => a.depth - c.depth || a.rank - c.rank)
    .map(({ depth: _, rank: __, ...piece }) => piece);
}

function flatFrame(definition: AvatarDefinition, options: RenderOptions, size: number | undefined): AvatarFrame {
  const p = prepare(definition, depthOption(options));
  const { vol } = p;
  const b = vol.bounds;
  const { color, ink } = colors(options);
  const pose = poseOf(p, options);
  const pivot = pivotOf(b);
  const v = viewBasis(pose.yaw, pose.pitch);
  const stack = activeStack(v);
  const eyes: SurfaceEye[] = [];
  const eyesMid: Point = [p.def.eyes.x, p.def.eyes.y];
  const fx = effectsOf(p, pose, options);
  const root = rootMatrix(pose, b);
  // The body shrinks toward its center as it gives way to a mark.
  const shrink = (m: M): M => (fx.body < 1 ? mul(about(pivot[0], pivot[1], [fx.body, 0, 0, fx.body, 0, 0]), m) : m);

  // Only the cross-sections this view draws are listed; ids are stable across frames.
  const paths = new Map<string, FramePath>();
  const items: { depth: number; part?: number; at?: number; axis?: 'x' | 'y' | 'z'; shape: FrameShape }[] = [];
  const moves = p.def.rig?.length ? rigMoves(p.def, vol, pose.limbs, p.reach()) : null;
  const keys = moves ? limbKeys(p.def) : undefined;
  const ordered = moves ? orderMoves(p.def, vol, moves) : null;
  if (fx.body > 0) {
    drawnSlices(p, v, size, (s, plain, i, j) => {
      const g = moves?.get(i);
      const m = g ? movedMatrix(v, pivot, g, s.axis === 'z' ? (a, c) => [a, c, s.at] : s.axis === 'x' ? (a, c) => [s.at, c, -a] : (a, c) => [a, s.at, c]) : plain;
      let path = paths.get(s.d);
      if (!path) {
        path = { id: p.ids.get(s.d) as string, d: s.d, evenOdd: s.evenOdd, box: { ...s.box } };
        paths.set(s.d, path);
      }
      // A character's limbs turn out of their stack, so its cross-sections are ordered by where each
      // lies: at the joint its limb turns on, or under the eyes for the part that carries them.
      // Without a rig the slices are parallel and have the same order along every viewing ray.
      let depth: number;
      if (moves) {
        const [rx, ry] = i === vol.eyePart ? eyesMid : (keys?.get(i) ?? vol.parts[i].center);
        const key3: Vec3 = s.axis === 'z' ? [rx, ry, s.at] : s.axis === 'x' ? [s.at, ry, 0] : [rx, s.at, 0];
        const k = ordered?.get(i);
        depth = projectPoint(v, k ? moved(k, key3) : key3, pivot)[2];
      } else depth = s.axis === 'z' ? v.facing * s.at : -v.sY * v.cP * s.at;
      items.push({ depth, part: i, at: s.at, axis: s.axis, shape: { kind: 'slice', key: `${i}${s.axis}${j}`, path: path.id, matrix: shrink(m) } });
    }, moves ? (i) => moves.has(i) : undefined, moves ? (i) => limbStack(vol, v, stack, i, moves.get(i)) : undefined);
    const face = moves?.get(vol.eyePart);
    // Painted on the surface; each eye goes once the surface under it turns away.
    eyeStates(p, pose).forEach((e, idx) => {
      const plane = vol.eyePlanes[idx];
      eyes.push({ mark: eyeMark({ ...e, dx: 0, dy: 0 }), dx: e.dx, dy: e.dy });
      if (!eyeVisible(v, plane)) return;
      // A slice through the middle of an eye must paint before the entire eye: sort at the near
      // edge of its footprint (the oval and the shadow round it) on the active stack.
      const rim = 0.08 * e.pw + 0.25;
      const halfW = e.pw / 2 + rim, halfH = e.ph / 2 + rim;
      const xDepth = -v.sY * v.cP;
      const z = plane.z + e.dx * plane.dzdx + e.dy * plane.dzdy;
      const edge = stack === 'z' ? Math.abs(v.facing) * (Math.abs(plane.dzdx) * halfW + Math.abs(plane.dzdy) * halfH) : Math.abs(xDepth) * halfW;
      let depth: number;
      if (moves) {
        // Where the slices under it are keyed (see above), moved with the head.
        const mid: Vec3 = stack === 'z' ? [eyesMid[0], eyesMid[1], z] : [e.x + e.dx, eyesMid[1], 0];
        depth = projectPoint(v, face ? moved(face, mid) : mid, pivot)[2] + edge;
      } else depth = (stack === 'z' ? v.facing * z : xDepth * (e.x + e.dx)) + edge;
      // The eyes are painted on the head: they lie on its surface and tilt with it.
      const matrix = face
        ? movedMatrix(v, pivot, face, (a, c) => [a, c, plane.z + (a - plane.x) * plane.dzdx + (c - plane.y) * plane.dzdy])
        : eyeMatrix(v, plane, pivot);
      items.push({
        depth: depth + 1e-6,
        shape: { kind: 'eye', key: idx === 0 ? 'eye-0' : 'eye-1', matrix: shrink(matrix), mark: eyeMark(e), gloss: eyeGloss(e) },
      });
    });
    items.sort((a, c) => a.depth - c.depth);
    shadeSlices(items, color, options.shading, shadeGroups(p.def));
    fadeRoots(items, p.def, vol);
  }

  // Ribbons and marks stay put while the body moves: their matrices undo the root's motion.
  const fixed = fx.ribbons.length || fx.marks.length ? invert(root) : null;
  const ribbon = (front: boolean): FrameShape[] =>
    fx.ribbons.flatMap((r, i) =>
      r.front === front ? [{ kind: 'ribbon' as const, key: `ribbon-${i}`, d: r.d, box: r.box, matrix: fixed as M, front, fill: r.fill, gradient: r.gradient }] : [],
    );
  const marks = fx.marks.map((mark, i): FrameShape => {
    // Two parts of one name share a path; given different outlines, the later one gets a path of its own.
    const taken = paths.get(mark.id);
    const id = taken && taken.d !== mark.d ? `${mark.id}-${hashString(mark.d).toString(36)}` : mark.id;
    if (!paths.has(id)) paths.set(id, { id, d: mark.d, evenOdd: false, box: mark.box, ...(mark.round ? { round: true } : {}) });
    return { kind: 'slice', key: `mark-${i}`, path: id, matrix: mul(fixed as M, mark.matrix) };
  });
  const frame: AvatarFrame = {
    name: p.def.name, color, ink, paths: [...paths.values()], root,
    shapes: [...ribbon(false), ...items.map((it) => it.shape), ...ribbon(true), ...marks],
    surface: { view: v, scale: fx.body, eyes, ...(moves && fx.body > 0 ? { pieces: surfacePieces(p.def, vol, v, pivot, moves, ordered ?? moves) } : {}) },
  };
  const amount = clamp(Number.isFinite(options.shading) ? (options.shading as number) : 0, 0, 1);
  if (amount > 0 && fx.body > 0) {
    // Lit from the upper left: a highlight there, a cool shade toward the lower right.
    frame.light = {
      x1: b.minX, y1: b.minY - 6, x2: b.maxX, y2: b.maxY + 6,
      stops: [
        { at: 0, color: '#ffffff', opacity: 0.26 * amount },
        { at: 0.42, color: '#ffffff', opacity: 0 },
        { at: 0.58, color: '#0a0a32', opacity: 0 },
        { at: 1, color: '#0a0a32', opacity: 0.3 * amount },
      ],
    };
  }
  const grain = clamp(Number.isFinite(options.grain) ? (options.grain as number) : 0, 0, 1);
  if (grain > 0 && fx.body > 0) frame.grain = grain;
  if (options.shadow && fx.body > 0) {
    // On the ground under the resting body: smaller and fainter while the body is in the air.
    const air = clamp(-pose.lift / 16, 0, 0.5);
    const rx = Math.max(10, (b.maxX - b.minX) * 0.42) * (1 - air) * fx.body;
    frame.shadow = { cx: (b.minX + b.maxX) / 2, cy: b.maxY + 2, rx, ry: Math.max(2.4, rx * 0.13), opacity: 0.34 * (1 - air) };
  }
  return frame;
}

// ---------------------------------------------------------------------------
// Standalone SVG still

const spotSvg = (s: EyeSpotlight, color: string) =>
  s.opacity > 0.005 ? `<ellipse cx="${f(s.cx)}" cy="${f(s.cy)}" rx="${f(s.rx)}" ry="${f(s.ry)}" fill="${color}" fill-opacity="${f(s.opacity)}"/>` : '';

function eyeSvg(mark: EyeMark, ink: string, gloss?: EyeGloss): string {
  if (gloss) return spotSvg(gloss.socket, '#000') + eyeSvg(mark, ink) + spotSvg(gloss.sheen, '#fff') + spotSvg(gloss.glint, '#fff') + spotSvg(gloss.spark, '#fff');
  if (mark.shape === 'path') return `<path d="${mark.d}" fill="${ink}"/>`;
  if (mark.shape === 'arc') {
    return `<path d="${mark.d}" fill="none" stroke="${ink}" stroke-width="${f(mark.strokeWidth)}" stroke-linecap="round"/>`;
  }
  return `<rect x="${f(mark.x)}" y="${f(mark.y)}" width="${f(mark.width)}" height="${f(mark.height)}" rx="${f(mark.radius)}" ry="${f(mark.radiusY)}" fill="${ink}"/>`;
}

type RibbonGradient = { x1: number; y1: number; x2: number; y2: number; stops: string[] };

/**
 * A ribbon piece with its gradient alongside it. The id is taken from the gradient itself, so
 * repeats on a page (the same avatar at the same moment) share one harmlessly.
 */
function ribbonSvg(d: string, g: RibbonGradient): string {
  const id = `oba-g${hashString(`${f(g.x1)},${f(g.y1)},${f(g.x2)},${f(g.y2)},${g.stops.join()}`).toString(36)}`;
  const stops = g.stops.map((c, i) => `<stop offset="${f(i / (g.stops.length - 1))}" stop-color="${c}"/>`).join('');
  return (
    `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(g.x1)}" y1="${f(g.y1)}" x2="${f(g.x2)}" y2="${f(g.y2)}">${stops}</linearGradient>` +
    `<path d="${d}" fill="url(#${id})"/>`
  );
}

/** Render a definition to a standalone SVG string. Throws if the definition is invalid. */
export function renderAvatarSvg(definition: AvatarDefinition, options: RenderOptions = {}): string {
  const frame = avatarFrame(definition, options);
  // A mark's outline is the host's own text: it is escaped. Every other path is serialized from numbers.
  const defsMarkup = frame.paths.map((d) => `<path id="${d.id}" d="${esc(d.d)}"${d.evenOdd ? ' fill-rule="evenodd"' : ''}/>`).join('');
  const fades = new Map<string, string>();
  const fadeDefs: string[] = [];
  const fadeOf = (fill: string, g: NonNullable<Extract<FrameShape, { kind: 'slice' }>['fade']>): string => {
    const key = `${g.from},${fill},${f(g.x1)},${f(g.y1)},${f(g.x2)},${f(g.y2)}`;
    let id = fades.get(key);
    if (!id) {
      id = `oba-f${hashString(key).toString(36)}`;
      fades.set(key, id);
      fadeDefs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(g.x1)}" y1="${f(g.y1)}" x2="${f(g.x2)}" y2="${f(g.y2)}"><stop offset="0" stop-color="${g.from}"/><stop offset="1" stop-color="${fill}"/></linearGradient>`);
    }
    return id;
  };
  const body = frame.shapes
    .map((s) =>
      s.kind === 'slice' ? `<use href="#${s.path}" transform="${mat(s.matrix)}"${s.fill ? ` fill="${s.fade ? `url(#${fadeOf(s.fill, s.fade)})` : s.fill}"` : ''}/>`
      : s.kind === 'eye' ? `<g transform="${mat(s.matrix)}">${eyeSvg(s.mark, frame.ink, s.gloss)}</g>`
      : `<g transform="${mat(s.matrix)}">${ribbonSvg(s.d, s.gradient)}</g>`,
    )
    .join('');
  const size = Number.isFinite(options.size) && (options.size as number) > 0 ? f(clamp(options.size as number, 8, 4096)) : null;
  const dims = size ? ` width="${size}" height="${size}"` : '';
  const label = esc(frame.name);
  const uid = frame.light || frame.shadow ? hashString(`${mat(frame.root)}|${body}|${frame.color}`).toString(36) : '';
  let under = '', over = '';
  if (frame.shadow) {
    const { cx, cy, rx, ry, opacity } = frame.shadow;
    under =
      `<radialGradient id="oba-s${uid}"><stop offset="0" stop-color="#000" stop-opacity="${f(opacity)}"/><stop offset="0.6" stop-color="#000" stop-opacity="${f(opacity * 0.45)}"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>` +
      `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" fill="url(#oba-s${uid})"/>`;
  }
  if (frame.light) {
    const l = frame.light;
    const stops = l.stops.map((st) => `<stop offset="${f(st.at)}" stop-color="${st.color}" stop-opacity="${f(st.opacity)}"/>`).join('');
    // The light falls only where the body was drawn: the same shapes again, in white, as its mask.
    over =
      `<mask id="oba-m${uid}" maskUnits="userSpaceOnUse" x="-50" y="-50" width="200" height="200"><g transform="${mat(frame.root)}" fill="#fff" stroke="#fff">${body.replace(/ fill="(?!none)[^"]*"/g, '')}</g></mask>` +
      `<linearGradient id="oba-l${uid}" gradientUnits="userSpaceOnUse" x1="${f(l.x1)}" y1="${f(l.y1)}" x2="${f(l.x2)}" y2="${f(l.y2)}">${stops}</linearGradient>` +
      `<rect x="-50" y="-50" width="200" height="200" fill="url(#oba-l${uid})" mask="url(#oba-m${uid})"/>`;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"${dims} role="img" aria-label="${label}" overflow="visible">` +
    `<title>${label}</title>` +
    `<defs>${defsMarkup}${fadeDefs.join('')}</defs>` +
    under +
    `<g transform="${mat(frame.root)}" fill="${frame.color}">` +
    body +
    `</g>` +
    over +
    `</svg>`
  );
}

// ---------------------------------------------------------------------------
// Live CSS 3D scene

/** 1 viewBox unit = 1% of the scene's (square) container width. */
const u = (n: number) => `${f(n)}cqw`;
const eyePlaneCss = ({ z, dzdx, dzdy }: EyePlane) =>
  `translateZ(${u(z + CSS_EYE_LIFT)}) matrix3d(1,0,${r4(dzdx)},0,0,1,${r4(dzdy)},0,0,0,1,0,0,0,0,1)`;
const FILL = 'position:absolute;left:0;top:0;width:100%;height:100%;';

function sliceMarkup(s: VolumeSlice): string {
  const pad = 0.3;
  const x = s.box.x - pad, y = s.box.y - pad, w = s.box.w + 2 * pad, h = s.box.h + 2 * pad;
  const rule = s.evenOdd ? ' fill-rule="evenodd"' : '';
  const place = s.axis === 'z'
    ? `left:${u(x)};top:${u(y)};transform:translateZ(${u(s.at)})`
    : // The side plane's u = 0 line sits at x = s.at; turning it 90° about that line maps u to -z.
      `left:${u(s.at + x)};top:${u(y)};transform-origin:${u(-x)} 50%;transform:rotateY(90deg)`;
  return (
    `<svg viewBox="${f(x)} ${f(y)} ${f(w)} ${f(h)}" style="position:absolute;width:${u(w)};height:${u(h)};overflow:visible;${place}" aria-hidden="true">` +
    `<path d="${s.d}"${rule} fill="currentColor"/></svg>`
  );
}

const overlay = (side: 'back' | 'front') =>
  `<svg data-fx="${side}" viewBox="0 0 100 100" style="${FILL}overflow:visible;pointer-events:none" fill="currentColor" aria-hidden="true"></svg>`;

/**
 * Static markup of the live scene for a definition and depth. Mount it once,
 * then apply `sceneFrame` every frame. Body color comes from CSS `color` on
 * an ancestor, eye ink from `--avatar-ink`.
 */
export function renderAvatarScene(definition: AvatarDefinition, options: Pick<RenderOptions, 'depth'> = {}): string {
  const p = prepare(definition, depthOption(options));
  const { vol } = p;
  const b = vol.bounds;
  const [cx, cy] = pivotOf(b);
  const ink = `var(--avatar-ink,${DEFAULT_EYE_COLOR})`;
  const stack = (axis: 'z' | 'x') =>
    `<div data-stack="${axis}" style="${FILL}transform-style:preserve-3d">` +
    vol.parts.map((part) => (axis === 'z' ? part.zSlices : part.xSlices).map(sliceMarkup).join('')).join('') +
    `</div>`;
  const eyes = eyeStates(p, poseOf(p, { reducedMotion: true })).map((e, i) => {
    const box = `left:${u(e.x - e.pw / 2)};top:${u(e.y - e.ph / 2)};width:${u(e.pw)};height:${u(e.ph)}`;
    return (
      `<div data-eye="${i}" style="position:absolute;${box};backface-visibility:hidden;transform:${eyePlaneCss(vol.eyePlanes[i])}">` +
      `<i style="position:absolute;inset:0;border-radius:50%;background:${ink}"></i>` +
      `<svg viewBox="${f(e.x - e.pw / 2)} ${f(e.y - e.ph / 2)} ${f(e.pw)} ${f(e.ph)}" style="${FILL}overflow:visible;display:none" aria-hidden="true">` +
      `<path d="${happyArc(e)}" fill="none" stroke="${ink}" stroke-width="${f(e.w * HAPPY_ARC.stroke)}" stroke-linecap="round"/></svg>` +
      // Every look between the pill and the arc: its outline is written each frame it changes.
      `<svg data-morph viewBox="${f(e.x - e.pw / 2)} ${f(e.y - e.ph / 2)} ${f(e.pw)} ${f(e.ph)}" style="${FILL}overflow:visible;display:none" aria-hidden="true">` +
      `<path fill="${ink}"/></svg>` +
      `</div>`
    );
  });
  return (
    `<div data-avatar-scene="${p.id}" style="position:relative;width:100%;height:100%;container-type:size">` +
    // Ribbons behind the body; they and the marks are written each frame they show.
    overlay('back') +
    // will-change pins the slices' raster scale: without it every hop and squash re-rasterizes each slice.
    `<div data-motion style="${FILL}will-change:transform;transform-origin:${u((b.minX + b.maxX) / 2)} ${u(b.maxY)}">` +
    `<div data-view style="${FILL}transform-style:preserve-3d;transform-origin:${u(cx)} ${u(cy)}">` +
    stack('z') + stack('x') + eyes.join('') +
    `</div></div>` +
    overlay('front') +
    `</div>`
  );
}

export interface SceneFrame {
  /** Identifies the static markup this frame belongs to. */
  scene: string;
  /** 2D motion (hop, roll, squash) about the base of the body. */
  motion: string;
  /** 3D view rotation about the body center, scaled down while the body gives way to a mark. */
  view: string;
  /** How much of its size the body keeps, 0..1; at 0 the view needs no layers. */
  body: number;
  /** Markup for the scene's two overlays (`data-fx`): ribbons behind the body; ribbons and marks in front. */
  back: string;
  front: string;
  stack: 'z' | 'x';
  /** Per slice of the active stack, in markup order: whether it shows. Hidden ones need no layer. */
  slices: boolean[];
  /** `d` is set while the eye is between the pill and the arc: it then shows the `data-morph` path alone. */
  eyes: { visible: boolean; happy: boolean; transform: string; pill: string; d: string }[];
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** Closest on-screen spacing, CSS px, between cross-sections a small live avatar keeps. */
const SLICE_GAP_PX = 0.75;

/**
 * Per slice of a stack, in markup order: whether it is kept at this rendered size. Within each part,
 * slices closer than SLICE_GAP_PX to the last kept one are dropped; the outermost always stay, and
 * so does the core, which sliceCull relies on to cover the inset slices it hides.
 */
function sliceDetail(p: Prepared, stack: 'z' | 'x', size: number | undefined): boolean[] {
  const px = Number.isFinite(size) && (size as number) > 0 ? Math.round(size as number) : 0;
  const key = `${stack}${px}`;
  let keep = p.detail.get(key);
  if (keep) return keep;
  const gap = px ? (SLICE_GAP_PX * 100) / px : 0;
  keep = p.vol.parts.flatMap((part) => {
    const slices = stack === 'z' ? part.zSlices : part.xSlices;
    let last = -Infinity;
    return slices.map((s, j) => {
      const core = s.axis === 'z' && s.at === 0 && s.inset === 0;
      const kept = core || j === 0 || j === slices.length - 1 || s.at - last >= gap;
      if (kept) last = s.at;
      return kept;
    });
  });
  if (p.detail.size >= 32) p.detail.clear();
  p.detail.set(key, keep);
  return keep;
}

/** Per-frame CSS for a mounted scene. Pure and cheap: no geometry is rebuilt. */
export function sceneFrame(definition: AvatarDefinition, options: RenderOptions = {}): SceneFrame {
  const p = prepare(definition, depthOption(options));
  const pose = poseOf(p, options);
  const v = viewBasis(pose.yaw, pose.pitch);
  const states = eyeStates(p, pose);
  const stack = activeStack(v);
  const drawn = sliceCull(v);
  const kept = sliceDetail(p, stack, options.size);
  const fx = effectsOf(p, pose, options);
  const piece = (front: boolean) => fx.ribbons.filter((r) => r.front === front).map((r) => ribbonSvg(r.d, r.gradient)).join('');
  let k = 0;
  return {
    scene: p.id,
    motion: `translate(0,${u(pose.lift)}) rotate(${f(pose.roll)}deg) scale(${r4(pose.sx)},${r4(pose.sy)})`,
    view: (fx.body < 1 ? `scale(${r4(fx.body)}) ` : '') + `rotateX(${r4(pose.pitch)}rad) rotateY(${r4(pose.yaw)}rad)`,
    body: fx.body,
    back: piece(false),
    front: piece(true) + fx.marks.map((mark) => `<path d="${esc(mark.d)}" transform="${mat(mark.matrix)}"/>`).join(''),
    stack,
    slices: p.vol.parts.flatMap((part) => (stack === 'z' ? part.zSlices : part.xSlices).map((s) => kept[k++] && drawn(s))),
    eyes: states.map((e, i) => ({
      visible: eyeVisible(v, p.vol.eyePlanes[i]),
      happy: false,
      transform: `${eyePlaneCss(p.vol.eyePlanes[i])} translate(${u(e.dx)},${u(e.dy)})`,
      pill: `translateY(${u(e.shift)}) scaleY(${r4(e.open / e.ph)})`,
      d: e.plain !== 'pill' ? eyePath(e.look, eyeSpot(e, false)) : '',
    })),
  };
}

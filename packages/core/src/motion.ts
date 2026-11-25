/**
 * Deterministic pose model. A pose is a pure function of (seed, time, state,
 * mood, gaze, reducedMotion): no wall clock, no Math.random, so any frame can
 * be reproduced exactly (tests, SSR, scrubbing).
 */
import { BANG, DOTS, blendMarks, poseMarks, type PoseMark } from './marks.ts';
import type { AvatarMood, AvatarMotion, AvatarMotionBlend, AvatarState } from './types.ts';

/**
 * How the eyes are drawn, as numbers that blend: any two looks mix into a shape in between, so
 * the eyes morph from one to the other (see eyes.ts).
 */
export interface EyeLook {
  /** 0 = the plain pill, 1 = the happy arc. */
  arc: number;
  /** 0 = the plain pill, 1 = the flat slit of a waiting bot. Never more than `1 - arc`. */
  slit: number;
}

export interface Pose {
  /** View rotation in radians: yaw turns about the vertical axis, pitch about the horizontal. */
  yaw: number;
  pitch: number;
  /** In-plane rotation, degrees. */
  roll: number;
  /** Vertical offset (negative = up), viewBox units. */
  lift: number;
  /** Squash and stretch about the base of the body. */
  sx: number;
  sy: number;
  /** Eye look direction, -1..1 per axis. */
  gazeX: number;
  gazeY: number;
  /** 0 = open, 1 = fully closed. */
  blink: number;
  /** Extra lid narrowing per eye, 0..1. */
  squintL: number;
  squintR: number;
  eyes: EyeLook;
  /** Presence of the ribbons that circle the body: 0..1 draws them out and back in. */
  ribbons: number;
  /** Which layout the ribbons take: 0 a working turn's one hoop, 1 a celebration's cage of three. */
  cage: number;
  /**
   * How far the body's turn has carried the ribbons round, radians, signed and not wrapped: each
   * ribbon goes its own share of it, so a whole turn more does not put them back where they were.
   */
  sweep: number;
  /**
   * The marks the body gives way to (see marks.ts), each with how far it has, 0..1: a state shows
   * one, and a pose on the way from one state to another may show two. In the order of their ids.
   */
  marks: readonly PoseMark[];
  /** A rigged character's limbs (see Limbs); all zero for an avatar without a rig. */
  limbs: Limbs;
}

/** Every state and mood, in the order hosts list them. */
/**
 * Where a rigged character holds its limbs, in degrees from how they are drawn (hanging down).
 * Arms and legs: how far they are raised out to their own side. `…s` is the swing toward the
 * viewer. Forearms bend on from the arm (negative folds the hand in toward the body); shins swing
 * on from the leg (negative is a knee bent back). `head` tilts, positive clockwise. `arm…z` holds
 * a whole arm out in front of the body, in viewBox units, so a hand can come round to the chest or the chin.
 * `foot…` lifts the heel of a shoe, which turns on the ball of the foot while the leg above it stays where it is.
 */
export interface Limbs {
  head: number;
  armL: number;
  armR: number;
  armLs: number;
  armRs: number;
  foreL: number;
  foreR: number;
  foreLs: number;
  foreRs: number;
  armLz: number;
  armRz: number;
  legL: number;
  legR: number;
  legLs: number;
  legRs: number;
  shinL: number;
  shinR: number;
  footL: number;
  footR: number;
}

const LIMB_KEYS = ['head', 'armL', 'armR', 'armLs', 'armRs', 'foreL', 'foreR', 'foreLs', 'foreRs', 'armLz', 'armRz', 'legL', 'legR', 'legLs', 'legRs', 'shinL', 'shinR', 'footL', 'footR'] as const;

/** Limbs as drawn. */
export function limbsAtRest(): Limbs {
  return { head: 0, armL: 0, armR: 0, armLs: 0, armRs: 0, foreL: 0, foreR: 0, foreLs: 0, foreRs: 0, armLz: 0, armRz: 0, legL: 0, legR: 0, legLs: 0, legRs: 0, shinL: 0, shinR: 0, footL: 0, footR: 0 };
}

export const STATES: readonly AvatarState[] = ['idle', 'thinking', 'working', 'waiting', 'blocked', 'done'];
export const MOODS: readonly AvatarMood[] = ['neutral', 'happy'];

export function isState(value: unknown): value is AvatarState {
  return STATES.includes(value as AvatarState);
}

export function isMood(value: unknown): value is AvatarMood {
  return MOODS.includes(value as AvatarMood);
}

/**
 * The state and mood to show, from values that may come from anywhere (a stored look, a link):
 * a state is one of the six by name, and anything else is `idle`. `motion` is the single option
 * that came before them: `thinking` is a state, `happy` a mood. An explicit `state` or `mood`
 * wins over it.
 */
export function resolveLook(given: { state?: unknown; mood?: unknown; motion?: unknown }): { state: AvatarState; mood: AvatarMood } {
  return {
    state: isState(given.state) ? given.state : given.motion === 'thinking' ? 'thinking' : 'idle',
    mood: isMood(given.mood) ? given.mood : given.motion === 'happy' ? 'happy' : 'neutral',
  };
}

/** Resting view: turned a little and seen a little from above, so the volume reads without dominating. */
export const BASE_YAW = -0.3;
export const BASE_PITCH = 0.2;
/**
 * The share of the resting view a rigged character keeps: on a figure with legs, the full turn
 * and the view from above read as leaning back and to one side, so it stands nearly square on.
 */
const STAND = 0.35;
/**
 * Following a look target: the body turns toward it by up to these angles
 * (radians, at full deflection) and the eyes use this share of their small
 * range, so the whole character looks rather than the eyes sliding alone.
 */
export const LOOK_YAW = 0.32;
export const LOOK_PITCH = 0.18;
export const LOOK_EYES = 0.7;

const TAU = Math.PI * 2;

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Stateless hash noise in [0, 1). */
export function noise(seed: number, n: number): number {
  let h = (seed ^ Math.imul(n | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (u: number) => { const x = clamp(u, 0, 1); return x * x * (3 - 2 * x); };
const mix = (a: number, b: number, k: number) => a + (b - a) * k;

/** Blink closure 0..1: one blink per ~4.2 s slot at a seeded offset, sometimes a double blink. */
export function blinkAt(seed: number, t: number): number {
  const SLOT = 4.2, DUR = 0.19;
  const slot = Math.floor(t / SLOT);
  let closure = 0;
  for (const s of [slot - 1, slot]) {
    const start = s * SLOT + 0.5 + noise(seed, s * 2) * 2.9;
    const starts = noise(seed, s * 2 + 1) > 0.8 ? [start, start + 0.34] : [start];
    for (const b of starts) {
      const u = (t - b) / DUR;
      if (u > 0 && u < 1) closure = Math.max(closure, Math.sin(Math.PI * u));
    }
  }
  return closure;
}

/** Idle eye wander: short holds between quick saccades, centered more often than not. */
export function wanderAt(seed: number, t: number): [number, number] {
  const SLOT = 1.9;
  const s = Math.floor(t / SLOT);
  const target = (k: number): [number, number] => {
    if (noise(seed, 1000 + k * 3) < 0.4) return [0, 0];
    return [(noise(seed, 1001 + k * 3) * 2 - 1) * 0.6, (noise(seed, 1002 + k * 3) * 2 - 1) * 0.35];
  };
  const a = target(s - 1), b = target(s);
  const e = smooth((t - s * SLOT) / 0.16);
  return [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e];
}

/** Working: the eyes dart from one thing to the next, mostly down at the work. */
function dartAt(seed: number, t: number): [number, number] {
  const SLOT = 0.62;
  const s = Math.floor(t / SLOT);
  const target = (k: number): [number, number] => [(noise(seed, 2001 + k * 3) * 2 - 1) * 0.8, 0.1 + noise(seed, 2002 + k * 3) * 0.5];
  const a = target(s - 1), b = target(s);
  const e = smooth((t - s * SLOT) / 0.12);
  return [mix(a[0], b[0], e), mix(a[1], b[1], e)];
}

export interface PoseInput {
  seed: number;
  time: number;
  state?: AvatarState | AvatarStateDefinition;
  mood?: AvatarMood;
  /** @deprecated Use `state` and `mood`; they win when given. */
  motion?: AvatarMotion;
  /** Seconds since `state` began: `done` celebrates from then on. Without it the state is at rest. */
  stateAge?: number;
  /** Look target, -1..1 per axis (x right, y down); `weight` 0..1 fades it in over the idle pose (default 1). */
  gaze?: { x: number; y: number; weight?: number };
  reducedMotion: boolean;
  /** Extra view rotation in radians (e.g. from drag-to-turn), added to the resting view. */
  view?: { yaw: number; pitch: number };
  /** Easing in from what was shown before (see blendPoses). */
  blend?: AvatarMotionBlend;
  /**
   * The avatar has a rig: it acts its states out with its arms, legs and head, and keeps its body
   * where an avatar without one gives way to the thinking dots or the blocked mark.
   */
  rigged?: boolean;
}

/**
 * Pose part way from `a` to `b`, both taken at the same moment so either side's motion keeps
 * running. Everything is a number, the eyes' look included, so eyes morph from one shape to the
 * next and a body gives way to a mark (and back) part by part.
 */
export function blendPoses(a: Pose, b: Pose, t: number): Pose {
  const k = clamp(t, 0, 1);
  const m = (x: number, y: number) => mix(x, y, k);
  // The ribbons stay where the side that shows them has carried them: mixing a celebration's many
  // turns with a pose that has none would wind them back round while they fade.
  const sweep = a.ribbons > 0 && b.ribbons > 0 ? m(a.sweep, b.sweep) : a.ribbons > 0 ? a.sweep : b.sweep;
  // Likewise their layout: a celebration fading out keeps its cage.
  const cage = a.ribbons > 0 && b.ribbons > 0 ? m(a.cage, b.cage) : a.ribbons > 0 ? a.cage : b.cage;
  return {
    yaw: m(a.yaw, b.yaw), pitch: m(a.pitch, b.pitch), roll: m(a.roll, b.roll), lift: m(a.lift, b.lift),
    sx: m(a.sx, b.sx), sy: m(a.sy, b.sy), gazeX: m(a.gazeX, b.gazeX), gazeY: m(a.gazeY, b.gazeY),
    blink: m(a.blink, b.blink), squintL: m(a.squintL, b.squintL), squintR: m(a.squintR, b.squintR),
    eyes: { arc: m(a.eyes.arc, b.eyes.arc), slit: m(a.eyes.slit, b.eyes.slit) },
    ribbons: m(a.ribbons, b.ribbons), cage, sweep, marks: blendMarks(a.marks, b.marks, m),
    limbs: blendLimbs(a.limbs, b.limbs, k),
  };
}

/** Limbs part way from one hold to the next, eased at both ends so an arm neither jumps off nor stops dead. */
function blendLimbs(a: Limbs, b: Limbs, k: number): Limbs {
  const e = k * k * k * (k * (6 * k - 15) + 10);
  const out = limbsAtRest();
  for (const key of LIMB_KEYS) out[key] = mix(a[key], b[key], e);
  return out;
}

export function computePose(input: PoseInput): Pose {
  const pose = statePose(input);
  const blend = input.blend;
  if (!blend || !(blend.t < 1)) return pose;
  const from = typeof blend.from === 'string' ? { motion: blend.from } : blend.from;
  // A change of mood alone keeps the state's clock running on both sides, so a turn under way
  // stays one turn; a state that was left is held at the age it had.
  const stateAge = stateId(lookOf(from).state) === stateId(lookOf(input).state) ? input.stateAge : from.age;
  const before = computePose({ ...input, state: from.state, mood: from.mood, motion: from.motion, stateAge, blend: from.blend });
  return blendPoses(before, pose, Number.isFinite(blend.t) ? blend.t : 1);
}

/**
 * Done celebrates in cycles, timed as PR #14 measured the Grok Bot demo: the ribbons go round
 * DONE_SWEEPS times while the body turns DONE_SWEEPS / 3 times (see celebration), then they draw
 * back in and the bot rests. DONE_TURN_S covers the turn and the drawing in. A cycle lasts
 * DONE_CYCLE_S or up to a seventh longer, differently for each avatar, so several done bots on a
 * page drift apart instead of turning together.
 */
export const DONE_TURN_S = 3.87;
export const DONE_CYCLE_S = 6.2;
const DONE_SWEEPS = 9;
/**
 * How long the ribbons take to draw back in, seconds: they start once the turn has slowed below
 * about 0.9 rad/s, 3.37 s in, and are gone at DONE_TURN_S.
 */
const DONE_DRAW_IN_S = 0.5;
/** How long the eyes take to turn happy once the turn is over, and to open again as the next begins, seconds. */
const DONE_SMILE_S = 0.4;

/** How long a thinking bot's eyes take to go from one side to the other and back, seconds. */
const THINK_LOOK_S = 4.8;

/**
 * A working bot gets on with it and every so often throws itself into the work: a band of
 * ribbons sweeps once round it, easing in like a spring settling, then draws back in. The first comes WORK_FIRST_S
 * (plus up to WORK_FIRST_JITTER_S) after the state begins, then one every WORK_GAP_S, each up to
 * WORK_JITTER_S late, so several working bots do not turn together. A turn takes WORK_TURN_S.
 */
const WORK_FIRST_S = 1.2;
const WORK_FIRST_JITTER_S = 1.2;
const WORK_GAP_S = 7.5;
const WORK_JITTER_S = 1.5;
const WORK_TURN_S = 1.5;
/** How quickly a working turn eases in to its full circle, per second: a critically damped spring's rate. */
const WORK_EASE = 6.2;

/**
 * Where a working bot is in its turns `age` seconds into the state: how far into the current
 * turn (seconds), or null between turns.
 */
function workTurn(seed: number, age: number): number | null {
  const first = WORK_FIRST_S + WORK_FIRST_JITTER_S * noise(seed, 41);
  if (age < first) return null;
  const n = Math.floor((age - first) / WORK_GAP_S);
  // A turn may start up to WORK_JITTER_S late, so the one before may still be running.
  for (const k of [n, n - 1]) {
    if (k < 0) continue;
    const start = first + k * WORK_GAP_S + (k ? WORK_JITTER_S * noise(seed, 60 + k) : 0);
    if (age >= start && age < start + WORK_TURN_S) return age - start;
  }
  return null;
}

/** An angle as the nearest way round to it, -π..π, so a blend never unwinds whole turns. */
const near = (angle: number) => angle - TAU * Math.round(angle / TAU);

/**
 * How far a celebration's ribbons have gone round `t` seconds in, radians, on PR #14's curve: half
 * a radian of wind-up the other way over 0.24 s, a speed-up to a steady run, then from 2.54 s a
 * slow-down that lands, at 3.79 s, on DONE_SWEEPS whole turns.
 */
const CELEBRATION_END_S = 3.79;
const CELEBRATION_SPEED = (DONE_SWEEPS * TAU + 0.5) / 2.4625;
function celebration(t: number): number {
  const v = CELEBRATION_SPEED;
  if (t <= 0) return 0;
  if (t < 0.24) return -0.25 * (1 - Math.cos((Math.PI * t) / 0.24));
  if (t < 0.54) return -0.5 + (v * (t - 0.24) ** 2) / 0.6;
  if (t < 2.54) return -0.5 + v * (t - 0.39);
  if (t < CELEBRATION_END_S) return -0.5 + v * 2.15 + (1.25 * v * (1 - (1 - (t - 2.54) / 1.25) ** 4)) / 4;
  return DONE_SWEEPS * TAU;
}

/**
 * A rigged character's body language for each state, written into `L`. Everything is a sum of
 * slow waves and eased gestures, so limbs never jump; changes of state are eased by blendPoses.
 */
function actOut(L: Limbs, c: { state: string; mood: AvatarMood; seed: number; t: number; reducedMotion: boolean; age: number | null }) {
  const { state, mood, seed, t, reducedMotion } = c;
  const wave = (period: number, phase = 0) => (reducedMotion ? 0 : Math.sin((TAU * t) / period + phase));
  /** A gesture that comes round every `every` seconds or so and lasts `length`: how far into it (seconds), how much of it shows (0..1) and which time round it is. */
  const gesture = (every: number, length: number, n: number) => {
    if (reducedMotion) return { into: 0, show: 0, round: 0 };
    const cycle = every * (1 + 0.35 * noise(seed, n));
    const at = t + cycle * noise(seed, n + 1);
    const round = Math.floor(at / cycle), into = at - round * cycle;
    return { into, show: into < length ? smooth(into / 0.5) * smooth((length - into) / 0.6) : 0, round };
  };
  /** Loose arms that breathe, a head that drifts and weight that shifts from foot to foot. */
  const loose = (pace: number) => {
    L.armL = 5 + 2.5 * wave(3.4 * pace, -Math.PI / 2);
    L.armR = 5 + 2.5 * wave(3.4 * pace, -Math.PI / 2 + 0.7);
    L.foreL = -8 + 3 * wave(4.3 * pace, 1);
    L.foreR = -8 + 3 * wave(4.9 * pace, 2);
    L.head = 2.5 * wave(6.3 * pace, 0.5);
    L.legL = 1.5 * wave(5.3 * pace, 2);
    L.legR = -1.5 * wave(5.3 * pace, 2);
  };

  if (state === 'idle' && mood === 'happy') {
    // Hops with its arms flung up and its knees tucked.
    const period = 0.92;
    const p = reducedMotion ? 0.5 : ((t % period) + period) % period / period;
    const air = 4 * p * (1 - p);
    L.armL = 48 + 42 * air;
    L.armR = 48 + 42 * air;
    L.foreL = L.foreR = 18 - 10 * air;
    L.legL = L.legR = 9 * air;
    L.shinL = L.shinR = -26 * air;
    L.head = 3 * wave(period * 2);
  } else if (state === 'thinking') {
    // Chin in hand: one upper arm points forward, the elbow bends about a right angle and the
    // forearm comes up and in, so the hand rests against the chin, tapping; the other hand on its hip.
    const tap = wave(1.3);
    L.armL = -15 + 1.2 * tap;
    L.armLs = 60;
    L.foreL = -98 - 3 * tap;
    L.foreLs = 30;
    L.armLz = 4;
    L.armR = 36;
    L.foreR = -100;
    L.head = 1.2 * wave(4.1);
    // Its weight on one leg, straight under it; the other set out to the side and planted too,
    // only its foot tapping: the heel lifts a little and comes down.
    const foot = reducedMotion ? 0 : Math.max(0, Math.sin((TAU * t) / 0.78)) ** 2;
    L.legL = 0;
    L.legR = 7;
    L.footR = 13 * foot;
  } else if (state === 'working') {
    // Elbows out and hands busy, pumping one after the other, with a nod to the beat. The swing
    // toward the viewer stays small: a part turned far out of the plane shows its cross-sections.
    const beat = wave(0.42);
    L.armL = 18 + 4 * beat;
    L.armR = 18 - 4 * beat;
    L.foreL = 62 + 28 * beat;
    L.foreR = 62 - 28 * beat;
    L.armLs = L.armRs = 10;
    L.foreLs = 14 + 8 * beat;
    L.foreRs = 14 - 8 * beat;
    L.head = 2.5 * wave(0.84);
    L.legL = 2 + 1.5 * beat;
    L.legR = 2 - 1.5 * beat;
  } else if (state === 'waiting') {
    // Hands on hips, a foot tapping, a sigh now and then.
    const p = reducedMotion ? 0 : ((t % 6.5) + 6.5) % 6.5 / 6.5;
    const sigh = Math.sin(TAU * clamp(p / 0.33, 0, 1));
    const tap = reducedMotion ? 0 : Math.max(0, Math.sin((TAU * t) / 0.62)) ** 2;
    L.armL = L.armR = 36 - 6 * sigh;
    L.foreL = L.foreR = -98 + 5 * sigh;
    L.head = 3 + 1.5 * wave(6.4, 2);
    // The leg stays planted and only its foot taps, as when it thinks: the heel lifts a little and comes down.
    L.legR = 6;
    L.footR = 13 * tap;
  } else if (state === 'blocked') {
    // A shrug: elbows in, palms up and out, head tipped.
    L.armL = L.armR = 30 + 2.5 * wave(2.6);
    L.foreL = L.foreR = 104 + 4 * wave(2.6, 0.8);
    L.head = -7 + 1.5 * wave(3.9);
  } else if (state === 'done') {
    loose(1.25);
    // While the ribbons fly it cheers, arms up and pumping in turn; then it settles.
    const since = c.age === null || reducedMotion ? DONE_TURN_S : c.age % (DONE_CYCLE_S * (1 + 0.15 * noise(seed, 31)));
    const cheer = since < DONE_TURN_S ? smooth(since / 0.7) * smooth((DONE_TURN_S - since) / 0.8) : 0;
    const pump = wave(0.46);
    L.armL = mix(L.armL, 148 + 14 * pump, cheer);
    L.armR = mix(L.armR, 148 - 14 * pump, cheer);
    L.foreL = mix(L.foreL, 14 * pump, cheer);
    L.foreR = mix(L.foreR, -14 * pump, cheer);
    L.legL += 7 * cheer;
    L.legR += 7 * cheer;
    L.shinL = L.shinR = -16 * cheer * Math.max(0, wave(0.46));
  } else {
    loose(1);
    // Every so often something of its own, a different one each time round and a different order for each character.
    const g = gesture(8.5, 2.6, 53);
    if (g.show > 0) {
      const which = (g.round + Math.floor(noise(seed, 57) * 3)) % 3;
      if (which === 0) {
        // A wave hello.
        L.armR = mix(L.armR, 128, g.show);
        L.foreR = mix(L.foreR, 22 + 24 * Math.sin((TAU * g.into) / 0.44), g.show);
        L.head += 5 * g.show;
      } else if (which === 1) {
        // A big stretch.
        L.armL = mix(L.armL, 152, g.show);
        L.armR = mix(L.armR, 152, g.show);
        L.foreL = mix(L.foreL, -12, g.show);
        L.foreR = mix(L.foreR, -12, g.show);
        L.head -= 4 * g.show;
      } else {
        // Hands on hips, a look about.
        L.armL = mix(L.armL, 34, g.show);
        L.armR = mix(L.armR, 34, g.show);
        L.foreL = mix(L.foreL, -100, g.show);
        L.foreR = mix(L.foreR, -100, g.show);
        L.head += 7 * g.show * Math.sin((TAU * g.into) / 2.6);
      }
    }
  }
}

/** What a state works its pose out from. */
export interface StateContext {
  /** The avatar's own seed, for noise that differs from one avatar to the next. */
  seed: number;
  /** The animation clock as given, seconds. */
  time: number;
  /** The clock offset per avatar, so several on a page do not move in lockstep; 0 under reduced motion. */
  t: number;
  /** Seconds since the state began, where the host gave it (see PoseInput.stateAge). */
  stateAge: number | undefined;
  mood: AvatarMood;
  reducedMotion: boolean;
  /** 1, or 0 under reduced motion: a factor for motion that should stop. */
  live: number;
  /** How much of its idle turning the body keeps: less while it attends to a look target. */
  sway: number;
  /** The avatar is a rigged character: it stands on its legs and acts the state out with its limbs, so its body leans less. */
  rigged: boolean;
  /** A sine of this period (seconds) on the clock; 0 under reduced motion. */
  wave(period: number, phase?: number): number;
  /** The pose a state starts from: the resting view, eyes open and shaped by the mood, no ribbons or marks. */
  base: Pose;
  /**
   * The calm pose of a bot with nothing to do, for a state that keeps the body: it breathes,
   * sways, blinks and looks around. `pace` stretches its periods (default 1; `done` rests at 1.25).
   */
  rest(pace?: number): Pose;
}

/**
 * A state: what the bot does while it is in it, as a pose for each moment. The six of
 * AvatarState are definitions (see stateDefinition), and a host can pass one of its own wherever
 * a state is taken.
 *
 * @experimental A definition of a host's own is written against Pose and StateContext, the
 * renderer's own model of a pose. Fields of either may be renamed or removed in a minor release
 * while this settles; the six names are not affected.
 */
export interface AvatarStateDefinition {
  /**
   * Names the state. Two definitions with one id are the same state: changing between them is
   * not a change of state, so nothing eases and the state's age runs on.
   */
  id: string;
  /**
   * The pose at one moment: what differs from the context's `base`. A pure function of the
   * context, so a frame can be drawn again exactly. Under `reducedMotion` it returns a pose that
   * holds still. The look target and the view are applied on top.
   */
  pose(ctx: StateContext): Partial<Pose>;
  /**
   * The age the state has when an avatar mounts in it, seconds (default 0: it starts afresh).
   * `done` mounts past its celebration, as if it had just finished.
   */
  startAge?: number;
}

/** The calm pose of a bot with nothing to do: it breathes, sways, blinks and looks around. */
function rest({ seed, t, reducedMotion, sway, wave, base }: Omit<StateContext, 'rest'>, pace: number): Pose {
  const pose = { ...base };
  pose.yaw += 0.07 * sway * wave(6.1 * pace);
  pose.pitch += 0.04 * sway * wave(4.7 * pace, 1);
  pose.roll = 1.6 * wave(5.3 * pace, 2);
  pose.lift = reducedMotion ? 0 : -0.45 * (1 - Math.cos((TAU * t) / (3.4 * pace)));
  const breath = wave(3.4 * pace, -Math.PI / 2);
  pose.sy = 1 + 0.012 * breath;
  pose.sx = 1 - 0.008 * breath;
  if (!reducedMotion) {
    pose.blink = blinkAt(seed, t);
    [pose.gazeX, pose.gazeY] = wanderAt(seed, t);
  }
  return pose;
}

const STATE_DEFINITIONS: Record<AvatarState, AvatarStateDefinition> = {
  idle: {
    id: 'idle',
    pose(ctx) {
      if (ctx.mood !== 'happy') return ctx.rest();
      // With nothing to do, a happy bot hops.
      const { t, reducedMotion, live, wave } = ctx;
      const pose = { ...ctx.base };
      const period = 0.92;
      const p = reducedMotion ? 0.5 : ((t % period) + period) % period / period;
      const air = 4 * p * (1 - p);
      const land = reducedMotion ? 0 : clamp(1 - Math.min(p, 1 - p) / 0.12, 0, 1);
      pose.lift = reducedMotion ? 0 : -3.2 * air;
      pose.sy = 1 - 0.09 * land + 0.03 * air * live;
      pose.sx = 1 + 0.07 * land - 0.015 * air * live;
      pose.roll = 4.5 * wave(period * 2);
      pose.yaw += 0.1 * wave(period * 2, 0.6);
      return pose;
    },
  },
  thinking: {
    id: 'thinking',
    // Looks up and away while it gives way to the three dots.
    // A character stands straight, its weight over one leg (see actOut): no turn or tilt of the
    // body, only a slow sway.
    pose({ seed, t, reducedMotion, live, sway, wave, base, rigged }) {
      const pose = { ...base };
      const upright = rigged ? 0 : 1;
      pose.yaw += upright * 0.12 + 0.05 * sway * wave(7.3);
      pose.pitch += upright * 0.08;
      pose.roll = upright * -5 + (rigged ? 0.6 : 1.4) * wave(4.1);
      pose.lift = -0.5 * (1 - Math.cos((TAU * t) / 5.2)) * live;
      // Deep in thought: the eyes go up to one side, rest there, then cross to the other and rest
      // again. The eye on the side they look to narrows a little, so the squint passes from one
      // eye to the other and back.
      const swing = wave(THINK_LOOK_S);
      const side = reducedMotion ? 1 : swing / Math.sqrt(swing * swing + 0.05);
      pose.gazeX = 0.1 + 0.42 * side;
      pose.gazeY = -0.7 + 0.08 * (1 - side * side);
      pose.squintL = 0.2 + 0.6 * Math.max(0, -side);
      pose.squintR = 0.2 + 0.6 * Math.max(0, side);
      if (!reducedMotion) pose.blink = blinkAt(seed, t * 0.7);
      pose.marks = [{ mark: DOTS, weight: 1 }];
      return pose;
    },
  },
  working: {
    id: 'working',
    // Bent over the work and busy: a quick steady bob and eyes darting across it, and every so
    // often a turn with a band of ribbons sweeping round it.
    pose({ seed, time, t, stateAge, reducedMotion, live, sway, wave, base }) {
      const pose = { ...base };
      const beat = wave(0.7);
      pose.yaw += 0.08 * sway * wave(2.3, 0.4);
      pose.pitch -= 0.05;
      pose.roll = 3 + 0.6 * beat;
      pose.lift = -0.3 * (0.5 + 0.5 * beat) * live;
      pose.sy = 0.99 - 0.008 * beat;
      pose.sx = 1.005 + 0.005 * beat;
      pose.squintL = 0.25;
      pose.squintR = 0.25;
      if (reducedMotion) {
        pose.gazeX = 0.15;
        pose.gazeY = 0.3;
      } else {
        [pose.gazeX, pose.gazeY] = dartAt(seed, t);
        pose.blink = blinkAt(seed, t * 1.3);
      }
      // Counted from when the state began; without an age, from the clock.
      const age = Number.isFinite(stateAge) ? Math.max(0, stateAge as number) : Math.max(0, time);
      const into = reducedMotion ? null : workTurn(seed, age);
      if (into !== null) {
        // A full circle that eases in like a spring settling. The band rides it round, out at the
        // start and back in at the end; the body keeps facing the work, leaning into the sweep, and
        // the eyes follow the band across.
        const e = WORK_EASE * into;
        const turn = TAU * (1 - (1 + e) * Math.exp(-e));
        const swell = Math.sin(turn / 2);
        pose.ribbons = clamp(into / 0.16, 0, 1) * clamp((WORK_TURN_S - into) / 0.5, 0, 1);
        pose.sweep = turn;
        pose.yaw += 0.22 * swell;
        pose.roll += 3 * swell;
        pose.lift -= 1.2 * swell;
        pose.gazeX = clamp(pose.gazeX * (1 - swell) - 0.85 * Math.sin(turn), -1, 1);
        pose.gazeY = pose.gazeY * (1 - swell) - 0.3 * swell;
      }
      return pose;
    },
  },
  waiting: {
    id: 'waiting',
    // Leans to one side, eyes flattened to slits, glancing off at whatever it is waiting on.
    // Now and then it sighs. A happy bot keeps its arcs.
    pose({ seed, t, reducedMotion, live, sway, wave, base, rigged }) {
      const pose = { ...base };
      const p = reducedMotion ? 0 : ((t % 6.5) + 6.5) % 6.5 / 6.5;
      // One breath in and out over the first third of the cycle.
      const sigh = Math.sin(TAU * clamp(p / 0.33, 0, 1));
      pose.yaw += 0.04 * sway * wave(7.4);
      pose.pitch += 0.02 + 0.03 * sigh;
      // A character keeps most of the lean out of its body: it stands on its legs, with its head a little to one side.
      pose.roll = (rigged ? 1.5 : 7) + 1.2 * wave(6.4, 2);
      pose.lift = -0.3 * (1 - Math.cos((TAU * t) / 6.5)) * live;
      pose.sy = 1 + 0.025 * sigh;
      pose.sx = 1 - 0.012 * sigh;
      pose.gazeX = 0.5 + 0.15 * wave(8.2);
      pose.gazeY = 0.1;
      pose.eyes = { arc: base.eyes.arc, slit: 1 - base.eyes.arc };
      if (!reducedMotion) pose.blink = blinkAt(seed, t * 0.6);
      return pose;
    },
  },
  blocked: {
    id: 'blocked',
    // Stops still while it gives way to the exclamation mark.
    pose: () => ({ sy: 1.02, sx: 0.99, marks: [{ mark: BANG, weight: 1 }] }),
  },
  done: {
    id: 'done',
    startAge: DONE_TURN_S,
    // Celebrates: a few turns with ribbons flying round it, then a rest, content and a little
    // slower than idle, and after a while again, the other way round.
    pose(ctx) {
      const { seed, stateAge, reducedMotion } = ctx;
      const pose = ctx.rest(1.25);
      // Counted from when the state began. Without an age it is at rest.
      const aged = !reducedMotion && Number.isFinite(stateAge);
      const age = aged ? Math.max(0, stateAge as number) : DONE_TURN_S;
      const length = DONE_CYCLE_S * (1 + 0.15 * noise(seed, 31));
      const cycle = Math.floor(age / length), since = age - cycle * length;
      // Once the turn is over it is pleased with itself: the eyes ease into their happy arcs for the
      // rest, and open again as the next turn sets off. Drawn at rest, it is smiling.
      const glad = !aged ? 1
        : since >= DONE_TURN_S ? smooth((since - DONE_TURN_S) / DONE_SMILE_S)
        : cycle > 0 ? 1 - smooth(since / DONE_SMILE_S) : 0;
      pose.eyes = { arc: Math.max(pose.eyes.arc, glad), slit: pose.eyes.slit };
      if (since < DONE_TURN_S) {
        const swell = Math.sin((Math.PI * since) / DONE_TURN_S);
        const way = cycle % 2 ? -1 : 1;
        const sweep = celebration(since) * way;
        // The body turns a third as often as the ribbons go round.
        pose.yaw += near(sweep / 3);
        pose.lift -= 2.2 * swell;
        pose.sy += 0.04 * swell;
        // All the ribbons out at full strength while the turn is quick, drawn back in as it settles.
        pose.ribbons = clamp(since / 0.1, 0, 1) * clamp((DONE_TURN_S - since) / DONE_DRAW_IN_S, 0, 1);
        pose.cage = 1;
        // The ribbons only set off once the turn goes forward: the wind-up does not carry them.
        pose.sweep = way * Math.max(0, celebration(since));
      }
      return pose;
    },
  },
};

export function isStateDefinition(value: unknown): value is AvatarStateDefinition {
  const v = value as AvatarStateDefinition | null;
  return typeof v === 'object' && v !== null && typeof v.id === 'string' && typeof v.pose === 'function';
}

/** The definition of a state: one of the six by name, or the host's own as it is. */
export function stateDefinition(state: AvatarState | AvatarStateDefinition): AvatarStateDefinition {
  return typeof state === 'string' ? STATE_DEFINITIONS[state] : state;
}

/** What names a state: two states with one id are the same state. */
export function stateId(state: AvatarState | AvatarStateDefinition): string {
  return typeof state === 'string' ? state : state.id;
}

/**
 * The state and mood to show, where the state may be a definition of the host's own. Anything
 * else resolves as in resolveLook.
 */
export function lookOf(given: { state?: unknown; mood?: unknown; motion?: unknown }): { state: AvatarState | AvatarStateDefinition; mood: AvatarMood } {
  const named = resolveLook(given);
  return isStateDefinition(given.state) ? { state: given.state, mood: named.mood } : named;
}

const POSE_NUMBERS = ['yaw', 'pitch', 'roll', 'lift', 'sx', 'sy', 'gazeX', 'gazeY', 'blink', 'squintL', 'squintR', 'ribbons', 'cage', 'sweep'] as const;

/**
 * What a state's pose returned, laid over the base pose. A definition is a host's code: a field it
 * leaves out, or gives no usable value for (not a finite number, not a list of marks), keeps the
 * base's, so a slip in one field cannot empty the frame.
 */
function laid(base: Pose, given: Partial<Pose> | undefined): Pose {
  const pose = { ...base };
  if (typeof given !== 'object' || given === null) return pose;
  const number = (v: unknown, or: number) => (typeof v === 'number' && Number.isFinite(v) ? v : or);
  for (const key of POSE_NUMBERS) pose[key] = number(given[key], base[key]);
  pose.eyes = { arc: number(given.eyes?.arc, base.eyes.arc), slit: number(given.eyes?.slit, base.eyes.slit) };
  if (given.marks !== undefined) pose.marks = poseMarks(given.marks);
  return pose;
}

function statePose(input: PoseInput): Pose {
  const { seed, time, gaze, reducedMotion, view } = input;
  const { state, mood } = lookOf(input);
  // Per-avatar phase offset so several avatars on a page do not move in lockstep.
  const t = reducedMotion ? 0 : time + noise(seed, 7) * 10;
  const given = gaze && Number.isFinite(gaze.x) && Number.isFinite(gaze.y)
    ? [clamp(gaze.x, -1, 1), clamp(gaze.y, -1, 1)] as [number, number]
    : null;
  const weight = given ? (Number.isFinite(gaze?.weight) ? clamp(gaze?.weight as number, 0, 1) : 1) : 0;

  // A rigged character keeps a share of the resting view (see STAND).
  const baseYaw = BASE_YAW * (input.rigged ? STAND : 1), basePitch = BASE_PITCH * (input.rigged ? STAND : 1);
  const base: Pose = {
    yaw: baseYaw, pitch: basePitch, roll: 0, lift: 0, sx: 1, sy: 1,
    gazeX: 0, gazeY: 0, blink: 0, squintL: 0, squintR: 0,
    eyes: { arc: mood === 'happy' ? 1 : 0, slit: 0 }, ribbons: 0, cage: 0, sweep: 0, marks: [],
    limbs: limbsAtRest(),
  };
  const ctx: Omit<StateContext, 'rest'> = {
    seed, time, t, stateAge: input.stateAge, mood, reducedMotion,
    live: reducedMotion ? 0 : 1,
    // While it attends to a target the body holds its aim: idle sway of the turn settles to a trace.
    sway: 1 - 0.7 * weight,
    wave: (period, phase = 0) => (reducedMotion ? 0 : Math.sin((TAU * t) / period + phase)),
    rigged: input.rigged === true,
    base,
  };
  const pose = laid(base, stateDefinition(state).pose({ ...ctx, rest: (pace = 1) => rest(ctx, pace) }));

  if (input.rigged) {
    // A character says it with its body: no dots or mark takes its place.
    pose.marks = [];
    pose.limbs = limbsAtRest();
    actOut(pose.limbs, { state: stateId(state), mood, seed, t, reducedMotion, age: Number.isFinite(input.stateAge) ? Math.max(0, input.stateAge as number) : null });
  }

  if (given && weight > 0) {
    // A look target wins over idle wander. The body turns to face it: the resting
    // three-quarter turn gives way (so a target on either side turns the front that
    // way) and the eyes add a modest share on top. Reduced motion keeps the body
    // still, so the eyes alone use their full (still small) range. Happy arcs stay put.
    const share = reducedMotion ? 1 : LOOK_EYES;
    const follow = weight * (1 - pose.eyes.arc);
    pose.gazeX = mix(pose.gazeX, given[0] * share, follow);
    pose.gazeY = mix(pose.gazeY, given[1] * share, follow);
    if (!reducedMotion) {
      // Positive yaw turns the front to the right, positive pitch tips it up.
      pose.yaw += weight * (given[0] * LOOK_YAW - baseYaw);
      pose.pitch += weight * (-given[1] * LOOK_PITCH - basePitch / 2);
    }
  }
  if (view && Number.isFinite(view.yaw) && Number.isFinite(view.pitch)) {
    pose.yaw += view.yaw;
    pose.pitch += view.pitch;
  }
  return pose;
}

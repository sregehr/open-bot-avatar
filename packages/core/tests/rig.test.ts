import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { avatarFrame, renderAvatarSvg } from '../src/render.ts';
import { blendPoses, computePose, limbsAtRest } from '../src/motion.ts';
import { validateAvatar } from '../src/validate.ts';
import { buildVolume } from '../src/volume.ts';
import type { AvatarDefinition } from '../src/types.ts';

const scout = JSON.parse(readFileSync(new URL('../../../gallery/figure-scout.json', import.meta.url), 'utf8')) as AvatarDefinition;
const box = { version: 1, id: 'box', name: 'Box', body: { path: 'M20 20H80V80H20Z' }, eyes: { x: 50, y: 46, spacing: 15, scale: 1 } };

describe('rig', () => {
  it('is kept by the validator, and checked', () => {
    const ok = validateAvatar(scout);
    expect(ok.ok && ok.value.rig?.length).toBe(scout.rig?.length);
    expect(validateAvatar({ ...box, rig: [{ part: 0, role: 'head', x: 50, y: 50 }] }).ok).toBe(true);
    expect(validateAvatar({ ...box, rig: [{ part: 1, role: 'head', x: 50, y: 50 }] }).ok).toBe(false);
    expect(validateAvatar({ ...box, rig: [{ part: 0, role: 'tail', x: 50, y: 50 }] }).ok).toBe(false);
    expect(validateAvatar({ ...box, rig: [{ part: 0, role: 'head', x: 50, y: 50 }, { part: 0, role: 'arm-l', x: 1, y: 1 }] }).ok).toBe(false);
    expect(validateAvatar({ ...box, rig: [{ part: 0, role: 'head', x: 500, y: 50 }] }).ok).toBe(false);
  });

  it('leaves an avatar without one alone', () => {
    const base = { seed: 7, time: 3, reducedMotion: false } as const;
    expect(computePose({ ...base, state: 'thinking' }).dots).toBe(1);
    expect(computePose({ ...base, state: 'thinking' }).limbs).toEqual(limbsAtRest());
  });

  it('acts states out with its limbs and keeps its body', () => {
    const base = { seed: 7, time: 3, reducedMotion: false, rigged: true } as const;
    const thinking = computePose({ ...base, state: 'thinking' });
    expect(thinking.dots).toBe(0);
    expect(thinking.limbs.armR).toBeGreaterThan(60);
    expect(computePose({ ...base, state: 'blocked' }).bang).toBe(0);
    expect(computePose({ ...base, state: 'waiting' }).limbs.foreL).toBeLessThan(-60);
  });

  it('moves limbs smoothly: no jumps from frame to frame, in any state', () => {
    for (const state of ['idle', 'thinking', 'working', 'waiting', 'blocked', 'done'] as const) {
      let before = computePose({ seed: 11, time: 0, stateAge: 0, state, reducedMotion: false, rigged: true }).limbs;
      for (let t = 1 / 60; t < 30; t += 1 / 60) {
        const now = computePose({ seed: 11, time: t, stateAge: t, state, reducedMotion: false, rigged: true }).limbs;
        for (const key of Object.keys(now) as (keyof typeof now)[]) expect(Math.abs(now[key] - before[key]), `${state} ${key} at ${t.toFixed(2)}s`).toBeLessThan(9);
        before = now;
      }
    }
  });

  it('eases limbs between states', () => {
    const a = computePose({ seed: 3, time: 1, state: 'idle', reducedMotion: true, rigged: true });
    const b = computePose({ seed: 3, time: 1, state: 'blocked', reducedMotion: true, rigged: true });
    for (const key of Object.keys(a.limbs) as (keyof typeof a.limbs)[]) {
      expect(blendPoses(a, b, 0).limbs[key]).toBeCloseTo(a.limbs[key]);
      expect(blendPoses(a, b, 1).limbs[key]).toBeCloseTo(b.limbs[key]);
    }
    const early = blendPoses(a, b, 0.1).limbs.foreL - a.limbs.foreL, whole = b.limbs.foreL - a.limbs.foreL;
    expect(early / whole).toBeLessThan(0.02);
  });

  it('keeps its proportions: no deeper than natural, with a trunk flatter than it is wide', () => {
    expect(renderAvatarSvg(scout, { depth: 14, reducedMotion: true })).toBe(renderAvatarSvg(scout, { depth: 6, reducedMotion: true }));
    const { parts } = buildVolume(scout);
    const head = parts[0], torso = parts[2];
    expect(head.depth).toBeCloseTo(head.thickness, 0);
    expect(torso.depth).toBeLessThan(0.75 * (torso.bounds.maxX - torso.bounds.minX));
  });

  it('draws a different frame for each state, at rest too', () => {
    const still = (state: 'idle' | 'blocked') => renderAvatarSvg(scout, { state, reducedMotion: true });
    expect(still('idle')).not.toBe(still('blocked'));
    expect(avatarFrame(scout, { state: 'blocked', reducedMotion: true }).shapes.some((shape) => shape.kind === 'eye')).toBe(true);
  });
});

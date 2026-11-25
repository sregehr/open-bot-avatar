import { describe, expect, it } from 'vitest';
import { renderAvatarSvg } from 'open-bot-avatar';
import { AVATARS, SETS, eyeColorFor, getAvatar } from '../src/avatars.ts';
import { DOCEBO_IDS } from '../src/sets.ts';
import { defineDoceboAvatars } from '../src/elements.ts';

describe('Docebo avatars', () => {
  it('has a valid gallery definition for every id in the sets, each listed once', () => {
    expect(new Set(DOCEBO_IDS).size).toBe(DOCEBO_IDS.length);
    expect(AVATARS.map((a) => a.id)).toEqual(DOCEBO_IDS);
  });

  it('gives every avatar its set and a hex color', () => {
    for (const avatar of AVATARS) {
      expect(SETS.some((s) => s.id === avatar.set)).toBe(true);
      expect(avatar.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(getAvatar(avatar.id)).toBe(avatar);
    }
  });

  it('renders each one shaded', () => {
    for (const avatar of AVATARS) {
      const svg = renderAvatarSvg(avatar.definition, { color: avatar.color, shading: 1, depth: 10, shadow: true });
      expect(svg).toContain('<mask');
      expect(svg).toContain('<ellipse');
    }
  });

  it('picks light eyes for dark bodies only', () => {
    expect(eyeColorFor('#06065d')).toBe('#f6f5f2');
    expect(eyeColorFor('#e1dbd2')).toBe('#151515');
    expect(eyeColorFor('#7e2ee9')).toBe('#151515');
  });

  it('does nothing where there are no custom elements', () => {
    expect(() => defineDoceboAvatars(undefined)).not.toThrow();
  });
});

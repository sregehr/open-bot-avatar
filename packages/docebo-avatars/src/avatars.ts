import { validateAvatar, type AvatarDefinition } from 'open-bot-avatar';
import COLORS from '../../../gallery/colors.json';
import { DOCEBO_IDS, SETS, type AvatarSet } from './sets.ts';

const files = import.meta.glob<unknown>(['../../../gallery/*.json', '!../../../gallery/colors.json'], { eager: true, import: 'default' });

/** Docebo's stone neutral: avatars of this color are drawn as cast stone, with its grain. */
export const STONE = '#e1dbd2';
/** The body color an avatar gets when neither it nor the host names one: Docebo purple. */
export const DEFAULT_COLOR = '#7e2ee9';

export interface DoceboAvatar {
  id: string;
  name: string;
  /** The set it belongs to (see SETS). */
  set: string;
  /** Its own body color. */
  color: string;
  definition: AvatarDefinition;
}

const byId = new Map<string, DoceboAvatar>();
for (const [path, raw] of Object.entries(files)) {
  const id = path.slice(path.lastIndexOf('/') + 1, -'.json'.length);
  const set = SETS.find((s) => s.avatars.includes(id));
  if (!set) continue;
  const result = validateAvatar(raw);
  if (!result.ok) continue;
  byId.set(id, { id, name: result.value.name, set: set.id, color: (COLORS as Record<string, string>)[id] ?? DEFAULT_COLOR, definition: result.value });
}

/** Every Docebo avatar, in set order. */
export const AVATARS: DoceboAvatar[] = DOCEBO_IDS.flatMap((id) => byId.get(id) ?? []);

export function getAvatar(id: string | null | undefined): DoceboAvatar | undefined {
  return id ? byId.get(id) : undefined;
}

export { SETS, type AvatarSet };

const hex = (color: string): [number, number, number] | null => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
};

/** Near-black ink on light bodies, off-white on dark ones (navy, deep purple), so the eyes always read. */
export function eyeColorFor(color: string): string {
  const rgb = hex(color);
  if (!rgb) return '#151515';
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.09 ? '#f6f5f2' : '#151515';
}

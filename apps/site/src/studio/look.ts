import { resolveLook, type AvatarMood, type AvatarState } from "open-bot-avatar";
import DEFAULT_COLORS from "../../../../gallery/colors.json";

export type MotionPreference = "system" | "reduced" | "full";

export type MaterialName = 'flat' | 'fluffy' | 'glass';

export interface LookState {
  /** Colors picked for avatars, by library key; an avatar not in here shows its default color. */
  colors: Record<string, string>;
  /** The finish of every avatar on the site. */
  material: MaterialName;
  /** What the bot is doing, and how it feels. */
  state: AvatarState;
  mood: AvatarMood;
  followCursor: boolean;
  motionPreference: MotionPreference;
  /** Depth shading: the volume darkens toward the back, as if lit from the front. */
  shaded: boolean;
  /** How much volume avatars get. */
  volume: Volume;
}

export type Volume = "flat" | "natural" | "deep";

/** The renderer's `depth` for each volume setting (6 is the engine's natural depth). */
export const VOLUME_DEPTH: Record<Volume, number> = { flat: 0, natural: 6, deep: 10 };
/** The renderer's `shading` when it is on. */
export const SHADING = 1;

/** How strong the stone grain is on the avatars that have it. */
export const GRAIN = 0.85;

/** Docebo's stone neutral: the color of the Elemental avatars. */
export const STONE = "#e1dbd2";

/** An avatar whose own color is stone is cast stone: it gets its grain. */
export function isStone(id: string): boolean {
  return (DEFAULT_COLORS as Record<string, string>)[id] === STONE;
}

/** The renderer options a look's 3D settings stand for, for the avatar with this id. */
export function volumeOf(look: Pick<LookState, "shaded" | "volume">, id = ""): { depth: number; shading: number; grain: number; shadow: boolean } {
  return { depth: VOLUME_DEPTH[look.volume], shading: look.shaded ? SHADING : 0, grain: look.shaded && isStone(id) ? GRAIN : 0, shadow: look.shaded };
}

/** Docebo's purple: the color a new avatar of yours never falls back to gray for. */
export const SIGNATURE = "#7e2ee9";

/** Docebo's brand colors as body colors, in the order of the color bar. */
export const PALETTE = [
  { value: "#e1dbd2", name: "Stone" },
  { value: "#f6f5f2", name: "White" },
  { value: "#ff5dd8", name: "Pink" },
  { value: "#b627c6", name: "Magenta" },
  { value: SIGNATURE, name: "Purple" },
  { value: "#dcb7ff", name: "Lilac" },
  { value: "#2e8cff", name: "Blue" },
  { value: "#57beff", name: "Sky" },
  { value: "#54fa77", name: "Green" },
  { value: "#e3ffab", name: "Lime" },
  { value: "#807b74", name: "Gray" },
];

export const DEFAULT_LOOK: LookState = {
  colors: {},
  material: "flat",
  state: "idle",
  mood: "neutral",
  followCursor: true,
  motionPreference: "system",
  shaded: true,
  volume: "deep",
};

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Colors an avatar of yours can get by default: the palette without its quiet stone, white and gray. */
const BRIGHT = PALETTE.filter((s) => s.name !== "Stone" && s.name !== "White" && s.name !== "Gray").map((s) => s.value);

/**
 * An avatar's own color: the one gallery/colors.json gives it (every starter and gallery avatar has
 * one), or, for one of yours, a palette color picked from its id, so it stays the same everywhere.
 */
export function defaultColor(id: string): string {
  const listed = (DEFAULT_COLORS as Record<string, string>)[id];
  if (listed) return listed;
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return BRIGHT[hash % BRIGHT.length];
}

/** The color an avatar shows: the one picked for it, or its own. */
export function colorOf(look: Pick<LookState, "colors">, key: string, id: string): string {
  return look.colors[key] ?? defaultColor(id);
}

/** Pick a color for one avatar; picking its own color forgets the choice. */
export function withColor(look: LookState, key: string, id: string, color: string): LookState {
  const { [key]: _, ...colors } = look.colors;
  return { ...look, colors: color.toLowerCase() === defaultColor(id) ? colors : { ...colors, [key]: color.toLowerCase() } };
}

/** A material by name, from a stored look or a link. */
export function readMaterial(value: unknown): MaterialName | undefined {
  return value === "flat" || value === "fluffy" || value === "glass" ? value : undefined;
}

/** Revive a stored look; anything missing or invalid falls back to the default. */
export function reviveLook(raw: unknown): LookState | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  // `motion` is what a look saved before state and mood existed: idle, thinking or happy.
  const r = raw as Partial<Record<keyof LookState | "motion", unknown>>;
  const volume = r.volume === "flat" || r.volume === "natural" || r.volume === "deep" ? r.volume : DEFAULT_LOOK.volume;
  return {
    colors:
      r.colors && typeof r.colors === "object"
        ? Object.fromEntries(Object.entries(r.colors).flatMap(([key, value]) => (typeof value === "string" && HEX.test(value) ? [[key, value.toLowerCase()]] : [])))
        : {},
    material: readMaterial(r.material) ?? DEFAULT_LOOK.material,
    ...resolveLook({ state: r.state, mood: r.mood, motion: r.motion }),
    followCursor: typeof r.followCursor === "boolean" ? r.followCursor : true,
    motionPreference: r.motionPreference === "reduced" || r.motionPreference === "full" ? r.motionPreference : "system",
    shaded: typeof r.shaded === "boolean" ? r.shaded : DEFAULT_LOOK.shaded,
    volume,
  };
}

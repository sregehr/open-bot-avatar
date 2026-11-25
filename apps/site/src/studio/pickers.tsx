import type { MaterialName } from "./look";
/*
 * How the editor picks what the avatar is doing: one row of pills under the preview. Six are the
 * engine's states; the seventh, Happy, is its happy mood on an idle avatar. The engine keeps state
 * and mood apart (a host can ask for happy eyes on any state); the editor offers the one pairing
 * that looks different in the body as well as the eyes.
 *
 * The material is a toggle of faces in a corner of the preview.
 */
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { AvatarMood, AvatarState } from "open-bot-avatar";
import type { Choice } from "./ui";

/** A pill of the row: a state, or the happy mood. */
export type Expression = AvatarState | "happy";

export const EXPRESSIONS: Choice<Expression>[] = [
  { value: "idle", label: "Idle", hint: "Calm, looking around" },
  { value: "happy", label: "Happy", hint: "Hops, with smiling eyes" },
  { value: "thinking", label: "Thinking", hint: "Three dots, or chin in hand" },
  { value: "working", label: "Working", hint: "Busy, with ribbons sweeping round" },
  { value: "waiting", label: "Waiting", hint: "Leaning, eyes half-lidded" },
  { value: "blocked", label: "Blocked", hint: "An exclamation mark, or a shrug" },
  { value: "done", label: "Done", hint: "Spins inside a cage of ribbons, then rests" },
];

/** The state and mood a pill stands for. */
export function lookOf(expression: Expression): { state: AvatarState; mood: AvatarMood } {
  return expression === "happy" ? { state: "idle", mood: "happy" } : { state: expression, mood: "neutral" };
}

/**
 * The pill that shows for a state and mood. A link can open a pairing the row has no pill for
 * (happy eyes while working): its state's pill shows, and the next pick puts the mood back in step.
 */
export function expressionOf(state: AvatarState, mood: AvatarMood): Expression {
  return mood === "happy" && state === "idle" ? "happy" : state;
}

/* A radio group: one stop in the tab order, arrow keys (and Home/End) move the choice. */

interface RadioGroupProps<T extends string> {
  label: string;
  value: T;
  options: readonly Choice<T>[];
  onChange: (value: T) => void;
  className: string;
  itemClassName: string;
  /** The button's content; `live` is true for the choice that is picked, hovered or focused. */
  render?: (option: Choice<T>, live: boolean) => ReactNode;
  /** The content has no text: name each choice with an aria-label. */
  iconOnly?: boolean;
  /** Show each choice's hint as a tooltip. */
  tips?: boolean;
}

export function RadioGroup<T extends string>({ label, value, options, onChange, className, itemClassName, render, iconOnly, tips }: RadioGroupProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [hovered, setHovered] = useState<T | null>(null);
  const [focused, setFocused] = useState<T | null>(null);
  const onKey = (event: KeyboardEvent, index: number) => {
    const last = options.length - 1;
    const moves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowDown: index + 1,
      ArrowLeft: index - 1,
      ArrowUp: index - 1,
      Home: 0,
      End: last,
    };
    const to = moves[event.key];
    if (to === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const next = (to + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div className={className} role="radiogroup" aria-label={label}>
      {options.map((option, index) => {
        const checked = option.value === value;
        const live = checked || hovered === option.value || focused === option.value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={iconOnly ? option.label : undefined}
            aria-description={option.hint}
            data-tip={tips ? option.hint : iconOnly ? option.label : undefined}
            tabIndex={checked ? 0 : -1}
            className={checked ? `${itemClassName} is-on` : itemClassName}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKey(event, index)}
            onPointerEnter={() => setHovered(option.value)}
            onPointerLeave={() => setHovered((h) => (h === option.value ? null : h))}
            onFocus={() => setFocused(option.value)}
            onBlur={() => setFocused((f) => (f === option.value ? null : f))}
          >
            {render ? render(option, live) : option.label}
          </button>
        );
      })}
    </div>
  );
}

export function StatePills({ state, mood, onLook }: { state: AvatarState; mood: AvatarMood; onLook: (look: { state: AvatarState; mood: AvatarMood }) => void }) {
  return (
    <RadioGroup label="State" value={expressionOf(state, mood)} options={EXPRESSIONS} onChange={(expression) => onLook(lookOf(expression))} className="pills pills-states" itemClassName="pill" tips />
  );
}

/* The material as a toggle of faces: one smooth, one with fur standing off its edge, one of glass. */

const MATERIALS: Choice<MaterialName>[] = [
  { value: "flat", label: "Flat", hint: "Solid color" },
  { value: "fluffy", label: "Fluffy", hint: "Brushed fur" },
  { value: "glass", label: "Glass", hint: "Glossy glass" },
];

const SMOOTH_FACE = "M4 12a8 8 0 1 0 16 0a8 8 0 1 0-16 0ZM8.9 10.2a1 1 0 0 1 2 0v3.2a1 1 0 0 1-2 0ZM13.1 10.2a1 1 0 0 1 2 0v3.2a1 1 0 0 1-2 0Z";
/** A smaller face, so that with its fur it fills the same circle. */
const FURRY_FACE = "M5.7 12a6.3 6.3 0 1 0 12.6 0a6.3 6.3 0 1 0-12.6 0ZM9.1 10.3a.95.95 0 0 1 1.9 0v2.9a.95.95 0 0 1-1.9 0ZM13 10.3a.95.95 0 0 1 1.9 0v2.9a.95.95 0 0 1-1.9 0Z";
/** Hairs of uneven length and lean: evenly spaced ones read as a cog or a sun. */
const FUR =
  "M17.8 11.6 21.2 11M17.7 13.3 20.8 14.1M17.1 14.8 19.7 16.8M16.1 16.1 18.1 18.5M14.7 17.1 16 19.3M13.3 17.6 14.9 20.4M11.9 17.8 11.1 20.5M10.3 17.5 9.6 19.8M8.8 16.9 6.9 19.3M7.9 16.1 4.9 17.8M7 15 4.5 15.9M6.4 13.6 4.2 14.6M6.2 12.1 3.7 11.4M6.4 10.5 3.6 8.9M6.8 9.4 4.6 8.2M7.9 7.9 5.6 6.3M9.4 6.8 8.2 4.9M10.4 6.4 10.3 3.3M12 6.2 11.9 3.8M13.3 6.4 13.8 3.7M14.8 6.9 16.4 4.4M16 7.8 18.3 5.2M17.2 9.3 20 8.2M17.6 10.5 20.5 10.1";

function Face({ material }: { material: MaterialName }) {
  if (material === "glass") {
    return (
      <svg className="face-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path d="M8.1 8.3a5.4 5.4 0 0 1 4.6-1.7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <rect x="9" y="10.4" width="1.9" height="3.2" rx="0.95" fill="currentColor" />
        <rect x="13.1" y="10.4" width="1.9" height="3.2" rx="0.95" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg className="face-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={material === "fluffy" ? FURRY_FACE : SMOOTH_FACE} fill="currentColor" fillRule="evenodd" />
      {material === "fluffy" ? <path d={FUR} fill="none" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" /> : null}
    </svg>
  );
}

export function MaterialToggle({ material, onMaterial }: { material: MaterialName; onMaterial: (material: MaterialName) => void }) {
  return <RadioGroup label="Material" value={material} options={MATERIALS} onChange={onMaterial} className="face-segmented" itemClassName="face-option" iconOnly render={(o) => <Face material={o.value} />} />;
}

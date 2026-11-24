/*
 * How the editor picks what the avatar is doing: one row of pills under the preview. Six are the
 * engine's states; the seventh, Happy, is its happy mood on an idle avatar. The engine keeps state
 * and mood apart (a host can ask for happy eyes on any state); the editor offers the one pairing
 * that looks different in the body as well as the eyes.
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

function RadioGroup<T extends string>({ label, value, options, onChange, className, itemClassName, render, iconOnly, tips }: RadioGroupProps<T>) {
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

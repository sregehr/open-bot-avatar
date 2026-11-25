import { renderAvatarSvg, validateAvatar, type AvatarDefinition, type AvatarMood, type AvatarState } from 'open-bot-avatar';
import { mountAvatar, type AvatarOptions, type MountedAvatar } from 'open-bot-avatar/dom';
import { fluffy } from 'open-bot-avatar/materials/fluffy';
import { glass } from 'open-bot-avatar/materials/glass';
import { AVATARS, DEFAULT_COLOR, SETS, STONE, eyeColorFor, getAvatar, type DoceboAvatar } from './avatars.ts';

const STATES = ['idle', 'thinking', 'working', 'waiting', 'blocked', 'done'];
/** Volume and light of the Docebo look. `flat` turns them off. */
const DEPTH = 10;
const GRAIN = 0.85;

/**
 * What an avatar is made of, the `texture` attribute: `flat` is one plain color; `stone` is shaded
 * and speckled like cast stone; `furry` is a coat of fur; `glass` is clear glass. Without one the
 * avatar is shaded, and speckled only in Docebo's stone color.
 */
export const TEXTURES = ['flat', 'furry', 'stone', 'glass'] as const;
export type Texture = (typeof TEXTURES)[number];

const Base = (typeof HTMLElement === 'undefined' ? class {} : HTMLElement) as typeof HTMLElement;

/**
 * <docebo-agent-avatar avatar="tutor-agent" state="working" size="96"></docebo-agent-avatar>
 *
 * One live avatar. Attributes: avatar (an id from AVATARS), color, eye-color, state, mood, size
 * (CSS pixels, or style the element's width), follow-pointer, still, texture (flat, furry, stone or
 * glass), flat (the same as texture="flat"), label. A definition of
 * your own goes in the `definition` property.
 */
export class DoceboAgentAvatar extends Base {
  static observedAttributes = ['avatar', 'color', 'eye-color', 'state', 'mood', 'size', 'follow-pointer', 'still', 'flat', 'texture', 'label'];

  #host: HTMLDivElement;
  #mounted: MountedAvatar | null = null;
  #definition: AvatarDefinition | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>:host{display:inline-block;width:64px;aspect-ratio:1;vertical-align:middle}:host([hidden]){display:none}div{width:100%;height:100%}</style><div part="avatar"></div>';
    this.#host = root.querySelector('div') as HTMLDivElement;
  }

  /** A definition of your own (validated); it wins over the `avatar` attribute. Set null to go back. */
  get definition(): AvatarDefinition | null {
    return this.#definition;
  }
  set definition(value: unknown) {
    if (value == null) this.#definition = null;
    else {
      const result = validateAvatar(value);
      if (!result.ok) throw new Error(`Invalid avatar definition: ${result.errors.join('; ')}`);
      this.#definition = result.value;
    }
    this.#sync();
  }

  connectedCallback() {
    this.#sync();
  }

  disconnectedCallback() {
    this.#mounted?.destroy();
    this.#mounted = null;
  }

  attributeChangedCallback() {
    this.#sync();
  }

  #options(): AvatarOptions | null {
    const known = getAvatar(this.getAttribute('avatar'));
    const definition = this.#definition ?? known?.definition;
    if (!definition) return null;
    const color = this.getAttribute('color') || (this.#definition ? DEFAULT_COLOR : (known?.color ?? DEFAULT_COLOR));
    const named = (this.getAttribute('texture') ?? '').toLowerCase();
    const texture = this.hasAttribute('flat') ? 'flat' : named === 'fluffy' ? 'furry' : (TEXTURES as readonly string[]).includes(named) ? (named as Texture) : null;
    const flat = texture === 'flat';
    const state = this.getAttribute('state') ?? '';
    return {
      definition,
      color,
      eyeColor: this.getAttribute('eye-color') || eyeColorFor(color),
      state: (STATES.includes(state) ? state : 'idle') as AvatarState,
      mood: (this.getAttribute('mood') === 'happy' ? 'happy' : 'neutral') as AvatarMood,
      followPointer: this.hasAttribute('follow-pointer'),
      still: this.hasAttribute('still'),
      depth: flat ? undefined : DEPTH,
      shading: flat ? 0 : 1,
      // A material brings its own surface: fur and glass need WebGL2, and are drawn shaded where there is none.
      material: texture === 'furry' ? fluffy : texture === 'glass' ? glass : 'flat',
      grain: texture === 'stone' || (texture === null && color.toLowerCase() === STONE) ? GRAIN : 0,
      shadow: !flat,
      label: this.getAttribute('label') ?? undefined,
    };
  }

  #sync() {
    const size = this.getAttribute('size');
    this.style.width = size ? (/^\d+(\.\d+)?$/.test(size) ? `${size}px` : size) : '';
    if (!this.isConnected) return;
    const options = this.#options();
    if (!options) {
      this.#mounted?.destroy();
      this.#mounted = null;
      this.#host.textContent = '';
      return;
    }
    if (this.#mounted) this.#mounted.update(options);
    else this.#mounted = mountAvatar(this.#host, options);
  }
}

const PICKER_CSS = `
:host{display:block;font:500 14px/1.3 var(--docebo-avatars-font,Figtree,ui-sans-serif,system-ui,sans-serif);color:var(--docebo-avatars-text,#2a2923);--accent:var(--docebo-avatars-accent,#7e2ee9)}
:host([hidden]){display:none}
*{box-sizing:border-box}
.tabs{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}
.tab{font:inherit;color:inherit;cursor:pointer;border:1px solid var(--docebo-avatars-line,#e1dbd2);background:transparent;border-radius:999px;padding:6px 14px}
.tab[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:#fff}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(var(--docebo-avatars-cell,64px),1fr));gap:8px;margin:0;padding:0;list-style:none}
.cell{display:block;width:100%;aspect-ratio:1;padding:8px;cursor:pointer;border:2px solid transparent;border-radius:16px;background:var(--docebo-avatars-cell-bg,#f6f5f2);transition:transform .12s ease,border-color .12s ease}
.cell:hover{transform:translateY(-2px)}
.cell[aria-pressed=true]{border-color:var(--accent);background:var(--docebo-avatars-cell-on,#f1e5ff)}
.cell svg{display:block;width:100%;height:100%;overflow:visible}
.tab:focus-visible,.cell:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){.cell{transition:none}.cell:hover{transform:none}}
`;

export interface AvatarChangeDetail {
  id: string;
  name: string;
  color: string;
  definition: AvatarDefinition;
}

/**
 * <docebo-avatar-picker value="tutor-agent"></docebo-avatar-picker>
 *
 * A grid of the Docebo avatars with a tab per set. Attributes: value (the picked id), set (show one
 * set only, without tabs: agents, characters, elemental or objects). Fires `change` with
 * { id, name, color, definition } in `detail` when the user picks one.
 */
export class DoceboAvatarPicker extends Base {
  static observedAttributes = ['value', 'set'];

  #root: ShadowRoot;
  #tab = SETS[0].id;
  #stills = new Map<string, string>();

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: 'open' });
    this.#root.addEventListener('click', (event) => {
      const button = (event.target as Element).closest('button');
      if (!button) return;
      const tab = button.getAttribute('data-tab'), id = button.getAttribute('data-id');
      if (tab) {
        this.#tab = tab;
        this.#render();
        (this.#root.querySelector(`[data-tab="${tab}"]`) as HTMLElement | null)?.focus();
      } else if (id) this.#pick(id);
    });
  }

  get value(): string {
    return this.getAttribute('value') ?? '';
  }
  set value(id: string) {
    this.setAttribute('value', id);
  }

  connectedCallback() {
    const picked = getAvatar(this.value);
    if (picked) this.#tab = picked.set;
    this.#render();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.#render();
  }

  #pick(id: string) {
    const avatar = getAvatar(id);
    if (!avatar || id === this.value) return;
    this.setAttribute('value', id);
    const detail: AvatarChangeDetail = { id, name: avatar.name, color: avatar.color, definition: avatar.definition };
    this.dispatchEvent(new CustomEvent('change', { detail, bubbles: true, composed: true }));
    (this.#root.querySelector(`[data-id="${id}"]`) as HTMLElement | null)?.focus();
  }

  #still(avatar: DoceboAvatar): string {
    let svg = this.#stills.get(avatar.id);
    if (!svg) {
      svg = renderAvatarSvg(avatar.definition, { color: avatar.color, eyeColor: eyeColorFor(avatar.color), depth: DEPTH, shading: 1, reducedMotion: true, gaze: { x: 0, y: 0 } });
      this.#stills.set(avatar.id, svg);
    }
    return svg;
  }

  #render() {
    const only = SETS.find((s) => s.id === this.getAttribute('set'));
    const set = only ?? SETS.find((s) => s.id === this.#tab) ?? SETS[0];
    const tabs = only
      ? ''
      : `<div class="tabs" role="group" aria-label="Avatar sets">${SETS.map((s) => `<button type="button" class="tab" data-tab="${s.id}" aria-pressed="${s.id === set.id}">${s.label}</button>`).join('')}</div>`;
    const cells = AVATARS.filter((a) => a.set === set.id)
      .map((a) => `<li><button type="button" class="cell" data-id="${a.id}" aria-pressed="${a.id === this.value}" aria-label="${a.name}" title="${a.name}">${this.#still(a)}</button></li>`)
      .join('');
    this.#root.innerHTML = `<style>${PICKER_CSS}</style>${tabs}<ul class="grid" aria-label="${set.label} avatars">${cells}</ul>`;
  }
}

/** Register both elements. Safe to call more than once, and where there is no DOM. */
export function defineDoceboAvatars(registry: CustomElementRegistry | undefined = typeof customElements === 'undefined' ? undefined : customElements) {
  if (!registry) return;
  if (!registry.get('docebo-agent-avatar')) registry.define('docebo-agent-avatar', DoceboAgentAvatar);
  if (!registry.get('docebo-avatar-picker')) registry.define('docebo-avatar-picker', DoceboAvatarPicker);
}

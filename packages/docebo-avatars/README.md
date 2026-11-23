# docebo-agent-avatars

Docebo's agent avatars as a micro front end: two custom elements and a small API in one
dependency-free file, built on the [Open Bot Avatar](../core) renderer.

```html
<script type="module" src="docebo-agent-avatars.js"></script>

<docebo-agent-avatar avatar="tutor-agent" state="working" size="64"></docebo-agent-avatar>
<docebo-avatar-picker value="tutor-agent"></docebo-avatar-picker>
```

Loading the file registers both elements. Each renders in its own shadow root, so the host's styles
and the elements' styles do not leak into each other.

## Build

```sh
pnpm --filter docebo-agent-avatars build   # dist/docebo-agent-avatars.js (ES module) and .iife.js (global DoceboAvatars)
pnpm --filter docebo-agent-avatars dev     # the demo host page (index.html), from source
```

## `<docebo-agent-avatar>`

One live avatar: it idles, blinks and changes state smoothly.

| Attribute | |
| --- | --- |
| `avatar` | An avatar id (see `AVATARS`), such as `tutor-agent`, `buddy-cube` or `elemental-gem`. |
| `color`, `eye-color` | `#rgb` or `#rrggbb`. Default: the avatar's own color; eyes turn light on dark bodies. |
| `state` | `idle` (default), `thinking`, `working`, `waiting`, `blocked` or `done`. |
| `mood` | `neutral` (default) or `happy`. |
| `size` | Width in CSS pixels, or any CSS length. Default 64px; the element is square. You can also set its width in CSS. |
| `follow-pointer` | Look toward the pointer. |
| `still` | One static SVG, no animation: for long lists. |
| `flat` | One flat color, no shading, grain or shadow. |
| `label` | Accessible name. Default: the avatar's name; `""` marks it decorative. |

A definition of your own goes in the `definition` property (it is validated, and wins over `avatar`).

## `<docebo-avatar-picker>`

A grid of the avatars with a tab per set (Agents, Characters, Elemental, Objects).

| Attribute | |
| --- | --- |
| `value` | The picked avatar's id. |
| `set` | Show one set only, without tabs: `agents`, `characters`, `elemental` or `objects`. |

It fires `change` (bubbling, composed) with `detail: { id, name, color, definition }`. Theme it with
`--docebo-avatars-accent`, `--docebo-avatars-font`, `--docebo-avatars-text`, `--docebo-avatars-line`,
`--docebo-avatars-cell` (cell size), `--docebo-avatars-cell-bg` and `--docebo-avatars-cell-on`.

## In Angular

Add `CUSTOM_ELEMENTS_SCHEMA` to the component (or module) that uses the elements and load the file
once, for example from `main.ts`:

```ts
import 'docebo-agent-avatars';

@Component({
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <docebo-agent-avatar [attr.avatar]="agent.avatar" [attr.state]="agent.state" size="48"></docebo-agent-avatar>
    <docebo-avatar-picker [attr.value]="agent.avatar" (change)="agent.avatar = $any($event).detail.id"></docebo-avatar-picker>
  `,
})
```

## From code

```ts
import { AVATARS, SETS, getAvatar, mountAvatar, renderAvatarSvg } from 'docebo-agent-avatars';
```

`AVATARS` lists every avatar (`{ id, name, set, color, definition }`), `SETS` the sets in order, and
`mountAvatar` / `renderAvatarSvg` are the renderer's own functions (see the repository README).

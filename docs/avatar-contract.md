# Avatar definition contract — v1

An avatar definition contains geometry only. The runtime controls color, inferred volume, view, gaze, blinking and animation. Definitions do not contain raster images. Use recognizable, soft, minimal object silhouettes with two eyes that remain readable at sidebar size.

```json
{
  "version": 1,
  "id": "controller",
  "name": "Controller",
  "body": { "path": "M ... Z" },
  "eyes": { "x": 50, "y": 46, "spacing": 15, "scale": 1 }
}
```

- Coordinates use a fixed `0 0 100 100` viewBox.
- `body.path` is one monochrome filled SVG path (several closed subpaths allowed, nonzero fill rule; holes wind opposite to their outline). Keep it roughly within 8..92 so there is room for turning and motion. No embedded SVG markup, scripts, external assets, colors or animation.
- `eyes`: `x`/`y` are the center of the pair, `spacing` is center to center, and `scale` 1 means each neutral eye is about 4 units wide and 11 tall. Validation uses that size; the renderer draws eyes up to 1.45× larger where the body has room (every drawn eye shape keeps 3 units from the outline). Eyes must sit visibly inside the body.
- `id` is a lowercase slug, `name` a short display name. Unknown fields are rejected; `rig` is the one optional field (below).

## Rig (optional)

A character with limbs can add `rig`: a list of joints, each naming one outline of `body.path` and the point it turns about.

```json
"rig": [
  { "part": 0, "role": "head", "x": 50, "y": 37 },
  { "part": 3, "role": "arm-l", "x": 36, "y": 48.5 },
  { "part": 4, "role": "forearm-l", "x": 30.5, "y": 59 }
]
```

- `part` is the index of an outline in `body.path`, in path order, not counting holes. Each part has at most one joint; parts without one (the torso) stay put. At most 24 joints.
- `role` is one of `head`, `arm-l`, `arm-r`, `forearm-l`, `forearm-r`, `leg-l`, `leg-r`, `shin-l`, `shin-r` (`-l` and `-r` are the left and right of the screen). A forearm moves with the arm of its side and a shin with the leg. Several parts may share a role: a hand takes its forearm's role and joint, a hat the head's.
- `x`, `y` is the joint, in viewBox units. Draw limbs hanging down at rest.

A rigged avatar acts its states out with its body (a hand at its temple while thinking, a shrug when blocked) and keeps its body where other avatars give way to the thinking dots or the blocked mark. The canvas and SVG renderers move the limbs; the CSS scene renderer draws them at rest.

Before rendering imported definitions, call `validateAvatar`. It returns `{ ok: true, value }` with the normalized definition or `{ ok: false, errors }` with validation errors.

## Strict targets for generated avatars

`validate.sh --strict` (and the gallery check in CI) also requires:

- Face room: the face-bearing part is the dominant mass, and the enlarged eyes keep 4.5 units of clearance at rest and at full gaze travel.
- No silhouette seams: no small sudden steps (0.3–2.5 units) in the outer outline where parts meet. Each join should be a clear step or a smooth, flush continuation.

Valid v1 definitions that do not meet these targets still import and render. The renderer reduces eye enlargement or gaze travel when space is limited.

## The design prompt

The canonical, model-neutral design prompt is [skills/generate-avatar/references/system-prompt.md](../skills/generate-avatar/references/system-prompt.md): schema, geometry rules, face-first proportions and reference examples (kept equal to the engine's examples by tests). The editor includes it in copied generation and repair prompts. Agent-app links reference the hosted prompt. The optional `generate-avatar` skill adds a local validation loop.

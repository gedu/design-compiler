# 07 Validator and diagnostic catalog

The validator runs before extraction and again on the IR. Its job is to make failure cheap. A
converter that guesses produces code that has to be read line by line, which costs more than
writing it by hand; a converter that refuses costs one line of output.

Severity decides what happens:

- **error**: the run stops for that target, no file written. The contract was broken.
- **warn**: the target emits, the emitted code carries an inline comment naming the code, and the
  run report lists it.
- **info**: report only.

## Contract violations (errors)

| Code | Detect | Fix hint |
| --- | --- | --- |
| tokens-missing | no token file at the declared path | export the tokens alongside the frames |
| tokens-incomplete-scheme | one scheme missing, or a role present in light and absent in dark | regenerate both schemes from the same seed |
| tokens-role-name-invalid | a role name that is not camelCase or not in the known role set | rename it to the Material role name |
| color-literal | a hex in the CSS outside the token block | reference the custom property |
| color-unresolved | a computed color that is no role in either scheme | it is an invented color; pick an existing role or add it to the system deliberately |
| color-alpha-of-role | a role color used with alpha, or via \`color-mix()\` | use the container or fixed role the design meant |
| css-external | a \`<link rel=stylesheet>\` or an \`@import\` | inline the CSS into the file |
| remote-resource | any network request attempted with the network blocked | inline the asset or replace it with a placeholder |
| webfont-remote | an \`@font-face\` with a remote src | use the platform font stack |
| icon-font | an icon drawn from a font glyph | replace with inline SVG |
| js-dependent-paint | the frame renders differently with JavaScript disabled | render the first paint statically |
| dark-only-via-js | dark theme unreachable through \`prefers-color-scheme\` | add the media query |
| absolute-layout | \`position: absolute\` or \`fixed\` on an element with siblings that are not its own overlay | use flex or grid |
| viewport-units | \`vh\`, \`vw\`, \`dvh\`, \`svh\`, \`vmin\`, \`vmax\` in a layout property | use a fixed px width for the frame |
| animation-required | a state only reachable through an animation or a transition end | render each state as its own markup |
| pseudo-content | \`::before\` or \`::after\` carrying text or an icon | make it a real node |
| frame-width-unknown | the manifest has no width for this frame | declare it; the capture viewport depends on it |
| lorem-ipsum | placeholder copy detected | use the real strings |
| reflow-detected | the layout changed between the declared width and the capture width | fix the width and re-export |
| ir-schema-mismatch | an IR file whose major version the emitter does not support | regenerate the IR or upgrade the emitter; never read it anyway |

## Degradations (warnings)

| Code | Detect | Emission |
| --- | --- | --- |
| component-unlabeled | repeated structure without \`data-component\` | name derived from the structure, said out loud in the file header |
| component-name-invalid | a \`data-component\` value that is not a valid identifier after camelCase | keep the derived name and list it in the rename report |
| state-variation-unstable | instances of one component differ structurally, not only in values | every difference becomes a parameter or a conditional, and the group is listed for review |
| elevation-missing | a visible shadow with no \`data-elevation\` | no elevation emitted; comment says the design showed a shadow the converter cannot map |
| elevation-off-ladder | \`data-elevation\` outside 0, 1, 3, 6, 8, 12 | error if it cannot be snapped within a hair, warn if it can, and say which it did |
| radius-off-ladder | a radius between shape steps | emit the raw dp with a comment, or the nearest step if config says snap |
| radius-per-corner-in-card | per-corner radii inside a component that takes one shape | flatten to the shared shape and flag the visual delta |
| style-off-scale | text matching no type role | \`typography.<closest>.copy(...)\` with the diff visible |
| weight-without-font | a weight above 400 with no bundled font | comment: renders as regular on iOS |
| clip-missing | a rounded container with a backgrounded descendant and no \`overflow: hidden\` in the source | emit \`Modifier.clip(shape)\` anyway and note the assumption |
| box-model-border-padding | both border and padding on one node | emit the canonical order, comment the choice |
| margin-collapse-applied | collapsed margins converted to a single spacing value | comment showing the CSS original |
| gap-both-axes | asymmetric \`row-gap\` and \`column-gap\` on a single-axis container | use the larger value or nest, per config, and say which |
| grid-column-count-fixed | CSS Grid reduced to a fixed column count for a target with no grid | comment naming the captured width that produced N |
| grid-min-undeclared | a grid with no \`data-grid-min\` | derive from the captured track width, comment that it is measured not authored |
| scroll-undeclared | a scrollable region with no \`data-scroll\` | emit the scroll modifier, warn that laziness was not requested |
| callback-inferred | a clickable with no \`data-action\` or label | emit the callback with a TODO on its name |
| icon-vector-inline | an inline SVG emitted as generated paths from the input's own path data because no icon library is configured | info if the set is small, warn above about ten glyphs |
| icon-name-assumed | a glyph font icon whose \`data-icon\` name was matched to a standard symbol, but the library is absent in the target project | emit the reference with a comment naming the dependency to add; never fabricate path data |
| icon-unnamed | a glyph font icon with no \`data-icon\`: nothing to look the asset up by | placeholder box at the measured size, literal glyph in a comment, \`// TODO: icon asset\` |
| shadow-translated | a target that cannot express tonal elevation and got a real shadow instead | comment naming the strategy chosen |
| safe-area-baked | an inset-looking padding baked into a style on a target without insets | emit the hook, never the number |
| fixed-size-on-text | a fixed height on a text-bearing node | drop it, comment that font scaling would break it |
| text-transform-baked | uppercase baked into the string | comment: the source string is now the display string |
| skeleton-invented | a skeleton loader with no M3 equivalent | emit the real component with placeholder content and a comment |
| tooltip-needs-state | a tooltip that cannot exist without state | comment only, do not emit |
| theme-two-schemes | dark emitted as a second scheme where a mode was expected | normal on Compose and RN; report so the design handoff matches the code |
| preview-needs-inspection-guard | preview-only code that would run at runtime | wrap in \`LocalInspectionMode\` |

## Report shape

One machine file and one human file. Machine first, because the next agent reads it.

~~~json
{
  "run": { "input": "...", "targets": ["compose"], "irSchema": "design-ir/1", "durationMs": 1200 },
  "summary": { "errors": 0, "warnings": 6, "infos": 2 },
  "diagnostics": [ { "code": "...", "severity": "warn", "node": "...", "file": "...", "message": "...", "fix": "..." } ],
  "emitted": [ { "path": "ui/PodcastCard.kt", "component": "PodcastCard", "lines": 62, "diagnostics": ["clip-missing"] } ],
  "refused": [ { "target": "react-native", "reason": "grid-column-count-fixed requires a numColumns decision", "options": ["FlatList numColumns=4", "FlashList", "flexWrap"] } ],
  "todoMarkers": 11,
  "risk": "medium"
}
~~~

\`refused\` is the most useful field in the report. It names a decision, gives options, and stops. It
is never a silent default.

## Second-pass validation

Validate the IR after extraction, not only the input:

- A node with \`flex: 1\` that is not a direct child of a flex parent in the emitted tree: error,
  because it will silently not work.
- A backgrounded node inside a rounded container without a shape: warn.
- Two \`ComponentGroup\`s with identical signatures and different names: warn, probably one component.
- A parameter list above about six entries: info, the component is too big.
- An emitted line count above about 250 for one component: info, split it.
- Any literal color in an emitted file: error. The token file is the only source of color.
\`\`\`

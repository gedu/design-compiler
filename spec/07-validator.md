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
| js-dependent-paint | the frame renders differently with JavaScript disabled | render the first paint statically |
| dark-only-via-js | dark theme unreachable through \`prefers-color-scheme\` | add the media query |
| absolute-layout | \`position: absolute\` or \`fixed\` on an element with siblings that are not its own overlay | use flex or grid |
| viewport-units | \`vh\`, \`vw\`, \`dvh\`, \`svh\`, \`vmin\`, \`vmax\` in a layout property | use a fixed px width for the frame |
| animation-required | a state only reachable through an animation or a transition end | render each state as its own markup |
| pseudo-content | \`::before\` or \`::after\` carrying text or an icon | make it a real node |
| frame-width-unknown | the manifest has no width for this frame | declare it; the capture viewport depends on it |
| manifest-incomplete | the manifest names no states for a frame, or omits the design system or the seed it claims a palette came from | declare the design system, the seed and the states of every frame |
| lorem-ipsum | placeholder copy detected | use the real strings |
| reflow-detected | the layout changed between the declared width and the capture width | fix the width and re-export |
| ir-schema-mismatch | an IR file whose major version the emitter does not support | regenerate the IR or upgrade the emitter; never read it anyway |

## Degradations (warnings)

| Code | Detect | Emission |
| --- | --- | --- |
| icon-font | an icon drawn from a font glyph instead of inline SVG | reference the icon by \`data-icon\` name with a \`// TODO: icon asset\` marker; the converter never authors path data |
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
| prop-undeclared | text that differs between instances of one component but carries no \`data-prop\` and has no \`data-props\` schema entry | add \`data-prop="<name>"\` to the varying text, or declare it in the prop schema |
| brief-missing | no decisions brief at the configured path, so invented values stay invisible | add the brief listing decisions and invented values |
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

## Where this catalog stands against a real export

The contract codes in the two tables above are the ones \`rules/contract-rules.json\` references; three of
them (\`manifest-incomplete\`, \`brief-missing\`, \`prop-undeclared\`) are added here in the same change that
added their rows, and no row of the table points at a code that is not in this catalog. That pairing
is the maintenance rule: a row may not invent a code, and a code may not exist without a row that
makes it fire. What a check has never been able to satisfy is not a passing check, it is an untested
one, and task T4 is what turns these rows from intent into evidence.

Severity is decided here, not in the rule table, and the icon family is \`warn\` on purpose: the current
export draws every icon from \`Material Symbols Outlined\` (\`icon-font\` moved out of the error table for
that reason), and an error would block a design that is otherwise compilable.

Seventeen codes have **no reachable positive case yet**: no rule row that a design tool can actually
write measures \`present\` for them on \`fixtures/reference\`. A \`present\` that only a \`runtime\` row can
produce does not count as a positive case for a contract code, because it proves the runtime emitted
something, not that the contract can be satisfied. Treat these checks as untested, not as passing:

| Code | Why it is untested rather than passing |
| --- | --- |
| component-unlabeled | 0 \`data-component\` anywhere in the export, so the detector only ever takes its degradation path and its silent-success path has never run |
| dark-only-via-js | \`@media (prefers-color-scheme: dark)\` appears 0 times in the templates and in \`tokens.css\`; dark reaches the page through a class and \`?theme=dark\` |
| elevation-missing | no \`data-elevation\` and no \`box-shadow\` in the export, so neither the hit nor the clean case has been observed |
| grid-min-undeclared | grids exist (\`display: grid\` in \`Home.dc.html\` and \`Mini Jetcaster.dc.html\`) and carry no \`data-grid-min\`, so only the failure side is exercised |
| icon-font, icon-unnamed | 0 inline \`<svg>\`, 17 glyph-font spans, 0 \`data-icon\`: the warn fires, but no conforming icon has ever passed it |
| absolute-layout | \`position: absolute\` occurs twice, neither a declared overlay, so the rule's allowed case is unproven |
| remote-resource | 10 remote URLs across 5 templates; the check has only ever seen failures, and the vendor lock is what makes a clean run possible |
| scroll-undeclared, state-variation-unstable, style-off-scale | the signals they compare (\`data-scroll\`, \`data-state\`, a type-role match against \`tokens.json\`) have no annotated input to compare against yet |
| component-name-invalid | no \`data-component\` value exists to validate, only the frame ids of the board, so both the accept and the reject path are unwritten |
| prop-undeclared | text varies between instances through \`{{ }}\` placeholders, which the prop schema already names; the unmarked-literal case it targets has not been seen yet |
| css-external, animation-required, frame-width-unknown, reflow-detected | each is \`violated\` on every author or tool-behavior row behind it, and the only \`present\` measurement comes from a runtime row (\`helmet\`, \`style-*\`, \`dc-import\`, \`?frame=\`), which is a workaround the pipeline uses, not a passing export |
| js-dependent-paint, callback-inferred | excluded from the count above: they are reached by runtime rows (\`placeholder-syntax\`, \`x-dc\`, \`prop-schema-declared\`) whose \`measured\` value only reports that the runtime emits the mechanism, so neither code has a writable row to prove it can pass |

Every other writable contract code (11 of them: \`brief-missing\`, \`clip-missing\`, \`color-alpha-of-role\`,
\`color-literal\`, \`lorem-ipsum\`, \`manifest-incomplete\`, \`pseudo-content\`, \`tokens-incomplete-scheme\`,
\`tokens-missing\`, \`viewport-units\`, \`webfont-remote\`) has at least one writable rule row measured
\`present\` on the export, so the input can already satisfy it and the check can be seen declining to
fire. That is the distinction this section exists to keep honest: 11 contract codes have been seen
saying "fine", 17 have only ever complained, and a check that has only complained has never been shown
to be able to pass.

Two groups of codes are deliberately outside the \`rules/contract-rules.json\` table, and their absence is
not drift: \`tokens-role-name-invalid\` and \`color-unresolved\` are token-file and extraction lookups rather
than something a design tool writes, and everything emission-side (\`radius-off-ladder\`,
\`radius-per-corner-in-card\`, \`box-model-border-padding\`, \`margin-collapse-applied\`, \`gap-both-axes\`,
\`grid-column-count-fixed\`, \`icon-vector-inline\`, \`icon-name-assumed\`, \`shadow-translated\`,
\`safe-area-baked\`, \`fixed-size-on-text\`, \`text-transform-baked\`, \`skeleton-invented\`,
\`weight-without-font\`,
\`tooltip-needs-state\`, \`theme-two-schemes\`, \`preview-needs-inspection-guard\`, \`elevation-off-ladder\`,
\`ir-schema-mismatch\`) describes what an emitter did with a node, or what the target project can or
cannot supply, a fact no input file can state. \`weight-without-font\` is in that group because spotting
a weight above regular is easy in the input and pointless there: it only matters once a target's
bundled fonts are known, which is target configuration, not design. Those
codes are set by an emitter or by second-pass IR validation, not by a contract row.

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

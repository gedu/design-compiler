# Corner cases, flat catalog

The list to work through when a run produces something wrong. Format: what breaks, why, and the
resolution the emitter must apply. Most of the pain in this project is here, and most of it is
one-time.

## Geometry

| Case | Why it bites | Resolution |
| --- | --- | --- |
| Rounded card with a square child background | CSS clips children, Compose does not | propagate the parent shape as a parameter and \`Modifier.clip\` the child; never rely on the parent |
| Two overlapping items in a CSS grid cell | no such thing in flex; Compose needs a Box | a Box with explicit alignment, and a warning that the design is using grid stacking, which is not portable |
| \`position: sticky\` header inside a scrollable | Compose needs \`pinnedItems\` in a LazyColumn, RN needs \`stickyHeaderIndices\` | map when the region is a list, otherwise refuse; never emit a fixed offset |
| Negative margin used to overlap | no Compose or RN equivalent without a Box and a negative offset that fights measurement | refuse; a design that overlaps by negative margin is a graphic-design decision, not a layout |
| \`gap\` plus \`margin\` on children | double spacing in Compose since margins do not collapse | drop child margins in favor of \`spacedBy\`, report the original numbers |
| \`height: 100%\` of an auto parent | resolves against a parent that has no height in Compose | replace with \`fillMaxHeight\` only inside a bounded parent, else drop it and warn |
| \`min-height\` on a scroll container | in Compose this must be on the viewport, not the content | put \`heightIn\` on the container node, not the list |
| Centering by \`margin: auto\` | no Compose equivalent | \`Alignment.Center\` on the parent, or \`Modifier.align\`; report the change |
| \`aspect-ratio\` plus explicit height | they disagree | keep the ratio, drop the height, report the conflict |
| Border-radius larger than half the height | CSS clamps, Compose does not always look the same | clamp to half the smaller side and note it |
| Divider drawn with \`border-bottom\` on a row | it becomes a border on a Compose node, which draws around all four sides | emit \`HorizontalDivider\` after the item instead |
| 1px lines on Android | 1dp is not 1 device pixel; RN has \`hairlineWidth\`, Compose has no such helper | use 1.dp in Compose and hairlineWidth in RN, and comment the intent |

## Color and theme

| Case | Why it bites | Resolution |
| --- | --- | --- |
| Design color is a role with alpha | maps to no Compose property and breaks dark | error; name the role the design probably meant |
| Two roles resolve to the same hex in one scheme | reverse lookup is ambiguous | prefer the custom property name when present; if only the hex is available and two roles collide, emit the one the property said, else the first in a fixed documented order, and warn |
| \`oklch\` or \`oklab\` computed color | must convert to sRGB before lookup | convert, then compare with a tolerance of one unit per channel; log the conversion when the source was not sRGB |
| Outline drawn with a shadow instead of a border | will become elevation | check \`box-shadow\` spread against radius: a shadow with no offset and no blur is a hairline; treat as outline |
| Elevation drawn as a real black shadow | Android renders tonal surfaces, so a black shadow reads as a bug | \`data-elevation\` only; the shadow is dropped and reported |
| Dark scheme missing a role that light has | surfaces vanish in dark | error at token validation, not at emission |
| Surface container tiers used inconsistently across light and dark | the design works in light and falls apart in dark | per-role diff of the two captures, reported as region-emphasis-mismatch (info) |
| Contrast looks too low but the roles match | roles came from the generator, so it is the design's problem, not the converter's | info, and explicitly do not fix it |
| Brand color that is not in the palette at all | the design went off-system | \`color-unresolved\` error; the fix is a design decision |
| Dynamic color expectation | desktop cannot do it, \`commonMain\` cannot call it | static scheme is the design of record; dynamic stays Android-only behind expect/actual |

## Typography

| Case | Why it bites | Resolution |
| --- | --- | --- |
| 16/24/500 vs 16/24/400 | \`titleMedium\` and \`bodyLarge\` share size and line height | match on size plus line height plus weight; weight decides the role |
| 14/20 collisions | \`titleSmall\`, \`bodyMedium\` and \`labelLarge\` all sit at 14/20 | same triple match, then tracking as tiebreaker, then prefer the role the design's own notes gave |
| Browser letter-spacing rounding | 0.2px may arrive as 0.198 or 0.204 | tolerance, never equality |
| Brand font in the design, no font bundled | Compose silently falls back and metrics change | \`font-family-without-font\` warning on every affected node; the fix is a decision, not a code change |
| Font scaling on device | fixed heights derived from text break at 1.3x | drop text-derived heights; keep \`sp\` and let layout grow |
| Multi-line with different styles inline | Compose needs \`AnnotatedString\`, RN needs nested \`<Text>\` | emit nested when the run is short, otherwise one \`Text\` plus a TODO; never silently flatten to one style |
| Ellipsis on a flex-shrunk sibling | Compose truncates the wrong child without \`weight(1f, fill = false)\` | the flexible text child gets \`weight(1f)\` before its sibling gets a fixed size |
| Tabular numbers for durations and prices | digits shift as content changes | \`fontFeatureSettings = "tnum"\` when the design shows aligned numbers, else leave it |
| Uppercase labels | Compose has no text-transform | bake the string and comment it |

## Structure

| Case | Why it bites | Resolution |
| --- | --- | --- |
| Twelve near-identical cards | either one component with parameters, or twelve components | group by signature; a single difference in structure becomes a parameter or a conditional, never a duplicate component |
| The same component at two breakpoints | two files for one component | match by \`data-component\` across width classes and emit **one** component with a width-class parameter; a breakpoint that changes structure needs an explicit parameter, not an internal \`if (width > x)\`, because Compose adapts through modifiers |
| A frame that is a state, not a screen | generated as a second screen | \`data-state\` merges it into the base component's parameter list |
| Empty state and error state as separate frames | three screens | one component with a \`state\` enum parameter, since the app already has a UiState in this shape |
| Skeleton screen | no M3 equivalent | real component with placeholder content, alpha variant if the design used gray blocks, plus a comment |
| A region that is a \`Scaffold\` slot | emitted as a Column child | \`data-region\` maps to \`topBar\` / \`bottomBar\` / \`snackbarHost\`; a bottom bar as a Column child is wrong because it will not reserve space |
| Grid that becomes a list at narrow width | two unrelated components | one component, grid versus list chosen by configuration, not by an internal breakpoint |
| A wrapper that exists only for the CSS grid | noise in the output | reduce, but only when it has no \`data-*\`, no gap and no flex-grow |
| Deep single-child chains | 8 nested Views for one label | collapse chains of single-child no-style nodes to one node |
| Icon-only button with an \`aria-label\` | content description lost | use the label as the \`contentDescription\` argument, and never leave it null on a control |

## Targets

| Case | Target | Resolution |
| --- | --- | --- |
| CSS Grid | RN | no Yoga equivalent: fixed \`numColumns\` with a comment, or flexWrap, chosen in configuration |
| Safe area insets | RN | \`useSafeAreaInsets\`, never a baked number |
| \`backdrop-filter\`, blur | both | refuse; needs a dependency and is a design decision |
| \`mix-blend-mode\` | both | refuse |
| Hover states | RN native | no equivalent on touch; emit the base and a comment |
| Keyboard focus ring | Compose desktop | the M3 default focus indicator is free; do not draw a custom ring unless the design's ring differs, then note the deviation from M3 |
| Scrollbars | desktop | platform default; do not emit custom |
| Text selection | desktop | \`SelectionContainer\` when the design shows selectable body text; otherwise nothing |
| Window min size | desktop | belongs in \`main.kt\` (\`WindowDefaults\` / window state), not in a composable |
| \`cursor: pointer\` | both native | nothing; \`clickable\` / \`Pressable\` covers it |
| \`transition\` durations | both | ignore, and never translate a duration into an animation the framework does not have |

## The meta rule

When a case has no honest mapping, **refuse and say why**. Every invented workaround becomes a
behavior the next reader has to debug, and the report line costs nothing. A converter whose output
you cannot trust is worse than no converter, because it moves the work from writing to reviewing.

# 01 Input contract

> Amended by reality on 2026-10-12. A real Claude Design export is now available and does not match
> several rules below: it is a `.dc.html` template rendered by a generated runtime, it loads
> `tokens.css` and webfonts over `<link>`, its icons are a glyph font, and no `data-*` attribute in
> this file is present. See the "What changed" table in `odd/tasks/design-compiler.md`.

**The normative list is \`rules/contract-rules.json\`, not this file.** Every rule below exists as a row
in that table, and the table carries three things this prose cannot hold reliably: the one owner who
can actually write the markup, how the validator or extractor detects the rule against a materialized
frame, and what the reference export measures today (\`present\`, \`absent\`, \`violated\` or \`unknown\`).
This file keeps the reasoning -- the right-hand column is what tells a reader why a row is worth
defending -- and stops being a second source of truth. When this file and the table disagree, the
table wins and this file is the bug.

The converter's only input language. Everything here exists to make one downstream decision
deterministic; the right column is the reason, and it is also what the design prompt in spec/08
asks for, for the \`owner: author\` rows.

## Who owns the markup: the three-way split

A rule can only be demanded of someone who can write it, so every row of the table names exactly one
owner, and spec/08 turns only the \`author\` rows plus the named \`tool-behavior\` rows into prompt text.

| Owner | What it covers | Consequence for the prompt |
| --- | --- | --- |
| \`author\` | Markup the design tool writes into the template body: \`div\`, \`button\`, \`span\`, \`img\` and their attributes. Every \`data-*\` contract attribute lands here. | Ask for it verbatim, as an output requirement. |
| \`runtime\` | Markup \`support.js\` (\`dc-runtime\`) produces: \`<x-dc>\`, \`<sc-if>\`, \`<sc-for>\`, \`<dc-import>\`, \`<helmet>\`, the \`style-*\` attributes and the \`{{ }}\` placeholder mechanism. | **Never demandable.** Detect it against a materialized frame, or record the rule as a non-goal. |
| \`tool-behavior\` | What the tool does to the file rather than what it writes in the body: the remote \`<link>\`s it emits, the icon font it picks, the webfonts it loads, the manifest and token files it ships. | Negotiable, one round trip at a time; task T4 proves which ones actually move. |

A \`runtime\` rule can never be asked for, and the reason is mechanical rather than political: the text
a prompt would have to change is emitted by a generated 69 KB bundle that ships inside the export and
whose own header says "do not edit". Asking Claude Design to put \`data-component\` on every \`<sc-for>\`
is asking it to patch its runtime, and the prompt would be lying about a capability. Those rules are
detected or dropped. On the reference export the two buckets are already very uneven: the runtime side
is rich and machine-readable (\`dc-import\` 28 uses, 10 \`style-hover\` attributes, \`data-props\` in 5 of
5 templates), while 0 of 9 contract \`data-*\` attributes exist anywhere. The gap is author-owned
markup, which is exactly the half a prompt can move.

The blocks below stay as prose for the reasoning; \`rules/contract-rules.json\` is the row list and the
spec/07 catalog is the code list.

The validator (spec/07) rejects input that breaks a MUST. Rejecting is correct behavior: silent
guessing is what makes generated code expensive to review.

## Provenance

| Rule | Why it buys this |
| --- | --- |
| MUST: a token file at a known path, with \`color.light\` and \`color.dark\` maps of role name to \`#RRGGBB\`, plus \`typography\`, \`shape\`, \`spacing\` | reverse hex to role lookup; without it every color is a literal and the output is not themeable |
| MUST: a manifest listing every frame, its path, its width class and its states | the converter needs the intent behind a file, not just a file. Measured: \`MANIFEST.json\` lists all 9 screens and 35 states, but no width class field anywhere; the board encodes the width classes as separate frames instead |
| MUST: the manifest declares the design system and the seed it was generated from | lets a human diff the palette against the real generator |
| SHOULD: a brief listing decisions and invented values | becomes the notes section of the emitted code |

## Self-containment

| Rule | Why |
| --- | --- |
| MUST: all CSS inside a \`<style>\` block in the same file. No external stylesheet, no \`@import\`, no CDN link | the converter renders the file in a bare browser with no build step; a missing stylesheet yields default styles and a silently wrong tree |
| MUST: renders complete with JavaScript disabled | first paint is what gets captured. This is the one rule the format cannot meet as written; see "Status of the rules against the reference export" |
| MUST: no remote image URL and no webfont for body text | the capture browser is offline; broken requests become holes in the tree and text metrics no target can reproduce |
| MUST: text uses a font stack starting with the target's default (Roboto, then system sans) | a webfont that only exists on web produces metrics no target can reproduce |
| MUST: an icon carries \`data-icon="ic_name"\` | the name is the one fact the converter cannot recover from a glyph, and it is what the target's own icon library is looked up by. Enforced as \`warn\`, not \`error\`, by the icon policy below |
| SHOULD: icons are inline SVG with \`fill="currentColor"\` | inline paths are a mechanical transform to \`ImageVector\` / \`react-native-svg\`; a glyph font is not, and is tolerated as \`warn\` (see the policy below) |

### Icon policy: warn, reference, never fabricate

An icon font is a \`warn\` with a fix hint, not an error, because the current export uses Material
Symbols in every file and an error would block work on a design that is otherwise fine. What the
converter never does is author icon assets:

| Case | Behavior |
| --- | --- |
| inline SVG in the input | transform its path data mechanically. This is a conversion, not authorship: the bytes came from the design |
| glyph font, name known from \`data-icon\` | emit a reference to the target's own icon library by that name, plus a \`// TODO: icon asset\` marker |
| glyph font, name unknown | emit a placeholder with \`data-icon\` missing, the literal glyph in a comment, and a \`warn\` |
| anything else | a placeholder plus a \`warn\`. Never invented path data, never a hand-drawn vector |

Sourcing an icon is the target project's decision: its Material Icons dependency, its SF Symbols set,
or its own asset pipeline. The converter's job ends at the name.

The two icon rules have different owners, which the table records: writing \`data-icon\` on the element
is \`author\` (codes \`icon-unnamed\`, \`icon-name-assumed\`), while choosing the glyph font in the first place
is \`tool-behavior\` (code \`icon-font\`). Both are \`warn\`. Measured on the reference export: 0 inline
\`<svg>\` over 5 templates, 17 spans drawn from \`Material Symbols Outlined\`, and 0 \`data-icon\` anywhere,
so both codes have no positive case yet (see spec/07).

## Geometry

| Rule | Why |
| --- | --- |
| MUST: 1dp equals 1px everywhere. \`padding: 16px\` means 16.dp | kills the unit problem; no scaling table |
| MUST: one frame per file at a fixed pixel width, body that wide, no responsive reflow | a reflowing layout gets captured at whichever viewport the converter guessed |
| MUST: plain flex and grid only. \`position: absolute\` is allowed only as a declared overlay of a box named in the markup, never as the layout itself | absolute has no Compose or RN equivalent at component level; as a layout it forces a Box with manual offsets, which is a screenshot rather than a design. As a declared overlay it maps to \`Box\` plus \`offset\` honestly, so the rule states the intent instead of banning it -- the badge on the \`PodcastCard\` cover is absolute and maps. Measured: 2 occurrences over 5 templates (\`Home.dc.html\`, \`PodcastCard.dc.html\`), neither declaring what it overlays, so the row still fails today |
| MUST: no \`transform\` used for spacing, no viewport units (\`vh\`, \`vw\`, \`dvh\`) | viewport units resolve against the capture window, not the design. Measured: the board sets \`min-height: 100vh\` on the themed root, so this row is violated by the current export and the height of that root is a capture artifact, not a design value |
| MUST: no CSS animation required to reach a state; every state is its own markup block | the converter cannot trigger a hover; a state it cannot reach is a state it cannot emit |
| SHOULD: no \`overflow\` tricks, no \`clip-path\`, no \`filter: blur()\`, no gradients | none of these exist as a single property on either target. Measured: 0 \`clip-path\`, 0 \`filter\`, 0 gradients, and the \`overflow\` hits are plain \`hidden\` or \`ellipsis\`, so this row is clean today |

## Identity

This is the highest-value block in the contract, and the cheapest to add.

| Rule | Why |
| --- | --- |
| MUST: every component root carries \`data-component="podcast-card"\` in kebab-case | becomes the composable and component name; without it the converter guesses from a tag or a heading |
| MUST: repeated instances of the same component share the same \`data-component\` value | repetition detection, which is what yields props and a list |
| MUST: \`data-state="subscribed"\` (or \`variant\`, \`size\`) on each state frame | becomes a boolean or enum parameter instead of twelve separate components |
| MUST: \`data-elevation="2"\` on any surface that uses an M3 elevation tier | see below |
| MUST: \`data-token="colorScheme.primaryContainer"\` on any element whose background is a role color | removes hex lookup ambiguity; hex lookup stays as the fallback path |
| SHOULD: \`data-role="title"\` / \`"subtitle"\` / \`"meta"\` on text | names the generated parameter |

### Elevation must be declared, not inferred

Do not try to read an M3 elevation out of a CSS \`box-shadow\`. M3 draws elevation as a tonal
overlay of a tint color at a percentage, not as a black shadow. The blur radius, the offset and the
spread of a CSS shadow have no defined relation to an M3 level. Any formula will look plausible and
be wrong.

The Material3 tokens are a fixed six-step ladder, in dp: 0, 1, 3, 6, 8, 12 (\`ElevationTokens.Level0\`
to \`Level5\`). Declare the step in the markup; the converter maps it to \`tonalElevation\` or
\`shadowElevation\` and emits no shadow at all.

Missing \`data-elevation\` where a shadow or a container tier is present: diagnostic \`elevation-missing\`,
severity warn, and the emitted code carries a comment rather than a number pulled out of thin air.

## Colors

| Rule | Why |
| --- | --- |
| MUST: every color in the CSS comes from a custom property whose name is a Material role, e.g. \`--md-sys-color-primary\` | the property name is the answer; the value is only evidence |
| MUST: no literal hex outside the token block | a literal that survives to the output is an unthemeable surface |
| MUST: both light and dark reachable, light as default paint, dark also via \`@media (prefers-color-scheme: dark)\` and not only through a class or a JS toggle | a converter captures the same page twice with no JS; the media query is the only thing it can drive |
| MUST NOT: no \`color-mix()\`, no alpha of a role color, no opacity used to fake a container | an alpha'd role is not a role; it maps to no Compose property and silently breaks dark mode |
| MUST NOT: no gradient as a background | no equivalent property on either target |

## Layout intent

| Rule | Why |
| --- | --- |
| MUST: the grid container carries \`data-grid-min="140"\` | \`Adaptive(140.dp)\` cannot be recovered from a computed \`grid-template-columns\` of four fixed tracks; that value is a decision, and losing it turns a responsive grid into a hardcoded column count |
| MUST: scrollable regions carry \`data-scroll="list"\` or \`"grid"\` | the converter cannot tell a \`LazyColumn\` from a \`Column\` by looking at it; without the hint it emits a \`Column\` and the app gets a 500 item recomposition cost the design never asked for |
| MUST: regions declare intent: \`data-region="top-bar"\` / \`"content"\` / \`"now-playing-bar"\` | maps to \`Scaffold\` slots instead of a guessed \`Column\` |

## Naming and content

| Rule | Why |
| --- | --- |
| MUST: class names and \`data-component\` values are ASCII kebab-case | they become Kotlin and TypeScript identifiers |
| MUST: real copy, never lorem ipsum | placeholder text becomes a hardcoded literal that someone ships |
| MUST: text marked with \`data-prop="title"\` becomes a parameter, not a string constant | otherwise every generated component has its sample content welded inside it. Measured: \`data-prop\` is absent, but the runtime \`data-props\` schema declares the varying text per component (title, author, category) with types and defaults, so the converter reads parameters from the schema and \`data-prop\` stays the hand-written fallback |
| MUST NOT: no \`::before\` / \`::after\` content carrying real information | pseudo elements are invisible to a DOM walk unless you ask for them explicitly, and they have no RN equivalent |

## Status of the rules against the reference export

Every row of \`rules/contract-rules.json\` carries a \`measured\` value taken from \`docs/probe-report.md\`
or from reading \`fixtures/reference\` directly, never from what this spec would like to be true.
Counted over the 50 rows: 21 \`present\`, 11 \`absent\` (the mechanism or the file exists, the attribute
never does), 18 \`violated\`, 0 \`unknown\`. By owner: 27 \`author\`, 11 \`runtime\`, 12 \`tool-behavior\`.

Three rules are kept as \`violated\` instead of deleted, because only task T4 can say whether a design
tool can satisfy them:

| Rule | Why it stays violated |
| --- | --- |
| \`js-dependent-paint\` | The format needs \`support.js\` to build any tree at all, so "renders complete with JavaScript disabled" is unsatisfiable as written. Extraction works around it by materializing the frame over the loopback server; the row stays violated to record that, and spec/08 must not ask for it. |
| \`dark-only-via-js\` | Dark arrives through an \`md-dark\` class plus \`?theme=dark\`, and \`@media (prefers-color-scheme: dark)\` appears 0 times across all five templates and \`tokens.css\`. Either the tool learns the media query, or the validator stops caring because the materializer can emulate the scheme. T4 decides. |
| \`reflow-detected\` | One board carries every width class of \`HomeScreen\` and reflows between them. \`?frame=\` isolates one frame per capture, which may turn this row into a non-goal; until that is decided it is violated, not removed. |

No rule was softened to let the reference export pass. Where a rule looks unachievable, the honest
move is the one above: keep it violated, name who decides, and let T4 demote it to a detection rule or
a non-goal in the same commit that adds the replacement.

## What the contract is not

It is not a style guide for the design. It says nothing about color choice, density or taste. It is
a machine-readable promise about representation. A design that violates it can still be a beautiful
design; it just cannot be compiled without a human, and the validator says so in one line instead
of letting the generator emit something that has to be read to be trusted.

# 01 Input contract

> Amended by reality on 2026-10-12. A real Claude Design export is now available and does not match
> several rules below: it is a `.dc.html` template rendered by a generated runtime, it loads
> `tokens.css` and webfonts over `<link>`, its icons are a glyph font, and no `data-*` attribute in
> this file is present. See the "What changed" table in `odd/tasks/design-compiler.md`. The rules are
> kept because they state what a compilable export must look like; task T1 splits each one into what
> an author can write, what only the runtime writes, and what must be asked of the design tool.

The converter's only input language. Everything here exists to make one downstream decision
deterministic; the right column is the reason, and it is also what the design prompt in spec/08
asks for.

The validator (spec/07) rejects input that breaks a MUST. Rejecting is correct behavior: silent
guessing is what makes generated code expensive to review.

## Provenance

| Rule | Why it buys this |
| --- | --- |
| MUST: a token file at a known path, with \`color.light\` and \`color.dark\` maps of role name to \`#RRGGBB\`, plus \`typography\`, \`shape\`, \`spacing\` | reverse hex to role lookup; without it every color is a literal and the output is not themeable |
| MUST: a manifest listing every frame, its path, its width class and its states | the converter needs the intent behind a file, not just a file |
| MUST: the manifest declares the design system and the seed it was generated from | lets a human diff the palette against the real generator |
| SHOULD: a brief listing decisions and invented values | becomes the notes section of the emitted code |

## Self-containment

| Rule | Why |
| --- | --- |
| MUST: all CSS inside a \`<style>\` block in the same file. No external stylesheet, no \`@import\`, no CDN link | the converter renders the file in a bare browser with no build step; a missing stylesheet yields default styles and a silently wrong tree |
| MUST: renders complete with JavaScript disabled | first paint is what gets captured |
| MUST: no remote image URL and no webfont for body text | the capture browser is offline; broken requests become holes in the tree and text metrics no target can reproduce |
| MUST: an icon carries \`data-icon="ic_name"\` | the name is the one fact the converter cannot recover from a glyph, and it is what the target's own icon library is looked up by |
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
| MUST: text uses a font stack starting with the target's default (Roboto, then system sans) | a webfont that only exists on web produces metrics no target can reproduce |

## Geometry

| Rule | Why |
| --- | --- |
| MUST: 1dp equals 1px everywhere. \`padding: 16px\` means 16.dp | kills the unit problem; no scaling table |
| MUST: one frame per file at a fixed pixel width, body that wide, no responsive reflow | a reflowing layout gets captured at whichever viewport the converter guessed |
| MUST: plain flex and grid only. No \`position: absolute\` or \`fixed\` to build a layout | absolute has no Compose or RN equivalent at component level; it forces a Box with manual offsets, which is not a design, it is a screenshot |
| MUST: no \`transform\` used for spacing, no viewport units (\`vh\`, \`vw\`, \`dvh\`) | viewport units resolve against the capture window, not the design |
| MUST: no CSS animation required to reach a state; every state is its own markup block | the converter cannot trigger a hover; a state it cannot reach is a state it cannot emit |
| SHOULD: no \`overflow\` tricks, no \`clip-path\`, no \`filter: blur()\`, no gradients | none of these exist as a single property on either target |

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

Missing \`data-elevation\` where a shadow is present: diagnostic \`elevation-inferred\`, severity
warn, and the emitted code carries a comment rather than a number pulled out of thin air.

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
| MUST: text marked with \`data-prop="title"\` becomes a parameter, not a string constant | otherwise every generated component has its sample content welded inside it |
| MUST NOT: no \`::before\` / \`::after\` content carrying real information | pseudo elements are invisible to a DOM walk unless you ask for them explicitly, and they have no RN equivalent |

## What the contract is not

It is not a style guide for the design. It says nothing about color choice, density or taste. It is
a machine-readable promise about representation. A design that violates it can still be a beautiful
design; it just cannot be compiled without a human, and the validator says so in one line instead
of letting the generator emit something that has to be read to be trusted.

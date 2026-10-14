# Design Compiler

Turns a Claude Design export into real UI code for Compose Multiplatform (Android, iOS, desktop),
native SwiftUI, React Native and React web. Output is a compiling starting point with the design's
geometry, colors and type already resolved. No logic, no state, no navigation: props, hardcoded
values and empty callbacks, so the next agent spends its tokens on behavior instead of parsing HTML.

The other half of the tool is a prompt builder: it assembles the instructions given to Claude Design
so the design arrives in a shape a compiler can read, and a validator proves the prompt worked.

~~~text
Claude Design export  (*.dc.html templates, tokens.json, MANIFEST.json)
        |
        v   spec/13 bridge: one adapter per source tool -> SourceModel (raw, named, provenance)
        v   headless Chromium over loopback: walk the DOM, read getComputedStyle()
   IR     one JSON tree per screen: node kind, geometry, resolved style,
        | token role, children, repetition groups, states
        v
   validator   does the input honor the contract? if not, fail loudly
        |
        +--> compose        Color.kt Theme.kt Type.kt Shapes.kt *.kt   (Android, iOS, desktop)
        +--> swiftui        *.swift  Color Assets  LazyVStack/LazyVGrid
        +--> react-native   *.tsx  StyleSheet.create  AppRegistry
        +--> react-web      *.tsx  CSS Modules
        +--> figma          frames from the IR, no plugin, no import quota

prompt builder (spec/08) --> Claude Design --> the export above, validated by spec/07
     ^                                              |
     +---- the unknown-property report (spec/13) <----+
~~~

## Why this is a compiler and not a prompt

The hard half of "convert the design to code" is not generating code, it is deciding what the
design means: which box is a component, which repeated box is a list, which hex is which token,
which of fifteen text styles this 16/24 medium line is.

That work is already finished inside the HTML. The browser has resolved every rule, and the
repetition of a card twelve times is already the list. Reading those facts is deterministic.
Asking a model to re-derive them from HTML text is not, and it is the expensive part.

This project reads the computed DOM, so the model is never the parser. What it reads is not raw HTML
either: spec/13 puts a named SourceModel in front of extraction, so a second design tool costs an
adapter and not a new extractor.

## The bet this rests on

The input format is ours. spec/01-input-contract.md is a contract the design tool is required to
honor, enforced by a validator before a single line is emitted.

With arbitrary HTML this project does not work, and it should not try. With contract-honoring
HTML the mapping is mostly a table. Every rule in the contract buys a translation that would
otherwise be a guess, and the contract is cheap because it also improves the design output itself.

## Non-goals

- Pixel-perfect output. Text metrics differ per renderer by one or two pixels; chasing them is
  wasted work.
- Runtime behavior: state, effects, navigation, data fetching, accessibility wiring beyond labels.
  The target framework owns those, and the whole point is to leave them for a human or a focused
  agent.
- CSS as an input language. No cascade, no preprocessors, no Tailwind, no CSS-in-JS, no Shadow DOM.
  The contract is the input language.
- Design fidelity review. The validator checks the contract, not taste.
- A general HTML to Compose library.

## Layout

| Path | What |
| --- | --- |
| tools/probe.mjs | what a real export actually is, re-measured: `node tools/vendor.mjs` once, then `node tools/probe.mjs` |
| tools/browser.mjs | the shared frame-materialization transport: vendor router, offline guarantee, settle gate. Importable; `probe.mjs` is a thin caller so a second tool cannot re-implement the offline promise |
| tools/capture.mjs | one materialized frame to the spec/02 Node tree, in memory: `node tools/capture.mjs --json` |
| tools/emit-compose.mjs | the IR to `Color.kt`, `Theme.kt` and one composable, in its own `ui.generated` package: `node tools/emit-compose.mjs --write <commonMain>/kotlin` |
| tools/resolve.mjs | the pure value resolvers (color to role, type, shape, elevation); ladders parsed from spec/03 at load: `node tools/resolve.mjs --selftest` |
| tools/serve.mjs | loopback static server for an export, path-confined to one directory |
| tools/validate.mjs | the contract table as executable checks: `npm run validate -- fixtures/reference` |
| tools/property-map.mjs | which CSS properties a target owns, and the unknowns as a repair report: `npm run properties`, `npm run repair` |
| tools/css-harvest.mjs | the one canonical CSS reader: `{{ }}` holes are opaque, selectors are not declarations |
| tools/check-contract.mjs | the rule table's own invariants (owner, severity, prompt carriers) |
| tools/prompt.mjs | assemble the Claude Design prompt: `node tools/prompt.mjs --target compose --out out/DESIGN-PROMPT.md` |
| rules/contract-rules.json | the normative contract table: prompt and validator read the same rows |
| rules/property-ownership.json | which mapping spec owns each CSS property, and the severity of each unknown |
| rules/target-blocks.json | target prompt text as data, with the topic cross-check the assembler runs |
| tests/golden/ | the assembled prompts and the emitted Kotlin, byte for byte; `npm test` compares, `--update` rewrites |
| baselines/reference.json | per-code validator counts on the reference export, so a check cannot silently change |
| docs/lessons.md | the spec/10 log: one line per lesson, each pointing at a check or a fixture |
| docs/probe-report.md | generated answers: transport, frame isolation, determinism, missing contract attributes |
| spec/01-input-contract.md | what the export must contain, machine checkable |
| spec/02-ir.md | the intermediate representation, field by field |
| spec/03-extraction.md | reading the DOM, computed-style rules, ordering |
| spec/04-mapping-compose.md | CSS to Compose table and every known trap |
| spec/05-mapping-react-native.md | CSS to RN, including what Yoga cannot do |
| spec/06-mapping-react-web.md | CSS to CSS Modules, the cheap target |
| spec/07-validator.md | diagnostic catalog: code, severity, fix hint |
| spec/08-platform-aware-prompt.md | the Claude Design prompt, target-platform aware |
| spec/09-wizard.md | the interactive CLI |
| spec/10-learning-loop.md | how per-screen runs accumulate rules, not prose |
| spec/11-figma.md | the two ways into Figma, and which one costs nothing |
| spec/13-bridge.md | the layer between an export and the IR: adapters, SourceModel, unknown severities |
| spec/corner-cases.md | the flat catalog: known hard cases and their resolution |
| odd/tasks/design-compiler.md | the build order, with seams and blockers |

## Where to start reading

| Order | File | Read it for |
| --- | --- | --- |
| 1 | spec/01-input-contract.md | the bet: a contract instead of arbitrary HTML |
| 2 | spec/02-ir.md | the one structure every target reads |
| 3 | spec/03-extraction.md | computed style, reduction, resolution tables |
| 4 | spec/13-bridge.md | what extraction is allowed to assume, and what it must refuse |
| 5 | spec/04-mapping-compose.md | the target that matters, and the ten traps |
| 6 | spec/corner-cases.md | the catalog to work through when output is wrong |
| 7 | odd/tasks/design-compiler.md | the build order, with each task's measured outcome |

Verified numbers, not from memory: type scale, shape ladder, elevation ladder and state layer
opacities were read out of material3 1.12.0-alpha03 sources. Re-verify against whatever version is
pinned when the emitter is built, and treat a mismatch as a bug in the emitter, not as a design
issue.

That re-verification happened, and it found two API premises that the pinned library disagrees with.
One was spec/04's: `CardDefaults.cardElevation` takes no `tonalElevation`. One was the emitter's own:
`Shapes` takes no `full`, so a circle is `CircleShape` at the use site. Both were caught by
the compiler rather than by reading, which is the cheaper way to be wrong. The emitter writes what
the pinned API declares and says so in the file.


## Status

T0, T1, T2, T2.5, T3 and T3.1 are done: the input side. Know what an export is, make the contract
executable, make the prompt, own the layer in between. T5 has its answer in writing, and the first
emitter exists: `tools/capture.mjs` reads one materialized frame into the spec/02 tree and
`tools/emit-compose.mjs` writes that tree as `Color.kt`, `Theme.kt` and one composable that compile.

Half of T5's acceptance stays open on purpose. "Compiles" is measured green; "looks like the frame" has
never been seen, because every render host means writing into the workshop repo and that repo carries
the human's uncommitted work. T4 is the other task waiting on a person: the round trip that proves the
prompt.

The input format was written down before an export existed. One arrived on 2026-10-12
(`~/Documents/CK/internals/kotlin-workshop-lab/jetcasterDesign`) and it differs from spec/01 in ways
that matter: `.dc.html` templates rendered by a generated runtime, remote fonts and `tokens.css` over
`<link>`, a glyph icon font instead of inline SVG, and none of the `data-*` contract attributes. In
exchange it provides a prop schema (`data-props`), a `MANIFEST.json` with screens and states, and
`tokens.json` with color, typography, shape, spacing and motion. Read the "What changed" table in
`odd/tasks/design-compiler.md` before taking any statement in spec/01 as fact about the input.

SwiftUI has no mapping spec yet; that is T11, and it is why the bridge spec is number 13.

Measured rather than believed, all reproducible:

- `docs/probe-report.md`: materializing a frame needs a loopback server, not a `file://` URL, and the
  export carries none of the contract attributes the prompt has to ask for.
- `npm run validate -- fixtures/reference` exits 1 with 53 errors, 43 warnings, 197 infos; its
  `remote-resource` and `webfont-remote` counts (10, 10) agree with the probe independently.
- `npm run properties` reports 53 CSS properties in 887 declarations, of which 16 (53 declarations) are
  named by no mapping spec. Those 16 are the gap spec/13 exists to close, and `npm run repair` renders
  them as a paste-ready ask for the design tool.
- `npm test` is 197 tests over the prompt builder, the validator, the property map, the resolver, the
capture and the emitter.
- `node tools/emit-compose.mjs --write <commonMain>/kotlin` emits `Color.kt`, `Theme.kt` and one
composable, and `./app/gradlew -p app :shared:compileKotlinJvm` in the workshop compiles them: 5 class
files under `ui/generated`, exit 0. That command is the oracle, and it is what refuted the two API
premises above.

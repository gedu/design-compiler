# Design Compiler

Turns a Claude Design export into real UI code for Compose Multiplatform, native SwiftUI, React
Native and React web. The output is a compiling starting point with the design's geometry, colors
and type roles already resolved: props, sample values, empty callbacks. No logic, no state, no
navigation, so the next agent spends its tokens on behavior instead of parsing HTML.

The other half of the tool is a prompt builder: it assembles the instructions given to Claude Design
so the design arrives in a shape a compiler can read, and a validator proves the prompt worked.

```text
<div data-component="podcast-card" data-elevation="1"
     data-token="colorScheme.surfaceContainer" role="button"
     aria-pressed="{{ selected }}" onClick="{{ select }}" style="...">
```

```kotlin
@Composable
fun PodcastCard(
    category: String, title: String, author: String,
    selected: Boolean, subscribed: Boolean,
    onSelect: () -> Unit, onToggle: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = Modifier.fillMaxWidth().selectable(selected = selected, onClick = onSelect),
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
```

One line of authored HTML became a component signature. Nothing above was guessed: the boolean is
the prop the template's own `{{ }}` hole names, its default comes from the export's prop schema, and
`selectable` is the row in `spec/04-mapping-compose.md` that decides it.

## The three invariants

They outrank any cleverness in the implementation, and every one has a check behind it.

1. **Determinism.** Same input plus config yields byte-identical output. No timestamps in generated
   files, no unordered iteration, no model call anywhere in a mapping path. Reproducibility is the
   whole reason this exists instead of a chat message.
2. **The model is never the parser and never resolves a value.** Not a color role, not a component
   name, not a type role. At most it suggests a name for something unlabeled, and the suggestion is
   labeled as a suggestion. Table lookups only.
3. **Refuse instead of invent.** An unmappable case is a diagnostic with options and exit code 3, not
   a clever workaround. Every invented workaround becomes a behavior someone debugs later. A
   converter whose output cannot be trusted is worse than none: it moves work from writing to
   reviewing.

## Why a compiler and not a prompt

The hard half of "convert the design to code" is not generating code, it is deciding what the design
means: which box is a component, which repeated box is a list, which hex is which token, which of
fifteen text styles this 16/24 medium line is.

That work is already finished inside the HTML. The browser has resolved every rule, and a card drawn
twelve times is already the list. Reading those facts is deterministic. Asking a model to re-derive
them from HTML text is not, and it is the expensive part.

So this reads the computed DOM, and the model is never the parser. What it reads is not raw HTML
either: `spec/13-bridge.md` puts a named SourceModel in front of extraction, so a second design tool
costs an adapter and not a new extractor.

## The bet this rests on

The input format is ours. `spec/01-input-contract.md` is a contract the design tool is required to
honor, enforced by a validator before a single line is emitted. With arbitrary HTML this project does
not work, and it should not try. With contract-honoring HTML the mapping is mostly a table. Every
rule in the contract buys a translation that would otherwise be a guess, and the contract is cheap
because it also improves the design output itself.

## Quickstart

Requires Node 24+ and Chromium. `npm test` launches a real browser, so the machine needs some headroom.

```bash
npm install
node tools/vendor.mjs          # once, needs network: pins the export's own assets locally
npm test                       # 204 tests
npm run emit -- --dry-run      # emit the bundled fixture without writing
npm run validate -- fixtures/reference   # the contract as 24 executable checks
```

Those four commands are verified on a fresh clone, not on a warm working directory. `vendor.mjs`
exists because an offline fixture may not reach a CDN: the request router aborts anything the vendor
lock does not pin, which is a testable claim, unlike "we used a file URL".

The end-to-end path against a real Kotlin project is `node tools/emit-compose.mjs --write
<commonMain>/kotlin`. The compiler of that project is the oracle this repo trusts, and `--rerun` is
not optional: a `BUILD SUCCESSFUL` with `compileKotlinJvm UP-TO-DATE` reuses an old verdict and says
nothing about the bytes in front of you.

## Where to start reading

| Order | File | Read it for |
| --- | --- | --- |
| 1 | `spec/01-input-contract.md` | the bet: a contract instead of arbitrary HTML |
| 2 | `spec/02-ir.md` | the one structure every target reads, field by field |
| 3 | `spec/03-extraction.md` | computed style, reduction, resolution tables |
| 4 | `spec/13-bridge.md` | what extraction may assume, and what it must refuse |
| 5 | `spec/04-mapping-compose.md` | the target that matters, and the ten traps |
| 6 | `spec/corner-cases.md` | the catalog to work through when output is wrong |
| 7 | `docs/lessons.md` | one line per mistake, each pointing at a check that now catches it |
| 8 | `odd/tasks/design-compiler.md` | the build order, with each task's measured outcome |

## Layout

| Path | What |
| --- | --- |
| `tools/probe.mjs` | what a real export actually is, re-measured: `node tools/probe.mjs` |
| `tools/browser.mjs` | the shared frame-materialization transport: vendor router, offline guarantee, settle gate. Importable, so a second tool cannot re-implement the offline promise |
| `tools/capture.mjs` | one materialized frame to the spec/02 Node tree: `node tools/capture.mjs --json` |
| `tools/emit-compose.mjs` | the IR to `Color.kt`, `Theme.kt` and one composable, in its own `ui.generated` package |
| `tools/resolve.mjs` | the pure value resolvers (color to role, type, shape, elevation); ladders parsed from spec/03 at load |
| `tools/serve.mjs` | loopback static server for an export, path-confined to one directory |
| `tools/validate.mjs` | the contract table as executable checks |
| `tools/property-map.mjs` | which CSS properties a target owns, and the unknowns as a repair report |
| `tools/css-harvest.mjs` | the one canonical CSS reader: `{{ }}` holes are opaque, selectors are not declarations |
| `tools/check-contract.mjs` | the rule table's own invariants (owner, severity, prompt carriers) |
| `tools/prompt.mjs` | assemble the Claude Design prompt, target-aware |
| `tools/vendor.mjs` | pin the export's assets into `.vendor/` once, so every later run is offline |
| `rules/contract-rules.json` | the normative contract table: prompt and validator read the same rows |
| `rules/property-ownership.json` | which mapping spec owns each CSS property, and the severity of each unknown |
| `rules/target-blocks.json` | target prompt text as data, with the topic cross-check the assembler runs |
| `tests/golden/` | the emitted Kotlin and the assembled prompts, byte for byte; `--update` rewrites |
| `baselines/reference.json` | per-code validator counts on the reference export, so a check cannot silently change |
| `spec/` | 13 numbered specs plus a corner-case catalog. 12 is reserved for the SwiftUI mapping that does not exist yet, which is why the bridge is 13 |

## Non-goals

- Pixel-perfect output. Text metrics differ per renderer by a pixel or two; chasing that is wasted work.
- Runtime behavior: state, effects, navigation, data fetching. The target framework owns those, and
  the point is to leave them for a human or a focused agent.
- CSS as an input language. No cascade, no preprocessors, no Tailwind, no CSS-in-JS, no Shadow DOM.
  The contract is the input language.
- Design fidelity review. The validator checks the contract, not taste.
- A general HTML to Compose library.

## Status, measured rather than believed

The input side is built and the first emitter works: `tools/capture.mjs` reads one materialized frame
into the spec/02 tree (20 KB of JSON for this card) and `tools/emit-compose.mjs` writes that tree as
three Kotlin files that compile. Compose is the only target with an emitter. React Native and React
web have mapping specs and no code yet; SwiftUI has neither (its spec is 12, reserved for the task
that writes it -- which is why the bridge is numbered 13).

Reproducible numbers, all from the bundled fixture:

- `npm test` -- 204 tests, 204 pass.
- `npm run emit -- --dry-run` -- 11 IR nodes, 0 error diagnostics; the three emitted files match
  their goldens byte for byte.
- `npm run validate -- fixtures/reference` -- 24 checks, 53 errors, 43 warnings, 197 infos, 6
  unimplemented, exit 1. Those errors are the reference export's own contract violations, which is
  what the check is for. The counts are pinned in `baselines/reference.json`, so drift fails loudly.
- `npm run properties` -- 53 CSS properties in 887 declarations, 16 of them (53 declarations) named
  by no mapping spec, findings 0. Those 16 are the gap spec/13 exists to close.
- `node tools/check-contract.mjs` -- 50 rules, 0 problems.

**What is open, on purpose.** The rendered card is 180x264dp inside a 180x272dp frame: two negative
CSS margins cancel line-height slack, Compose rejects negative padding outright, and what should
replace that slack is a mapping decision nobody has made yet. And both values of one boolean render
pixel-identical, because the icon is a constant where the design swaps glyph, tint and label; the fix
needs a rule naming where the second glyph comes from, and until then the honest output is a TODO
rather than a plausible guess.

That honesty is the point of `docs/lessons.md`. When the compiler got something wrong twice, the
second time it wrote a check instead of a paragraph: a CSS negative margin that compiled, matched its
golden and crashed the app on launch; a `BUILD SUCCESSFUL` that proved nothing because the task never
ran; a test that passed while the thing it guarded was deliberately broken.

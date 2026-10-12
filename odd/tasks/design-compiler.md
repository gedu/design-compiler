# Feature: design-compiler

Locator: `odd/tasks/design-compiler.md`

Reconciled 2026-10-12 against a real Claude Design export. The original list (T0-T11) was written
from an assumed input format; the export exists now and the assumption was wrong in a specific,
important way. Old task numbers are kept where the meaning survived.

## Objective

A tool that takes a Claude Design export and emits compiling UI code for Compose Multiplatform,
React Native, React web and SwiftUI, with colors, spacing, typography and component boundaries
already resolved, so the next agent works on behavior instead of parsing HTML.

On the way there it also produces the other half of the system: a prompt that makes Claude Design
emit designs a compiler can read, and a validator that proves the prompt worked.

## What changed: the real input format

Evidence: `~/Documents/CK/internals/kotlin-workshop-lab/jetcasterDesign` (Mini Jetcaster export,
7 screens, 4 component templates, copied here as read-only reference).

| spec/01 assumed | The export does |
| --- | --- |
| static HTML, CSS in an inline `<style>` | `.dc.html` template with `{{ prop }}` placeholders |
| own CSS in the file | `<link rel="stylesheet" href="tokens.css">` plus 10 remote Google Fonts links |
| renders with JS disabled, first paint is the capture | needs `support.js`, a 69 KB generated runtime (`dc-runtime`, esbuild bundle, header says "do not edit") |
| states are separate markup blocks | states are a JS function in `<script data-dc-script>` using `p.*` and `this.state` |
| inline SVG icons | `Material Symbols Outlined` as an icon font; 0 occurrences of `<svg` across all 5 `.dc.html` |
| no `position: absolute` | present in 2 of 5 templates (`PodcastCard.dc.html`, `Home.dc.html`) |
| `data-component`, `data-elevation`, `data-token`, `data-scroll`, `data-grid-min`, `data-region` | 0 of 6 present anywhere in the export |
| one fixed-width frame per file | one board per project; `?frame=<id>` and `?theme=dark` resolved at runtime |

What the format gives us that the spec did not ask for, and is strictly better:

| Field | Where | What it buys |
| --- | --- | --- |
| `data-props` JSON schema | `PodcastCard.dc.html`, `Home.dc.html` | prop name, `tsType`, `editor`, `default`, `min`/`max`, enum `options`: parameters as input, not detection |
| `MANIFEST.json` | project root | screens, states per screen, width class, spec link, seed color, design system, open unknowns |
| `tokens.json` | root | `color.light/dark`, `typography` (15 roles), `shape`, `spacing`, `motion`, project-specific maps |
| `dc-import name width height platform preset dark` | `Mini Jetcaster.dc.html` | composition edges and variant intent, 28 uses |
| `style-hover`, `style-pressed`, `style-focus` | element attributes | hover/pressed/focus as declarations, not as `:hover` rules to parse |
| `Color.kt`, `Theme.kt`, `SCREENS.md`, `DESIGN-BRIEF.md` | root | the design already emits half of the Compose target |

Consequence for the original plan: old T0 as written cannot run. `screens/PodcastCard.html` is a
412-byte `<meta http-equiv="refresh">` pointing at `../Mini Jetcaster.dc.html?frame=PodcastCard`.
There is a missing pipeline stage in front of everything: **materialize a frame** -- render the
board in a headless browser at a chosen frame, theme and prop set, then read computed style. That
stage is T0.

## The two unknowns this plan exists to retire

1. **Will Claude Design honor a markup contract?** Under the chosen route (prompt first, regenerate
   the export), the whole pipeline produces nothing until the answer is yes. The binding constraint
   is which parts of the markup Claude Design actually owns: `<x-dc>`, `<sc-if>`, `<sc-for>`,
   `<dc-import>`, `<helmet>` and the `style-*` attributes come from `dc-runtime` and are not
   ours to annotate, but every `<div>`, `<button>` and `<span>` in the template body is author
   written, and that is where a `data-component` would have to land. Whether icons can be inline
   SVG instead of the Material Symbols font is the single most likely "the tool will not do that"
   answer, and it decides whether the icon path is a table or a font mapping.
2. **Is resolved computed style enough to emit code that looks like the design?** Unchanged from the
   original plan. Still the project's core risk, and it is independent of unknown 1.

Unknown 1 needs a human at Claude Design and a round trip. Unknown 2 does not. They run in
parallel, and T5 answers unknown 2 on a hand-annotated fixture without waiting for the export.

## Decisions taken 2026-10-12 (Eduardo)

| Decision | Consequence |
| --- | --- |
| Contract first: grill the prompt, regenerate the export, build the extractor on annotated HTML | validator and prompt builder come before the extractor; the pipeline stays dark until a fresh export validates |
| Compose Multiplatform is the spike target | `app/gradlew :shared:compileKotlinJvm` in the workshop is the oracle; spec/04 traps are already written |
| Prompt generator is a deterministic header first, IA adaptation later | the emitted prompt is reproducible and reviewable; IA output is stored as a generated artifact, never re-derived |
| Output lands inside the design folder, `generated/<target>/` | review side by side with the HTML; the wizard gets a move step to relocate into a real project later |

## Assumptions recorded (each is falsifiable, none is load-bearing yet)

- Targets are four independent emitters: `compose` (KMP shared: Android, iOS, desktop), `swiftui`
  (native iOS), `react-native`, `react-web`. "Android via KMP" plus "iOS via SwiftUI" means a project
  can pick either or both; config decides, the tool never assumes Compose covers iOS.
- ~~Frame materialization runs on `file://`~~ **resolved by T0: it cannot.** The runtime fetches
  sibling templates, so extraction runs over a loopback server (`tools/serve.mjs`) with every
  third-party request served from `.vendor/` by pin. Still zero external network.
- Icon fallback if inline SVG is unachievable: accept the glyph font, emit a `data-icon` name, and
  map name to asset through a table; validator reports `warn`, not `error`. Recorded here so the
  fallback is a decision and not a quiet compromise.
- `position: absolute` inside a component is mappable to `Box` plus `offset`, so the contract demotes
  it from forbidden to "declare the intent". Blanket prohibition would reject the current design,
  including the badge on `PodcastCard` cover, which maps honestly.
- ~~Playwright needs to be a repo dev dependency~~ done in T0: playwright 1.64 in devDependencies.
  Its own `browsers.json` wants chromium-1248 while this machine caches chromium-1243, so the probe
  locates the cached binary itself (or honors `CHROME=`) instead of downloading a second browser. A
  fresh machine without the cache needs `npx playwright install chromium`.

## Test seams

Unchanged from the original list, plus one.

| Seam | What it proves |
| --- | --- |
| `validate --json` exit codes | the design prompt still produces a conforming export: the only honest feedback loop for the prompt |
| `ir` command, IR as JSON on disk | every emitter bug reproducible from one file |
| Golden fixtures: input frame, expected emitted file, second run byte-identical | mapping correctness and determinism, the two claims the project rests on |
| Target compiler as oracle: `:shared:compileKotlinJvm`, `tsc --noEmit`, `swiftc` | emitted code is real code; the only pass or fail that matters |
| **New: format probe** (`tools/probe` against a real export, report in `docs/`) | what the input actually is, re-checked on every Claude Design version instead of argued from memory |

## Tasks

Vertical slices, each verifiable alone. Frontier: any task whose blockers are done.

- [x] T0 Format probe and frame materialization
  - Blocked by: None
  - Seams: probe report on disk, one frame rendered to a screenshot plus a computed-style dump
  - **Outcome, 2026-10-12.** `tools/probe.mjs` renders every frame of the reference export and writes
    `docs/probe-report.md` plus `out/probe/{probe.json,probe.log,<frame>.png}`. Reference export
    copied to `fixtures/reference` (456 KB tracked; captures and the `_ds` slide-system bundle are
    gitignored). Playwright 1.64 as a devDependency; no Playwright browser download is needed, the
    cached chromium-1243 is found by search and overridable with `CHROME=`.
  - **Decision recorded: `file://` is NOT enough; the extractor needs a loopback server.** Measured,
    not assumed: `<dc-import>` is resolved at runtime by fetching the sibling `.dc.html`, and a
    `file://` page has a null origin, so the runtime logs
    `[dc-runtime] sibling fetch for "PodcastCard" threw: ./PodcastCard.dc.html TypeError: Failed to
    fetch`. Reproduce with `node tools/probe.mjs --frame PodcastCard --file-protocol`. Extraction
    therefore runs over `127.0.0.1` on an OS-picked port (`tools/serve.mjs`, path-confined to one
    directory), which keeps the offline guarantee testable instead of nominal.
  - **Second decision: the runtime's own dependencies are vendored, not fetched.** `support.js`
    hardcodes React 18.3.1, ReactDOM 18.3.1 and Babel 7.29.0 from unpkg, and the templates `<link>`
    two Google Fonts stylesheets. `tools/vendor.mjs` pins those URLs, downloads them into `.vendor/`
    (gitignored) and writes `.vendor/vendor-lock.json`; the extractor's request router serves exactly
    what that lock lists and aborts anything else, recording it. The lock, not a wish, is what makes
    "no network during conversion" a check rather than a claim.
  - Measured answers: `?frame=` isolates one element per frame for all 9 frames (whole screens are
    `<figure>`, components and state sheets are `<section>`; id alone identifies a frame); query
    strings drive both `?theme=dark` and per-component props, so a state is reachable without
    scripting; two identical runs are byte-identical screenshots; geometry read before
    `document.fonts.ready` measures the wrong font, so the probe waits for it (Roboto and Material
    Symbols both active afterwards, 0 blocked requests, 0 page errors).
  - Also measured: `position: absolute` appears twice across the templates, inline SVG zero times, and
    **zero of the nine contract `data-*` attributes exist anywhere in the export.** T1 starts from
    that fact rather than discovering it later.

- [x] T1 Contract v2: what the runtime owns versus what Claude Design can annotate
  - Blocked by: ~~T0~~ done
  - Seams: `rules/contract-rules.json` as the normative list, `node tools/check-contract.mjs`
  - **Outcome, 2026-10-12.** 50 rules, each with code, severity, owner, ask, detect, fix and a
    `measured` value taken from the probe or the templates: owner `author` 27 / `tool-behavior` 12 /
    `runtime` 11; severity error 33 / warn 17; measured present 21 / violated 18 / absent 11. spec/01
    keeps its reasoning prose and points at the table as normative; spec/07 gained
    `manifest-incomplete`, `brief-missing`, `prop-undeclared`, moved `icon-font` from error to warn per
    the recorded decision, and states which codes have no positive case yet. spec/08's markup block is
    generated from the table instead of restating it.
  - **The asymmetry T1 existed for:** 11 rules are `runtime`-owned and can never be demanded of a
    design prompt, because the text a prompt would change lives in a generated bundle whose own header
    says "do not edit". Meanwhile all 9 contract `data-*` attributes are author-owned and absent, so
    the gap is exactly the half a prompt can move. That is what makes the prompt-first route viable.
  - `tools/check-contract.mjs` enforces row schema, ask-only-for-author, severity agreement with the
    spec/07 catalog, reverse coverage of every catalog code, and placeholder-free ask text. Verified
    non-vacuous: injecting a severity drift plus an `ask` on a `runtime` row produced exactly 2
    failures, and undoing them returned to green.
  - **Caught by the check, not by reading:** `weight-without-font` sat in the warn catalog with no rule
    row and no explanation. It is emission-side (only meaningful once the target's bundled fonts are
    known) and is now declared as such.
  - **Three rules are violated and likely unsatisfiable, kept violated rather than softened, for T4 to
    decide:** `paint-without-js` (the format needs `support.js` to build any tree, so "renders with JS
    disabled" cannot be met), `dark-reachable-prefers-color-scheme` (`@media (prefers-color-scheme:
    dark)` occurs 0 times across the 5 templates and `tokens.css`; either the tool learns it or the
    materializer emulates the scheme and the rule dies) and `frame-fixed-width` / `reflow-detected`
    (one board reflows HomeScreen across width classes, which the rule contradicts head-on; `?frame=`
    may make it a non-goal). T4 records one resolution per rule, in writing.
  - Negotiation targets among `tool-behavior`, ranked by what one prompt sentence might buy: drop the
    remote `<link>`s and inline `tokens.css` (10 remote URLs today), drop body-text webfonts, then
    inline SVG icons (most likely refusal; warn-only, so a refusal costs a name plus a TODO and not the
    run), then a `widthClass` per screen in the manifest.
  - **Amended in T3 prep, because the checker found it.** T1 shipped `tool-behavior` rows with `ask:
    null`, which contradicted spec/01's own table ("negotiable, one round trip at a time"): 12 rules,
    including every remote-resource rule, had nothing for the prompt to ask. They now carry ask text.
    The two fields that make this enforceable are `prompt` (`ask` | `silent`) and `promptNote` (who
    deferred a silent rule). Current split: 37 rows generated into the prompt (25 author + 12
    tool-behavior), 13 silent (11 runtime + 2 author rows held for T4, `paint-without-js` being the
    runtime one). Correcting this also corrected the checker's own rule: only `runtime` may never
    carry an ask; `tool-behavior` may, because refusal there costs a `warn` and not the run.

- [ ] T2 Validator: contract as executable checks
  - Blocked by: T1
  - Seams: `validate --json`, exit codes
  - spec/07 codes, severities and fix hints, plus the fixture harness that runs a folder and prints
    the report. Tests run on fixtures hand-annotated to the contract, so validator coverage does not
    wait for T4. A check that no real export can satisfy is a bug in the check, found by T4.

- [ ] T3 Prompt builder: deterministic header assembly
  - Blocked by: T1
  - Seams: golden `prompt.txt` per target combination
  - spec/08 as data, not prose: shared header plus exactly one block per chosen target, written to a
    file the human pastes into Claude Design. Assembler fails rather than concatenates if two target
    blocks disagree. The contract annotation list is generated from the same table the validator
    reads, so prompt and validator cannot drift: one rule, one row, checked in both directions.

- [ ] T4 The loop: a fresh export validates clean
  - Blocked by: T2, T3
  - Seams: `validate --json` exit 0 on a real export, run by a human
  - The human-in-the-loop task: paste the generated prompt into Claude Design, export, validate, fix
    the prompt, repeat. Every failure is fixed in the prompt or the validator, never by hand-patching
    the export. Record which contract rules Claude Design could not honor, and demote each one to a
    detection rule or a non-goal in the same commit. This task is what unknown 1 is waiting on.

- [ ] T5 Spike: one materialized frame to one compiling Compose file
  - Blocked by: T0, T2
  - Seams: golden fixture, `./app/gradlew :shared:compileKotlinJvm`
  - Unknown 2, answered without waiting for T4: take the hand-annotated `PodcastCard` fixture, read
    computed style, resolve colors and one type role, emit `Color.kt`, `Theme.kt` and one composable,
    compile it in the workshop `shared` module. No CLI, no IR file, no second target. If it compiles
    and looks like the frame, everything after is volume.
  - Decision to record: throw the spike away or grow it into T6. Say which, in writing.

- [ ] T6 Extraction to a real IR on disk
  - Blocked by: T5
  - Seams: `ir` command, golden IR fixtures
  - Capture, reduce, resolve, detect per spec/03, emitting the spec/02 JSON. Type and shape ladders
    verified against the pinned material3 in the Gradle cache, reverse color lookup with tolerance,
    diagnostics for everything unresolved.

- [ ] T7 Repetition, states and parameters
  - Blocked by: T6
  - Seams: IR golden fixtures, parameter-list assertions
  - `ComponentGroup` from repetition, parameters primarily from the `data-props` schema (types and
    defaults as input), states from `data-state` plus `style-hover`/`style-pressed`/`style-focus`,
    callbacks only from controls with evidence. The upgrade the real format handed us: old T3 had to
    infer a prop list, this one mostly reads one.

- [ ] T8 Compose emitter
  - Blocked by: T7
  - Seams: golden emitted files, `:shared:compileKotlinJvm`, the workshop as live target
  - spec/04 mapping table and its traps: clipping shape propagation, canonical modifier order,
    non-collapsing margins, `weight` scope, two `ColorScheme` objects, no Android import in
    `commonMain`, inline SVG icons, previews with fake content, TODO markers for undecided values.

- [ ] T9 Wizard, `convert`, output placement and move
  - Blocked by: T8
  - Seams: CLI exit codes, config round trip, move step
  - spec/09 plus the chosen output model: emit to `generated/<target>/` inside the design folder,
    show a diff before touching anything, then offer a move into the target project's source tree
    from config. The move is a separate explicit step, never implicit, because it crosses from design
    output into someone's repo.

- [ ] T10 React Native emitter
  - Blocked by: T9
  - Seams: golden files, `tsc --noEmit`
  - spec/05. Grid is a config decision, never inferred; safe areas through a hook, never a baked
    number; an honest `refused` entry for anything Yoga cannot express.

- [ ] T11 SwiftUI emitter, and spec/12 for it
  - Blocked by: T9
  - Seams: golden files, `swiftc -typecheck` or an iOS build on the simulator SDK
  - No spec exists for this target, so the mapping table is new work: which IR node becomes which
    `View`, how M3 roles land in a SwiftUI palette, `LazyVStack`/`LazyVGrid` and `Grid` for lists,
    SF Symbols or asset names for icons. Xcode 26.3 and Swift 6.2.4 are verified on this machine.

- [ ] T12 React web emitter
  - Blocked by: T9
  - Seams: golden files, `tsc --noEmit`
  - spec/06. Build it first as the IR's information-loss test, keep it only if a component library is
    in play; otherwise the wizard says so instead of shipping a second web implementation.

- [ ] T13 Learning loop and lesson log
  - Blocked by: T8
  - Seams: log file, fixture per lesson, the three spec/10 metrics
  - A lesson becomes a check, a table row or a fixture, never prose. Wire first-run errors, TODO
    markers per component, manual edits to a first compiling screen.

- [ ] T14 IA-assisted prompt adaptation
  - Blocked by: T4
  - Seams: generated prompt stored as artifact, `validate --json` exit 0 on the export it produced
  - The optional IA layer: adapt the deterministic header to the brief the human typed. Output is
    always written to a file and stays the reviewed artifact; IA never resolves a value, a role or a
    name, and never runs inside a mapping path.

- [ ] T15 Consume from the workshop
  - Blocked by: T9, T4
  - Seams: workshop `desktopApp` screenshot plus `./app/gradlew :shared:allTests`
  - The first real user. Convert the Mini Jetcaster design into the composables participants start
    from and diff against the hand-written `ui/`. If the generated version is not clearly better than
    writing it by hand, the project has not earned its keep.

## Non-negotiables carried over unchanged

- Determinism: same input plus config gives byte-identical output. No timestamps, no unordered
  iteration, no model call inside a mapping path.
- The model is never the parser and never picks a token, role or component name silently. At most it
  suggests a name, reported as a suggestion.
- Refuse instead of invent. An unresolved case is a diagnostic with options and exit 3.
- Inputs are immutable. Nothing is ever written into a design export, including the workshop copy.
- Every mapping bug arrives with a fixture. The golden suite is the product.
- ASCII only in all artifacts.
- No commit, push or PR without an explicit decision. Repo state today: zero commits on `master`.

## Notes for whoever picks this up

- T0 and T5 retire the two unknowns; T4 retires the one that needs a human. Do not start T6 before
  T5 has an answer in writing.
- The highest-value artifact in this repository is the golden suite, not the CLI.
- The two seductive failures: prose rules instead of checks, and letting a model resolve a mapping
  because writing the table is slower. Both destroy reproducibility, the one property worth
  defending.
- The workshop export is a reference input, not a workspace. Work on a copy under `fixtures/`.

# Handoff for the agent picking this up

You are building **design-compiler** in this repository. The spec is written, the input side of the
tool exists, and the first emitter exists too: capture to the IR, IR to compiling Compose. The other
three targets are still unwritten. The human is running a Kotlin workshop elsewhere and is not available for open-ended
questions; ask one focused question only when a real product decision is blocking, otherwise follow
the spec and record the assumption.

## What this project is

A converter from a Claude Design export (HTML plus a token file that follow a strict contract) into
compiling UI code: Compose Multiplatform first, then React Native, then React web. The output is
structure with values already resolved: geometry, colors as Material role references, type roles,
component boundaries, props and empty callbacks. **No logic, no state, no navigation.** Everything
the design showed is either a resolved value or a \`// TODO\` marker.

The purpose is to stop every future agent from spending context rediscovering facts the browser
already resolved. The converter does that rediscovery once, deterministically.

## The three invariants. They outrank your judgment.

1. **Determinism.** Same input plus config yields byte-identical output. No timestamps in generated
   files, no unordered iteration, and **no model call anywhere in a mapping path**. Reproducibility
   is the entire reason this exists rather than a chat message.
2. **The model is never the parser and never resolves a value.** Not a color role, not a component
   name, not a type role. At most it *suggests* a name for a component that has no label, and the
   suggestion is labeled as a suggestion in the output. Table lookups only.
3. **Refuse instead of invent.** An unmappable case is a diagnostic with options and exit code 3, not
   a clever workaround. Every invented workaround becomes a behavior someone debugs later. A
   converter whose output cannot be trusted is worse than none, because it moves work from writing to
   reviewing.

## Read in this order, before writing code

| Order | File |
| --- | --- |
| 1 | README.md |
| 2 | odd/tasks/design-compiler.md, including the "What changed" table |
| 3 | spec/01-input-contract.md, read against the amendment note below |
| 4 | spec/02-ir.md |
| 5 | spec/13-bridge.md, the layer between an export and the IR |
| 6 | spec/03-extraction.md |
| 7 | spec/04-mapping-compose.md |
| 8 | spec/corner-cases.md |
| 9 | spec/07-validator.md |

Then spec/05 to spec/11 as each task needs them. Do not skip spec/01: it is the premise, and most
"this is hard" reactions come from reading the emitters without it. Do not skip spec/13 either: it is
what keeps a second design tool from costing a new extractor.

## Amendment, written 2026-10-12 after a real export arrived

A Claude Design export now exists at
\`~/Documents/CK/internals/kotlin-workshop-lab/jetcasterDesign\` (read it, never write to it). It is
not the input spec/01 describes. The files are \`\*.dc.html\` templates with \`{{ prop }}\` placeholders
rendered by a generated 69 KB runtime (\`support.js\`: \`<x-dc>\`, \`<sc-if>\`, \`<sc-for>\`, \`<dc-import>\`,
\`style-hover\`), they load \`tokens.css\` and Google Fonts over \`<link>\`, icons are a glyph font with zero
inline SVG, and none of the six \`data-*\` contract attributes are present. In exchange the export
hands over a machine-readable prop schema (\`data-props\` with types, defaults and enum options), a
\`MANIFEST.json\` with screens and states, and \`tokens.json\` with color, typography, shape, spacing and
motion. Read \`odd/tasks/design-compiler.md\` for the full table before believing any sentence in this
file about the input format.

Two consequences that outrank everything below:

1. There is a pipeline stage in front of extraction that the old plan did not have: **materialize a
   frame** (render the board at a chosen \`?frame=\`, \`?theme=\` and prop set in a headless browser), then
   read computed style. \`screens/*.html\` are 412-byte redirects, not designs.
2. The route chosen is prompt first: amend the contract to what Claude Design can actually write,
   regenerate the export until it validates, then build the extractor on annotated HTML. Task T4 is
   the human-in-the-loop round trip that proves the prompt works. Until it passes, the pipeline is
   expected to produce nothing.

## Start here

Status as of 2026-10-14: **T0, T1, T2, T2.5, T3, T3.1 are done, and T5 has its answer written down.**
The input side is built, and the first emitter exists: \`tools/capture.mjs\` (frame to the spec/02 tree)
and \`tools/emit-compose.mjs\` (that tree to \`Color.kt\`, \`Theme.kt\` and one composable, in a
\`ui.generated\` package). \`npm test\` is 198 tests.

T5's decision is recorded in \`odd/tasks/design-compiler.md\`: **grow it into T6, do not throw it
away**, with two named debts. **Debt 1 was paid on 2026-10-14 (\`ded3e16\`), except one decision that
belongs to a human and is still open.** spec/02 now declares \`Node.type\` and \`Node.callback\` as
fields and its enum names Column, Button, IconButton and IconToggleButton, so type roles no longer ride
in \`notes\` and the toggle is named for real. What is NOT resolved: a clickable SURFACE keeps its
surface role (spec/02, and the capture enforces it) and "its boolean is a parameter" is true in prose
but has no carrier, because \`stateProp\` only travels inside \`node.callback\` and a card with no
accessible name has no callback to put it in. The \`selected\` boolean resolves correctly and is then
dropped, with \`callback-inferred\` firing for the wrong reason. T6 needs a field decision for a surface
boolean; do not smuggle it through \`callback\`, which would force inventing a callback name spec/02
forbids. Badge, List, Grid, Progress, Spinner, Snackbar and Tooltip are also still outside the enum.
Debt 2 is mechanical: the emitter reads an in-memory tree, and
T6's contract is an IR on disk, so the seam to extract is \`emitCompose(ir, tokens, opts)\`, which
already takes the IR as a parameter.

**One half of T5 is still open and is not pretending to be closed.** Its acceptance says "compiles
*and* looks like the frame". It compiles: \`:shared:compileKotlinJvm\` exit 0, 5 class files under
\`ui/generated\`, measured against a green baseline. Read that oracle the way \`docs/lessons.md\`
(up-to-date-is-not-a-green-oracle) says: emit first, \`cmp\` the freshly written bytes against the
goldens in the tree that actually compiles, and force the task with \`--rerun\`, because
\`BUILD SUCCESSFUL\` with \`compileKotlinJvm UP-TO-DATE\` reuses a previous verdict and proves nothing
about the bytes in front of you. **It has been rendered, and rendering found two defects the compile
never could** (\`docs/lessons.md\`: negative-padding-crashes, toggle-state-invisible; evidence in the
gitignored \`out/visual-2026-10-14/\`). First: the card died on launch with
\`IllegalArgumentException: Padding must be non-negative\` -- a CSS \`margin: -4px\` had been emitted as
\`Modifier.padding(top = -4.dp)\`, which compiles and matches its golden, and the app crashes. Fixed at
the emitter (non-negative edges only, the dropped edge named with its px value), pinned by a
comment-stripped assertion, and spec/04 trap 2 now says the true thing after the emitter's comment
cited it for a rule it never stated. Second, STILL OPEN: the two \`subscribed\` states render
pixel-identical, because the icon is a constant where the hand-written card branches on the boolean for
glyph, \`contentDescription\` and tint. That one belongs to T7 (states), not to a quick fix.
A render host is cheap and additive: \`git worktree add\` off the same clone (never touch the human's
dirty tree), the scratch composable in \`:shared\` (androidApp measures compose.foundation, so it is not
on its classpath), the activity declared in that worktree's manifest (\`am start\` cannot launch an
undeclared component), and \`applicationIdSuffix \".spike\"\` so it installs beside the human's app and
uninstalls clean. \`emulator-5554\` is attached on this machine. Say all of this before calling T5
finished: the geometry half is now observed and roughly right (the card is 264dp in a 272dp frame), but
the state half is known-broken, which is a different and worse finding than never having looked.

- **T2** added \`node tools/validate.mjs <dir> --json\` (\`npm run validate\`): 24 static checks, 6
  reported \`unimplemented\`, exit codes 0/1/2/3/4 where **4 means the input itself is unreadable or
  malformed**. On \`fixtures/reference\` it exits 1 with 53 errors, and its \`remote-resource\` and
  \`webfont-remote\` counts (10 and 10) agree with \`docs/probe-report.md\`, which is the tool's strongest
  external check.
- **T2.5** added the bridge: \`spec/13-bridge.md\` (source adapters, the SourceModel schema, capture
  over loopback, and the severity class each unknown carries), \`rules/property-ownership.json\` (every
  property the export declares plus the spec line that owns it), \`tools/css-harvest.mjs\` (the one
  canonical CSS reader) and \`tools/property-map.mjs\` (\`npm run properties\`, \`npm run repair\`). It also
  amended \`spec/03\`'s Capture section, which said \`file://\` and "JavaScript disabled": both
  impossible against a real export.
- \`docs/lessons.md\` is the spec/10 log. Read it before touching \`varying-text-marked-as-prop\` or
  \`prop-undeclared\`: they measure different claims, and that discrepancy is deliberately left open.

**Next is T6**, unblocked by T2.5 and by T5's written answer except for its schema debt above, which
is a decision and not a task. **T4** is the human round trip that retires unknown 1 and is the only
task waiting on a person. Read the T5 block in \`odd/tasks/design-compiler.md\` before T6: it names the
two API premises the pinned library refuted, and spec/04 has already been corrected to match the
artifact rather than the memory.

Playwright is now a repo devDependency (1.64); no browser download is needed because the cached
chromium-1243 is located by search and overridable with \`CHROME=\`. A machine without that cache needs
\`npx playwright install chromium\`.

Environment already available on this machine: Node 24, \`npx\`, Playwright with Chromium installed
(\`~/Library/Caches/ms-playwright\`). The workshop project is at
\`~/Documents/CK/internals/kotlin-workshop-lab\`, Kotlin 2.4.20, Compose Multiplatform 1.12.1,
material3 1.12.0-alpha03, and \`:shared:allTests\` plus \`:shared:compileKotlinJvm\` work. There is no
Kotlin CLI on the PATH, so compile through Gradle, and the wrapper is in \`app/\`, not at the repo root:
\`./app/gradlew -p app :shared:compileKotlinJvm\` from the workshop root, or \`cd app && ./gradlew
:shared:compileKotlinJvm\`. Measured both ways, exit 0. Add \`--rerun\` when the point of the run is to
prove freshly emitted bytes compile: otherwise Gradle answers the question "did this change the ABI?"
and reports UP-TO-DATE.

Two rules about that repo, which is not yours. It carries the human's uncommitted work (\`docs/\`,
\`guide/\`, \`odd/\`, \`tools/\`), so commit nothing there: emitted files stay additive and untracked.
And emit only into \`ui.generated\`. \`ui.theme\` and \`ui.components\` already declare a \`Color\`, a
\`Theme\` and a \`PodcastCard\` by hand, and a second top-level declaration is a redeclaration error
that looks like a mystery until you notice which package you wrote into.

## Rules of engagement

- **A count is a measurement, not a memory.** The bridge gap was written as "18 of the 50 CSS
  properties"; measured it is 16 of 53, and the difference is a property regex dropping
  \`-webkit-*\` plus shorthands the browser expands. \`npm run properties\` recomputes it and a test pins
  the numbers, so a future edit argues with the tool instead of with a paragraph.
- **A spec edit moves citations, and that is a check rather than a nuisance.**
  \`rules/property-ownership.json\` points at spec lines by \`spec/<file>.md:<line>\`. Editing any spec
  above a mapping row breaks them: amending spec/03's Capture section moved 20 at once.
  \`node tools/property-map.mjs --relocate\` applies the ones that are provably a move and refuses the
  ones where two rows could own the property, because that choice belongs to a human.
- **Whether a shorthand resets a longhand is a browser fact.** Every reset claim in spec/13 was
  measured in the Chromium this capture uses, not recalled: \`font\` does not reset \`letter-spacing\`,
  \`border\` does not reset \`border-radius\`, \`overflow\` does reset \`overflow-y\`. A mapping built on the
  remembered answer drops design intent silently.
- **Work the ODD list.** T0 to T15 exist with blockers. One task at a time, mark progress in
  \`odd/tasks/design-compiler.md\`, and never mark a task done while a check fails.
- **Read before you overwrite.** \`odd/tasks/design-compiler.md\` is a reconciled document with outcome
  evidence in it, not a scratch pad. Read the file at HEAD before writing it. Rebuilding it from a
  summary destroyed 27 KB of that evidence once already (2026-10-13, recovered from git); amend the
  existing task entries in place instead.
- **A check that fires is not a check that is right.** T2's first draft produced 58 \`prop-undeclared\`
  findings on the reference export, and every one was a glyph name or board annotation. When a count
  looks large, compare it against what the spec says about that export before believing it: spec/07
  predicted 0, and 0 was correct.
- **A mapping bug needs a fixture.** Golden tests are the actual product. Every corner case you meet
  becomes an input fixture plus the expected emitted file, plus a determinism assertion. A bug
  without a fixture is not fixed, it is merely unused today.
- **Lessons become checks, never prose.** spec/10 is explicit about this. A new paragraph in a
  generation prompt is a rule some runs obey. Convert it to a validator check, a mapping table row,
  or a fixture. Append one greppable line to the lesson log: date, code, kind, outcome.
- **When inference fails, add a contract field.** Ask what the design tool could have told us, add
  the field to spec/01, and add the requirement to spec/08, in the same commit. A heuristic is the
  fallback, not the plan.
- **Inputs are immutable.** Never write into an export folder. Output goes to \`out/\` or the configured
  directory, and never overwrite without showing a diff.
- **Numbers come from the pinned artifact, not from memory.** The type scale, shape ladder, elevation
  ladder and state opacities in spec/03 were read out of the material3 sources jar, not recalled.
  Re-verify against the pinned version; a mismatch is an emitter bug, not a design issue. The jar is
  in the Gradle cache under \`org.jetbrains.compose.material3\`.
- **ASCII only** in every artifact. Check with
  \`rg -n '[\\x{2014}\\x{2013}\\x{201C}\\x{201D}\\x{2018}\\x{2019}\\x{2026}\\x{2192}\\x{2022}\\x{00A0}\\x{200B}]' <file>\`.
- **No commit, push or PR without an explicit ask.** Work-unit commits on a feature branch are
  expected once implementation starts; delivery is the human's decision.

## Decisions already taken, do not relitigate

- The input is a contract, not arbitrary HTML. Supporting random HTML is out of scope.
- Compose Multiplatform is the primary target; RN second; web third and skippable if no component
  library is in play.
- Elevation is declared with \`data-elevation\`, never inferred from \`box-shadow\`. M3 elevation is tonal
  and CSS shadows are black; no formula maps them honestly. Measured limit on that wording, so it is not
  relitigated, just bounded: \`Card\` in the pinned material3 exposes no tonal parameter at all, so a
  declared level reaches a Card as \`defaultElevation\`. The decision (declare it, never read a shadow)
  is untouched and is the part that matters.
- Two \`ColorScheme\` objects, not one with modes. No Android \`Context\` and no dynamic color call in
  \`commonMain\`; dynamic color stays Android-only behind an \`expect\`/\`actual\`.
- Figma goes through the plugin import (spec/11 Route A). The Figma API emitter stays unbuilt until a
  regeneration workflow genuinely needs it.
- React Native CSS Grid is a configuration decision (fixed \`numColumns\`, FlashList, or flexWrap), stated
  in a comment, never quietly faked.

## Things the human will want to know without asking

- Which mapping you refused and why, in one line.
- The \`TODO markers per component\` count, since it is the honest measure of what the tool could not
  decide. Zero is a red flag, not a win: it means it guessed.
- Whether the emitted file compiled. That is the only pass/fail that matters.

## When you are stuck

Prefer a failing test with a fixture over a workaround. Prefer one focused question over an
assumption when a product decision is genuinely open (for example "should the now playing bar
overlay or push the list"). Prefer a \`refused\` report over emitting something plausible.

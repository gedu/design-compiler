# Handoff for the agent picking this up

You are building **design-compiler** in this repository. It is a fresh repo with a written spec and
no code yet. The human is running a Kotlin workshop elsewhere and is not available for open-ended
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
| 5 | spec/03-extraction.md |
| 6 | spec/04-mapping-compose.md |
| 7 | spec/corner-cases.md |
| 8 | spec/07-validator.md |

Then spec/05 to spec/11 as each task needs them. Do not skip spec/01: it is the premise, and most
"this is hard" reactions come from reading the emitters without it.

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

Task **T0** in \`odd/tasks/design-compiler.md\`, and only T0: format probe and frame materialization.
It answers whether the runtime renders offline over \`file://\` with remote requests blocked, and
whether \`?frame=\` isolates one frame. Playwright is **not installed** on this machine; only its browser
binaries are cached. The old spike moved to **T5**, which answers the original unknown (is computed
style enough to emit code that looks like the design) on a hand-annotated fixture, so it does not
block on the prompt loop. Do not start T6 until T5 has an answer written down.

Environment already available on this machine: Node 24, \`npx\`, Playwright with Chromium installed
(\`~/Library/Caches/ms-playwright\`). The workshop project is at
\`~/Documents/CK/internals/kotlin-workshop-lab\`, Kotlin 2.4.20, Compose Multiplatform 1.12.1,
material3 1.12.0-alpha03, and \`./gradlew :shared:allTests\` plus \`:shared:compileKotlinJvm\` work. There
is no Kotlin CLI on the PATH, so compile through Gradle.

## Rules of engagement

- **Work the ODD list.** T0 to T11 exist with blockers. One task at a time, mark progress in
  \`odd/tasks/design-compiler.md\`, and never mark a task done while a check fails.
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
  and CSS shadows are black; no formula maps them honestly.
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

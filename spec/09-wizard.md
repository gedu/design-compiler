# 09 Wizard and CLI

The wizard exists for one reason: a first run should not require reading eight specs. It assembles
the design prompt, runs the conversion, and surfaces decisions instead of silently making them.

Two modes, one implementation behind both: \`convert\` for scripts and CI, and \`design\` for humans.

## design (the wizard)

~~~text
$ npx design-compiler design
? What are you building?            Mini Jetcaster
? Target platforms                  Compose Multiplatform, React Native
? Where is the Claude Design export? ./docs/design
? Contract check                    18 errors, 6 warnings   [show] [continue anyway]
? Targets need decisions            2   [resolve]
    - React Native grid: the design is adaptive, RN is not.
        [x] FlatList numColumns=4  [ ] FlashList  [ ] flexWrap container
    - Elevation: 4 surfaces show a shadow with no data-elevation.
        [x] treat as flat  [ ] map to level 1  [ ] fix the export
? Generate the Claude Design prompt?       [y] -> out/DESIGN-PROMPT.md  (paste it there)
? Emit                          Compose: 7 files, RN: 7 files
? Next                          run the build check  [y]
~~~

### Steps

| Step | Behavior |
| --- | --- |
| Locate the export | accept a folder, a \`.zip\` from Claude Design, or a single HTML plus a token file; unzip in place, never mutate the input |
| Validate | run the full contract check before anything else. Offer the report, and never proceed past an error without an explicit choice, recorded in the run report |
| Target decisions | the \`refused\` list from the report, asked one at a time with options. Each answer is written to the project config, so the next run is silent |
| Prompt assembly | build spec/08's prompt for the chosen targets and write it to \`DESIGN-PROMPT.md\`. The wizard does not call the design tool; the human pastes the prompt there |

### The prompt artifact

The prompt is a markdown document, so it is emitted as one: \`out/DESIGN-PROMPT.md\` by default, and
into the design folder when one is already selected, because that is where the human looks for it.

| Rule | Why |
| --- | --- |
| The file body **is** the prompt: starts with the prompt text, ends with it | \`pbcopy < DESIGN-PROMPT.md\` and select-all are both correct; a header block of metadata gets pasted into the design tool by someone in a hurry and becomes part of the instruction |
| Provenance goes in a sidecar \`DESIGN-PROMPT.md.json\`: targets, contract version, tool version, config hash | reviewable without polluting the thing being pasted |
| Markdown is the format, not decoration: headings for sections, tables for the token and role lists, fenced blocks only where the design tool must copy markup | the design tool reads markdown well, and a human reviewing it can skim the sections they care about |
| The markup contract block is generated from the validator's own rule table | the prompt cannot ask for something the validator does not check, nor omit something it does |
| Regenerating overwrites only after showing a diff | a hand-edited prompt is a real artifact someone tuned; silently overwriting it loses that work |

What the document contains, in order: the target-awareness paragraph, one block per chosen target,
the markup contract requirements, the design-for-convertibility advice, and the machine-readable
decisions-file requirement with its example. Anything the validator cannot check lives in the advice
section, never in the requirements section.
| Emit | one pass per target, into an output directory, never overwriting without a diff prompt |
| Build check | run the target's own compiler if it is reachable: \`gradlew :shared:compileKotlinJvm\`, \`tsc --noEmit\`, a linter. A generated file that does not compile is the only failure that matters |
| Report | the two numbers that matter: files emitted, TODO markers left, plus the diagnostic summary |

## convert (the scriptable path)

~~~text
npx design-compiler convert --input ./docs/design --target compose --config design-compiler.json
npx design-compiler validate ./docs/design --json
npx design-compiler ir ./docs/design --out .ir/            # inspect the intermediate tree
npx design-compiler prompt --target compose --out prompt.txt
npx design-compiler diff --target compose --baseline .baseline/
~~~

\`--json\` everywhere, exit code 0 only on zero errors. CI is the intended consumer of \`validate\` and
\`diff\`.

## Project config

One file, written by the wizard, committed to the consuming project. It is where a decision lives so
it stops being asked.

~~~json
{
  "tokens": "tokens.json",
  "targets": ["compose", "react-native"],
  "compose": {
    "basePackage": "com.callstack.minijetcaster",
    "outputDir": "../app/shared/src/commonMain/kotlin",
    "material3": "1.12.0-alpha03",
    "multiplatform": true,
    "dynamicColor": "android-only",
    "icons": "inline-svg"
  },
  "reactNative": {
    "outputDir": "../rn/src/ui",
    "styleStrategy": "stylesheet",
    "grid": "flatlist-fixed",
    "elevation": "surface-steps",
    "iconLibrary": "none"
  },
  "decisions": {
    "elevation-unlabeled": "treat-as-flat",
    "radius-off-ladder": "emit-raw-and-warn"
  }
}
~~~

Rules the config must obey:

- Anything in \`decisions\` is a standing choice with a diagnostic attached. Reading it back prints the
  diagnostics it silenced, so a config cannot quietly swallow a growing pile of warnings.
- Version pins (\`material3\`) are asserted against the real project file when the output directory is
  inside a Gradle or npm project. A mismatch is an error: expressive components that do not exist in
  the pinned version are the classic silent failure.
- The config never holds colors, sizes or names. Those come from the export, and duplicating them is
  how a project ends up with two sources of truth.

## Guardrails

- **Never write into the export folder.** Inputs are immutable; output goes to \`out/\` or the configured
  directory, and a collision asks.
- **Never overwrite without a diff.** The first run produces a baseline; the second shows what
  changed, per file. Reviewing a regeneration means reading a diff, not a directory.
- **Never continue past an error without recording it.** The run report shows which errors were
  bypassed. A bypass with no record is how generated garbage becomes a pull request.
- **Determinism as a hard feature.** Same input, same config, byte-identical output. No timestamps in
  generated files, no iteration over unordered maps, stable identifiers. Without this, \`diff\` is
  useless and golden tests are noise.
- **No network, ever.** The tool reads files and shells out to the target's own compiler when asked.
  It must not phone a design service, a font CDN or a model API to finish a conversion.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | success, zero errors |
| 1 | contract errors, nothing emitted |
| 2 | emitted with warnings |
| 3 | refused: unresolved target decisions |
| 4 | build check failed |

CI can then treat 2 as "look at this" and 3 as "a human must choose", which is the distinction that
matters day to day.

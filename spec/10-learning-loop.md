# 10 Learning loop

The user-visible promise of this project is that it gets better with every screen. That has to mean
something mechanical, or it is a pile of notes nobody reads. The rule this project follows:

> Every lesson lands as a check, a mapping rule, or a fixture. Never as prose in a prompt.

A new prose rule is a rule that will be forgotten, argued about, and violated by the next agent. A
check is a rule that runs.

## The three sinks

| Lesson type | Sink | Example |
| --- | --- | --- |
| The design tool produced something off-contract | a **validator check** plus a **fixture** that triggers it | a webfont snuck in: \`webfont-remote\`, fixture \`webfont-import/\` |
| A mapping produced wrong code | a **golden test**: input frame, expected emitted file | the corner-clip case, fixture \`rounded-card-cover/\` |
| A design decision the converter cannot know | a **contract field** plus a prompt requirement | \`data-elevation\` exists because inferring elevation from a shadow was impossible |

The third is the most valuable and the most tempting to skip. When inference fails, do not write a
smarter heuristic first. Ask what the design tool could have told us, add the field, and ask the
design tool for it. Heuristics are the fallback, not the plan.

## The loop, per screen

1. Generate a design with Claude Design, using the assembled prompt for the target.
2. Run \`convert --validate\`. Read the diagnostics, not the code.
3. Classify each diagnostic:
   - **design-side**: the prompt did not ask for it, or the tool ignored it. Fix the prompt, or the
     tool's compliance. Add a fixture.
   - **converter-side**: the check was wrong or too strict. Fix the check.
   - **mapping-side**: the emitted code is wrong. Add a golden test with this frame as input.
   - **genuine design gap**: the design is missing a state or a constraint. That is a conversation
     with the design, not a code change.
4. Fix one class at a time. Rerun. Keep the export as a fixture.
5. Record in the lesson log **only** the pointer: fixture name, check added, rule changed. The log is
   an index, not a diary.

One screen is about ten minutes of classification. The value compounds because every fixture makes
the next target's regression suite real rather than theoretical.

## The lesson log

Append-only, one line each, machine greppable. It is deliberately boring.

~~~text
2026-10-10 clip-missing  rule    fixtures/rounded-card-cover -> clip parent shape
2026-10-10 weight-400    prompt  titleMedium needs weight 500 stated in prompt
2026-10-11 grid-min      contract  data-grid-min added, inferring track width is guesswork
2026-10-12 margin-collapse fix     drop child margins, prefer spacedBy, report original
~~~

Fields: date, code, kind (\`rule\`, \`prompt\`, \`contract\`, \`fix\`, \`check\`, \`golden\`), one-line outcome. When a
line says \`contract\`, the corresponding spec/01 and spec/08 edits land in the same commit, otherwise
the contract and the prompt drift, which is the failure mode of this whole category of project.

## Golden tests as the real product

The emitted files are the tests. For each fixture: input HTML, expected output file, and a
determinism assertion (two runs byte-identical). Then:

- Compose fixtures compile in the CI job. Compilation is the strongest oracle available and it is
  free.
- RN fixtures typecheck with \`tsc --noEmit\`, and pass a \`react-native\` lint config.
- Web fixtures typecheck and their CSS parses.
- IR fixtures are stable under schema version assertions.

A mapping bug that is not represented by a fixture is not fixed; it is merely unused today.

## What "training" must not mean

Three traps this project should refuse:

1. **Do not tune the converter with more prompt prose.** Every paragraph added to the generation
   prompt is a rule that only some runs honor. Convert prose into a check or delete it.
2. **Do not feed the whole lesson log into a generation context.** Retrieval over a growing log is
   how a converter starts producing output that depends on which notes it happened to retrieve. The
   log informs humans and tests; the code is the only thing that informs emission.
3. **Do not let the LLM write the mapping.** The model is used twice at most: optionally to name a
   component when the label is missing (a suggestion, always reported), and optionally to summarize
   diagnostics for a human. Every mapping decision is a table lookup. The moment a model picks a
   \`ColorScheme\` role, the output stops being reproducible, and reproducibility is the entire reason
   this tool exists instead of a chat message.

## Measuring improvement

Three numbers per release, cheap to compute from the report files:

- **errors per export** at first run: should trend to zero without touching the export.
- **TODO markers per component** in emitted code: the honest measure of what the tool could not
  decide. It should fall as the contract grows and stabilize above zero, because a zero would mean
  the tool is inventing rather than deferring.
- **manual edits to first compiling screen**: lines changed by hand after conversion. This is the
  only number that matters to a user, and the other two exist to explain it.

If TODO markers go to zero while manual edits stay flat, the tool is guessing silently. Treat that
as a regression even though the report looks clean.

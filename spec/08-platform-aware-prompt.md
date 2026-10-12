# 08 Platform-aware Claude Design prompt

The design tool has to know the final target, because a design that is beautiful in a browser can
be unmappable, and the converter is not the place to discover that. This spec is the delta on top of
the workshop design prompt: it keeps its color and platform rules and adds target awareness.

## The problem it solves

A generic prompt produces designs that assume CSS: negative margins, backdrop blur, a CSS grid
with stacked items, a webfont, an icon font, hover-only affordances. Every one of those costs a
manual decision at conversion time. Naming the target up front converts those into constraints the
design resolves while it still has options.

## Target blocks

The wizard assembles the prompt from a shared base plus exactly one block per target. The blocks are
additive and must never contradict each other.

**The text lives in \`rules/target-blocks.json\`, not in this file.** As of T3 the assembler reads
that file, so a block written by hand here is a block nobody runs: what stays below is why each
block says what it says, and the shape of the data.

### Base (always)

The existing rules from the workshop prompt, unchanged: Material 3 role whitelist only, both
schemes, real content, per-component spec, the machine-readable manifest. Then the target-awareness
paragraph from the data file, which names the selected targets and adds the consequence of naming
more than one: with several targets selected, a capability only one of them has is a capability the
design may not use.

### Shape of one entry

\`id\` is what \`--target\` takes; \`label\` is the name the design tool sees; \`block\` is the prompt
text. Two further fields exist only to make "the blocks must never contradict each other" a check
instead of a wish:

| Field | What it is |
| --- | --- |
| \`topics\` | every subject this block makes a claim about: \`clipping\`, \`elevation\`, \`fonts\`, \`grid\`, \`icons\`, \`safe-area\`, \`shadows\`, \`states\`, \`text-overflow\`, \`units\` |
| \`claims\` | the exact sentence this block says about each of those topics |

The assembler then requires three things, and refuses or reports a data error rather than emitting a
document that breaks them:

1. every claim appears verbatim as one line of its own block (a statement outside the block would
   escape the check below);
2. two selected targets sharing a topic must state it identically, or the run exits 3 and writes
   nothing -- this is the rule this spec has always asked for, and it is now a check;
3. a shared statement is emitted **once**, under a heading saying it applies to every named target,
   instead of once per block that mentioned it.

Consequence worth understanding before adding a topic: a topic is a claim about *all* selected
targets, so it must be true of every target that declares it. "There is no CSS Grid" is true of
Compose, React Native and SwiftUI and therefore cannot be a topic while React web can be selected;
what is true of all four is that a grid is a declared decision (\`data-grid-min\`), which is the
sentence the \`grid\` topic carries. The layout engine of each target stays an untopiced line inside
that target's own block, where it is allowed to differ -- that difference is the reason a target
block exists at all.

### Per-target content

| Target | Lines that belong to it alone |
| --- | --- |
| \`compose\` | Row/Column/Box/FlowRow and lazy lists, no margin or box model, Arrangement and Alignment; container tiers instead of alpha; one code path for desktop, iOS and Android |
| \`react-native\` | Yoga flex only, no grid container or subgrid; no backdrop-filter, clip-path, blend modes or pseudo elements; a weight above regular needs the font bundled; shadows are platform-specific work |
| \`react-web\` | the one target that keeps CSS layout, so a CSS grid here must still be expressible by the others; component library props over raw CSS, named in the brief; colors stay custom properties |
| \`swiftui\` | stacks plus \`LazyVStack\`/\`LazyVGrid\`/\`Grid\`, no CSS box model; text carries a style and grows, containers wrap instead of clipping; anything unnamed in the design has no name in the code; **the mapping for this target does not exist yet** |

The SwiftUI block is new in T3 and is deliberately short. spec/12 for SwiftUI is deferred to T11
with the emitter, so this block states limits a design must respect and says in the document itself
that no API mapping has been verified. Adding an API name to it before T11 would be inventing a
mapping in the one place a wrong one is free to write and expensive to discover.

## Contract annotations the prompt must require

This block is **generated from \`rules/contract-rules.json\`**, from every row whose \`prompt\` field is
\`\"ask\"\`: the 25 \`author\` rows plus the 12 \`tool-behavior\` rows this repo decided to negotiate. Which
rows participate is a field in the table, not a list repeated here. The rule table is the only source
of truth: the prompt builder (\`tools/prompt.mjs\`, task T3) reads the same rows the validator reads, so
a rule cannot be asked for in prose that no check enforces, and a check cannot fire on something the
prompt never mentioned. Restating the list in prose here is how the prompt and the validator drift
apart, so this section keeps one example and points at the table.

\`owner: "runtime"\` rows are never emitted into the prompt: \`<x-dc>\`, \`<sc-if>\`, \`<sc-for>\`,
\`<dc-import>\`, \`<helmet>\`, the \`style-*\` attributes and the \`{{ }}\` mechanism come from \`support.js\`,
which ships inside the export with "do not edit" in its header. Asking for them is asking the design
tool to patch its own runtime. See spec/01, "Who owns the markup".

The generated text is one bullet per row, the row's \`ask\` field verbatim, and nothing else: no rule
code, no severity, no mention of the tool that assembled the file. Sorted by rule \`id\` and not by
table order, so that appending a row to the JSON cannot reorder a prompt nobody re-reads:

~~~text
CONTRACT REQUIREMENTS. Every line below is checked on what you export, and a miss is a failure
reported back to you.
- Write a brief listing the values you invented and the decisions a reader cannot see in the markup...
- Write every color as a custom property whose name is a Material role...

(one bullet per row with prompt "ask"; 37 of them today -- see rules/contract-rules.json, where
severity, owner, code and fix hint live with spec/07)
~~~

Rules that are \`violated\` on the reference export and unsatisfiable as written must not be generated
into the prompt until they are re-decided. That is what \`prompt: "silent"\` plus \`promptNote\` is for:
today \`paint-without-js\` (the format needs \`support.js\` to build any tree), \`frame-fixed-width\` (one
board reflows across width classes) and \`dark-reachable-prefers-color-scheme\` are held out, alongside
the 11 \`runtime\` rows that can never be asked of a design tool. The assembler emits a silent row's
text nowhere, and a test asserts that.

## What the assembled document is, and how it is proven

\`node tools/prompt.mjs --target compose --target react-native --out out/DESIGN-PROMPT.md\` writes one
file whose **first line is prompt text**: no header, no front matter, no provenance comment, because a
human pastes the whole file into the design tool and anything above the first rule is a rule the tool
reads twice. Provenance goes to the sidecar \`<out>.json\` -- sorted targets, the sha256 of both data
files, the tool version -- and contains no timestamp and no path, so a rerun is byte-identical and the
hash still says which inputs produced a prompt that is sitting in someone's clipboard.

Order in the file: target awareness, one block per selected target in the order given on the command
line, the shared target rules, the contract requirements, the advice below, the decisions file. Exit
codes: 0 wrote a file, 2 the call or a data file is malformed, 3 assembling this would put a
contradiction in front of the design tool (unknown target, no target, a target twice, two blocks that
disagree). One line on stderr in every case.

The document is golden-tested at \`tests/golden/\`: \`npm test\` compares the assembled bytes, and only
\`node tests/prompt.test.mjs --update\` rewrites them. A prompt change that arrives as a silent golden
update is a prompt nobody reviewed, which is the failure mode this whole repo exists to avoid.

## Design-for-convertibility, the rules worth stating as design advice

Not contract items, but they make the output better and cost nothing. Five of them ship in the
prompt, and their text is \`advice\` in \`rules/target-blocks.json\`: one component with its states
instead of one frame per state, the empty/loading/error variants, the longest realistic string, two
width classes or more, and a statement of the decisions a reader cannot see in the markup. They stay
out of the contract section because nothing checks them, and a rule no check enforces belongs here.

## The design brief as a converter input

Have the design tool emit a machine-readable decisions file, not only prose. The example the prompt
shows is \`decisionsExample\` in \`rules/target-blocks.json\`: components with their states, props and
evidenced actions, plus \`invented\` and \`open\` lists.

When this file exists, the converter reads it instead of inferring, and the \`ComponentGroup\` params
become input rather than detection. When it disagrees with the HTML, the HTML wins and the
disagreement is reported: markup is what was looked at, JSON is what was claimed.

## Maintenance, because this prompt will drift

- One source of truth per rule, and it is \`rules/contract-rules.json\`. The requirement block in the
  prompt is generated from it, the validator reads the same rows, and spec/01 keeps only the
  reasoning. A rule written by hand in two of those three places rots in the third.
- Same for the prose of the prompt itself: target text, headings, advice and the decisions example
  live in \`rules/target-blocks.json\`. The golden files in \`tests/golden/\` are the rendered result,
  so a reviewer reads those to see what a change actually says.
- Every rule here must be checkable by the validator or it is decoration. When a rule cannot be
  checked, move it to the advice section instead of the contract section.
- Test the prompt by running the validator on its own output. The check is: does a fresh export pass
  with zero errors? An export that needs manual fixes means the prompt is not asking for the right
  thing, and the fix is the prompt, not the file.
- Keep target blocks additive. If two blocks both speak about shadows and disagree, the assembler
  fails rather than concatenates: \`topics\` and \`claims\` in \`rules/target-blocks.json\` make that a
  check that runs on every assembly, not a review comment. A new topic must therefore be a statement
  that is true of every target declaring it -- see "Shape of one entry" above.
- The prompt is not allowed to mention this repository. It is pasted into a tool that cannot see
  spec files, rule ids, or the converter's internals, so a requirement must stand alone as an
  instruction about what to draw; \`tests/prompt.test.mjs\` asserts no \`spec/\` path and no rule id
  reaches the output.

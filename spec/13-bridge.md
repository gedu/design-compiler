# 13 The bridge: from an export to something the IR may read

spec/02 says "a target that peeks at HTML is a bug". spec/03 begins at "read computed style". Neither
of them says who turns a Claude Design export into the thing spec/03 walks, and nothing said it until
this file. That silence is the reason this task exists: an unowned layer gets implemented inside the
first emitter that needs it, and then every later source tool pays for it.

The bridge is the layer in front of extraction. It owns format, provenance and honesty about what it
did not understand. It does not own meaning.

~~~text
source export --[adapter]--> SourceModel --[capture]--> resolved tree --[reduce/resolve]--> IR (spec/02)
                 per tool        raw, named        browser decides        spec/03
~~~

Emitters read the IR. Nothing else. A source tool is supported by writing an adapter, never by editing
the extractor, which is what makes the second source tool (spec/11 Figma) cheaper than the first.

## Why two stages and not one

The temptation is to normalize straight into IR-shaped objects while parsing, because it saves a data
structure. It costs the one property worth defending: an adapter that resolves values cannot report
what it failed to resolve, because "resolved" and "guessed" look the same in its output.

So the SourceModel is deliberately unhelpful. It holds declarations the export wrote, in the order the
export wrote them, with the file and line each came from, and nothing else. Value resolution happens
after capture, once the browser has decided. spec/03's rule -- read computed style, never parse CSS
text -- is about the resolved side; the raw side still has to be *recorded*, because a computed value
cannot tell you it was authored as a placeholder.

## The adapter contract

An adapter is the only code allowed to know what a \`.dc.html\` file is. Four obligations, each with a
measurement behind it:

| Obligation | Why, measured on \`fixtures/reference\` |
| --- | --- |
| Emit nodes, declarations, attributes and hints; interpret nothing | 53 distinct CSS properties in 887 declarations across 5 templates. Deciding what any of them *means* is spec/03 and spec/04's job. |
| Keep \`{{ }}\` holes opaque and name them | 256 holes in the templates. \`overflow-y: {{ bodyScroll }}\` is one of the three places the export declares a scroll pane, and a reader whose value pattern stops at \`{\` silently loses all three. |
| Read \`style\` as an ordered list, never a map | \`margin: 8px\` after \`margin-left: 40px\` in one attribute wins, and the browser's reset order is not the author's intent. Measured in Chromium: \`margin\`, \`padding\`, \`font\`, \`border\`, \`overflow\`, \`gap\`, \`flex\` and \`background\` each reset their longhands; \`font\` does **not** reset \`letter-spacing\`, \`border\` does **not** reset \`border-radius\`, \`outline\` does **not** reset \`outline-offset\`. Order is the only safe record. |
| Report what it could not parse, and stop | spec/03's reduction rules read \`data-*\` attributes; 0 of the 9 contract attributes exist in this export, so an adapter that "normalizes" them away destroys the evidence the validator needs. |

Hints are a first-class channel, not an afterthought. The runtime puts declared intent in attributes
no spec consumes today, all of it free evidence a browser would otherwise have to be measured for:

| Attribute | Uses | What it declares |
| --- | --- | --- |
| \`hint-size\` | 28 | the box a \`<dc-import>\` was authored at (\`360px,800px\`, \`168px,250px\`), which is the frame width the capture should use instead of a guess |
| \`hint-placeholder-val\` | 26 | the value substituted for a hole, so a prop-driven boolean is known without rendering |
| \`hint-placeholder-count\` | 5 | how many repetitions a list renders (\`<sc-for list="{{ chips }}" hint-placeholder-count="3">\`), which is repetition intent stated rather than inferred |
| \`style-hover\` | 10 | a state painted in an attribute instead of a CSS rule, so a hover is a declaration and not a \`:hover\` to reconstruct |

\`spec/01\` notices these attributes; nothing consumed them, and spec/04:147 still plans to *measure* an
icon placeholder in a browser that was handed its size for free.

## SourceModel

One document per export root. Values are absent by design; \`capture\` is where the browser answers.

~~~json
{
  "schema": "source-model/1",
  "source": { "tool": "claude-design", "adapter": "dc-html/1", "root": "Mini Jetcaster.dc.html" },
  "files": [ { "path": "PodcastCard.dc.html", "sha256": "..." } ],
  "frames": [ { "id": "PodcastCard", "template": "PodcastCard.dc.html", "query": { "frame": "PodcastCard" },
                "authored_size": { "w": 168, "h": 250, "from": "hint-size" }, "states": ["populated"] } ],
  "nodes": [
    { "id": "s:PodcastCard:12", "tag": "div", "parent": "s:PodcastCard:11", "index": 3,
      "attrs": { "class": "cover", "data-props": "..." },
      "style": [
        { "order": 0, "prop": "box-sizing", "value": "border-box",
          "from": { "file": "PodcastCard.dc.html", "line": 21, "in": "style-attr" } },
        { "order": 1, "prop": "width", "value": "{{ }}", "hole": "w",
          "from": { "file": "PodcastCard.dc.html", "line": 21, "in": "style-attr" } }
      ],
      "hints": { "hover": "background: var(--md-sys-color-surface-container-high);" },
      "text": null, "repeat": null, "import": null }
  ],
  "props": [ { "component": "PodcastCard", "name": "subscribed", "tsType": "boolean", "default": false } ],
  "unknowns": [ { "...": "Diagnostic, spec/02 shape" } ],
  "capture": { "transport": "loopback", "vendor_lock_sha256": "...", "blocked_requests": 0,
               "unresolved_placeholders": 0, "fonts_ready": true }
}
~~~

Three fields carry the whole argument:

- **\`style\` is an ordered list with \`order\`.** A map would keep one declaration per property and
  silently pick a winner, which is the bug the reset table above exists to prevent.
- **\`from\` is mandatory on every declaration.** Provenance is what lets a later diagnostic say "line 21
  of your file" instead of "the computed value was odd", and it is what makes the repair report
  paste-able back to the tool that wrote it.
- **\`unknowns\` is part of the document, not a side channel.** An adapter that understood 90% and said
  nothing is the failure mode this entire project was written to avoid.

The \`props\` block is the upgrade the real format handed over: a prop schema with \`tsType\` and
defaults, so parameters are read rather than detected. It arrives here as data and is consumed in
spec/03's detection step.

## Capture: over loopback, not \`file://\`

The Capture section of spec/03 used to read "\`file://\` URL, JavaScript disabled, network blocked at
the browser level". It is amended in this same change. That instruction predates any real export and is
wrong in both halves, measured in \`docs/probe-report.md\`:

- \`file://\` cannot work. \`<dc-import>\` is resolved at runtime by fetching the sibling \`.dc.html\`, and a
  \`file://\` page has a null origin: \`[dc-runtime] sibling fetch for "PodcastCard" threw: ./PodcastCard.dc
  html TypeError: Failed to fetch\`. Reproduce with \`node tools/probe.mjs --frame PodcastCard
  --file-protocol\`.
- JavaScript cannot be disabled, because \`support.js\` builds the tree. That is why \`js-dependent-paint\`
  is kept \`violated\` in the contract rather than deleted: the workaround is the pipeline, and the row
  records it.

The transport is therefore \`tools/serve.mjs\` on \`127.0.0.1\` over one directory, with the offline
guarantee moved to the request router: a request that is not loopback and not pinned in
\`.vendor/vendor-lock.json\` is aborted and counted. That is a claim a test can check, which "we used a
file URL" never was. Two health gates, both measured by \`tools/probe.mjs\`, must be zero before any
computed style is trusted: \`blocked_requests\` and \`unresolved_placeholders\`. Geometry is read after
\`document.fonts.ready\`; reading it earlier measures a different font and is not reproducible.

Capture is where the shorthand question dissolves. Measured over \`PodcastCard\`: 124 visible elements,
562 computed properties, and all 53 authored names readable after expansion. \`font\`, \`background\`,
\`flex\`, \`margin\`, \`padding\`, \`outline\`, \`overflow\`, \`gap\`, \`border\` and others are shorthands the
browser expands into longhands, so the mapping contract is written in longhands and the IR never sees
a shorthand. This is not a theoretical cleanup: spec/03 detects a scroll container by reading
\`overflow-y\`, and a naive reader that truncates at a \`{{ }}\` loses all three instances of it.

## Unknown properties: severity is data

An unknown property is never silently dropped, and never judged at emission time. \`rules/
property-ownership.json\` gives every property the export declares exactly one of:

| Owner | Meaning | Rows | Declarations |
| --- | --- | --- | --- |
| \`mapped\` | a mapping spec row owns it, and the row is cited as \`spec/<file>.md:<line>\` | 34 | 696 |
| \`expanded\` | a shorthand capture expands; nobody maps the token and its longhands are the contract | 3 (\`background\` 44, \`flex\` 29, \`font\` 65) | 138 |
| \`unmapped\` | no spec names it and capture does not dissolve it: **the gap** | 16 | 53 |

696 + 138 + 53 = 887. Twenty-three further rows are count-0 longhands capture always produces and this
source never declares: named so a future export cannot slip through one, worth nothing today.

Each unmapped property carries a \`disposition\`, and each disposition declares a severity in spec/02's
own words, because an agent writing an emitter must not have to decide how much an unknown matters:

| Disposition | Severity | Properties |
| --- | --- | --- |
| \`structural\` | \`error\` | \`max-width\`, \`outline\`, \`outline-offset\`, \`left\`, \`top\`, \`bottom\` |
| \`declared-alternative\` | \`error\` | \`box-sizing\`, \`font-variant-numeric\`, \`grid-template-columns\` |
| \`unknown-severity\` | \`warn\` | \`font-variation-settings\` (the icon font's fill axis: it changes *which icon* was chosen) |
| \`decorative\` | \`warn\` | \`text-wrap\`, \`scrollbar-color\`, \`scrollbar-width\`, \`caret-color\` |
| \`ignored-or-gate\` | \`info\` | \`animation\`, \`transform\` (both live only inside \`@keyframes\`) |

Nine stop the node, five emit with a comment, two are reported and change nothing. That split is the
concrete answer to "what happens when the design uses something we do not know", which is the question
every converter of this kind eventually answers with a plausible default.

\`expanded\` is deliberately not \`unmapped\`, and the distinction earns its keep: capture really does
dissolve \`font\` into longhands a spec owns, so sending \`font\` back to the design tool as a repair
request would tell the author to fix something they did not do wrong. \`outline\` is the opposite case
kept honest: capture expands it, but no target owns an outline either, so it stays a gap and its three
longhands are named. Classifying by browser behavior alone would have demoted a real decision into a
footnote.

## The measurement, and the check that keeps it honest

The gap used to be prose: "18 of the 50 CSS properties". Both numbers were wrong. Measured with the
canonical reader (\`tools/css-harvest.mjs\`) it is **16 unmapped properties of 53 declared**, and two of
the eighteen were \`-webkit-*\` properties a prefix-less regex dropped while two more were shorthands
capture expands. Prose cannot hold that, so it is a check now.

\`node tools/property-map.mjs\` re-derives everything from disk on every run:

- **Coverage**: every property in the fixture has a row. An unowned one is exit 1 and says whether any
  spec names it at all.
- **Evidence**: every \`mapped\` row cites a real line, in a spec the table declares as a mapping spec,
  where that property sits on the *left* of a colon inside a code span on a table or list row. A
  paragraph is a mention, not a decision -- which is why spec/01 warning about \`transform\` does not
  make \`transform\` mapped, and why \`display: flex\` names \`display\` and not \`flex\`.
- **Drift**: counts and value shapes on the fixture the table was measured on. Pointed at a different
  export it checks coverage and skips drift, because the fresh export *is* the point.
- **\`--repair\`**: the unknown set rendered as a paste-ready instruction for the source tool.

Exit codes are the repo's: 0 clean, 1 drift or an ownerless property, 2 malformed table or bad
invocation, 4 unreadable fixture or spec. 3 is unreachable because the tool never needs an invention to
finish.

Two guards in the checker are load-bearing rather than tidy. \`spec/13\` may never be listed as a
mapping spec: this file discusses every property, and citing it would let the gap own itself. And
evidence must come from a consulted spec, or any markdown that mentions a token could claim to map it.

## The repair instruction: spec/10 sink 3, made mechanical

\`node tools/property-map.mjs --repair\` writes a report whose every line came from the same table the
checker just verified: the property, its count, the value shapes measured, the severity the target will
apply, why it matters, and what to ask for. No value shapes are dropped, so \`grid-template-columns\`
arrives carrying \`repeat(auto-fill, minmax(400px, 1fr))\`, which is the number spec/01 has been asking
for as \`data-grid-min\` and never got.

It is generated rather than written for the same reason the rest of this is a table: a hand-written
ask drifts from the measurement that justified it. Running the checker on a new export is then the
number that says whether the loop closed -- which is spec/10's "errors per export at first run",
computed instead of asserted.

This automates what task T4 currently does by hand. The unknowns that need a *design* answer (\`left\`,
\`top\`, \`bottom\`: name the box the badge overlays) go to the design tool as a question. The ones that
need a *contract* answer (\`grid-template-columns\`, \`font-variant-numeric\`, \`box-sizing\`) become a new
\`data-*\` or manifest field plus the prompt requirement, in one commit, per spec/10.

## The question this raised and did not resolve

Five of the six \`max-width\` declarations in the reference export are not the design. Read element by
element: \`720px\` caps the Home search row, while \`1400px\` is the board header, \`1320px\` (twice) are
board frame grids whose own captions read "NowPlayingBar full width at every window size", and
\`760px\`/\`560px\` cap board prose. Nothing in the source distinguishes a presentation board from a
screen, so a capture reads the board's own layout as component geometry.

Recorded as \`structural\`, which stops on all six, because inventing a 1320.dp component width is
worse than refusing. Two cheap resolutions exist and neither is decided: give the board its own
stylesheet a capture may exclude, or let \`MANIFEST.json\` name which frames are scaffolding. Deciding
it is T4's, and the repair report asks it in the meantime.

## What the bridge is not

Not a normalizer that makes odd input look familiar. Not a resolver: it never picks a role, a name or a
type. Not a place for a heuristic that "handles most exports": an unknown is a row with a severity and
an ask, and the fix is usually a contract field.

And not optional. The first emitter written without it is the last version of this tool that supports
exactly one design tool.

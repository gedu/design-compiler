# Lesson log

Append-only, one line each: date, code, kind (`rule`, `prompt`, `contract`, `fix`, `check`,
`golden`), one-line outcome. Per `spec/10-learning-loop.md` this is an index, not a diary: every
line here points at a check, a rule row, or a fixture that already exists in the tree.

~~~text
2026-10-13 prop-undeclared  check  sc-for scope + icon-family exclusion; glyph names are not copy -> fixtures/synthetic/dirty/PlayerCard.dc.html
2026-10-13 css-external     check  token file link is not external CSS -> tools/validate.mjs TOKEN_BASENAMES
2026-10-13 animation-required check  style-<state>= and animation: gate a state; transition: and @keyframes do not
2026-10-13 bridge-gap        contract  18 of 50 fixture CSS properties have no mapping owner -> odd/tasks T2.5
2026-10-13 exit-4            rule   exit 4 = input unreadable or malformed, a CI-distinguishable failure -> tools/validate.mjs header
~~~

## Open discrepancies

These are measured facts that contradict a document. They are not fixed by editing the check to
agree, and they are not fixed by editing the document to agree, until a human decides which one is
wrong. Each has an asserted exemption in the suite so it cannot quietly disappear.

- `varying-text-marked-as-prop` (`rules/contract-rules.json`, `measured: "violated"`) versus
  `prop-undeclared` (`spec/07:120`). The row's measurement reads "no `data-prop` attribute exists
  anywhere in the export", which is true: 0 occurrences (the 5 `data-prop` hits are `data-props`
  schemas). The code detects "literal text that varies between instances of one component carries no
  `data-prop`", which this export does not exhibit: every instance-varying string goes through a
  `{{ }}` placeholder the prop schema names, and the single literal run inside an `<sc-for>` is the glyph
  `check` at `fixtures/reference/Home.dc.html:42`, on a span whose own style sets
  `font-family: 'Material Symbols Outlined'`. The row and the code measure different claims. The
  check stays at 0 findings on the reference export; `CROSS_CHECK_EXEMPT` in
  `tests/validate.test.mjs` records it with an asserted exemption count.
  Decision owner: T1. Options: narrow the row's `measured` claim, or add a fixture that genuinely
  varies copy between instances (T4 may produce one).
- `spec/03-extraction.md:16` says capture from a `file://` URL. `docs/probe-report.md` proved that
  cannot work: the runtime fetches sibling `.dc.html` files for `<dc-import>` against a null origin.
  Capture must go through the loopback server with the vendor lock, as `tools/probe.mjs` does.
  Decision owner: T2.5, in `spec/13-bridge.md` (`spec/12` belongs to SwiftUI via T11).

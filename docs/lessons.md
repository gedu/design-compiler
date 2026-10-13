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
2026-10-13 bridge-gap        check  superseded by measurement: 16 unmapped of 53 declared, not 18 of 50 -> tools/property-map.mjs + tests/property-map.test.mjs
2026-10-13 css-hole-truncation check  a {{ }} hole ends a naive value match and drops the declaration -> tools/css-harvest.mjs (all 3 overflow-y in the export were invisible)
2026-10-13 vendor-prefix     check  ^[-a-z] property regex silently discards -webkit-* -> tools/css-harvest.mjs keeps the leading dash
2026-10-13 shorthand-reset   contract  whether a shorthand resets a longhand is measured in Chromium, not recalled -> spec/13 table (font keeps letter-spacing; border keeps border-radius)
2026-10-13 unknown-severity  contract  each unknown carries a severity in spec/02's words, so no emitter decides -> rules/property-ownership.json dispositions
2026-10-13 stale-citation    check  editing a spec moves every citation into it; --relocate fixes provable moves only -> tools/property-map.mjs
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
- `spec/03-extraction.md` said capture from a `file://` URL. `docs/probe-report.md` proved that
  cannot work: the runtime fetches sibling `.dc.html` files for `<dc-import>` against a null origin.
  Capture must go through the loopback server with the vendor lock, as `tools/probe.mjs` does.
  Decision owner: T2.5, in `spec/13-bridge.md` (`spec/12` belongs to SwiftUI via T11).
  **RESOLVED 2026-10-13 by T2.5**: the Capture section of `spec/03-extraction.md` is amended to
  loopback plus vendor lock with two health gates (blocked requests, unresolved placeholders), and
  `spec/13-bridge.md` owns the layer in front of it. Resolved in prose *and* in the rule table, which
  is the point: the line number it used to cite no longer exists, and `--relocate` is what reconciles
  citations after an edit like this one.
- The bridge gap was recorded here as "18 of 50 fixture CSS properties". Measured with a reader that
  keeps vendor prefixes and treats a `{{ }}` hole as one opaque token, it is **16 unmapped properties
  of 53 declared**, across 887 declarations. Neither number was a property of the export: the first
  came from a `^[-a-z]` property regex that silently dropped `-webkit-box-orient` and
  `-webkit-line-clamp`, and from counting shorthands the browser expands as if a target had to map
  them. `npm run properties` now recomputes it, and `tests/property-map.test.mjs` pins 53/16/53 so the
  next person who wants to argue about the gap argues with the tool.
  Decision owner: none. Resolved by measurement, kept as a line here because the wrong number is the
  lesson.
- Five of the six `max-width` declarations in the reference export are presentation-board chrome, not
  design: 1400px is the board header, 1320px (twice) are frame grids whose own captions read
  "NowPlayingBar full width at every window size", and 760px/560px cap board prose. Only 720px (the
  Home search row) is a component constraint. Nothing in the source tells a board from a screen, so
  capture reads board geometry as component geometry, and no check can tell them apart today.
  Classified `structural`, so all six stop the node rather than guess. Decision owner: **T4**. Options:
  give the board its own stylesheet a capture may exclude, or let `MANIFEST.json` name which frames are
  scaffolding. Not papered over: `npm run repair` asks it on every run.
- 2026-10-13 · author-markup-survives-dc-runtime · kind: measurement, sink: spec/01 premise + T5 fixture design · outcome: measured in Chromium over a live render of fixtures/reference/PodcastCard.dc.html annotated with data-component/data-elevation/data-region/data-icon/data-token/data-prop: all six SURVIVE the x-dc / sc-if / dc-import render with their values intact and readable by querySelectorAll. Unknown 1 (spec/01's premise that a prompt can put contract attributes on author-written elements) is therefore mechanically plausible, not just argued. Caveat kept honest: this proves the runtime preserves attributes a human already wrote; it does not prove Claude Design will write them, which is still T4's question.
- 2026-10-13 · frame-podcastcard-is-a-variant-sheet · kind: measurement, sink: T5 fixture design · outcome: ?frame=PodcastCard renders 6 instances of every annotated element, all visible, inside one 1504x400 <section>. That is the design's 6 declared states (MANIFEST.json PodcastCard.states: notSubscribed, subscribed, selected, twoLineAuthor, longTitle, noImageUrl) rendered as a row of cards, not one card. A golden emitter needs exactly one instance, so the reference board cannot be the T5 input directly. The 6x count also means a naive extractor would treat one card's subtree as six siblings.
- 2026-10-13 · minimal-board-renders-one-card · kind: discovery, sink: T5 fixture · outcome: a hand-written board (support.js + <x-dc> + <helmet> + tokens.css link + one <div id=Frame> wrapping one <dc-import> + a data-dc-script class extending DCLogic) renders ONE card at 180x272 with 0 blocked requests through tools/browser.mjs. Two facts learned: support.js defines NO custom elements (customElements.get('x-dc') is empty) yet the render works, so the runtime templates by other means and "custom elements defined: (none)" in the probe is not a failure signal; and omitting <x-dc> yields 2 nodes and a zero-height frame, so <x-dc> is load-bearing even though nothing registers it.
- 2026-10-13 · spec-premise-stale-material-icons · kind: correction, sink: spec/04 prose corrected + rule added to re-measure · outcome: spec/04 claimed the workshop carries no material-icons dependency; measured the opposite (libs.versions.toml:17,38 material-icons 1.7.3 + compose-materialIconsExtended, shared/build.gradle.kts:43 implementation, and the hand-written PodcastCard.kt already imports Icons.Default.BookmarkAdded/Newspaper/Terminal/SentimentVerySatisfied). Worse than being stale: the paragraph used the false premise to justify emitting a comment instead of an icon reference, so a reader following it emits a worse file than the target supports. The replacement sentence makes the claim verifiable in the target's own build files instead of quoting a remembered answer.
- 2026-10-13 · grid-stacking-is-recoverable-from-computed-style · kind: measurement, sink: T5 fixture design (the reference's absolute badge becomes mappable) · outcome: measured on fixtures/annotated, both cover children report computed gridArea "1 / 1" over one 1x1 track, and the badge adds placeSelf "end start" plus its own rect. So converting the reference's position:absolute badge to grid stacking loses NO intent a capture can read: overlap, corner and offset all survive as computed values. This is why T5 does not need an absolute-to-Box mapping row: writing that row now, with no emitter consuming it, would be exactly the prose-instead-of-table defect spec/10 forbids. Deferred to T6 with its trigger recorded: the real export uses position:absolute in PodcastCard and Home, and validate.mjs refuses bare absolute unless a data-overlay names a data-box, so T6 must resolve the pair (adopt it into spec/01 or replace the pattern) before extraction can read those two templates.

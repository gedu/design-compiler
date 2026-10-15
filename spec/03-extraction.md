# 03 Extraction

How to turn a contract-honoring HTML file into the IR in spec/02. Everything here is mechanical;
where it is not, the result is a diagnostic, not a guess.

## Capture

Amended by task T2.5, because the original two words here (\`file://\`, \"JavaScript disabled\") could
not run against a real export. Measured in \`docs/probe-report.md\`, reproducible with \`node
tools/probe.mjs --frame PodcastCard --file-protocol\`: the runtime resolves \`<dc-import>\` by fetching
the sibling \`.dc.html\`, and a \`file://\` page has a null origin, so the fetch throws. And JavaScript
cannot be disabled at all, because \`support.js\` builds the tree -- which is why the contract keeps
\`js-dependent-paint\` \`violated\` instead of deleting it: the workaround is the pipeline, and the rule
row records that.

Headless Chromium, one pass per frame (\`spec/13-bridge.md\` owns the layer that produces this tree):

1. Loopback URL on \`127.0.0.1\` over one directory (\`tools/serve.mjs\`), with the offline guarantee
   moved to the request router: any request that is not loopback and not pinned in
   \`.vendor/vendor-lock.json\` is aborted and counted. A counted request is a contract violation, and
   counting it turns it into a loud failure instead of a subtle visual difference. Two health gates
   must read zero before a computed style is trusted: blocked requests and unresolved \`{{ }}\`
   placeholders.
2. Set the viewport to the frame width, height tall enough that nothing is clipped, then measure. The
   authored size, when the export states one, comes from \`hint-size\` on the \`<dc-import>\`; the window
   size is never a design value.
3. Walk the DOM. For each element, one \`getComputedStyle()\` read plus one \`getBoundingClientRect()\`,
   both after \`document.fonts.ready\`: reading earlier measures a different font, and a run that
   measures two fonts is not reproducible.
4. Read the \`<style>\` block once for the custom-property to role map: \`--md-sys-color-primary\` to
   \`primary\`. That map is the authority; a computed hex is only evidence.
5. Emit the tree. Never write a target file from this pass.

Read computed style, never parse CSS text. The cascade, inheritance, custom property substitution
and media resolution are already done by the browser; reimplementing them is the single largest
source of bugs in this category of tool and it is entirely avoidable.

Capture twice when dark is requested: once as-is, once emulating \`prefers-color-scheme: dark\`. Same
tree walk, two documents. Do not click the JS toggle; the contract requires the media query to work
precisely so this step needs no script.

## Reduction

The DOM has far more nodes than the design has concepts. Reduce before emitting, or the output is
unreadable and unmaintainable.

| Drop | Condition | Beware |
| --- | --- | --- |
| Wrapper with no visual or layout effect | no background, no border, no radius, no padding, no margin, no gap, single child, display flex or block, no \`data-*\` | never drop a node that is a flex child with \`flex-grow\`, or a scroll container |
| Structural div | \`<div>\` with no style of its own, used only to group | check it is not the flex context that creates the \`gap\` |
| Inline wrapper with a single child | \`<span>\` inside \`<p>\` with no style difference | do not drop it when it carries \`<strong>\`, a different color, or its own \`data-prop\` |
| Decorative svg without a size | zero area after layout | an svg with an intrinsic size is an icon, keep it |
| Empty text node, comment, whitespace | always | text nodes with content are nodes, not children of their parent element |

Never reduce:

- Anything with a \`data-*\` attribute. Those are the author's intent; the converter does not second
  guess them.
- A node whose children wrap differently than it does.
- A scroll container, detected by \`overflow-y: auto\` or \`scroll\` plus scrollable overflow, regardless
  of whether \`data-scroll\` was declared. Undeclared scroll is a diagnostic, not a removal.
- A node carrying \`aspect-ratio\`, because that ratio is the only thing in the tree that will survive
  a window resize.

## Resolution rules

| Read | From | Into |
| --- | --- | --- |
| Color | computed value, usually \`rgb()\` or \`oklab()\`; convert to sRGB hex, round to nearest, look it up in both token schemes | \`role\` plus \`source\`; unresolved becomes \`color-unresolved\` |
| Spacing | \`padding-*\`, \`margin-*\`, \`row-gap\`, \`column-gap\` in px | dp or RN number, 1:1 |
| \`gap\` asymmetric | \`row-gap\` differs from \`column-gap\` | Compose \`Arrangement.spacedBy\` has no per-axis on a single \`Row\`/\`Column\`; needs a diagnostic and either a nested layout or the larger value, decided explicitly |
| Typography | \`font-size\`, \`line-height\`, \`font-weight\`, \`letter-spacing\` | match against the type scale table below |
| Radius | per-corner \`border-*-radius\` | single \`shape\` role if uniform and on the ladder, else \`corners\` with four values |
| Border | \`border-width\`, \`border-style\`, \`border-color\` | Compose \`BorderStroke\`; note the box model trap in spec/04 |
| Shadow | never | ignore entirely; \`data-elevation\` is the only source of elevation |
| Overflow | \`overflow\` | \`horizontalScroll\`, \`verticalScroll\`, \`clipRounding\`, \`hidden\`; RN only supports \`hidden\` or visible |
| Line clamp | \`-webkit-line-clamp\` with \`-webkit-box-orient: vertical\` | \`maxLines\` plus \`TextOverflow.Ellipsis\`; RN needs \`numberOfLines\` |
| Text transform | \`uppercase\` | Compose \`TextRole\` has no direct equivalent: either bake it into the string, or use \`TextBox\` style letter spacing plus a comment. Prefer emitting the final string and flagging it |

### Type scale of the pinned Material3 (1.12.0-alpha03)

Verified against \`TypeScaleTokens.kt\` in the pinned artifact, not from memory. \`sp\` values below are
dp-equivalent numbers for lookup; px equals sp at font scale 1.

| Role | size | line | tracking | weight |
| --- | --- | --- | --- | --- |
| displayLarge | 57 | 64 | -0.2 | 400 |
| displayMedium | 45 | 52 | 0.0 | 400 |
| displaySmall | 36 | 44 | 0.0 | 400 |
| headlineLarge | 32 | 40 | 0.0 | 400 |
| headlineMedium | 28 | 36 | 0.0 | 400 |
| headlineSmall | 24 | 32 | 0.0 | 400 |
| titleLarge | 22 | 28 | 0.0 | 400 |
| titleMedium | 16 | 24 | 0.2 | 500 |
| titleSmall | 14 | 20 | 0.1 | 500 |
| bodyLarge | 16 | 24 | 0.5 | 400 |
| bodyMedium | 14 | 20 | 0.2 | 400 |
| bodySmall | 12 | 16 | 0.4 | 400 |
| labelLarge | 14 | 20 | 0.1 | 500 |
| labelMedium | 12 | 16 | 0.5 | 500 |
| labelSmall | 11 | 16 | 0.5 | 500 |

Note the two collisions that make single-property matching useless: \`titleMedium\` and \`bodyLarge\`
share 16/24 and differ only in weight and tracking; \`titleSmall\` and \`bodyMedium\` share 14/20. Match
on the triple size plus line-height plus weight, and treat tracking as a tiebreaker, not a filter:
browser tracking is a px length and rounding makes a 0.2px difference unreliable at small sizes.

If nothing matches, emit \`MaterialTheme.typography.<closest>\` with an explicit \`copy()\` carrying the
difference, plus a \`style-off-scale\` diagnostic. Never silently pick a role that merely has the same
font size.

Also note \`titleLarge\` and the display roles use the brand font family in the tokens (\`TypefaceTokens.Brand\`).
With no font bundled, Compose falls back to the platform default and the design's brand font quietly
disappears. Emit a \`fontFamily\` note rather than pretending it matched.

### Shape ladder

Also verified in the pinned artifact: extraSmall 4, small 8, medium 12, large 16, extraLargeIncreased
20, extraLarge 28, extraExtraLarge 48, plus \`CircleShape\`. Radii between steps are diagnostics
(\`radius-off-ladder\`), not silent \`RoundedCornerShape(n.dp)\` emissions. Emit the raw value only with a
comment naming the diagnostic.

### Elevation ladder

0, 1, 3, 6, 8, 12 dp, from \`ElevationTokens.Level0\` to \`Level5\`. A \`data-elevation\` value outside those
six is an error, not a rounding opportunity.

State layer opacities, for reference when a state overlay appears: hover 0.08, pressed 0.10, focus
0.10, dragged 0.16. In Compose these are the component defaults, so a design that painted a hover
state as a translucent overlay should emit the plain component plus a comment, not a \`Box\` with an
alpha'd color.

## Ordering

1. Parse and contract-validate. Stop on any \`error\`.
2. Capture: layout, geometry, computed style.
3. Reduce.
4. Resolve: colors to roles, text to type roles, radii to shape roles.
5. Detect: regions, scroll containers, repetition groups, states, callbacks.
6. Emit the IR. One file per screen per theme.
7. Report: diagnostics grouped by code, plus a per-target risk line.

Order matters. Resolving colors before reduction wastes work on dropped nodes; detecting groups
before resolution means grouping by unresolved signatures.

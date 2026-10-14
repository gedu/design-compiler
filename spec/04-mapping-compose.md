# 04 Compose mapping

The primary target. Everything here applies to Compose Multiplatform \`commonMain\`: Android and the
desktop window render from one set of composables, which is the constraint that makes some of these
traps non-optional.

Verified against material3 1.12.0-alpha03 on Compose Multiplatform 1.12.1. If an expressive
component is used, check it exists in the pinned version before emitting it; the fallback is always
the plain M3 component, never a hand-rolled one.

## Property mapping

| Computed style | Compose |
| --- | --- |
| \`display: flex; flex-direction: row\` | \`Row\` with \`horizontalArrangement\`, \`verticalAlignment\` |
| \`... column\` | \`Column\` with \`verticalArrangement\`, \`horizontalAlignment\` |
| \`justify-content\` | \`Arrangement.Start / Center / End / SpaceBetween / SpaceAround / SpaceEvenly\`; \`flex-end\` to \`End\`, not to \`Arrangement.Bottom\` on a Row |
| \`align-items\` | \`Alignment.Top / CenterVertically / Bottom\` on a Row; on a Column use \`Alignment.Start / CenterHorizontally / End\` |
| \`gap\` | \`Arrangement.spacedBy(n.dp)\` |
| \`flex: 1\` | \`Modifier.weight(1f)\`. Inside a Row of mixed fixed and weighted children this is the whole layout; getting it wrong is the most common visual break |
| \`flex: 0 0 auto\` | no modifier, size from content |
| \`flex-basis\` with grow 0 | \`Modifier.width(n.dp)\` or \`requiredWidth\` when shrinking must be blocked |
| \`flex-wrap: wrap\` | \`FlowRow\` with \`Arrangement.spacedBy\`; check the API is stable in the pinned version |
| \`padding: a b\` shorthand | \`Modifier.padding(horizontal = b.dp, vertical = a.dp)\`; four values to four named args |
| \`margin\` | padding on the modifier, applied *before* background. Order matters, see the box model trap |
| \`width\` / \`height\` | \`Modifier.size / width / height\`; prefer letting content size it when the box is content-derived, because fixed sizes break with font scaling |
| \`min-width\` on a text parent | \`Modifier.widthIn(min = n.dp)\` |
| \`aspect-ratio: 1\` | \`Modifier.aspectRatio(1f)\`. Keep it instead of a fixed size: it is the only property that survives window resize on desktop |
| \`border-radius\` uniform | \`shape = MaterialTheme.shapes.<role>\` on the component, or \`Modifier.clip(shape)\` |
| \`border-radius\` per corner | \`RoundedCornerShape(topStart, topEnd, bottomEnd, bottomStart)\` |
| \`background-color\` | the component's color parameter where one exists (\`Card\` uses \`containerColor\`), otherwise \`Modifier.background(MaterialTheme.colorScheme.<role>)\` |
| \`color\` | \`color = MaterialTheme.colorScheme.<role>\` on \`Text\`/\`Icon\`, or rely on \`LocalContentColor\` inside a container that already sets it |
| \`box-shadow\` | nothing. Elevation only, from \`data-elevation\`: on Card \`elevation = CardDefaults.cardElevation(defaultElevation = n.dp)\`, elsewhere \`Modifier.shadow(elevation.dp, shape)\`. See trap 4: Card exposes no tonal elevation in the pinned material3 |
| \`border\` | \`Modifier.border(width.dp, Brush.color(c), shape)\` or \`BorderStroke\` on Card |
| \`opacity\` | \`Modifier.alpha()\`. Flag it: M3 uses state layers, not alpha, and a painted alpha usually means a container role was missed |
| \`overflow: hidden\` | \`Modifier.clipToBounds()\`, or rely on \`Modifier.clip(shape)\` |
| \`overflow-x: auto\` | \`Modifier.horizontalScroll(rememberScrollState())\`, or a lazy list if \`data-scroll\` says so |
| \`-webkit-line-clamp\` | \`maxLines\` plus \`overflow = TextOverflow.Ellipsis\` |
| \`text-overflow: ellipsis\` | \`TextOverflow.Ellipsis\` |
| \`white-space: nowrap\` | \`maxLines = 1\` plus \`softWrap = false\` |
| \`text-align: center\` | \`textAlign = TextAlign.Center\` on \`Text\`, not \`Modifier.align\` |
| \`text-transform: uppercase\` | pass the final cased string; note it in a comment. There is no Compose property, and \`TextStyle\` letter spacing does not do it |
| \`font-*\` | \`style = MaterialTheme.typography.<role>\`, plus \`copy()\` for any residual difference |
| \`letter-spacing\` | note the unit change: CSS px to Compose \`sp\`, and Compose's \`letterSpacing\` is per em, so a design that used \`0.05em\` must be converted, not copied |
| \`<svg>\` inline | generated \`ImageVector\` via \`path()\`, tinted by \`LocalContentColor\`; see the icons rule below |
| \`<img>\` | forbidden by contract; if present, emit \`Modifier.background(role)\` placeholder plus a diagnostic |
| \`hr\` / 1px divider line | \`HorizontalDivider(color = ..., thickness = 1.dp)\` |
| \`cursor: pointer\` | \`Modifier.clickable {}\` plus one callback parameter |
| \`::selection\`, \`::placeholder\` | \`TextField\` \`\$\_label\` placeholder color from the scheme; do not emit custom |

## Component mapping

| IR role | Compose |
| --- | --- |
| Card | \`Card(shape, colors = CardDefaults.cardColors(containerColor = ...), elevation = CardDefaults.cardElevation(defaultElevation = ...))\`. No \`background()\` in the modifier: Card paints its own container, so a second background paints the role twice and fights the Card's clipping |
| TopAppBar region | \`TopAppBar(title, colors = TopAppBarDefaults.topAppBarColors(...))\` inside \`Scaffold(topBar = ...)\` |
| now-playing-bar region | \`Scaffold(bottomBar = ...)\`, never a plain sibling at the end of a Column |
| Button | \`Button / FilledTonalButton / OutlinedButton / TextButton\`, chosen by which color roles the computed background and foreground carry. Filled when primary/onPrimary, tonal when secondaryContainer/onSecondaryContainer, outlined when outline, text when transparent background |
| IconButton | \`IconButton\` plus \`Icon\`; a 48dp target is already implied, do not add a size |
| Chip | FilterChip / AssistChip / InputChip chosen by the roles and by whether it is in a group marked selectable |
| Switch | \`Switch(checked, onCheckedChange)\`; emits \`checked = true\` hardcoded, and the comment says so |
| TextField / search | \`TextField\` or \`SearchBar\`; \`SearchBar\` brings its own positioning, so flag which one was chosen |
| Badge | \`Badge\` with \`BadgedBox\` only if the source really nests them |
| List | \`LazyColumn\` with \`items(list, key = { it.id })\` |
| Grid | \`LazyVerticalGrid(GridCells.Adaptive(minSize = N.dp))\`, N from \`data-grid-min\` |
| Divider | \`HorizontalDivider\` |
| Progress | \`LinearProgressIndicator(progress = { 0.4f })\`, hardcoded, with a comment; the lambda overload is the current API |
| Spinner | \`CircularProgressIndicator\` |
| Snackbar | \`Snackbar\` inside a \`SnackbarHost\`; the host needs a \`SnackbarHostState\`, which is state, so emit it as a parameter, not a local |
| Tooltip | \`RichTooltipModifier\` / \`PlainTooltip\`; usually downgrade to a comment, since it needs state |
| Skeleton loading | there is no M3 skeleton. Emit the real component with placeholder strings plus a comment, or a \`Modifier.alpha\` variant, and flag it as a design invention |

## The traps, with the reason

### 1. Corner clipping does not come free

A \`Box\` with its own background, inside a \`Card\` with a rounded shape, is **not** clipped by the Card's
shape. CSS clips children by default with \`overflow: hidden\`; Compose clips only what is explicitly
clipped. This is the single most common visual bug in generated Compose: the card looks right and
the cover image square-pokes out of the corners.

Rule: any node with a background that is a descendant of a rounded container gets either the same
shape passed down, or \`Modifier.clip(parentShape)\`, and the shape must be a parameter of the generated
component so the two cannot drift. When the design uses \`overflow: hidden\` on the parent, that is the
signal to emit \`Modifier.clip(shape)\` on the parent and let children inherit visually.

### 2. Compose inherits the CSS box model here, not Android's

The design was authored in CSS, so two behaviors must be translated rather than assumed:

- **Border and padding are separate domains.** In CSS, \`border: 1px; padding: 8px\` means the content
  sits 8px inside the border. In Compose, \`Modifier.border()\` draws at the outer edge and
  \`Modifier.padding()\` moves content, but there is no automatic gap: border plus padding plus
  background must be ordered deliberately. Emit
  \`Modifier.border(w, brush, shape).background(color, shape).padding(inner)\`, and when the design shows
  content hugging the border, the padding goes *inside* the background, not outside.
- **Margins do not collapse.** CSS vertical margins between siblings collapse to the larger value;
  Compose never does. A design with \`margin: 8px\` on every card produces 8dp gaps in the browser and
  16dp in Compose. When margins collapse in the captured layout, emit the collapsed value and drop
  the per-node margin, and prefer converting repeated sibling margins into one \`Arrangement.spacedBy\`.

### 3. Modifier order is semantics

\`background\` then \`padding\` paints the background under the padding, which is CSS's box. \`padding\` then
\`background\` paints a smaller box. \`size\` then \`padding\` shrinks the content; \`padding\` then \`size\` grows
the total. The extractor must record the CSS box facts (border box, padding inside the painted
area) and the emitter must use one canonical order for every node, or generated files from the same
design disagree with each other.

Canonical order: size or weight, then background or border or clip, then padding, then layout or
clickable.

### 4. Elevation is tonal, not black

Do not emit \`Modifier.shadow\` from a CSS shadow, ever (see spec/01). Also do not emit both an
elevation and a hand-drawn overlay; the component does the overlay itself.

Measured against material3 1.12.0-alpha03, which contradicts what this row used to claim: \`Card\`
carries **no** tonal elevation at all. \`CardDefaults.cardElevation\` declares
\`defaultElevation, pressedElevation, focusedElevation, hoveredElevation, draggedElevation,
disabledElevation\` and rejects \`tonalElevation\` with \`NAMED_PARAMETER_NOT_FOUND\`; \`CardElevation\`
exposes only \`shadowElevation\`. \`tonalElevation\` exists on \`Surface\`, which \`Card\` does not
forward. So the number from \`data-elevation\` lands on \`defaultElevation\`, and the emitted file
says the trap wanted tonal. The part of this trap that mattered is unchanged: the value comes from
\`data-elevation\`, never from a \`box-shadow\`, and in this version it is a shadow elevation.

### 5. Fixed sizes fight the desktop window and font scaling

A design captured at 1280 with fixed widths becomes a desktop app that does not resize. Rule: any
\`width\` on a node that is a flex child with a weighted sibling becomes \`widthIn\` or nothing. Any width
that came from \`min-width\` becomes \`widthIn(min = ...)\`. Text boxes never get a fixed height. And
because \`sp\` scales with the user's font setting while the design was captured at scale 1, any node
whose height came from text gets its height dropped and its \`verticalArrangement\` trusted instead.

### 6. \`weight\` needs the right scope

\`Modifier.weight\` only works as a direct child of \`Row\`/\`Column\`/\`RowScope\`. If reduction removed a
wrapper that was the flex child, weights silently stop applying. The extractor records depth, and
the emitter asserts that every weighted node is a direct child in the emitted tree.

### 7. \`aspectRatio\` inside a lazy item can thrash

Inside a grid cell with an adaptive width, \`aspectRatio\` resolves after measurement and can produce a
second pass. Acceptable, but do not also set a height on the same node; if the design has both,
keep the ratio and drop the height, noting the conflict.

### 8. Icons: reference a name, never fabricate a glyph

Policy (spec/01, icon policy): the converter transforms icon bytes that already exist in the input
and otherwise emits a reference plus a TODO. It never hand-authors path data.

| Input | Emitted |
| --- | --- |
| inline SVG | generated \`ImageVector\` from the input's own path data, as a named \`val\` in an \`Icons\` object in the same package. Never inline at the call site. |
| glyph font with \`data-icon="bookmark_add"\` | \`Icons.Default.BookmarkAdd\` with a comment that the icon dependency must be present, or a named \`val\` bound to the project's own icon set if config names one |
| glyph font, no name | a \`Box\` placeholder of the measured size, the literal glyph in a comment, \`// TODO: icon asset\`, and a \`warn\` |

The dependency question is the target project's, not the converter's, and its answer is measured
there rather than recalled: this paragraph once claimed \`app/gradle/libs.versions.toml\` and
\`shared/build.gradle.kts\` carried no material-icons dependency, and the workshop's build files
contradicted it (\`material-icons = "1.7.3"\`, \`compose-materialIconsExtended\`, and the hand-written
card already imports \`Icons.Default.BookmarkAdded\`). So: read the target's catalog first, and where
a name resolves, \`snake_case\` becomes PascalCase, \`bookmark_added\` to \`BookmarkAdded\`.

The honest metric is emitted \`// TODO: icon asset\` markers per screen: it counts the icons a human
has to wire up, which is exactly what a glyph font hides.

### 9. Two \`ColorScheme\` objects, not one with modes

Compose has no runtime mode switch inside one scheme. The dark capture emits a second
\`darkColorScheme(...)\`, and \`Theme.kt\` picks between them on a \`darkTheme: Boolean\`. Never emit one
scheme plus an \`if\` at call sites, and never emit \`dynamicLightColorScheme(context)\` into \`commonMain\`:
it needs an Android \`Context\` and will not compile in shared code. Dynamic color is an Android-only
opt-in behind an \`expect\`/\`actual\`, and the static scheme is the design of record for both targets.

Also: \`isSystemInDarkTheme()\` is common API and safe in \`commonMain\`; on desktop it reflects the OS
through Skiko, and Compose 1.12 polls for changes behind \`ComposeUiFlags.pollSystemTheme\`. Do not
design or emit theme transitions.

### 10. \`LocalInspectionMode\` for previews

Every generated composable also gets a \`@Preview\` with the fake content that was in the design. On
desktop, previews and hot reload are the participants' main loop, so this is not decoration. Guard
anything that would break in preview with \`LocalInspectionMode.current\`, and prefer emitting previews
that take no parameters by giving parameters defaults only in a private preview wrapper, never on
the public signature.

## Emission rules

- One file per component, package \`<base>.ui\`, file named after the component.
- Signature: \`fun PodcastCard(podcast: Podcast, onSubscribeClick: () -> Unit, modifier: Modifier = Modifier)\`.
  \`modifier\` last and defaulted, always. Required parameters in DOM order of their \`data-prop\`.
  Callbacks after data, before modifier.
- Hardcode the design's sample values in the preview, and put them in a \`FakeData\` object rather than
  inline, so the next agent can delete them in one move.
- No \`remember\`, no \`mutableStateOf\`, no \`ViewModel\`, no \`LaunchedEffect\`. If the design implies state,
  it becomes a parameter. This is the contract with the next agent, and violating it makes the
  output twice as hard to review.
- Every emitted file ends with a comment block listing the diagnostics that touched it. A generated
  file that pretends to be certain is worse than one that shows its work.
- \`State\` and \`state\` parameters get \`// TODO(state)\` markers. Those markers are the actual output of
  this tool: they are the list of decisions a human still has to make.

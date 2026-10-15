# SCREENS.md — Mini Jetcaster

## How to read this

- One section per Kotlin file. Each element: component, size/variant, type role, color roles, shape role, spacing tokens, states.
- Colors are `MaterialTheme.colorScheme.<role>`, type is `MaterialTheme.typography.<role>`, shapes are `MaterialTheme.shapes.<role>`; `full` means `CircleShape`.
- Spacing tokens: space0, space4, space8, space12, space16, space24, space32 (dp = number in the name).
- Live mockups: `Mini Jetcaster.dc.html`. One frame: `?frame=HomeScreen.expanded`. Dark: `&theme=dark`.
- No component below is [expressive-only].

## App.kt

- `MiniJetcasterTheme(darkTheme = isSystemInDarkTheme())` wraps `Scaffold`.
- Scaffold: containerColor `surface`; topBar = TopAppBar; bottomBar = NowPlayingBar (only when an episode is playing); snackbarHost unused in this version.
- Android: edge-to-edge; Scaffold consumes system bar insets; status bar and gesture bar draw over `surface` (over `surfaceContainerHigh` when the bar is visible). [android-only]
- Desktop: `Window(title = "Mini Jetcaster")`, minimum size 360 × 480dp, initial 1280 × 800dp. No insets, no back.

## HomeScreen.kt

### Width classes
- Compact (< 600dp): one vertical scroll. Search, chips, grid, then the episode list under it. Grid side padding space16.
- Medium (600–1199dp) and expanded (≥ 1200dp): two panes in a Row, outer padding space24 left/right, space16 bottom, gap space24.
- Grid pane grows (`weight(1f)`). Episode pane caps: 320dp medium, 400dp expanded.
- Minimum window width 360dp; below it the window cannot shrink.
- Short windows (480dp): each pane scrolls on its own; nothing depends on a bottom navigation bar.

### Top app bar
- TopAppBar (small), height 64dp, containerColor `surface`.
- Title "Mini Jetcaster": `titleLarge`, `onSurface`.
- Action: IconButton `subscriptions`, `onSurfaceVariant`, wrapped in BadgedBox.
- Badge: count of subscribed podcasts, `labelSmall`, `error` / `onError`, shape full. Count 0: no Badge. Over 99: "99+".
- Tooltip on hover (desktop): "N subscribed podcasts".

### Search
- SearchBar (docked input field only, no expanded view) or TextField styled as such. Height 56dp, shape full, containerColor `surfaceContainerHigh`, max width 720dp.
- Leading Icon `search` `onSurface`; text `bodyLarge` `onSurface`; placeholder "Search podcasts" `onSurfaceVariant`; caret `primary`.
- With text: trailing IconButton `close` `onSurfaceVariant`, clears and keeps focus.
- Focused: 3dp `secondary` focus ring, 2dp offset.
- Filters by title, case-insensitive substring, combined with the category chip.

### Category chips
- Row of FilterChip: Tech, News, Comedy. Gap space8. Height 32dp, shape small, `labelLarge`.
- Unselected: 1dp `outlineVariant` border, label `onSurfaceVariant`.
- Selected: container `secondaryContainer`, label and leading `check` icon (18dp) `onSecondaryContainer`.
- Single selection; tapping the selected chip clears it.
- Hover: container `surfaceContainerHigh` (unselected).

### Desktop interaction
- Tab order: subscriptions action → search → chips → cards (each card, then its toggle) → episode rows → now playing controls.
- Every focusable element: 3dp `secondary` ring, 2dp outside offset (inset 3dp on full-width rows).
- Scrollbars: `VerticalScrollbar` on the grid pane and the episode pane, thumb `outlineVariant`. Mouse wheel and drag on the scrollbar; no touch gestures required.
- Hover never introduces a new color; it moves one surfaceContainer tier up.
- FAB: none on either target; play actions live in rows and the bar.

## PodcastGrid.kt

- LazyVerticalGrid, `GridCells.Adaptive(140.dp)`, clamped to 2–5 columns by the pane width.
- Horizontal and vertical spacing space12.
- Compact: 2 columns at 360dp. Medium: 3. Expanded: 5.
- Empty result: Column centered, padding space32/space16, gap space16. Icon `search_off` 48dp `onSurfaceVariant`; "No podcasts match that search" `bodyLarge` `onSurfaceVariant`.

## PodcastCard.kt

### Container
- Card (filled), containerColor `surfaceContainer`, shape medium, padding space8, gap space8. Whole card is clickable (selects podcast).
- Selected: 2dp `primary` border. Not selected: no border.
- Hover: containerColor `surfaceContainerHigh`. Focus: ring as above.

### Cover placeholder
- Box, aspect ratio 1:1, shape small.
- Colors from `categoryCover` in tokens.json:
  - Tech → `secondaryContainer` / `onSecondaryContainer`, Icon `terminal`
  - News → `tertiaryContainer` / `onTertiaryContainer`, Icon `newspaper`
  - Comedy → `primaryContainer` / `onPrimaryContainer`, Icon `sentiment_very_satisfied`
- Icon 40dp, filled, centered. Category label bottom-start, padding space8, `labelMedium`.
- No image URL and with image URL render the same; artwork is out of scope.

### Text
- Title: `titleSmall`, `onSurface`, max 2 lines, ellipsis, reserves 2 lines so cards align.
- Author: `bodySmall`, `onSurfaceVariant`, max 2 lines, reserves 2 lines.

### Subscribe toggle
- IconToggleButton, 48dp target, 40dp visual, shape full, end of the author row.
- Off: `bookmark_add` outlined, `onSurfaceVariant`. On: `bookmark_added` filled, `primary`.
- Hover: circle `surfaceContainerHighest`. Tooltip "Subscribe" / "Unsubscribe".
- Updates the Badge count immediately.

## EpisodeList.kt

- Pane: compact `surface`, no shape; medium/expanded `surfaceContainerLow`, shape large, clipped.
- Header: podcast title `titleLarge` `onSurface`; author `bodyMedium` `onSurfaceVariant`; description (if any) `bodyMedium` `onSurfaceVariant`. Padding space16 top, space24 end, space12 bottom, space16 start.
- List: LazyColumn of EpisodeRow; HorizontalDivider `outlineVariant`, 72dp start inset, between rows.
- Loading: CircularProgressIndicator 48dp, indicator `primary`, track `secondaryContainer`, centered, minimum area 200dp.
- Error: Icon `error` 40dp `error`; "Could not load episodes" `bodyLarge` `onSurface`; FilledTonalButton "Try again" with `refresh` icon, `secondaryContainer` / `onSecondaryContainer`, height 40dp, shape full. Gap space16. Retry → Loading → list.
- Selecting another podcast shows Loading, then the list.

## EpisodeRow.kt

- ListItem, two-line, min height 72dp, padding space16 start, space24 end, space8 vertical; gap space16. No shape.
- Leading: FilledTonalIconButton `play_arrow`, 40dp visual / 48dp target, `secondaryContainer` / `onSecondaryContainer`.
- Headline: title `bodyLarge` `onSurface`, max 2 lines.
- Supporting: date "Oct 2, 2026" `bodyMedium` `onSurfaceVariant`.
- Trailing: duration `labelMedium` `onSurfaceVariant`, tabular figures. Formats: "59s", "42m", "1h 20m", "2h 01m".
- States:
  - Selected: container `secondaryContainer`; text `onSecondaryContainer`; leading button `surfaceContainerLowest` / `onSurface`.
  - Playing: leading FilledIconButton `pause`, `primary` / `onPrimary`; headline `primary`.
  - Paused: same as Playing with `play_arrow`.
  - Played: headline `onSurfaceVariant`; trailing `check_circle` 18dp before the duration.
  - Hover: container `surfaceContainerHigh` (not when selected). Focus: inset ring.

## NowPlayingBar.kt

- Surface `surfaceContainerHigh`, full window width at every width class, no shape.
- LinearProgressIndicator on top, height 4dp, indicator `primary`, track `secondaryContainer`, advances once per second (linear).
- Row min height 72dp, padding space8 vertical, space16 start, space12 end, gap space12.
- Cover: 48dp, shape small, `categoryCover` colors, category icon 24dp.
- Title `titleSmall` `onSurface`, 1 line ellipsis. Podcast + "12:24 / 31:00" `bodySmall` `onSurfaceVariant`.
- Controls: IconButton `replay_10`, FilledIconButton play/pause (`primary` / `onPrimary`, 48dp), IconButton `forward_30`. Gap space4. Compact: play/pause only.
- Enter: AnimatedVisibility, slideInVertically + expandVertically, durationMedium2 (300ms), emphasizedDecelerate. Exit: slideOut + shrink, durationShort4 (200ms), emphasizedAccelerate.

## Theme

- Theme.kt: `lightColorScheme` / `darkColorScheme` from Color.kt; `MiniJetcasterTheme(darkTheme: Boolean = isSystemInDarkTheme())`. Typography and shapes are MaterialTheme defaults.
- No dynamic color, no Context, no android imports. Android may opt into dynamic color in androidMain later. [android-only]
- Light is the fallback when the platform reports nothing.

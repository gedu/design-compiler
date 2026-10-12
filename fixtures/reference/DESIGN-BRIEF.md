# DESIGN-BRIEF.md — Mini Jetcaster

## Understood
- One Home screen, one adaptive layout, shared by the Android phone and the desktop window. Desktop is the primary viewing surface.
- Static Material baseline scheme (seed #6750A4) is the design of record; Android may opt into dynamic color in androidMain. [android-only]

## Decisions
- Two panes from 600dp: grid grows, episode pane caps at 320/400dp. Compact stacks them in one scroll.
- Category covers: Tech secondaryContainer, News tertiaryContainer, Comedy primaryContainer.
- Regions by tier: grid on surface, episode pane surfaceContainerLow, cards surfaceContainer, search and now playing surfaceContainerHigh.
- Hover = one surfaceContainer tier up. No state-layer opacity.
- No FAB on either target.

## Departures from m3.material.io
- Hover uses tier steps instead of the 8% state layer (brief forbids opacity overlays).
- Focus ring uses `secondary` (M3 focus indicator spec), not outline/primary as the brief suggests.
- Filled Card uses surfaceContainer instead of the default surfaceContainerHighest so hover has a tier to move to.

## Values I invented
- Episode pane width 320dp (medium), 400dp (expanded); search max width 720dp.
- Minimum window 360 × 480dp; initial 1280 × 800dp.
- Selected card border 2dp.
- Placeholder "Search podcasts".

## Roles not used
- primaryFixed, secondaryFixed, tertiaryFixed and their on/dim variants: produced by the generator but not in the allowed list, so excluded from Color.kt.
- scrim: not in the allowed list.

## Type clipping risks
- `labelMedium` durations ("2h 01m") on JVM default fonts: trailing slot is non-wrapping, verify width.
- `titleSmall` card titles over ~22 characters ellipsize at 2 lines in 2-column compact.

## Questions for the product owner
- Should episodes be per podcast? The brief lists one set.
- Should the badge use primary instead of error?
- Snackbar is unused; is one needed for subscribe feedback?

## Checklist
- Colors are section 3 roles, both schemes in tokens.json: yes.
- Every text element names a type role: yes.
- Every radius names a shape role: yes.
- HTML colors resolve through custom properties; hex only in tokens.css: yes.
- Components on whitelist: yes.
- Expressive components tagged: none used.
- Theme.kt common-safe (no android., Context, dynamic color, platform check): yes.
- Desktop hover, focus, resize, minimum width in SCREENS.md: yes.
- Both schemes complete; no dynamic color dependency: yes.
- MANIFEST paths exist: yes.
- No lorem ipsum, placeholder names or brand color: yes.
- Regenerate Color.kt from the seed before trusting it: the values are the published baseline, but not machine-generated here.

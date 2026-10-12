# UI/UX prompt for Claude Design: Mini Jetcaster

One paste block that designs the UI of the Mini Jetcaster workshop app. It is written to be
copied into Claude Design (claude.ai/design) in one go, and to come back as files a coding
agent can read without guessing: flat file names, uppercase, fixed paths, one machine-readable
manifest.

Before you paste it, read the two notes below.

## What it asks for, and why

| Requirement | How the prompt enforces it |
| --- | --- |
| Colorful | Color comes from using **all** the M3 accent roles (primary, secondary, tertiary and their container and fixed variants), not from invented hexes. The per-category cover color is the main trick. |
| Respect the Android Material theme | Only the roles that exist in `MaterialTheme.colorScheme` may appear. Every color in the output must be reachable as `MaterialTheme.colorScheme.<role>` or `MaterialTheme.typography.<role>`. |
| No custom colors | Hard rule in the prompt: the only palette allowed is the one the official generator produces from the published Material baseline seed. Anything else is a defect. |
| Latest M3 | The prompt names Material 3 and the M3 Expressive update on m3.material.io, and asks that expressive-only components be tagged, because they may not exist yet in the Compose Material3 version the project uses (`material3 = 1.12.0-alpha03`, Compose Multiplatform 1.12.1). |
| Both targets | The app is Compose Multiplatform: one `App()` in `commonMain` renders on the phone and in a resizable desktop window. The prompt states which M3 rules are Android-only (dynamic color, edge-to-edge, FAB conventions) and which are desktop-only (hover, keyboard focus, scrollbars, minimum window width). |
| Easy to read for the agent that builds Compose components | Fixed manifest (`MANIFEST.json`, `tokens.json`, `Color.kt`, `Theme.kt`, `SCREENS.md`), one spec section per Kotlin file, states listed per component, real copy from `FakePodcasts` instead of lorem ipsum. |

## Two things to check by hand afterwards

1. **Colors.** `Color.kt` claims to be the Material baseline scheme. Regenerate it from the seed
   with Material Theme Builder or the `com.google.android.material:compose-adapter` color
   utilities and diff. An eyeballed palette looks right and is wrong.
2. **Desktop.** The `Theme.kt` the design asks for must compile in `commonMain`. Android dynamic
   color cannot appear in it: `dynamicLightColorScheme(context)` needs an Android `Context`, so
   that branch belongs in `androidMain` behind an `expect`/`actual`. If the generated `Theme.kt`
   imports anything starting with `android.`, it is wrong for this project. Check the
   "Platform differences" section of `SCREENS.md` for the hover, focus and window-size decisions.
3. **Expressive components.** If the design uses button groups, split buttons, FAB shape morphing
   or expressive typography sizes, confirm each one exists in the Compose Material3 version in
   `app/gradle/libs.versions.toml`. Anything missing gets a plain M3 fallback before it reaches
   participants; this app is teaching material, not a showcase.

## The prompt

Copy everything inside the block.

````text
You are designing the UI of a small Android and desktop app called Mini Jetcaster. Return files
in the exact manifest at the end. Read the whole brief before designing.

1. PRODUCT

Mini Jetcaster is a podcast app used to teach Kotlin and Jetpack Compose to experienced
TypeScript and React Native developers in a one-day workshop. It runs on Compose Multiplatform:
one phone target and one desktop window, from the same code, and every composable you design
must work on both. This is not a mobile design with a desktop export; the desktop window is where
most workshop participants will actually look at the app while they code, because they iterate on
it with hot reload.

There is one screen, the Home screen, with four regions:

- Top app bar: app name, plus a count of subscribed podcasts.
- Podcast grid: adaptive cards, about 140dp minimum cell width. Two to five columns depending on
  window width.
- Episode list: the episodes of the selected podcast.
- Now playing bar: appears at the bottom when an episode is playing, with a fake progress counter.

Facts about the two targets that constrain the design:

- Android: a phone, touch only, edge-to-edge, system bar insets, system back gesture.
- Desktop: one resizable window that the user drags to any width, mouse and keyboard, hover and
  focus visible, text selection available, no insets, no system back.
- The same components, the same colors and the same type roles on both. One codebase; you are not
  allowed to design a second look for the desktop.

Interactions that will be implemented, in this order, as workshop milestones:

- M2: the grid and the episode list render.
- M3: a search field filters the grid by title; a subscribe toggle on each card updates the icon
  and the count in the top bar.
- M4: category filter chips (Tech, News, Comedy) above the grid, driven by a ViewModel.
- M5: a loading state, an error state with retry, and the now playing bar with a progress counter.

2. DESIGN SYSTEM SOURCE OF TRUTH

Follow Material Design 3 and the Material 3 Expressive update as published on m3.material.io.
Where the spec and this brief disagree, follow the spec and write the disagreement in
DESIGN-BRIEF.md.

The app is a teaching sample, so the design must look like an ordinary, well-built Material 3
app: no visual effects that a beginner could not reproduce in one or two Compose calls.

3. COLOR RULES (non-negotiable)

The color system is a Material 3 tonal palette, generated by the official Material Theme Builder
from the published Material baseline seed color, in both a light and a dark scheme. That static
pair is the whole palette and the design of record. Android dynamic color is a later opt-in for
that target only, see section 6.

- Do not invent, adjust, mix, blend, darken, lighten or hand-pick any color.
- Every color used anywhere in the output must be one of these roles, and must be written as the
  Material 3 role name, never as a hex:
    primary, onPrimary, primaryContainer, onPrimaryContainer
    secondary, onSecondary, secondaryContainer, onSecondaryContainer
    tertiary, onTertiary, tertiaryContainer, onTertiaryContainer
    error, onError, errorContainer, onErrorContainer
    background, onBackground
    surface, onSurface, surfaceVariant, onSurfaceVariant
    surfaceContainerLowest, surfaceContainerLow, surfaceContainer, surfaceContainerHigh,
      surfaceContainerHighest
    surfaceDim, surfaceBright, inverseSurface, inverseOnSurface, inversePrimary
    outline, outlineVariant
  Only include roles your generator actually produces. If a role does not exist in your output,
  drop it from the list and from Color.kt, and say so in DESIGN-BRIEF.md.
- If you want an accent and no role fits, the answer is a different existing role, not a new
  color.
- Color comes from using more roles, not from new ones. Use primary, secondary and tertiary and
  their container and fixed variants in different regions of the app. Show the difference; do not
  show saturation.
- Text and icons on any surface must use the matching "on" role. Contrast is not your problem to
  solve by hand, it is the generator's.
- Do not use gradients, opacity overlays, blurs, or tinted scrims. If a spec calls for an
  elevation tint, use the surfaceContainer role that the spec asks for instead.
- Dark scheme is the same roles, not a separate design. Design it as a real scheme, not a
  lightness inversion.
- Both schemes follow the system setting on each platform, light as the fallback when the platform
  reports nothing. The phone and the desktop window are usually in different settings during a
  workshop, so both schemes are first-class and neither may rely on an effect that only reads in
  one of them. Design the light scheme first, then the dark one, and check every state from
  section 8 in both.

The one place where the app must be colorful is the podcast cover placeholder. There is no cover
artwork: covers are drawn placeholders. Use the container roles to tell the categories apart:

  Tech    -> secondaryContainer with onSecondaryContainer
  News    -> tertiaryContainer with onTertiaryContainer
  Comedy  -> primaryContainer with onPrimaryContainer

Put this mapping in tokens.json as a named map, and render it in the mockups. It becomes a Kotlin
function over the Category enum, so it has to be exact, and the placeholder has to look finished
without artwork: use the category initial or a simple Material Symbols glyph on the container
color.

4. TYPOGRAPHY, SHAPE, ELEVATION, MOTION

Typography: only the Material 3 type scale roles (displayLarge through labelSmall, plus the
Expressive additions if your version of the spec has them). No custom sizes, weights or line
heights. Reference each text element by role, for example "titleMedium".

The default font is the platform default on each target and you must not choose a brand face. On
Android that is Roboto, on desktop it is the JVM default. Two consequences:

- Do not add letter spacing to compensate for a font you cannot see on the other platform.
- Test the type roles in the widest and the narrowest text you expect, and list any role where a
  label or a duration might be clipped by font differences in DESIGN-BRIEF.md.

Shape: only MaterialTheme.shapes roles (extraSmall, small, medium, large, extraLarge) plus the
Expressive shapes if the spec you follow defines them. State which one each element uses. Full
rounding must come from a shape role, never from a raw dp value.

Elevation: use the M3 elevation tiers mapped to surfaceContainer roles as the component spec
requires. No shadows you picked yourself.

Motion: standard M3 emphasized and standard easing, container-size and enter/exit transitions as
the spec defines them. In the mockups, describe motion in words in SCREENS.md instead of
animating it, except for the now playing progress bar, which should be visibly animatable.

5. COMPONENT WHITELIST

Use only these components. Names in Compose Material 3 terms.

Scaffold, TopAppBar (and CenterAlignedTopAppBar if you prefer it), SearchBar or TextField,
LazyVerticalGrid (as a grid), Card or AssistedCard, FilterChip, Chip, Button, FilledTonalButton,
OutlinedButton, TextButton, IconButton, FloatingActionButton, ExtendedFloatingActionButton,
Badge, Icon, ListItem, HorizontalDivider, LinearProgressIndicator, CircularProgressIndicator,
NavigationRail, NavigationBar, Snackbar, SegmentedButton, Tooltip, Switch.

From the M3 Expressive update you may use: standard and connected button groups, split buttons,
the five button sizes (XS to XL), FAB expansion and shape morphing, the expanded button set,
expressive typography sizes and the decorative shape tokens.

Tag every expressive-only component in SCREENS.md with the literal marker [expressive-only], so
the implementation can check it exists in the Compose library version in use and pick a plain M3
fallback if it does not. SegmentedButton is deprecated by the Expressive update in favor of
button groups: if you use it anyway, say why.

Nothing outside the whitelist. No carousels of custom cards, no bottom sheets with custom drag
behavior, no Lottie, no shaders, no custom gesture handling, no sticky headers with custom
scroll logic. This is teaching material: one component, one job, and a participant must be able
to write it after 20 minutes of explanation.

6. PLATFORM RULES: ANDROID AND DESKTOP

Some Material 3 guidance is Android only. The app is one Compose Multiplatform codebase in a
common source set, so treat these as hard constraints:

- Dynamic color from the wallpaper is an Android 12 feature. Do not design around it: the design
  must look complete with the generated static scheme, because desktop has no dynamic color at
  all. If you mention it, mark it [android-only].
- Both targets can read the system light or dark setting, but they do it in different ways and
  neither is live in the same manner: on Android the Activity is recreated, on desktop the value
  only refreshes while the app is polling for it. Do not design a theme transition; design two
  complete schemes and nothing in between.
- Edge to edge, system bar insets and the system back gesture are Android only. Do not place any
  control where only a system back gesture can reach it, because desktop has no back.
- FAB conventions are written for touch. A FAB is allowed on the phone layout; on desktop say what
  replaces it or confirm it works with a mouse.
- Snackbars are fine on both, but on desktop say where the message appears relative to the window.
- Hover, keyboard focus, tooltips on hover, scrollbars and window resize are desktop only and must
  be designed; they are listed in section 7 and section 8.
- No Android widgets, no Material Views, no XML, no resource qualifiers. Everything you specify
  has to be a Compose Multiplatform component.

Deliver the Theme so it compiles in the common source set:

- Theme.kt must not import anything starting with android. and must not take an Android Context.
- Do not put dynamicLightColorScheme or dynamicDarkColorScheme in it; those are Android only. The
  common theme takes a darkTheme flag and picks the generated light or dark scheme. Say in
  DESIGN-BRIEF.md that the Android entry point may opt into dynamic color on top of your static
  scheme, and that the static scheme is the design of record for both targets.
- Do not add a platform check, a LocalInspectionMode branch or an expect/actual declaration of
  your own; that is the implementation's job. Design one look that works on both.

7. LAYOUT AND RESPONSIVE BEHAVIOR

The desktop window is resizable by dragging its edge, and the Android screen has a fixed width.
Design one layout that adapts to width, not two layouts.

Design three width classes, from the M3 window size classes:

- Compact, 360dp wide: phone portrait, 1440px at 4x for the PNG.
- Medium, around 840dp: foldable, small tablet, or a small desktop window.
- Expanded, around 1280dp: a normal desktop window. This app really runs on desktop, so the wide
  layout is not an afterthought.

Rules for the wide layout:

- The podcast grid takes the columns it needs; the episode list keeps a readable line length
  instead of stretching across the window. Say which region grows and which one caps.
- The now playing bar stays full width at every window width.
- Give a minimum window width in dp, below which the layout stops shrinking gracefully.
- The grid must survive a height that shows only one row of cards plus a few episodes, which is
  what a short desktop window looks like, and it must not depend on a bottom navigation bar.

Desktop interaction, which has no equivalent on touch:

- Hover: say what changes on a card, an episode row and an icon button. Elevation and the
  surfaceContainer tier are allowed; a new color is not.
- Keyboard focus: every interactive element needs a visible focus state drawn with an existing
  color role, usually outline or primary. The search field, the subscribe toggle, the chips and
  the episode rows are all reachable with Tab.
- Click and drag on the lists, a visible scrollbar, and mouse wheel scrolling are expected; do
  not design gestures that need a touch.

Spacing comes from M3 spacing tokens (0, 4, 8, 12, 16, 24, 32dp and the Expressive additions if
defined). Name the token, not the number, in SCREENS.md. Touch targets at least 48dp; on desktop
they may look visually smaller, but the target stays 48dp. State heights that are not in the spec
as dp numbers and list them in DESIGN-BRIEF.md as "values I invented", so they get reviewed.


8. STATES TO DESIGN

Design each of these as its own frame. Do not design only the happy path.

Home grid: populated, filtered by a search term, filtered by a category chip, empty search result.
Podcast card: not subscribed, subscribed, with cover placeholder, without an image URL, long title
of about 40 characters, two-line author.
Episode row: default, selected, playing, read, long title, a duration under a minute (59s) and a
duration over two hours (2h 01m). The formatted duration strings are "42m", "1h 20m", "2h 01m",
"59s" style.
Episode list: populated, loading with a spinner or skeleton, error with a retry button.
Now playing bar: playing with progress at about 40 percent, paused, and the transition from an
empty bottom area to a visible bar (describe it).
Top app bar: with and without the subscription badge, with a badge count of 0 and of 12.
Search: focused, with text and a clear button.
States that only appear on desktop, one frame each in screens/States.Desktop.png:

- A card, an episode row and an icon button in the hover state.
- The search field and a subscribe toggle in the keyboard focus state, shown next to each other so
  the difference between focus and selection is readable.
- The window at the minimum width you chose in section 7.


9. CONTENT TO USE (real copy, no lorem ipsum anywhere)

App name: Mini Jetcaster.

Podcasts, as shown in the cards (title, author, category):
  Compiled Weekly, Ada Moreno, Tech
  The Null Pointer, Sam Okafor and Lin Wei, Tech
  Recomposed, Priya Nair, Tech
  The Morning Brief, Daily Desk, News
  Slow News Club, Marta Kowalska, News
  Standup Standup, Joe Ruiz, Comedy
  Merge Conflict Therapy, Dana Fox and Theo Brandt, Comedy
  Off By One, Kai Lindqvist, Comedy

Episodes, as shown in the list (title, duration, date):
  Kotlin 2.4 in ten minutes, 31m, 2026-10-02
  What is new in Compose Multiplatform, 34m, 2026-09-25
  AGP 9 and the new Android KMP plugin, 29m, 2026-09-18
  The cache that cached the error page, 55m, 2026-10-01
  Time zones, again, 1h 07m, 2026-09-17
  The meeting that could have been an email, 59s, 2026-09-21
  Estimation poker, extended cut, 2h 01m, 2026-09-07
  Why state flows down and events go up, 1h 30m, 2026-09-29

Podcast descriptions, used wherever the design shows a description:
  A Kotlin and Android news roundup, every Friday in 30 minutes.
  Two engineers argue about the bugs that took down their week.
  Comedians read out their worst daily standup updates.

Category labels are exactly: Tech, News, Comedy.
Empty search result message, if you add a screen for it: "No podcasts match that search".
Error message: "Could not load episodes". Retry button label: "Try again".

No stock photography, no external image URLs, no logos, no AI-generated cover art. Placeholders
only, drawn with color roles and type.


10. HOW TO MAP THE DESIGN ONTO CODE

The implementation already has these files. Group your design so each one maps to one section of
SCREENS.md, under exactly these headings:

  App.kt            (Scaffold, window and theme setup)
  HomeScreen.kt     (regions, layout, responsiveness)
  PodcastGrid.kt    (grid, column rules, spacing)
  PodcastCard.kt    (card anatomy, cover placeholder, subscribe toggle, states)
  EpisodeList.kt    (list, dividers, loading, error)
  EpisodeRow.kt     (row anatomy, playing state, duration)
  NowPlayingBar.kt  (anatomy, progress, controls)
  Theme             (color, type, shape wiring; nothing invented here)

In SCREENS.md, for each element write: the component used, its size or variant, the type role,
the color roles, the shape role, the spacing tokens, and what changes between states. Write it as
a short list per element, not as prose. Use one heading per component, at most four levels deep.
No table wider than five columns.


11. DELIVERABLES AND EXACT FILE MANIFEST

File names matter: another agent reads these files to write the code. Use exactly these paths and
names, flat, no numbered prefixes, no nested folders beyond the ones listed.

  MANIFEST.json
    {
      "project": "Mini Jetcaster",
      "designSystem": "<what you used, with the spec version or date you followed>",
      "seedColor": { "name": "Material baseline", "hex": "<hex the generator was given>" },
      "files": [
        { "path": "tokens.json", "purpose": "design tokens", "format": "json" }
      ],
      "screens": [
        { "id": "HomeScreen", "image": "screens/HomeScreen.png", "spec": "SCREENS.md#podcastgrid",
          "states": ["populated", "filtered"], "expressiveOnly": ["ButtonGroup"] }
      ],
      "unknowns": ["<anything you had to decide without a rule to follow>"]
    }
  tokens.json
    Flat JSON, three top level objects: "color" with "light" and "dark", each a map of role name
    to "#RRGGBB"; "typography" with one object per type role holding fontFamily, fontWeight,
    fontSize, lineHeight, letterSpacing; "shape" with corner radii; "spacing" with the token map
    you used; "motion" with duration and easing tokens; and "categoryCover" with the Tech, News
    and Comedy color role pairs. Role names in tokens.json must be the exact Material 3 role
    names, camelCase, because they become Kotlin property names.
  Color.kt
    Valid Kotlin. Every role for both schemes, in this shape:
      val md_theme_light_primary = Color(0xFF000000)
      val md_theme_dark_primary = Color(0xFF000000)
    Nothing else: no imports of your own, no comments about your reasoning.
  Theme.kt
    Valid Kotlin, common-source-set safe under the rules in section 6. A lightColorScheme(...) and
    darkColorScheme(...) that consume the Color.kt values, and a MiniJetcasterTheme composable
    that takes a darkTheme boolean defaulting to isSystemInDarkTheme() and picks one of the two
    generated schemes. That function is common API, available on both targets. No dynamicColor
    parameter, no Context, no Android import: dynamic color is an opt-in the Android entry point
    can add later, and it must not appear here. Do not change MaterialTheme defaults you were not
    asked to change.
  DESIGN-BRIEF.md
    What you understood, the decisions you made, the values you had to invent, the roles your
    generator did not produce, and the questions you would ask the product owner. Bullet lists,
    no more than 400 words.
  SCREENS.md
    The per-component spec described in section 10, plus a short "How to read this" at the top.
  screens/HomeScreen.compact.png
  screens/HomeScreen.medium.png
  screens/HomeScreen.expanded.png
  screens/PodcastCard.png            one sheet with the card states laid out side by side
  screens/EpisodeRow.png             one sheet with the row states
  screens/NowPlayingBar.png
  screens/States.png                 loading, error, empty search, subscribed, focused search
  screens/States.Desktop.png         hover, keyboard focus, and the minimum window width
  screens/HomeScreen.dark.png
  screens/*.html                     a standalone HTML file for each PNG above, same base name,
                                     that reproduces that frame in the browser using only tokens
                                     from tokens.json

If a file in this manifest is not possible, still create it and write one line saying why. Never
leave a path out of MANIFEST.json.


12. HARD RULES

- Material 3 only. If you depart from m3.material.io anywhere, say where and why in
  DESIGN-BRIEF.md. An undocumented departure is a defect.
- No color outside the generated palette, in any file, including the HTML.
- In the HTML, drive every color, size and radius from CSS custom properties generated from
  tokens.json, with the Material role names as the property names, for example
  --md-sys-color-primary. Include a light and dark toggle.
- The mockups are the ground truth and tokens.json is the contract. If they disagree, fix the
  mockup, and note it.
- Do not add screens, features, settings, onboarding or navigation destinations beyond the Home
  screen and the states in section 8.
- Do not write Kotlin beyond Color.kt and Theme.kt. Composables for the components belong to the
  implementation, not to you.
- All output text in English.


13. BEFORE YOU RETURN

Check these and report the result in DESIGN-BRIEF.md, one line each:

- Every color in every mockup is a role from section 3, and each role appears in tokens.json in
  both schemes.
- Every text element names a type role.
- Every radius names a shape role.
- Every color used in the HTML resolves through a CSS custom property, with no literal hex value
  outside the token block.
- Each component in the mockups appears in the whitelist.
- Each expressive component used is tagged [expressive-only].
- Theme.kt compiles in a common source set: no android. import, no Context parameter, no dynamic
color call, no platform check.
- Every desktop-only behavior (hover, focus, resize, minimum width) is written down in SCREENS.md
  and not left implicit.
- Both color schemes are complete and every role appears in both; the design does not depend on
  Android dynamic color anywhere.
- Every path in MANIFEST.json exists, and MANIFEST.json lists every file you produced.
- No lorem ipsum, no placeholder names, no fake brand color.
````

## Follow-up prompts

Run these one at a time, after you have looked at the first pass.

To push the color without breaking the palette:

```text
More color, same rules: use the tertiary and the fixed color roles you are not using yet, and use
different surfaceContainer tiers per region so the four regions read as separate. Still zero
invented colors. Update tokens.json, SCREENS.md and the affected PNG and HTML files, and add a
line to DESIGN-BRIEF.md for each role you bring in.
```

To check it against the spec:

```text
Audit your own output against m3.material.io, including the M3 Expressive update. List every
place where a component, size, color, shape or spacing choice does not match the published spec,
or where you cannot point to the spec. Fix the clear-cut ones, keep the rest as open questions in
DESIGN-BRIEF.md, and mark anything expressive-only with [expressive-only].
```

To check the desktop half specifically:

```text
Re-read your own output as a desktop reviewer. The app runs in one resizable window with a mouse
and a keyboard, and the code is shared with Android, so nothing can be touch-only. Report every
place where the design assumes touch, assumes a fixed width, assumes a system back gesture, or
assumes an Android-only feature such as dynamic color or edge-to-edge insets. Fix them, add the
missing hover, focus and minimum-width frames, and update Theme.kt so it compiles in a common
source set.
```

To cut complexity before it reaches participants:

```text
This is teaching material for people learning Kotlin in one day. For each element in SCREENS.md,
say whether a beginner could write it in Compose in under 10 minutes. Flag everything they could
not, simplify it to the nearest plain M3 component, and list what you changed.
```

## Handing it back

Download the project as `.zip` (or "standalone HTML" plus the token file if only one frame is
needed), unzip it inside this repo at `docs/design/`, and tell me the path. I read `MANIFEST.json`
first, then `tokens.json`, `Color.kt`, `Theme.kt` and `SCREENS.md`, and I regenerate the palette
from the seed before trusting it. Then the components land in
`app/shared/src/commonMain/kotlin/com/callstack/minijetcaster/ui/` with the names in section 10.

If the output only looks good on the phone, do not accept it: run the desktop follow-up above
before anything reaches `commonMain`. The desktop window is the one participants stare at for most
of the day.

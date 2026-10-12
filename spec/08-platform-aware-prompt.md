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
additive and must never contradict each other; the test for that is in the maintenance section.

### Base (always)

The existing rules from the workshop prompt, unchanged: Material 3 role whitelist only, both
schemes, real content, per-component spec, the machine-readable manifest. Add:

~~~text
Target awareness: this design will be converted to <TARGETS> by a tool, not read by a human
designer. The rules in the TARGET RULES block are not preferences, they are capability limits. A
design that needs a capability the target lacks must be redesigned, not annotated.
~~~

### Compose and Compose Multiplatform block

~~~text
TARGET RULES: Compose / Compose Multiplatform

- Layout is Row, Column, Box, FlowRow, and lazy lists and grids. There is no CSS Grid and no
  two-dimensional layout. Express alignment with Arrangement and Alignment.
- Corner clipping does not come free: if a rounded container has a child with its own background,
  say which shape the child must use.
- There is no margin. Spacing comes from padding and from spacedBy between siblings.
- Elevation is a tonal surface step, one of 0, 1, 3, 6, 8, 12 dp. Declare it with data-elevation.
  Never draw a box-shadow.
- Icons are vectors from a fixed set. Name each one with data-icon="ic_name" so it can be matched,
  and if the project has no icon library, expect inline SVG.
- Text scales with the user's font setting. Any layout that only works at one text size is a bug:
  check every row where text can grow.
- Surfaces come in container tiers (surfaceContainer through Highest). Use tiers, not alpha, to
  separate regions.
- Desktop and Android share one code path. Anything requiring touch-only or mouse-only input must
  be labeled.
~~~

### React Native block

~~~text
TARGET RULES: React Native

- Yoga only: flex, no grid, no wrap-heavy layouts, no subgrid.
- Shadows are platform-specific. Prefer surface color steps; if a shadow is required, say which
  platform should carry it.
- No backdrop-filter, no clip-path, no blend modes, no CSS pseudo elements.
- Fonts: a weight above regular only renders if the font is bundled. Name every non-regular weight
  and expect a review.
- Safe areas are a runtime concern. Do not bake status bar padding into the design; mark the region
  with data-region="top-bar" and let the code add insets.
- Text truncation needs a line count. Say maxLines for every text block that can overflow.
- There is no hover on touch. Affordances must be visible without it.
~~~

### React web block

~~~text
TARGET RULES: React web

- Layout may use CSS Grid and flexbox; the converter keeps them as CSS.
- Prefer the component library's own surface and typography props over raw CSS. Name which library
  in config: @material/web, MUI, or plain.
- Keep every color as a custom property from the token file.
~~~

## Contract annotations the prompt must require

These are the fields in spec/01 that the design tool has to write. Requiring them in the prompt is
what makes conversion deterministic, so they belong in the prompt text, phrased as output
requirements rather than as converter needs:

~~~text
Markup contract. Every frame's HTML must carry:
- data-component="kebab-name" on each repeated component root, the same value across instances
- data-state="..." or data-variant="..." on each state frame
- data-prop="..." on each piece of text that varies between instances
- data-elevation="0|1|3|6|8|12" on surfaces that sit at an elevation
- data-token="colorScheme.<role>" on elements whose background is a theme color
- data-grid-min="140" on grid containers, the minimum cell width
- data-scroll="list|grid" on scrollable regions
- data-region="top-bar|content|now-playing-bar|snackbar" on Scaffold-like regions
- data-icon="ic_name" on every icon: the name is required, it is the only thing the converter
  cannot measure off the screen
- inline SVG with fill="currentColor" for those icons, because a glyph font cannot be converted, only
  referenced (spec/01 icon policy); if you must use an icon font, keep data-icon on every glyph
Frames are fixed width, one per file, all CSS inline in the file, no network at all, and dark mode
reaches through @media (prefers-color-scheme: dark) without JavaScript.
~~~

## Design-for-convertibility, the rules worth stating as design advice

Not contract items, but they make the output better and cost nothing:

- Ask for **one component and its states**, not one frame per state. A state is a parameter.
- Ask for the empty, loading and error variants explicitly; a design that skips them produces code
  that crashes on the first empty list.
- Ask for the longest realistic string in the design, not the prettiest. Truncation behavior is a
  design decision and it should be made while designing.
- Ask for **two width classes minimum** for anything that will run on a resizable window.
- Ask the tool to state, in the brief, which decisions it made that a converter cannot see.

## The design brief as a converter input

Have the design tool emit a machine-readable decisions file, not only prose:

~~~json
{
  "components": {
    "podcast-card": {
      "states": [{"name":"subscribed","kind":"boolean"}],
      "props": [{"name":"title","type":"string"},{"name":"author","type":"string"}],
      "actions": [{"name":"onSubscribeClick","evidence":"data-action=subscribe"}],
      "notes": "cover is a placeholder drawn from a container color, no artwork"
    }
  },
  "invented": ["card min height 200px, not in the spec"],
  "open": ["does the now playing bar overlay the list or push it?"]
}
~~~

When this file exists, the converter reads it instead of inferring, and the \`ComponentGroup\` params
become input rather than detection. When it disagrees with the HTML, the HTML wins and the
disagreement is reported: markup is what was looked at, JSON is what was claimed.

## Maintenance, because this prompt will drift

- One source of truth per rule. A rule that lives in both the workshop prompt and this spec gets
  changed in one place and rots in the other. Keep the target blocks here, the shared rules in the
  workshop prompt, and have the wizard assemble them.
- Every rule here must be checkable by the validator or it is decoration. When a rule cannot be
  checked, move it to the advice section instead of the contract section.
- Test the prompt by running the validator on its own output. The check is: does a fresh export pass
  with zero errors? An export that needs manual fixes means the prompt is not asking for the right
  thing, and the fix is the prompt, not the file.
- Keep target blocks additive. If two blocks both speak about shadows and disagree, the assembler
  must fail rather than concatenate.

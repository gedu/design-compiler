Target awareness: this design will be converted to Compose / Compose Multiplatform by a tool, not read by a human designer. The TARGET RULES below are not preferences, they are capability limits: a design that needs a capability a target lacks must be redesigned, not annotated. Where several targets are named, the design has to work on all of them, so a capability only one target has is a capability this design may not use.

TARGET RULES: Compose / Compose Multiplatform
- Layout is Row, Column, Box, FlowRow and lazy lists or grids. There is no CSS Grid, no margin and no box model: alignment comes from Arrangement and Alignment, spacing from padding and from spacedBy between siblings.
- Surfaces come in container tiers (surfaceContainer through surfaceContainerHighest). Separate regions with a tier, never with alpha.
- Desktop, iOS and Android share one code path. Anything that needs touch-only or mouse-only input must be labeled.
- A grid is a decision and not a layout feature: wherever this design shows a two-dimensional layout, declare its minimum cell width with data-grid-min.
- Corner clipping does not come free: if a rounded container holds a child with its own background, say which shape the child must use.
- Write every length as an absolute px number and nothing else: no em, rem or percent for a layout size, because a relative size has no one meaning across these targets.
- Elevation is a declared step, data-elevation with one of 0, 1, 3, 6, 8 or 12, and never a drawn box-shadow.
- Icons are named whatever draws them: put data-icon="ic_name" on every icon and prefer inline SVG with fill="currentColor", because a glyph font can be named but never converted.
- Text size is a user setting, so a layout that only works at one text size is a bug: check every row where text can grow.
- Text that can run long needs a declared line limit: give the maximum line count for every text block that can overflow.
- A state is a parameter, not a separate frame: show every state you want compiled, and reach no state through hover alone, because a touch target has none.
- Safe area insets are a runtime value. Never bake status bar or notch padding into the design: mark the region with data-region="top-bar" and let the code add the insets.

CONTRACT REQUIREMENTS. Every line below is checked on what you export, and a miss is a failure reported back to you.

Token file
- Give color.light and color.dark the same set of role names. A role that exists in one scheme and not the other is a bug in the export, not a design choice.
- Ship a tokens.json next to the frames containing every color role for both schemes plus typography, shape and spacing. No frame may depend on a token that is not in that file.
- Include the typography, shape and spacing maps in tokens.json, with the exact font size, line height, weight and letter spacing of every type role you used.

Manifest
- State the design system and the seed color (as #RRGGBB) the palette was generated from in MANIFEST.json.
- In MANIFEST.json, give every screen its width class in dp and list every frame that appears on the board. A frame the manifest does not name is a frame nobody asked for.

Decisions file
- Write a decisions.json next to the frames listing the values you invented and the decisions a reader cannot see in the markup; prose alone is not enough.

CSS and self-containment
- Put every style rule inside a <style> block in the same file: no <link rel="stylesheet"> and no @import for your own CSS. This is about your CSS only; the no-network rule below is a separate requirement.

No network
- Do not load any stylesheet or font from a CDN. If a font is genuinely required, name it and its weight in decisions.json.
- No image may be referenced by URL. Draw artwork from a token color, or inline it as SVG data, so the file renders with the network off.
- The file must render complete with the network disabled: no <link>, no script src, no font or icon URL pointing outside the export folder.

Fonts
- Set every text run in a stack that starts with the platform default: Roboto, then system sans.
- Body text must use the platform font stack (Roboto, then system sans). Do not load a webfont for body text from a CDN.

Colors and tokens
- Write every color as a custom property whose name is a Material role, such as --md-sys-color-primary.
- Never put alpha on a role color, never use color-mix(), and never use opacity to fake a container: use the container tier the design means.
- Use a flat surface or container color for backgrounds; no gradient background.
- Keep literal hex values inside the token file and out of the markup: the design body references properties only.
- Put data-token="colorScheme.<role>" on any element whose background is a theme color.

Text roles
- Mark text you want named in the generated API with data-role="title", "subtitle" or "meta".

Units and sizes
- Never use vh, vw, dvh, svh, vmin or vmax for a size, and never use transform to place something.
- Write every length in px and treat 1px as 1dp; no em, rem or percent for layout sizes.

Layout
- Build layouts with flex and grid only. Use position: absolute only for an overlay that sits on top of a box you also declare, and mark the box it overlays.

Grids
- Put data-grid-min="140" on every grid container: the minimum cell width is a decision, not something measurable off the rendered tracks.

Scrolling regions
- Put data-scroll="list" or data-scroll="grid" on any region the app scrolls through.

Named regions
- Label the Scaffold-like regions: data-region with top-bar, content, now-playing-bar or snackbar.

Elevation
- Declare data-elevation on any surface that sits at an elevation, with one of 0, 1, 3, 6, 8 or 12.

Effects with no equivalent
- Avoid overflow tricks, clip-path, filter: blur() and gradients: no target has a single property for them.

Icons
- Draw icons as inline SVG with fill="currentColor"; a glyph font cannot be converted, only referenced by name.
- Put data-icon="ic_name" on every icon, inline SVG or glyph alike: the name is the one thing no one can measure off the screen.

Components and props
- Use the same data-component value on every instance of the same component.
- Put data-component="kebab-name" on the root of every component you expect to become code.
- Mark every piece of text that varies between instances with data-prop="title", "author" and so on; unmarked copy is welded into the generated component.

States
- Put data-state="..." (or data-variant, data-size) on each state you show, so a state becomes a parameter instead of a twelfth component.
- Show every state you want compiled as markup the converter can reach, either its own block or a declared state the tool can select. A state that only an animation or a hover reaches is a state no code gets.

Markup the converter can read
- Put real information in real nodes: no text or icon carried by ::before or ::after.

Names
- Write class names and data-component values as ASCII kebab-case; they become Kotlin and TypeScript identifiers.

Content
- Use the real strings the app will show; never lorem ipsum or placeholder filler.

DESIGN FOR CONVERTIBILITY. Not contract requirements: these cost nothing and make the generated code better.
- Ask for one component and its states, not one frame per state. A state is a parameter.
- Show the empty, loading and error variants. A design that skips them becomes code that crashes on the first empty list.
- Use the longest realistic string, not the prettiest one. Truncation is a design decision and it is cheapest while designing.
- Give two width classes or more for anything that will run in a resizable window.
- Say in the brief which decisions you made that a reader cannot see in the markup.

DECISIONS FILE. Emit this machine-readable file next to the frames, not only prose.
The converter reads it instead of guessing, so a component's props arrive as input rather than as a guess about which text varies. When it disagrees with the markup, the markup wins and the disagreement is reported: markup is what was looked at, this file is what was claimed.
~~~json
{
  "components": {
    "podcast-card": {
      "states": [
        {
          "name": "subscribed",
          "kind": "boolean"
        }
      ],
      "props": [
        {
          "name": "title",
          "type": "string"
        },
        {
          "name": "author",
          "type": "string"
        }
      ],
      "actions": [
        {
          "name": "onSubscribeClick",
          "evidence": "data-action=subscribe"
        }
      ],
      "notes": "cover is a placeholder drawn from a container color, no artwork"
    }
  },
  "invented": [
    "card min height 200px, not in the spec"
  ],
  "open": [
    "does the now playing bar overlay the list or push it?"
  ]
}
~~~

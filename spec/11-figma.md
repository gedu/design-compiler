# 11 Figma target, and the import route

Two ways to get the design into Figma. Pick deliberately: one has no quota and no plugin but weaker
fidelity, the other is the opposite.

## Route A, the plugin import (default)

Feed the export's HTML to the html.to.design plugin. Free Figma (Starter) runs it, and it produces
auto layout, styles and variables from real rendered CSS, which is better fidelity than any emitter
can synthesize.

| | Free | Paid |
| --- | --- | --- |
| Figma Starter | plugins, full editor, auto layout, local components, variables, styles, export, unlimited drafts | |
| Starter caps | 3 design files, 3 pages per file, one folder, 30 day history, no team libraries, no Dev Mode, 20 MCP calls per month | |
| **Variable modes** | **not available**; modes require Education, Professional, Organization or Enterprise | 10 modes on Professional, 20 on Organization |
| Plugin free | URL import, local \`.html\` / \`.zip\` upload, code editor, multi viewport, light and dark capture, auto layout, styles and variables, font mapping | about 10 to 12 imports per 30 days |

Two consequences the wizard must enforce:

1. **Light and dark cannot be two modes on free Figma.** Import the same frames twice, once per
   theme, as two collections. This matches Compose and RN anyway: two \`ColorScheme\` objects picked at
   runtime, not a runtime mode switch. Never let anyone hand-paint dark fills onto light frames to
   fake it, that is the exact failure the color rules exist to prevent.
2. **Import budget is about 10.** With nine frames, per-frame times two themes is eighteen imports
   and burns the month. Emit one stacked page (\`import/all.html\`) and capture it twice: two imports for
   the whole design, eight left for fixes.

The contract rules in spec/01 (self-contained CSS, no CDN fonts, media-query dark mode, fixed width,
semantic class names) are exactly what makes this import clean. The same rules serve the converter
and the plugin, which is why they are cheap.

## Route B, emit Figma from the IR

The IR already holds what Figma needs: geometry, roles, resolved colors, resolved type. Emission
goes through the Figma REST or Plugin API and creates frames, auto layout, text nodes and a variable
collection.

| | Route A | Route B |
| --- | --- | --- |
| Cost | free tier works | token setup, API rate limits |
| Import quota | yes, about 10 a month | none |
| Fidelity | what the browser rendered, including things the IR dropped | only what the IR captured |
| Naming | HTML class names | component names, parameters, state variants as variants |
| Variables | created from CSS values | created with the real Material role names, and modes where the plan allows |
| Round trip | one way | code and Figma both come from the IR, so they cannot drift |

Route B is the one that earns its keep only if the design file is a **living artifact** that gets
regenerated from code. If Figma is a one-time handoff, Route A is better and Route B is
maintenance burden with a token attached.

Recommendation: ship Route A first. Build Route B only when a real workflow needs repeated
regeneration, and treat it as a second emitter over the same IR, never as a re-parse of the HTML.

## What the wizard should emit for designers

- \`import/all.html\`: every frame stacked, labeled, one light capture and one dark capture.
- \`FIGMA.md\`: the exact import options to enable, the 1dp equals 1px convention, which frames need both
  themes, and the free-plan mode limitation written down before someone discovers it by hand.
- \`tokens.json\` unchanged: Figma variables created from CSS should be checked against the token file,
  because a plugin reading rendered values can pick up a rounding or a fallback the design never
  intended.

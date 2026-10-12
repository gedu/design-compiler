# 06 React web mapping

The cheap target, and the least valuable one. Build it last, and be honest about why it exists.

Claude Design already produced working web. Regenerating it is not the point. This target is worth
having for two narrow reasons:

1. **It emits against a component library.** Design IR to Material Web (\`@material/web\`) or to MUI or
   to the design system of a specific client. That is a real task, and the IR makes it mechanical:
   the IR already knows this box is a Card with a \`primaryContainer\` background and \`titleMedium\`
   text, which is exactly what a MUI \`<Card>\` needs.
2. **It proves the IR.** If the web emitter can only reproduce the input by inlining all its CSS, the
   IR lost information. Emitting semantic React plus CSS Modules is a decent test that the tree is
   an actual design and not a stylesheet dump.

## Mapping

| IR | React web |
| --- | --- |
| Node kind | a DOM element chosen by semantics, not by the original tag: \`li\` in a list becomes \`<li>\`, a button stays a \`<button>\` |
| \`data-component\` | the component name and file name |
| \`data-state\`, \`data-variant\` | props, and a class-per-variant in the module |
| Color custom properties | CSS custom properties declared once in \`tokens.css\`, referenced everywhere else; do not inline hexes |
| Type roles | a class per role (\`.titleMedium\`) generated from the token file, so the type scale stays one place |
| \`aspect-ratio\`, \`gap\`, flex | keep them as CSS. Converting working CSS to inline styles is a downgrade |
| \`box-shadow\` | drop it if the source declared an elevation; keep it only if the project uses real shadows |
| Inline SVG | a shared \`Icon\` component with the path data, \`fill="currentColor"\` preserved |
| \`data-prop\` | a prop with the design's string as the default |
| Scroll regions | \`overflow\` in CSS. Do not reach for a virtualized list unless the project already has one |

## Emission rules

- One component per file, TypeScript, props interface exported, no default export unless the project
  uses them.
- \`Component.module.css\` beside it, classes camelCased for \`styles.fooBar\` access.
- \`tokens.css\` with both themes: light on \`:root\`, dark under \`@media (prefers-color-scheme: dark)\` and
  also under \`:root[data-theme="dark"]\`, so a JS toggle and the media query both work.
- \`theme.ts\` re-exporting the same values as typed constants, for components that need a number rather
  than a property.
- No styled-components, no Tailwind, no Emotion, unless configuration asks for it. CSS Modules keep
  the output readable and diffable.
- No \`useState\`, no \`useEffect\`, no router, no query library. Callbacks are optional props.

## When to skip this target

If nobody asked for a web build and no component library is in play, skip it. Emitting React that
duplicates the design's own HTML is negative value: two web implementations, and the generated one
is worse. Say so in the wizard rather than producing it because a flag exists.

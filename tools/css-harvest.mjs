// The bridge's one canonical CSS reader (spec/13-bridge.md).
//
// Two rules make it different from a regex someone writes at the moment, and both were found by
// measuring fixtures/reference rather than by reading the CSS spec:
//
// 1. A `{{ }}` hole is ONE opaque token and never a terminator. A `.dc.html` value can hold one
//    (`overflow-y: {{ bodyScroll }}`), and a value pattern like `[^;{}]*` stops at the hole's opening
//    brace. Measured on the reference export, that silently loses 7 of 887 declarations -- including
//    every `overflow-y` in the file, which is the property spec/03 uses to decide a scroll container.
//    So holes are protected into one character before anything splits, and are never expanded: the
//    bridge does not know what the runtime will substitute and does not pretend to.
//
// 2. Declarations live inside a rule body. In a `<style>` block every `{...}` group is a body, so a
//    selector (`a:hover{...}`) can never be read as a declaration of a property called `a`. A
//    `style="..."` attribute body IS the declaration list and holds no selectors.
//
// Vendor prefixes are kept verbatim: `-webkit-line-clamp` is the source of `maxLines` in spec/03, and
// a reader that strips or rejects the leading dash drops it.
//
// tools/validate.mjs still has its own reader, because its frozen baseline counts were measured
// against that behaviour. Folding the two together is T6's work, not this task's.

// The two places CSS lives in a Claude Design template. `style-<state>=` carries the same syntax as
// `style=` and is authored by the runtime, so it is read the same way (spec/10: hints are evidence).
export const STYLE_ATTR = /(?:^|\s)(style|style-(?:hover|pressed|focus|active|selected|disabled))\s*=\s*"([^"]*)"/g;
export const STYLE_BLOCK = /<style[^>]*>([\s\S]*?)<\/style>/g;

export const HOLE = '\u0001';
export const HOLE_TOKEN = '{{ }}';

// Replace every `{{ ... }}` with one character and report how many there were.
export function protectHoles(text) {
  let holes = 0;
  const safe = text.replace(/\{\{[^}]*\}\}/g, () => {
    holes++;
    return HOLE;
  });
  return { safe, holes };
}

// The inside of every `{ ... }` group in a stylesheet: the only place declarations can live.
export function ruleBodies(text) {
  const out = [];
  const re = /\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

// kind 'attr' for a style="..." body, 'block' for a <style> element body.
export function declarations(chunk, kind) {
  const { safe } = protectHoles(chunk);
  const list = kind === 'block' ? ruleBodies(safe) : [safe];
  const out = [];
  for (const body of list)
    for (const part of body.split(';')) {
      const i = part.indexOf(':');
      if (i < 0) continue;
      const prop = part.slice(0, i).trim().toLowerCase();
      const value = part.slice(i + 1).trim();
      if (!/^-?[a-z][-\w]*$/.test(prop) || !value) continue;
      out.push({ prop, value: value.split(HOLE).join(HOLE_TOKEN) });
    }
  return out;
}

// Every declaration in one template source, with the attribute or block that carried it.
export function harvestSource(src) {
  const chunks = [];
  let m;
  STYLE_ATTR.lastIndex = 0;
  while ((m = STYLE_ATTR.exec(src))) chunks.push({ attr: m[1], text: m[2], index: m.index, kind: 'attr' });
  STYLE_BLOCK.lastIndex = 0;
  while ((m = STYLE_BLOCK.exec(src))) chunks.push({ attr: 'style', text: m[1], index: m.index, kind: 'block' });
  const decls = [];
  for (const c of chunks) for (const d of declarations(c.text, c.kind)) decls.push({ ...d, ...c });
  return { chunks, decls };
}

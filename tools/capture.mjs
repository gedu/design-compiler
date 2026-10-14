#!/usr/bin/env node
// T5/WU4b -- capture one materialized frame into the spec/02 Node tree, IN MEMORY.
//
// Scope, stated so nobody mistakes this for T6: one frame, one theme, no IR file on disk, no
// second target, no repetition grouping, no ComponentGroup. The point is the two remaining links:
// computed style -> resolved Node tree, then Node tree -> compiling Compose. spec/02's `components`
// and the data-scroll / data-grid-min detection that feeds them stay with T6.
//
// Four measurements shaped this file, each against the live DOM of fixtures/annotated, each with
// the check in tests/capture.test.mjs that keeps it from rotting:
//
//   1. Text hides in a runtime span (docs/lessons.md). Every run of text sits inside
//      `<span class="sc-interp">` -- no data-*, no id, and every sampled style property identical
//      to its parent. The OWNER holds the paint, the clamp and the box; the carrier holds the
//      string. Reading leaves yields clamp none and a 110x16 ink box inside the div's 160x40, so
//      the carrier is dropped and its text moves to the nearest surviving ancestor. Every style
//      value is read off that ancestor, never off the span.
//
//   2. `data-*` is two namespaces. spec/03's "never reduce anything with a data-* attribute", read
//      literally, protects the runtime's own scaffolding, because dc-runtime stamps `data-dc-tpl`
//      on nearly every expanded node and `data-sc-name` on the template host. Only the contract set
//      is author intent: CONTRACT_ATTRS vs RUNTIME_ATTR.
//
//   3. The custom property NAME survives the render, and that is the disambiguator. spec/03 Capture
//      step 4: "that map is the authority; a computed hex is only evidence". Measured: after
//      `{{ cardBg }}` resolves, the element's own style attribute reads
//      `background: var(--md-sys-color-surface-container)`, so the role is NAMED, not reverse-
//      looked-up. Read from the live attribute, it settles what the hex lookup alone cannot:
//      #E8DEF8 is light secondaryContainer AND dark onSecondaryContainer.
//
//   4. A glyph is not copy. The two glyphs render as the LITERAL strings "terminal" and
//      "bookmark_add" because they are a glyph font. A text extractor emits icon names as
//      user-visible copy. An element carrying data-icon becomes role Icon with `icon` set and
//      `text` null.
//
// What the page CANNOT answer, measured, so the source text is read instead: after the runtime
// expands a <dc-import>, `querySelectorAll('dc-import')` is empty, the template's `data-props`
// schema is gone from the live DOM, and `onClick="{{ toggle }}"` has been consumed (the live card
// reports no handler at all). Props, callbacks and hint-size are therefore source-side facts; the
// page answers geometry and paint only.
//
// Refusal, not invention (invariant 3): the two health gates of spec/03 plus a not-settled render
// and any page error are checked BEFORE a style is read, and on the page the styles are actually
// read from. One frame means exactly one instance per annotated component; a second is refused
// rather than quietly narrowed to the first. A color that is no role keeps role null and source
// `unresolved` with an error diagnostic, never a literal a reader has to trust.
//
// Determinism (invariant 1): the screenshot and loadMs are the only unstable facts the transport
// carries (docs/lessons.md: probe.json), so neither is read here, and canonicalJson sorts keys.
//
//   node tools/capture.mjs [--dir fixtures/annotated] [--frame PodcastCard.compact]
//                          [--theme light|dark] [--board Annotated.dc.html] [--json]
// Prints the IR to stdout. Writes no file. Exit 0 clean, 1 on an error diagnostic, 3 refused.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { readRoleMap, roleForColor, roleForType, shapeForRadius, elevationForLevel } from './resolve.mjs';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The contract set, from spec/01. These are the author's intent, and spec/03 forbids reducing a
// node that carries one.
export const CONTRACT_ATTRS = [
  'data-component', 'data-prop', 'data-icon', 'data-token', 'data-elevation',
  'data-region', 'data-scroll', 'data-grid-min', 'data-state', 'data-variant', 'data-size', 'data-action',
];
const CONTRACT = new Set(CONTRACT_ATTRS);

// Everything else data-shaped belongs to dc-runtime. Measured in the rendered DOM of this fixture:
// data-dc-tpl (on nearly every expanded node), data-sc-name (the template host), data-dc-script,
// data-dc-canvas, data-dc-editor-on, data-dc-atomics. None of it is author intent, so none of it
// may veto a reduction.
export const RUNTIME_ATTR = /^data-(dc|sc)-/;

// Measured carrier: `<span class="sc-interp">`, no data-*, no id, style identical to its parent.
export const INTERP_CLASS = 'sc-interp';

// spec/02's role enum, parsed rather than retyped, for the reason resolve.mjs parses the ladders
// out of spec/03: a second copy is a second source of truth and the first spec edit makes it lie.
// This repo escapes backticks inside markdown as \` (docs/lessons.md records it as a checker
// hazard), so a code span here is `Word` OR \`Word\`. Matching only the bare form parsed zero rows
// and, worse, a parser that silently returned a short list would let a role vanish from the enum.
const ROLE_ROW = /^\|\s*(?:\\?`)role(?:\\?`)/;
// Both delimiters carry the escape in this repo (\`Word\`), so the backslash belongs on each side
// of the word, not after it. With it only on the left, the pattern matched zero spans and the enum
// came back empty rather than short, which is the loud failure; a pattern that matched a prefix of
// each span would have been the quiet one.
const CODE_SPAN = /\\?`([A-Za-z][A-Za-z0-9]*)\\?`/g;

export function readRoleEnum(spec02Text) {
  const line = String(spec02Text).split('\n').find((l) => ROLE_ROW.test(l));
  if (!line) throw new Error('capture.mjs: the role row is not in spec/02-ir.md');
  const roles = [...line.matchAll(CODE_SPAN)].map((m) => m[1]).filter((r) => r !== 'role');
  if (roles.length < 10) throw new Error(`capture.mjs: parsed ${roles.length} roles from spec/02, expected the full enum`);
  return roles;
}

const readSpec = (name) => readFileSync(join(HERE, 'spec', name), 'utf8');

// ---------------------------------------------------------------------------
// the page pass
//
// One getComputedStyle plus one getBoundingClientRect per element, both after document.fonts.ready
// (spec/03 Capture step 3): reading earlier measures a different font. Deliberately absent: any
// screenshot and any wall-clock timing.
//
// This function is serialized into the page, so it may close over NOTHING from this module. The
// contract attribute list and the carrier class are re-declared inside it as literals, and
// tests/capture.test.mjs asserts the two copies agree, which is what keeps a literal in a page
// function from silently drifting from the module's own constant.
function pageDump(a) {
  const { frameId, contractList, carrierClass } = a;
  const CONTRACT = new Set(contractList);
  // The declared SIZE and its unit, because the unit is the meaning: `width: 100%` is a responsive
  // fill and `width: 40px` is a size the design authored. Both compute to pixels, and an emitter
  // that cannot tell them apart welds a percentage into a fixed dp (spec/04 trap 5).
  const declaredSizes = (styleAttr) => {
    const kind = (prop) => {
      const m = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)').exec(styleAttr);
      if (!m) return null;
      const v = m[1].trim().toLowerCase();
      if (/\d(%|vw|vh|em|rem|ch)$/.test(v)) return 'relative';
      if (/^\d+(\.\d+)?px$/.test(v)) return 'px';
      return v;
    };
    return { width: kind('width'), height: kind('height'), minWidth: kind('min-width'), minHeight: kind('min-height') };
  };
  const RUNTIME_ATTR = /^data-(dc|sc)-/;
  const frame = document.getElementById(frameId);
  if (!frame) return { error: 'frame-missing' };
  const origin = frame.getBoundingClientRect();
  const nodes = [];
  const walk = (el, path, depth) => {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const contract = {};
    for (const a of el.attributes) if (CONTRACT.has(a.name)) contract[a.name] = a.value;
    nodes.push({
      path, depth,
      tag: el.tagName.toLowerCase(),
      contract,
      runtime: [...el.attributes].filter((a) => RUNTIME_ATTR.test(a.name)).map((a) => a.name),
      carrier: el.classList.contains(carrierClass),
      // Which sizes THIS element declares, as opposed to what layout handed it. Same discipline as
      // color and cursor: a computed width of 152px on a text div is what the flex parent gave it,
      // not a value the design authored, and welding it into Modifier.width is exactly spec/04
      // trap 5's desktop-resize bug.
      authored: declaredSizes(el.getAttribute('style') || ''),
      ownText: [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim(),
      attrNames: [...el.attributes].map((a) => a.name),
      styleAttr: el.getAttribute('style') || '',
      ariaLabel: el.getAttribute('aria-label'),
      title: el.getAttribute('title'),
      // The three accessibility attributes that make a control on/off (spec/02, "A toggle is a
      // different component than a button"). Reading only aria-pressed was the first version, and it
      // is not the whole set: a switch says aria-checked and a disclosure says aria-expanded, so
      // looking at one of them silently calls the other two plain buttons. The live value here is the
      // RESOLVED one ("false"); the name of the boolean driving it survives only in the template text,
      // which is why buildIr pairs the two through data-component.
      ariaState: (() => {
        for (const attr of ['aria-pressed', 'aria-checked', 'aria-expanded']) {
          const value = el.getAttribute(attr);
          if (value !== null) return { attr, value };
        }
        return null;
      })(),
      htmlRole: el.getAttribute('role'),
      tabIndex: el.hasAttribute('tabindex'),
      box: {
        x: Math.round((rect.x - origin.x) * 100) / 100,
        y: Math.round((rect.y - origin.y) * 100) / 100,
        w: Math.round(rect.width * 100) / 100,
        h: Math.round(rect.height * 100) / 100,
      },
      style: {
        display: cs.display, flexDirection: cs.flexDirection, justifyContent: cs.justifyContent,
        alignItems: cs.alignItems, flexWrap: cs.flexWrap, flex: cs.flex,
        // justify-items/align-items are the GRID centering axis (place-items is their shorthand).
        // Without them a one-cell grid that centers its content reads as uncentered, because
        // justifyContent is a flex property and computes differently on a grid.
        justifyItems: cs.justifyItems,
        rowGap: cs.rowGap, columnGap: cs.columnGap, gridArea: cs.gridArea, placeSelf: cs.placeSelf,
        padT: cs.paddingTop, padR: cs.paddingRight, padB: cs.paddingBottom, padL: cs.paddingLeft,
        marT: cs.marginTop, marR: cs.marginRight, marB: cs.marginBottom, marL: cs.marginLeft,
        width: cs.width, height: cs.height, minW: cs.minWidth, minH: cs.minHeight, aspect: cs.aspectRatio,
        bg: cs.backgroundColor, color: cs.color, opacity: cs.opacity, overflow: cs.overflow,
        borderW: cs.borderTopWidth, borderS: cs.borderTopStyle, borderC: cs.borderTopColor,
        radiusTL: cs.borderTopLeftRadius, radiusTR: cs.borderTopRightRadius,
        radiusBR: cs.borderBottomRightRadius, radiusBL: cs.borderBottomLeftRadius,
        // getPropertyValue, not camelCase: webkitLineClamp reads undefined off this page and a
        // naive walk of leaves reads "none". docs/lessons.md.
        clamp: cs.getPropertyValue('-webkit-line-clamp'),
        orient: cs.getPropertyValue('-webkit-box-orient'),
        fontSize: cs.fontSize, lineHeight: cs.lineHeight, fontWeight: cs.fontWeight,
        letterSpacing: cs.letterSpacing, fontFamily: cs.fontFamily,
        boxShadow: cs.boxShadow, cursor: cs.cursor,
        // The FILL axis of a Material Symbols glyph is the design's own filled/outlined choice.
        variation: cs.fontVariationSettings,
      },
    });
    for (let i = 0; i < el.children.length; i += 1) walk(el.children[i], `${path}.${i}`, depth + 1);
  };
  walk(frame, '0', 0);
  return {
    nodes,
    frameBox: { w: Math.round(origin.width), h: Math.round(origin.height) },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    fontsReady: document.fonts.status,
    dpr: window.devicePixelRatio,
    prefersDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
    unresolvedCount: (document.body.innerHTML.match(/\{\{[^}]{1,40}\}\}/g) || []).length,
  };
}

// ---------------------------------------------------------------------------
// small value helpers

const px = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
// `normal` and `auto` are real CSS answers, not missing numbers: a gap of `normal` is not 0.
const pxOr = (v, when) => (/^(normal|auto|none)$/.test(String(v ?? '')) ? when : px(v));
const isTransparent = (v) => {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'transparent' || s === '') return true;
  const m = /^rgba?\(([^()]*)\)$/.exec(s);
  if (!m) return false;
  const parts = m[1].split(/[,/\s]+/).filter(Boolean);
  return parts.length > 3 && parseFloat(parts[3]) === 0;
};
const uniform = (vs) => vs.every((v) => v !== null && v === vs[0]);
// "'FILL' 1" / "FILL 0" / "normal". null when the axis was never declared: the emitter then says
// the style is unknown instead of picking one.
const fillAxis = (variation) => {
  const m = /['"]?FILL['"]?\s+([01](?:\.0+)?)/i.exec(String(variation || ''));
  return m ? Number(m[1]) : null;
};
const roleNamedBy = (styleAttr) => {
  const m = /--md-sys-color-([a-z0-9-]+)/.exec(String(styleAttr || ''));
  return m ? m[1].replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()) : null;
};
// Read the role NAME out of this element's own declaration. Anchored at a declaration start, so
// `--md-sys-color-secondary-container` inside a background value cannot answer a `color:` lookup.
const roleNamedByIn = (styleAttr, prop) => {
  const re = new RegExp('(?:^|;)\\s*' + prop + '\\s*:[^;]*--md-sys-color-([a-z0-9-]+)');
  const m = re.exec(String(styleAttr || ''));
  return m ? m[1].replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()) : null;
};
const declaresOwn = (styleAttr, prop) => new RegExp('(?:^|;)\\s*' + prop + '\\s*:').test(String(styleAttr || ''));

// ---------------------------------------------------------------------------
// reduction, spec/03's table with its data-* row scoped to the CONTRACT set

const hasContract = (d) => Object.keys(d.contract).length > 0;

function visualEffect(d) {
  const s = d.style;
  return !isTransparent(s.bg)
    || (s.borderS !== 'none' && (px(s.borderW) ?? 0) > 0 && !isTransparent(s.borderC))
    || (px(s.radiusTL) ?? 0) > 0
    || [s.padT, s.padR, s.padB, s.padL].some((v) => (px(v) ?? 0) > 0)
    || [s.marT, s.marR, s.marB, s.marL].some((v) => (px(v) ?? 0) !== 0)
    || (pxOr(s.rowGap, 0) ?? 0) > 0
    || (pxOr(s.columnGap, 0) ?? 0) > 0;
}

const isScrollContainer = (d) => /auto|scroll/.test(String(d.style.overflow || ''));
const flexGrow = (d) => {
  const g = parseFloat(String(d.style.flex).split(/\s+/)[0]);
  return Number.isFinite(g) ? g : 0;
};

// spec/03's Never-reduce list is absolute and checked first; then its drop table.
function decide(d, keptChildren) {
  if (d.carrier) return { keep: false, reason: 'text-carrier' };
  if (hasContract(d)) return { keep: true, reason: 'contract-data' };
  if (String(d.style.aspect) !== 'auto' && String(d.style.aspect) !== '') return { keep: true, reason: 'aspect-ratio' };
  if (isScrollContainer(d)) return { keep: true, reason: 'scroll-container' };
  if (flexGrow(d) > 0) return { keep: true, reason: 'flex-grow' };
  if (!visualEffect(d) && keptChildren.length === 1 && /^(block|flex|grid)$/.test(d.style.display)) {
    return { keep: false, reason: 'wrapper-no-effect' };
  }
  return { keep: true, reason: null };
}

// ---------------------------------------------------------------------------
// source-side intent
//
// Read as text from disk, because the live DOM no longer holds it (see header note 3). Nothing here
// interprets a value; it reports what the template declares.

export function readSourceFacts(dir) {
  const templates = readdirSync(dir).filter((f) => f.endsWith('.dc.html')).sort();
  const props = [];
  const hintSize = [];
  const callbacks = [];
  const states = [];
  for (const file of templates) {
    const text = readFileSync(join(dir, file), 'utf8');
    for (const m of text.matchAll(/<script[^>]*data-dc-script[^>]*>/g)) {
      const raw = /data-props=(["'])((?:\\.|(?!\1)[\s\S])*)\1/.exec(m[0])?.[2];
      if (!raw) continue;
      let parsed = null;
      try { parsed = JSON.parse(decodeEntities(raw)); } catch (e) { parsed = null; }
      props.push({ file, ok: !!parsed, props: parsed ?? null, parseError: parsed ? null : 'data-props is not JSON' });
    }
    for (const m of text.matchAll(/<dc-import\b[^>]*>/g)) {
      const size = /hint-size=(["'])([\s\S]*?)\1/.exec(m[0])?.[2];
      if (size) hintSize.push({ file, hintSize: decodeEntities(size) });
    }
    for (const m of text.matchAll(/\bon([A-Z][A-Za-z]*)=(["'])\{\{\s*[\w.]+\s*\}\}\2/g)) {
      callbacks.push({ file, event: m[1].toLowerCase() });
    }
    // The boolean driving a control's on/off state (spec/02 callback.stateProp) exists ONLY here. The
    // runtime turns `aria-pressed="{{ subscribed }}"` into aria-pressed="false", so the live node can
    // answer "is this a toggle" but never "which prop toggles it". data-component is the author's own
    // key for putting the fact back on the right node, and it is in the contract set, so this is a
    // lookup and not a guess. A literal value (no {{ }}) records prop: null: that design has a
    // hardcoded toggle, and naming a parameter for it would invent a prop nobody declared.
    for (const m of text.matchAll(/<(?:div|button|span|input|a|label|li|section)\b([^>]*)>/g)) {
      const attrs = m[1];
      const component = /data-component=(["'])([\w-]+)\1/.exec(attrs)?.[2] ?? null;
      for (const attr of ['aria-pressed', 'aria-checked', 'aria-expanded']) {
        const raw = new RegExp(attr + '=(["\'][^"\']*["\'])').exec(attrs)?.[1];
        if (!raw) continue;
        const value = raw.slice(1, -1).trim();
        const hole = /^\{\{\s*([\w.]+)\s*\}\}$/.exec(value);
        states.push({ file, component, attr, prop: hole ? hole[1] : null, literal: hole ? null : value });
      }
    }
  }
  return {
    templates,
    props,
    hintSize,
    states,
    callbacks: [...new Set(callbacks.map((c) => c.event))].sort(),
    byFile: templates,
  };
}

function decodeEntities(s) {
  return String(s)
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

// ---------------------------------------------------------------------------
// build

/**
 * The spec/02 document for one frame, in memory.
 *
 * @param dump   the page pass for one frame
 * @param opts   { schemes, frameId, screen, source, theme, roleEnum, tokensRef, tokensSha256 }
 * @returns      { ok, ir, diagnostics, refusals } -- ok false carries refusals and no partial IR
 */
export function buildIr(dump, opts = {}) {
  const diagnostics = [];
  const refusals = [];
  if (!dump || dump.error) return { ok: false, ir: null, diagnostics, refusals: [`page pass: ${dump?.error ?? 'no dump'}`] };

  const roleEnum = opts.roleEnum ?? readRoleEnum(readSpec('02-ir.md'));
  const byPath = new Map(dump.nodes.map((n) => [n.path, n]));
  const childPaths = new Map();
  for (const n of dump.nodes) {
    if (n.path === '0') continue;
    const p = n.path.slice(0, n.path.lastIndexOf('.'));
    if (!childPaths.has(p)) childPaths.set(p, []);
    childPaths.get(p).push(n.path);
  }

  // spec/02 "A toggle is a different component than a button": the boolean driving a control's aria
  // state comes from the template text, and it is only a state property if the data-props schema calls
  // it a boolean. THREE facts have to agree before anything is claimed: the live element carries an
  // aria state attribute, the same element's template declares a {{ }} hole on that same attribute, and
  // the schema types that hole as boolean. Where they disagree, the caller keeps stateProp null and
  // says which fact was missing, rather than naming a prop it cannot cite.
  const booleanProps = new Set();
  for (const entry of (opts.sourceFacts?.props || []).filter((p) => p.ok)) {
    for (const [name, def] of Object.entries(entry.props || {})) {
      if (!name.startsWith('$') && def?.tsType === 'boolean') booleanProps.add(name);
    }
  }
  const toggleByComponent = new Map();
  for (const s of opts.sourceFacts?.states || []) {
    if (!s.component) continue;
    if (toggleByComponent.has(s.component)) {
      refusals.push(`component "${s.component}" declares two aria state attributes (${toggleByComponent.get(s.component).attr} and ${s.attr}): one control cannot be driven by two booleans and this tool will not pick`);
      continue;
    }
    toggleByComponent.set(s.component, { attr: s.attr, prop: s.prop, literal: s.literal });
  }

  // Bottom-up, so a wrapper's "single child" test counts surviving children, not raw DOM children.
  const dec = new Map();
  (function decideBottomUp(path) {
    const kids = (childPaths.get(path) || []).map(decideBottomUp).filter((k) => dec.get(k).keep);
    dec.set(path, decide(byPath.get(path), kids));
    return path;
  })('0');

  // Exactly one instance per annotated component, or refuse. This is the failure mode
  // fixtures/annotated exists to avoid: fixtures/reference yields six of everything.
  const counts = new Map();
  for (const n of dump.nodes) {
    const c = n.contract['data-component'];
    if (c) counts.set(c, (counts.get(c) || 0) + 1);
  }
  for (const [c, k] of counts) if (k > 1) refusals.push(`component "${c}" materialized ${k} times; a golden capture needs exactly one instance`);
  if (dec.get('0').keep === false) refusals.push('the frame root reduced away, so the capture would describe nothing');
  if (refusals.length) return { ok: false, ir: null, diagnostics, refusals };

  // A dropped carrier's text belongs to the nearest ancestor that survived.
  const carried = new Map();
  for (const n of dump.nodes) {
    if (dec.get(n.path).keep || !n.ownText) continue;
    const p = nearestKeptAncestor(n.path, dec, byPath);
    if (!p) continue;
    if (!carried.has(p)) carried.set(p, []);
    carried.get(p).push(n.ownText);
  }

  const used = new Map();
  const idOfPath = new Map();
  const makeId = (d) => {
    const c = d.contract;
    const base = c['data-component'] || c['data-prop'] || (c['data-icon'] ? `icon-${c['data-icon']}` : null)
      || (c['data-region'] ? `region-${c['data-region']}` : null)
      || `node-${d.path.replace(/\./g, '-')}`;
    const n = (used.get(base) || 0) + 1;
    used.set(base, n);
    const id = `n:${n === 1 ? base : `${base}#${n}`}`;
    idOfPath.set(d.path, id);
    return id;
  };

  // `emit` recurses bottom-up, so by the time a control is emitted its children are already in here:
  // pickRole can ask whether a control's subtree is icon-shaped instead of guessing from the tag.
  const nodes = {};
  const glyphNames = [];
  // A dropped wrapper's surviving descendants are re-parented THROUGH it, not deleted with it.
  // Measured the failure this prevents: the runtime's data-sc-name host is a no-effect wrapper, so
  // reduction drops it, and recursing over DOM children only emitted a 1-node IR -- the whole card
  // gone, with no refusal and no diagnostic. That is the worst class of defect here: quiet.
  const reducedChildren = (path) => {
    const out = [];
    for (const p of childPaths.get(path) || []) {
      if (!dec.get(p)) continue;
      if (dec.get(p).keep) out.push(p);
      else out.push(...reducedChildren(p));
    }
    return out;
  };
  const emit = (path) => {
    const d = byPath.get(path);
    if (!dec.get(path).keep) return null;
    const id = makeId(d);
    const kids = reducedChildren(path).map(emit).filter(Boolean);
    const own = [d.ownText, ...(carried.get(path) || [])].filter(Boolean).join(' ').trim() || null;
    const node = emitNode(id, d, kids, own, {
      diagnostics, roleEnum, schemes: opts.schemes, nodes, toggleByComponent, booleanProps,
    });
    if (node.icon) glyphNames.push(node.icon.name);
    nodes[id] = node;
    return id;
  };
  const root = emit('0');
  // Insertion order after a bottom-up recursion is children-before-parent, which reads as a
  // scrambled tree (the glyph printed before the card that owns it). Re-order by document position
  // so the IR reads top-down. Determinism does not depend on this: canonicalJson sorts keys.
  const ordered = {};
  for (const n of dump.nodes) {
    const id = idOfPath.get(n.path);
    if (id && nodes[id]) ordered[id] = nodes[id];
  }
  if (Object.keys(ordered).length !== Object.keys(nodes).length) {
    refusals.push('node ordering lost an id that is not on a document path; the tree and the DOM disagree');
  }
  // The orphan bug class, made loud: every node reduction decided to keep must appear in the tree.
  const keptCount = dump.nodes.filter((n) => dec.get(n.path)?.keep).length;
  if (Object.keys(nodes).length !== keptCount) {
    refusals.push(`reduction kept ${keptCount} nodes but the tree holds ${Object.keys(nodes).length}: a dropped wrapper orphaned its descendants`);
  }

  // A glyph name must never land in a text field: measured, the cover glyph is the literal string
  // "terminal", and a naive extractor ships an icon's name to users as copy.
  for (const [id, node] of Object.entries(nodes)) {
    const hit = glyphNames.find((g) => typeof node.text === 'string' && node.text.split(/\s+/).includes(g));
    if (hit) refusals.push(`node ${id} carries the glyph name "${hit}" as text; an icon is role Icon with icon set, not copy`);
  }
  if (refusals.length) return { ok: false, ir: null, diagnostics, refusals };

  const ir = {
    schema: 'design-ir/1',
    screen: opts.screen ?? 'PodcastCard',
    source: opts.source ?? 'Annotated.dc.html',
    widthClass: widthClassOf(opts.frameId),
    viewport: dump.viewport,
    theme: opts.theme ?? 'light',
    tokens: { ref: opts.tokensRef ?? 'tokens.json', sha256: opts.tokensSha256 ?? null },
    frame: { id: opts.frameId ?? null, box: dump.frameBox },
    fonts: { status: dump.fontsReady, dpr: dump.dpr, prefersDarkAtCapture: dump.prefersDark },
    root,
    nodes: ordered,
    diagnostics,
  };
  return { ok: true, ir, diagnostics, refusals: [] };
}

function nearestKeptAncestor(path, dec, byPath) {
  let p = path.slice(0, path.lastIndexOf('.'));
  while (p) {
    if (byPath.has(p) && dec.get(p)?.keep) return p;
    if (p === '0') return null;
    p = p.slice(0, p.lastIndexOf('.'));
  }
  return null;
}

const widthClassOf = (frameId) => /\.([a-z][A-Za-z]*)$/.exec(String(frameId || ''))?.[1] ?? null;

// spec/02's Node, built from THIS element's style only. The text carrier was dropped and its string
// moved here, which is the point of the ancestor rule.
function emitNode(id, d, childIds, ownText, ctx) {
  const { diagnostics, roleEnum, schemes } = ctx;
  const c = d.contract;
  const s = d.style;
  const notes = [];
  const push = (code, severity, message, context) => diagnostics.push({ code, severity, node: id, message, context });

  const hasChildren = childIds.length > 0;
  const icon = c['data-icon'] ?? null;
  const glyphFont = /Material Symbols|symbol/i.test(String(s.fontFamily));
  // childCount is the REDUCED child count, and it must be passed: omitting it leaves the default 0,
  // which makes every flex box a Box with no error and no diagnostic. It is the surviving-child
  // count, so a Row that reduction emptied is a container, not a layout with one member.
  // The live aria state and the template's declaration of it, joined here so both pickRole and the
  // callback below read ONE decision instead of re-deriving it twice.
  const toggle = resolveToggle(d, ctx, { push, notes });

  const role = pickRole(id, d, {
    hasChildren, ownText, icon, glyphFont, roleEnum, notes, push, childCount: childIds.length,
    clickable: d.tag === 'button' || d.htmlRole === 'button' || declaresOwn(d.styleAttr, 'cursor'),
    nodes: ctx.nodes, childIds, toggle,
  });

  const namedBg = roleNamedByIn(d.styleAttr, 'background');
  const namedFg = roleNamedByIn(d.styleAttr, 'color');

  const node = {
    id,
    tag: d.tag,
    component: c['data-component'] ?? null,
    role,
    states: c['data-state'] ? [c['data-state']] : (c['data-variant'] ? [c['data-variant']] : []),
    intent: {
      scroll: c['data-scroll'] ?? null,
      region: c['data-region'] ?? null,
      gridMin: c['data-grid-min'] ? Number(c['data-grid-min']) : null,
    },
    box: d.box,
    layout: layoutOf(d),
    size: sizeOf(d, notes),
    paint: paintOf(d, { schemes, push, id, notes, namedBg, namedFg }),
    // An icon's glyph string is not copy (measured: it renders the literal "terminal").
    text: icon ? null : ownText,
    type: null,
    icon: icon ? { name: icon, source: glyphFont ? 'glyph-font' : 'markup', fill: fillAxis(s.variation) } : null,
    prop: c['data-prop'] ?? null,
    children: childIds,
    notes,
  };

  // The resolved type role is a schema field now (spec/02, Node.type), not a note. It used to ride in
  // notes as a string because the schema had nowhere for it -- see the gap entry in docs/lessons.md --
  // and a value this resolver already settled has no business living in a free-text array where no
  // check can read it. What stays in notes is what the schema genuinely has no place for: the deltas
  // that forced a `closest` match, and the roles that tied with the one chosen.
  const clamp = /^(none|normal)$/.test(String(s.clamp)) ? null : Number(s.clamp);
  if (node.text !== null) {
    const t = roleForType({ fontSize: s.fontSize, lineHeight: s.lineHeight, fontWeight: s.fontWeight, letterSpacing: s.letterSpacing });
    node.type = {
      role: t.role,
      source: t.source,
      lineClamp: clamp,
      overflow: /hidden|clip/.test(String(s.overflow)) ? 'ellipsis' : null,
    };
    if (Object.keys(t.deltas || {}).length) notes.push(`type-copy:${JSON.stringify(t.deltas)}`);
    if (t.candidates && t.candidates.length > 1) notes.push(`type-candidates:${t.candidates.join('|')}`);
    if (t.diagnostic) push(t.diagnostic.code, t.diagnostic.severity, t.diagnostic.message, `text on ${d.tag}`);
    if (clamp && String(s.orient) !== 'vertical') push('clamp-without-orient', 'warn', `line-clamp ${clamp} without -webkit-box-orient: vertical`, `text on ${d.tag}`);
  } else if (clamp) {
    push('clamp-on-non-text', 'warn', `line-clamp ${clamp} on a node carrying no text`, d.tag);
  }

  // `cursor` INHERITS in CSS exactly like `color` does. Measured: the card declares
  // `cursor: pointer` and every descendant computes it too, so reading the computed value called
  // the author text and both glyphs "controls" and asked for a callback on each. Only a
  // declaration on THIS element is a control; spec/02 warns on a look-tappable element rather
  // than inventing one.
  const clickable = d.tag === 'button' || d.htmlRole === 'button' || declaresOwn(d.styleAttr, 'cursor');
  const control = clickable;
  if (control) {
    const named = c['data-action'] || d.ariaLabel || d.title;
    if (named) {
      node.callback = {
        name: named,
        evidence: c['data-action'] ? 'data-action' : (d.ariaLabel ? 'aria-label' : 'title'),
        state: toggle.state,
        stateProp: toggle.stateProp,
        focusable: d.tag === 'button' || d.tabIndex,
      };
    } else {
      push('callback-inferred', 'warn', 'a control carries no data-action, aria-label or title to name the callback from', `${d.tag} ${id}`);
    }
  }
  if (glyphFont && !icon) push('icon-unnamed', 'warn', 'a glyph-font run carries no data-icon, so no name can be looked up in the target icon set', d.tag);
  if (d.runtime.length) notes.push(`runtime-carries:${d.runtime.join('+')}`);
  return node;
}

// spec/02 "A toggle is a different component than a button", implemented as three facts from three
// sources that all have to agree. `state` is the live element's aria attribute; `stateProp` is the
// template's {{ }} hole on that SAME attribute of the SAME data-component; and it only counts if the
// data-props schema types that hole as boolean. Ask the DOM which prop toggles this and it answers
// "false" -- the name exists only in the source text. Where the facts disagree, stateProp stays null
// and the note says which fact was missing, because naming a prop the design never declared is the
// invention spec/02 forbids.
function resolveToggle(d, ctx, { push, notes }) {
  const live = d.ariaState;
  if (!live) return { state: null, stateProp: null };
  const component = d.contract['data-component'] ?? null;
  const base = { state: live.attr, stateProp: null };
  if (!component) {
    notes.push(`toggle-state-unpaired:${live.attr} carries no data-component, so the template's boolean cannot be named for it`);
    return base;
  }
  const declared = ctx.toggleByComponent?.get(component);
  if (!declared) {
    notes.push(`toggle-state-unpaired:${live.attr} has no {{ }} hole on the same attribute in ${component}'s template`);
    return base;
  }
  if (declared.attr !== live.attr) {
    push('toggle-attr-mismatch', 'warn', `the live element carries ${live.attr} but ${component}'s template declares ${declared.attr}; this tool will not pair two different attributes`, `${d.tag} ${d.path}`);
    return base;
  }
  if (!declared.prop) {
    notes.push(`toggle-literal:${live.attr} is the literal "${declared.literal}" in the template, not a prop, so this design has a hardcoded toggle`);
    return base;
  }
  if (!ctx.booleanProps?.has(declared.prop)) {
    notes.push(`toggle-not-boolean:${declared.prop} is not declared tsType boolean in data-props, so it is not a state property`);
    return base;
  }
  return { state: live.attr, stateProp: declared.prop };
}

// Every role below a node, flattened. Used only for the yes/no question "is this control's content an
// icon", which is what makes IconToggleButton nameable; a toggle carrying text is a different widget
// and this does not pretend to know which one.
function subtreeRoles(nodes, ids, acc = []) {
  for (const id of ids || []) {
    const n = nodes?.[id];
    if (!n) continue;
    acc.push(n.role);
    subtreeRoles(nodes, n.children, acc);
  }
  return acc;
}

// spec/02's enum was missing Column/Button/IconButton/IconToggleButton, which forced every one of them
// into Box plus a note. That gap is closed, so this now names them for real. Where a role is still
// outside the enum (Badge, List, Grid), emit the closest allowed one and keep the intent.
function pickRole(id, d, ctx) {
  const { hasChildren, ownText, icon, glyphFont, roleEnum, notes, push, clickable, childCount = 0, toggle } = ctx;
  const c = d.contract;
  const s = d.style;
  // Surviving children, passed in ctx by the caller. Read from the wrong place it is silently 0,
  // which turns every flex box into a Box without an error or a diagnostic: the count is of the
  // REDUCED tree, so a Row that reduction emptied is a container, not a layout with one member.
  const conflict = (intended) => {
    push('role-enum-conflict', 'warn', `spec/04 maps this to ${intended} but spec/02's enum does not list it; emitted the closest allowed role and kept the intent in notes`, `${d.tag} ${id}`);
    notes.push(`role-intended:${intended}`);
  };
  if (icon || (glyphFont && !hasChildren)) return 'Icon';
  if (!hasChildren && ownText) return 'Text';
  // A declared M3 surface outranks being clickable. Measured failure of the other order: the card
  // root carries role="button" AND data-elevation/data-token, and button-first classified it
  // IconButton -- losing Card, which is where spec/04 puts containerColor, shape and tonalElevation.
  // A clickable card is a Card with an onClick plus the callback this capture already records.
  if (c['data-elevation'] || c['data-token']) {
    if (clickable) notes.push('control:clickable');
    return roleEnum.includes('Card') ? 'Card' : 'Box';
  }
  if (d.tag === 'button' || d.htmlRole === 'button') {
    // The widget follows the state the design drew, and only an icon-shaped control can honestly be
    // named IconToggleButton: a toggle whose content is text is ToggleButton or Switch, and deciding
    // which from CSS is a guess this tool does not make. The boolean stays a parameter either way, so
    // no state is lost, only the widget name -- and that gap is said out loud.
    if (toggle?.state && toggle.stateProp) {
      const roles = subtreeRoles(ctx.nodes, ctx.childIds);
      if (roles.includes('Icon') && !roles.includes('Text')) {
        if (roleEnum.includes('IconToggleButton')) return 'IconToggleButton';
        conflict('IconToggleButton');
      } else {
        push('toggle-widget-unresolved', 'warn', `this control is a toggle driven by "${toggle.stateProp}" but its content is not icon-shaped, so no toggle widget is named; the boolean is still a parameter`, `${d.tag} ${id}`);
      }
    }
    const intended = hasChildren ? 'IconButton' : 'Button';
    if (!roleEnum.includes(intended)) { conflict(intended); notes.push('control:clickable'); return 'Box'; }
    return intended;
  }
  // spec/04 maps flex to Row/Column to lay out CHILDREN. A one-child flex box is a container with
  // a shape, not a layout: emitting Row {} around one node asks the reader why.
  if (/^flex/.test(s.display) && childCount > 1) {
    const intended = s.flexDirection === 'column' ? 'Column' : 'Row';
    if (!roleEnum.includes(intended)) { conflict(intended); return 'Box'; }
    return intended;
  }
  return roleEnum.includes('Box') ? 'Box' : 'Spacer';
}

function layoutOf(d) {
  const s = d.style;
  const flexy = /^flex/.test(s.display);
  const gridy = /^grid/.test(s.display);
  const r = pxOr(s.rowGap, null);
  const col = pxOr(s.columnGap, null);
  const out = {
    display: s.display,
    direction: flexy ? s.flexDirection : null,
    // On a grid the child alignment is justify-items/align-items, not justify-content.
    justify: flexy ? s.justifyContent : (gridy ? s.justifyItems : null),
    align: flexy || gridy ? s.alignItems : null,
    gap: r === col ? r : { row: r, column: col },
    padding: { top: px(s.padT), right: px(s.padR), bottom: px(s.padB), left: px(s.padL) },
    margin: { top: px(s.marT), right: px(s.marR), bottom: px(s.marB), left: px(s.marL) },
    wrap: /^wrap/.test(String(s.flexWrap)),
  };
  if (String(s.gridArea) !== 'auto') out.gridArea = s.gridArea;
  if (s.placeSelf && !/^(auto auto|auto)$/.test(s.placeSelf)) out.placeSelf = s.placeSelf;
  const g = flexGrow(d);
  if (g > 0) out.flexGrow = g;
  return out;
}

function sizeOf(d, notes) {
  const s = d.style;
  const out = { width: px(s.width), height: px(s.height), minW: pxOr(s.minW, null), minH: pxOr(s.minH, null), aspect: null };
  // Carried through so an emitter can tell an authored box from a laid-out one, and a percentage
  // fill from a fixed size.
  out.authored = Object.assign({ width: null, height: null, minWidth: null, minHeight: null }, d.authored || {});
  const a = String(s.aspect || '');
  if (a && a !== 'auto') {
    const [w, h] = a.split(/\s*\/\s*/).map(Number);
    if (Number.isFinite(w) && Number.isFinite(h) && h) out.aspect = Math.round((w / h) * 1000) / 1000;
    else if (Number.isFinite(w)) out.aspect = w;
  }
  // spec/04 trap 7: a ratio and an authored height conflict; the ratio wins and the conflict is said.
  if (out.aspect && px(s.height) !== null) notes.push(`aspect-and-height:${px(s.height)} (spec/04 trap 7: keep the ratio, drop the height)`);
  return out;
}

function paintOf(d, ctx) {
  const { schemes, push, id, notes, namedBg, namedFg } = ctx;
  const s = d.style;
  const out = { background: null, foreground: null, elevation: null, radius: null, border: null, opacity: 1.0, overflow: s.overflow };
  const tokenRole = /^colorScheme\.([A-Za-z0-9]+)$/.exec(String(d.contract['data-token'] || ''))?.[1] ?? null;

  // spec/03 Capture step 4: the custom-property map is the authority, a computed hex is only
  // evidence. Returns spec/02's three fields and nothing else -- the facts with no field in
  // spec/02's paint shape (a conversion, how an ambiguity was settled) go to the node's notes, which
  // spec/02 already sanctions, instead of quietly extending a schema nobody amended.
  const channel = (cssColor, named, token, where) => {
    const r = roleForColor(cssColor, schemes);
    const extra = [];
    if (r.convertedFrom) extra.push(`color-converted:${r.convertedFrom}->${r.hex}`);
    const conflict = !!(token && named && token !== named);
    const declared = conflict ? null : (token ?? named);
    const by = conflict ? null : (token ? 'data-token' : (named ? 'custom-property' : null));
    const res = { hex: r.hex, role: r.role, source: r.source };
    if (conflict) {
      push('color-token-mismatch', 'error', `data-token names ${token} but this element's own declaration is var(--md-sys-color-${named}); the two disagree and this tool does not pick a winner`, `${where} on ${d.tag} ${id}`);
    }
    if (!declared) {
      // No authority: report the resolver's own verdict, unresolved or ambiguous, unchanged.
      if (r.diagnostic) push(r.diagnostic.code, r.diagnostic.severity, r.diagnostic.message, `${where} on ${d.tag} ${id}`);
      return { res, extra };
    }
    res.source = by === 'data-token' ? 'data-token' : 'computed';
    if (r.role === null) {
      res.role = declared;
      extra.push(`color-named-by:${by}=${declared} (the computed hex matched no role)`);
      if (r.diagnostic) push(r.diagnostic.code, 'info', `${r.diagnostic.message}; the ${by} names it ${declared}`, `${where} on ${d.tag} ${id}`);
    } else if (r.role !== declared) {
      // The hex is ambiguous across roles; the declared name decides, and the collision is said.
      extra.push(`color-settled-by:${by}=${declared} (hex lookup said ${r.role})`);
      if (r.diagnostic) push(r.diagnostic.code, 'info', `${r.diagnostic.message}; settled ${declared} by the ${by}`, `${where} on ${d.tag} ${id}`);
      res.role = declared;
    } else {
      if (r.diagnostic) push(r.diagnostic.code, 'info', `${r.diagnostic.message}; the ${by} names the same role`, `${where} on ${d.tag} ${id}`);
    }
    return { res, extra };
  };

  if (!isTransparent(s.bg)) {
    const { res, extra } = channel(s.bg, namedBg, tokenRole, 'background');
    out.background = res;
    notes.push(...extra);
  }
  // `color` INHERITS in CSS, so a computed foreground is not evidence this node painted one.
  // Measured: the frame wrapper declares only `width: 180px` yet computes rgb(29,27,32), which is
  // the board chrome's ink. Emitting that as this node's paint ships a value the design never put
  // there. spec/04 sends an inherited text color to LocalContentColor, so the fact stays in notes.
  if (!isTransparent(s.color)) {
    if (declaresOwn(d.styleAttr, 'color')) {
      const { res, extra } = channel(s.color, namedFg, null, 'foreground');
      out.foreground = res;
      notes.push(...extra);
    } else {
      // The value is inherited, so it is not this node's paint. It is still the color the design
      // intends the node to draw with, resolved to a role here so an emitter can pass it explicitly
      // where the target has no automatic equivalent. spec/04: rely on LocalContentColor inside a
      // container that already sets it -- which a CSS ancestor does and a Compose background() does
      // NOT, so the resolution has to survive to the emitter rather than be dropped.
      const r = roleForColor(s.color, schemes);
      notes.push(r.role
        ? `foreground-inherited:${r.role} (${r.hex}; declared by an ancestor)`
        : `foreground-inherited:unresolved (${s.color})`);
    }
  }

  // Elevation from data-elevation only, never from a painted shadow (spec/03, spec/04 trap 4).
  if (d.contract['data-elevation']) {
    const e = elevationForLevel(d.contract['data-elevation']);
    out.elevation = e.dp ?? null;
    if (e.diagnostic) push(e.diagnostic.code, e.diagnostic.severity, e.diagnostic.message, `data-elevation on ${d.tag}`);
  } else if (s.boxShadow && s.boxShadow !== 'none') {
    push('elevation-missing', 'warn', 'a painted shadow with no data-elevation: shadow is never read as elevation (spec/01)', `${d.tag} ${id}`);
  }

  const radii = [px(s.radiusTL), px(s.radiusTR), px(s.radiusBR), px(s.radiusBL)];
  if (radii.every((v) => (v ?? 0) === 0)) out.radius = null;
  else if (uniform(radii)) {
    const sh = shapeForRadius(s.radiusTL);
    out.radius = { px: sh.px, shape: sh.shape, corners: null };
    if (sh.diagnostic) push(sh.diagnostic.code, sh.diagnostic.severity, sh.diagnostic.message, `border-radius on ${d.tag}`);
  } else {
    out.radius = { px: null, shape: null, corners: radii };
    notes.push('radius-per-corner');
  }

  // A transparent border is not a border. Measured: the card paints `border: 2px solid
  // rgba(0,0,0,0)` in its unselected state, which is not a design decision anyone should have to
  // read back as one.
  const bw = px(s.borderW) ?? 0;
  if (s.borderS !== 'none' && bw > 0 && !isTransparent(s.borderC)) {
    const r = roleForColor(s.borderC, schemes);
    out.border = { width: bw, style: s.borderS, color: { hex: r.hex, role: r.role, source: r.source } };
    if (r.diagnostic) push(r.diagnostic.code, r.diagnostic.severity, r.diagnostic.message, `border on ${d.tag}`);
  }

  const op = parseFloat(String(s.opacity));
  out.opacity = Number.isFinite(op) ? op : 1.0;
  if (Number.isFinite(op) && op < 1) notes.push('alpha-on-container (spec/04: M3 uses state layers, not alpha)');
  return out;
}

// ---------------------------------------------------------------------------
// the frame pass

/**
 * Capture one frame: transport, health gates, page pass, role map, build. Refuses instead of
 * emitting a partial tree. Reuses tools/browser.mjs for the browser and the offline router, so the
 * offline guarantee is not re-implemented here (that is what WU1 extracted it for).
 */
export async function captureFrame({
  dir = join(HERE, 'fixtures', 'annotated'),
  frame = 'PodcastCard.compact',
  theme = 'light',
  board = 'Annotated.dc.html',
  root = HERE,
  settleTimeoutMs = 20000,
  viewport = { width: 1600, height: 2000 },
  // Test seam only: run the build against a doctored role enum. spec/02's real enum now covers every
  // role pickRole can propose, so the role-enum-conflict path has nothing left to fire on in this
  // fixture -- which is exactly how a guard that proves "never invent a role" goes untested without
  // anyone noticing. Null keeps the production path untouched (buildIr reads spec/02 itself).
  roleEnum = null,
} = {}) {
  const refuse = (refusals, extra = {}) => ({ ok: false, ir: null, diagnostics: [], refusals, ...extra });
  if (!existsSync(dir)) return refuse([`no input directory: ${dir}`]);
  const tokenFile = join(dir, 'tokens.css');
  if (!existsSync(tokenFile)) return refuse([`no tokens.css in ${dir}: the custom-property map is the authority for color (spec/03 Capture step 4)`]);

  const { serveExport } = await import('./serve.mjs');
  const browserMod = await import('./browser.mjs');
  const chrome = browserMod.findChromium();
  if (!chrome) return refuse(['no chromium executable found; set CHROME=/path/to/binary']);

  const srv = await serveExport(dir);
  let mat = null;
  try {
    mat = await browserMod.createMaterializer({ boardUrl: srv.url('/' + board), root, executablePath: chrome.path, viewport });
    const ctx = await mat.browser.newContext({ viewport });
    // The offline guarantee, reused, not copied. The gate has to hold on the page whose styles are
    // actually read, which is why this capture opens its own context instead of borrowing
    // materialize()'s closed one.
    const blocked = await browserMod.installOfflineRouter(ctx, { router: mat.router });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160)); });
    const url = srv.url('/' + board) + '?frame=' + encodeURIComponent(frame) + (theme === 'dark' ? '&theme=dark' : '');
    await page.goto(url, { waitUntil: 'load' });
    const settled = await page.waitForFunction((id) => {
      const el = document.getElementById(id);
      if (!el) return false;
      const b = el.getBoundingClientRect();
      if (b.width <= 0 || b.height <= 0 || el.childElementCount <= 0) return false;
      return !/\{\{[^}]{1,40}\}\}/.test(document.body.innerHTML);
    }, frame, { timeout: settleTimeoutMs }).then(() => true).catch(() => false);
    // Wait for the faces to settle BEFORE reading a single computed style. document.fonts.ready is not
    // enough on this fixture: the icon face starts loading after it resolves, so a first draft read
    // text metrics off a fallback font, and a second draft refused a perfectly good capture about a
    // fifth of the time because a reading moved between two awaits. Refusing is not a fix -- the
    // determinism invariant needs the measurement to happen in a settled state, so the wait is here
    // and the check stays as the proof it worked.
    const fontsSettled = await page.waitForFunction(() => document.fonts.status === 'loaded', null, {
      timeout: settleTimeoutMs,
    }).then(() => true).catch(() => false);
    let dump = await page.evaluate(pageDump, { frameId: frame, contractList: CONTRACT_ATTRS, carrierClass: INTERP_CLASS });
    // One bounded retry. pageDump samples document.fonts.status in the same synchronous pass as every
    // computed style, so dump.fontsReady is the state the numbers were actually taken in; if a face
    // started loading during that pass, the pass is discarded and taken again from a settled state
    // rather than emitted and argued about.
    let fontsRetried = false;
    if (dump && !dump.error && dump.fontsReady !== 'loaded' && fontsSettled) {
      fontsRetried = true;
      await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: settleTimeoutMs }).catch(() => false);
      dump = await page.evaluate(pageDump, { frameId: frame, contractList: CONTRACT_ATTRS, carrierClass: INTERP_CLASS });
    }
    const unresolved = dump && !dump.error ? dump.unresolvedCount : 0;
    await ctx.close();

    // Health gates BEFORE any style is trusted (spec/03 Capture step 1). Reading a computed style
    // off an unhealthy render is how a wrong number gets emitted with confidence.
    const refusals = [];
    if (!settled) refusals.push(`frame "${frame}" did not settle: no box, no children, or an unresolved {{ }} left`);
    if (dump?.error) refusals.push(`page pass failed: ${dump.error}`);
    if (blocked.length) refusals.push(`${blocked.length} blocked request(s): ${blocked.join(', ')} -- not pinned in .vendor/vendor-lock.json`);
    if (unresolved > 0) refusals.push(`${unresolved} unresolved {{ }} placeholder(s): the read would describe a template, not a design`);
    if (errors.length) refusals.push(`${errors.length} page error(s): ${errors.slice(0, 3).join(' | ')}`);
    if (!fontsSettled) refusals.push(`document.fonts never reached "loaded" within ${settleTimeoutMs}ms: measured text would carry fallback-font metrics, which is a different design`);
    // pageDump reports the font status sampled in the same synchronous pass as every computed style, so
    // this is the state the numbers were taken in, not a later reading. The earlier gate compared this
    // with a second reading taken after the dump, and refused a good capture about a fifth of the time:
    // a late face moved one reading while the styles themselves had been measured perfectly. It is a
    // real gate now: reaching it means the retry also found faces loading, so the measurement cannot be
    // trusted, and a refusal here is correct rather than a flake.
    if (dump && !dump.error && dump.fontsReady !== 'loaded') {
      refusals.push(`fonts were still not settled when the styles were read${fontsRetried ? ' again after one retry' : ''}: document.fonts.status = "${dump.fontsReady}" -- measured text could come from a fallback font`);
    }
    if (refusals.length) return refuse(refusals, { fontsAtDump: dump && !dump.error ? dump.fontsReady : null, fontsSettled, fontsRetried });

    const schemes = readRoleMap(readFileSync(tokenFile, 'utf8'));
    // Read BEFORE the build, not attached after it: callback.stateProp is a source-side fact, and a
    // buildIr that received its source facts after returning could not have used them. The earlier
    // version attached this after the call, which silently made opts.sourceFacts undefined inside.
    const sourceFacts = readSourceFacts(dir);
    const out = buildIr(dump, {
      schemes,
      sourceFacts,
      roleEnum,
      frameId: frame,
      theme,
      screen: frame.split('.')[0],
      source: board,
      tokensRef: 'tokens.json',
      tokensSha256: sha256File(join(dir, 'tokens.json')),
    });
    out.sourceFacts = sourceFacts;
    return out;
  } finally {
    if (mat) await mat.close();
    await srv.close();
  }
}

function sha256File(p) {
  return existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : null;
}

// Key-sorted JSON, so "deterministic" is a string comparison and not a hope.
export function canonicalJson(value) {
  const sortDeep = (v) => {
    if (Array.isArray(v)) return v.map(sortDeep);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])]));
    return v;
  };
  return JSON.stringify(sortDeep(value), null, 2);
}

// ---------------------------------------------------------------------------
// CLI

async function main(argv) {
  const args = argv.slice(2);
  const get = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : null);
  const out = await captureFrame({
    dir: get('--dir') ?? join(HERE, 'fixtures', 'annotated'),
    frame: get('--frame') ?? 'PodcastCard.compact',
    theme: get('--theme') ?? 'light',
    board: get('--board') ?? 'Annotated.dc.html',
  });
  if (!out.ok) {
    process.stderr.write('capture refused (exit 3):\n  ' + out.refusals.join('\n  ') + '\n');
    return 3;
  }
  if (args.includes('--json')) {
    process.stdout.write(canonicalJson(out.ir) + '\n');
  } else {
    process.stdout.write(`frame ${out.ir.frame.id}: ${Object.keys(out.ir.nodes).length} nodes, root ${out.ir.root}\n`);
    for (const [id, n] of Object.entries(out.ir.nodes)) {
      const bits = [
        `${n.role}`,
        n.component && `component=${n.component}`,
        n.prop && `prop=${n.prop}`,
        n.icon && `icon=${n.icon.name}`,
        n.text !== null && JSON.stringify(n.text),
        n.paint.background && `bg=${n.paint.background.role ?? 'UNRESOLVED'}`,
      ].filter(Boolean).join('  ');
      process.stdout.write(`  ${id.padEnd(34)} ${bits}\n`);
    }
    for (const dg of out.diagnostics) process.stdout.write(`  [${dg.severity}] ${dg.code} ${dg.node}: ${dg.message}\n`);
  }
  return out.diagnostics.some((dg) => dg.severity === 'error') ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv).then((code) => { process.exitCode = code; });
}

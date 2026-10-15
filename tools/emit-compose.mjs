#!/usr/bin/env node
// T5/WU5 -- the spec/02 Node tree to Compose Multiplatform source, for the spike.
//
// The oracle is `./app/gradlew -p app :shared:compileKotlinJvm` in the workshop repo. Nothing here
// decides whether the spike worked; the compiler does.
//
// What this file owns: the IR from tools/capture.mjs and Kotlin TEXT. It owns no value. Every color
// comes from tokens.json by role, every type and shape role from the IR the capture resolved against
// spec/03, every size from the box facts. A value that is not already resolved is a refusal (exit 3),
// never a literal a reader would have to trust -- the same invariant the capture enforces, one stage
// later.
//
// Package: a NEW package, `<base>.ui.generated`. The workshop already has hand-written
// ui/theme/Color.kt, ui/theme/Theme.kt and ui/components/PodcastCard.kt, and a second top-level
// declaration of the same name in one package is a redeclaration error. So the generated files are
// additive by construction: they live beside the hand-written ones, never overwrite one, and a file
// this tool did not write is never clobbered (checked, not assumed).
//
// spec/04 traps honored, each where it is written:
//   1 corner clipping      -- a rounded container carries its shape into background(color, shape);
//                             clip is emitted only when the IR's overflow says the design clipped too.
//   3 modifier order       -- ONE canonical order for every node, built by one function.
//   4 elevation is tonal   -- cardElevation(tonalElevation = n) from data-elevation, never a shadow.
//   5 fixed sizes          -- no fixed height on a text node, ever; min-height is dropped and
//                             maxLines carries it, which is what the design used it for.
//   6 weight scope         -- asserted: a weighted node must sit directly in a Row, or this refuses.
//   7 aspectRatio + height -- the ratio is emitted and the height dropped, with the conflict named.
//   8 icons by name        -- PascalCase against the target's own icon set, FILL deciding Filled vs
//                             Outlined. Never a fabricated glyph. The name is a compile-checked
//                             claim, and the spike's oracle is what checks it.
//   9 two ColorScheme      -- lightColorScheme + darkColorScheme, chosen on a darkTheme: Boolean. No
//                             dynamic color: it needs an Android Context and this is commonMain.
//  10 previews             -- one @Preview per composable with the design's own sample values.
//
// Emission rules from spec/04: modifier last and defaulted, required parameters in DOM order of
// their data-prop, callbacks after data, no remember / mutableStateOf / ViewModel / LaunchedEffect,
// samples in a private FakeData object, `// TODO(state)` where the design implies state, and every
// file ends with the diagnostics it was written under.
//
// An inherited value emits NOTHING rather than a literal. `color` and `cursor` inherit in CSS, and
// Compose has the same mechanism (LocalContentColor, which a component sets by itself), so the
// faithful translation of "this node did not declare a color" is "do not pass a color". Recording
// the inherited rgb as an explicit tint would ship a value the design never put there.
//
//   node tools/emit-compose.mjs [--dir fixtures/annotated] [--frame PodcastCard.compact]
//                               [--out out/generated/compose] [--base com.callstack.minijetcaster]
//   node tools/emit-compose.mjs --write <kotlin-src-root> [--clean]
// Exit 0 emitted, 1 an error diagnostic reached a file, 3 refused.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { captureFrame } from './capture.mjs';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = 'Generated from frame';
const GENERATOR = 'tools/emit-compose.mjs';

// spec/02's enum roles this emitter can write. Anything else is a refusal, not a Box-shaped fallback:
// an unmapped role quietly emitted as a Box is how a converter ships a plausible wrong layout.
//
// `Button` is deliberately absent, and it is not an oversight: spec/04 chooses among Button,
// FilledTonalButton, OutlinedButton and TextButton by which color-role pair the computed background
// and foreground carry, and none of that is exercised by this fixture. Writing one branch today on
// the strength of a table row nobody has compiled is the exact mistake `Shapes(full = ...)` was. It
// refuses, and the refusal names the row that still has to be done, which is T8's work.
export const KNOWN_ROLES = ['Card', 'Column', 'Row', 'Box', 'Text', 'Icon', 'IconButton', 'IconToggleButton'];

// spec/04 trap 3, canonical order. One array, one loop, so two nodes of one design cannot disagree.
// `margin` sits before background because a CSS margin is OUTSIDE the painted box: the Compose
// translation of `margin + background` is padding-then-background, not background-then-padding.
// `fill` sits before `aspect` because aspectRatio resolves against the width it is handed: the
// hand-written CategoryCover writes `fillMaxWidth().aspectRatio(1f)` and the reverse order yields a
// different box.
// `selectable` shares clickable's terminal slot family: it IS this node's click path (spec/04's Card
// row), and a node that gets one never also gets the other, or the callback fires twice.
export const MODIFIER_ORDER = ['size', 'weight', 'fill', 'aspect', 'margin', 'background', 'border', 'clip', 'padding', 'align', 'clickable', 'selectable'];

// spec/04 trap 8: snake_case becomes PascalCase. `bookmark_add` -> BookmarkAdd.
export function kotlinIconName(snake) {
  const cleaned = String(snake).replace(/[^a-z0-9_]/gi, '');
  const pascal = cleaned.split('_').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  return /^[A-Z][A-Za-z0-9]*$/.test(pascal) ? pascal : null;
}

// spec/01: identifiers come from ASCII kebab-case. podcast-card -> PodcastCard.
export function kotlinTypeName(kebab) {
  const parts = String(kebab).split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!parts.length) return null;
  const name = parts.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  return /^[A-Z][A-Za-z0-9]*$/.test(name) ? name : null;
}

const camel = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const pascal = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const hexToKotlin = (hex) => `Color(0xFF${String(hex).replace('#', '').toUpperCase()})`;
const dp = (n) => `${n}.dp`;
const floatLit = (n) => `${Number(n).toFixed(3).replace(/\.?0+$/, '')}f`;
const kebabOf = (s) => String(s || '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
const decode = (s) => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// ---------------------------------------------------------------------------
// the one decision the emitter may not make: which callbacks exist, and their names
//
// The live DOM consumed `onClick="{{ toggle }}"`, so the IR knows a control exists but not which
// prop it calls. The template text answers it, read as text and interpreted by nothing: the click
// holes in document order, and renderVals' own `hole: ... p.onX()` lines. Pairing is then CHECKED
// against the schema's own order of the () => void props. A disagreement refuses, because a wrong
// callback name survives into an API (spec/02).

export function readCallbackNames(dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.dc.html')).sort();
  const voidProps = [];
  const boolProps = [];
  const holesInOrder = [];
  const holeToProp = new Map();
  for (const file of files) {
    const text = readFileSync(join(dir, file), 'utf8');
    for (const m of text.matchAll(/<script[^>]*data-dc-script[^>]*data-props=(["'])((?:\\.|(?!\1)[\s\S])*)\1/g)) {
      let schema = null;
      try { schema = JSON.parse(decode(m[2])); } catch { schema = null; }
      if (!schema) continue;
      for (const [name, def] of Object.entries(schema)) {
        const ts = def && typeof def.tsType === 'string' ? def.tsType.trim() : '';
        if (/^\(\)\s*=>\s*void$/.test(ts) && !name.startsWith('$')) voidProps.push(name);
        // A toggle's boolean needs its OWN default, and the only honest source for it is the schema:
        // `subscribed` defaults to false there, so the preview renders what the design rendered. A
        // default picked here would be a value this tool resolved, which invariant 2 forbids.
        if (ts === 'boolean' && !name.startsWith('$')) boolProps.push({ name, default: def.default ?? false });
      }
    }
    for (const m of text.matchAll(/\bonclick=(["'])\{\{\s*([\w.]+)\s*\}\}\1/gi)) holesInOrder.push(m[2]);
    for (const m of text.matchAll(/^\s*(\w+)\s*:[^\n]*?p\.(on[A-Z]\w*)\s*[(&.]/gm)) {
      if (!holeToProp.has(m[1])) holeToProp.set(m[1], m[2]);
    }
  }
  const byHole = holesInOrder.map((h) => ({ hole: h, prop: holeToProp.get(h) ?? null }));
  return { voidProps, boolProps, holesInOrder, byHole };
}

// ---------------------------------------------------------------------------
// shape and padding, spec/04's box model

const shapeExpr = (radius) => {
  if (!radius) return null;
  if (radius.shape === 'circle') return 'CircleShape';
  if (radius.shape) return `MaterialTheme.shapes.${radius.shape}`;
  if (radius.corners) return `RoundedCornerShape(${radius.corners.map((c) => `${c ?? 0}.dp`).join(', ')})`;
  return null;
};

/**
 * ONE overload per call. Compose's padding() has separate (horizontal, vertical) and
 * (start, top, end, bottom) signatures, so `padding(vertical = 8.dp, end = 4.dp)` is an
 * unresolved-overload error, not a style choice. Measured against this project's own hand-written
 * sources, which use `padding(horizontal = 16.dp, vertical = 8.dp)` and
 * `padding(start = 24.dp, end = 24.dp, bottom = 16.dp)` and never mix the two vocabularies.
 * The four-sided form is the fallback whenever either axis is asymmetric, and it takes any subset
 * because every parameter defaults to 0.dp.
 */
function paddingArgs(p) {
  const { top = 0, right = 0, bottom = 0, left = 0 } = p || {};
  const hSym = left === right;
  const vSym = top === bottom;
  if (hSym && vSym) {
    const out = [];
    if (left) out.push(`horizontal = ${dp(left)}`);
    if (top) out.push(`vertical = ${dp(top)}`);
    return out.join(', ');
  }
  const out = [];
  if (left) out.push(`start = ${dp(left)}`);
  if (top) out.push(`top = ${dp(top)}`);
  if (right) out.push(`end = ${dp(right)}`);
  if (bottom) out.push(`bottom = ${dp(bottom)}`);
  return out.join(', ');
}

// A grid's place-items is the default position of everything in its cells. Measured on the cover:
// align-items and justify-items both compute to center, so a child that declares no placeSelf is
// centered, and that is where the glyph belongs.
function centerFrom(parent) {
  const a = String(parent.layout?.align || '');
  const j = String(parent.layout?.justify || '');
  return /center/.test(a) && /center/.test(j) ? 'Center' : null;
}

// CSS align-items defaults to normal, which behaves as stretch. A column whose align-items was
// centered or edge-aligned does NOT stretch its children, so this is read, not assumed.
const stretchCrossAxis = (n) => {
  const a = String(n.layout?.align || '');
  return a === '' || a === 'normal' || a === 'stretch';
};

// spec/04's Box table: a placeSelf of end/start in a one-cell grid is the badge's BottomStart.
function boxAlign(placeSelf) {
  const s = String(placeSelf || '');
  if (!s || /^auto/.test(s)) return null;
  const map = {
    'end start': 'BottomStart', 'start start': 'TopStart', 'center start': 'CenterStart',
    'end end': 'BottomEnd', 'start end': 'TopEnd', 'center': 'Center', 'end center': 'BottomCenter',
  };
  return map[s] ?? null;
}

// spec/04 trap 3: one function builds every modifier chain, in one order.
function modifierOf(n, ctx, opts) {
  const parts = { size: [], weight: [], fill: [], aspect: [], margin: [], background: [], border: [], clip: [], padding: [], align: [], clickable: [], selectable: [] };
  const paint = n.paint || {};
  const size = n.size || {};
  const layout = n.layout || {};
  const authored = size.authored || {};
  const shape = shapeExpr(paint.radius);
  const isText = n.role === 'Text';

  // spec/04 trap 5, applied with the UNIT the design used, read off the declaration by the capture
  // rather than inferred from the computed value: `width: 100%` is a responsive fill, `width: 40px`
  // is an authored size, and a width a flex parent handed a node is neither. The earlier draft of
  // this file welded 152.dp and 160.dp out of computed layout, which is exactly the bug this trap
  // names, and the hand-written card it is compared against uses no such width.
  const pxW = authored.width === 'px' ? size.width : null;
  const pxH = authored.height === 'px' ? size.height : null;
  // A widget that already implies a target size needs no authored size when the two agree. The number
  // is not a style preference: the pinned IconButton/IconToggleButton KDoc says "overall minimum touch
  // target size of 48 x 48dp", which is the authority for spec/04's "do not add a size". When they
  // disagree the authored size STAYS: the implied value is a minimum, so dropping a larger authored
  // target would quietly lose what the design drew.
  const implied = opts.widgetImpliedSize ?? null;
  const square = pxW != null && pxW === pxH;
  const impliedMatch = implied != null && square && pxW === implied;
  if (implied != null && square && !impliedMatch) {
    ctx.note(`${n.id}: ${opts.widget} implies a ${implied}dp minimum target but the design authored ${pxW}px; the authored size stays, the implied value is only a minimum`);
  }
  if (impliedMatch) {
    ctx.note(`${n.id}: ${opts.widget} already implies the authored ${implied}dp target (pinned KDoc), so no size is emitted (spec/04)`);
  } else if (authored.width === 'px' && authored.height === 'px' && square) {
    parts.size.push(`size(${dp(pxW)})`);
  } else {
    if (pxW) parts.size.push(`width(${dp(pxW)})`);
    if (pxH) parts.size.push(`height(${dp(pxH)})`);
  }
  if (authored.width && authored.width !== 'px' && authored.width !== 'relative') {
    ctx.note(`${n.id}: declares width "${authored.width}", which has no Compose size equivalent; nothing emitted`);
  }

  // Weight first: a weighted child must not also be filled, or the two fight (the hand-written card
  // uses Modifier.weight(1f) alone on exactly this node).
  if (opts.scope === 'Row' && (layout.flexGrow || 0) > 0) parts.weight.push(`weight(${floatLit(layout.flexGrow)})`);

  if (authored.width === 'relative') parts.fill.push('fillMaxWidth()');
  // A flex child stretches across the cross axis unless it sizes itself. The cover carries NO
  // authored width: its 160px is flex stretch, so the honest emission is fillMaxWidth() -- the same
  // call the hand-written CategoryCover makes -- not a welded 160.dp.
  const ownsWidth = authored.width === 'px' || authored.width === 'relative';
  if (opts.stretchCross && !ownsWidth && !parts.weight.length && !isText) parts.fill.push('fillMaxWidth()');

  // spec/04 trap 7: ratio and authored height conflict; the ratio wins and the file says so.
  if (size.aspect) {
    parts.aspect.push(`aspectRatio(${floatLit(size.aspect)})`);
    if (size.height) ctx.note(`${n.id}: aspectRatio(${floatLit(size.aspect)}) kept and the measured height ${size.height} dropped (spec/04 trap 7)`);
  }

  // A CSS margin is Compose padding applied outside the paint -- but only in one direction. Compose
  // REJECTS a negative padding: `Modifier.padding(top = -4.dp)` throws IllegalArgumentException
  // "Padding must be non-negative" from PaddingElement's constructor (measured on-device, and it was
  // the very first thing the rendered card did -- it compiled, the goldens certified it, and the app
  // crashed on launch). So a negative edge cannot be emitted and cannot be silently dropped either:
  // it is how the design pulled a row up to cancel line-height slack, and losing it moves the layout.
  // Emit the non-negative edges, name the dropped ones with their px values, and say the decision is
  // owed rather than resolving it here -- translating it to offset()/size() would be this tool
  // inventing geometry, which invariant 2 forbids. spec/04 trap 2 is NOT an authority for the old
  // behaviour: it is about border/padding domains and about POSITIVE margins not collapsing, and the
  // word "negative" appears in spec/04 zero times (measured).
  const neg = Object.entries(layout.margin || {}).filter(([, v]) => Number(v) < 0);
  const posEdges = Object.fromEntries(Object.entries(layout.margin || {}).map(([k, v]) => [k, Number(v) < 0 ? 0 : v]));
  const margin = paddingArgs(posEdges);
  if (margin) parts.margin.push(`padding(${margin})`);
  if (neg.length) {
    ctx.note(`${n.id}: CSS margin ${neg.map(([k, v]) => `${v}px ${k}`).join(', ')} is NOT emitted -- Compose rejects negative padding (measured on-device: IllegalArgumentException "Padding must be non-negative" from PaddingElement, the app dies on launch). The edge is dropped, not guessed, so the box is smaller than the design drew (measured on this fixture: the card renders 264dp inside a 272dp frame). How to cancel that line-height slack WITHOUT a negative padding is a mapping decision spec/04 does not make yet: TODO for a human, never a value invented here.`);
  }

  if (paint.background?.role && !opts.backgroundHandledByColors) {
    // spec/04 trap 2: background paints under the padding, which is CSS's box, so the shape rides
    // with it and the corners cannot drift from the container's.
    parts.background.push(`background(MaterialTheme.colorScheme.${paint.background.role}${shape ? `, ${shape}` : ''})`);
  }
  if (paint.border) {
    const role = paint.border.color?.role;
    if (!role) ctx.refuse(`node ${n.id} has a border whose color resolved to no role`);
    else parts.border.push(`border(${dp(paint.border.width)}, MaterialTheme.colorScheme.${role}${shape ? `, ${shape}` : ''})`);
  }
  // Trap 1 in its measured form: the design asked for clipping (overflow hidden) or it did not.
  // The card and the cover round their OWN background, which is what makes them look clipped.
  if (shape && /hidden|clip/.test(String(paint.overflow || '')) && !isText) parts.clip.push(`clip(${shape})`);

  // A Card carries its content padding on the inner container so it lands INSIDE the container
  // color (the hand-written card does exactly that). Emitting it on the Card modifier as well would
  // apply the same 8dp twice, which is how generated cards end up double-indented.
  if (!opts.paddingHandledElsewhere) {
    const a = paddingArgs(layout.padding || {});
    if (a) parts.padding.push(`padding(${a})`);
  }
  if (opts.align) parts.align.push(`align(Alignment.${opts.align})`);
  // A surface that carries a boolean (spec/02's Node.states) takes selectable, which owns the click:
  // emitting clickable as well compiles and fires the callback twice, the same defect the widget roles
  // already refuse. A boolean with no paired callback name is a refusal, not a dead parameter: an
  // unread `selected` argument in a signature looks finished and is not.
  if (opts.selection) {
    if (!opts.clickable) {
      ctx.refuse(`${n.id}: carries the surface boolean "${opts.selection}" but no callback name was paired to its click hole, so selectable() would have no onClick`);
    } else {
      parts.selectable.push(`selectable(selected = ${opts.selection}, onClick = ${opts.clickable})`);
    }
  } else if (opts.clickable) {
    parts.clickable.push(`clickable(onClick = ${opts.clickable})`);
  }

  const chain = [];
  for (const key of MODIFIER_ORDER) chain.push(...parts[key].map((p) => `.${p}`));
  return chain.length ? `Modifier${chain.join('')}` : null;
}

// ---------------------------------------------------------------------------
// per-node emission
//
// Each node returns lines already indented for its own depth, so composition is concatenation: no
// post-hoc re-indenting, which is the class of bug that made an earlier draft of this file emit
// unparseable Kotlin.

function emitNode(id, ctx, opts) {
  const n = ctx.nodes[id];
  const ind = '    '.repeat(opts.indent);
  const L = [];
  const cb = ctx.nameFor.get(id) ?? null;
  // The modifier is built by the case that EMITS it, with the options that case needs. Building it once
  // up here looked tidy and was wrong twice over: Card and the two widget roles each build their own
  // with different options, so modifierOf ran twice for one node -- and every note it emits as a side
  // effect (a negative margin, a dropped aspectRatio height, an unrepresentable width) landed in the
  // file TWICE, which the goldens then certified. One emitted modifier, one build, one set of notes.
  const modOf = (over = {}) => modifierOf(n, ctx, {
    ...opts, clickable: cb, isText: n.role === 'Text', ...over,
  });
  const modArgOf = (over) => { const m = modOf(over); return m || 'Modifier'; };

  switch (n.role) {
    case 'Text': {
      const mod = modOf();
      const typeRole = ctx.typeRoleOf(n);
      const maxLines = ctx.maxLinesOf(n);
      const ellipsis = n.type?.overflow === 'ellipsis';
      // A color this node declares, or the role it INHERITS. Compose has no CSS inheritance across a
      // background(), so a container that paints a role does not pass its ink down the way the web
      // does -- the hand-written CategoryCover passes `color = content` to exactly this kind of
      // label. Emitting nothing here would draw the badge in the wrong role and look plausible.
      const fg = n.paint?.foreground?.role ?? ctx.inheritedRole(n);
      L.push(`${ind}Text(`);
      L.push(`${ind}    text = ${n.prop ? camel(n.prop) : JSON.stringify(n.text ?? '')},`);
      if (mod) L.push(`${ind}    modifier = ${mod},`);
      if (typeRole) L.push(`${ind}    style = MaterialTheme.typography.${typeRole},`);
      if (fg) L.push(`${ind}    color = MaterialTheme.colorScheme.${fg},`);
      if (maxLines) L.push(`${ind}    maxLines = ${maxLines},`);
      if (ellipsis) L.push(`${ind}    overflow = TextOverflow.Ellipsis,`);
      L.push(`${ind})`);
      return L;
    }

    case 'Icon': {
      const mod = modOf();
      const name = kotlinIconName(n.icon.name);
      // FILL is the design's own filled/outlined axis, measured off font-variation-settings. A
      // design that never declared one gets Filled and is told so, instead of a coin flip.
      const filled = n.icon.fill === null ? true : n.icon.fill === 1;
      const set = filled ? 'Filled' : 'Outlined';
      const tint = n.paint?.foreground?.role ?? ctx.inheritedRole(n);
      L.push(`${ind}Icon(`);
      L.push(`${ind}    imageVector = Icons.${set}.${name},`);
      L.push(`${ind}    contentDescription = null,`);
      if (tint) L.push(`${ind}    tint = MaterialTheme.colorScheme.${tint},`);
      if (mod) L.push(`${ind}    modifier = ${mod},`);
      L.push(`${ind})`);
      L.push(`${ind}// TODO: icon asset -- "${n.icon.name}" is a Material Symbols glyph referenced by name`);
      L.push(`${ind}//   (spec/04 trap 8; FILL ${n.icon.fill === null ? 'undeclared, Filled assumed' : n.icon.fill} picked the ${set} set).`);
      L.push(`${ind}//   The name is only as good as the snake_case -> ${set} mapping; the compiler is what`);
      L.push(`${ind}//   proves it exists in the target's icon dependency.`);
      return L;
    }

    case 'Card': {
      const paint = n.paint || {};
      // The card's padding is emitted on the inner container below, not here, and its background is
      // emitted as `colors =`, not as a background() in the modifier: Card already paints its
      // container, so a background() on top of it paints the same role twice. The hand-written card
      // is the authority -- it passes colors = CardDefaults.cardColors(containerColor = ...) and no
      // background() -- and an extra background() also defeats the shape clipping Card does itself.
      // The boolean a clickable surface carries is spec/02's Node.states (measured: ["selected"] on this
      // fixture). Card has no `selected` parameter to take it, so it rides the modifier -- spec/04's Card
      // row decides Modifier.selectable and names the aria-pressed tension there; this file follows that
      // row and records the decision instead of re-deciding it.
      const cardMod = modOf({
        isText: false, paddingHandledElsewhere: true, backgroundHandledByColors: true,
        selection: ctx.selection.get(id) ?? null,
      });
      L.push(`${ind}Card(`);
      L.push(`${ind}    modifier = ${cardMod || 'Modifier'},`);
      if (shapeExpr(paint.radius)) L.push(`${ind}    shape = ${shapeExpr(paint.radius)},`);
      if (paint.background?.role) L.push(`${ind}    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.${paint.background.role}),`);
      if (paint.elevation != null) {
        // spec/04 trap 4 says "tonalElevation and shadowElevation on Card". Measured against the
        // pinned material3 1.12.0-alpha03, CardDefaults.cardElevation has NO tonalElevation
        // parameter (defaultElevation, pressedElevation, focusedElevation, hoveredElevation,
        // draggedElevation, disabledElevation) and CardElevation exposes only shadowElevation: a
        // Card cannot carry a tonal elevation at all, so the only honest place for a declared level
        // is defaultElevation. What stays true of the trap is the part that mattered: the number
        // comes from data-elevation, never from a box-shadow.
        L.push(`${ind}    // data-elevation ${paint.elevation}, on the pinned ladder. spec/04 trap 4 asks for tonal;`);
        L.push(`${ind}    // CardDefaults.cardElevation in material3 1.12.0-alpha03 has no tonalElevation`);
        L.push(`${ind}    // parameter, so this is a shadow elevation. Never a value read off a box-shadow.`);
        L.push(`${ind}    elevation = CardDefaults.cardElevation(defaultElevation = ${dp(paint.elevation)}),`);
      }
      L.push(`${ind}) {`);
      const inner = n.children.length > 1 && n.layout?.direction === 'column' ? 'Column'
        : n.children.length > 1 && n.layout?.direction === 'row' ? 'Row' : null;
      const gap = typeof n.layout?.gap === 'number' ? n.layout.gap : null;
      if (inner) {
        L.push(`${ind}    ${inner}(`);
        const pad = paddingArgs(n.layout.padding || {});
        if (pad) L.push(`${ind}        modifier = Modifier.padding(${pad}),`);
        if (gap) L.push(`${ind}        ${inner === 'Column' ? 'vertical' : 'horizontal'}Arrangement = Arrangement.spacedBy(${dp(gap)}),`);
        L.push(`${ind}    ) {`);
        // A Column's cross axis is width, and CSS align-items defaults to normal == stretch, so its
        // children fill unless the design aligned them. That is how the cover becomes 160 wide.
        for (const c of n.children) L.push(...emitNode(c, ctx, { ...opts, indent: opts.indent + 2, scope: inner, isChild: true, stretchCross: inner === 'Column' && stretchCrossAxis(n) }));
        L.push(`${ind}    }`);
      } else {
        for (const c of n.children) L.push(...emitNode(c, ctx, { ...opts, indent: opts.indent + 1, isChild: true }));
      }
      L.push(`${ind}}`);
      return L;
    }

    case 'Row': {
      const gap = typeof n.layout?.gap === 'number' ? n.layout.gap : null;
      L.push(`${ind}Row(`);
      L.push(`${ind}    modifier = ${modArgOf()},`);
      if (gap) L.push(`${ind}    horizontalArrangement = Arrangement.spacedBy(${dp(gap)}),`);
      if (/center/.test(String(n.layout?.align || ''))) L.push(`${ind}    verticalAlignment = Alignment.CenterVertically,`);
      L.push(`${ind}) {`);
      // A Row's cross axis is height, and spec/04 trap 5 forbids a captured fixed height, so nothing
      // stretches here; align-items: center becomes verticalAlignment instead.
      for (const c of n.children) L.push(...emitNode(c, ctx, { ...opts, indent: opts.indent + 1, scope: 'Row', isChild: true }));
      L.push(`${ind}}`);
      return L;
    }

    case 'Column': {
      // spec/02's enum gained Column, so the capture may now name it. Without this case the role would
      // fall through to the Box default: a valid, plausible, wrong layout, which is the one failure
      // mode KNOWN_ROLES exists to prevent. Symmetric to Row, with the cross axis read, not assumed.
      const gap = typeof n.layout?.gap === 'number' ? n.layout.gap : null;
      L.push(`${ind}Column(`);
      L.push(`${ind}    modifier = ${modArgOf()},`);
      if (gap) L.push(`${ind}    verticalArrangement = Arrangement.spacedBy(${dp(gap)}),`);
      if (/center/.test(String(n.layout?.align || ''))) L.push(`${ind}    horizontalAlignment = Alignment.CenterHorizontally,`);
      L.push(`${ind}) {`);
      // A Column's cross axis is width, and CSS align-items defaults to normal == stretch, so children
      // fill the width unless the design aligned them.
      for (const c of n.children) {
        L.push(...emitNode(c, ctx, { ...opts, indent: opts.indent + 1, scope: 'Column', isChild: true, stretchCross: stretchCrossAxis(n) }));
      }
      L.push(`${ind}}`);
      return L;
    }

    case 'IconToggleButton':
    case 'IconButton': {
      // The widget owns the click, so the modifier must NOT also carry clickable(): IconToggleButton
      // takes checked and onCheckedChange, IconButton takes onClick. Emitting both would compile and
      // fire the callback twice.
      const widgetMod = modOf({ clickable: null, isText: false, widgetImpliedSize: 48, widget: n.role });
      const toggle = n.callback?.stateProp ? camel(n.callback.stateProp) : null;
      if (n.role === 'IconToggleButton' && !toggle) {
        ctx.refuse(`${n.id} is an IconToggleButton but carries no callback.stateProp, so there is no boolean to bind to checked`);
      }
      L.push(`${ind}${n.role}(`);
      if (n.role === 'IconToggleButton') {
        L.push(`${ind}    checked = ${toggle},`);
        L.push(`${ind}    onCheckedChange = { ${cb}${'()'} },`);
      } else {
        L.push(`${ind}    onClick = { ${cb}${'()'} },`);
      }
      if (widgetMod) L.push(`${ind}    modifier = ${widgetMod},`);
      L.push(`${ind}) {`);
      for (const c of n.children) L.push(...emitNode(c, ctx, { ...opts, indent: opts.indent + 1, scope: 'Box', isChild: true }));
      L.push(`${ind}}`);
      return L;
    }

    default: {
      // Box: the generic container. A CSS grid that stacks two children in one cell is a Box with
      // the second child aligned, which is exactly what the captured placeSelf says to do.
      const stacked = n.children.length > 1 && n.children.every((c) => String(ctx.nodes[c].layout?.gridArea || 'auto') !== 'auto');
      // Centering is read off the node's own justify/align, not off its display: a one-cell grid with
      // place-items: center and a flex box with justify-content + align-items: center say the same
      // thing and both compute to center on both axes. Keying it to `display: grid` silently left the
      // toggle's glyph in the top-left corner while the design centered it.
      const center = centerFrom(n);
      L.push(`${ind}Box(`);
      L.push(`${ind}    modifier = ${modArgOf()},`);
      if (center && !stacked) L.push(`${ind}    contentAlignment = Alignment.Center,`);
      L.push(`${ind}) {`);
      for (const c of n.children) {
        const child = ctx.nodes[c];
        L.push(...emitNode(c, ctx, {
          indent: opts.indent + 1, scope: 'Box', isChild: true,
          // A one-cell grid with place-items: center centers everything in its cells and lets one
          // child placeSelf itself to a corner. Both facts came off the capture: the glyph declares
          // no placeSelf (so it takes the container's center) and the label declares end/start.
          align: stacked ? (boxAlign(child.layout?.placeSelf) ?? center) : boxAlign(child.layout?.placeSelf),
        }));
      }
      L.push(`${ind}}`);
      return L;
    }
  }
}

// ---------------------------------------------------------------------------
// the three files

function colorFile(pkg, tokens) {
  const roles = Object.keys(tokens.color.light);
  // One property per line with NO separator: the trailing comma belongs to a call's argument list,
  // and emitting it after a top-level val is a syntax error ("Property getter or setter expected").
  // The theme's arg list below is a call and DOES take commas; the two shapes must not share one
  // joiner, which is what the compiler caught here.
  const block = (scheme, prefix) => roles
    .map((r) => `    val ${prefix}${pascal(r)} = ${hexToKotlin(tokens.color[scheme]?.[r] ?? tokens.color.light[r])}`)
    .join('\n');
  return `package ${pkg}

import androidx.compose.ui.graphics.Color

// ${MARKER} by ${GENERATOR}. Do not edit by hand: the generator overwrites this file.
//
// ${roles.length} roles x 2 schemes, projected straight from tokens.json by role name. tokens.json is
// the only file the contract may hold a literal color in (no-literal-hex-outside-tokens), so nothing
// here added, dropped or adjusted a role: the ${roles.length} names are the ${roles.length} names in
// the token file, and each is exactly the hex that file carries.
// spec/04 trap 9: two schemes, because Compose has no runtime mode switch inside one ColorScheme.
internal object DesignColors {
${block('light', 'light')}

${block('dark', 'dark')}
}
`;
}

function themeFile(pkg, base, tokens) {
  const roles = Object.keys(tokens.color.light);
  const args = (prefix) => roles.map((r) => `        ${r} = DesignColors.${prefix}${pascal(r)},`).join('\n');
  const steps = Object.entries(tokens.shape || {}).filter(([, v]) => typeof v === 'number' && v > 0);
  const named = ['extraSmall', 'small', 'medium', 'large', 'extraLarge'];
  // Each line already carries its own trailing comma because it is a CALL argument list, where a
  // comma belongs. The template below must not add one after the block: that produced `,,`.
  const shapeArgs = named
    .filter((k) => steps.some(([n]) => n === k))
    .map((k) => {
      const v = steps.find(([n]) => n === k)[1];
      return `    ${k} = RoundedCornerShape(${v}.dp),`;
    })
    .join('\n');
  const skipped = steps.filter(([k]) => !named.includes(k)).map(([k, v]) => `${k} ${v}`);
  return `package ${pkg}

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp

// ${MARKER} by ${GENERATOR}. Do not edit by hand: the generator overwrites this file.
//
// The hand-written theme in ${base}.ui.theme is untouched and stays the app's theme. This one exists
// so the generated composables can be compiled and previewed on their own, in their own package,
// without a second declaration of Color/Theme colliding with the hand-written ones.
private val GeneratedLightScheme = lightColorScheme(
${args('light')}
)

private val GeneratedDarkScheme = darkColorScheme(
${args('dark')}
)

// Shape steps read from tokens.json (${steps.map(([k, v]) => `${k} ${v}`).join(', ')}), not assumed.
//
// tokens.json's "full" step is deliberately NOT passed: Shapes in the pinned material3 has no
// "full" parameter at all (its own source says "Shapes None and Full are omitted as None is a
// RectangleShape and Full is a CircleShape"), so a circle is written as CircleShape at the use site,
// which is where shapeExpr() already puts it. Passing full would be an unresolved parameter.
${skipped.length ? `// Steps with no Shapes parameter and therefore not emitted here: ${skipped.join(', ')}.
` : ''}private val GeneratedShapes = Shapes(
${shapeArgs}
)

/**
 * The scheme this design produced, for the generated composables in ${pkg}.
 *
 * spec/04 trap 9: dark is a second ColorScheme object chosen on a Boolean, never one scheme with an
 * if at the call sites. No dynamic color: it needs an Android Context and this is commonMain.
 *
 * typography is deliberately NOT overridden. The token file asks for a brand family in the display
 * and title roles; with no font bundled, Compose falls back to the platform default and the brand
 * face quietly disappears. A copy() naming a font that is not in the project would hide that, so
 * the fallback stays visible where it can be seen instead of asserted in a theme nobody can run.
 */
@Composable
fun GeneratedTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (darkTheme) GeneratedDarkScheme else GeneratedLightScheme,
        shapes = GeneratedShapes,
        content = content,
    )
}
`;
}

function componentFile({ pkg, typeName, params, boolParams, cbParams, rootId, ctx, ir }) {
  // emitNode returns lines (composition is concatenation, never re-indenting); the import scan
  // needs the body as one text, so it is joined once here at the boundary.
  const bodyLines = emitNode(rootId, ctx, { indent: 1, isFrameRoot: true, scope: null });
  const body = bodyLines.join('\n');
  const imports = collectImports(body);
  // Position authority is the hand-written card this one is compared against: (podcast, subscribed,
  // onSubscribeClick, modifier). A toggle's boolean sits with the data it reflects, not with the
  // callbacks, and `checked = subscribed` has to have a parameter to name or the file will not compile.
  const sig = [
    ...params.map((p) => `    ${p.name}: ${p.kotlinType},`),
    ...boolParams.map((p) => `    ${p.name}: ${p.kotlinType},`),
    ...cbParams.map((p) => `    ${p.name}: ${p.kotlinType},`),
    '    modifier: Modifier = Modifier,',
  ];
  const previewArgs = [
    ...params.map((p) => `${p.name} = FakeData.${pascal(p.name)}`),
    ...boolParams.map((p) => `${p.name} = FakeData.${pascal(p.name)}`),
    ...cbParams.map((p) => `${p.name} = {}`),
  ];
  const stateTodos = ctx.stateTodos;
  return `package ${pkg}

${imports.map((i) => `import ${i}`).join('\n')}

/**
 * ${MARKER} ${ir.frame.id} of ${ir.source} by ${GENERATOR}. Do not edit by hand.
 *
 * Parameterless by contract (spec/04): no remember, no mutableStateOf, no ViewModel, no
 * LaunchedEffect. Where the design implies state it became a parameter or a TODO, and those TODOs
 * are the real output of this tool -- they are the list of decisions a human still has to make.
 *
 * Sizes are emitted where the design authored them and left to content where it did not: the frame
 * is ${ir.frame.box.w}x${ir.frame.box.h} as measured, and spec/04 trap 5 forbids welding a captured
 * height onto a text node, because that is what breaks font scaling and desktop resize.
 */
@Composable
fun ${typeName}(
${sig.join('\n')}
) {
${body}
}
${stateTodos.length ? `\n// TODO(state) markers above: the design paints ${stateTodos.length} state(s) the compiler cannot infer.\n` : ''}
// The design's own sample values, from the data-props schema defaults (spec/04: FakeData, not
// inline, so the next agent deletes them in one move).
private object FakeData {
${[...params, ...boolParams].map((p) => `    const val ${pascal(p.name)} = ${p.kotlinType === 'Boolean' ? String(p.sample) : JSON.stringify(p.sample ?? '')}`).join('\n')}
}

@Preview
@Composable
private fun ${typeName}Preview() {
    GeneratedTheme {
        ${typeName}(${previewArgs.join(', ')})
    }
}

// ---------------------------------------------------------------------------
// Diagnostics this file was written under (spec/04: a generated file that pretends to be certain is
// worse than one that shows its work).
${ctx.footer()}
`;
}

function collectImports(body) {
  const need = new Set(['androidx.compose.runtime.Composable', 'androidx.compose.ui.Modifier', 'androidx.compose.ui.unit.dp', 'androidx.compose.ui.tooling.preview.Preview']);
  const add = (re, imp) => { if (re.test(body)) need.add(imp); };
  add(/\bCard\(/, 'androidx.compose.material3.Card');
  add(/\bCardDefaults\./, 'androidx.compose.material3.CardDefaults');
  add(/\bColumn\(/, 'androidx.compose.foundation.layout.Column');
  add(/\bRow\(/, 'androidx.compose.foundation.layout.Row');
  add(/\bBox\(/, 'androidx.compose.foundation.layout.Box');
  add(/\bText\(/, 'androidx.compose.material3.Text');
  add(/\bIcon\(/, 'androidx.compose.material3.Icon');
  // The hand-written card imports androidx.compose.material3.IconToggleButton for exactly this widget;
  // IconButton is the sibling the capture can now name too.
  add(/\bIconToggleButton\(/, 'androidx.compose.material3.IconToggleButton');
  add(/\bIconButton\(/, 'androidx.compose.material3.IconButton');
  add(/Icons\.Filled\./, 'androidx.compose.material.icons.Icons');
  add(/Icons\.Outlined\./, 'androidx.compose.material.icons.Icons');
  add(/\bArrangement\./, 'androidx.compose.foundation.layout.Arrangement');
  add(/\bAlignment\./, 'androidx.compose.ui.Alignment');
  add(/\.padding\(/, 'androidx.compose.foundation.layout.padding');
  add(/\.size\(/, 'androidx.compose.foundation.layout.size');
  add(/\.width\(/, 'androidx.compose.foundation.layout.width');
  // weight() and align() are NOT imported. They are member extensions of RowScope/BoxScope and
  // resolve through the implicit receiver of the container they are emitted inside; the
  // hand-written ui/components/PodcastCard.kt uses both and imports neither, which is the evidence.
  // Importing them anyway is an unresolved-reference error, not a harmless extra line.
  add(/\.aspectRatio\(/, 'androidx.compose.foundation.layout.aspectRatio');
  add(/\.background\(/, 'androidx.compose.foundation.background');
  add(/\.clip\(/, 'androidx.compose.ui.draw.clip');
  add(/\.border\(/, 'androidx.compose.foundation.border');
  add(/\.clickable\(/, 'androidx.compose.foundation.clickable');
  // selectable lives in foundation.selection, not in material3, and it is NOT the same import as
  // clickable: forgetting it is an unresolved-reference error at the use site, not a warning.
  add(/\.selectable\(/, 'androidx.compose.foundation.selection.selectable');
  add(/TextOverflow\./, 'androidx.compose.ui.text.style.TextOverflow');
  add(/MaterialTheme\./, 'androidx.compose.material3.MaterialTheme');
  // Each icon reference imports the exact set the design's FILL axis chose.
  // The set is a lowercase PACKAGE (material.icons.filled.Terminal) while the property on Icons is
  // capitalized (Icons.Filled.Terminal). Emitting the capitalized form as the import is an
  // unresolved-reference error; the hand-written card's own imports are the evidence.
  for (const m of body.matchAll(/Icons\.(Filled|Outlined)\.([A-Z]\w+)/g)) {
    need.add('androidx.compose.material.icons.Icons');
    need.add(`androidx.compose.material.icons.${m[1].toLowerCase()}.${m[2]}`);
  }
  add(/fillMaxWidth\(/, 'androidx.compose.foundation.layout.fillMaxWidth');
  // A circle radius becomes CircleShape and a per-corner radius RoundedCornerShape at the use site,
  // so both need importing when they appear. The theme file imports them for its own reasons.
  add(/\bCircleShape\b/, 'androidx.compose.foundation.shape.CircleShape');
  add(/\bRoundedCornerShape\(/, 'androidx.compose.foundation.shape.RoundedCornerShape');
  return [...need].sort();
}

// ---------------------------------------------------------------------------
// build

/**
 * @param ir       the spec/02 document tools.captureFrame returned
 * @param tokens   parsed tokens.json: the color and shape authority
 * @param opts     { base, component, callbacks }
 * @returns        { files, refusals, errorDiagnostics, notes }
 */
export function emitCompose(ir, tokens, opts = {}) {
  const refusals = [];
  const notes = [];
  const base = opts.base ?? 'com.callstack.minijetcaster';
  const pkg = `${base}.ui.generated`;
  const nodes = ir.nodes || {};

  if (ir.schema !== 'design-ir/1') return { files: {}, refusals: [`schema is "${ir.schema}"; this emitter writes design-ir/1 only (spec/02 Versioning)`], errorDiagnostics: [], notes };
  if (!tokens?.color?.light || !tokens?.color?.dark) return { files: {}, refusals: ['tokens.json carries no color.light and color.dark: the emitter has no color authority and invents none'], errorDiagnostics: [], notes };

  const want = kebabOf(opts.component ?? ir.screen);
  const rootId = Object.keys(nodes).find((id) => nodes[id].component === want);
  if (!rootId) return { files: {}, refusals: [`no node carries data-component="${want}"`], errorDiagnostics: [], notes };

  const ctx = {
    // id -> the camelCase surface boolean this node carries (spec/02's Node.states). Filled once, next
    // to the parameter collection that reads the same facts, so the signature and the modifier cannot
    // disagree about which node is a selected surface.
    nodes, nameFor: new Map(), selection: new Map(), notes, refusals, stateTodos: [],
    note: (m) => notes.push(m),
    refuse: (m) => { if (!refusals.includes(m)) refusals.push(m); },
    // spec/02 Node.type is a field now. It used to ride in `notes` as a structured string, and the two
    // readers here were the only thing that made it reach the output: a capture could write node.type
    // while this file kept parsing a note that no longer existed, and the emitted Text would carry no
    // style, no maxLines and no overflow -- valid Kotlin, quietly wrong, and the goldens would have
    // blessed it. Read the field; refuse a role that cannot name a typography property.
    typeRoleOf: (n) => {
      const t = n.type;
      if (!t) return null;
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(String(t.role))) {
        ctx.refuse(`${n.id}: node.type.role "${t.role}" cannot name a typography property; refusing to emit a style reference it cannot resolve`);
        return null;
      }
      if (t.source === 'closest') ctx.note(`${n.id}: type role ${t.role} is the closest match, not a scale hit; spec/03 wants an explicit copy() here`);
      return t.role;
    },
    maxLinesOf: (n) => n.type?.lineClamp ?? null,
    // The role an ANCESTOR declared, carried by the capture as a note. Compose has no CSS color
    // inheritance across a background(), so the hand-written CategoryCover passes `color = content`
    // to exactly this kind of label; dropping it would draw the badge in the wrong role and still
    // look plausible on screen.
    inheritedRole: (n) => {
      const hit = (n.notes || []).find((x) => x.startsWith('foreground-inherited:'));
      if (!hit) return null;
      const m = /^foreground-inherited:([A-Za-z][A-Za-z0-9]*)[ (]/.exec(hit);
      return m ? m[1] : null;
    },
    hasWeightedSibling: (parent) => parent.children.some((c) => (nodes[c].layout?.flexGrow || 0) > 0),
    isCircleBox: (child) => child.paint?.radius?.shape === 'circle',
    footer: () => {
      const lines = [];
      for (const d of ir.diagnostics) lines.push(`// [${d.severity}] ${d.code} ${d.node}: ${d.message}`);
      if (!ir.diagnostics.length) lines.push('// none');
      lines.push('//');
      lines.push('// Callback pairing, with the evidence spec/02 demands (never an invented name):');
      for (const nt of notes.filter((x) => x.includes(' <- '))) lines.push(`//   ${nt}`);
      lines.push('//');
      lines.push('// Emission decisions taken from the IR, so the reading is checkable:');
      for (const nt of notes.filter((x) => !x.includes(' <- '))) lines.push(`//   ${nt}`);
      return lines.join('\n');
    },
  };

  for (const [id, n] of Object.entries(nodes)) {
    if (!KNOWN_ROLES.includes(n.role)) {
      const intended = (n.notes || []).find((x) => x.startsWith('role-intended:'));
      ctx.refuse(`node ${id} has role "${n.role}"${intended ? ` (${intended})` : ''}; this emitter writes only ${KNOWN_ROLES.join('/')}`);
    }
    for (const ch of ['background', 'foreground', 'border']) {
      const p = ch === 'border' ? n.paint?.border?.color : n.paint?.[ch];
      const present = ch === 'border' ? !!n.paint?.border : !!p;
      if (present && p && !p.role) ctx.refuse(`node ${id} has an unresolved ${ch} color ${p.hex}; refusing to emit a literal for a color no role claims (spec/02)`);
    }
    if (n.role === 'Icon' && !kotlinIconName(n.icon?.name ?? '')) {
      ctx.refuse(`node ${id} is an Icon whose glyph name "${n.icon?.name}" cannot become a Kotlin identifier`);
    }
    // spec/04 trap 6: weight needs the scope, and reduction can break it silently.
    if ((n.layout?.flexGrow || 0) > 0) {
      const parent = Object.values(nodes).find((p) => (p.children || []).includes(id));
      if (!parent || parent.role !== 'Row') ctx.refuse(`node ${id} has flex-grow but its surviving parent is ${parent ? parent.role : 'nothing'}; spec/04 trap 6: weight would silently stop applying`);
    }
    // A toggle whose boolean the design declared is a parameter, not a TODO. The state a capture
    // cannot infer is the one that has no prop behind it (hover, focus), and those are the notes below.
    if (n.callback?.state && n.callback.stateProp) {
      ctx.note(`${id}: ${n.callback.state} driven by boolean "${n.callback.stateProp}" becomes a checked parameter (spec/02)`);
    }
    // spec/04 trap 1: a background inside a rounded ancestor that carries no shape of its own.
    if (n.paint?.background && !n.paint?.radius) {
      const ancestor = Object.values(nodes).find((p) => (p.children || []).includes(id) && p.paint?.radius);
      if (ancestor) ctx.note(`${n.id}: background inside rounded ${ancestor.id} with no shape of its own; spec/04 trap 1 needs ${shapeExpr(ancestor.paint.radius)}`);
    }
    // The other direction of the same trap, and the one the toggle hits: the node declares a shape
    // but the captured state paints no background, so there is nothing for the shape to round. The
    // shape is real (a hover background would appear inside it) and belongs to a state this capture
    // did not take, so emitting CircleShape onto an unpainted Box would draw nothing and pretend the
    // circle exists. The note is the honest output.
    if (!n.paint?.background && n.paint?.radius && shapeExpr(n.paint.radius) && (n.children || []).length) {
      ctx.note(`${n.id}: declares ${shapeExpr(n.paint.radius)} but paints no background in the captured state; nothing emitted to round -- the shape belongs to a hover/selected state (spec/02 states), which is a TODO, not a guess`);
    }
  }

  // Callbacks: pair the measured click holes to the schema's () => void props, in both orders.
  const cb = opts.callbacks ?? { voidProps: [], byHole: [] };
  const clickables = [];
  (function walk(id) {
    const n = nodes[id];
    if (n.callback || (n.notes || []).includes('control:clickable')) clickables.push(id);
    (n.children || []).forEach(walk);
  })(rootId);
  if (clickables.length !== cb.voidProps.length) {
    ctx.refuse(`${clickables.length} clickable node(s) vs ${cb.voidProps.length} callback prop(s) in the schema (${cb.voidProps.join(', ')}): this tool does not name a callback it cannot pair with evidence`);
  } else if (cb.byHole.some((h) => !h.prop)) {
    ctx.refuse(`click hole(s) with no p.onX() in renderVals: ${cb.byHole.filter((h) => !h.prop).map((h) => h.hole).join(', ')}; refusing to invent a callback name`);
  } else {
    const orderFromHoles = cb.byHole.map((h) => h.prop);
    if (orderFromHoles.join(',') !== cb.voidProps.join(',')) {
      ctx.refuse(`callback order disagrees: schema says [${cb.voidProps.join(', ')}], renderVals says [${orderFromHoles.join(', ')}]; refusing to pick`);
    } else {
      clickables.forEach((id, i) => {
        ctx.nameFor.set(id, camel(cb.voidProps[i]));
        ctx.notes.push(`${cb.voidProps[i]} <- ${id} (${nodes[id].callback?.evidence ?? 'declared control, click hole in template text'})`);
      });
    }
  }

  if (refusals.length) return { files: {}, refusals, errorDiagnostics: [], notes };

  const typeName = kotlinTypeName(want);
  if (!typeName) return { files: {}, refusals: [`"${want}" cannot become a Kotlin type name`], errorDiagnostics: [], notes };

  // Required parameters in DOM order of their data-prop (spec/04), callbacks after, modifier last.
  const params = [];
  (function collect(id) {
    const n = nodes[id];
    if (n.prop && n.role === 'Text') params.push({ name: camel(n.prop), kotlinType: 'String', sample: n.text });
    (n.children || []).forEach(collect);
  })(rootId);
  const cbParams = clickables.map((id) => ({ name: ctx.nameFor.get(id), kotlinType: '() -> Unit' }));

  // A toggle's boolean is a parameter of the component (spec/02), and its default is the schema's OWN
  // default -- the one value the preview can show without this tool resolving anything. A stateProp the
  // schema does not declare cannot reach here (the capture leaves stateProp null in that case), but it
  // is refused rather than assumed, because the alternative is emitting `checked =` with no parameter.
  const boolDefaults = new Map((cb.boolProps ?? []).map((b) => [b.name, b.default]));
  const boolParams = [];
  // spec/02: a clickable SURFACE's boolean lives in Node.states, because the surface keeps its role and
  // may have no callback to carry one. The schema is the only thing that TYPES a value, so a states name
  // becomes a boolean parameter only when data-props declares it tsType boolean -- a data-variant with no
  // boolean behind it stays a variant, and inventing a Boolean for it is the invention invariant 2 forbids.
  const surfaceBool = (n) => (n.states || []).find((s) => boolDefaults.has(s)) ?? null;
  (function collectBools(id) {
    const n = nodes[id];
    // DOM order, root first: the card's own `selected` precedes the toggle's `subscribed`, which is the
    // order spec/04 states for a parameter list and the order the hand-written card keeps.
    for (const [prop, isSurface] of [[n.callback?.stateProp, false], [surfaceBool(n), true]]) {
      if (!prop || boolParams.some((b) => b.name === camel(prop))) continue;
      if (!boolDefaults.has(prop)) {
        ctx.refuse(`${n.id}: toggle boolean "${prop}" is not declared in the data-props schema, so it has no default to emit`);
      } else {
        boolParams.push({ name: camel(prop), kotlinType: 'Boolean', sample: boolDefaults.get(prop) });
        if (isSurface) {
          ctx.selection.set(id, camel(prop));
          const click = ctx.nameFor.get(id) ?? null;
          ctx.note(`${n.id}: surface boolean read from Node.states ${JSON.stringify(prop)} (spec/02) becomes the parameter "${camel(prop)}: Boolean" and Modifier.selectable(selected = ${camel(prop)}, onClick = ${click ?? 'UNPAIRED'}) on the surface -- spec/04's Card row chose that modifier and names the aria-pressed tension; this file follows the row and records it`);
        }
      }
    }
    (n.children || []).forEach(collectBools);
  })(rootId);

  const files = {
    'Color.kt': colorFile(pkg, tokens),
    'Theme.kt': themeFile(pkg, base, tokens),
    [`${typeName}.kt`]: componentFile({ pkg, typeName, params, boolParams, cbParams, rootId, ctx, ir }),
  };
  return { files, refusals, errorDiagnostics: ir.diagnostics.filter((d) => d.severity === 'error'), notes, typeName, pkg };
}

// ---------------------------------------------------------------------------
// placement

// A file this tool wrote is recognisable, and that is the only thing it will overwrite.
const isGeneratedByUs = (text) => text.slice(0, 4000).includes(MARKER) && text.includes(GENERATOR);

export function planWrite(targetDir, files) {
  const plan = [];
  for (const [name, text] of Object.entries(files)) {
    const p = join(targetDir, name);
    if (!existsSync(p)) { plan.push({ path: p, text, action: 'create' }); continue; }
    const now = readFileSync(p, 'utf8');
    if (now === text) { plan.push({ path: p, text, action: 'unchanged' }); continue; }
    if (isGeneratedByUs(now)) { plan.push({ path: p, text, action: 'overwrite-own' }); continue; }
    plan.push({ path: p, text, action: 'refused', reason: `${relative(process.cwd(), p)} exists and was not generated by ${GENERATOR}` });
  }
  return plan;
}

async function main(argv) {
  const args = argv.slice(2);
  const get = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
  const dir = get('--dir') ?? join(HERE, 'fixtures', 'annotated');
  const frame = get('--frame') ?? 'PodcastCard.compact';
  const base = get('--base') ?? 'com.callstack.minijetcaster';
  const writeInto = get('--write');
  const outDir = get('--out') ?? join(HERE, 'out', 'generated', 'compose');

  const cap = await captureFrame({ dir, frame });
  if (!cap.ok) {
    process.stderr.write(`emit refused (exit 3): the capture refused first:\n  ${cap.refusals.join('\n  ')}\n`);
    return 3;
  }
  const tokens = JSON.parse(readFileSync(join(dir, 'tokens.json'), 'utf8'));
  const out = emitCompose(cap.ir, tokens, { base, callbacks: readCallbackNames(dir), component: cap.ir.screen });
  if (out.refusals.length) {
    process.stderr.write(`emit refused (exit 3):\n  ${out.refusals.join('\n  ')}\n`);
    return 3;
  }

  const pkgPath = join(...base.split('.'), 'ui', 'generated');
  const target = writeInto ? join(resolve(writeInto), pkgPath) : join(outDir, pkgPath);
  if (writeInto && !existsSync(resolve(writeInto))) {
    process.stderr.write(`emit refused (exit 3): --write target does not exist: ${resolve(writeInto)}\n`);
    return 3;
  }
  if (writeInto && !args.includes('--dry-run')) {
    const st = statSync(resolve(writeInto));
    if (!st.isDirectory()) {
      process.stderr.write(`emit refused (exit 3): --write target is not a directory: ${resolve(writeInto)}\n`);
      return 3;
    }
  }

  const plan = planWrite(target, out.files);
  const blocked = plan.filter((p) => p.action === 'refused');
  if (blocked.length) {
    process.stderr.write(`emit refused (exit 3):\n  ${blocked.map((b) => b.reason).join('\n  ')}\n`);
    return 3;
  }
  if (!args.includes('--dry-run')) {
    mkdirSync(target, { recursive: true });
    for (const p of plan) if (p.action !== 'unchanged') writeFileSync(p.path, p.text);
  }
  for (const p of plan) process.stdout.write(`  ${p.action.padEnd(14)} ${relative(process.cwd(), p.path)}\n`);
  process.stdout.write(`  ${out.typeName} <- ${frame}: ${Object.keys(cap.ir.nodes).length} IR nodes, ${out.errorDiagnostics.length} error diagnostic(s)\n`);
  return out.errorDiagnostics.length ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv).then((code) => { process.exitCode = code; });
}

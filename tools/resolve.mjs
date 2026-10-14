#!/usr/bin/env node
// T5/WU4a -- value resolvers. Pure lookups, no browser, no capture, no CLI pipeline.
//
// The repo invariant these functions are built around: REFUSE INSTEAD OF INVENT. Every miss
// returns the measured value plus a diagnostic; nothing here falls back to a plausible literal.
//
// Authorities, in the order spec/03 puts them:
//   - the custom-property-to-role map (readRoleMap) is the authority for color; a computed hex
//     is only evidence (spec/03 Capture step 4, Resolution rules).
//   - the type scale, the shape ladder and the elevation ladder are parsed out of
//     spec/03-extraction.md at module load. They are deliberately NOT retyped here: a copy of
//     those 15 rows in a tool is a second source of truth, and the first spec edit would make it
//     lie. If a parse comes up empty this module throws at load instead of running on defaults.
//
//   node tools/resolve.mjs --selftest   prints the four measured capture colors with their roles

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SPEC_03 = fileURLToPath(new URL('../spec/03-extraction.md', import.meta.url));

// ---------------------------------------------------------------------------
// spec/03 tables (parsed once, at load)

function spec03() {
  return readFileSync(SPEC_03, 'utf8');
}

// The markdown section whose heading contains `heading`, up to the next heading of any level.
// Table and ladder parsers share this so a heading that moves costs one helper, not four parsers.
function sectionOf(text, heading) {
  const at = text.indexOf(heading);
  if (at < 0) return null;
  const after = text.slice(at);
  const next = after.indexOf('\n#', 3);
  return next < 0 ? after : after.slice(0, next);
}

// The type scale is the markdown table under "### Type scale of the pinned Material3".
function parseTypeScale(text) {
  const start = text.indexOf('### Type scale');
  const end = text.indexOf('###', start + 10);
  if (start < 0 || end < 0) throw new Error('resolve.mjs: type scale section not found in spec/03');
  const rows = [];
  for (const line of text.slice(start, end).split('\n')) {
    const m = /^\|\s*([A-Za-z][A-Za-z0-9]*)\s*\|\s*(-?[\d.]+)\s*\|\s*(-?[\d.]+)\s*\|\s*(-?[\d.]+)\s*\|\s*(-?[\d.]+)\s*\|/.exec(line);
    if (m) rows.push({ role: m[1], size: Number(m[2]), line: Number(m[3]), tracking: Number(m[4]), weight: Number(m[5]) });
  }
  if (rows.length === 0) throw new Error('resolve.mjs: type scale table parsed zero rows from spec/03');
  return rows;
}

// "extraSmall 4, small 8, ... extraExtraLarge 48, plus `CircleShape`"
// The sentence wraps, so the ladder must be read from the whole section rather than one line:
// in spec/03 the line break falls between `extraLargeIncreased` and its `20`, which costs the
// parse two steps and moves CircleShape onto the following line. Reading one line produced four
// steps and the strict check below was what surfaced it.
function parseShapeLadder(text) {
  const section = sectionOf(text, 'Shape ladder');
  if (!section) throw new Error('resolve.mjs: shape ladder section not found in spec/03');
  const flat = section.replace(/\s+/g, ' ');
  const ladder = [...flat.matchAll(/\b([A-Za-z][A-Za-z0-9]*)\s+(\d+)\b/g)].map((m) => ({ shape: m[1], px: Number(m[2]) }));
  if (ladder.length < 7 || !/CircleShape/.test(flat)) {
    throw new Error('resolve.mjs: shape ladder parsed unexpectedly from spec/03: ' + JSON.stringify(ladder));
  }
  return ladder;
}

// "0, 1, 3, 6, 8, 12 dp, from `ElevationTokens.Level0` to `Level5`"
function parseElevationLadder(text) {
  const line = text.split('\n').find((l) => /^[\d,\s]+dp/.test(l.trim()));
  if (!line) throw new Error('resolve.mjs: elevation ladder not found in spec/03');
  const steps = /^([\d,\s]+)dp/.exec(line.trim())[1].split(',').map((s) => Number(s.trim()));
  if (steps.length !== 6) throw new Error('resolve.mjs: elevation ladder parsed ' + steps.length + ' steps, expected 6');
  return steps.map((dp, i) => ({ dp, role: 'Level' + i }));
}

export const TYPE_SCALE = parseTypeScale(spec03());
export const SHAPE_LADDER = parseShapeLadder(spec03());
export const ELEVATION_LADDER = parseElevationLadder(spec03());
export const CIRCLE_SHAPE = 'circle';
// The export writes a circle as 9999px; anything at or above this is that same intent.
export const CIRCLE_PX_MIN = 9999;
// corner-cases.md: "0.2px may arrive as 0.198 or 0.204" -> tolerance, never equality.
export const TRACKING_TOLERANCE = 0.05;
// corner-cases.md: "convert, then compare with a tolerance of one unit per channel".
export const COLOR_TOLERANCE = 1;

/**
 * The authority: `--md-sys-color-primary` -> `primary`, per scheme. Reads only color custom
 * properties, so a typescale block in the same file cannot leak in. Blocks are classified by
 * their selector text: anything naming dark goes to dark, anything naming light or :root goes to
 * light. Only flat rule blocks are read -- this parser does not implement the cascade, which is
 * the browser's job (spec/03: "Read computed style, never parse CSS text"); it reads the token
 * file, which is a declaration list, not a document.
 */
export function readRoleMap(cssText) {
  const schemes = { light: {}, dark: {} };
  const css = String(cssText);
  // Which scheme a declaration belongs to is decided by its ENCLOSING @media first, then by the
  // selector. Selectors alone cannot answer it: fixtures/annotated carries a
  // `@media (prefers-color-scheme: dark) { :root { ... } }` block, and testing that inner `:root`
  // for ":root means light" filed all 34 dark roles into the light bucket -- both buckets came
  // back full, so nothing looked missing while light.primary read back the dark palette. A
  // last-write-wins shortcut would look equally green here and invert on a token file that
  // declares dark first, so the range is what decides.
  const darkRanges = schemeMediaRanges(css, 'dark');
  const lightRanges = schemeMediaRanges(css, 'light');
  const rules = css.matchAll(/([^{}]*)\{([^{}]*)\}/g);
  for (const rule of rules) {
    const [, selector, body] = rule;
    const inDark = inRanges(rule.index, darkRanges);
    const inLight = inRanges(rule.index, lightRanges);
    const dark = inDark || (!inLight && /\bdark\b/i.test(selector));
    const light = !dark && (inLight || /\blight\b/i.test(selector) || /:root/i.test(selector));
    if (!dark && !light) continue;
    const bucket = dark ? schemes.dark : schemes.light;
    for (const [, name, value] of body.matchAll(/--md-sys-color-([A-Za-z0-9-]+)\s*:\s*([^;]+)/g)) {
      const hex = normalizeHex(value.trim());
      if (!hex) continue;
      bucket[camelCase(name)] = hex;
    }
  }
  if (Object.keys(schemes.light).length === 0 && Object.keys(schemes.dark).length === 0) {
    throw new Error('resolve.mjs: readRoleMap found no --md-sys-color-* properties');
  }
  return schemes;
}

// `--md-sys-color-surface-container` names the M3 role `surfaceContainer`: the dash is dropped and
// the next letter is raised. Lowercasing it here made every role name a lowercase blob, which
// turned correct hex matches into "no exact role" and pushed lookups into the tolerance path,
// where a genuinely present color resolved to its NEIGHBORING role instead.
// Byte spans of `@media` blocks whose prelude asks for the given color scheme.
function schemeMediaRanges(css, scheme) {
  const ranges = [];
  const re = new RegExp('@media[^{]*prefers-color-scheme[^{]*' + scheme + '[^{]*\\{', 'gi');
  let m;
  while ((m = re.exec(css))) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
      i += 1;
    }
    ranges.push([m.index, i]);
  }
  return ranges;
}

function inRanges(at, ranges) {
  return ranges.some(([start, end]) => at >= start && at < end);
}

function camelCase(dashed) {
  return dashed.replace(/-([A-Za-z0-9])/g, (_, c) => c.toUpperCase());
}

// Hexes keep their leading '#': the token file, the report text and the comparison against a
// converted computed color all spell them that way, so dropping it here made every lookup miss.
function normalizeHex(value) {
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return null;
  const digits = value.slice(1);
  return '#' + (digits.length === 3 ? digits.split('').map((d) => d + d).join('') : digits).toUpperCase();
}

function schemesList(schemes) {
  // Accept a single flat role map too, treated as one scheme named 'light'.
  if (schemes && (schemes.light || schemes.dark)) {
    return ['light', 'dark'].filter((s) => schemes[s] && Object.keys(schemes[s]).length).map((s) => ({ scheme: s, roles: schemes[s] }));
  }
  if (schemes && typeof schemes === 'object') return [{ scheme: 'light', roles: schemes }];
  throw new Error('resolve.mjs: role map is missing');
}

// ---------------------------------------------------------------------------
// color

function unresolvedColor(hex, message, extra = {}) {
  return {
    hex,
    role: null,
    source: 'unresolved',
    diagnostic: { code: 'color-unresolved', severity: 'error', message, ...extra },
  };
}

/**
 * spec/03 Resolution rules: convert the computed color to sRGB hex, round to nearest, look it up
 * in both token schemes with corner-cases.md's one-unit-per-channel tolerance. Only rgb/rgba and
 * oklab/oklch are converted, because those are the two forms spec/03 names; any other form is
 * refused rather than approximated.
 */
export function roleForColor(computedCssColor, schemes) {
  const parsed = parseComputedColor(computedCssColor);
  if (!parsed.ok) return unresolvedColor(null, `${String(computedCssColor)}: ${parsed.error}`);
  // A color that arrived in oklab/oklch must say so whether or not it resolved: corner-cases.md
  // asks for the conversion to be logged, and the miss is exactly where a reader needs it, since
  // that is the moment someone wonders whether the lookup or the conversion was at fault.
  const miss = (hex, message, extra) => {
    const out = unresolvedColor(hex, message, extra);
    if (parsed.convertedFrom) out.convertedFrom = parsed.convertedFrom;
    return out;
  };
  if (parsed.alpha < 1) {
    return miss(toHex(parsed.rgb), `alpha ${parsed.alpha} on ${String(computedCssColor)}: a role color with alpha maps to no role (corner-cases.md)`);
  }
  const hex = toHex(parsed.rgb);
  const matches = [];
  let nearest = null;
  for (const { scheme, roles } of schemesList(schemes)) {
    for (const [role, roleHex] of Object.entries(roles)) {
      const rgb = fromHex(roleHex);
      const d = channelDelta(parsed.rgb, rgb);
      if (!nearest || d.max < nearest.distance.max
        || (d.max === nearest.distance.max && d.sum < nearest.distance.sum)) {
        nearest = { role, scheme, distance: d };
      }
      if (d.max <= COLOR_TOLERANCE) matches.push({ role, scheme });
    }
  }
  if (matches.length === 0) {
    return miss(hex,
      `${hex} is not any role in either scheme (closest: ${nearest ? nearest.role + ' in ' + nearest.scheme : 'none'})`,
      { closest: nearest ? { role: nearest.role, scheme: nearest.scheme, maxChannelDelta: nearest.distance.max } : null });
  }
  const ordered = orderCandidates(matches);
  const out = { hex, role: ordered[0].role, source: 'computed' };
  if (parsed.convertedFrom) out.convertedFrom = parsed.convertedFrom;
  if (ordered.length > 1) {
    // corner-cases.md: the reverse lookup is ambiguous without the property name, so the fixed
    // order decides AND the collision is said out loud. A capture that carries the custom
    // property name should pass it as preferredRole; it then wins outright.
    out.diagnostic = {
      code: 'color-ambiguous',
      severity: 'warn',
      message: `${hex} is ${ordered.map((m) => `${m.role} (${m.scheme})`).join(', ')}; emitted ${ordered[0].role} by the documented order`,
      candidates: ordered.map((m) => m.role),
    };
  }
  return out;
}

/**
 * The fixed documented order corner-cases.md requires for an ambiguous reverse lookup, applied
 * when the capture carries no custom property to settle it: light before dark, then surfaces,
 * then ink (on*), then accents, then backgrounds; token-file order inside a tier.
 */
function orderCandidates(matches) {
  const tier = (role) => {
    if (/^background$|^onBackground$/i.test(role)) return 3;
    if (/^on/i.test(role)) return 1;
    if (/^surface/i.test(role)) return 0;
    return 2;
  };
  return matches
    .map((m, i) => ({ ...m, i, tier: tier(m.role), schemeRank: m.scheme === 'light' ? 0 : 1 }))
    .sort((a, b) => a.schemeRank - b.schemeRank || a.tier - b.tier || a.i - b.i);
}

function parseComputedColor(input) {
  const text = String(input ?? '').trim().toLowerCase();
  if (!text) return { ok: false, error: 'empty color' };
  if (text === 'transparent') return { ok: true, rgb: [0, 0, 0], alpha: 0 };
  let m = /^rgba?\(([^()]*)\)$/.exec(text);
  if (m) return fromRgbParts(m[1]);
  m = /^oklab\(([^()]*)\)$/.exec(text);
  if (m) return fromOklabParts(m[1], 'oklab');
  m = /^oklch\(([^()]*)\)$/.exec(text);
  if (m) return fromOklchParts(m[1]);
  return { ok: false, error: 'unsupported color form (only rgb/rgba and oklab/oklch are converted; spec/03 names no other)' };
}

function splitArgs(inner) {
  return inner.split(/[,\/\s]+/).filter((s) => s.length > 0);
}

function channelNumber(token, scale) {
  if (token.endsWith('%')) return (parseFloat(token) / 100) * scale;
  const n = parseFloat(token);
  return Number.isFinite(n) ? n : NaN;
}

function fromRgbParts(inner) {
  const parts = splitArgs(inner);
  if (parts.length < 3) return { ok: false, error: 'rgb() needs three channels' };
  const rgb = [0, 1, 2].map((i) => channelNumber(parts[i], 255));
  if (rgb.some((n) => !Number.isFinite(n))) return { ok: false, error: 'unparsable rgb() channel' };
  const alpha = parts.length > 3 ? parseFloat(parts[3]) : 1;
  return { ok: true, rgb, alpha: Number.isFinite(alpha) ? alpha : 1 };
}

// oklab -> linear sRGB -> sRGB (Bjorn Ottosson's inverse, as in the CSS Color 4 recipe).
function fromOklabParts(inner, convertedFrom) {
  const parts = splitArgs(inner);
  if (parts.length < 3) return { ok: false, error: `${convertedFrom}() needs three components` };
  const L = channelNumber(parts[0], 100) / 100;
  const a = parseFloat(parts[1]);
  const b = parseFloat(parts[2]);
  if (![L, a, b].every((n) => Number.isFinite(n))) return { ok: false, error: 'unparsable oklab component' };
  const alpha = parts.length > 3 ? parseFloat(parts[3]) : 1;
  return { ok: true, rgb: oklabToSrgb255(L, a, b), alpha: Number.isFinite(alpha) ? alpha : 1, convertedFrom };
}

function fromOklchParts(inner) {
  const parts = splitArgs(inner);
  if (parts.length < 3) return { ok: false, error: 'oklch() needs three components' };
  const L = channelNumber(parts[0], 100) / 100;
  const C = parseFloat(parts[1]);
  const Hdeg = parseFloat(parts[2]);
  if (![L, C, Hdeg].every((n) => Number.isFinite(n))) return { ok: false, error: 'unparsable oklch component' };
  const h = (Hdeg * Math.PI) / 180;
  return {
    ok: true,
    rgb: oklabToSrgb255(L, C * Math.cos(h), C * Math.sin(h)),
    alpha: parts.length > 3 ? parseFloat(parts[3]) : 1,
    convertedFrom: 'oklch',
  };
}

function oklabToSrgb255(L, a, b) {
  const l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_,
  ];
  return lin.map((c) => Math.round(255 * gammaSrgb(Math.min(1, Math.max(0, c)))));
}

function gammaSrgb(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

function toHex(rgb) {
  return '#' + rgb.map((n) => Math.min(255, Math.max(0, Math.round(n))).toString(16).toUpperCase().padStart(2, '0')).join('');
}

function fromHex(hex) {
  const d = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(d.slice(i, i + 2), 16));
}

function channelDelta(rgbA, rgbB) {
  const d = rgbA.map((n, i) => Math.abs(Math.round(n) - Math.round(rgbB[i])));
  return { max: Math.max(...d), sum: d.reduce((x, y) => x + y, 0) };
}

// ---------------------------------------------------------------------------
// typography

function num(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value === 'string' && value.trim() !== '') return parseFloat(value);
  return NaN;
}

/**
 * spec/03: match on the triple size + line-height + weight, tracking as tiebreaker not filter.
 * On a miss, return the closest role plus the copy() overrides it needs (deltas) and a
 * style-off-scale diagnostic -- never a role that "merely has the same font size" silently.
 */
export function roleForType(style = {}) {
  const measured = {
    fontSize: num(style.fontSize),
    line: num(style.lineHeight ?? style.line),
    weight: num(style.fontWeight ?? style.weight),
    tracking: 'letterSpacing' in style ? num(style.letterSpacing) : NaN,
  };
  if ([measured.fontSize, measured.line, measured.weight].some((n) => !Number.isFinite(n))) {
    return {
      role: null,
      source: 'closest',
      deltas: {},
      measured: publicMeasured(measured),
      diagnostic: { code: 'style-off-scale', severity: 'warn', message: 'font-size, line-height and font-weight are all required to match the type scale' },
    };
  }

  const hits = TYPE_SCALE.filter((r) => r.size === measured.fontSize && r.line === measured.line && r.weight === measured.weight);
  let chosen = hits;
  if (!Number.isNaN(measured.tracking) && hits.length > 1) {
    const tie = hits.filter((r) => Math.abs(r.tracking - measured.tracking) <= TRACKING_TOLERANCE);
    if (tie.length) chosen = tie;
  }
  const candidates = hits.map((r) => r.role);

  if (chosen.length) {
    const role = chosen[0];
    const deltas = {};
    if (!Number.isNaN(measured.tracking) && Math.abs(role.tracking - measured.tracking) > TRACKING_TOLERANCE) {
      deltas.letterSpacing = measured.tracking;
    }
    const out = {
      role: role.role,
      source: 'scale',
      scale: { fontSize: role.size, lineHeight: role.line, fontWeight: role.weight, letterSpacing: role.tracking },
      deltas,
      measured: publicMeasured(measured),
    };
    if (candidates.length > 1) out.candidates = candidates;
    if (Object.keys(deltas).length) {
      out.diagnostic = {
        code: 'style-off-scale',
        severity: 'warn',
        message: `${role.role} tracking is ${role.tracking}px; measured ${measured.tracking}px needs copy({ letterSpacing: ${measured.tracking} })`,
      };
    }
    return out;
  }

  const best = closestScaleRow(measured);
  const deltas = {};
  if (best.size !== measured.fontSize) deltas.fontSize = measured.fontSize;
  if (best.line !== measured.line) deltas.lineHeight = measured.line;
  if (best.weight !== measured.weight) deltas.fontWeight = measured.weight;
  if (!Number.isNaN(measured.tracking) && Math.abs(best.tracking - measured.tracking) > TRACKING_TOLERANCE) {
    deltas.letterSpacing = measured.tracking;
  }
  return {
    role: best.role,
    source: 'closest',
    scale: { fontSize: best.size, lineHeight: best.line, fontWeight: best.weight, letterSpacing: best.tracking },
    deltas,
    measured: publicMeasured(measured),
    candidates: [best.role],
    diagnostic: {
      code: 'style-off-scale',
      severity: 'warn',
      message: `no type role is ${measured.fontSize}/${measured.line}/w${measured.weight}; closest is ${best.role} (${best.size}/${best.line}/w${best.weight}) and copy() carries ${JSON.stringify(deltas)}`,
    },
  };
}

function publicMeasured(m) {
  const out = { fontSize: m.fontSize, lineHeight: m.line, fontWeight: m.weight };
  if (!Number.isNaN(m.tracking)) out.letterSpacing = m.tracking;
  return out;
}

// Closest by size, then line height, then weight, then tracking. Size dominates because that is
// what a reader sees first; the order is fixed so the choice is reproducible, not a judgment.
function closestScaleRow(measured) {
  const score = (r) => [
    Math.abs(r.size - measured.fontSize),
    Math.abs(r.line - measured.line),
    Math.abs(r.weight - measured.weight) / 100,
    Number.isNaN(measured.tracking) ? 0 : Math.abs(r.tracking - measured.tracking) / 1000,
  ];
  let best = TYPE_SCALE[0];
  let bestScore = score(best);
  for (const r of TYPE_SCALE.slice(1)) {
    const s = score(r);
    for (let i = 0; i < s.length; i++) {
      if (s[i] < bestScore[i]) { best = r; bestScore = s; break; }
      if (s[i] > bestScore[i]) break;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// shape and elevation

/** Exact lookup on the spec/03 shape ladder. Between steps is a diagnostic that keeps the px. */
export function shapeForRadius(value) {
  const px = num(value);
  if (!Number.isFinite(px)) {
    return { shape: null, px: null, diagnostic: { code: 'radius-off-ladder', severity: 'error', message: `radius ${String(value)} is not a number` } };
  }
  if (px >= CIRCLE_PX_MIN) return { shape: CIRCLE_SHAPE, px, source: 'ladder' };
  const hit = SHAPE_LADDER.find((s) => s.px === px);
  if (hit) return { shape: hit.shape, px, source: 'ladder' };
  const nearest = SHAPE_LADDER.reduce((a, b) => (Math.abs(b.px - px) < Math.abs(a.px - px) ? b : a));
  return {
    shape: null,
    px,
    source: 'off-ladder',
    diagnostic: {
      code: 'radius-off-ladder',
      severity: 'warn',
      message: `${px}px is between shape steps; nearest is ${nearest.shape} (${nearest.px}px). Emit the raw dp with a comment, do not snap silently`,
      nearest: { shape: nearest.shape, px: nearest.px },
    },
  };
}

/** spec/03 elevation ladder 0,1,3,6,8,12. Outside the six is an error, not a rounding. */
export function elevationForLevel(value) {
  const dp = num(value);
  if (!Number.isFinite(dp)) {
    return { role: null, dp: null, diagnostic: { code: 'elevation-off-ladder', severity: 'error', message: `elevation ${String(value)} is not a number` } };
  }
  const hit = ELEVATION_LADDER.find((e) => e.dp === dp);
  if (hit) return { role: hit.role, dp, source: 'ladder' };
  const nearest = ELEVATION_LADDER.reduce((a, b) => (Math.abs(b.dp - dp) < Math.abs(a.dp - dp) ? b : a));
  return {
    role: null,
    dp,
    source: 'off-ladder',
    diagnostic: {
      code: 'elevation-off-ladder',
      severity: 'error',
      message: `${dp}dp is outside the elevation ladder (0, 1, 3, 6, 8, 12); nearest is ${nearest.dp}dp (${nearest.role}) and this tool does not round it away`,
      nearest: { dp: nearest.dp, role: nearest.role },
    },
  };
}

if (process.argv.includes('--selftest')) {
  const css = readFileSync(fileURLToPath(new URL('../fixtures/annotated/tokens.css', import.meta.url)), 'utf8');
  const schemes = readRoleMap(css);
  for (const cssColor of ['rgb(243, 237, 247)', 'rgb(29, 27, 32)', 'rgb(232, 222, 248)', 'rgb(73, 69, 79)']) {
    const r = roleForColor(cssColor, schemes);
    console.log(`${cssColor} -> ${r.role === null ? 'UNRESOLVED' : r.role} (source: ${r.source}${r.diagnostic ? ', ' + r.diagnostic.code : ''})`);
  }
}

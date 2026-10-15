#!/usr/bin/env node
// T5/WU4a suite for the value resolvers. Everything here is a pure table lookup against the
// authorities: spec/03 for the type/shape/elevation ladders, tokens.css/tokens.json for colors.
// The invariant under test is the repo's: refuse instead of invent. Every miss must be a
// diagnostic with the measured value kept, never a silent literal fallback.
//
//   node --test 'tests/*.test.mjs'

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readRoleMap,
  roleForColor,
  roleForType,
  shapeForRadius,
  elevationForLevel,
  TYPE_SCALE,
} from '../tools/resolve.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const tokensCss = readFileSync(join(ROOT, 'fixtures/annotated/tokens.css'), 'utf8');
const tokensJson = JSON.parse(readFileSync(join(ROOT, 'fixtures/annotated/tokens.json'), 'utf8'));
const schemes = readRoleMap(tokensCss);

// ---------------------------------------------------------------- readRoleMap

test('readRoleMap parses light and dark blocks into camelCase role maps', () => {
  assert.ok(schemes.light, 'light scheme present');
  assert.ok(schemes.dark, 'dark scheme present');
  for (const role of ['surfaceContainer', 'onSurface', 'secondaryContainer',
    'onSecondaryContainer', 'tertiaryContainer']) {
    assert.match(schemes.light[role], /^#[0-9A-F]{6}$/, `${role} parsed with an uppercase hex`);
    assert.match(schemes.dark[role], /^#[0-9A-F]{6}$/, `${role} present in dark too`);
  }
});

test('readRoleMap agrees with tokens.json role-for-role (one authority, no drift)', () => {
  for (const scheme of ['light', 'dark']) {
    assert.deepEqual(
      Object.keys(schemes[scheme]).sort(),
      Object.keys(tokensJson.color[scheme]).sort(),
      `${scheme} role sets match tokens.json`,
    );
    for (const [role, hex] of Object.entries(tokensJson.color[scheme])) {
      assert.equal(schemes[scheme][role], hex.toUpperCase(), `${scheme}.${role} hex matches`);
    }
  }
});

// ------------------------------------------------------------ roleForColor

test('measured computed colors from the annotated capture resolve to their roles', () => {
  // Values measured in Chromium on fixtures/annotated (docs/lessons.md, capture-values-for-the-spike).
  const cases = [
    ['rgb(243, 237, 247)', 'surfaceContainer'],
    ['rgb(29, 27, 32)', 'onSurface'],
    ['rgb(232, 222, 248)', 'secondaryContainer'],
    ['rgb(73, 69, 79)', 'onSurfaceVariant'],
  ];
  for (const [css, role] of cases) {
    const r = roleForColor(css, schemes);
    assert.equal(r.source, 'computed', `${css} resolved`);
    assert.equal(r.role, role, `${css} -> ${role}`);
    assert.ok(!r.diagnostic || r.diagnostic.code !== 'color-unresolved');
  }
});

test('tolerance is one unit per channel: one off still resolves', () => {
  // surfaceContainer is #F3EDF7 = rgb(243, 237, 247). Nudge each channel by 1, and all at once.
  const near = [
    'rgb(244, 237, 247)',
    'rgb(243, 238, 247)',
    'rgb(243, 237, 246)',
    'rgb(242, 236, 246)',
  ];
  for (const css of near) {
    const r = roleForColor(css, schemes);
    assert.equal(r.source, 'computed', `${css} within one-unit tolerance`);
    assert.equal(r.role, 'surfaceContainer', `${css} -> surfaceContainer`);
  }
});

test('tolerance is one unit per channel: two off does not resolve', () => {
  for (const css of ['rgb(245, 237, 247)', 'rgb(243, 235, 247)', 'rgb(243, 237, 249)']) {
    const r = roleForColor(css, schemes);
    assert.equal(r.source, 'unresolved', `${css} is two units off on one channel`);
    assert.equal(r.role, null);
    assert.equal(r.diagnostic.code, 'color-unresolved');
    assert.ok(r.hex, 'the measured hex is kept even when unresolved');
  }
});

test('a hex in no scheme is color-unresolved and names the closest candidate', () => {
  // #7A5AF8, the example hex from the spec/02 diagnostic sample. Not any role anywhere.
  const r = roleForColor('rgb(122, 90, 248)', schemes);
  assert.equal(r.hex, '#7A5AF8');
  assert.equal(r.role, null);
  assert.equal(r.source, 'unresolved');
  assert.equal(r.diagnostic.code, 'color-unresolved');
  assert.equal(r.diagnostic.severity, 'error');
  assert.ok(r.diagnostic.closest && r.diagnostic.closest.role, 'closest candidate named');
});

test('ambiguous reverse lookups resolve by the documented order and warn', () => {
  // #1D1B20 is onBackground AND onSurface in light (and surfaceContainerLow in dark).
  // Documented order: light scheme first; within a scheme, surface roles before background roles.
  const r = roleForColor('rgb(29, 27, 32)', schemes);
  assert.equal(r.role, 'onSurface');
  assert.equal(r.diagnostic.code, 'color-ambiguous');
  assert.equal(r.diagnostic.severity, 'warn');
  assert.ok(r.diagnostic.candidates.includes('onBackground'), 'the other candidate is named');
});

test('oklab computed colors are converted to sRGB before lookup', () => {
  // Values computed by an independent forward oklab (Ottosson / CSS Color 4) from the token hexes
  // in tokens.json, NOT from this tool's own inverse: a round-trip against the code under test
  // would pass even if both directions shared one wrong constant. The four light-scheme hexes the
  // annotated capture produces, in the form Chromium reports them.
  const cases = [
    ['oklab(95.3626% 0.009886 -0.010886)', '#F3EDF7', 'surfaceContainer'],
    ['oklab(22.6524% 0.005545 -0.008311)', '#1D1B20', 'onSurface'],
    ['oklab(91.6334% 0.019944 -0.030587)', '#E8DEF8', 'secondaryContainer'],
    ['oklab(39.8053% 0.009635 -0.014435)', '#49454F', 'onSurfaceVariant'],
  ];
  for (const [ok, hex, role] of cases) {
    const r = roleForColor(ok, schemes);
    assert.equal(r.hex, hex, `${ok} converts back to the token hex`);
    assert.equal(r.role, role, `${ok} resolves through the converted hex`);
    assert.equal(r.source, 'computed');
    assert.equal(r.convertedFrom, 'oklab', 'the conversion is logged (corner-cases.md)');
  }
  // The logging must survive a miss too: that is where a reader wonders whether the lookup or the
  // conversion was at fault.
  const miss = roleForColor('oklab(50% 0.2 0.1)', schemes);
  assert.equal(miss.source, 'unresolved');
  assert.equal(miss.diagnostic.code, 'color-unresolved');
  assert.equal(miss.convertedFrom, 'oklab');
});

test('unsupported or transparent colors are refused, not guessed', () => {
  for (const css of ['hsl(270 50% 50%)', 'transparent', 'none', 'not-a-color']) {
    const r = roleForColor(css, schemes);
    assert.equal(r.source, 'unresolved', `${css} refused`);
    assert.equal(r.role, null);
    assert.equal(r.diagnostic.code, 'color-unresolved');
  }
});

test('a color with alpha is unresolved and says so', () => {
  const r = roleForColor('rgba(243, 237, 247, 0.5)', schemes);
  assert.equal(r.source, 'unresolved');
  assert.match(r.diagnostic.message, /alpha/i);
});

// ------------------------------------------------------------- roleForType

test('the type scale is parsed from spec/03, not retyped: 15 rows, samples verified', () => {
  assert.equal(TYPE_SCALE.length, 15, 'one row per spec/03 table row');
  const byRole = Object.fromEntries(TYPE_SCALE.map((r) => [r.role, r]));
  assert.deepEqual(byRole.displayLarge, { role: 'displayLarge', size: 57, line: 64, tracking: -0.2, weight: 400 });
  assert.deepEqual(byRole.titleMedium, { role: 'titleMedium', size: 16, line: 24, tracking: 0.2, weight: 500 });
  assert.deepEqual(byRole.labelSmall, { role: 'labelSmall', size: 11, line: 16, tracking: 0.5, weight: 500 });
});

test('the spec/03 collisions resolve on weight, tracking only as tiebreaker', () => {
  // 16/24: titleMedium (w500) vs bodyLarge (w400).
  assert.equal(roleForType({ fontSize: 16, lineHeight: 24, fontWeight: 500 }).role, 'titleMedium');
  assert.equal(roleForType({ fontSize: 16, lineHeight: 24, fontWeight: 400 }).role, 'bodyLarge');
});

test('measured text styles resolve to their spec/03 roles', () => {
  const title = roleForType({ fontSize: 14, lineHeight: 20, fontWeight: 500 });
  assert.equal(title.role, 'titleSmall');
  // titleSmall and labelLarge share 14/20/w500/tracking 0.1 exactly: the collision is said out loud.
  assert.deepEqual(title.candidates, ['titleSmall', 'labelLarge']);
  // Capture values: author 12/16 w400, badge 12/16 w500.
  assert.equal(roleForType({ fontSize: 12, lineHeight: 16, fontWeight: 400 }).role, 'bodySmall');
  assert.equal(roleForType({ fontSize: 12, lineHeight: 16, fontWeight: 500 }).role, 'labelMedium');
});

test('px strings and px units from getComputedStyle are accepted', () => {
  const r = roleForType({ fontSize: '14px', lineHeight: '20px', fontWeight: '500' });
  assert.equal(r.role, 'titleSmall');
});

test('letter-spacing is compared with tolerance, never equality', () => {
  // titleMedium tracking 0.2 may arrive as 0.198 or 0.204 (corner-cases.md).
  const r = roleForType({ fontSize: 16, lineHeight: 24, fontWeight: 500, letterSpacing: 0.204 });
  assert.equal(r.role, 'titleMedium');
  assert.ok(!r.diagnostic, 'a rounding of the role tracking is not a miss');
  assert.ok(!('letterSpacing' in r.deltas), 'no copy() override for a tracking within tolerance');
});

test('an off-scale triple returns the closest role with non-empty deltas plus the diagnostic', () => {
  const r = roleForType({ fontSize: 13, lineHeight: 20, fontWeight: 500 });
  assert.equal(r.role, 'titleSmall', 'closest triple is 14/20/500');
  assert.equal(r.source, 'closest');
  assert.ok(Object.keys(r.deltas).length > 0, 'deltas carry the copy() overrides');
  assert.equal(r.deltas.fontSize, 13, 'the measured value is what copy() must override to');
  assert.equal(r.diagnostic.code, 'style-off-scale');
});

test('type input with a missing field is a miss, not a guess', () => {
  const r = roleForType({ fontSize: 14, lineHeight: 20 });
  assert.equal(r.source, 'closest');
  assert.equal(r.diagnostic.code, 'style-off-scale');
});

// ------------------------------------------------------------ shape / elevation

test('radius resolves on the shape ladder', () => {
  const ladder = [[4, 'extraSmall'], [8, 'small'], [12, 'medium'], [16, 'large'],
    [20, 'extraLargeIncreased'], [28, 'extraLarge'], [48, 'extraExtraLarge']];
  for (const [px, shape] of ladder) {
    const r = shapeForRadius(px);
    assert.equal(r.shape, shape, `${px} -> ${shape}`);
    assert.ok(!r.diagnostic);
  }
  assert.equal(shapeForRadius('12px').shape, 'medium', 'px strings accepted');
});

test('9999px resolves to circle (the export writes 9999px for a circle)', () => {
  const r = shapeForRadius('9999px');
  assert.equal(r.shape, 'circle');
  assert.ok(!r.diagnostic);
});

test('a radius between steps is null with a diagnostic, and keeps the raw px', () => {
  const r = shapeForRadius(7);
  assert.equal(r.shape, null);
  assert.equal(r.px, 7, 'the measured value survives');
  assert.equal(r.diagnostic.code, 'radius-off-ladder');
  assert.equal(r.diagnostic.nearest.shape, 'small', 'nearest named but not applied');
  assert.equal(r.diagnostic.nearest.px, 8);
});

test('elevation resolves on the M3 ladder 0,1,3,6,8,12', () => {
  const roles = ['Level0', 'Level1', 'Level2', 'Level3', 'Level4', 'Level5'];
  [0, 1, 3, 6, 8, 12].forEach((dp, i) => {
    const r = elevationForLevel(dp);
    assert.equal(r.role, roles[i], `${dp} -> ${roles[i]}`);
    assert.ok(!r.diagnostic);
  });
});

test('elevation 2 is a diagnostic, not a rounding to 1 or 3', () => {
  const r = elevationForLevel(2);
  assert.equal(r.role, null);
  assert.equal(r.dp, 2, 'no rounding happened');
  assert.equal(r.diagnostic.code, 'elevation-off-ladder');
});

// ------------------------------------------------------------------ surface

test('both files are ASCII only', () => {
  for (const f of ['tools/resolve.mjs', 'tests/resolve.test.mjs']) {
    const text = readFileSync(join(ROOT, f), 'utf8');
    assert.ok(!/[^\x00-\x7F]/.test(text), `${f} is ASCII only`);
  }
});

test('node tools/resolve.mjs --selftest prints the four measured colors with roles', () => {
  const out = execFileSync('node', ['tools/resolve.mjs', '--selftest'], { cwd: ROOT, encoding: 'utf8' });
  for (const role of ['surfaceContainer', 'onSurface', 'secondaryContainer', 'onSurfaceVariant']) {
    assert.match(out, new RegExp(`rgb\\([^)]*\\).*${role}`), `${role} reported`);
  }
});

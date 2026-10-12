# 05 React Native mapping

Second target, because the audience for this workshop is React Native developers and the same
design must read as something they already know. Same IR in, different capability set out. The IR
does not care about the target's limits; the emitter must never invent a workaround that changes
the design.

## Mapping

| Computed style | React Native |
| --- | --- |
| \`display: flex; flex-direction: row\` | \`View\` with \`flexDirection: "row"\` |
| \`... column\` | the RN default; still emit it explicitly, so a reader is never guessing |
| \`justify-content\` | \`justifyContent\`: same names, plus RN's \`space-between\` etc. |
| \`align-items\` | \`alignItems\`; note RN's default is \`stretch\`, CSS's is \`stretch\` too, but \`baseline\` support is partial |
| \`gap\` | \`gap\`, \`rowGap\`, \`columnGap\`: supported on 0.71 and later |
| \`flex: 1\` | \`flex: 1\`. Same semantics, same failure mode |
| \`display: grid\` | **no equivalent.** See the grid rule |
| \`padding\`, \`margin\` | same names; shorthand arrays are supported |
| \`width\`, \`height\` | same; numbers are dp, so 1:1 with the design px |
| \`aspect-ratio\` | \`aspectRatio\`. Also the resize-safe choice |
| \`border-radius\` | \`borderRadius\`; per corner via \`borderTopLeftRadius\` etc. There is no shape token, so the theme must carry one: \`theme.shapes.medium\` |
| \`background-color\` | \`backgroundColor\` from a generated theme object |
| \`color\` | \`color\` on \`Text\` |
| \`box-shadow\` | **do not translate.** Map the declared elevation to \`shadow* + elevation\` (Android) or the platform shadow set, or to a background color step if the app uses tonal surfaces instead of shadows. Pick one strategy per project, state it in the config, and never mix |
| \`border\` | \`borderWidth\`, \`borderColor\`, plus \`borderStyle: "solid"\` which RN requires for iOS to draw it |
| \`opacity\` | \`opacity\` |
| \`overflow: hidden\` | \`overflow: "hidden"\`. Only hidden or visible; \`auto\` and \`scroll\` are not this property, they are \`ScrollView\` |
| \`overflow: auto\` / \`scroll\` | \`ScrollView\` (both axes with \`horizontal\`), or \`FlatList\` / \`SectionList\` when \`data-scroll=list\`, or \`FlashList\` if the project already uses it |
| \`-webkit-line-clamp\` | \`numberOfLines\` on \`Text\`, plus \`ellipsizeMode\` |
| \`white-space: nowrap\` | \`numberOfLines={1}\`; RN text does not wrap-truncate by default the same way |
| \`text-align\` | \`textAlign\` |
| \`text-transform: uppercase\` | \`textTransform: "uppercase"\`. RN has it, Compose does not: this is one of the few places RN is closer to CSS |
| \`letter-spacing\` | \`letterSpacing\` in dp, no em conversion |
| \`font-weight\` | a string like \`"500"\`. On iOS this needs the font to exist with that weight or it silently renders regular; flag every weight above 400 when no font is bundled |
| \`font-family\` | same caveat. Do not emit a family the project does not bundle |
| \`<svg>\` inline | \`react-native-svg\` \`<Svg><Path d fill />\`, with \`currentColor\` replaced by a theme color prop. If the project has no \`react-native-svg\`, emit an inline SVG-to-\`Image\` comment and a placeholder View, and record it as a blocker, not as working code |
| Icon set | recommend \`@expo/vector-icons\` MaterialCommunityIcons, or the project's own; the choice is configuration |
| \`hr\` divider | \`<View style={styles.divider} />\` with a hairline: use \`StyleSheet.hairlineWidth\`, not 1, or it looks thick on Android |
| Progress | \`ProgressViewAndroid\` on Android, or \`react-native-progress\`; the built-in is Android only, so say so |
| Spinner | \`ActivityIndicator\` |
| Chip | \`FilterChip\` from React Paper if the project uses Material, otherwise a composed \`Pressable\` plus the roles; the generated chip should say which it is |
| Switch | \`Switch\` with \`value\` and \`onValueChange\` |
| TextField | \`TextInput\`; a floating label and outline do not exist natively, so emit the box model by hand or point at Paper / UI Kitten and stop guessing |
| Touch target | \`Pressable\`; RN's minimum 44pt (iOS) and 48dp (Android) guidance becomes an explicit \`minHeight\` in the style |
| Safe area | **there is no \`env(safe-area-inset-*)\` in RN.** Compose gets insets through edge-to-edge; RN needs \`react-native-safe-area-context\` \`useSafeAreaInsets\`. If the design has top-bar padding that came from an inset, do not bake the number into the style; emit an inset hook plus a comment |
| \`hover\` | no equivalent on touch; use \`Pressable\` \`state.hovered\` only if the project targets web or desktop, and gate it |
| \`cursor: pointer\` | nothing on native; emit \`Pressable\` |

## The grid rule

CSS Grid has no Yoga equivalent and there is no honest translation. Options, in order of
preference, all of them configuration rather than a guess:

1. \`FlatList numColumns={N}\`: real recycling, but \`N\` is a static number while the design's grid is
   adaptive. Emit N from the captured column count at the captured width, with a comment that it is
   a fixed value derived from a responsive design, and a \`windowWidth\` based recalculation as the
   upgrade path.
2. \`FlashList numColumns\`: same shape, better performance, adds a dependency.
3. A wrapped \`flexWrap\` container with computed widths: closest to the design visually, no recycling,
   fine for under about 50 items.
4. Masonry: only if the design actually staggers.

Never emit a fake Grid component that pretends to be adaptive. A comment saying "the design is
adaptive, this is fixed at N columns" is worth more than clever code that quietly diverges at other
widths.

## Emission rules

- Function components with a props interface, \`React.FC\` avoided.
- \`StyleSheet.create\` at the bottom of the file, one key per node group, names derived from
  \`data-component\` and \`data-role\`.
- Colors and shapes come from a generated \`theme.ts\` (\`colors\`, \`spacing\`, \`shapes\`, \`typography\`), never
  inline in the component styles. That file is the RN mirror of Color.kt and Theme.kt, and it is the
  one file a designer can audit.
- Dark mode: RN has \`useColorScheme()\` plus the Appearance API. Emit \`theme.ts\` exporting both
  palettes and a \`useTheme()\` hook. There is no CSS media query here, so this is real code the emitter
  owns; keep it to about ten lines and no dependencies.
- No \`useState\`, no \`useEffect\`, no navigation, no data fetching. Callbacks are typed props with a
  default no-op only in the preview file, never on the public component.
- A \`Story\` or a sample screen file with the design's real content, mirroring the Compose preview rule.
- Every file ends with the diagnostics that touched it.

## What RN cannot represent, stated plainly

So the emitter refuses instead of faking:

- CSS Grid, as above.
- Aspect-driven intrinsic image sizing without explicit \`resizeMode\`.
- Blurs, \`backdrop-filter\`, \`clip-path\`, gradient backgrounds beyond \`LinearGradient\` via a dependency.
- Pseudo elements, unless converted into real nodes, which the contract forbids in the first place.
- Any layout that needs a measurement the design did not declare, such as a sticky header offset by a
  dynamic bar height.

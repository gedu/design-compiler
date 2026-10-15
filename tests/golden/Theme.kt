package com.callstack.minijetcaster.ui.generated

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp

// Generated from frame by tools/emit-compose.mjs. Do not edit by hand: the generator overwrites this file.
//
// The hand-written theme in com.callstack.minijetcaster.ui.theme is untouched and stays the app's theme. This one exists
// so the generated composables can be compiled and previewed on their own, in their own package,
// without a second declaration of Color/Theme colliding with the hand-written ones.
private val GeneratedLightScheme = lightColorScheme(
        primary = DesignColors.lightPrimary,
        onPrimary = DesignColors.lightOnPrimary,
        primaryContainer = DesignColors.lightPrimaryContainer,
        onPrimaryContainer = DesignColors.lightOnPrimaryContainer,
        secondary = DesignColors.lightSecondary,
        onSecondary = DesignColors.lightOnSecondary,
        secondaryContainer = DesignColors.lightSecondaryContainer,
        onSecondaryContainer = DesignColors.lightOnSecondaryContainer,
        tertiary = DesignColors.lightTertiary,
        onTertiary = DesignColors.lightOnTertiary,
        tertiaryContainer = DesignColors.lightTertiaryContainer,
        onTertiaryContainer = DesignColors.lightOnTertiaryContainer,
        error = DesignColors.lightError,
        onError = DesignColors.lightOnError,
        errorContainer = DesignColors.lightErrorContainer,
        onErrorContainer = DesignColors.lightOnErrorContainer,
        background = DesignColors.lightBackground,
        onBackground = DesignColors.lightOnBackground,
        surface = DesignColors.lightSurface,
        onSurface = DesignColors.lightOnSurface,
        surfaceVariant = DesignColors.lightSurfaceVariant,
        onSurfaceVariant = DesignColors.lightOnSurfaceVariant,
        surfaceContainerLowest = DesignColors.lightSurfaceContainerLowest,
        surfaceContainerLow = DesignColors.lightSurfaceContainerLow,
        surfaceContainer = DesignColors.lightSurfaceContainer,
        surfaceContainerHigh = DesignColors.lightSurfaceContainerHigh,
        surfaceContainerHighest = DesignColors.lightSurfaceContainerHighest,
        surfaceDim = DesignColors.lightSurfaceDim,
        surfaceBright = DesignColors.lightSurfaceBright,
        inverseSurface = DesignColors.lightInverseSurface,
        inverseOnSurface = DesignColors.lightInverseOnSurface,
        inversePrimary = DesignColors.lightInversePrimary,
        outline = DesignColors.lightOutline,
        outlineVariant = DesignColors.lightOutlineVariant,
)

private val GeneratedDarkScheme = darkColorScheme(
        primary = DesignColors.darkPrimary,
        onPrimary = DesignColors.darkOnPrimary,
        primaryContainer = DesignColors.darkPrimaryContainer,
        onPrimaryContainer = DesignColors.darkOnPrimaryContainer,
        secondary = DesignColors.darkSecondary,
        onSecondary = DesignColors.darkOnSecondary,
        secondaryContainer = DesignColors.darkSecondaryContainer,
        onSecondaryContainer = DesignColors.darkOnSecondaryContainer,
        tertiary = DesignColors.darkTertiary,
        onTertiary = DesignColors.darkOnTertiary,
        tertiaryContainer = DesignColors.darkTertiaryContainer,
        onTertiaryContainer = DesignColors.darkOnTertiaryContainer,
        error = DesignColors.darkError,
        onError = DesignColors.darkOnError,
        errorContainer = DesignColors.darkErrorContainer,
        onErrorContainer = DesignColors.darkOnErrorContainer,
        background = DesignColors.darkBackground,
        onBackground = DesignColors.darkOnBackground,
        surface = DesignColors.darkSurface,
        onSurface = DesignColors.darkOnSurface,
        surfaceVariant = DesignColors.darkSurfaceVariant,
        onSurfaceVariant = DesignColors.darkOnSurfaceVariant,
        surfaceContainerLowest = DesignColors.darkSurfaceContainerLowest,
        surfaceContainerLow = DesignColors.darkSurfaceContainerLow,
        surfaceContainer = DesignColors.darkSurfaceContainer,
        surfaceContainerHigh = DesignColors.darkSurfaceContainerHigh,
        surfaceContainerHighest = DesignColors.darkSurfaceContainerHighest,
        surfaceDim = DesignColors.darkSurfaceDim,
        surfaceBright = DesignColors.darkSurfaceBright,
        inverseSurface = DesignColors.darkInverseSurface,
        inverseOnSurface = DesignColors.darkInverseOnSurface,
        inversePrimary = DesignColors.darkInversePrimary,
        outline = DesignColors.darkOutline,
        outlineVariant = DesignColors.darkOutlineVariant,
)

// Shape steps read from tokens.json (extraSmall 4, small 8, medium 12, large 16, extraLarge 28), not assumed.
//
// tokens.json's "full" step is deliberately NOT passed: Shapes in the pinned material3 has no
// "full" parameter at all (its own source says "Shapes None and Full are omitted as None is a
// RectangleShape and Full is a CircleShape"), so a circle is written as CircleShape at the use site,
// which is where shapeExpr() already puts it. Passing full would be an unresolved parameter.
private val GeneratedShapes = Shapes(
    extraSmall = RoundedCornerShape(4.dp),
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

/**
 * The scheme this design produced, for the generated composables in com.callstack.minijetcaster.ui.generated.
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

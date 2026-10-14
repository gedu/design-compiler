package com.callstack.minijetcaster.ui.generated

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Terminal
import androidx.compose.material.icons.outlined.BookmarkAdd
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconToggleButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp

/**
 * Generated from frame PodcastCard.compact of Annotated.dc.html by tools/emit-compose.mjs. Do not edit by hand.
 *
 * Parameterless by contract (spec/04): no remember, no mutableStateOf, no ViewModel, no
 * LaunchedEffect. Where the design implies state it became a parameter or a TODO, and those TODOs
 * are the real output of this tool -- they are the list of decisions a human still has to make.
 *
 * Sizes are emitted where the design authored them and left to content where it did not: the frame
 * is 180x272 as measured, and spec/04 trap 5 forbids welding a captured
 * height onto a text node, because that is what breaks font scaling and desktop resize.
 */
@Composable
fun PodcastCard(
    category: String,
    title: String,
    author: String,
    subscribed: Boolean,
    onSelect: () -> Unit,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onSelect),
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
        // data-elevation 1, on the pinned ladder. spec/04 trap 4 asks for tonal;
        // CardDefaults.cardElevation in material3 1.12.0-alpha03 has no tonalElevation
        // parameter, so this is a shadow elevation. Never a value read off a box-shadow.
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Box(
                modifier = Modifier.fillMaxWidth().aspectRatio(1f).background(MaterialTheme.colorScheme.secondaryContainer, MaterialTheme.shapes.small),
            ) {
                Icon(
                    imageVector = Icons.Filled.Terminal,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSecondaryContainer,
                    modifier = Modifier.align(Alignment.Center),
                )
                // TODO: icon asset -- "terminal" is a Material Symbols glyph referenced by name
                //   (spec/04 trap 8; FILL 1 picked the Filled set).
                //   The name is only as good as the snake_case -> Filled mapping; the compiler is what
                //   proves it exists in the target's icon dependency.
                Text(
                    text = category,
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 8.dp).align(Alignment.BottomStart),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                )
            }
            Text(
                text = title,
                modifier = Modifier.padding(horizontal = 4.dp),
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = author,
                    modifier = Modifier.weight(1f).padding(start = 4.dp),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                IconToggleButton(
                    checked = subscribed,
                    onCheckedChange = { onToggle() },
                ) {
                    Box(
                        modifier = Modifier.size(40.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.BookmarkAdd,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        // TODO: icon asset -- "bookmark_add" is a Material Symbols glyph referenced by name
                        //   (spec/04 trap 8; FILL 0 picked the Outlined set).
                        //   The name is only as good as the snake_case -> Outlined mapping; the compiler is what
                        //   proves it exists in the target's icon dependency.
                    }
                }
            }
        }
    }
}

// The design's own sample values, from the data-props schema defaults (spec/04: FakeData, not
// inline, so the next agent deletes them in one move).
private object FakeData {
    const val Category = "Tech"
    const val Title = "Compiled Weekly"
    const val Author = "Ada Moreno"
    const val Subscribed = false
}

@Preview
@Composable
private fun PodcastCardPreview() {
    GeneratedTheme {
        PodcastCard(category = FakeData.Category, title = FakeData.Title, author = FakeData.Author, subscribed = FakeData.Subscribed, onSelect = {}, onToggle = {})
    }
}

// ---------------------------------------------------------------------------
// Diagnostics this file was written under (spec/04: a generated file that pretends to be certain is
// worse than one that shows its work).
// [info] color-ambiguous n:podcast-card-cover: #E8DEF8 is secondaryContainer (light), onSecondaryContainer (dark); emitted secondaryContainer by the documented order; the custom-property names the same role
// [info] color-ambiguous n:podcast-card-title: #1D1B20 is onSurface (light), onBackground (light), surfaceContainerLow (dark); emitted onSurface by the documented order; the custom-property names the same role
// [info] color-ambiguous n:author: #49454F is onSurfaceVariant (light), surfaceVariant (dark), outlineVariant (dark); emitted onSurfaceVariant by the documented order; the custom-property names the same role
// [info] color-ambiguous n:node-0-0-0-2-1-0: #49454F is onSurfaceVariant (light), surfaceVariant (dark), outlineVariant (dark); emitted onSurfaceVariant by the documented order; the custom-property names the same role
// [warn] callback-inferred n:podcast-card: a control carries no data-action, aria-label or title to name the callback from
//
// Callback pairing, with the evidence spec/02 demands (never an invented name):
//   onSelect <- n:podcast-card (declared control, click hole in template text)
//   onToggle <- n:podcast-card-subscribe-toggle (aria-label)
//
// Emission decisions taken from the IR, so the reading is checkable:
//   n:podcast-card-subscribe-toggle: aria-pressed driven by boolean "subscribed" becomes a checked parameter (spec/02)
//   n:node-0-0-0-2-1-0: declares CircleShape but paints no background in the captured state; nothing emitted to round -- the shape belongs to a hover/selected state (spec/02 states), which is a TODO, not a guess
//   n:podcast-card-cover: aspectRatio(1f) kept and the measured height 160 dropped (spec/04 trap 7)
//   n:node-0-0-0-2: CSS margin -4px top is NOT emitted -- Compose rejects negative padding (measured on-device: IllegalArgumentException "Padding must be non-negative" from PaddingElement, the app dies on launch). The edge is dropped, not guessed, so the box is smaller than the design drew (measured on this fixture: the card renders 264dp inside a 272dp frame). How to cancel that line-height slack WITHOUT a negative padding is a mapping decision spec/04 does not make yet: TODO for a human, never a value invented here.
//   n:podcast-card-subscribe-toggle: IconToggleButton already implies the authored 48dp target (pinned KDoc), so no size is emitted (spec/04)
//   n:podcast-card-subscribe-toggle: CSS margin -4px top, -4px right, -4px bottom is NOT emitted -- Compose rejects negative padding (measured on-device: IllegalArgumentException "Padding must be non-negative" from PaddingElement, the app dies on launch). The edge is dropped, not guessed, so the box is smaller than the design drew (measured on this fixture: the card renders 264dp inside a 272dp frame). How to cancel that line-height slack WITHOUT a negative padding is a mapping decision spec/04 does not make yet: TODO for a human, never a value invented here.

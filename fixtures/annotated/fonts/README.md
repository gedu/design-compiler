# fonts/

The two webfaces this fixture needs, copied out of `.vendor/fonts/` (the bytes
`tools/vendor.mjs` pinned in `.vendor/vendor-lock.json`) and pointed at by the
`@font-face` rules inlined in `Annotated.dc.html`.

The reference export asks for these faces from `fonts.googleapis.com` inside its
`<helmet>`. That cannot stay here: the vendor router aborts any request that is
not loopback and not pinned, and `css-inline-no-external` plus
`no-remote-links-emitted` both call a remote stylesheet an error. So the fixture
carries the same bytes locally and the runtime never reaches the network.

Only the `latin` subset of each face is copied. Every character this card draws
is in it, and the card draws no other text. The files are binaries, so they are
never opened by a check that requires ASCII.

| file | face | source in `.vendor/` |
| --- | --- | --- |
| `KFO7CnqEu92Fr1ME7kSn66aGLdTylUAMa3yUBHMdazQ.woff2` | Roboto 400 and 500 (variable weight axis) | `roboto.css`, latin block |
| `kJF4BvYX7BgnkSrUwT8OhrdQw4oELdPIeeII9v6oDMzBwG-RpA6RzaxHMPdY40KH8nGzv3fzfVJU22ZZLsYEpzC_1ver5Y0J1Llf.woff2` | Material Symbols Outlined | `material-symbols-outlined.css` |

---
"@crustjs/style": patch
---

Align the Node/Deno `stringWidth` fallback with `Bun.stringWidth` on common terminal text: escape sequences are consumed the way Bun does (colon-parameter SGR, incomplete trailing CSI, unterminated OSC, DCS/PM/APC strings and two-byte ESC sequences no longer count as columns, and ESC followed by CAN/SUB/ST does not split emoji clusters), a lone regional indicator measures one column, conjoining Hangul jamo medials/finals are zero-width, and a cluster led by a prepend/format mark (`"\u0600a"`) keeps its base's width. Padding, tables and prompt line counts on Node and Deno now render like Bun for these inputs.

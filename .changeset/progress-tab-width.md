---
"@crustjs/progress": patch
---

A spinner or progress message with a tab is cut to fit the terminal's row. The tab was counted as no columns, so a tabbed message could wrap and leave a stale copy on every redraw.

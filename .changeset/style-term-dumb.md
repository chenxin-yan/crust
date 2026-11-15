---
"@crustjs/style": patch
---

`@crustjs/style` treats `TERM=dumb` as no ANSI support, like Node's `tty` color detection.

**Behavior change:** on a terminal with `TERM=dumb`, modifiers (`bold`, links) are no longer emitted, and `COLORTERM=truecolor` no longer turns colors on. `FORCE_COLOR` still forces escape codes.

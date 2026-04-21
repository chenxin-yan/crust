---
"@crustjs/style": patch
---

Add OSC 8 hyperlink styling primitives to `@crustjs/style` via `linkCode()`, `link()`, and `style.link()`, so CLIs can emit clickable terminal links instead of only visually styled link text.

Hyperlinks now follow the package's mode-aware runtime behaviour: they emit in `always` mode, emit in `auto` mode when stdout is a TTY, and return plain text in `never` mode. The package docs now also explain how OSC 8 link emission relates to the markdown theme's visual link slots.

---
"@crustjs/style": minor
"@crustjs/extensions": patch
"@crustjs/store": patch
"@crustjs/core": patch
"@crustjs/man": patch
"@crustjs/testing": patch
"@crustjs/prompts": patch
"@crustjs/skills": patch
"@crustjs/crust": patch
"@crustjs/create": patch
---

Make package runtime code portable across Bun, Deno, and Node by replacing Bun globals with Node-compatible built-ins and shared utilities. Skills now reads `name`/`description` frontmatter with a minimal in-package scanner (no YAML dependency), and process spawning uses `node:child_process`.

**Breaking (pre-1.0):** `@crustjs/style` color input is narrowed to three- and six-digit hex, integer RGB triples (`rgb(r, g, b)` strings or `[r, g, b]` arrays), and the 148 named CSS colors. Other CSS notation (hsl, lab, color-mix, …), alpha forms, packed numbers, and channel objects are no longer accepted. The package also exports the portable `stringWidth` helper.

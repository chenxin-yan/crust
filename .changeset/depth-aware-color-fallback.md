---
"@crustjs/style": patch
---

**Depth-aware color fallback for `fg` / `bg`.**

`fg` / `bg` now automatically downgrade to `ansi-256` or `ansi-16`
sequences when the terminal does not support truecolor, instead of
emitting 24-bit `ansi-16m` unconditionally. No public API surface
changes — only the *output* changes based on the resolved capability.

### Detection

Detection follows the existing `NO_COLOR` / `COLORTERM` / `TERM`
conventions; no new environment variables are introduced:

| Resolved depth | Detection (in `"auto"` mode) |
| --- | --- |
| `"truecolor"` | `COLORTERM=truecolor\|24bit`, or `TERM` contains `truecolor`/`24bit`/ends with `-direct` |
| `"256"` | `TERM` contains `256color` |
| `"16"` | Any other TTY value |
| `"none"` | Not a TTY, `NO_COLOR=1`, `TERM=dumb`, or `mode === "never"` |

### Gating

- Standalone `fg` / `bg` resolve depth on every call through the runtime
  `style` facade, so `setGlobalColorMode("never")` and `NO_COLOR=1`
  continue to gate emission as before.
- `style.fg` / `style.bg` on instances created by `createStyle()` capture
  the depth at construction time (consistent with how `mode` is locked).
- Invalid color inputs still raise `TypeError` at every depth — including
  `"none"` — so user bugs are not silently masked when colors are off.

### Added

- `resolveColorDepth(mode, overrides?)` — resolves a `ColorDepth` tier
  (`"truecolor" | "256" | "16" | "none"`) for any color emission decision.
- `ColorDepth` type — re-exported from `@crustjs/style`.
- `colorDepth` introspection property on `StyleInstance` (and on the
  default `style` facade). `trueColorEnabled` is retained for backward
  compatibility and equals `colorDepth === "truecolor"`.

### Compatibility

- `resolveColorCapability` and `resolveTrueColorCapability` keep their
  current signatures and behavior; they are now thin wrappers over
  `resolveColorDepth`.
- `fgCode` / `bgCode` `AnsiPair` factories continue to emit deterministic
  `ansi-16m` sequences. They are primitives for `composeStyles`; runtime
  capability gating happens at apply time.
- Foreground → background sequences continue to work via the `\x1b[38;`
  → `\x1b[48;` SGR introducer swap at every depth.

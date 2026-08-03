---
"@crustjs/style": minor
"@crustjs/extensions": minor
---

Replace the bespoke global color knob with the standard environment variables:

- `@crustjs/style`: `setGlobalColorMode` / `getGlobalColorMode` removed. The default `style` facade and top-level helpers re-resolve `NO_COLOR` / `FORCE_COLOR` / TTY on every call — set those variables instead. This also removes the word-collision where facade-`"never"` and `createStyle({ mode: "never" })` meant different things: `ColorMode` is now purely an instance concept (`"never"` = all ANSI off), while the environment is the global channel (`NO_COLOR` = colors off per no-color.org, `FORCE_COLOR` = the all-ANSI switch).
- `@crustjs/style`: capability detection now honors `FORCE_COLOR` (chalk convention): `0`/`false` force all ANSI off; `1`/`2`/`3` force color at 16/256/truecolor depth; other values force on at the detected depth. `FORCE_COLOR` takes precedence over `NO_COLOR` and TTY. `CapabilityOverrides` gains `forceColor`.
- `@crustjs/extensions`: `noColor()` now scopes `FORCE_COLOR`/`NO_COLOR` around command execution instead of calling the removed knob — `--color` sets `FORCE_COLOR=3` (clearing `NO_COLOR` so strict no-color.org-only child processes also comply), `--no-color` sets `NO_COLOR=1` (clearing `FORCE_COLOR`), restoring prior values after the run. The flag now also affects child processes and other `FORCE_COLOR`-aware libraries. Note: `--no-color` with piped output is now fully plain — previously modifiers/hyperlinks could still be emitted off-TTY.

---
"@crustjs/plugins": minor
"@crustjs/style": minor
---

Add NO_COLOR-aligned runtime color control.

`@crustjs/style` now disables colors, but not non-color modifiers, when `NO_COLOR` is set to a non-empty value or when output is non-interactive in auto mode. The default exports also support runtime color overrides via `setGlobalColorMode()` and `getGlobalColorMode()`.

`@crustjs/plugins` now includes `noColorPlugin()`, which adds `--color` and `--no-color` to a Crust CLI and applies the override for the current run.

**Breaking:** The capability resolver exports have been renamed for symmetry with the new `resolveModifierCapability`:

- `resolveCapability` → `resolveColorCapability`
- `resolveTrueColor` → `resolveTrueColorCapability`

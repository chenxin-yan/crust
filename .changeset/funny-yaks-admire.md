---
"@crustjs/validate": patch
---

Align Zod and Effect flag definitions with core `FlagDefBase` by adding `inherit` support to the exported types and `flag()` helpers.

This makes `flag(..., { inherit: true })` behave consistently across validate and core, preserving inherited flag metadata for subcommands.

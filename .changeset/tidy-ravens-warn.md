---
"@crustjs/core": patch
"@crustjs/crust": patch
---

Add opt-in runtime diagnostics for command token reuse outside sibling subcommand namespaces.

Programmatic validation can now call `prepareCommandTree({ aliasDiagnostics: "warn" | "strict" })`, and `crust build` exposes the same check through `--alias-diagnostics=off|warn|strict`.

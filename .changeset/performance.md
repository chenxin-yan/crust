---
"@crustjs/core": patch
"@crustjs/extensions": patch
"@crustjs/skills": patch
"@crustjs/store": patch
---

Faster startup and type-checking.

- Core reuses its prepared invocation tree across repeated dispatches, and skill implementation modules are deferred until first use. Extension command recipes materialize once per builder instance instead of on every run — recipes must stay inert, per the documented contract.
- Long `.flags()` chains hit `TS2589` about 3x later, the `.provide()` chain ceiling is removed, and `ctx` inference no longer silently degrades on long `.provide()` chains.

---
"@crustjs/core": patch
---

Commands whose action always throws no longer fail type-checking when the app or recipe provides Contexts. This affected projects that type-check against the source, such as monorepo setups.

The published types now reject assigning a builder with unmet Extension or Context demands where a satisfied builder is expected, matching type-checking against source. Previously the installed package accepted such assignments because the proof type was missing from its declarations.

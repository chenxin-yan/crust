---
"@crustjs/core": minor
"@crustjs/testing": minor
---

Add property-based input round-trip testing. `@crustjs/testing` exports `fuzzRoundTrip(app, path, options?)`, which derives deterministic generators from a command's snapshot, binds each generated structured input and its argv spelling through the production parser, and fails with the seed and case when the bound values diverge; Command Actions, Extension hooks, and Contexts never run. `@crustjs/core/tooling` gains the parse-only `bindInput(app, input)` and `customBindings(app, path)` helpers (with `BindInput`, `BoundInput`, and `CustomBindings` types) that back it.

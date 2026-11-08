---
"@crustjs/core": minor
---

Add `ExtensionContext.sources`, reporting where each argument's and flag's current value came from as a `ValueSource` (`"argv"`, `"run"`, `"env"`, `"bound"`, or `"default"`), keyed by argument name and canonical flag name; names without a value are absent. `sources.raw` is `"argv"`, `"run"`, or `"bound"` when passthrough tokens came from argv, typed `run()`, or `bindInput`. It reads live, so after `bindInput` the keys it supplied report `"bound"`. Extensions that convert structured input before `bindInput` use it to skip keys argv gave. `ValueSource` is exported from `@crustjs/core`.

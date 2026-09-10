---
"@crustjs/core": minor
"@crustjs/extensions": patch
"@crustjs/skills": patch
"@crustjs/man": patch
---

Automatically validate observable constraints at authoring, attachment, deferred definition consumption, and invocation. Remove the `runtime(value)` / `RuntimeInput` checking switch without compatibility aliases. Dynamic names and collections use the same APIs; spread collections into variadic builder methods. Consume deferred Extension factory/section results when produced and verify declared Context availability without constructing Contexts.

Keep known invocation contracts strict: literal choices, required fields, supplied positional prefixes, nonempty required variadics, value kinds, and command paths retain compile-time checking. Fresh object literals reject typo keys alongside valid required fields; standard structural assignability still permits extra keys on predeclared objects, but automatic binding rejects actual unknown keys before the action. Schemas and custom parsers retain raw input contracts independently of their action output types.

A bare `Crust` has an empty argument tuple. Prefer inferred authoring builders; `AnyCrust` is a completed-app inspection/invocation view with broad input and an unknown action result, not authoring authority. Dynamic/open shapes retain independently known fields, and uncertain unions retain conservative obligations. Broad string names work without wrappers; known-invalid union members remain rejected.

Own normalized structural definition arrays without cloning JSON, URL, schema, callback, or Context-option payloads. Preserve Context/Extension defining data through structural copies, lazy setup, once-per-invocation resolution, replacement ordering, preRun/finish ordering, and cleanup. Keep static duplicate checks that protect earlier typed consumers; supported dynamic replacements retain last-write-wins. Supplied removed flag keys fail binding, but omitting a retired defaulted flag can still leave an earlier action observing undefined.

Preserve TypeScript-owned metadata, dependency, and callback-value demands, including conditional/nested providers used by descendant hooks. Recipe-local duplicate Context checks use actual local providers rather than inherited/demanded names, allowing compatible local provisioning while rejecting incompatible values and repeated local providers. Preserve precise static Extension contributions and migrate configurable Completion/Skills callers to ordinary composition.

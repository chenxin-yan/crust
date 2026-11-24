---
"@crustjs/effect": minor
---

**Breaking:** `service(factory)` inside `handler()` is now a compile error when the command's `ctx` has no Context of that name and value type. It used to compile and fail every run with `No matching provider for Context "…"`. Its Effect requires a new exported type, `ContextService<Name, Value>`, beside `HandlerInput`, and `ServicesOf<Input>` includes one per Context in `ctx`; a reusable program annotated with only `HandlerInput` must add it. A `handler()` defined outside `.action()` must annotate its input with the Contexts it pulls, for example `(input: CrustCommandContext<any, any, { config: Config }>)`; unannotated, its `service()` calls no longer compile. A Context whose value is `never` (a setup that only throws) or `any` no longer lets a `handler()` program require any Effect service; such a program compiled and failed at run time with `Service not found`.

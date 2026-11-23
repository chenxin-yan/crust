---
"@crustjs/effect": minor
---

**Breaking:** `service(factory)` inside `handler()` is now a compile error when the command's `ctx` has no Context of that name and value type. It used to compile and fail every run with `No matching provider for Context "…"`. Its Effect requires a new exported type, `ContextService<Name, Value>`, beside `HandlerInput`, and `ServicesOf<Input>` includes one per Context in `ctx`; a reusable program annotated with only `HandlerInput` must add it.

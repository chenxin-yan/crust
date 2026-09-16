---
"@crustjs/effect": patch
---

Add `@crustjs/effect`, an Effect.ts v4 adaptor for Crust.

- `layer(name, layer)` turns one fully composed Layer into an ordinary Crust Context. The Layer is built in a fresh Scope and closed by Crust's reverse-order invocation cleanup, handing finalizers the handler's `Exit`.
- `handler(fn)` adapts an Effect-returning function or a generator (`function*`) to a Command Action. Every `layer()` on the command path is built up front and its services provided, with requirements checked at compile time; failures rethrow the original error so `execute()` rendering is unchanged, and interruption maps to Crust's `AbortError` cancellation path.
- `service(factory)` pulls a plain Crust Context lazily from inside a handler program.
- Tagged errors `CrustDefinitionError`, `CrustValidationError`, `CrustParseError`, and `CrustCommandNotFoundError` wrap the Core error codes for `Effect.catchTag`, plus `fromCrustError` and `tryCrust`. Prompt cancellation (`AbortError`) becomes Effect interruption.

`effect` 4.x prerelease is a peer dependency; the package publishes under the `next` dist-tag.

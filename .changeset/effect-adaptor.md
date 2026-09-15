---
"@crustjs/effect": minor
---

Add `@crustjs/effect`, an Effect.ts v4 adaptor for Crust.

- `effectAction(contexts?, fn)` adapts an Effect-returning function to a Command Action. Services from the listed Effect Contexts are pulled from `ctx` and provided; failures rethrow the original error so `execute()` rendering is unchanged, and interruption maps to Crust's `AbortError` cancellation path.
- `effectContext(name, layer)` turns one composed Layer into a Crust Context. The Layer is built in a fresh Scope at first pull and closed by Crust's reverse-order invocation cleanup, handing finalizers the action's `Exit`.
- Tagged errors `CrustDefinitionError`, `CrustValidationError`, `CrustParseError`, and `CrustCommandNotFoundError` wrap the Core error codes for `Effect.catchTag`, plus `fromCrustError`, `tryCrust`, and `runEffect` helpers. Prompt cancellation (`AbortError`) becomes Effect interruption.

`effect` 4.x prerelease is a peer dependency; the package publishes under the `next` dist-tag.

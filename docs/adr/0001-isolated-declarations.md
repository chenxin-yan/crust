# ADR 0001: Keep isolated declarations for package builds

Status: accepted

## Context

Packages publish bundled declarations built by tsdown. The private, unpublished
`@crustjs/utils` sources must be inlined into each consuming package's `.d.ts`,
not left as imports; root `tsdown.config.ts` enforces this through `deps.onlyImport`.

With `isolatedDeclarations: true`, tsdown emits declarations per file through
oxc-transform, including those private sources. Disabling the flag switches to
the tsgo program-based fallback, which fails on both core and store with
`tsgo did not generate dts file for packages/utils/src/*.ts`.

The observed TS7 per-package timings were 88ms with isolated declarations versus
137ms without. Speed is secondary to successfully bundling private declarations.

## Decision

Keep `isolatedDeclarations: true` in `packages/config/tsconfig.base.json`.
Keep the existing crust/create-crust opt-outs: those CLI packages publish no types.

## Consequences

Exported call-initialized values need explicit annotations (`export const x: T = call()`).
This annotation tax affects 42 sites at the time of this decision, including the
official Extension factories, which use `ExtensionFactory<Args>` to preserve their
published signatures without exposing private constructor functions.

Authors not using isolated declarations can omit those annotations and retain
full inference. Reconsider the flag if tsdown's program-based emitter can reliably
bundle unpublished workspace sources; removing annotations alone is not sufficient.

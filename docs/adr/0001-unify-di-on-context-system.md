# 0001: Unify dependency injection on the Context system

- Status: Accepted
- Date: 2026-03-11
- Issue: [#254](https://github.com/chenxin-yan/crust/issues/254)

## Context

Commands previously declared `requires` in `defineCommand` metadata to receive a typed value bag. This added ceremony and coupled a reusable command definition to the application that later installs it. Extensions had no dependency-injection mechanism at all, so sharing relied on factory closures, module state, or `WeakMap` state.

Command `requires` provided typed values, add/materialization-time wiring checks, and lazy scoped construction. Pull-based resolution can preserve typing and laziness, but cannot statically prove that a later application supplies a provider without restoring a declaration.

## Decision

`.provide()` and `await ctx.use(factory)` are the single dependency-injection API for command actions and extension hooks. A `ContextFactory` is both the type source and collision-free token; there is no separate token registry.

Resolution is asynchronous and lazy. The first pull constructs the provided Context, recursively constructs its declared Context dependencies, and memoizes the in-flight promise for the invocation. Constructed disposable values are registered on the invocation's `AsyncDisposableStack`.

Command-level `requires` is removed rather than deprecated because the project is pre-1.0. Context-level `requires` remains: it declares dependencies used by a Context's setup function.

Extensions may declare `provides: [instance]`. Calling `.extend()` installs those instances on the application root through the same collision and flag validation used by `.provide()`. Extension hooks receive the same typed `use()` function as command actions. `factory.of(fake)` remains the test-double seam.

A missing provider fails when pulled with a `CrustError` whose reason is `missing-context` and whose message identifies the Context and recommends `.provide()`.

### Lifecycle

`preRun` executes before flag validation. It may pull flagless Contexts, but pulling a Context that owns flags, directly or through its dependency closure, throws a `CrustError` with reason `flags-before-validation`. The same restriction applies in `postRun` after `ctx.finish()`, because finishing deliberately skips validation. Validating individual slices on demand was rejected because it introduces partial and repeated validation semantics.

The invocation disposal scope extends through `postRun`. This lets post-run hooks pull services and lets them reuse live values pulled by actions. Contexts are disposed in reverse construction order after all post-run hooks, on success and failure. `onError` rendering happens after disposal and cannot pull Contexts. Prohibiting post-run pulls was rejected because outcome logging and telemetry flushes are primary extension use cases.

## Consequences

- Consumers infer a Context value from the factory passed to `use()` with no command metadata.
- Unused providers have no setup cost or side effects.
- Concurrent and repeated pulls construct once per invocation.
- The previous add/materialization-time wiring check is lost; missing providers fail at the pull site. A future `crust build` wiring check may mitigate this without restoring runtime declarations.
- Context teardown occurs after `postRun`, later than before this decision.
- Applications migrate by deleting command `requires`, replacing `ctx.name` with `await ctx.use(factory)`, and ensuring the containing callback is async.

## Alternatives considered

A synchronous `use()` would require eager construction because Context setup is awaitable, so it was rejected. Fastify-style decoration and Hono-style string-key variables provide weaker cross-extension typing. A Nest-style token container duplicates `ContextFactory`; decorators and reflection do not fit a Bun CLI library. Effect Layers would import a new runtime model. Existing CLI libraries such as citty, cac, stricli, and clerc do not supply a better plugin DI model; oclif hooks likewise do not solve typed service injection.

# ADR 0001: Declared lazy Context bags

Status: accepted

## Context

PR #263 unified dependency access on `await ctx.use(factory)`. That kept construction lazy and made each access locally typed, but TypeScript cannot infer calls made inside a callback body into the callback owner's public type. Consequently a Context, reusable command, or Extension did not carry its dependency set, and missing providers could only fail during an invocation.

We want wiring errors before execution without making Context construction eager. The dependency set must therefore appear in the type of every reusable unit.

## Decision

Contexts, reusable command definitions, and Extensions declare consumed Context factories with `uses: [factory, ...]`.

All consumers receive the same `ctx` shape: a readonly bag whose keys are Context names and whose values are promises. Consumers access a dependency with `await ctx.name`. Reading a property starts lazy, memoized construction; repeated and concurrent reads share the same promise.

- Context setup receives exactly its declared dependency closure.
- A command definition's action receives its declared dependencies plus Contexts provided on its own builder.
- Extension hooks receive exactly the Extension's declared dependencies.
- Root actions receive the Contexts accumulated by `.provide()` and Extension `provides`.
- `.provide()`, `.add()`, and `.extend()` validate dependency closure at the type level and mirror the check at definition/build time.
- Dependencies in one `.provide()` or `.extend()` batch are order-independent. Across fluent calls, providers precede consumers so each composition call can be checked locally.
- `factory.of(value)` carries no dependencies, allowing a double to replace a graph node.

The public `ContextResolver` and `ctx.use()` API are removed. The internal resolver remains responsible for memoization, dynamic-cycle protection for untyped inputs, flag-phase errors, settlement, and reverse-construction-order disposal.

## Consequences

Dependency contracts are visible in declarations and cannot drift: undeclared property access is a type error, while unsatisfied declarations fail at the composition site. The same declaration supports snapshot/build validation for JavaScript and dynamically assembled inputs.

Construction remains lazy, but property access has an effect. Destructuring `ctx` reads the selected properties immediately and therefore starts those Contexts; documentation calls this out as “destructure = eager.” Context names that are not identifier-safe use bracket access, for example `await ctx["remote-config"]`.

Reusable nested definitions may repeat an inherited dependency in their own `uses` contract. This is intentional: every sealed definition remains independently checkable, and `.add()` errors stay local rather than being deferred to execution.

---
"@crustjs/core": minor
"@crustjs/extensions": minor
"@crustjs/crust": minor
"create-crust": minor
"@crustjs/man": minor
"@crustjs/skills": minor
---

Ship the 0.2 API revamp for the framework spine (see `docs/adr/0001`–`0009`):

- Extensions replace plugins: `@crustjs/extensions` package, `defineExtension(name, config)` plain frozen configs with `intercept(ctx, next)` and `handleError` presentation chain; `.use()` removed.
- Contexts are command dependencies: `defineContext(name, config?, setup)` always returns a factory, attached with the variadic `.provide(...)`, constructed topologically by declared `requires` dependencies (values arrive via `ctx`), and disposed via native `Symbol.dispose`/`Symbol.asyncDispose` in reverse construction order.
- `.action(action)` defines the Command Action; `.run(argv, { stdout, stderr })` throws for programmatic embedding; `.execute()` renders and sets `process.exitCode`. `preRun`/`postRun` removed.
- `CrustError` keeps four stable codes (`DEFINITION`, `PARSE`, `VALIDATION`, `COMMAND_NOT_FOUND`); `_tag`, `CONFIG`, and `EXECUTION` removed; action and Context errors pass through unwrapped.
- Standard Schema supported directly on arg/flag definitions; `@crustjs/validate` removed.
- Public `CommandNode`/`prepareCommandTree()` removed; serializable Command Snapshots cross public boundaries; man/crust/skills consume the unsupported `@crustjs/core/tooling` subpath.
- `create-crust` ships a single minimal template.

This is a hard cut from the 0.1 API with no compatibility shims; each removed name's replacement is listed above.

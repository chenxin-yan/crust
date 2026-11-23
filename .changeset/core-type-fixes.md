---
"@crustjs/core": minor
"@crustjs/testing": minor
"@crustjs/openapi": minor
---

Types that match what runs, test doubles that fit where the real Context goes, and `{ provide }` to swap a Context for one invocation. See [Replace a Context in tests](https://crustjs.com/docs/guide/contexts#replace-a-context-in-tests). **Breaking:** an `async` action that returns a generator no longer streams, hook `flags` lose their catch-all index signature, `.as(name)` drops the original's aliases, and an `api --paginate --json` call of `@crustjs/openapi` prints one array.

- **Breaking:** an action streams events only when it returns an async generator, as an `async function*` does, and its type says so. Any other value, including a promise of a generator or another async iterable, is its result and is never drained. Write `async () => watch()` as `async function* () { return yield* watch(); }`.
- An async `onEvent` is awaited: the action resumes once its promise resolves, and a rejection fails the invocation.
- `factory.of(value)` is assignable wherever the factory's instance is (`ReturnType<typeof engine>`), and demands nothing: `new Crust("mono").provide(workspace.of(fake)).add(list)` no longer asks for the Contexts the real `workspace` setup reads, at compile time or when the app prepares.
- New `provide` option on `run()`, `execute()`, and `@crustjs/testing`'s `captureExecute()` and `runInteractive()`: Context instances that replace the app's same-name Contexts for that invocation, `app.run(["ps"], {}, { provide: [engine.of(fakeEngine)] })`. `run()` and the testing helpers type it against the Contexts the app provides at its root. New exported types `ContextReplacement` (core) and `ProvideOption` (testing).
- **Breaking:** hook `ctx.flags` types the flags the Extension owns and those of the Contexts its hooks `.use()`, each possibly `undefined`; the catch-all index signature is gone, so a typo is a compile error. Read another command's flag with a cast. In `onError` every flag is optional.
- `setup`, `renderer`, flag handlers, and `preRun` leave out of `ctx` the Contexts that own flags or use one that does, since reading them there rejects unless their setup catches the failure.
- Inline `.command()` children, at any depth, see the recursive Extension flags registered before them in their action's `flags` type.
- A required `multiple` flag without a default is `[T, ...T[]]` in the action and in typed input, like a required variadic argument. Typed input takes readonly arrays for `multiple` flags and variadic arguments.
- A `choices` list built at runtime (`readonly Template[]`) types the input as its element type instead of rejecting every value.
- An alias list known only at runtime no longer opens every typed path to any string; such aliases are no typed path, so use the command's name.
- **Breaking:** `definition.as(name)` returns the copy without the original's aliases.
- Registering a literal Extension id again in a later `.extend()` call removes the flags only the earlier registration contributed from every typed view, as the runtime does. `defineExtensionId()` keeps its literal: `ExtensionId<"acme:preview">`.
- `InferFlags` and `InferArgs` are exported.
- Clearer diagnostics: `.use()` on an app says to `.provide()`; `parse` on a non-string flag says it is for string flags; a missing Context mentions `.extend()`ing the Extension that provides it; a flag collision names the Context or Extension that owns each flag (`Flag "conn" of Context "cache" collides with existing flag "conn" of Context "db" on command "sub"`); and the published `.d.ts` files keep readable type names instead of one-letter aliases.
- `@crustjs/openapi`: **Breaking:** `api <path> --paginate --json` prints every page body in one JSON array, like `gh api --paginate --slurp`, instead of NDJSON events.

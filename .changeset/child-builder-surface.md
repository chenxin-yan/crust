---
"@crustjs/core": minor
"@crustjs/crust": patch
---

Add inert reusable command definitions with `defineCommand<Requirements>(configure)` and checked mounting with `.mount(name, definition)`.

Definitions declare the inherited flags and Context value types they require. Missing or incompatible requirements now fail at the `.mount()` call, including same-named flags that do not use `inherit: true`. Every mount materializes a fresh command under the explicit name, so one definition can be reused under multiple names, across multiple parents, and inside other definitions.

Remove `.sub()`, `.command(builder)`, and the exported `ChildCrust` type. Inline `.command(name, callback)` remains as the convenient spelling for one-off commands and uses the same materialization behavior.

Migration:

```ts
// Before
const deploy = parent.sub("deploy").handle(({ flags, ctx }) => {});
const app = parent.command(deploy);

// After
const deploy = defineCommand<{
  flags: { verbose: typeof verbose };
  ctx: { auth: Auth };
}>((command) => command.handle(({ flags, ctx }) => {}));

const app = parent.mount("deploy", deploy);
```

Finalize required inheritable flags and Contexts on the parent builder before `.mount()`. Extension-contributed commands are unchanged.

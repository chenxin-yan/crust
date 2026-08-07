---
"@crustjs/core": minor
"@crustjs/crust": patch
---

Add inert reusable command definitions with `defineCommand(name, requirements?, recipe)` and checked mounting with the variadic `.mount(...definitions)`.

A definition carries its own name and declares what it needs from its mount site as value arrays: `requires.flags` (named flag definitions it expects to inherit) and `requires.ctx` (Context factories whose instances must be provided on the parent path). Every requirement is checked at the `.mount()` call — compile-time for missing/incompatible inherited flags and Contexts, and at runtime for Context requirement names missing from the parent path. Every mount materializes a fresh command under the definition's carried name; use `.as(newName)` to mount one definition under multiple names or parents, and definitions can `.mount()` other definitions.

Remove `.sub()`, `.command(name, callback)`, `.command(builder)`, and the exported `ChildCrust` type. One-off inline commands are `.mount(defineCommand("up", (command) => ...))`.

Migration:

```ts
// Before
const deploy = parent.sub("deploy").handle(({ flags, ctx }) => {});
const app = parent.command(deploy);

// After
const verbose = defineFlag("verbose", { type: "boolean" });
const logging = defineContext("logging", { flags: [verbose] }, ({ flags }) => flags);
const auth = defineContext("auth", () => createAuthClient());

const deploy = defineCommand("deploy", { requires: { flags: [verbose], ctx: [auth] } }, (command) =>
	command.handle(({ flags, ctx }) => {}),
);

const app = parent.provide(logging(), auth()).mount(deploy);
const shipToo = parent.mount(deploy.as("ship"));
```

Provide Contexts (including any whose owned flags a definition requires) with `.provide()` on the parent builder before `.mount()`. Extension-contributed commands are unchanged.

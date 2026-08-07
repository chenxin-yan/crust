---
"@crustjs/core": minor
"@crustjs/crust": patch
---

Add inert reusable command definitions with `defineCommand(name, requirements?, recipe)` and checked mounting with the variadic `.mount(...definitions)`.

A definition carries its own name and lists the Context capabilities it needs from its mount site in a plain `requires` array. Every requirement is checked at the `.mount()` call — compile-time for missing or incompatible Context values, and at runtime for required Context names missing from the parent path. Every mount materializes a fresh command under the definition's carried name; use `.as(newName)` to mount one definition under multiple names or parents, and definitions can `.mount()` other definitions.

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

const deploy = defineCommand("deploy", { requires: [logging, auth] }, (command) =>
	command.handle(({ ctx }) => {}),
);

const app = parent.provide(logging(), auth()).mount(deploy);
const shipToo = parent.mount(deploy.as("ship"));
```

Provide required Context capabilities with `.provide()` on the parent builder before `.mount()`. Extension-contributed commands are unchanged.

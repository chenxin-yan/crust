---
"@crustjs/core": minor
"@crustjs/crust": patch
---

Add inert reusable command definitions with `defineCommand(name, requirements?, recipe)` and checked attachment with the variadic `.add(...definitions)`.

A definition carries its own name and lists the Context capabilities it needs from its parent in a plain `requires` array. Every requirement is checked at the `.add()` call — compile-time for missing or incompatible Context values, and at runtime for required Context names missing from the parent path. Every `.add()` materializes a fresh command under the definition's carried name; use `.as(newName)` to add one definition under multiple names or parents, and definitions can `.add()` other definitions.

Remove `.sub()`, `.command(name, callback)`, `.command(builder)`, and the exported `ChildCrust` type. One-off inline commands are `.add(defineCommand("up", (command) => ...))`.

Migration:

```ts
// Before
const deploy = parent.sub("deploy").action(({ flags, ctx }) => {});
const app = parent.command(deploy);

// After
const verbose = defineFlag("verbose", { type: "boolean" });
const logging = defineContext("logging", { flags: [verbose] }, ({ flags }) => flags);
const auth = defineContext("auth", () => createAuthClient());

const deploy = defineCommand("deploy", { requires: [logging, auth] }, (command) =>
	command.action(({ ctx }) => {}),
);

const app = parent.provide(logging(), auth()).add(deploy);
const shipToo = parent.add(deploy.as("ship"));
```

Provide required Context capabilities with `.provide()` on the parent builder before `.add()`. Extension-contributed commands are unchanged.

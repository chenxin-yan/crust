---
"@crustjs/core": minor
"@crustjs/config": minor
"@crustjs/env": minor
"@crustjs/openapi": patch
---

Each rule about a CLI's definition is now checked once: by TypeScript, or by Core when the CLI runs from source and when `crust build` takes its snapshot. A built CLI no longer carries or runs the runtime checks: `crust build` compiles them out of the artifacts it bundles.

- TypeScript checks types and structure: unknown keys, a `default` within literal `choices`, the argument list (unique names, the position of `variadic` and `afterDoubleDash`), a schema's input, a synchronous `parse`, Context dependencies, an `env` binding that is an object, `delimiter` only with `multiple`, and a section with a nonempty `only` or `except` but not both. Nothing checks these at runtime any more.
- Core checks names, spellings, and the assembled tree: blank, reserved, or malformed names and spellings, the `no-` prefix, integer-like flag names, one-character `short`s, empty `env` names and delimiters, section text, and every collision (flags, aliases, sibling commands, Extension commands, section titles, a second `renderer` or `noAction`). These throw a `DEFINITION` error from source (`bun`, `node`, tests), and fail `crust build`.
- Registering an `ExtensionId` again with a flag or command of the same name but a different definition now compiles, and the types take the later registration's definition, as the runtime does, also when both are passed to one `.extend()` call (a command both contribute is then typed as either result). An app command keeps its own type when a later registration removes the Extension command that collided with it.

```ts
new Crust("cli").flags({
  out: { type: "string", short: "o" },
  open: { type: "boolean", short: "o" },
});
// Before: a compile error. Now it compiles, and running it from source or `crust build` throws:
// Flag "open" collides with existing flag "out" on command "cli"
```

**Breaking changes:**

- A collision or a malformed name or spelling is no longer a compile error (the `FIX_ALIAS_COLLISION`, `FIX_COMMAND_COLLISION`, `FIX_SPELLING_SHAPE`, `FIX_EMPTY_SPELLING`, `FIX_EMPTY_NAME`, `FIX_NO_PREFIX`, `FIX_NAME_SHAPE`, `FIX_ALIAS_SHAPE`, `FIX_RESERVED_NAME`, `FIX_RESERVED_SPELLING`, `FIX_SHORT_LENGTH`, `FIX_INTEGER_LIKE_NAME`, `FIX_EMPTY_ENV`, `FIX_EMPTY_DELIMITER`, `FIX_SECTION_TEXT`, `FIX_SECTION_AUDIENCE`, and `FIX_EXTENSION_ID` brands are removed). Run the CLI or its tests, or `crust build`, to find them. `crust build --no-validate` skips them.
- A default outside `choices`, a variadic or `afterDoubleDash` argument that is not last, a repeated argument name, a `delimiter` without `multiple`, a malformed `env` binding, an async `parse`, and `.extend()` inside a command recipe no longer throw at runtime: they are TypeScript errors only. The `DEFINITION` reasons `default-outside-choices`, `variadic-position`, `after-double-dash-position`, `duplicate-arg`, `delimiter-without-multiple`, `invalid-env`, and `nested-command-extension` are removed.
- A definition must be the same on every run: one that varies with the platform or the environment is checked as it is on the build machine. A name built from runtime data, such as a user-configured alias, is input your CLI must validate.
- `Crust` and `CommandDefinitionBuilder` lose their `Sibs` and `Sp` type parameters, and `CommandDefinition` its `Spellings` parameter: `CommandDefinitionBuilder<{}, [], {}, never, never>` becomes `CommandDefinitionBuilder<{}, []>`.
- A section's `only` and `except` take a nonempty tuple wherever sections are written (`new Crust()`, `defineCommand()`, a Context's and an Extension's `.sections()`), as `CommandSectionInput` already did: an array typed `ExtensionId[]` no longer compiles, so write a literal, or use `as const` or a `[ExtensionId, ...ExtensionId[]]` annotation.
- `@crustjs/env`: `defineEnv()` no longer throws for a flag-only key such as `short`; it stays a type error.
- `@crustjs/config`: `.flags()` no longer reports a setting's flag spelling or collision at compile time (`FIX_FLAG_SPELLING`); Core reports it from source and in `crust build`.
- `@crustjs/openapi`: `defineApi()`'s check of `spec` runs from source and in `crust build`, not in a built CLI.

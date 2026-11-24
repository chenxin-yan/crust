---
"@crustjs/core": minor
"@crustjs/extensions": minor
"@crustjs/utils": minor
"@crustjs/config": minor
"@crustjs/env": minor
"@crustjs/man": minor
"@crustjs/skills": minor
"@crustjs/openapi": minor
"@crustjs/crust": minor
"create-crust": minor
---

Booleans, numbers, and environment variables follow common CLI conventions, and flags gain `type: "integer"`, `type: "count"`, and `min`/`max`. See [Arguments and flags](https://crustjs.com/docs/guide/arguments-and-flags#aliases-and-negation). **Breaking:** `--no-<name>` exists only when a flag asks for it, `noNegate` is removed, `type: "number"` is stricter, boolean text is strict, and `env` takes a name or a list of names instead of `{ name, delimiter }`.

- Negation is opt-in. A boolean flag accepts `--no-<name>` and `--no-<alias>` only with `default: true` or the new `negatable: true`; for any other flag it is a `PARSE` error. Help, man pages, completion, and generated skills list the negations only for `default: true` flags. `noNegate` is removed; `negatable` on a non-boolean is a compile error. `noColor()` declares `--color` negatable, so `--no-color` works as before; so do `create-crust`'s `--no-install`, `--no-git`, and `--no-overwrite`, `crust build --no-bytecode`, and `--no-<name>` on an OpenAPI boolean parameter, which sends `false`.
- A boolean still takes no value, as in GNU tools, clap, and Node.js `util.parseArgs`; the error now says what to write: `Flag "--rm" does not take a value; write --rm, or leave it out`.
- `type: "number"` reads only a finite decimal (`-1.5`, `2e3`): `0x10`, `Infinity`, `1_000`, and padded text such as `" 7 "` are `PARSE` errors, as is a non-finite number in typed `run()` input.
- New `type: "integer"`: digits with an optional leading minus, typed `number`. New `min` and `max` on `number` and `integer` flags, arguments, and config settings: inclusive bounds checked on argv, environment, typed `run()`, and config file values, not on the `default`. `commandInputSchema()` and the config file schema publish them as `minimum` and `maximum`.
- New `type: "count"` for flags: `-vvv` is `3` and an omitted flag is `0`, typed `number`. It takes no value, negation, `default`, `required`, `multiple`, or `env`.
- Boolean text, from an environment variable or a positional argument, is `true`, `1`, `yes`, or `on`, or `false`, `0`, `no`, or `off`, in any letter case. Any other text is a `PARSE` error naming the variable (`Expected a boolean (true, false, 1, 0, yes, no, on, off) for --frozen (from $FROZEN).`) instead of `false`. An empty boolean variable counts as unset, in `@crustjs/env` too.
- `env` on a flag or setting is a variable name or a list of names, where the first one that is set wins: `env: "ACME_ORG"`, `env: ["CPNPM_REGISTRY", "npm_config_registry"]`. The `{ name, delimiter }` object is removed; the flag's own `delimiter` now also splits the variable's text. `FlagSnapshot.env` and `DocumentationFlag.env` hold the name or list, help shows `[env: A, B]`, and `FlagSnapshot.noNegate` is removed.
- `nextSteps()` skips a step that gives `false` to a boolean flag that is not negatable but has an `env` binding or is `required`, since the printed command would leave the flag to that variable or fail without it.
- `defineEnv()` rejects a key a variable definition does not have, such as `noNegate` or a misspelling, at compile time; it was accepted and ignored.
- `@crustjs/utils/primitive`: `coerceBooleanString()` is replaced by `tryCoerceBoolean()`, which reads the words above and returns `undefined` for any other text.

```ts
new Crust("serve").flags({
  port: { type: "integer", min: 1, max: 65535, default: 3000, env: ["SERVE_PORT", "PORT"] },
  verbose: { type: "count", short: "v" },
  cache: { type: "boolean", default: true }, // --no-cache
  color: { type: "boolean", negatable: true }, // --color, --no-color
});
```

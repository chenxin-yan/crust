---
"@crustjs/core": minor
"@crustjs/extensions": minor
"@crustjs/mcp": minor
"@crustjs/openapi": minor
---

One property says how a list argument collects its words: `variadic: true | "afterDoubleDash" | "passthrough"`. Wrapper commands such as `docker run <image> <command...>` now take the other program's words as typed, without `--`. See [Wrapper commands](https://crustjs.com/docs/guide/arguments-and-flags#wrapper-commands). **Breaking:** `afterDoubleDash: true` is replaced by `variadic: "afterDoubleDash"`, `rawArgs` and `raw` are removed, and a word no argument takes is a usage error after `--` too.

- `variadic: "passthrough"`: the command reads flags only before its first positional. From there on every word is kept as typed, flags and a later `--` included, so `run --rm alpine ls -la --color` gives `command` the words `ls -la --color`. A `--` before the first positional still ends flags. Help shows `[options]` before every argument, and shell completion offers no flags after the first positional.
- `variadic: "afterDoubleDash"` replaces `afterDoubleDash: true` and takes every word after `--`. The single-word form (`afterDoubleDash: true` without `variadic`) is gone.
- Words after `--` fill arguments like any other positional values, and a word no argument takes is `Unexpected positional argument` (`VALIDATION`, exit 2): `app ps -- anything` fails instead of running `ps`.
- `rawArgs` is removed from the action and Extension contexts and from `ParsedCommandArgv`, and `ParseResult.rawArgs` with it; `excessArgs` now holds the leftover words on both sides of `--`. `raw` is removed from typed `run()` input, `bindInput()`, `sources`, `--input`, `commandInputSchema()`, `parseCommandInput()`, and MCP tool inputs; `RAW_INPUT_PROPERTY` is no longer exported from `@crustjs/core/tooling`, and `raw` is an ordinary argument or flag name. Declare a `"passthrough"` or `"afterDoubleDash"` argument for words meant for another program.
- The argument-list rules are TypeScript errors only: an `"afterDoubleDash"` or `"passthrough"` argument must be last (`FIX_LAST_ARGUMENT_POSITION`); a `variadic: true` argument must be last or directly before a final `"afterDoubleDash"` one (`FIX_VARIADIC_POSITION`); and, new, a required argument cannot follow an optional one (`FIX_REQUIRED_AFTER_OPTIONAL`), which could never be left out. `ArgSnapshot.afterDoubleDash` and `DocumentationArg.afterDoubleDash` are removed; `variadic` carries the mode. The new `VariadicMode` type is exported.
- `@crustjs/openapi`: the `reserved-input-name` lint rule is removed, since `raw` is no longer reserved.

```ts
new Crust("run")
  .flags({ rm: { type: "boolean" } })
  .args(
    { name: "image", type: "string", required: true },
    { name: "command", type: "string", variadic: "passthrough" },
  )
  .action(({ args, stdout }) => stdout(`${args.image}: ${args.command.join(" ")}`));
// run --rm alpine ls -la --color  →  alpine: ls -la --color
```

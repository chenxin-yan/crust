---
"@crustjs/core": minor
---

Add `choices` to `FlagDef`/`ArgDef` and `hidden` to `CommandMeta`.

Two purely-additive optional fields on the `@crustjs/core` public type surface:

- **`choices?: readonly string[]`** on string-typed flag and arg variants
  (`StringFlagDef`, `StringMultiFlagDef`, `StringArgDef`) — a static enum of
  valid values for the flag/arg.

  ```ts
  flags: {
    target: { type: "string", choices: ["browser", "bun", "node"] as const },
  }
  ```

  `choices` is a **hint for tooling** consumed by shell-completion plugins
  to emit static value candidates and may be consumed by future opt-in
  validation. It is **NOT** enforced at parse time in this version: passing
  a value outside `choices` does not throw, the value is still parsed as a
  string and delivered to your handler. Validate explicitly inside your
  handler if you need runtime rejection today. Adding `choices` to
  number/boolean variants is a compile-time error.

- **`hidden?: boolean`** on `CommandMeta` — marks a subcommand as hidden
  from the default `--help` listing.

  ```ts
  meta: { name: "__complete", hidden: true, description: "Internal" }
  ```

  `hidden` affects help rendering only. The command remains directly
  invocable by name and is unaffected by routing, alias resolution, or
  `didYouMeanPlugin` suggestions. Filtering is performed by
  `helpPlugin.formatCommandsSection` (in `@crustjs/plugins`); custom help
  renderers are expected to respect this field too.

Both fields are purely additive at the type level — existing code that
does not set `choices` or `hidden` is unchanged. The parser is
unmodified.

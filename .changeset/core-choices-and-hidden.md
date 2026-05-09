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
    target: { type: "string", choices: ["browser", "bun", "node"] },
  }
  ```

  `choices` is a **hint for tooling** consumed by shell-completion tooling
  to emit static value candidates and may be consumed by future opt-in
  validation. It is **NOT** enforced at parse time in this version: passing
  a value outside `choices` does not throw, the value is still parsed as a
  string and delivered to your handler. Validate explicitly inside your
  handler if you need runtime rejection today. Adding `choices` to
  number/boolean variants is a compile-time error.

- **`hidden?: boolean`** on `CommandMeta` — omits a command from any
  tooling that enumerates the command tree for users (help output, man
  pages, skill descriptors, completion candidate lists, etc.).

  ```ts
  meta: { name: "__complete", hidden: true, description: "Internal" }
  ```

  Listing-only: the command stays fully invocable by name (or alias),
  routing is unchanged, and it can still surface through tooling that
  looks up specific commands rather than enumerating the tree (e.g.
  `didYouMeanPlugin`). The default `helpPlugin` (in `@crustjs/plugins`)
  follows this contract today; first-party generators and custom
  renderers should too.

Both fields are purely additive at the type level — existing code that
does not set `choices` or `hidden` is unchanged. The parser is
unmodified.

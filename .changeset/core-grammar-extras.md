---
"@crustjs/core": minor
"@crustjs/extensions": minor
"@crustjs/utils": minor
"@crustjs/config": minor
"@crustjs/env": minor
"@crustjs/man": minor
"@crustjs/skills": minor
"@crustjs/mcp": minor
---

Flags can be hidden, deprecated, grouped as mutually exclusive, and made to need another flag, and `integer` and `number` flags take a negative number as the next word. See [Arguments and flags](https://crustjs.com/docs/guide/arguments-and-flags#one-of-several-flags). **Breaking:** `FlagDef` gains `type: "exclusive"`, `UsageSegment` gains `kind: "exclusive"`, and `RunInputValue` gains the group's `{ flag, value }`, so code that switches over them needs a case.

- New `type: "exclusive"` flag groups: one entry whose `flags` are the members, each a single-value flag with its own spellings, and optional `required: true`. The value is `{ flag, value }` for the member given, or `{ flag }` for a boolean member; typed `run()`, `--input`, and MCP take the same shape. Two members, or none when required, is a usage error (exit status 2), and sources are compared level by level: the command line, then the environment. Usage shows the group as `(--org-id <string> | --all)`; help, man pages, completion, and skills list the members. Member names share the flag namespace, checked like other collisions when the CLI runs from source or in `crust build`.
- New `requires: ["json"]` on a flag: given without the named flags of the same record, the invocation is a usage error (`Flag "--jq" requires "--json"`). Names are type-checked.
- New `hidden: true` on flags: parsed as usual, and left out of help, man pages, completion, skills, search, and command input schemas.
- New `deprecated: "message"` on flags and in command config: given on the command line, it prints `Warning: flag "--name" is deprecated. message` (or `command "app db"`) on stderr once, and help, man pages, skills, and the schema index append `[deprecated: message]`. Command input schemas mark such a flag `deprecated: true`, and an MCP tool's description carries the command's marker. `CommandDocumentation` and `DocumentationFlag` gain `deprecated`, `DocumentationFlag` gains `group`, and `FlagSnapshot` gains `hidden`, `deprecated`, `requires`, and the group's `flags`. `formatDescription()` takes the deprecation message as a sixth argument.
- `integer` and `number` flags take a negative number as the next word (`head -n -5`); other value-taking flags still refuse a word that starts with `-` and say to write `--flag=<value>`.
- A short flag keeps the `=` of an attached value (`-d=` is `=`), as POSIX tools do. When such a value is rejected, the error says what to write: `Invalid value for --template. Expected one of: vue, react. Write -t vue or --template=vue.` `-D=1` on a boolean short now says `Flag "-D" does not take a value.` instead of `Unknown flag "-="`.
- `@crustjs/env` rejects `deprecated`, `requires`, and `type: "exclusive"` at compile time, as argv-only vocabulary. `@crustjs/config` settings take `hidden` and `deprecated`.

```ts
new Crust("deploy").flags({
  scope: {
    type: "exclusive",
    required: true,
    flags: { "org-id": { type: "string", env: "DEPLOY_ORG_ID" }, all: { type: "boolean" } },
  },
  jq: { type: "string", requires: ["json"] },
  json: { type: "boolean" },
  "kernel-memory": { type: "string", hidden: true, deprecated: "Use --memory instead." },
});
```

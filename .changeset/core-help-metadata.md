---
"@crustjs/core": minor
"@crustjs/config": minor
---

Commands and flags carry more documentation for help and the other generated docs. See [Group commands and flags in help](https://crustjs.com/docs/guide/commands#group-commands-and-flags-in-help).

- `examples: string[]` on a command's config and the root metadata: example command lines, listed right after the usage line.
- `valueName` on a flag that takes a value names it in docs: `--memory <bytes>`. On a `boolean`, `count`, or exclusive-group flag it is a compile error.
- `defineConfig()` settings take `valueName` too.
- `.group(title, block)` lists the commands (`g.add()`, `g.command()`) or the flags (`g.flags()`) a block registers under a heading. The first call decides the kind; the other kind is a compile error, and blocks do not nest. A group changes documentation only; the snapshot records it in `CommandSnapshot.groups`.
- `FlagSnapshot.inherited` marks the flags a command does not declare itself (Context-owned and Extension flags), and `FlagSnapshot.valueName` carries the value name.
- A schema-backed argument or flag whose schema rejects a missing value is `required: true` in the snapshot, so help, skills, the `--llms` index, and MCP tool inputs show it as required. The documentation model reads a schema's `enum` and `default` as its choices and default.
- **Breaking:** `buildCommandDocumentation()` lists flags in help order (the command's own, then its flag groups, then the inherited ones) and children by group. `DocumentationFlag` gains `valueName`, `heading`, and `inherited`; `CommandDocumentation` gains `heading` and `examples`.

---
"@crustjs/plugins": patch
---

`helpPlugin` now omits subcommands marked `meta.hidden: true`.

`formatCommandsSection` filters out subcommands whose `meta.hidden === true`
before rendering the `COMMANDS:` block. If every subcommand is hidden, the
section is omitted entirely (no orphan `COMMANDS:` heading). Insertion
order of the surviving entries is preserved, and alias rendering composes
correctly — a visible subcommand with aliases still renders as
`name (alias1, alias2)`.

Hidden filtering affects help output only. Hidden subcommands remain
directly invocable by name; routing in `@crustjs/core` does not consult
`meta.hidden`. This is intentional and load-bearing for internal
runtime commands like the future `__complete` entrypoint used by
shell-completion plugins.

Requires `hidden` on `CommandMeta`, added in the same release of
`@crustjs/core`.

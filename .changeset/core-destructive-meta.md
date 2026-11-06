---
"@crustjs/core": minor
---

Commands can be marked destructive with `defineCommand(name, { destructive: true }, recipe)`, or `new Crust(name, { destructive: true })` for a root action. `CommandMeta.destructive` is metadata only: core does not change how the command runs. It appears in the Command Snapshot (`meta.destructive`, including on children that have not been built) so Extensions and tooling can ask for confirmation or flag the command.

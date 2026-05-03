---
"@crustjs/core": minor
---

Add `aliases` to `CommandMeta`.

Commands and subcommands can now declare alternative names that resolve to the same command node:

```ts
new Crust("my-cli").command("issue", (cmd) =>
  cmd.meta({ aliases: ["issues", "i"] }).run(() => {}),
);
// my-cli issue, my-cli issues, and my-cli i all route to the same command
```

The change is purely additive at the type level — existing code that does not set `aliases` is unchanged. `resolveCommand` gains a fast path that scans sibling `meta.aliases` on miss; `commandPath` continues to record the canonical name only, so error messages, help titles, and downstream plugins are unaffected by which alias the user typed. `CrustError("COMMAND_NOT_FOUND")`'s `details.available` now includes aliases (canonical names followed by each canonical's aliases, in sibling insertion order) so plugins can match against alias spellings.

Alias collisions are eagerly rejected at registration time (and during `validateCommandTree` for plugin-installed subcommands) with `CrustError("DEFINITION", …)`. An alias may not equal the command's own canonical name, any sibling's canonical name, or any sibling's alias; aliases must be non-empty, contain no whitespace, and not start with `-`.

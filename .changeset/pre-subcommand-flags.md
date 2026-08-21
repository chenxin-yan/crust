---
"@crustjs/core": minor
---

Routing now skips known flags (and their values) that appear before a subcommand name, so `app --quiet translate` runs `translate` instead of silently resolving the root without an action and exiting 0. All parser-accepted spellings are recognized during routing: long names, `--flag=value`, `--no-<name>` negation (respecting `noNegate`), short flags and inline values, long aliases, and bundled short booleans. Unknown flags and the `--` terminator still stop routing as before.

Behavior changes:

- Recursive flags placed before a subcommand bind to the subcommand's invocation — e.g. `app --help sub` shows `sub`'s help (previously the root's).
- A pre-subcommand flag the routed subcommand cannot parse fails at routing with an actionable `PARSE` error (`Flag "--quiet" cannot be used before subcommand "sub" because "sub" does not accept it.`) instead of a confusing unknown-flag error or silent no-op. Propagating (Context-owned and recursive Extension) flags keep routing through.

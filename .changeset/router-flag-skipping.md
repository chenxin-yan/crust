---
"@crustjs/core": minor
---

Routing now skips known flags (and their values) that appear before a subcommand name, so `app --quiet translate` runs `translate` instead of silently resolving the root without an action and exiting 0. All parser-accepted spellings are recognized during routing: long names, `--flag=value`, `--no-<name>` negation (respecting `noNegate`), short flags and inline values, long aliases, and bundled short booleans. Unknown flags and the `--` terminator still stop routing as before.

Behavior change: recursive flags placed before a subcommand now bind to the subcommand's invocation — e.g. `app --help sub` shows `sub`'s help (previously the root's), and a root-only flag before a subcommand name is now an "unknown flag" error in the subcommand (previously a silent no-op).

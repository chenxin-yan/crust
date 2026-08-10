---
"@crustjs/core": patch
---

Routing now rejects a pre-subcommand flag the routed subcommand cannot parse. Previously `app --quiet sub` with a root-local `--quiet` routed to `sub` and then failed with a confusing `Unknown flag "--quiet"` from the subcommand's parser; it now fails at routing with `PARSE: Flag "--quiet" cannot be used before subcommand "sub" because "sub" does not accept it.` Propagating (Context-owned and recursive Extension) flags before a subcommand are unaffected and keep routing through.

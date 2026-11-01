---
"@crustjs/core": patch
---

Report a defaulted argument or flag as optional: a snapshot's `required` is now absent when the definition has a `default`, matching the parser, so help shows `app [target]` instead of `app <target>` and man pages, skills, and completion agree. `defineCommand()`, `.command()`, and `.as()` now reject command names starting with `-` with a `DEFINITION` error (`reason: "invalid-name"`), since the router reads them as flags. `onError` hooks now see the routed command and `commandPath` when a subcommand's argv fails to parse (e.g. an unknown flag), instead of the root.

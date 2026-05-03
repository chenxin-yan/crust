---
"@crustjs/plugins": minor
---

`helpPlugin` and `didYouMeanPlugin` are alias-aware.

`helpPlugin`'s `COMMANDS:` section now renders the canonical name with any aliases inline as `name (alias1, alias2)` — e.g. `issue (issues, i)`. Commands without aliases render unchanged. The canonical name is styled while the alias suffix is plain so the canonical spelling stands out at a glance; column alignment is preserved using the ANSI-aware `padEnd` from `@crustjs/style`.

`didYouMeanPlugin` includes aliases in its candidate list when matching against an unknown command, but always reports the canonical name in the `Did you mean "X"?` message. So a typo of an alias (`issuess` for `issues`) suggests the canonical (`issue`), and a candidate that matches both an alias and its canonical is deduplicated to a single canonical suggestion.

Both behaviors require `aliases` on `CommandMeta`, added in the same release of `@crustjs/core`.

---
"@crustjs/extensions": minor
"@crustjs/skills": minor
---

`completion()` and `skill()` no longer switch off type checking of the host's command tree. After `.extend(completion())` or `.extend(skill({}))`, `app.run()` and `runInteractive()` again reject misspelled command paths and flags, and the contributed command itself is typed (`completion`'s `<shell>` choices, the `skills` subcommands, flags, and default `skill` alias). A literal `command` option is kept as the contributed name; a `command` typed as `string`, or one that may be absent, leaves the tree unchecked, as before. A host command that already uses the contributed name is now reported at compile time, like other Extension command collisions.

---
"@crustjs/core": minor
---

Add `app.at(path)`, which returns a typed `CommandHandle` bound to one command. `handle.run(input?, io?)` accepts the same structured input and IO as `app.run(path, ...)` with the path already applied, so a subcommand can be re-exported as a typed library function or handed to other commands and test helpers. Unknown paths throw `COMMAND_NOT_FOUND` eagerly from `at()`.

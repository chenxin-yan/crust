---
"@crustjs/core": minor
---

The command that runs reads every flag, wherever it was typed, and a command without an action checks its input. See [Commands](https://crustjs.com/docs/guide/commands#how-a-command-line-is-routed). **Breaking:** a flag reused by a subcommand with a different shape is a definition error, a bare group without `help()` exits 2, and an unknown word under a command whose action declares no arguments is `Unknown command`.

- A flag typed before a subcommand name is read by the subcommand, even when it means something else there: `app -c prod cp` is `app cp -c prod`. A flag the running command doesn't know is the same `Unknown flag` error on either side of the subcommand name; the `flag-not-forwardable` reason is removed.
- A flag only a subcommand knows, typed before its name, is still an error, now with a hint: `Unknown flag "--force"; flags of subcommand "rm" go after its name`.
- New definition check (`flag-shape-mismatch`): a subcommand may reuse an ancestor's flag spelling only if both take a value or neither does. It runs from source and in `crust build`, and is left out of built CLIs.
- A command without an action validates its flags and arguments before a `noAction` hook, such as `help()`'s, runs: `app --level bogus` is a usage error instead of help with exit 0. Without a `noAction` hook, a command with subcommands run bare fails with `Missing command. Available: …` (`VALIDATION`, exit 2) instead of exiting 0.
- A command with subcommands whose action declares no arguments reports a word that names no subcommand as `Unknown command` (`COMMAND_NOT_FOUND`, so `didYouMean()` suggests one), not `Unexpected positional argument`.
- New `unknownCommand(command, name)` builds the `COMMAND_NOT_FOUND` error Core raises, so an action that takes any word can decline one.

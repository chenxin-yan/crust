---
"@crustjs/extensions": minor
---

`help()` renders more and recovers from a mistyped flag. See [Help](https://crustjs.com/docs/modules/extensions/help).

- `help({ command: true })` adds a `help [command...]` command: `app help db migrate` prints what `app db migrate --help` prints. Off by default.
- Help wins over a mistyped flag: when the command line fails to parse and `-h` or `--help` is a word of its own before `--`, the routed command's help is printed instead of the error. The exit code stays `2`.
- Help shows a command's `examples` right after the usage line and its own aliases; `.group()` headings in code order, then "Additional commands"; the command's own flags under "Options", then its flag groups, then the flags it does not declare under "Global options"; `<valueName>` after a value flag and `...` after a repeatable one; and the choices, default, and requiredness a schema defines.
- Descriptions wrap to the terminal width. `renderHelp(command, path?, { columns })` takes the width.
- Section bodies drop their own ANSI styling when colors are off (`NO_COLOR`, `--no-color`).
- The `--llms` index lists `examples`, a flag's `valueName`, and flags under "Flags", their group titles, and "Global flags".
- **Breaking:** `--help` and the other recursive Extension flags move from "Options" to "Global options", and `--llms` lists them under "Global flags". Root-only ones such as `--version` and `--llms` stay with the root's own flags.

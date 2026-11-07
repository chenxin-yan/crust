---
"@crustjs/extensions": minor
---

Add `schema()`, an Extension for machine-readable command discovery. Its `schema [path...]` command prints one line of JSON for the command at `path` (the root when omitted): `input`, the flat JSON Schema of its arguments and flags from `commandInputSchema()`; and `output`, the JSON Schema of its `.output()` schema, omitted when there is none or it cannot be converted. Path segments may be aliases; an unknown one fails with a `COMMAND_NOT_FOUND` error naming the path. The command also returns the object as its `run()` result. A root-only `--llms` flag prints a compact Markdown index of every visible command with its usage, description, arguments, and flags.

---
"@crustjs/core": minor
---

**Breaking:** an empty array in structured input is an empty list. For a variadic argument or a `multiple` flag, `[]` given to `run()`, to `bindInput()` or `bindText()`, through `--input`, or as an MCP tool argument is now a supplied value: the default does not apply and the environment variable is not read. It used to count as not given, so `run([], { flags: { filter: [] } })` filtered by the default. Leave the key out (or set it to `undefined`) for "not given". A required list given `[]` fails with `Missing required flag "--filter"` (or `Missing required argument`), the error `--filter ""` gives on the command line.

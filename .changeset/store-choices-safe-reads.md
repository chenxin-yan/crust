---
"@crustjs/store": minor
---

String fields take `choices`, validation errors name their file, and the store reads a file the user controls safely.

- A string field, scalar or array, may list `choices`: a literal tuple narrows its type to their union, `read()` and every mutation reject other values with `Expected one of: …` (never repeating the value), and a `default` outside them throws `DEFINITION`.
- A `VALIDATION` error's message ends in `in <path>`, and its details gain `path`, the store file.
- Behaviour change: the store reads only a regular file, or a symbolic link to one. A directory, FIFO or device at the path now rejects at once with `PATH` (`Store file is not a regular file: <path>`) instead of hanging or failing with `IO`.
- Behaviour change: a store file larger than 16 MiB now rejects with `PARSE` (`Store file is larger than 16 MiB: <path>`), read no further than the limit, and a mutation that would write more than 16 MiB rejects with `VALIDATION` and leaves the file as it was.
- A leading byte order mark is ignored instead of failing with `PARSE`.
- The store loads Node's built-in modules when it first needs them, so a bundled CLI that imports the store only when a command uses it does not load them at start-up.

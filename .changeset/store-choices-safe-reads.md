---
"@crustjs/store": minor
---

String fields take `choices`, validation errors name their file, and the store reads a file the user controls safely.

- A string field, scalar or array, may list `choices`: a literal tuple narrows its type to their union, `read()` and every mutation reject other values with `Expected one of: …` (never repeating the value), and a `default` outside them throws `DEFINITION`.
- A `VALIDATION` error's first line names the store file (`Store validation failed (read) in <path>`), and its details gain `path`.
- Behaviour change: the store reads only a regular file, or a symbolic link to one. A directory, FIFO or device at the path now rejects at once with `PATH` (`Store file is not a regular file: <path>`) instead of hanging or failing with `IO`.
- Behaviour change: a store file larger than 16 MiB now rejects with `PATH` (`Store file is larger than 16 MiB: <path>`), read no further than the limit, and never replaced by a `write()` that keeps unknown keys, and a mutation that would write more than 16 MiB rejects with `VALIDATION` and leaves the file as it was.
- A leading byte order mark is ignored instead of failing with `PARSE`.
- The store's built module no longer imports a Node built-in at its top level; each function gets the built-ins it needs when it runs.
- Behaviour change: a boolean field converts only the text `"true"`, `"1"`, `"false"` and `"0"`, on read and on write. Any other text, such as `"yes"`, now fails with `Expected boolean` instead of reading as `false`, as non-numeric text already failed a number field.

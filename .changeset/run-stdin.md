---
"@crustjs/core": minor
---

**Breaking:** under typed `run()` and the action's `runCommand()`, `stdin` is empty, with `isTTY` false, unless the caller passes the new `stdin` option, text or bytes as `captureExecute()` takes: `app.run(["sort"], {}, { stdin: "b\na\n" })`. It used to be the process's stdin, so a command that read stdin under `run()` made a test wait on the test runner's stdin, and a command an MCP client called as a tool failed with `stdin is in use by another reader`; it now reads no input. A read without the option does not throw, so a command that reads stdin only when something was piped keeps working.

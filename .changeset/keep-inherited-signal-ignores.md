---
"@crustjs/utils": minor
"@crustjs/core": patch
"@crustjs/crust": patch
---

On Bun on Linux, a CLI started with a signal ignored (SIGHUP under `nohup`, SIGINT for a background job in a script) now keeps ignoring it. Core's Ctrl-C handling, timed `runProcess()` calls, and `crust build`'s snapshot step no longer listen for an ignored signal; listening replaced the ignore, and Bun restores the default action when the listener is removed, so the process could die from a signal it was started to ignore. Node already resets inherited ignores at startup, so nothing changes there. macOS on Bun still loses the ignore until Bun keeps the previous disposition (oven-sh/bun#47574). Adds `isSignalIgnored()` from `@crustjs/utils/signals`.

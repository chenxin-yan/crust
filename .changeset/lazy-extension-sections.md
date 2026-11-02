---
"@crustjs/core": patch
---

An Extension with a `sections` callback, such as `skill()`, no longer makes every invocation build the whole command tree. The callback still runs when the application prepares, but its snapshot builds only the commands it reads, so `skill()` CLIs route lazily like any other app (about 15 ms faster per run on a 200-command CLI). As in apps without such a callback, a broken recipe in one command no longer fails unrelated runs; it surfaces when that command is used or when `app.snapshot()`, help, or `crust build` reads it.

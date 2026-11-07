---
"@crustjs/utils": minor
---

`@crustjs/utils/process` exports `readStdin(signal)`, which reads all of stdin as UTF-8 text without blocking the event loop, so aborting `signal` cancels a read waiting on an open pipe or terminal. It reads stdin that already has an encoding or was paused, and returns `""` for stdin an earlier consumer already read to the end instead of waiting for an `end` event that cannot fire again.

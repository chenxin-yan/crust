---
"@crustjs/utils": minor
---

`readStdin(signal)` is removed from `@crustjs/utils/process`. `@crustjs/utils/terminal` exports `readInput(input, signal)`, which yields a readable stream's chunks until it ends, stops at `signal`'s abort, pauses the stream between chunks, and throws while another reader consumes it. Core's action `stdin` reads through it.

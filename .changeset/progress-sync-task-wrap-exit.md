---
"@crustjs/progress": patch
---

`spinner({ task })` accepts a synchronous `task` (it returns `T | Promise<T>`) and is typed `Promise<T>`. Previously a stored options object with a synchronous task resolved to the `SpinnerHandle` overload while the call actually returned a promise; the handle overload now requires `task` to be absent.

Also fixes:

- A spinner or progress frame wider than the terminal no longer adds a line on every frame: the animated frame (symbol, message, count, and theme text) is cut to one row with `…` and at its first line break (`progress()` keeps its count when it fits), and the final line prints the full message. Redraws still erase only the spinner's row, so lines the task logs to the same terminal stay on screen.
- `process.exit()` while an interactive spinner is running restores the cursor when the sink writes synchronously.
- A theme or sink that throws while drawing the first frame no longer leaves the cursor hidden or an `exit` listener behind.

---
"@crustjs/progress": patch
---

`spinner({ task })` accepts a synchronous `task` (it returns `T | Promise<T>`) and is typed `Promise<T>`. Previously a stored options object with a synchronous task resolved to the `SpinnerHandle` overload while the call actually returned a promise; the handle overload now requires `task` to be absent.

Also fixes:

- A spinner or progress message wider than the terminal no longer adds a line on every frame: redraws and the final line erase every wrapped row.
- `process.exit()` while a spinner is running restores the cursor.

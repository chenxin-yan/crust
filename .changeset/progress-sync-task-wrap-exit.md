---
"@crustjs/progress": patch
---

`spinner({ task })` accepts a synchronous `task` (it returns `T | Promise<T>`) and is typed `Promise<T>`. Previously a stored options object with a synchronous task resolved to the `SpinnerHandle` overload while the call actually returned a promise; the handle overload now requires `task` to be absent.

Also fixes:

- A spinner or progress message wider than the terminal no longer adds a line on every frame: redraws and the final line erase every wrapped row. The cursor rests on a separate blank line below the frame so resizing terminals that reflow completed lines can redraw safely with or without cursor-line reflow.
- `process.exit()` while a spinner is running restores the cursor.

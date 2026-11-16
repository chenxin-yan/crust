---
"@crustjs/utils": minor
---

`readStdin(signal, { maxBytes })` rejects with a `RangeError` as soon as stdin passes `maxBytes`, without waiting for the end of the input.

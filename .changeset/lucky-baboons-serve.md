---
"@crustjs/core": patch
---

Omitted variadic arguments now resolve their declared `default` as a one-element array (`[default]`) for both `execute()` and `run()`; supplied values still replace it.

---
"@crustjs/core": patch
---

URL, path, and JSON parse errors now name the flag or argument that failed (e.g. `Invalid URL for --base: "x"`, `Path for <dir> cannot be empty`) and keep the original error as `cause`. A `~` path is now expanded correctly when the home directory contains `$`.

---
"@crustjs/core": patch
---

Tighten Extension hook flag inference: uncertain scopes may omit defaults, uncertain collections expose raw values, and optional schema multiplicity includes arrays. Previously unsafe scalar assumptions now require narrowing.

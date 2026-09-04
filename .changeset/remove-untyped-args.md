---
"@crustjs/core": minor
---

Remove untyped positional argument definitions. Declare a core `type` or provide a Standard Schema with `schema`.

Context instances no longer include `kind: "context"`. Stop reading or discriminating on `kind`; use the exported `ContextInstance` type for static typing.

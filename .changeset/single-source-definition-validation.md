---
"@crustjs/core": patch
---

Invalid variadic-arg placement and flag/arg defaults outside literal `choices` are rejected once at compile time with `FIX_VARIADIC_POSITION` and `FIX_DEFAULT_CHOICE`. Runtime parsing validates argv values against `choices` without re-validating definition structure; a default resolved at parse time is validated against `choices` too, covering dynamically assembled definitions. Command actions now seed their lazy `ctx` bag from the definition's declared `uses`, so an unprovided declared dependency on a dynamically assembled path fails loud with `missing-context` on access instead of reading `undefined`.

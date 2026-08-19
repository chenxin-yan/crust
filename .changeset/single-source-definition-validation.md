---
"@crustjs/core": patch
---

Invalid variadic-arg placement and flag/arg defaults outside literal `choices` are rejected once at compile time with `FIX_VARIADIC_POSITION` and `FIX_DEFAULT_CHOICE`. Runtime parsing validates argv values against `choices` without re-validating definition structure.

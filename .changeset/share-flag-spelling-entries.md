---
"@crustjs/core": patch
---

Builder clones now share their immutable flag-spelling entries instead of re-creating each one, reducing allocations when chaining builder methods, extending with Extensions, and preparing an invocation. Parsing behavior is unchanged.

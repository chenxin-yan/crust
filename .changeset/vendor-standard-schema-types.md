---
"@crustjs/core": patch
"@crustjs/store": patch
"@crustjs/prompts": patch
---

Vendor the Standard Schema protocol types, as recommended by the specification, and remove `@standard-schema/spec` from runtime dependencies. This does not change the public API or runtime behavior, and published declarations no longer reference the spec package.

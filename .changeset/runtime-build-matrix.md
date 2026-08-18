---
"@crustjs/crust": minor
"@crustjs/create": patch
---

Add runtime-aware `crust build` compilation: explicit Bun or Deno targets take precedence, followed by `engines` and project-marker detection. Deno projects compile with `deno compile`; Bun projects keep the existing all-target default.

Make `@crustjs/create` importable outside Bun by running declarative command steps through the platform shell instead of Bun Shell.

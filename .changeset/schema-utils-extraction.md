---
"@crustjs/schema-utils": patch
"@crustjs/validate": patch
---

Internal refactor — no observable API change.

`@crustjs/validate`'s Standard Schema introspection layer has been moved into
a new internal workspace package, `@crustjs/schema-utils`. It is published to
npm only so that `@crustjs/validate`'s `dependencies` resolve for external
installs; it is not part of the public Crust API and may change without a
deprecation cycle. Consumers of `@crustjs/validate` do not need to change any
imports.

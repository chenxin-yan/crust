---
"@crustjs/core": patch
"@crustjs/extensions": minor
"@crustjs/skills": minor
"@crustjs/store": patch
---

Reuse Core's prepared invocation tree across repeated dispatches, defer completion renderers and skill implementation modules until first use (Store's `node:crypto` import is replaced by the runtime global), and add focused subpath exports for Extensions and Skills. As a result, Extension command recipes now materialize once per builder instance instead of on every run — recipes must stay inert, per the documented contract.

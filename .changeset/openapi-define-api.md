---
"@crustjs/openapi": minor
---

`defineApi(options)` replaces `apiCommand()` and the `apiClient` export: it returns `extension`, which contributes the `api` command, and `client`, the `api` Context commands `.use()`. The client's new `call(operationId, input?)` builds the request from the spec and resolves to the 2xx JSON body; with the inspex content mapper on TypeScript 7.1 (experimental), it is typed from the spec through the new `Specs` registry, else its result is `unknown`. `spec` is a `file:` URL (JSONC allowed), which `crust build` writes to `<id>/spec.json` so it stays out of the bundle, or a plain object; a loader is now a `DEFINITION` error.

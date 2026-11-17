---
"@crustjs/openapi": minor
---

`operations(spec)` reads every operation of an OpenAPI 3.0 or 3.1 document into plain data (`Operation`, `Param`): method, path, operationId, tags, summary, parameters with the path item's merged in, the request body, responses and security, with each schema published as JSON Schema 2020-12 that means what the API's schema means: a local `$ref` is replaced by its target (in 3.1, keywords beside it are kept and the target joins their `allOf`), the 3.0 dialect is translated (`nullable` becomes a `type` union, boolean exclusive bounds become numeric), and everything else, such as `allOf`, stays as written. Its `Diagnostic`s report an unsupported version, operations without an operationId, and operationIds several operations share. `api --list` and `api --spec` are unchanged.

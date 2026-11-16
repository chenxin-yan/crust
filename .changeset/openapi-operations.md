---
"@crustjs/openapi": minor
---

`operations(spec)` reads every operation of an OpenAPI 3.0 or 3.1 document into plain data (`Operation`, `Param`): method, path, operationId, tags, summary, parameters with the path item's merged in, the request body, responses and security, with local `$ref`s followed, 3.0 `nullable` turned into a `type` union and `allOf` properties merged. Its `Diagnostic`s report an unsupported version, operations without an operationId, and operationIds several operations share. `api --list` and `api --spec` are unchanged.

---
"@crustjs/openapi": minor
"@crustjs/core": patch
---

**Breaking:** an OpenAPI `integer` parameter or top-level body field, or a list of them, becomes an `integer` flag or argument instead of a `number` one, and help shows `<integer>`. `--limit 1.5` is now a usage error before any request, and so is an id a JavaScript number cannot hold exactly: `--id 9007199254740993` used to be rounded and sent as `…992`, another resource. A body field from `--request-body` must be such an integer too. The spec's `minimum` and `maximum` are still left to the API.

Core's error for an integer outside ±9007199254740991 now says so, `Expected an integer from -9007199254740991 to 9007199254740991 for --id; larger ones lose precision.`, instead of `Expected an integer for --id.`

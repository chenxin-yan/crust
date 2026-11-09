---
"@crustjs/openapi": patch
"@crustjs/extensions": patch
"@crustjs/utils": patch
---

`api` works with the `json()` Extension, binary bodies, and large OpenAPI documents.

- **Behavior change:** under `--json`, `api` returns its data, so stdout carries JSON instead of the output moving to stderr. `api <path>` prints the parsed response body (text as a JSON string, nothing for an empty body), `api --list` an array of `{ method, path, operationId?, summary? }`, and `api --spec` the definition. `--paginate` streams one `{"type":"event","data":…}` line per page, then `{"type":"result"}`. A non-2xx response writes its body to stderr and its error JSON has `details` with the HTTP `status`, `method`, and `url`; `json()` prints these for `@crustjs/openapi`'s `ApiResponseError`, and still prints only `message` for other non-Crust errors. Without `--json`, nothing changes for text bodies.
- **Behavior change:** binary response bodies (a non-textual `Content-Type`, or not valid UTF-8) are written to stdout as raw bytes instead of being decoded as UTF-8 and corrupted, so `api /export.zip > export.zip` works. When output is captured as text (`run()`, `captureExecute()`), under `--json`, or on a `--paginate` page, a binary body fails the command instead. An empty body prints nothing whatever its `Content-Type`, so `HEAD` and `204` responses still succeed.
- `api --spec` writes each `$ref` target once: one used once is inlined as before, and one used several times or recursively stays a `$ref` and is written once under a top-level `$refs` object. It used to inline every use, so output grew exponentially and `--spec` hung on large public specs such as Stripe's.
- `api --spec <operationId>` includes the operation's `method` and `path`, and merges the path item's shared `parameters` into its own, so a path parameter declared on the path item, such as `{petId}`, is no longer missing. An `operationId` several operations share fails, naming them, instead of silently picking the first.
- `-X` must be an HTTP method token. An empty value or one with spaces, such as `"DELETE "`, fails with a `PARSE` error before any request, and so does a method the runtime's `fetch()` would not send as given: Bun's `fetch()` sends a method it does not know as `GET`. Standard methods are upper-cased; other methods are sent exactly as given instead of upper-cased.
- `ApiResponseError` messages no longer include the request's query, where `-F` fields of a `GET` (such as a token) end up. `ApiResponseError` also has `method` and `url` (without query, fragment, or user info).

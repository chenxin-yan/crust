---
"@crustjs/openapi": patch
"@crustjs/extensions": patch
"@crustjs/utils": patch
---

`api` works with the `json()` Extension, binary bodies, and large OpenAPI documents.

- **Behavior change:** under `--json`, `api` returns its data, so stdout carries JSON instead of the output moving to stderr. `api <path>` prints the parsed response body (text as a JSON string, nothing for an empty body), `api --list` an array of `{ method, path, operationId?, summary? }`, and `api --spec` the definition. `--paginate` streams one `{"type":"event","data":…}` line per page, then `{"type":"result"}`. A non-2xx response writes its body to stderr and its error JSON has `details` with the HTTP `status`; `json()` prints it for `@crustjs/openapi`'s `ApiResponseError`, and still prints only `message` for other non-Crust errors.
- **Behavior change:** when stdout is a pipe or file, `api <path>` writes the response body as its exact bytes, like `gh api` and `curl`, so `api /export.zip > export.zip` works. It used to decode every body as UTF-8, which corrupted binary ones, and to end the output with exactly one newline; a text body now keeps its own ending, so one without a final newline no longer gains one. When stdout is a terminal, when output is captured as text (`run()`, `captureExecute()`), under `--json`, or on a `--paginate` page, a body prints as text as before, and one that is not valid UTF-8 fails the command instead of printing corrupted (`gh api` and `curl` also refuse to print binary to a terminal).
- `api --spec` writes each `$ref` target once: one used once is inlined as before, and one used several times or recursively stays a `$ref` and is written once under a top-level `$refs` object. It used to inline every use, so output grew exponentially and `--spec` hung on large public specs such as Stripe's.
- `api --spec <operationId>` includes the operation's `method` and `path`, and merges the path item's shared `parameters` into its own, so a path parameter declared on the path item, such as `{petId}`, is no longer missing. An `operationId` several operations share fails, naming them, instead of silently picking the first.
- `-X` must be an HTTP method token. An empty value or one with spaces, such as `"DELETE "`, fails with a `PARSE` error before any request, and so does a method the runtime's `fetch()` would not send, naming what it would send: Bun's `fetch()` sends a method it does not know as `GET`. Methods are upper-cased as before.
- `ApiResponseError` messages no longer include the request's query, where `-F` fields of a `GET` (such as a token) end up.

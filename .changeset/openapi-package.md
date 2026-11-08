---
"@crustjs/openapi": minor
---

New package `@crustjs/openapi`. `apiCommand({ spec, baseUrl, auth, paginate })` adds a `gh api`-style `api` command: `api --list` and `api --spec <operationId|path>` read the bundled OpenAPI document offline, or call a lazy `spec` loader only then (local `$ref`s resolved, recursive ones kept), and `api <path>` sends a request with `-X`, `-H`, gh-typed `-F key=value` fields, `--body <inline|@file|->`, and `--paginate` (one JSON line per page). The response body goes to stdout; a non-2xx status also fails with `ApiResponseError` (exit code 1). It provides the `apiClient` Context, so app commands share the base URL and auth through `(await ctx.api).fetch(path, init)`.

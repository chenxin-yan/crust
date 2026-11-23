---
"@crustjs/openapi": minor
---

Generated commands take the whole request body as `--request-body`, apps can send requests through their own `fetch`, and `api` and `defineApi()` reject inputs they used to ignore.

- `defineApi({ fetch })` sends every request of the client, `api` and the generated commands through the app's own function, one call per hop (the first request, each redirect, each `--paginate` page), so an app can add its own retry, logging or proxy. The only built-in retry stays the 401 refresh. Credentials still go through `.auth()`, which keeps them on the API's origin.
- `ApiResponseError` has the response's `headers`, such as `Retry-After`. Its constructor takes the `Response` and the message.
- `defineApi()` throws a `DEFINITION` error naming the option and the value for a `baseUrl` that is not an `http:` or `https:` URL, such as one without its scheme, instead of a bare `Invalid URL` on the first request.
- `api`: a `-F` key given twice is a `PARSE` error pointing to `--body`, instead of sending only the last value in a JSON body; a repeated query value goes in the path, such as `api '/users?tag=a&tag=b'`. `--list` or `--spec` with a path or a request flag is a `PARSE` error instead of ignoring them.
- A parameter or body field whose flag would be a built-in one (`--request-body`, `--paginate`) fails `crust build` with a fix that names `flagName`.

**Behavior change:** the built-in JSON body flag of generated commands is `--request-body` instead of `--body`, so a body field named `body`, as in GitHub's API, gets its own `--body` flag instead of failing the build. Rename `--body` to `--request-body` in scripts that call generated commands, and `body` to `"request-body"` in their typed `run()` flags and MCP tool arguments. `api <path> --body` is unchanged.

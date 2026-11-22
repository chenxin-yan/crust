---
"@crustjs/openapi": minor
---

`auth` may return an `AuthAttempt` (`{ headers, retry }`): a 401 to a request that carried its headers is retried once, with a replayable body, with the attempt `retry` returns, which later requests and pages then use. `bearerAuth(resolve)` builds one for a bearer token that `resolve` can refresh, such as the `token` of an `@crustjs/auth` client. `auth` receives `{ baseUrl }` as its second argument. An `auth` that returns plain headers works as before.

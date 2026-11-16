---
"@crustjs/auth": minor
---

New package `@crustjs/auth`: building blocks for an OAuth `login` command. `defineAuth({ servers })` declares the authorization servers and `discover()` validates their metadata. `createAuthorizationSession()` runs a browser login over a `127.0.0.1` loopback redirect with PKCE `S256` and `state`, and `startDeviceFlow()` a device-code login (RFC 8628) that keeps to the server's polling interval. `createTokenClient()` exchanges, refreshes, and revokes tokens with bounded responses and no redirects. `detectLoginMode()` picks the browser, a device code, or a refusal on CI; `openBrowser()` launches the system browser without a shell. Several servers must each send `iss` or use their own `redirectPath`, or the browser login refuses (mix-up protection).

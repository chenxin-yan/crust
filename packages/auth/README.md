# @crustjs/auth

OAuth sign-in building blocks for CLIs: PKCE, loopback and device-code login

`defineAuth()` declares the authorization servers your CLI signs in with, `discover()` reads their metadata, and the CLI composes its own `login` command from a browser login over a loopback redirect with PKCE (`createAuthorizationSession()`), a device-code login (`startDeviceFlow()`), `detectLoginMode()`, `openBrowser()`, and a token client (`createTokenClient()`). Built on `fetch`, Web Crypto, and `node:http`, with no other dependency.

## Install

```sh
npm install @crustjs/auth
```

## Documentation

Full docs: [crustjs.com/docs/modules/auth](https://crustjs.com/docs/modules/auth)

## Security checks

Each item of the package's security checklist has tests named after its id (`SEC-C9 …`). `pnpm run check:security` in this directory runs the tests and fails unless every id listed in `tests/security-manifest.ts` for this package has an executed, passed test.

# @crustjs/openapi

Call a CLI's HTTP API and browse its OpenAPI spec from an api command

`apiCommand({ spec, baseUrl, auth, paginate })` adds `<cli> api`, a `gh api`-style escape hatch: `--list` and `--spec` read the bundled OpenAPI document offline, and `api <path>` sends an authenticated request, printing text bodies as text and binary bodies as raw bytes. With the `json()` Extension, `--json` prints each mode's data as JSON on stdout. It also provides the `apiClient` Context, so your own commands share the same base URL and auth.

## Install

```sh
npm install @crustjs/openapi
```

## Documentation

Full docs: [crustjs.com/docs/modules/openapi](https://crustjs.com/docs/modules/openapi)

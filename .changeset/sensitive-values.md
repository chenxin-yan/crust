---
"@crustjs/core": minor
"@crustjs/extensions": minor
"@crustjs/man": minor
"@crustjs/skills": minor
---

Add `sensitive: true` for arguments and flags that hold secrets, such as `{ type: "string", env: { name: "ACME_TOKEN" }, sensitive: true }`. Crust never prints the value: any conversion, `choices`, `parse`, or schema failure reports only `Invalid value for --token.` with the field name in `details` and no cause, `input()` reports only `--input is not valid JSON` for malformed JSON when the command has a sensitive field, `nextSteps()` prints `--token <redacted>`, help and man pages start the description with `Secret.`, generated skills tell agents to pass it through its env variable, and `commandInputSchema()` (used by `schema()`, `input()`, and MCP) marks it `writeOnly` (strings also `format: "password"`) without publishing a schema-backed field's `enum`, `const`, `default`, `examples`, or `x-*` keywords. Snapshots carry `sensitive: true`. A sensitive definition with a `default` or `choices` fails typecheck and throws a `DEFINITION` error (`sensitive-default`, `sensitive-choices`). Crust can't hide argv from the OS (`ps`, shell history), so prefer `env`.

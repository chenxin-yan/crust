---
"@crustjs/core": patch
---

Extend `ValueType` with `"url"`, `"path"`, and `"json"` (resolving to `URL`, absolute `string`, and `unknown`). Add a `parse?: (raw: string) => unknown` escape hatch on `StringFlagDef`/`StringMultiFlagDef`/`StringArgDef`; every non-string variant declares `parse?: never`, so misuse is rejected at compile time. Async `parse` functions are rejected at command setup via a new `CONFIG` error code. Fix: when `parse` is set and argv is absent but `default` is present, `parse(String(default))` now runs so the runtime value matches the inferred type. **Behavior change:** `choices` on string flags/args is now enforced at parse time (previously hint-only); raw argv is validated against `choices` before any `parse` transform runs.

---
"@crustjs/store": minor
---

Add `mode` and `dirMode` options to `createStore` for controlling file and
directory permissions.

Config/state stores that hold secrets (tokens, API keys) can now be persisted
owner-only on Unix without relying on the process `umask`. The requested `mode`
is enforced exactly on the temp file before the atomic rename, so the persisted
file is never momentarily group/other-readable. `dirMode` is applied only when a
write creates the directory; pre-existing directories are left untouched. Both
are no-ops on Windows. When omitted, behavior is unchanged (platform default).

```ts
createStore({
  dirPath: configDir("my-cli"),
  name: "auth",
  fields: { token: { type: "string" } },
  mode: 0o600,
  dirMode: 0o700,
});
```

---
"@crustjs/store": minor
---

Add an `access` option to `createStore` for controlling persistence visibility.

Config/state stores that hold secrets (tokens, API keys) can now be persisted
owner-only on Unix without relying on the process `umask` by setting
`access: "private"`. This maps to `0600` for the persisted file and `0700` for
the parent directory when the store creates it. The only built-in presets are
`"default"` and `"private"`; advanced callers can pass explicit Unix permission
bits with `access: { file, directory }` for group-readable or public non-secret
stores.

The requested file bits are enforced exactly on the temp file before the atomic
rename, so the persisted file is never momentarily group/other-readable.
Directory bits are applied only when a write creates the directory;
pre-existing directories are left untouched. Permission bits are a no-op on
Windows. When omitted, behavior is unchanged (platform default).

```ts
createStore({
  dirPath: configDir("my-cli"),
  name: "auth",
  fields: { token: { type: "string" } },
  access: "private",
});
```

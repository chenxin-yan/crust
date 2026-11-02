---
"@crustjs/extensions": minor
---

`updateNotifier()` now skips the update check entirely (no cache read, network request, or notice) when `CI` is set (other than `0`/`false`), when `NO_UPDATE_NOTIFIER` is non-empty, or when `process.stderr` is not a TTY. Calling `updateNotifier()` without a string `currentVersion` now requires root `version` metadata at compile time, matching `version()`. Extension factories are marked `/* @__PURE__ */` so bundlers drop unused extensions, and `renderHelp()` no longer documents grandchildren it never prints.

---
"@crustjs/core": patch
---

A command snapshot's `subCommands` and `flags` records, and an exclusive group's member `flags`, have no prototype. Looking up an untrusted word, as `snapshot.subCommands[word]` for `mycli help constructor`, used to return an inherited `Object.prototype` member instead of `undefined`, which crashed code that then read `.meta` from it.

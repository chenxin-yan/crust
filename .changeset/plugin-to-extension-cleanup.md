---
"@crustjs/extensions": patch
"@crustjs/skills": patch
"@crustjs/crust": patch
"@crustjs/core": patch
---

Finish the plugin→extension rename: user-facing error messages now say "extension" (completion validation errors, pre-compile timeout hint), and internal `*Extension` factory names were dropped in favor of the public short names (`help`, `version`, `completion`, `didYouMean`, `noColor`, `updateNotifier`, `skill`). Public APIs are unchanged.

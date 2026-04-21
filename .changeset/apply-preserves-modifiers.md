---
"@crustjs/style": patch
---

Fix `apply()` stripping modifier ANSI codes when only colors are disabled (e.g. `NO_COLOR` on a TTY). `apply()` now distinguishes registered modifier pairs from color pairs and gates each on `modifiersEnabled` / `colorsEnabled` independently, matching the behaviour of chained methods like `s.bold()`.

Centralize modifier classification in `styleMethodRegistry` via new `modifierNames`, `isModifierName`, and `isModifierPair` exports, removing the hardcoded modifier list duplicated in `applyChain`. A compile-time assertion enforces that every modifier name remains a valid registered style method.

---
"@crustjs/style": minor
---

Remove the redundant static color and modifier `*Code` aliases; use the matching chainable exports directly as `AnsiPair` values. Keep the dynamic `fgCode`, `bgCode`, and `linkCode` factories.

Remove `TrueColorOverrides` and move its optional `colorTerm` and `term` fields onto `CapabilityOverrides`.

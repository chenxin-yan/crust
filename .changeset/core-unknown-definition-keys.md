---
"@crustjs/core": minor
---

A property a definition doesn't have is now a compile error (`FIX_UNKNOWN_PROPERTY`) in `.flags()`, `.args()`, `defineFlag()`, `defineArg()`, a Context's or Extension's `.flags()`, and a command's config. A misspelled key such as `requried` or `chocies` used to compile and be ignored.

A misspelled key set to `undefined` is rejected too, and `.args()` now checks every branch of a conditional argument tuple, so a typo or a misplaced variadic in one branch no longer compiles.

```ts
defineFlag({ type: "string", requried: true });
//                           ~~~~~~~~ Unknown property "requried"
```

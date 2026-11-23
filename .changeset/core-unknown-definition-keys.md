---
"@crustjs/core": minor
---

A property a definition doesn't have is now a compile error (`FIX_UNKNOWN_PROPERTY`) in `.flags()`, `.args()`, `defineFlag()`, `defineArg()`, a Context's or Extension's `.flags()`, and a command's config. A misspelled key such as `requried` or `chocies` used to compile and be ignored.

```ts
defineFlag({ type: "string", requried: true });
//                           ~~~~~~~~ Unknown property "requried"
```

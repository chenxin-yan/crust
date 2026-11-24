---
"@crustjs/core": patch
---

`ExtensionContext.sources` maps have no prototype, so `ctx.sources.flags[name] === undefined` holds for an unset flag or argument named like an `Object.prototype` member, such as `constructor` or `toString`.

---
"@crustjs/core": minor
---

Add `defer(cleanup)` to Context setup. Cleanup registered with `defer` runs after post-run hooks in reverse registration order, including when the action or a later step of the same setup throws, so a value no longer needs a `[Symbol.dispose]` method to release what setup opened. Returned disposable values are still disposed automatically. Calling `defer` after setup has settled throws a `DEFINITION` error.

```ts
// before
defineContext("database", () => {
  const db = open();
  return { ...db, [Symbol.dispose]: () => db.close() };
});

// after
defineContext("database", ({ defer }) => {
  const db = open();
  defer(() => db.close());
  return db;
});
```

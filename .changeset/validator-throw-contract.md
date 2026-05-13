---
"@crustjs/prompts": minor
"@crustjs/store": patch
---

Unified validator contract: throw on fail, void on success.

Every hand-rolled function validator across the workspace now follows the
**same rule**: return `void` (or `Promise<void>`) when the value is valid;
**throw an `Error`** to reject. The thrown error's `message` is what the
caller surfaces (rendered inline by prompts, captured as the issue text by
store).

This unifies what was previously two contracts:

| Surface                                                | Before                                                 | After                                             |
| ------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------- |
| `@crustjs/prompts` `input()` / `password()` `validate` | `(v) => true \| string \| Promise<…>`                  | `(v) => void \| Promise<void>`, throws on failure |
| `@crustjs/store` `FieldDef.validate`                   | `(v) => void \| Promise<void>` (already throw-on-fail) | unchanged                                         |

### `@crustjs/prompts` (major) — breaking change

`ValidateFn<T>` is now `(value: T) => void | Promise<void>`. Throw to
reject. The `ValidateResult` type alias is removed (there is no return
value).

```ts
// Before
input({
  message: "Email?",
  validate: (v) => v.includes("@") || "Must contain @",
});

// After
input({
  message: "Email?",
  validate: (v) => {
    if (!v.includes("@")) throw new Error("Must contain @");
  },
});
```

Inline error rendering is unchanged — prompts catches the thrown `Error`
and renders `err.message` below the prompt, identical to how schema issues
are rendered.

A runtime **fail-fast guard** is added: if a `validate` function returns
any value other than `undefined`, prompts throws a `TypeError` naming the
unexpected return type. This catches the common migration mistake of
leaving a `return true || "..."` expression in place.

Schema-driven validation (`validate: zSchema`) is unchanged.

### `@crustjs/store` (patch)

Same fail-fast guard added to `FieldDef.validate`: returning any value
other than `undefined` now throws a `TypeError`. The throw-on-fail
contract has always been the documented one — the guard prevents the
silent-success bug that came from older docs incorrectly suggesting a
`{ ok, value } | { ok, issues }` return shape.

Existing throw-based custom validators are unaffected.

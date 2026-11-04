---
"@crustjs/core": minor
---

Literal definition mistakes now fail typecheck, and computed values throw a runtime `DEFINITION` error.

- Breaking: a flag name, alias, or `short` must not contain whitespace or start with `-`, and a name or alias must not contain `=`. Such spellings used to register without error: the parser adds the dashes and splits `--name=value` at the first `=`, so a name like `"a=b"` could never be matched, and `"--output"` as an alias meant typing `----output`. Literal spellings now fail typecheck (`FIX_SPELLING_SHAPE`), and dynamic ones throw a `DEFINITION` error (`reason: "invalid-spelling"`). To migrate, drop the dashes (`aliases: ["output"]`) or pick another name.
- An empty literal `env.name`, `delimiter`, or `env.delimiter` fails typecheck (`FIX_EMPTY_ENV`, `FIX_EMPTY_DELIMITER`).
- `defineExtensionId()` rejects an empty or untrimmed literal id (`FIX_EXTENSION_ID`).

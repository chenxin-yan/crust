---
"@crustjs/prompts": patch
"@crustjs/testing": patch
---

`keys()` on the prompt/interactive test harnesses now autocompletes named key names. The `@crustjs/prompts/testing` subpath exports the new `Key` and `NamedKey` types; `ctrl+<letter>` and single printable characters remain accepted.

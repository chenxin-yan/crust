---
"@crustjs/prompts": minor
---

Complete the custom-prompt rendering kit and simplify its testing API.

- Export the text, match, line, choice-list, and glyph rendering helpers used by built-in prompts.
- Remove `pressKey()` from `@crustjs/prompts/testing` (breaking). Use the rendered prompt's `keys()` method for named and control keys, or `type()` for literal text.

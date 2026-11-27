---
"@crustjs/prompts": minor
---

New entry `@crustjs/prompts/extension` with the `prompts()` Extension and a `prompt: "question"` key on arguments and flags. With `prompts()` in `.extend()`, a command asks on a terminal for each value that has a `prompt` and no value before its action runs: yes or no for a boolean, a list for `choices`, several picks for `choices` with `multiple` or `variadic`, otherwise text, converted as the same word on the command line and asked again with the command line's error when it does not convert. A default is preselected. A value from argv, an environment variable, or `--input` is never asked for, and nothing is asked under typed `run()` or where `canPrompt()` is false, so the command's own "Missing required" error still applies there.

`@crustjs/core` is an optional peer dependency, needed only by the new entry; the main entry never loads it. See [Ask for missing values](https://crustjs.com/docs/modules/prompts#ask-for-missing-values).

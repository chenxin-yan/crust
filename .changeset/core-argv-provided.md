---
"@crustjs/core": minor
---

Add `ExtensionContext.argvProvided`, listing the argument names and canonical flag names given explicitly on argv, and whether argv left passthrough tokens after `--` (`raw`, a boolean; the tokens stay in `rawArgs`). Environment values and `bindInput` do not change it, and it is empty under typed `run()`. Extensions that convert structured input before `bindInput` use it to skip keys argv overrides.

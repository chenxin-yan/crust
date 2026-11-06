---
"@crustjs/core": minor
---

Add `ExtensionContext.argvProvided`, listing the argument names, canonical flag names, and passthrough tokens (`raw`) given explicitly on argv. Environment values and `bindInput` do not change it, and it is empty under typed `run()`. Extensions that convert structured input before `bindInput` use it to skip keys argv overrides.

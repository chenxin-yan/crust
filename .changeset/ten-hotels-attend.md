---
"create-crust": patch
---

Reject a project directory whose basename is unsafe for template interpolation or the generated command (quotes, spaces, leading `.` or `-`, or Core's reserved `__proto__`) before writing, whether it comes from the positional argument, the prompt, or the current directory for `.`. Previously such names produced invalid package.json/TypeScript or unusable commands. This checks interpolation/bin safety, not the complete npm package-name rules.

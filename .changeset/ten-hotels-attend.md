---
"create-crust": patch
---

Reject a project directory whose basename is not a valid package and command name (quotes, spaces, leading `.` or `-`, …) before writing, whether it comes from the positional argument, the prompt, or the current directory for `.`. Previously such names produced invalid package.json/TypeScript or unusable bin names.

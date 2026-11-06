---
"@crustjs/extensions": patch
"@crustjs/man": patch
---

Help shows what a value flag takes. `help()` prints the flag's type after its spellings, such as `-c, --count <number>`, and generated man pages add the matching argument (`-c, --count number`). Boolean flags are unchanged. Choices, defaults, and env variables still appear after the description. A label wider than its column now widens the column instead of pushing its description out of line.

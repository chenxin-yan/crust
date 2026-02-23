---
"@crustjs/crust": patch
---

Replace Node.js resolver with POSIX shell script and Windows `.cmd` batch file for multi-target builds. The resolver no longer requires Node.js or Bun to dispatch to the correct platform binary.

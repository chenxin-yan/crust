---
"@crustjs/core": patch
"@crustjs/crust": patch
---

Add ancestor command-token conflict checks for subcommands.

Subcommand names and aliases now fail fast when they reuse an ancestor command's name or alias. Statically-authored command trees get TypeScript editor feedback, and runtime validation still covers plugin-installed or otherwise dynamic subcommands.

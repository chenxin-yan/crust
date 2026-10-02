---
"@crustjs/extensions": patch
---

Shell completion now reads every flag spelling from Core's documentation model. Bash and zsh offer `-P` for a one-character alias and route past its value (`mycli -P 9090 serve <Tab>` completes `serve`'s subcommands), and fish offers `-P` as a short option.

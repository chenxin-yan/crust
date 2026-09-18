---
"@crustjs/extensions": patch
---

Fix generated shell completions: Bash `path` value completion now keeps filenames containing spaces or glob characters as single candidates (and asks readline to quote them), and Zsh helper functions use an injective `_<bin>__<segment>` encoding so distinct commands such as `foo-bar` and `foo_bar` no longer overwrite each other's completions. Regenerate saved completion scripts.

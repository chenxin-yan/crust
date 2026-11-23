---
"@crustjs/man": minor
---

`man()` writes a page for every visible command, named by its path as `git-commit(1)` is: `my-cli remote add` gets `man/my-cli-remote-add.1`. Each page documents that command's synopsis, options (inherited ones included), arguments, examples and sections, and a `SEE ALSO` names its parent's and children's pages. The root page no longer collects the subcommands' sections under `COMMANDS`; each command's sections are on its own page. `renderManPageMdoc()` and `writeManPage()` take `path` to render one command's page. The build fails when a page name is not a valid command name or two commands share one.

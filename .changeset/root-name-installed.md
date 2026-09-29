---
"@crustjs/man": patch
"@crustjs/extensions": patch
---

Remove the `man({ name })` and `completion({ binName })` options, and the `name` option of `renderManPageMdoc()` and `writeManPage()`. Man pages and completion scripts now always use the root command name, which `crust build` already requires to match the installed command. To change the installed name, rename the root: `new Crust("my-tool")`.

---
"@crustjs/completion": minor
---

New package `@crustjs/completion`: the `completion()` Extension and the `renderBashCompletion()`, `renderZshCompletion()`, and `renderFishCompletion()` renderers move here from `@crustjs/extensions`, which no longer exports them. Replace `import { completion } from "@crustjs/extensions"` with `import { completion } from "@crustjs/completion"`.

- `complete: (typed) => string[] | Promise<string[]>` on an argument, or on a flag that takes a value, gives it live candidates: the generated scripts run the CLI's hidden `__complete` command, which calls the function with the word being completed. The key is known once a project imports the package; without `completion()` installed it is an `unowned-key` definition error.
- PowerShell: `completion powershell` and `renderPowerShellCompletion()`. `--output-dir` and the build hook also write `<bin>.ps1`.
- A short Core accepts but completion rejected, such as ripgrep's `-.`, now works: each script quotes it for its shell instead of failing with `invalid flag short alias`, which also failed `crust build`.
- Bash completes `--flag=value`: pressing Tab after `--target=br` inserted `--target=--target=browser` with bash-completion loaded, and nothing without it.

See [Completion](https://crustjs.com/docs/modules/completion).

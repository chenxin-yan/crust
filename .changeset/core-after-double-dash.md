---
"@crustjs/core": patch
"@crustjs/extensions": patch
"@crustjs/man": patch
"@crustjs/skills": patch
---

Arguments can take only the tokens after `--`. Set `afterDoubleDash: true` on the last argument (like clap's `Arg::last`) to write a task runner such as `run <task> [packages...] -- <extra...>`: `run build core -- --watch` sets `packages` to `["core"]` and `extra` to `["--watch"]`. The other arguments fill only from tokens before `--`, tokens after it that the argument doesn't take reach `rawArgs`, and a missing required one reports `Missing required argument "<extra>" (pass it after "--")`. Help, man pages, skills, and `--llms` show it as `[-- <extra>...]`. Typed `run()`, `--input`, and MCP take it by name. `nextSteps()` prints it after `--`. Only the last argument can set it, and the argument before it may be variadic; anything else is a TypeScript error and a `DEFINITION` error (`after-double-dash-position`).

Without the option, `--` works as in 0.6.0 and as POSIX specifies: later tokens are never flags, still fill empty arguments in order (`seek -- -5` binds `-5`), and the rest reach `rawArgs`.

Shell completion now follows the same rules: after `--` it offers no flags or subcommands, keeps completing argument slots, and offers an `afterDoubleDash` argument's values only there. As before, zsh completes arguments only for commands without subcommands.

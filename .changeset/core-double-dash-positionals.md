---
"@crustjs/core": minor
"@crustjs/mcp": patch
---

Tokens after `--` now fill positional arguments. A positional value that starts with `-` can be passed after `--`, so `seek -- -5` binds `-5` to the first positional argument. Before, `seek -5` failed with `Unknown flag`, and `seek -- -5` left `-5` in `rawArgs`, so a required positional argument was reported missing. Tokens after `--` still never parse as flags.

**Behavior change:** declared positional arguments that are still unfilled take tokens after `--` first, and only the remaining tokens reach the action as `rawArgs`. A command without positional arguments keeps receiving every token after `--` in `rawArgs`. A command with an optional or variadic positional argument now binds the first token after `--` (or all of them, for a variadic argument) to that argument. For example, `wrap [target] -- --watch src` now sets `target` to `--watch` and `rawArgs` to `["src"]`, where `target` used to be `undefined` and `rawArgs` held both tokens. To keep forwarding everything after `--`, pass every non-variadic positional value before `--`, or read them from `rawArgs` and drop the positional argument. A variadic positional argument now takes every token after `--` (`wrap src -- --watch` with `files...` sets `files` to `["src", "--watch"]`), so a command that forwards `rawArgs` should not declare one. `run()`'s `raw` input is unchanged and never fills `args`.

The MCP tool schema's `raw` description no longer says its values act as if written after `--`; they are received as `rawArgs` and never fill arguments.

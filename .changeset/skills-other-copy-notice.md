---
"@crustjs/skills": minor
---

Before a command runs, an installed CLI now prints one stderr line when an agent's skill link points at another installed copy of the CLI, naming the `skills repair` command that re-points it. The link is still left alone. The line follows `updateNotifier()`'s skip rules: nothing under CI, when `NO_UPDATE_NOTIFIER` is set, or when stderr is not a terminal.

A link now counts as linked when it leads to this copy's skill directory through another link, as in the `.claude/skills/<name>` → `.agents/skills/<name>` layout that `npx skills` writes: real paths are compared, so such a link gets no notice and `skills repair` and `skills install` leave it as it is.

The agent list is now generated from the registry of the `skills` package (1.8.1): 78 agents instead of 37. Removed: `xum`. Added: `aider-desk`, `antigravity-cli`, `astrbot`, `autohand-code`, `bob`, `codearts-agent`, `codemaker`, `codestudio`, `continue`, `deepagents`, `dexto`, `eve`, `firebender`, `forgecode`, `fx`, `grok`, `hermes-agent`, `iflow-cli`, `inference-sh`, `jazz`, `kimchi`, `lingma`, `loaf`, `mcpjam`, `minimax-code`, `moxby`, `mux`, `neovate`, `ona`, `posit-assistant`, `promptscript`, `qoder-cn`, `reasonix`, `roo`, `rovodev`, `sarvam-code`, `tabnine-cli`, `terramind`, `tinycloud`, `windsurf`, `zcode`, and `zenflow`. Directories follow upstream, so some agents moved: amp, augment, command-code, crush, cursor, devin, droid, gemini-cli, github-copilot, goose, junie, kilo, mistral-vibe, opencode, openclaw, openhands, pochi, qwen-code, replit, and zencoder are no longer Universal because they use their own directory in at least one scope. `AgentTarget` is the generated id union. Agents without a global skills directory (eve, promptscript) are offered only at project scope, and naming one at global scope is an error. `CLAUDE_CONFIG_DIR` still relocates Claude Code's global directory; upstream's other environment overrides and per-platform paths are not carried.

Agents are no longer detected through a `PATH` lookup. An additional agent counts as installed when the folder containing its global skills directory exists, such as `~/.claude` for `~/.claude/skills`; project folders, the home directory itself, and the shared `~/.agents` do not count.

The Extension no longer registers its build hook inside a bundle that `crust build` produces, so a CLI built with Crust no longer ships the skill renderer: a one-command CLI with `skill({})` bundles about 11 KB smaller.

---
"@crustjs/skills": minor
---

Refresh the agent registry against each agent's current documentation.

- **Now universal.** Augment, Command Code, Crush, Droid, Goose, Junie, Kilo Code, Mistral Vibe, OpenClaw, OpenHands, Pochi, Qwen Code, and Zencoder read `.agents/skills/` and `~/.agents/skills/`, so the universal link covers them. They no longer get a second link in their own directories, which made these agents load the skill twice.
- **Renamed.** `windsurf` is now `devin` (Windsurf became Devin Desktop), `mux` is now `xum` (Mux became Xum), and `kimi-cli` is now `kimi-code-cli`. All three are universal.
- **Removed.** `roo` and `iflow-cli` (both discontinued), `continue` (no longer maintained), `mcpjam` (an MCP testing tool, not a coding agent), and `neovate`.
- **Detection.** `PATH` detection now looks for `agy` (Antigravity CLI), `cbc` (CodeBuddy), and `qodercli` (Qoder). It no longer looks for `claude-code`, which is not a real command. Trae CN no longer matches Trae's `trae` command.
- **API.** `getAdditionalAgents()` and `isUniversalAgent()` are no longer exported.

Links in the old agent-specific directories (for example `~/.factory/skills/`, `~/.kilocode/skills/`, `.augment/skills/`, `~/.codeium/windsurf/skills/`) are no longer managed. Remove them manually if present.

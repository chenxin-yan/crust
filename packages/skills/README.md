# @crustjs/skills

Package and install agent skills for Crust CLIs.

## Install

```sh
bun add @crustjs/skills
```

## Supported agents

Universal agents share `.agents/skills` for projects and `~/.agents/skills` globally:

- `amp`, `cline`, `codex`, `cursor`, `gemini-cli`, `github-copilot`, `kimi-cli`, `opencode`, `pi`, `replit`, `warp`, `zed`

Additional `AgentTarget` values use each agent's own convention. Antigravity is partial: it uses `.agents/skills` for projects and `~/.gemini/config/skills` globally. Mistral Vibe uses `$VIBE_HOME/skills` globally, falling back to `~/.vibe/skills`.

## Documentation

Full docs: [crustjs.com/docs/modules/skills](https://crustjs.com/docs/modules/skills)

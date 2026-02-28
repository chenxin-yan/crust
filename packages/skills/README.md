# @crustjs/skills

Generate distributable AI agent skills from [Crust](https://crustjs.com) command definitions.

Instead of hand-maintaining skill files for AI coding agents, generate them from your `defineCommand` metadata. The output is a portable skill bundle that developers can download and install into their own agent environments (OpenCode, Claude Code, etc.).

## Install

```sh
bun add @crustjs/skills
```

## Quick Start

### CLI (via `@crustjs/crust`)

```sh
crust skills generate ./src/cli.ts --name my-cli --description "My CLI tool"
```

### Programmatic API

```ts
import { generateSkill } from "@crustjs/skills";
import { rootCommand } from "./commands.ts";

const result = await generateSkill({
  command: rootCommand,
  meta: {
    name: "my-cli",
    description: "CLI tool for managing widgets",
    version: "1.0.0",
  },
  agents: ["opencode", "claude-code"],
});

for (const agent of result.agents) {
  console.log(`${agent.agent}: ${agent.status} -> ${agent.outputDir}`);
}
```

### Runtime Plugin (`autoUpdate`)

`skillPlugin()` is a runtime plugin. Register it in `runMain(..., { plugins })`.
Do not put a `plugins` field inside `defineCommand(...)`.

```ts
import { defineCommand, runMain } from "@crustjs/core";
import { skillPlugin } from "@crustjs/skills";

const app = defineCommand({
  meta: { name: "my-cli", description: "My CLI" },
  run() {
    console.log("hello");
  },
});

runMain(app, {
  plugins: [
    skillPlugin({
      version: "1.0.0",
      // autoUpdate: true (default) — silently updates installed skills
      // command: true (default) — registers "my-cli skill" subcommand
    }),
  ],
});
```

The plugin automatically updates already-installed skills when the version changes. First-time installation is done via the interactive `skill` subcommand, or programmatically using the exported primitives.

### Programmatic Auto-Install

For full control over first-time installation, use the exported primitives
directly in your own setup logic:

```ts
import { defineCommand, runMain } from "@crustjs/core";
import { detectInstalledAgents, generateSkill, skillStatus } from "@crustjs/skills";

const app = defineCommand({
  meta: { name: "my-cli", description: "My CLI" },
  async run() {
    // Detect agents and install skills if not yet present
    const agents = await detectInstalledAgents({ scope: "global" });
    const status = await skillStatus({ name: "my-cli", agents, scope: "global" });

    const notInstalled = status.agents
      .filter((a) => !a.installed)
      .map((a) => a.agent);

    if (notInstalled.length > 0) {
      await generateSkill({
        command: app,
        meta: { name: "my-cli", description: "My CLI", version: "1.0.0" },
        agents: notInstalled,
        scope: "global",
      });
    }
  },
});

runMain(app);
```

#### Troubleshooting

If auto-update does not appear to work:

- Ensure plugin is passed to `runMain(..., { plugins: [...] })`.
- Ensure at least one supported agent is detected for your scope:
  - `scope: "global"` -> `~/.claude` or `~/.config/opencode`
  - `scope: "project"` -> `<cwd>/.claude` or `<cwd>/.opencode` (falls back to global roots)
- Check for existing conflicting skill directories without `crust.json`.

## Recommended Export Pattern

To avoid side effects when your command module is imported for generation, guard runtime code with `import.meta.main`:

```ts
import { defineCommand, runMain } from "@crustjs/core";

// Export the command object — used by skill generation
export const rootCommand = defineCommand({
  meta: { name: "my-cli", description: "My CLI tool" },
  run({ args }) {
    console.log("Hello from my-cli!");
  },
});

// Only run when executed directly — not when imported for generation
if (import.meta.main) {
  runMain(rootCommand);
}
```

This pattern lets `crust skills generate` import the command definition without triggering `runMain`.

## CLI Usage

The `crust skills generate` command is provided by `@crustjs/crust`:

```sh
crust skills generate <module> [options]
```

### Arguments

| Argument | Description                                      |
| -------- | ------------------------------------------------ |
| `module` | Path to the command module (e.g. `./src/cli.ts`) |

### Flags

| Flag            | Alias | Required | Default   | Description                                    |
| --------------- | ----- | -------- | --------- | ---------------------------------------------- |
| `--name`        | `-n`  | Yes      | -         | Skill name (used as directory name)            |
| `--description` | `-d`  | Yes      | -         | Human-readable description                     |
| `--version`     | `-V`  | No       | -         | Version string                                 |
| `--out-dir`     | `-o`  | No       | `.`       | Output directory                               |
| `--clean`       | -     | No       | `true`    | Remove existing skill directory before writing |
| `--export`      | `-e`  | No       | `default` | Named export to use from the module            |

### Examples

```sh
# Basic generation
crust skills generate ./src/cli.ts --name my-cli --description "My CLI"

# With version and custom output directory
crust skills generate ./src/cli.ts -n my-cli -d "My CLI" --version 1.0.0 -o ./dist

# Using a named export instead of the default export
crust skills generate ./src/cli.ts -n my-cli -d "My CLI" --export rootCommand

# Keep existing files (no clean)
crust skills generate ./src/cli.ts -n my-cli -d "My CLI" --no-clean
```

## Programmatic API

### `generateSkill(options)`

High-level API that runs the full pipeline: introspection, rendering, and writing to disk.

The `meta.name` must be a valid skill name — lowercase alphanumeric with hyphens, 1–64 characters (validated against the [Agent Skills spec](https://agentskills.io/specification) pattern). Use `isValidSkillName()` to check before calling.

```ts
import { generateSkill } from "@crustjs/skills";

const result = await generateSkill({
  command: rootCommand,
  meta: { name: "my-cli", description: "My CLI tool", version: "1.0.0" },
  agents: ["opencode"],
  scope: "project", // default: "global"
  clean: true, // default: true — removes existing skill dir first
  force: false, // default: false — throws SkillConflictError if dir exists without crust.json
});

// result.agents — per-agent install results
```

### `buildManifest(command)`

Introspects a command tree and produces a canonical, serializable manifest.

```ts
import { buildManifest } from "@crustjs/skills";

const manifest = buildManifest(rootCommand);
// manifest.name, manifest.path, manifest.args, manifest.flags, manifest.children
```

### `renderSkill(manifest, meta)`

Renders markdown files from a manifest tree without writing to disk.

```ts
import { buildManifest, renderSkill } from "@crustjs/skills";

const manifest = buildManifest(rootCommand);
const files = renderSkill(manifest, { name: "my-cli", description: "My CLI" });

for (const file of files) {
  console.log(file.path); // e.g. "SKILL.md", "commands/serve.md"
  console.log(file.content); // markdown content
}
```

### `isValidSkillName(name)`

Validates a skill name against the [Agent Skills spec](https://agentskills.io/specification) pattern: 1–64 lowercase alphanumeric characters and hyphens, no leading/trailing/consecutive hyphens.

```ts
import { isValidSkillName } from "@crustjs/skills";

isValidSkillName("my-cli"); // true
isValidSkillName("My_CLI"); // false — uppercase and underscores not allowed
isValidSkillName("-leading"); // false — leading hyphen
isValidSkillName("a".repeat(65)); // false — exceeds 64 characters
```

> **Note:** `generateSkill()` automatically validates `meta.name` (after prepending `use-`) and throws a descriptive error if the name is invalid.

## Skill Metadata

The `SkillMeta` object controls the generated `SKILL.md` frontmatter. Beyond the required `name`, `description`, and `version` fields, several optional fields are supported:

```ts
const meta: SkillMeta = {
  name: "my-cli",
  description: "CLI tool for managing widgets",
  version: "1.0.0",

  // Optional fields — emitted in SKILL.md YAML frontmatter when set
  allowedTools: "Bash(my-cli *) Read Grep", // Pre-approved tools (avoids per-use prompts)
  license: "MIT", // License name or reference
  compatibility: "Requires my-cli on PATH", // Environment requirements (max 500 chars)
  disableModelInvocation: false, // true = agent won't auto-load; user must invoke manually
};
```

| Field                    | Frontmatter Key            | Description                                                                  |
| ------------------------ | -------------------------- | ---------------------------------------------------------------------------- |
| `allowedTools`           | `allowed-tools`            | Space-delimited list of pre-approved tools (e.g. `Bash(my-cli *) Read Grep`) |
| `license`                | `license`                  | License name or file reference                                               |
| `compatibility`          | `compatibility`            | Environment requirements or compatibility notes                              |
| `disableModelInvocation` | `disable-model-invocation` | When `true`, prevents agents from auto-loading the skill                     |

## Escaping

The renderer automatically handles special characters in generated output:

- **YAML frontmatter**: Values containing YAML-special characters (`:`, `#`, `*`, `!`, `[`, `{`, `'`, `"`, etc.) are wrapped in double quotes with internal quotes escaped.
- **Markdown tables**: Literal `|` characters in argument/flag descriptions are escaped as `\|` to prevent broken table rendering.

No manual escaping is needed — pass raw values and the renderer handles the rest.

## Output Structure

Generated output goes to `<outDir>/skills/use-<name>/` (the `use-` prefix is applied automatically):

```
skills/use-my-cli/
  SKILL.md            # Entrypoint — loaded by the agent
  command-index.md    # Maps all commands to documentation file paths
  commands/           # Per-command documentation mirroring the CLI hierarchy
    my-cli.md         # Root command
    serve.md          # Subcommand
    db/
      migrate.md      # Nested subcommand
      seed.md
  crust.json          # Machine-readable bundle metadata (Crust ownership marker)
```

### File Details

| File               | Purpose                                                                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SKILL.md`         | Agent entrypoint with YAML frontmatter. Directs agents to load specific command files on demand (lazy loading).                                                                                    |
| `command-index.md` | Markdown table listing every command, its type (runnable/group), and documentation path.                                                                                                           |
| `commands/*.md`    | Per-command reference files. Leaf commands include usage, arguments, flags, defaults, and aliases. Group commands list subcommands with links.                                                     |
| `crust.json`       | Crust-specific JSON metadata: name, description, version, entrypoint, and list of all command paths. Also serves as an ownership marker — its presence indicates the skill was generated by Crust. |

## Conflict Detection

Each skill directory contains a `crust.json` file that acts as an ownership marker. If `generateSkill()` encounters an existing directory without `crust.json`, it throws a `SkillConflictError` to prevent overwriting skills created manually or by other tools.

Pass `force: true` to overwrite, or handle the error:

```ts
import { generateSkill, SkillConflictError } from "@crustjs/skills";

try {
  await generateSkill({ command, meta, agents });
} catch (err) {
  if (err instanceof SkillConflictError) {
    console.error(`Conflict: ${err.details.outputDir}`);
    // err.details.agent — the agent where the conflict occurred
  }
}
```

## Installing Generated Skills

After generating a skill bundle, consumers can install it by copying the skill directory.

### OpenCode

```sh
cp -r skills/use-my-cli/ .opencode/skills/use-my-cli/
```

### Claude Code

```sh
cp -r skills/use-my-cli/ .claude/skills/use-my-cli/
```

The agent will discover the skill from `SKILL.md` and load command documentation on demand from the `commands/` directory.

## Documentation

See the full docs at [crustjs.com](https://crustjs.com).

## License

MIT

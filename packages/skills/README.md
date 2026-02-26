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
});

console.log(`Generated ${result.files.length} files to ${result.outputDir}`);
```

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

| Argument | Description |
| -------- | ----------- |
| `module` | Path to the command module (e.g. `./src/cli.ts`) |

### Flags

| Flag | Alias | Required | Default | Description |
| ---- | ----- | -------- | ------- | ----------- |
| `--name` | `-n` | Yes | - | Skill name (used as directory name) |
| `--description` | `-d` | Yes | - | Human-readable description |
| `--version` | `-V` | No | - | Version string |
| `--out-dir` | `-o` | No | `.` | Output directory |
| `--clean` | - | No | `true` | Remove existing skill directory before writing |
| `--export` | `-e` | No | `default` | Named export to use from the module |

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

```ts
import { generateSkill } from "@crustjs/skills";

const result = await generateSkill({
  command: rootCommand,
  meta: { name: "my-cli", description: "My CLI tool", version: "1.0.0" },
  outDir: "./dist",  // default: "."
  clean: true,       // default: true — removes existing skill dir first
});

// result.outputDir — absolute path to the generated skill directory
// result.files     — sorted list of written file paths (relative to outputDir)
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
  console.log(file.path);    // e.g. "SKILL.md", "commands/serve.md"
  console.log(file.content); // markdown content
}
```

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
  manifest.json       # Machine-readable bundle metadata
```

### File Details

| File | Purpose |
| ---- | ------- |
| `SKILL.md` | Agent entrypoint with YAML frontmatter. Directs agents to load specific command files on demand (lazy loading). |
| `command-index.md` | Markdown table listing every command, its type (runnable/group), and documentation path. |
| `commands/*.md` | Per-command reference files. Leaf commands include usage, arguments, flags, defaults, and aliases. Group commands list subcommands with links. |
| `manifest.json` | JSON metadata: name, description, version, entrypoint, and list of all command paths. |

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

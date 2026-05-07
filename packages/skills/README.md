# @crustjs/skills

Generate distributable AI agent skills from [Crust](https://crustjs.com) command definitions.

Instead of hand-maintaining skill files for AI coding agents, generate them from your Crust command metadata. The output is a portable skill bundle that developers can download and install into their own agent environments (OpenCode, Claude Code, etc.).

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

Register `skillPlugin()` on your `Crust` builder with `.use()`:

```ts
import { Crust } from "@crustjs/core";
import { skillPlugin } from "@crustjs/skills";

const app = new Crust("my-cli")
  .meta({ description: "My CLI" })
  .use(
    skillPlugin({
      version: "1.0.0",
      instructions: `
Prefer readonly commands before mutating project state.

## Response Policy

- Read the relevant command doc before suggesting flags.
`,
      // autoUpdate: true (default) — silently updates installed skills
      // command: "skill" (default) — registers "my-cli skill" subcommand
      // defaultScope: "global" | "project" — skip scope prompt when set
      // installMode: "auto" | "symlink" | "copy" (default: "auto")
    }),
  )
  .run(() => {
    console.log("hello");
  });

await app.execute();
```

The plugin automatically updates already-installed skills when the version changes, checking both project and global paths for the current working directory. If the current working directory is the home directory, `project` scope is normalized to `global` so installs, updates, and status checks use the global skill locations. First-time installation is done via the interactive `skill` subcommand (or `skill update` for update-only flows), or programmatically using the exported primitives.

Generated bundles are written once to a canonical store (`.crust/skills` for project scope, `~/.crust/skills` for global scope) and then installed into agent paths via symlink or copy depending on `installMode`.

### Programmatic Auto-Install

For full control over first-time installation, call `generateSkill()`
directly from your handler. With `agents` omitted, it installs into every
universal agent plus every additional agent whose CLI is on `PATH`, and
returns `up-to-date` for targets that already match the current version —
so the same call is safe to run on every invocation. Pass `agents: []` to
opt out, or an explicit array to scope the install.

```ts
import { Crust } from "@crustjs/core";
import { generateSkill } from "@crustjs/skills";

export const app = new Crust("my-cli")
  .meta({ description: "My CLI" })
  .run(async (ctx) => {
    // Defaults to universal + agents detected on PATH. Idempotent: targets
    // that already match the current version are returned as `up-to-date`.
    const result = await generateSkill({
      command: ctx.command,
      meta: {
        name: ctx.command.meta.name,
        description: ctx.command.meta.description ?? "",
        version: "1.0.0",
      },
      scope: "global",
    });

    const changed = result.agents.filter((a) => a.status !== "up-to-date");
    if (changed.length > 0) {
      console.log(`Installed or updated skills for ${changed.length} target(s).`);
    }
  });

if (import.meta.main) {
  await app.execute();
}
```

`getUniversalAgents()`, `getAdditionalAgents()`, and
`detectInstalledAgents()` remain exported for callers that want to compose
their own agent list.

#### Troubleshooting

If auto-update does not appear to work:

- Ensure `skillPlugin(...)` is registered on the `Crust` builder via `.use()`.
- Ensure at least one supported agent is detected. Auto-update checks both project and global install paths, with home-directory `project` scope treated as `global`.
- Check for existing conflicting skill directories without `crust.json`.

## Recommended Export Pattern

To avoid side effects when your command module is imported for generation, guard runtime code with `import.meta.main`:

```ts
import { Crust } from "@crustjs/core";

// Export the command — used by skill generation.
export const rootCommand = new Crust("my-cli")
  .meta({ description: "My CLI tool" })
  .run(({ args }) => {
    console.log("Hello from my-cli!");
  });

// Only execute when run directly — not when imported for generation.
if (import.meta.main) {
  await rootCommand.execute();
}
```

### Custom Instructions

Use plugin-level `instructions` to add top-level guidance to the generated
`SKILL.md`, and `annotate()` to add prompt guidance to specific
command docs under `commands/`.

- `instructions: string` renders as a raw markdown block.
- `instructions: string[]` renders as bullet list items.
- Empty or whitespace-only instruction input is ignored.
- `annotate()` always renders command guidance as bullets.

```ts
import { Crust } from "@crustjs/core";
import { annotate, skillPlugin } from "@crustjs/skills";

const deploy = annotate(
  new Crust("deploy")
    .meta({ description: "Deploy the application" })
    .flags({
      "dry-run": { type: "boolean", description: "Preview changes only" },
    })
    .run(() => {
      // ...
    }),
  [
    "Prefer `--dry-run` before executing deployment changes.",
    "Ask for confirmation before production deployments.",
  ],
);

const app = new Crust("my-cli")
  .meta({ description: "My CLI" })
  .use(
    skillPlugin({
      version: "1.0.0",
      instructions: `
Read command docs before suggesting exact flags.

## Answer Style

- Prefer exact syntax copied from the relevant command file.
`,
    }),
  )
  .command(deploy);
```

This pattern lets `crust skills generate` import the command definition without triggering `app.execute()`.

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
  meta: {
    name: "my-cli",
    description: "My CLI tool",
    version: "1.0.0",
    instructions: ["Prefer readonly commands before making changes."],
  },
  agents: ["opencode"],
  scope: "project", // default: "global"
  installMode: "auto", // default: "auto" — symlink first, fallback to copy
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

### `resolveCanonicalSkillPath(scope, name)`

Resolves the canonical store path where Crust writes the single source-of-truth skill bundle. Agent install paths are symlinked (or copied) from this location.

```ts
import { resolveCanonicalSkillPath } from "@crustjs/skills";

resolveCanonicalSkillPath("project", "my-cli");
// → "<cwd>/.crust/skills/my-cli"

resolveCanonicalSkillPath("global", "my-cli");
// → "~/.crust/skills/my-cli"
```

When `process.cwd()` is the home directory, `resolveCanonicalSkillPath("project", ...)` returns the same global path as `resolveCanonicalSkillPath("global", ...)`.

### `isValidSkillName(name)`

Validates a skill name against the [Agent Skills spec](https://agentskills.io/specification) pattern: 1–64 lowercase alphanumeric characters and hyphens, no leading/trailing/consecutive hyphens.

```ts
import { isValidSkillName } from "@crustjs/skills";

isValidSkillName("my-cli"); // true
isValidSkillName("My_CLI"); // false — uppercase and underscores not allowed
isValidSkillName("-leading"); // false — leading hyphen
isValidSkillName("a".repeat(65)); // false — exceeds 64 characters
```

> **Note:** `generateSkill()` automatically validates `meta.name` and throws a descriptive error if the name is invalid.

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

Generated output goes to `<outDir>/skills/<name>/`:

```
skills/my-cli/
  SKILL.md            # Entrypoint — loaded by the agent
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
| `SKILL.md`         | Agent entrypoint with YAML frontmatter and an embedded command reference table listing every command path, type (runnable/group), and documentation link.                                       |
| `commands/*.md`    | Per-command reference files. Leaf commands include usage, arguments, flags, defaults, and aliases. Group commands list subcommands with links.                                                     |
| `crust.json`       | Crust-specific JSON metadata: name, description, and version. Also serves as an ownership marker — its presence indicates the skill was generated by Crust. |

## Conflict Detection

Each skill directory contains a `crust.json` file that acts as an ownership marker. If `generateSkill()` encounters an existing directory without `crust.json`, it throws a `SkillConflictError` to prevent overwriting skills created manually or by other tools.

### Uninstall Cleanup

When `uninstallSkill()` removes agent install paths, it also checks whether any other agent paths still reference the skill. If no agent installs remain, the canonical store entry (`.crust/skills/<skill>` or `~/.crust/skills/<skill>`) is automatically removed.

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

### Universal agents (OpenCode, Codex, Cursor, and others)

```sh
cp -r skills/my-cli/ .agents/skills/my-cli/
```

Global install for universal agents:

```sh
cp -r skills/my-cli/ ~/.agents/skills/my-cli/
```

### Claude Code

```sh
cp -r skills/my-cli/ .claude/skills/my-cli/
```

The agent will discover the skill from `SKILL.md` and load command documentation on demand from the `commands/` directory.

## Installing Hand-Authored Bundles

`generateSkill()` produces a skill bundle from a Crust command tree.
`installSkillBundle()` is the dual entrypoint for **hand-authored** bundles —
use it when you have a directory containing `SKILL.md` and any supporting
files that you want to install through the same canonical-store + agent
fan-out pipeline.

Use `installSkillBundle()` when:

- You ship a published CLI package that bundles authored skill directories
  alongside generated ones.
- The skill's `SKILL.md` is hand-curated (or produced by your own renderer)
  and Crust just needs to handle install plumbing — canonical storage,
  symlink/copy fan-out, version tracking, and conflict detection.

```ts
import { installSkillBundle } from "@crustjs/skills";

await installSkillBundle({
  meta: {
    name: "funnel-builder",
    description: "Build a sales funnel",
    version: "1.0.0",
  },
  // Resolved relative to the nearest package.json walking up from
  // process.argv[1]. You can also pass an absolute string or a file: URL.
  sourceDir: "skills/funnel-builder",
  agents: ["claude-code", "opencode"],
});
```

### What gets copied

The bundle's `SKILL.md` plus every supporting file is copied verbatim into
the canonical Crust store. Crust does **not** parse or rewrite the SKILL.md
frontmatter — the bundle author owns it.

Exclusions at the bundle root only:

- `node_modules/`, `.git/`, `.DS_Store`
- Any pre-existing `crust.json` (Crust regenerates it)
- Any dotfile at the root (e.g. `.editorconfig`, `.gitignore`)

Dotfiles inside subdirectories **are** copied.

### `kind` field on `crust.json`

Every installed bundle now records its origin in `crust.json` as a `kind`
field: `"generated"` for `generateSkill()` output, `"bundle"` for
`installSkillBundle()`. This prevents accidental cross-overwrites:

- Trying to install a bundle on top of a generated skill (or vice versa) at
  the same name throws a `SkillConflictError` whose `details.kindMismatch`
  carries `{ existing, attempted }`.
- To proceed anyway, uninstall the existing skill first or pass
  `force: true`.

Legacy `crust.json` files written before this field existed are read as
`kind: "generated"` for backward compatibility — generated installs continue
to update cleanly with no migration step.

## Documentation

See the full docs at [crustjs.com](https://crustjs.com).

## License

MIT

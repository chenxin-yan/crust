// ────────────────────────────────────────────────────────────────────────────
// @crustjs/skills — Public types for agent skill generation
// ────────────────────────────────────────────────────────────────────────────

import type { CommandSnapshot } from "@crustjs/core";

// ────────────────────────────────────────────────────────────────────────────
// Skill metadata — describes the generated skill bundle
// ────────────────────────────────────────────────────────────────────────────

/**
 * Metadata for the generated skill bundle.
 *
 * This information populates the `SKILL.md` frontmatter and distribution
 * metadata files (`crust.json`).
 *
 * @example
 * ```ts
 * const meta: SkillMeta = {
 *   name: "my-cli",
 *   description: "CLI tool for managing widgets",
 *   version: "1.0.0",
 * };
 * // generateSkill() will output to `my-cli/` with name "my-cli"
 * ```
 */
export interface SkillMeta {
	/**
	 * Skill name — the user-facing CLI name (e.g. `"my-cli"`).
	 *
	 * `generateSkill()`, `uninstallSkill()`, and `getSkillStatus()` treat this as
	 * the canonical raw skill name for output directory paths, SKILL.md
	 * frontmatter, and crust.json metadata. For example, `name: "my-cli"`
	 * produces output under `my-cli/`.
	 *
	 * The resolved name must conform to the Agent Skills spec: 1–64 lowercase
	 * alphanumeric characters and hyphens, no leading/trailing/consecutive
	 * hyphens.
	 */
	name: string;
	/** Human-readable description of what the CLI does */
	description: string;
	/** Version string for the generated skill bundle */
	version: string;
	/**
	 * License name or reference to a bundled license file.
	 *
	 * Emitted in SKILL.md YAML frontmatter as `license:`.
	 */
	license?: string;
	/**
	 * Environment requirements or compatibility notes (max 500 chars per spec).
	 *
	 * Indicates intended product, required system packages, network access, etc.
	 * Emitted in SKILL.md YAML frontmatter as `compatibility:`.
	 *
	 * @example "Requires deploy-cli installed on PATH"
	 */
	compatibility?: string;
	/**
	 * When `true`, prevents agents from automatically loading this skill.
	 * Users must invoke it manually with `/skill-name`.
	 *
	 * Emitted in SKILL.md YAML frontmatter as `disable-model-invocation: true`.
	 * @default false
	 */
	disableModelInvocation?: boolean;
	/**
	 * Space-delimited list of pre-approved tools the skill may use.
	 *
	 * For CLI skills, setting this to `Bash(<cli-name> *)` allows agents to
	 * execute the CLI without per-use permission prompts.
	 *
	 * Emitted in SKILL.md YAML frontmatter as `allowed-tools:`.
	 *
	 * @example "Bash(my-cli *) Read Grep"
	 */
	allowedTools?: string;
	/**
	 * Additional top-level instructions rendered into `SKILL.md`.
	 *
	 * Use this for extension- or product-specific guidance that should be visible
	 * before agents inspect individual command documentation files.
	 *
	 * **Note:** When a `string` value contains markdown headings (e.g. `## Foo`),
	 * they are rendered at the same level as `## General Guidance`, not nested
	 * under it. Use a `string[]` of plain instructions to avoid unintended
	 * heading hierarchy.
	 */
	instructions?: string | string[];
}

// ────────────────────────────────────────────────────────────────────────────
// Agent and scope types
// ────────────────────────────────────────────────────────────────────────────

/** Supported agent targets for skill installation. */
export type AgentTarget =
	| "amp"
	| "adal"
	| "antigravity"
	| "augment"
	| "claude-code"
	| "cline"
	| "codebuddy"
	| "codex"
	| "command-code"
	| "continue"
	| "cortex"
	| "crush"
	| "cursor"
	| "droid"
	| "gemini-cli"
	| "github-copilot"
	| "goose"
	| "iflow-cli"
	| "junie"
	| "kilo"
	| "kimi-cli"
	| "kiro-cli"
	| "kode"
	| "mcpjam"
	| "mistral-vibe"
	| "mux"
	| "neovate"
	| "opencode"
	| "openclaw"
	| "openhands"
	| "pi"
	| "pochi"
	| "qoder"
	| "qwen-code"
	| "replit"
	| "roo"
	| "trae"
	| "trae-cn"
	| "windsurf"
	| "zencoder";

/** Agent install class used by interactive skill management UX. */
export type AgentClass = "universal" | "additional";

/** Installation scope — global (home directory) or project (cwd, except home dir which normalizes to global). */
export type Scope = "global" | "project";

/** Installation strategy for agent skill output paths. */
export type SkillInstallMode = "auto" | "symlink" | "copy";

/**
 * Origin of an installed skill bundle.
 *
 * Recorded in `crust.json` as the top-level `kind` field so Crust can detect
 * when a generated and a hand-authored bundle would collide on the same name.
 *
 * - `"generated"` — produced by {@link generateSkill} from a Crust command tree.
 * - `"bundle"` — installed by {@link installSkillBundle} from a hand-authored
 *   directory containing a `SKILL.md` and supporting files.
 */
export type SkillKind = "generated" | "bundle";

// ────────────────────────────────────────────────────────────────────────────
// Command manifest — canonical intermediate representation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Describes a single positional argument in the canonical manifest.
 *
 * Normalized from `DocumentationArg` in `@crustjs/core/tooling` to a flat, serializable shape.
 */
export interface ManifestArg {
	/** Argument name (from `ArgDef.name`) */
	name: string;
	/** Value type: "string", "number", or "boolean" */
	type: "string" | "number" | "boolean";
	/** Human-readable description */
	description?: string;
	/** Whether this argument is required */
	required: boolean;
	/** Whether this argument collects remaining values into an array */
	variadic: boolean;
	/** Default value (serialized as string for deterministic output) */
	default?: string;
}

/**
 * Describes a single named flag in the canonical manifest.
 *
 * Normalized from `DocumentationFlag` in `@crustjs/core/tooling` to a flat, serializable shape.
 */
export interface ManifestFlag {
	/** Flag name (the key from `FlagsDef`) */
	name: string;
	/** All accepted CLI spellings in documentation order — the sole source for rendered flag labels */
	spellings: readonly string[];
	/** Value type: "string", "number", or "boolean" */
	type: "string" | "number" | "boolean";
	/** Human-readable description */
	description?: string;
	/** Whether this flag is required */
	required: boolean;
	/** Whether this flag accepts multiple values */
	multiple: boolean;
	/** Single-character short alias (e.g. `"v"` → `-v`) */
	short?: string;
	/** Additional long aliases (e.g. `["out"]` → `--out`) */
	aliases: string[];
	/** Default value (serialized as string for deterministic output) */
	default?: string;
}

/**
 * Canonical representation of a single command node in the manifest tree.
 *
 * Generated by introspecting Crust builder metadata. The manifest is
 * the intermediate representation between raw command definitions and
 * rendered markdown output.
 *
 * @example
 * ```ts
 * // A leaf command: git remote add
 * const node: ManifestNode = {
 *   name: "add",
 *   path: ["git", "remote", "add"],
 *   description: "Add a new remote",
 *   runnable: true,
 *   usage: "git remote add <name>",
 *   args: [{ name: "name", type: "string", required: true, variadic: false }],
 *   flags: [{ name: "fetch", spellings: ["--fetch", "--no-fetch"], type: "boolean", required: false, multiple: false, aliases: [] }],
 *   children: [],
 * };
 * ```
 */
export interface ManifestNode {
	/** Command name (final segment of the command path) */
	name: string;
	/** Full command path from root (e.g. `["git", "remote", "add"]`) */
	path: string[];
	/** Human-readable description */
	description?: string;
	/** Resolved command usage from the core documentation model. */
	usage: string;
	/** Agent-facing instructions rendered into the command's markdown file */
	instructions?: string[];
	/** Whether this command has a `run` action (leaf vs group) */
	runnable: boolean;
	/** Positional argument definitions */
	args: ManifestArg[];
	/** Flag definitions */
	flags: ManifestFlag[];
	/** Child command nodes (subcommands) */
	children: ManifestNode[];
}

// ────────────────────────────────────────────────────────────────────────────
// Rendered output — files to write to disk
// ────────────────────────────────────────────────────────────────────────────

/**
 * A single rendered file ready for writing to the output directory.
 *
 * File paths are relative to the skill output directory
 * (e.g. `"SKILL.md"`, `"commands/remote/add.md"`).
 */
export interface RenderedFile {
	/** Relative file path within the skill output directory */
	path: string;
	/** File content: UTF-8 text for generated files, raw bytes for bundle assets. */
	content: string | Uint8Array;
}

// ────────────────────────────────────────────────────────────────────────────
// Generation options — top-level input for skill generation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Top-level options for generating a skill bundle from a command tree.
 *
 * The `meta.name` value is used directly for all output paths and metadata.
 * For example, `name: "my-cli"` produces skill directories named `my-cli/`
 * and sets the manifest/frontmatter name to `"my-cli"`.
 *
 * @example
 * ```ts
 * import { generateSkill } from "@crustjs/skills";
 * import { rootCommand } from "./commands.ts";
 *
 * await generateSkill({
 *   command: rootCommand,
 *   meta: {
 *     name: "my-cli", // output: my-cli/
 *     description: "CLI tool for managing widgets",
 *     version: "1.0.0",
 *   },
 *   agents: ["claude-code", "opencode"],
 * });
 * ```
 */
export interface GenerateSkillOptions {
	/** Root command to generate the skill from */
	command: CommandSnapshot;
	/** Skill metadata for the generated bundle */
	meta: SkillMeta;
	/**
	 * Agent targets to install skills for.
	 *
	 * When omitted (or explicitly `undefined`), defaults to
	 * `[...getUniversalAgents(), ...await detectInstalledAgents()]` — the union
	 * of always-included universal agents and additional agents whose CLI is
	 * detected on `PATH`. Pass an explicit array to override; `agents: []`
	 * is treated as a no-op (no install performed).
	 *
	 * **Note:** Omitting this field performs filesystem I/O via
	 * `detectInstalledAgents()` to probe `PATH` for installed agent CLIs.
	 */
	agents?: AgentTarget[];
	/**
	 * Installation strategy for agent output paths.
	 *
	 * - `"auto"` (default): create a symlink to the canonical `.crust/skills`
	 *   bundle, falling back to a hard copy when symlinks are unavailable.
	 * - `"symlink"`: require symlinks; fail if a symlink cannot be created.
	 * - `"copy"`: write full copies directly into each agent path.
	 *
	 * Canonical bundles are always generated once under `.crust/skills` (project)
	 * or `~/.crust/skills` (global). When `process.cwd()` is the home directory,
	 * project scope is normalized to the global location.
	 * @default "auto"
	 */
	installMode?: SkillInstallMode;
	/**
	 * Installation scope — global (home directory) or project (cwd).
	 * When `process.cwd()` is the home directory, `"project"` is treated as `"global"`.
	 * @default "global"
	 */
	scope?: Scope;
	/**
	 * When `true`, removes the existing skill directory before writing.
	 * Prevents stale files from previous generations.
	 * @default true
	 */
	clean?: boolean;
	/**
	 * When `true`, rewrite the generated skill even when the recorded version is
	 * unchanged, and overwrite an existing conflicting directory (for example,
	 * no `crust.json`, malformed `crust.json`, or a different skill kind)
	 * instead of throwing {@link SkillConflictError}.
	 * @default false
	 */
	force?: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Bundle install options — input for installSkillBundle
// ────────────────────────────────────────────────────────────────────────────

/**
 * Top-level options for installing a hand-authored skill bundle.
 *
 * Unlike {@link GenerateSkillOptions}, the bundle entrypoint does not render
 * `SKILL.md` from a command tree — it copies a directory the caller has
 * already authored. The bundle's `SKILL.md` frontmatter is the source of
 * truth for `name` and `description`; Crust reads them but does not rewrite
 * the file. A fresh `crust.json` is written alongside the bundle for
 * ownership and version tracking.
 *
 * Bundle files are copied as raw bytes. `SKILL.md` is also parsed as UTF-8
 * to read its required frontmatter.
 *
 * Bundle content changes do not propagate without a `version` bump:
 * identical-version reinstalls report `up-to-date` and leave the canonical
 * store untouched. Pass a fresh `version` whenever the bundle contents
 * change (e.g. wire it to the consuming package's `package.json` `version`).
 *
 * @example
 * ```ts
 * import { installSkillBundle } from "@crustjs/skills";
 * import pkg from "./package.json" with { type: "json" };
 *
 * // SKILL.md frontmatter supplies name + description; the caller passes
 * // the version explicitly (typically wired to package.json).
 * await installSkillBundle({
 *   sourceDir: "skills/funnel-builder",
 *   agents: ["claude-code"],
 *   version: pkg.version,
 * });
 * ```
 */
export interface InstallSkillBundleOptions {
	/**
	 * Source directory containing the bundle to install.
	 *
	 * Resolution rules (mirror `@crustjs/create`'s `scaffold({ template })`):
	 * - `URL` — must use `file:` protocol; resolved via `fileURLToPath()`.
	 * - Absolute string path — used as-is via `path.resolve()`.
	 * - Relative string path — resolved from the nearest `package.json`
	 *   directory walking up from `process.argv[1]`. Throws if `process.argv[1]`
	 *   is unset or no `package.json` is found.
	 *
	 * The directory must contain a `SKILL.md` whose YAML frontmatter declares
	 * top-level `name:` and `description:` fields.
	 */
	sourceDir: string | URL;
	/**
	 * Agent targets to install the bundle for.
	 *
	 * Required — unlike {@link GenerateSkillOptions.agents}, the bundle entrypoint
	 * does not auto-detect agents. Pass `[]` for a validated no-op: no install
	 * is performed, but `sourceDir`, `SKILL.md`, bundle paths, frontmatter, and
	 * skill name are still validated.
	 */
	agents: AgentTarget[];
	/**
	 * Version string recorded for this install and compared on subsequent
	 * installs to decide between `installed` / `updated` / `up-to-date`.
	 *
	 * Required. Typically wired to the consuming package's `package.json`
	 * `version` (e.g. via `import pkg from "./package.json" with { type:
	 * "json" }`). Identical-version reinstalls report `up-to-date` and skip
	 * the canonical-store rewrite (unless `force: true` is passed), so bump
	 * this whenever bundle contents change.
	 */
	version: string;
	/**
	 * Installation strategy for agent output paths.
	 * @default "auto"
	 */
	installMode?: SkillInstallMode;
	/**
	 * Installation scope — global (home directory) or project (cwd).
	 * @default "global"
	 */
	scope?: Scope;
	/**
	 * When `true`, removes the existing skill directory before writing.
	 * @default true
	 */
	clean?: boolean;
	/**
	 * When `true`, rewrite the bundle even when the recorded version is
	 * unchanged, and overwrite an existing conflicting directory (for example,
	 * no `crust.json`, malformed `crust.json`, or a different skill kind)
	 * instead of throwing {@link SkillConflictError}.
	 * @default false
	 */
	force?: boolean;
	/**
	 * When set, the bundle's `SKILL.md` frontmatter `name:` must equal this
	 * string. A mismatch throws before any filesystem write.
	 *
	 * Used by `skill()`'s `customSkills` reconciliation to keep the
	 * config-level `name` (used for status / uninstall lookups) in lockstep
	 * with the frontmatter `name` (the canonical install path), preventing
	 * orphan installs.
	 */
	expectedName?: string;
}

/**
 * Result returned by `installSkillBundle` after writing files to disk.
 *
 * Type alias of {@link GenerateSkillResult} — the per-agent shape is identical.
 */
export type InstallSkillBundleResult = GenerateSkillResult;

// ────────────────────────────────────────────────────────────────────────────
// Generation result — returned from generateSkill
// ────────────────────────────────────────────────────────────────────────────

/** Status of an individual agent installation. */
export type InstallStatus = "installed" | "updated" | "up-to-date";

/** Status of an individual agent uninstallation. */
export type UninstallStatus = "removed" | "not-found";

/** Per-agent result from a generateSkill call. */
export interface AgentResult {
	/** Which agent this result is for */
	agent: AgentTarget;
	/** Absolute path to the skill output directory for this agent */
	outputDir: string;
	/** List of files that were written (relative paths) */
	files: string[];
	/** What happened during this installation */
	status: InstallStatus;
	/** Previous version string when status is "updated" */
	previousVersion?: string;
}

/**
 * Result returned by `generateSkill` after writing files to disk.
 */
export interface GenerateSkillResult {
	/** Per-agent installation results */
	agents: AgentResult[];
}

// ────────────────────────────────────────────────────────────────────────────
// Uninstall types
// ────────────────────────────────────────────────────────────────────────────

/** Options for removing installed skills. */
export interface UninstallSkillOptions {
	/** Skill name to uninstall */
	name: string;
	/**
	 * Agent targets to uninstall from.
	 *
	 * When omitted (or explicitly `undefined`), defaults to every supported
	 * agent so the uninstall sweep covers any path that may hold an install,
	 * regardless of what is on the current machine's `PATH`. Pass an explicit
	 * array to scope the uninstall; `agents: []` is treated as a no-op (no
	 * paths are touched).
	 *
	 * Default resolution does not perform `PATH` I/O — the entrypoint already
	 * stats each per-agent path during the sweep.
	 */
	agents?: AgentTarget[];
	/**
	 * Installation scope to uninstall from.
	 * When `process.cwd()` is the home directory, `"project"` is treated as `"global"`.
	 * @default "global"
	 */
	scope?: Scope;
}

/** Result returned by `uninstallSkill`. */
export interface UninstallSkillResult {
	/** Per-agent uninstall results */
	agents: Array<{
		agent: AgentTarget;
		outputDir: string;
		status: UninstallStatus;
	}>;
}

// ────────────────────────────────────────────────────────────────────────────
// Status types
// ────────────────────────────────────────────────────────────────────────────

/** Options for checking installed skill status. */
export interface SkillStatusOptions {
	/** Skill name to check */
	name: string;
	/**
	 * Agent targets to check.
	 *
	 * When omitted (or explicitly `undefined`), defaults to every supported
	 * agent so the status sweep reports an entry for any path that may hold
	 * an install, regardless of what is on the current machine's `PATH`. Pass
	 * an explicit array to scope the check; `agents: []` is treated as a no-op
	 * (returns an empty result).
	 *
	 * Default resolution does not perform `PATH` I/O — the entrypoint already
	 * stats each per-agent path during the sweep.
	 */
	agents?: AgentTarget[];
	/**
	 * Installation scope to check.
	 * When `process.cwd()` is the home directory, `"project"` is treated as `"global"`.
	 * @default "global"
	 */
	scope?: Scope;
}

/** Result returned by `getSkillStatus`. */
export interface SkillStatusResult {
	/** Per-agent status results */
	agents: Array<{
		agent: AgentTarget;
		outputDir: string;
		installed: boolean;
		version?: string;
	}>;
}

// ────────────────────────────────────────────────────────────────────────────
// Extension option types
// ────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────
// Custom skill bundle configuration
// ─────────────────────────────────────────────────────────────────────────

/**
 * Configuration for a single hand-authored skill bundle managed by
 * `skill()` alongside the auto-generated command-reference skill.
 *
 * Each entry is reconciled through the same extension lifecycle as the main
 * skill — auto-update on version change, surfaced in the interactive `skill`
 * subcommand multiselect, supports uninstall via the same toggle UX, and
 * respects `autoUpdate: false` and `--all` non-interactive mode. Bundles
 * inherit `version`, `defaultScope`, and `installMode` from the extension
 * unless overridden per-entry.
 *
 * The bundle's `SKILL.md` frontmatter remains the source of truth for the
 * display `name` and `description` (validated by {@link installSkillBundle}
 * at install time). The duplicated `name` field on this config is what the
 * extension uses for cheap collision-detection, status lookups, and uninstall
 * paths without having to read the bundle's frontmatter at extension setup.
 *
 * @example
 * ```ts
 * import { skill } from "@crustjs/skills";
 * import pkg from "./package.json" with { type: "json" };
 *
 * skill({
 *   version: pkg.version,
 *   customSkills: [
 *     // Inherits `version: pkg.version` from the extension.
 *     { name: "funnel-builder", sourceDir: "skills/funnel-builder" },
 *     // Explicit override for an independently-versioned bundle.
 *     {
 *       name: "vendored-toolkit",
 *       sourceDir: "skills/vendored-toolkit",
 *       version: "0.3.0",
 *     },
 *   ],
 * });
 * ```
 */
export interface CustomSkillConfig extends Pick<
	InstallSkillBundleOptions,
	"sourceDir" | "scope" | "installMode"
> {
	/**
	 * Skill name used by the extension for collision detection, status lookups,
	 * and uninstall paths.
	 *
	 * Must satisfy `isValidSkillName` (1–64 lowercase alphanumeric characters
	 * and hyphens, no leading/trailing/consecutive hyphens), must be unique
	 * within the `customSkills` array, and must not collide with the main
	 * skill's name (derived from the root command's `meta`).
	 *
	 * The bundle's `SKILL.md` frontmatter `name:` must match this value —
	 * mismatches are rejected at install time so extension status / uninstall
	 * paths can never drift from the canonical install location.
	 */
	name: string;
	/**
	 * Version override. When omitted, the bundle inherits the extension's
	 * top-level {@link SkillOptions.version}. Drives auto-update
	 * detection: a bundle is reinstalled when its recorded `crust.json`
	 * version differs from the effective (entry-or-extension) version.
	 *
	 * Inheriting from the extension matches the typical case where the bundle
	 * ships in the same package as the consuming CLI — one `pkg.version`
	 * drives the main skill and every bundle. Pass an explicit value when a
	 * bundle's release cadence is independent of the consuming CLI (for
	 * example, vendored from another package).
	 *
	 * The bundle's `SKILL.md` frontmatter `version:` / `metadata.version`,
	 * if any, is intentionally not read — this option (or its extension-level
	 * fallback) is the sole source of truth.
	 */
	version?: InstallSkillBundleOptions["version"];
	/**
	 * Installation scope override. When omitted, the bundle inherits
	 * {@link SkillOptions.defaultScope} resolution: explicit `--scope`
	 * flag wins, else `defaultScope`, else the interactive scope prompt
	 * (or `"global"` in non-interactive mode).
	 */
	scope?: InstallSkillBundleOptions["scope"];
	/**
	 * Installation strategy override. When omitted, inherits
	 * {@link SkillOptions.installMode} (default `"auto"`).
	 */
	installMode?: InstallSkillBundleOptions["installMode"];
}

/**
 * Options for the skill extension.
 *
 * The extension reads `name` and `description` from the root command's `meta`
 * at setup time, so only `version` is required here.
 *
 * Installed agents are detected automatically.
 *
 * Only detected agents are managed.
 *
 * **Auto-update** (default): silently updates already-installed skills when a
 * new version is detected. Disable with `autoUpdate: false`.
 *
 * For first-time installation, use the interactive `skill` subcommand or
 * build custom auto-install logic with the exported primitives
 * (`detectInstalledAgents`, `getSkillStatus`, `generateSkill`).
 *
 * **Interactive command** (default): registers a `skill` subcommand (or the
 * custom `command` name) that
 * presents a single multiselect prompt for toggling agent installations.
 *
 * Scope resolution for interactive commands:
 * - If `defaultScope` is set, that scope is used and no scope prompt is shown.
 * - If `defaultScope` is not set and the terminal is interactive, users are
 *   prompted to choose `project` or `global`.
 * - If `defaultScope` is not set and the terminal is non-interactive, scope
 *   falls back to `"global"`.
 * - When `process.cwd()` is the home directory, `"project"` is normalized to
 *   `"global"` for path resolution and update/status messaging.
 */
export interface SkillOptions {
	/** Skill version string — compared against the installed crust.json */
	version: string;
	/**
	 * Default installation scope for interactive commands.
	 *
	 * When omitted, interactive commands prompt for scope in TTY mode.
	 * Non-interactive mode falls back to "global".
	 * When `process.cwd()` is the home directory, `"project"` behaves as `"global"`.
	 */
	defaultScope?: Scope;
	/**
	 * Installation strategy used when the extension calls `generateSkill()`.
	 * @default "auto"
	 */
	installMode?: SkillInstallMode;
	/**
	 * Automatically update skills when the installed version is outdated.
	 * @default true
	 */
	autoUpdate?: boolean;
	/**
	 * Additional top-level instructions rendered into the generated `SKILL.md`.
	 *
	 * **Note:** When a `string` value contains markdown headings (e.g. `## Foo`),
	 * they are rendered at the same level as `## General Guidance`, not nested
	 * under it. Use a `string[]` of plain instructions to avoid unintended
	 * heading hierarchy.
	 */
	instructions?: string | string[];
	/** License name or reference emitted in SKILL.md frontmatter. */
	license?: string;
	/**
	 * Space-delimited list of pre-approved tools the skill may use.
	 *
	 * @example "Bash(my-cli *) Read Grep"
	 */
	allowedTools?: string;
	/** Environment requirements or compatibility notes (max 500 chars). */
	compatibility?: string;
	/**
	 * When `true`, prevents agents from automatically loading this skill.
	 * @default false
	 */
	disableModelInvocation?: boolean;
	/**
	 * Hand-authored skill bundles to manage alongside the auto-generated
	 * command-reference skill.
	 *
	 * Each entry is reconciled through the same extension lifecycle as the main
	 * skill — auto-update on version change, surfaced in the interactive
	 * `skill` subcommand multiselect (one prompt per bundle, in array order,
	 * after the main-skill prompt), supports uninstall via the same toggle
	 * UX, and respects `autoUpdate: false` and `--all` non-interactive mode.
	 *
	 * Bundles share the canonical `.crust/skills` store with the main skill
	 * via {@link installSkillBundle} and inherit `defaultScope` /
	 * `installMode` resolution unless overridden per-entry.
	 *
	 * Each entry's effective `version` drives auto-update detection (compared
	 * against the recorded `crust.json` version). When the entry omits
	 * `version`, the extension's top-level {@link SkillOptions.version} is
	 * used — the typical case when the bundle ships in the same package as
	 * the consuming CLI.
	 *
	 * Setup-time validation enforces:
	 * - Each `name` satisfies `isValidSkillName`.
	 * - No `name` collides with the main skill's name.
	 * - All `name` values are unique within the array.
	 * - When set, `version` is a non-empty string.
	 * - Each `sourceDir` is a `string` or `URL`.
	 *
	 * `sourceDir` resolution-time errors (non-`file:` URL, missing source
	 * directory, missing `SKILL.md`, etc.) defer to the underlying
	 * `installSkillBundle` invocation and surface there with descriptive
	 * messages.
	 *
	 * When omitted or empty, extension behavior is byte-identical to running
	 * without the option — only the auto-generated main skill is managed.
	 *
	 * @default []
	 */
	customSkills?: CustomSkillConfig[];
	/**
	 * Register an interactive skill management subcommand on the root command.
	 *
	 * The command presents a single multiselect prompt listing all detected
	 * agents with their current installation status pre-filled. The user
	 * toggles agents on/off and the system reconciles the desired state:
	 * newly selected agents are installed, deselected agents are uninstalled,
	 * and already-correct agents are skipped.
	 *
	 * @default "skill"
	 */
	command?: string;
}

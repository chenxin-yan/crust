import type { AgentTarget, Scope } from "./agents.ts";

/** Metadata used to render a generated skill. */
export interface SkillMeta {
	name: string;
	description: string;
	version?: string | undefined;
}

export interface RenderedFile {
	path: string;
	content: string | Uint8Array;
}

/** Options for linking one packaged skill source into the shared folder and agent directories. */
export interface InstallSkillOptions {
	/** Directory `skills/<name>` containing the skill's SKILL.md. A relative path resolves against the working directory. */
	sourceDir: string | URL;
	/** Agents to link besides the shared `.agents/skills` folder, which is always linked. Omit to use detected agents. */
	agents?: readonly AgentTarget[] | undefined;
	/** Agent-directory scope. @default "global" */
	scope?: Scope | undefined;
	/**
	 * Replace entries this skill does not own: `true` for any, or a list of exact paths to replace
	 * only those; a conflict elsewhere still throws. Re-pointing an owned link needs no `force`.
	 * @default false
	 */
	force?: boolean | readonly string[] | undefined;
}

export type InstallStatus = "installed" | "repaired" | "up-to-date";
export type UninstallStatus = "removed" | "not-found";

export interface AgentResult {
	agent: AgentTarget;
	outputDir: string;
	/** Effective scope after remapping project scope at the home directory. */
	scope: Scope;
	status: InstallStatus;
}

/** The shared `.agents/skills/<name>` link, the only one that points at the packaged skill. */
export interface SharedLinkResult {
	outputDir: string;
	/** Effective scope after remapping project scope at the home directory. */
	scope: Scope;
	status: InstallStatus;
}

export interface InstallSkillResult {
	shared: SharedLinkResult;
	/** Agents reading the shared folder report the shared link's directory and status. */
	agents: AgentResult[];
}

export interface UninstallSkillOptions {
	name: string;
	/** Agents whose own links to remove; the shared link stays. Omit to remove every link, shared included. */
	agents?: readonly AgentTarget[] | undefined;
	scope?: Scope | undefined;
}

export interface UninstallSkillResult {
	agents: Array<{
		agent: AgentTarget;
		outputDir: string;
		scope: Scope;
		status: UninstallStatus;
	}>;
}

export interface SkillStatusOptions {
	name: string;
	/** Expected source used to identify stale-target links. A relative path resolves against the working directory. */
	sourceDir: string | URL;
	agents?: readonly AgentTarget[] | undefined;
	scope?: Scope | undefined;
}

export type SkillLinkStatus = "linked" | "dangling" | "conflict" | "absent";

export interface SkillStatusResult {
	agents: Array<{
		agent: AgentTarget;
		outputDir: string;
		scope: Scope;
		status: SkillLinkStatus;
	}>;
}

/**
 * Options for the skills extension. Packaged skills are read at runtime from
 * `artifactPath("skills")` (`@crustjs/core`), the directory `crust build` stages.
 */
export interface SkillOptions {
	/**
	 * Hand-authored skill directories built alongside the generated skill. A relative path resolves
	 * against the working directory, which is the project root during `crust build`.
	 */
	extras?: readonly (string | URL)[] | undefined;
	/** Generated command skill name. Defaults to the root command name. */
	name?: string | undefined;
	/** Generated command skill description. Defaults to the root command description. */
	description?: string | undefined;
	/** Whether to build the generated command skill. Set `false` to ship only `extras`. @default true */
	generated?: boolean | undefined;
	/**
	 * Agent-directory scope used when no `--scope` flag is passed.
	 * When set, skips the scope prompt and limits automatic link repairs to this scope.
	 * When omitted, interactive management prompts for scope.
	 * @default "global" for `--all` and the scope prompt.
	 */
	defaultScope?: Scope | undefined;
	/**
	 * Before commands run, silently re-link the shared `.agents/skills` link when its target no
	 * longer exists; agent links point at it and are not inspected. A working link, even to another
	 * installed copy, and a conflict at the shared path are left to `skills repair`.
	 * Never runs from source, so a checkout does not take over an installed CLI's links. @default true
	 */
	autoUpdate?: boolean | undefined;
	/**
	 * Name of the interactive management command. The default includes a `skill` alias.
	 * A literal name keeps the host's command tree type-checked; a dynamic `string` opens it.
	 * @default "skills"
	 */
	command?: string | undefined;
}

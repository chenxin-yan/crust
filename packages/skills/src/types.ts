import type { AgentTarget, Scope } from "./agents.ts";

/** Metadata used to render a generated skill. */
export interface SkillMeta {
	name: string;
	description: string;
	version?: string;
}

export interface RenderedFile {
	path: string;
	content: string | Uint8Array;
}

/** Options for linking one packaged skill source into agent directories. */
export interface InstallSkillOptions {
	/** Package directory `skills/<name>` containing the skill's SKILL.md. */
	sourceDir: string | URL;
	/** Agent targets. Omit to use universal plus PATH-detected agents. */
	agents?: AgentTarget[];
	/** Agent-directory scope. @default "global" */
	scope?: Scope;
	/** Allow replacing a directory that is not owned by this skill. @default false */
	force?: boolean;
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

export interface InstallSkillResult {
	agents: AgentResult[];
}

export interface UninstallSkillOptions {
	name: string;
	agents?: AgentTarget[];
	scope?: Scope;
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
	/** Expected source used to identify stale-target links. */
	sourceDir: string | URL;
	agents?: AgentTarget[];
	scope?: Scope;
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
 * `resolveArtifactDir("skills")` (`@crustjs/core`), the directory `crust build` stages.
 */
export interface SkillOptions {
	/** Hand-authored skill directories (URL, absolute, or package-root-relative path) built alongside the generated skill. */
	extras?: readonly (string | URL)[];
	/** Generated command skill name. Defaults to the root command name. */
	name?: string;
	/** Generated command skill description. Defaults to the root command description. */
	description?: string;
	/** Whether to build the generated command skill. Set `false` to ship only `extras`. @default true */
	generated?: boolean;
	/**
	 * Agent-directory scope used when no `--scope` flag is passed.
	 * When set, skips the scope prompt and limits automatic link repairs to this scope.
	 * When omitted, interactive management prompts for scope.
	 * @default "global" for `--all` and the scope prompt.
	 */
	defaultScope?: Scope;
	/**
	 * Repair stale or dangling owned links before commands run. Never runs from source, so a
	 * checkout does not take over an installed CLI's links. @default true
	 */
	autoUpdate?: boolean;
	/** Name of the interactive management command. The default includes a `skill` alias. @default "skills" */
	command?: string;
}

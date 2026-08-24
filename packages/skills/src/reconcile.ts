import type { AgentTarget, SkillStatusResult } from "./types.ts";

export const UNIVERSAL_GROUP = "__universal__";

type SkillStatusEntry = SkillStatusResult["agents"][number];

export interface ReconcileChoice {
	readonly label: string;
	readonly value: AgentTarget | typeof UNIVERSAL_GROUP;
}

export interface SharedDirWarning {
	readonly label: string;
	readonly outputDir: string;
}

export interface ReconcilePlan {
	readonly toInstall: AgentTarget[];
	readonly toUninstall: AgentTarget[];
	readonly sharedDirWarnings: SharedDirWarning[];
}

/** @internal Plans link changes without performing prompt or filesystem I/O. */
export function planReconcile(options: {
	readonly statusMap: ReadonlyMap<AgentTarget, SkillStatusEntry>;
	readonly choices: readonly ReconcileChoice[];
	readonly selected: readonly AgentTarget[];
	readonly universal: readonly AgentTarget[];
}): ReconcilePlan {
	const { statusMap, choices, selected, universal } = options;
	const installed = [...statusMap.values()]
		.filter((entry) => entry.status === "linked" || entry.status === "dangling")
		.map((entry) => entry.agent);
	const toInstall = selected.filter((agent) => statusMap.get(agent)?.status !== "linked");
	const keptDirs = new Set(selected.map((agent) => statusMap.get(agent)?.outputDir));
	const toUninstall = installed.filter(
		(agent) => !selected.includes(agent) && !keptDirs.has(statusMap.get(agent)?.outputDir),
	);
	const sharedDirWarnings = choices.flatMap((choice) => {
		const agent = choice.value === UNIVERSAL_GROUP ? universal[0]! : choice.value;
		const entry = statusMap.get(agent);
		return !selected.includes(agent) && entry && keptDirs.has(entry.outputDir)
			? [{ label: choice.label, outputDir: entry.outputDir }]
			: [];
	});

	return { toInstall, toUninstall, sharedDirWarnings };
}

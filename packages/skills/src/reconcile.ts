import type { AgentTarget } from "./agents.ts";
import type { SkillStatusResult } from "./types.ts";

export const UNIVERSAL_GROUP = "__universal__";

type SkillStatusEntry = SkillStatusResult["agents"][number];

/** @internal Agents whose link exists (healthy or dangling) for one skill. */
export function installedAgents(
	statusMap: ReadonlyMap<AgentTarget, SkillStatusEntry>,
): AgentTarget[] {
	return [...statusMap.values()].flatMap((entry) =>
		entry.status === "linked" || entry.status === "dangling" ? [entry.agent] : [],
	);
}

export interface ReconcileChoice {
	readonly label: string;
	readonly value: AgentTarget | typeof UNIVERSAL_GROUP;
}

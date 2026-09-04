import { describe, expect, it } from "bun:test";

import { planReconcile, UNIVERSAL_GROUP, type ReconcileChoice } from "./reconcile.ts";
import type { AgentTarget, SkillStatusResult } from "./types.ts";

function statusMap(
	entries: SkillStatusResult["agents"],
): Map<AgentTarget, SkillStatusResult["agents"][number]> {
	return new Map(entries.map((entry) => [entry.agent, entry]));
}

const choices: ReconcileChoice[] = [
	{ label: "Universal", value: UNIVERSAL_GROUP },
	{ label: "Antigravity", value: "antigravity" },
];

const universal = ["amp"] as const;

const sharedStatuses: SkillStatusResult["agents"] = [
	{
		agent: "amp",
		outputDir: "/project/.agents/skills/demo",
		scope: "project",
		status: "linked",
	},
	{
		agent: "antigravity",
		outputDir: "/project/.agents/skills/demo",
		scope: "project",
		status: "linked",
	},
];

describe("planReconcile", () => {
	it("retains a shared output directory and warns the deselected choice", () => {
		expect(
			planReconcile({
				statusMap: statusMap(sharedStatuses),
				choices,
				selected: ["amp"],
				universal,
			}),
		).toEqual({
			toInstall: [],
			toUninstall: [],
			sharedDirWarnings: [{ label: "Antigravity", outputDir: "/project/.agents/skills/demo" }],
		});
	});

	it("uses selected output directories even when the selected link needs installation", () => {
		const statuses: SkillStatusResult["agents"] = [
			{ ...sharedStatuses[0]!, status: "absent" },
			sharedStatuses[1]!,
		];

		expect(
			planReconcile({
				statusMap: statusMap(statuses),
				choices,
				selected: ["amp"],
				universal,
			}),
		).toEqual({
			toInstall: ["amp"],
			toUninstall: [],
			sharedDirWarnings: [{ label: "Antigravity", outputDir: "/project/.agents/skills/demo" }],
		});
	});
});

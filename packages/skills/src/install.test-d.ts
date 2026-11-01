import type { AgentTarget } from "./agents.ts";
import { getSkillStatus, installSkill, uninstallSkill } from "./install.ts";

// Compile-time regression checks; intentionally never invoked.
// agent lists accept readonly arrays
function _typecheckAcceptsReadonlyAgents() {
	const agents = ["claude-code"] as const satisfies readonly AgentTarget[];
	void installSkill({ sourceDir: "skills/demo", agents });
	void uninstallSkill({ name: "demo", agents });
	void getSkillStatus({ name: "demo", sourceDir: "skills/demo", agents });
}
void _typecheckAcceptsReadonlyAgents;

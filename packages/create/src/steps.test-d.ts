import { runSteps } from "./steps.ts";
import type { PostScaffoldStep } from "./types.ts";

// Compile-time input acceptance; checked by check:types, never executed.
// runSteps only iterates, so a predeclared readonly step list must be accepted.
const readonlySteps = [
	{ type: "install" },
	{ type: "git-init", commit: "Initial commit" },
	{ type: "command", cmd: "echo ok" },
] as const satisfies readonly PostScaffoldStep[];
const mutableSteps: PostScaffoldStep[] = [{ type: "open-editor" }];

function _acceptsReadonlyAndMutableSteps(): void {
	void runSteps(readonlySteps, ".");
	void runSteps(mutableSteps, ".");
}

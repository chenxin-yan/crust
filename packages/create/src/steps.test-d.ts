import { runSteps } from "./steps.ts";

// Compile-time regression checks; intentionally never invoked.
async function _runStepsOptionsTests() {
	await runSteps([{ type: "install" }], ".", { signal: AbortSignal.timeout(1000) });
	// @ts-expect-error — `signal` takes an AbortSignal
	await runSteps([{ type: "install" }], ".", { signal: "abort" });
}

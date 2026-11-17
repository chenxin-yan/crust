import type { OpenApiSpec } from "./api-command.ts";
import { advertisedOutput } from "./commands.ts";
import type { CommandPlan } from "./lint.ts";
import type { Diagnostic } from "./operations.ts";

/** One generated command in {@link ApiManifest}. */
interface ManifestCommand {
	/** The command path as typed, such as `"zones get"`. */
	readonly command: string;
	readonly operationId: string;
	/** Upper case, such as `"GET"`. */
	readonly method: string;
	readonly path: string;
	/** Positional argument names, in order. */
	readonly args: readonly string[];
	/** Flag names, sorted. */
	readonly flags: readonly string[];
	/** Whether the command advertises an output JSON Schema. */
	readonly outputSchema: boolean;
}

/** The generated command surface, to snapshot in a test so a spec bump shows its CLI diff. */
export interface ApiManifest {
	/** Sorted by command path. */
	readonly commands: readonly ManifestCommand[];
	/** The lint errors, each of which leaves its operation out. */
	readonly diagnostics: readonly Diagnostic[];
}

// Code unit order, the same on every platform and locale.
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The manifest of the commands `plans` become, and the lint errors among `diagnostics`. */
export function manifest(
	spec: OpenApiSpec,
	plans: readonly CommandPlan[],
	diagnostics: readonly Diagnostic[],
): ApiManifest {
	const commands = plans.map((plan): ManifestCommand => ({
		command: plan.group === "" ? plan.name : `${plan.group} ${plan.name}`,
		operationId: plan.op.id,
		method: plan.op.method.toUpperCase(),
		path: plan.op.path,
		args: plan.inputs.filter(({ kind }) => kind === "arg").map(({ name }) => name),
		flags: plan.inputs
			.filter(({ kind }) => kind === "flag")
			.map(({ name }) => name)
			.sort(byCodeUnit),
		outputSchema: advertisedOutput(spec, plan) !== undefined,
	}));
	return {
		commands: commands.sort((a, b) => byCodeUnit(a.command, b.command)),
		diagnostics: diagnostics.filter(({ level }) => level === "error"),
	};
}

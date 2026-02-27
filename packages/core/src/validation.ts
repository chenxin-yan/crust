import { CrustError } from "./errors.ts";
import { parseArgs } from "./parser.ts";
import type { AnyCommand, ArgDef, FlagDef } from "./types.ts";

/** Returns a synthetic token that satisfies `parseArgs` for the given type. */
function sampleToken(def: ArgDef | FlagDef): string {
	switch (def.type) {
		case "number":
			return "1";
		case "boolean":
			return "true";
		default:
			return "sample";
	}
}

function createValidationArgv(command: AnyCommand): string[] {
	const argv: string[] = [];

	if (command.flags) {
		for (const [name, def] of Object.entries(
			command.flags as Record<string, FlagDef>,
		)) {
			// Skip flags that are optional or have defaults — parseArgs won't
			// complain about them being absent.
			if (def.required !== true || def.default !== undefined) continue;

			argv.push(`--${name}`);
			if (def.type !== "boolean") {
				argv.push(sampleToken(def));
			}
		}
	}

	if (command.args) {
		for (const def of command.args as readonly ArgDef[]) {
			// Skip args that are optional or have defaults.
			if (def.required !== true || def.default !== undefined) continue;

			argv.push(sampleToken(def));
		}
	}

	return argv;
}

export function validateCommandTree(root: AnyCommand): void {
	const stack: Array<{ command: AnyCommand; path: string[] }> = [
		{ command: root, path: [root.meta.name] },
	];
	const visited = new Set<AnyCommand>();

	while (stack.length > 0) {
		const item = stack.pop();
		if (!item) break;

		const { command, path } = item;
		if (visited.has(command)) continue;
		visited.add(command);

		try {
			parseArgs(command, createValidationArgv(command));
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Unknown validation error";
			throw new CrustError(
				"DEFINITION",
				`Command "${path.join(" ")}" failed runtime validation: ${message}`,
			).withCause(error);
		}

		for (const [name, subCommand] of Object.entries(command.subCommands)) {
			stack.push({ command: subCommand, path: [...path, name] });
		}
	}
}

import { CrustError } from "./errors.ts";
import type { CommandNode } from "./node.ts";
import { parseArgs } from "./parser.ts";
import type {
	AnyCommand,
	ArgDef,
	ArgsDef,
	FlagDef,
	FlagsDef,
} from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// ValidatableCommand — Structural type accepted by validation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Union of command shapes that `validateCommandTree` can validate.
 *
 * Both `AnyCommand` (old API) and `CommandNode` (new builder API) satisfy
 * this type. The validator uses `effectiveFlags` when present (CommandNode),
 * falling back to `flags` (AnyCommand).
 */
type ValidatableCommand = AnyCommand | CommandNode;

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

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

/**
 * Resolves the flags to validate for a command.
 *
 * For `CommandNode`, uses `effectiveFlags` (inherited + local merged).
 * For `AnyCommand`, uses `flags`.
 */
function resolveValidationFlags(
	command: ValidatableCommand,
): FlagsDef | undefined {
	if ("effectiveFlags" in command && command.effectiveFlags) {
		return command.effectiveFlags;
	}
	if ("flags" in command) {
		return command.flags as FlagsDef | undefined;
	}
	return undefined;
}

/**
 * Resolves the args to validate for a command.
 */
function resolveValidationArgs(
	command: ValidatableCommand,
): ArgsDef | undefined {
	return command.args as ArgsDef | undefined;
}

/**
 * Build a synthetic argv that satisfies `parseArgs` for the given command.
 *
 * Uses `effectiveFlags` when available (CommandNode) so inherited required
 * flags are included in the synthetic argv.
 */
function createValidationArgv(command: ValidatableCommand): string[] {
	const argv: string[] = [];

	const flags = resolveValidationFlags(command);
	if (flags) {
		for (const [name, def] of Object.entries(
			flags as Record<string, FlagDef>,
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

	const args = resolveValidationArgs(command);
	if (args) {
		for (const def of args as readonly ArgDef[]) {
			// Skip args that are optional or have defaults.
			if (def.required !== true || def.default !== undefined) continue;

			argv.push(sampleToken(def));
		}
	}

	return argv;
}

// ────────────────────────────────────────────────────────────────────────────
// validateCommandTree — Tree validation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Validate an entire command tree by walking each node and calling `parseArgs`
 * with a synthetic argv derived from the node's flag/arg definitions.
 *
 * This catches:
 * - Alias collisions (including between inherited and local flags)
 * - `no-` prefix violations
 * - Required flag/arg validation
 * - Variadic arg position violations
 *
 * Accepts both the old `AnyCommand` shape and the new `CommandNode` shape.
 * When validating a `CommandNode`, its `effectiveFlags` (inherited + local
 * merged) are used — so alias collisions between an inherited flag and a
 * local flag are caught.
 *
 * @param root - The root command to validate
 * @throws {CrustError} `DEFINITION` with the full command path on failure
 */
export function validateCommandTree(root: ValidatableCommand): void {
	const stack: Array<{ command: ValidatableCommand; path: string[] }> = [
		{ command: root, path: [root.meta.name] },
	];
	const visited = new Set<ValidatableCommand>();

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
			stack.push({
				command: subCommand as ValidatableCommand,
				path: [...path, name],
			});
		}
	}
}

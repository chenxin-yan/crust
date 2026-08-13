import type { CommandSnapshot, Crust } from "@crustjs/core";

/**
 * Minimal structural stand-in for the internal command node: annotations
 * attach to any object on the command tree without importing internal types.
 */
type CommandNode = object;

/** Normalizes instruction input by trimming lines and dropping empties. */
export function normalizeInstructionList(input: string | string[] | undefined): string[] {
	if (input === undefined) return [];
	return (Array.isArray(input) ? input : [input])
		.flatMap((value) => value.split(/\r?\n/))
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
}

/**
 * Agent-oriented instructions attached to a command for skills rendering.
 */
export interface SkillCommandAnnotations {
	/** Additional prompt guidance rendered into the command's markdown file */
	instructions?: string[];
}

type SkillCommandTarget = CommandNode | Crust<any, any, any, any, any, any>;

const SKILL_COMMAND_ANNOTATIONS = Symbol("crust.skill.commandAnnotations");

type AnnotatedCommandNode = CommandNode & {
	[SKILL_COMMAND_ANNOTATIONS]?: SkillCommandAnnotations;
};

function resolveCommandNode(target: SkillCommandTarget): CommandNode {
	// Structural check instead of `instanceof`: Crust class identity differs
	// across separately-bundled entry points (index vs tooling).
	return "_node" in target ? target._node : target;
}

/**
 * Attaches agent-facing instructions to a command definition without changing
 * the public `@crustjs/core` API surface.
 *
 * The instructions are stored on the internal command node using an enumerable
 * symbol so they survive Crust's immutable clone/spread builder operations.
 *
 * Duplicate instructions are silently deduplicated — calling `annotate()` again
 * with the same text is a safe no-op.
 */
export function annotate<T extends SkillCommandTarget>(
	target: T,
	annotations: string | string[] | SkillCommandAnnotations,
): T {
	const command = resolveCommandNode(target) as AnnotatedCommandNode;
	const nextInstructions = normalizeInstructionList(
		typeof annotations === "string" || Array.isArray(annotations)
			? annotations
			: (annotations.instructions ?? []),
	);

	if (nextInstructions.length === 0) {
		return target;
	}

	const existing = getSkillCommandAnnotations(command)?.instructions ?? [];
	const merged = [...new Set([...existing, ...nextInstructions])];

	Object.defineProperty(command, SKILL_COMMAND_ANNOTATIONS, {
		value: { instructions: merged },
		enumerable: true,
		configurable: true,
	});

	return target;
}

/**
 * Reads skill-specific command annotations from a command node or snapshot
 * (snapshots pass enumerable symbol-keyed annotations through).
 */
export function getSkillCommandAnnotations(
	command: CommandNode | CommandSnapshot,
): SkillCommandAnnotations | undefined {
	const annotations = (command as AnnotatedCommandNode)[SKILL_COMMAND_ANNOTATIONS];

	if (!annotations?.instructions || annotations.instructions.length === 0) {
		return undefined;
	}

	return {
		instructions: [...annotations.instructions],
	};
}

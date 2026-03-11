import type { CommandNode } from "@crustjs/core";
import { Crust } from "@crustjs/core";
import { normalizeInstructionList } from "./instructions.ts";

/**
 * Agent-oriented instructions attached to a command for skills rendering.
 */
export interface SkillCommandAnnotations {
	/** Additional prompt guidance rendered into the command's markdown file */
	instructions?: string[];
}

// biome-ignore lint/suspicious/noExplicitAny: Crust is generic; we only need the _node accessor
type SkillCommandTarget = CommandNode | Crust<any, any, any>;

const SKILL_COMMAND_ANNOTATIONS = Symbol("crust.skill.commandAnnotations");

type AnnotatedCommandNode = CommandNode & {
	[SKILL_COMMAND_ANNOTATIONS]?: SkillCommandAnnotations;
};

function resolveCommandNode(target: SkillCommandTarget): CommandNode {
	return target instanceof Crust ? target._node : target;
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
 * Reads skill-specific command annotations from a command node.
 */
export function getSkillCommandAnnotations(
	command: CommandNode,
): SkillCommandAnnotations | undefined {
	const annotations = (command as AnnotatedCommandNode)[
		SKILL_COMMAND_ANNOTATIONS
	];

	if (!annotations?.instructions || annotations.instructions.length === 0) {
		return undefined;
	}

	return {
		instructions: [...annotations.instructions],
	};
}

import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

type RuntimeFunction = ESTree.ArrowFunctionExpression | ESTree.Function;

function isRuntimeFunction(node: ESTree.Node): node is RuntimeFunction {
	return (
		node.type === "ArrowFunctionExpression" ||
		node.type === "FunctionDeclaration" ||
		node.type === "FunctionExpression"
	);
}

function isRuleOptions(value: unknown): value is { readonly allowInTypeGuards?: boolean } {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInsideTypeGuard(node: ESTree.Node): boolean {
	let current: ESTree.Node | null = node.parent;
	while (current !== null && current.type !== "Program") {
		if (isRuntimeFunction(current)) {
			return current.returnType?.typeAnnotation.type === "TSTypePredicate";
		}
		current = current.parent;
	}
	return false;
}

/** Disallow runtime typeof checks that narrow unparsed values instead of decoding them. */
export const noRuntimeTypeofRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow runtime typeof checks; external values must be decoded into meaningful types at their I/O boundary.",
		},
		messages: {
			runtimeTypeof:
				"A `typeof` check narrows a representation without establishing its contract. Parse input at its I/O boundary, then branch on the domain value.",
		},
		schema: [
			{
				type: "object",
				properties: {
					allowInTypeGuards: { type: "boolean" },
				},
				additionalProperties: false,
			},
		],
		defaultOptions: [{ allowInTypeGuards: false }],
	},
	createOnce(context) {
		let allowInTypeGuards = false;

		return {
			Program() {
				const options = context.options?.[0];
				allowInTypeGuards = isRuleOptions(options) && options.allowInTypeGuards === true;
			},
			UnaryExpression(node) {
				if (node.operator === "typeof" && (!allowInTypeGuards || !isInsideTypeGuard(node))) {
					context.report({ node, messageId: "runtimeTypeof" });
				}
			},
		};
	},
});

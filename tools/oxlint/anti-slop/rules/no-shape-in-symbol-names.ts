import { defineRule } from "@oxlint/plugins";
import type { ESTree, SourceCode } from "@oxlint/plugins";

import { resolveVariable, type NamedNode } from "../shared/scope.ts";

const FORBIDDEN_SYMBOL_NAME = /shape/iu;

function containsForbiddenSymbolName(name: string): boolean {
	return FORBIDDEN_SYMBOL_NAME.test(name);
}

function isImportedIdentifier(sourceCode: SourceCode, node: NamedNode): boolean {
	if (node.type === "Identifier" && node.parent.type === "ImportSpecifier") return true;
	const variable = resolveVariable(sourceCode, node);
	return variable?.defs.some((definition) => definition.type === "ImportBinding") ?? false;
}

function isExternalMemberName(node: ESTree.Identifier): boolean {
	const parent = node.parent;
	return parent.type === "MemberExpression" && !parent.computed && parent.property === node;
}

/** Ban the case-insensitive substring "shape" in owned JavaScript and TypeScript symbol names. */
export const noForbiddenTermInSymbolNamesRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				'Disallow the case-insensitive substring "shape" in owned JavaScript, TypeScript, private, and JSX symbol names.',
		},
		messages: {
			forbiddenSymbolName:
				'Rename symbol "{{name}}" for its domain role; "shape" describes structure rather than ownership.',
		},
	},
	createOnce(context) {
		const reportForbiddenSymbolName = (node: ESTree.Node & { name: string }) => {
			if (!containsForbiddenSymbolName(node.name)) return;
			if (
				(node.type === "Identifier" && isExternalMemberName(node)) ||
				((node.type === "Identifier" || node.type === "JSXIdentifier") &&
					isImportedIdentifier(context.sourceCode, node))
			) {
				return;
			}
			context.report({
				node,
				messageId: "forbiddenSymbolName",
				data: { name: node.name },
			});
		};

		return {
			Identifier: reportForbiddenSymbolName,
			PrivateIdentifier: reportForbiddenSymbolName,
			JSXIdentifier: reportForbiddenSymbolName,
		};
	},
});

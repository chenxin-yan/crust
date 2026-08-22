import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

import { lexicalTypeParameterNames } from "../shared/lexical-type-parameters.ts";
import { resolvesToKeyword } from "../shared/type-aliases.ts";

const PROMISE_WRAPPERS: ReadonlySet<string> = new Set(["Promise", "PromiseLike"]);

type FunctionWithReturnType =
	| ESTree.ArrowFunctionExpression
	| ESTree.Function
	| ESTree.TSCallSignatureDeclaration
	| ESTree.TSConstructSignatureDeclaration
	| ESTree.TSConstructorType
	| ESTree.TSFunctionType
	| ESTree.TSMethodSignature;

/** Ban function contracts that return unknown instead of a parsed domain type. */
export const noUnknownReturnsRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow functions whose explicit return contract is unknown or Promise<unknown>.",
		},
		messages: {
			unknownReturn:
				"This function exposes `unknown` to its caller. Parse the value at its boundary and return a named domain type.",
		},
	},
	createOnce(context) {
		const aliases = new Map<string, ESTree.TSTypeAliasDeclaration>();

		const resolvesToUnknown = (
			type: ESTree.TSType,
			shadowedAliases: ReadonlySet<string>,
		): boolean =>
			resolvesToKeyword(type, aliases, "TSUnknownKeyword", {
				shadowedAliases,
				wrapperNames: PROMISE_WRAPPERS,
			});

		const checkReturnType = (node: FunctionWithReturnType) => {
			const annotation = node.returnType;
			if (annotation === null || annotation === undefined) return;
			if (!resolvesToUnknown(annotation.typeAnnotation, new Set())) return;
			const shadowedAliases = lexicalTypeParameterNames(node, context.sourceCode.visitorKeys);
			if (!resolvesToUnknown(annotation.typeAnnotation, shadowedAliases)) return;
			context.report({ node: annotation.typeAnnotation, messageId: "unknownReturn" });
		};

		return {
			Program(node) {
				aliases.clear();
				for (const statement of node.body) {
					const declaration =
						statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
					if (declaration?.type === "TSTypeAliasDeclaration") {
						aliases.set(declaration.id.name, declaration);
					}
				}
			},
			ArrowFunctionExpression: checkReturnType,
			FunctionDeclaration: checkReturnType,
			FunctionExpression: checkReturnType,
			TSCallSignatureDeclaration: checkReturnType,
			TSConstructSignatureDeclaration: checkReturnType,
			TSConstructorType: checkReturnType,
			TSDeclareFunction: checkReturnType,
			TSEmptyBodyFunctionExpression: checkReturnType,
			TSFunctionType: checkReturnType,
			TSMethodSignature: checkReturnType,
		};
	},
});

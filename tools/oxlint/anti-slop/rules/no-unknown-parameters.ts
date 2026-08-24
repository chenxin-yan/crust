import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

import { parameterAnnotation, type Parameter, type ParameterOwner } from "../shared/parameters.ts";

const BOUNDARY_FUNCTION_NAME = /^(?:parse|validate)(?:[A-Z0-9_]|$)/u;

function parameterName(parameter: Parameter, sourceText: string): string {
	if (parameter.type === "TSParameterProperty") {
		return parameterName(parameter.parameter, sourceText);
	}
	if (parameter.type === "AssignmentPattern") {
		return parameterName(parameter.left, sourceText);
	}
	if (parameter.type === "RestElement") {
		return parameterName(parameter.argument, sourceText);
	}
	return parameter.type === "Identifier"
		? parameter.name
		: sourceText.replace(/\s*:\s*unknown\s*$/u, "");
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}

function propertyName(key: ESTree.PropertyKey): string | null {
	if (key.type === "Identifier" || key.type === "PrivateIdentifier") return key.name;
	return key.type === "Literal" && isString(key.value) ? key.value : null;
}

function functionName(node: ParameterOwner): string | null {
	if (
		(node.type === "FunctionDeclaration" || node.type === "FunctionExpression") &&
		node.id !== null
	) {
		return node.id.name;
	}
	if (node.type === "TSMethodSignature") return propertyName(node.key);

	const parent = node.parent;
	if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier") {
		return parent.id.name;
	}
	if (
		parent.type === "MethodDefinition" ||
		parent.type === "Property" ||
		parent.type === "PropertyDefinition"
	) {
		return propertyName(parent.key);
	}
	return null;
}

function isTypeGuardOrAssertion(node: ParameterOwner): boolean {
	return node.returnType?.typeAnnotation.type === "TSTypePredicate";
}

function isBoundaryFunction(node: ParameterOwner): boolean {
	const name = functionName(node);
	return isTypeGuardOrAssertion(node) || (name !== null && BOUNDARY_FUNCTION_NAME.test(name));
}

/** Disallow unknown inputs except error causes and explicitly configured parsing boundaries. */
export const noUnknownParametersRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow explicitly unknown function parameters except `cause` and configured parsing boundaries.",
		},
		messages: {
			unknownParameter:
				"Parameter `{{parameter}}` leaves input unparsed. Accept a named domain type; run the expected schema or parser at the I/O boundary before calling this function.",
		},
		schema: [
			{
				type: "object",
				properties: {
					allowInBoundaryFunctions: { type: "boolean" },
				},
				additionalProperties: false,
			},
		],
		defaultOptions: [{ allowInBoundaryFunctions: false }],
	},
	createOnce(context) {
		let allowInBoundaryFunctions = false;

		function isRuleOptions(
			value: unknown,
		): value is { readonly allowInBoundaryFunctions?: boolean } {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}

		const checkParameters = (node: ParameterOwner) => {
			if (allowInBoundaryFunctions && isBoundaryFunction(node)) return;
			for (const parameter of node.params) {
				const annotation = parameterAnnotation(parameter);
				if (annotation?.typeAnnotation.type !== "TSUnknownKeyword") continue;
				const name = parameterName(parameter, context.sourceCode.getText(parameter));
				if (name === "cause") continue;
				context.report({
					node: annotation.typeAnnotation,
					messageId: "unknownParameter",
					data: { parameter: name },
				});
			}
		};

		return {
			Program() {
				const options = context.options?.[0];
				allowInBoundaryFunctions =
					isRuleOptions(options) && options.allowInBoundaryFunctions === true;
			},
			ArrowFunctionExpression: checkParameters,
			FunctionDeclaration: checkParameters,
			FunctionExpression: checkParameters,
			TSCallSignatureDeclaration: checkParameters,
			TSConstructSignatureDeclaration: checkParameters,
			TSConstructorType: checkParameters,
			TSDeclareFunction: checkParameters,
			TSEmptyBodyFunctionExpression: checkParameters,
			TSFunctionType: checkParameters,
			TSMethodSignature: checkParameters,
		};
	},
});

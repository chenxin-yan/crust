import { defineRule } from "@oxlint/plugins";
import type { ESTree, SourceCode, Variable } from "@oxlint/plugins";

import { resolveVariable } from "../shared/scope.ts";

const moduleMockMethods = new Set(["doMock", "mock", "setMock", "unstable_mockModule"]);

type TestFramework = "bun" | "jest" | "vitest";

function importedName(node: ESTree.Node): string | null {
	if (node.type !== "ImportSpecifier") return null;
	return node.imported.type === "Identifier" ? node.imported.name : node.imported.value;
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}

function importedFrameworkObject(variable: Variable): TestFramework | null {
	for (const definition of variable.defs) {
		if (definition.type !== "ImportBinding" || definition.parent?.type !== "ImportDeclaration") {
			continue;
		}
		const source = definition.parent.source.value;
		const name = importedName(definition.node);
		if (source === "vitest" && name === "vi") return "vitest";
		if (source === "@jest/globals" && name === "jest") return "jest";
		if (source === "bun:test" && name === "mock") return "bun";
	}
	return null;
}

function importedNamespaceFrameworkObject(
	variable: Variable,
	member: string | null,
): TestFramework | null {
	for (const definition of variable.defs) {
		if (
			definition.type !== "ImportBinding" ||
			definition.node.type !== "ImportNamespaceSpecifier" ||
			definition.parent?.type !== "ImportDeclaration"
		) {
			continue;
		}
		const source = definition.parent.source.value;
		if (source === "vitest" && member === "vi") return "vitest";
		if (source === "@jest/globals" && member === "jest") return "jest";
		if (source === "bun:test" && member === "mock") return "bun";
	}
	return null;
}

function testFrameworkObject(
	sourceCode: SourceCode,
	expression: ESTree.Expression,
): TestFramework | null {
	if (expression.type !== "Identifier") {
		if (!("object" in expression) || expression.object.type !== "Identifier") return null;
		const variable = resolveVariable(sourceCode, expression.object);
		return variable === null
			? null
			: importedNamespaceFrameworkObject(variable, memberMethod(expression));
	}
	if (
		(expression.name === "vi" || expression.name === "jest") &&
		sourceCode.isGlobalReference(expression)
	) {
		return expression.name === "vi" ? "vitest" : "jest";
	}

	const variable = resolveVariable(sourceCode, expression);
	if (variable === null || variable.defs.length === 0) {
		if (expression.name === "vi") return "vitest";
		if (expression.name === "jest") return "jest";
		return null;
	}
	return importedFrameworkObject(variable);
}

function memberMethod(callee: ESTree.Expression): string | null {
	if (!("property" in callee) || !("computed" in callee)) return null;
	const property = callee.property;
	if (callee.computed) {
		return property.type === "Literal" && isString(property.value) ? property.value : null;
	}
	return property.type === "Identifier" ? property.name : null;
}

function moduleMockCall(sourceCode: SourceCode, callee: ESTree.Expression): boolean {
	if (!("object" in callee)) return false;
	const framework = testFrameworkObject(sourceCode, callee.object);
	const method = memberMethod(callee);
	if (framework === "bun") return method === "module";
	return framework !== null && method !== null && moduleMockMethods.has(method);
}

/** Ban test framework module mocking in favor of real dependency seams. */
export const noModuleMockingRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow Bun, Vitest, and Jest module mocking; tests must replace dependencies through real interfaces.",
		},
		messages: {
			moduleMock:
				"Replace module mocking with dependency injection through a real interface, service layer, or faithful test implementation.",
		},
	},
	createOnce(context) {
		return {
			CallExpression(node) {
				if (node.callee.type === "Super" || node.callee.type === "V8IntrinsicExpression") return;
				if (moduleMockCall(context.sourceCode, node.callee)) {
					context.report({ node, messageId: "moduleMock" });
				}
			},
		};
	},
});

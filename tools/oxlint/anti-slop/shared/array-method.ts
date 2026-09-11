import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";

function isString(value: unknown): value is string {
	return typeof value === "string";
}

function unwrapOnce(node: ESTree.Node): ESTree.Node | null {
	return node.type === "ParenthesizedExpression" ||
		node.type === "ChainExpression" ||
		node.type === "TSAsExpression" ||
		node.type === "TSTypeAssertion" ||
		node.type === "TSNonNullExpression" ||
		node.type === "TSSatisfiesExpression"
		? node.expression
		: null;
}

/** Unwrap syntax-only wrappers when inspecting array methods and accumulator references. */
export function unwrapArrayExpression(node: ESTree.Node): ESTree.Node {
	for (let inner = unwrapOnce(node); inner !== null; inner = unwrapOnce(node)) node = inner;
	return node;
}

/** Resolve a local binding by scope, not by identifier spelling. */
export function resolveArrayBinding(sourceCode: SourceCode, node: ESTree.Node): Variable | null {
	node = unwrapArrayExpression(node);
	if (node.type !== "Identifier") return null;
	let scope: Scope | null = sourceCode.getScope(node);
	while (scope !== null) {
		const variable = scope.set.get(node.name);
		if (variable !== undefined) return variable;
		scope = scope.upper;
	}
	return null;
}

/** Read static method names, including computed string literals, without evaluating expressions. */
export function arrayMethodTarget(
	node: ESTree.Node,
): { readonly name: string; readonly object: ESTree.Node } | null {
	node = unwrapArrayExpression(node);
	if (node.type !== "MemberExpression") return null;
	const property = node.property;
	if (!node.computed && property.type === "Identifier") {
		return { name: property.name, object: node.object };
	}
	if (node.computed && property.type === "Literal" && isString(property.value)) {
		return { name: property.value, object: node.object };
	}
	return null;
}

function isArrayAnnotation(type: ESTree.TSType): boolean {
	if (type.type === "TSArrayType" || type.type === "TSTupleType") return true;
	if (type.type === "TSParenthesizedType") return isArrayAnnotation(type.typeAnnotation);
	if (type.type === "TSTypeOperator" && type.operator === "readonly") {
		return isArrayAnnotation(type.typeAnnotation);
	}
	return (
		type.type === "TSTypeReference" &&
		type.typeName.type === "Identifier" &&
		(type.typeName.name === "Array" || type.typeName.name === "ReadonlyArray")
	);
}

/** Static factories whose result is always an array: method name → owning global. */
const ARRAY_FACTORIES: ReadonlyMap<string, string> = new Map([
	["entries", "Object"],
	["keys", "Object"],
	["values", "Object"],
	["from", "Array"],
]);

/** True when `node` is the unshadowed global binding `name` (e.g. `Object`, `Array`). */
export function isGlobalOwner(sourceCode: SourceCode, node: ESTree.Node, name: string): boolean {
	node = unwrapArrayExpression(node);
	if (node.type !== "Identifier" || node.name !== name) return false;
	const variable = resolveArrayBinding(sourceCode, node);
	return variable === null || variable.defs.length === 0;
}

/** Recognize local array evidence; unknown receivers and iterator pipelines are deliberately excluded. */
export function isKnownArrayExpression(
	sourceCode: SourceCode,
	node: ESTree.Node,
	visited = new Set<Variable>(),
): boolean {
	// `loadUsers() as User[]` is explicit array evidence even though the callee is unknown.
	for (let current: ESTree.Node | null = node; current !== null; current = unwrapOnce(current)) {
		if (
			(current.type === "TSAsExpression" || current.type === "TSTypeAssertion") &&
			isArrayAnnotation(current.typeAnnotation)
		) {
			return true;
		}
	}
	node = unwrapArrayExpression(node);
	if (node.type === "ArrayExpression") return true;
	if (node.type === "CallExpression") {
		const method = arrayMethodTarget(node.callee);
		if (method === null) return false;
		const owner = ARRAY_FACTORIES.get(method.name);
		if (owner !== undefined && isGlobalOwner(sourceCode, method.object, owner)) return true;
		return (
			[
				"map",
				"filter",
				"flatMap",
				"slice",
				"concat",
				"toSorted",
				"toReversed",
				"toSpliced",
			].includes(method.name) && isKnownArrayExpression(sourceCode, method.object, visited)
		);
	}
	if (node.type !== "Identifier") return false;
	const variable = resolveArrayBinding(sourceCode, node);
	if (variable === null || visited.has(variable)) return false;
	visited.add(variable);
	if (variable.references.some((reference) => reference.isWrite() && !reference.init)) return false;
	for (const identifier of variable.identifiers) {
		const annotation = identifier.typeAnnotation?.typeAnnotation;
		if (annotation !== undefined) return isArrayAnnotation(annotation);
	}
	for (const definition of variable.defs) {
		if (
			definition.type === "Variable" &&
			definition.node.type === "VariableDeclarator" &&
			definition.node.id.type === "Identifier" &&
			definition.node.init !== null &&
			definition.node.parent.type === "VariableDeclaration" &&
			definition.node.parent.kind === "const"
		) {
			return isKnownArrayExpression(sourceCode, definition.node.init, visited);
		}
	}
	return false;
}

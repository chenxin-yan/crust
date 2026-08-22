import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";

export type NamedNode = ESTree.Node & { readonly name: string };

export function resolveVariable(sourceCode: SourceCode, identifier: NamedNode): Variable | null {
	let scope: Scope | null = sourceCode.getScope(identifier);
	while (scope !== null) {
		const variable = scope.set.get(identifier.name);
		if (variable !== undefined) return variable;
		scope = scope.upper;
	}
	return null;
}

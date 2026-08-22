import type { ESTree } from "@oxlint/plugins";

const EMPTY_NAMES: ReadonlySet<string> = new Set();

interface KeywordResolutionOptions {
	readonly shadowedAliases?: ReadonlySet<string>;
	readonly wrapperNames?: ReadonlySet<string>;
	readonly visited?: ReadonlySet<string>;
}

/** Resolves a type through transparent syntax, unions, and non-generic module aliases. */
export function resolvesToKeyword(
	type: ESTree.TSType,
	aliases: ReadonlyMap<string, ESTree.TSTypeAliasDeclaration>,
	keyword: "TSObjectKeyword" | "TSUnknownKeyword",
	options: KeywordResolutionOptions = {},
): boolean {
	const {
		shadowedAliases = EMPTY_NAMES,
		wrapperNames = EMPTY_NAMES,
		visited = EMPTY_NAMES,
	} = options;
	if (type.type === keyword) return true;
	if (type.type === "TSParenthesizedType") {
		return resolvesToKeyword(type.typeAnnotation, aliases, keyword, options);
	}
	if (type.type === "TSUnionType") {
		return type.types.some((member) => resolvesToKeyword(member, aliases, keyword, options));
	}
	if (type.type !== "TSTypeReference" || type.typeName.type !== "Identifier") return false;
	const name = type.typeName.name;
	if (wrapperNames.has(name)) {
		const wrapped = type.typeArguments?.params[0];
		return wrapped !== undefined && resolvesToKeyword(wrapped, aliases, keyword, options);
	}
	if (type.typeArguments?.params.length || visited.has(name) || shadowedAliases.has(name)) {
		return false;
	}
	const alias = aliases.get(name);
	if (
		alias === undefined ||
		(alias.typeParameters !== null && alias.typeParameters !== undefined)
	) {
		return false;
	}
	const nextVisited = new Set(visited);
	nextVisited.add(name);
	return resolvesToKeyword(alias.typeAnnotation, aliases, keyword, {
		shadowedAliases,
		wrapperNames,
		visited: nextVisited,
	});
}

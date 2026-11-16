import { OAuthConfigError } from "./errors.ts";

/** A scope string, or `undefined` to omit it (SEC-B6). */
export function checkScope(scope: unknown): string | undefined {
	if (scope !== undefined && (typeof scope !== "string" || scope.trim() === "")) {
		throw new OAuthConfigError("invalid-option", "scope must be a non-empty string");
	}
	return scope;
}

/** RFC 8707 resource indicators: absolute URIs without a fragment (SEC-B5). */
export function checkResources(resource: unknown): readonly string[] {
	if (resource === undefined) return [];
	const values = typeof resource === "string" ? [resource] : resource;
	if (!Array.isArray(values)) {
		throw new OAuthConfigError("invalid-option", "resource must be a URI or a list of URIs");
	}
	for (const value of values) {
		if (typeof value !== "string" || value.includes("#") || !URL.canParse(value)) {
			throw new OAuthConfigError(
				"invalid-option",
				"Each resource must be an absolute URI without a fragment",
			);
		}
	}
	return Object.freeze([...(values as string[])]);
}

// ────────────────────────────────────────────────────────────────────────────
// Shared FlagSpec runtime guards — provider-agnostic
// ────────────────────────────────────────────────────────────────────────────

/** Minimal shape of a `flag()` wrapper that both Zod and Effect providers produce. */
export interface FlagSpecLike {
	readonly kind: "flag";
	readonly schema: unknown;
	readonly alias: string | readonly string[] | undefined;
}

/** Narrow unknown input to a `flag()` wrapper. */
export function isFlagSpec(value: unknown): value is FlagSpecLike {
	return (
		typeof value === "object" &&
		value !== null &&
		"kind" in value &&
		(value as { kind?: unknown }).kind === "flag"
	);
}

/** Resolve the underlying schema from a plain schema or a `flag()` wrapper. */
export function getFlagSchema(value: unknown): unknown {
	return isFlagSpec(value) ? value.schema : value;
}

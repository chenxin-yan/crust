import type { ContextInstance } from "../api/context.ts";
import { CrustError } from "../errors.ts";

/** `.provide()` accepts Context instances, not factories or arbitrary values. */
export function definitionProvenance(instance: ContextInstance): void {
	if ((instance as Partial<ContextInstance> | null)?.kind === "context") return;
	throw new CrustError(
		"DEFINITION",
		"provide() requires Context instances — invoke the factory returned by defineContext() (e.g. .provide(db(options)))",
		{ subject: "context", reason: "not-a-context" },
	);
}

/** Context names are unique on a command path. */
export function duplicateContext(
	instance: ContextInstance,
	existing: readonly ContextInstance[],
): void {
	if (!existing.some((entry) => entry.name === instance.name)) return;
	throw new CrustError(
		"DEFINITION",
		`Context "${instance.name}" is already provided on this command path`,
		{
			subject: "context",
			name: instance.name,
			reason: "duplicate-context",
		},
	);
}

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

/** Every declared Context dependency must be present on the command path. */
export function missingContextDependency(
	contexts: readonly ContextInstance[],
	where: string,
): void {
	const provided = new Set(contexts.map((context) => context.name));
	for (const context of contexts) {
		for (const dep of context.requiredCtx) {
			if (!provided.has(dep)) {
				throw new CrustError(
					"DEFINITION",
					`Context "${context.name}" requires Context "${dep}", which is not provided on ${where}`,
					{
						subject: "context",
						name: context.name,
						reason: "missing-context-dependency",
					},
				);
			}
		}
	}
}

/** Context dependency graphs must be acyclic; returns their topological order. */
export function contextCycle(
	contexts: readonly ContextInstance[],
	where: string,
): ContextInstance[] {
	const sorted: ContextInstance[] = [];
	const constructed = new Set<string>();
	let remaining = [...contexts];
	while (remaining.length > 0) {
		const ready = remaining.filter((context) =>
			context.requiredCtx.every((dep) => constructed.has(dep)),
		);
		if (ready.length === 0) {
			const names = remaining.map((context) => `"${context.name}"`).join(", ");
			throw new CrustError("DEFINITION", `Contexts ${names} form a dependency cycle on ${where}`, {
				subject: "context",
				reason: "context-cycle",
			});
		}
		for (const context of ready) {
			sorted.push(context);
			constructed.add(context.name);
		}
		remaining = remaining.filter((context) => !constructed.has(context.name));
	}
	return sorted;
}

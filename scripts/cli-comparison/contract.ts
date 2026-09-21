/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- This module is the shared validation boundary for untrusted third-party parser results. */
export type Result =
	| {
			command: "deploy";
			target: string;
			region: string;
			replicas: number;
			force: boolean;
			tag: string[];
	  }
	| { command: "config"; key: string; value: string | null };
export type Invoke = (argv: string[]) => Result | Promise<Result>;

// Application validation, not token parsing. Text fields must be nonempty;
// parser-only libraries need this because missing string values can become "".
export function text(value: unknown): string {
	if (typeof value !== "string" || !value.length) throw new Error("Expected nonempty text");
	return value;
}
export function finite(value: unknown): number {
	if (typeof value !== "number" && typeof value !== "string") throw new Error("Expected number");
	if (typeof value === "string" && !value.trim()) throw new Error("Expected number");
	const number = Number(value);
	if (!Number.isFinite(number)) throw new Error("Expected finite number");
	return number;
}
export function deploy(
	target: unknown,
	region: unknown,
	replicas: unknown,
	force: unknown,
	tag: unknown,
): Result {
	if (typeof force !== "boolean") throw new Error("Expected boolean");
	const tags = tag === undefined ? [] : Array.isArray(tag) ? tag : [tag];
	return {
		command: "deploy",
		target: text(target),
		region: text(region),
		replicas: finite(replicas),
		force,
		tag: tags.map(text),
	};
}
export function config(key: unknown, value: unknown): Result {
	return { command: "config", key: text(key), value: value === undefined ? null : text(value) };
}
export function completed(result: Result | undefined): Result {
	if (!result) throw new Error("No command dispatched");
	return result;
}
// Bare parsers have no command router. This glue is included in their measurements.
type RoutedArgs = { command: "deploy" | "config"; args: string[] };
export function route(argv: string[]): RoutedArgs {
	const [command, ...args] = argv;
	if (command !== "deploy" && command !== "config") throw new Error("Unknown command");
	return { command, args };
}
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Only keys are inspected here; parser values are validated by text/finite/deploy/config.
export function knownKeys(parsed: Record<string, unknown>, command: "deploy" | "config"): void {
	const allowed =
		command === "deploy"
			? ["_", "region", "r", "replicas", "n", "force", "f", "tag", "t"]
			: ["_", "value", "v"];
	for (const key of Object.keys(parsed))
		if (!allowed.includes(key)) throw new Error(`Unknown option: ${key}`);
}

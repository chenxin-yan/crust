import {
	type ExtensionFactory,
	type ExtensionId,
	CrustError,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";

const JSON_INPUT: ExtensionId = /* @__PURE__ */ defineExtensionId("crust:input");

const inputFlags = {
	input: {
		type: "string",
		description: "Arguments and flags as a JSON object: inline JSON, @file, or - for stdin",
	},
} as const;

/** Inline JSON, `@path` (relative to the working directory), or `-` (all of stdin). */
async function readInput(value: string, signal: AbortSignal): Promise<string> {
	if (value !== "-" && !value.startsWith("@")) return value;
	try {
		return value === "-"
			? await (await import("@crustjs/utils/process")).readStdin(signal)
			: process.getBuiltinModule("node:fs").readFileSync(value.slice(1), "utf8");
	} catch (cause) {
		// Cancellation stays an abort, not a PARSE failure.
		if (signal.aborted && cause === signal.reason) throw cause;
		const name = value === "-" ? "stdin" : `"${value.slice(1)}"`;
		const reason = cause instanceof Error ? ` (${cause.message})` : "";
		throw new CrustError("PARSE", `--input: cannot read ${name}${reason}`).withCause(cause);
	}
}

/**
 * Adds a recursive `--input` flag that takes the routed command's arguments and
 * flags as one JSON object keyed by their names, plus `raw` for passthrough
 * values: inline JSON, `@path` to read a file, or `-` to read stdin. Values given
 * on argv win over the same keys; every other key replaces the environment value
 * or default. It binds in `setup`, so every `preRun` sees the values whatever the
 * `.extend()` order, and `--input` is read even when a flag handler such as
 * `--help` takes over. Adds a "JSON input" section to the root command's
 * documentation saying so.
 */
export const input: ExtensionFactory<[], {}, [], typeof inputFlags> =
	/* @__PURE__ */ defineExtension(JSON_INPUT).factory((extension) =>
		extension
			.flags(inputFlags)
			.sections(() => [
				{
					command: [],
					title: "JSON input",
					body: "--input takes the command's arguments and flags as one JSON object keyed by name. Values given on the command line win.",
				},
			])
			// Setup, not preRun: setups all run before the first preRun, so no check misses the values.
			.setup(async (context) => {
				if (typeof context.flags.input !== "string") return;
				const inputValue = context.flags.input;
				const text = await readInput(inputValue, context.signal);
				let values: unknown;
				try {
					values = JSON.parse(text);
				} catch {
					// No engine reason or cause: newer engines quote a snippet of the input.
					throw new CrustError(
						"PARSE",
						inputValue === "-"
							? "--input: invalid JSON from stdin."
							: inputValue.startsWith("@")
								? `--input: invalid JSON in "${inputValue.slice(1)}".`
								: "--input: invalid inline JSON.",
					);
				}
				if (typeof values !== "object" || values === null || Array.isArray(values)) {
					throw new CrustError(
						"PARSE",
						"--input: expected a JSON object keyed by argument and flag names",
					);
				}
				const { commandInputSchema, parseCommandInput, RAW_INPUT_PROPERTY } =
					await import("@crustjs/core/tooling");
				try {
					// Throws when an arg and a flag share a name or one is named `raw`: keys would be ambiguous.
					commandInputSchema(context.command, context.commandPath);
				} catch (cause) {
					const reason = cause instanceof Error ? cause.message : String(cause);
					throw new CrustError("PARSE", `--input: ${reason}`).withCause(cause);
				}
				// Drop keys argv gave before conversion, so an invalid overridden value never fails.
				const { args, flags, raw } = context.sources;
				const given = new Set(
					[
						...Object.entries(args),
						// Extension flags are not input keys: `--input` itself must not hide an `input` argument.
						...Object.entries(flags).filter(([name]) => !context.command.flags[name]?.extension),
						[RAW_INPUT_PROPERTY, raw],
					]
						.filter(([, source]) => source === "argv")
						.map(([name]) => name),
				);
				const supplied = Object.fromEntries(
					Object.entries(values).filter(([name]) => !given.has(name)),
				);
				context.bindInput(parseCommandInput(context.command, supplied));
			}),
	);

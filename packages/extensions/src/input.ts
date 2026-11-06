import {
	type ExtensionFactory,
	type ExtensionId,
	CrustError,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";
import type { RunInputPayload } from "@crustjs/core/tooling";

const JSON_INPUT: ExtensionId = /* @__PURE__ */ defineExtensionId("crust:input");

const inputFlags = {
	input: {
		type: "string",
		description: "Arguments and flags as a JSON object: inline JSON, @file, or - for stdin",
	},
} as const;

/** Inline JSON, `@path` (relative to the working directory), or `-` (all of stdin). */
function readInput(value: string): string {
	if (value !== "-" && !value.startsWith("@")) return value;
	const source = value === "-" ? 0 : value.slice(1);
	try {
		return process.getBuiltinModule("node:fs").readFileSync(source, "utf8");
	} catch (cause) {
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
 * or default.
 */
export const input: ExtensionFactory<[], {}, [], typeof inputFlags> =
	/* @__PURE__ */ defineExtension(JSON_INPUT).factory((extension) =>
		extension.flags(inputFlags).preRun(async (context) => {
			if (typeof context.flags.input !== "string") return;
			const text = readInput(context.flags.input);
			let values: unknown;
			try {
				values = JSON.parse(text);
			} catch (cause) {
				const reason = cause instanceof Error ? cause.message : String(cause);
				throw new CrustError("PARSE", `--input: invalid JSON (${reason})`).withCause(cause);
			}
			if (typeof values !== "object" || values === null || Array.isArray(values)) {
				throw new CrustError(
					"PARSE",
					"--input: expected a JSON object keyed by argument and flag names",
				);
			}
			const { parseCommandInput, RAW_INPUT_PROPERTY } = await import("@crustjs/core/tooling");
			// Drop keys argv gave before conversion, so an invalid overridden value never fails.
			const { args, flags, raw } = context.argvProvided;
			const given = new Set([...args, ...flags, ...(raw ? [RAW_INPUT_PROPERTY] : [])]);
			const supplied = Object.fromEntries(
				Object.entries(values).filter(([name]) => !given.has(name)),
			);
			let payload: RunInputPayload;
			try {
				payload = parseCommandInput(context.command, supplied);
			} catch (cause) {
				if (cause instanceof CrustError) throw cause;
				// parseCommandInput throws a TypeError for an invalid `url` value.
				const reason = cause instanceof Error ? cause.message : String(cause);
				throw new CrustError("PARSE", `--input: expected a URL (${reason})`).withCause(cause);
			}
			context.bindInput(payload);
		}),
	);

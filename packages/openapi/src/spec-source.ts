import { isSourceRun, resolveArtifactDir } from "@crustjs/utils/artifacts";

import type { OpenApiSpec } from "./api-command.ts";

/** The file `crust build` writes the spec of a URL `spec` to, below the artifact directory `id`. */
export const BUILT_SPEC_FILE = "spec.json";

/**
 * JSONC text (JSON with comments and trailing commas) parsed as JSON, read as inspex reads it: a
 * leading byte order mark is skipped, and a line comment ends at CR or LF.
 */
function parseJsonc(text: string): unknown {
	const strings = /"(?:[^"\\]|\\.)*"/.source;
	const withoutComments = text
		.replace(/^\uFEFF/, "")
		.replace(
			new RegExp(`(${strings})|//[^\\r\\n]*|/\\*[\\s\\S]*?\\*/`, "g"),
			(match, string?: string) => string ?? " ",
		);
	return JSON.parse(
		withoutComments.replace(
			new RegExp(`(${strings})|,(?=\\s*[}\\]])`, "g"),
			(match, string?: string) => string ?? "",
		),
	);
}

/**
 * Reads the spec at `url`: the pinned file itself when running from source, else the plain JSON
 * copy `crust build` wrote to the artifact directory `id`.
 */
export function readSpec(url: URL, id: string): OpenApiSpec {
	const { readFileSync } = process.getBuiltinModule("node:fs");
	const source = isSourceRun();
	const file = source
		? process.getBuiltinModule("node:url").fileURLToPath(url)
		: process.getBuiltinModule("node:path").join(resolveArtifactDir(id), BUILT_SPEC_FILE);
	let spec: unknown;
	try {
		const text = readFileSync(file, "utf8");
		spec = source ? parseJsonc(text) : JSON.parse(text);
	} catch (cause) {
		if (!source && cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
			throw new Error(
				`api: the OpenAPI document was not found at "${file}". Run \`crust build\` first, and ship its "${id}" directory with the CLI.`,
				{ cause },
			);
		}
		const reason = cause instanceof Error ? cause.message : String(cause);
		throw new Error(`api: cannot read the OpenAPI document "${file}" (${reason})`, { cause });
	}
	if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
		throw new Error(`api: the OpenAPI document "${file}" is not a JSON object`);
	}
	return spec as OpenApiSpec;
}

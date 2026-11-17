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
	const spec = isSourceRun()
		? readObject(process.getBuiltinModule("node:url").fileURLToPath(url), parseJsonc)
		: readBuiltFile(id, BUILT_SPEC_FILE);
	return spec as OpenApiSpec;
}

/**
 * Reads the JSON object `crust build` wrote to `file` (such as `"index.json"`) below the artifact
 * directory `id`, in a built CLI.
 */
export function readBuiltFile(id: string, file: string): object {
	return readObject(builtFilePath(id, file), JSON.parse, id);
}

/** Where a built CLI finds `file` below the artifact directory `id`. */
export function builtFilePath(id: string, file: string): string {
	return process.getBuiltinModule("node:path").join(resolveArtifactDir(id), file);
}

/** The JSON object in `file`, read with `parse`; `artifact` names the directory a built file comes from. */
function readObject(file: string, parse: (text: string) => unknown, artifact?: string): object {
	let spec: unknown;
	try {
		spec = parse(process.getBuiltinModule("node:fs").readFileSync(file, "utf8"));
	} catch (cause) {
		if (
			artifact !== undefined &&
			cause instanceof Error &&
			"code" in cause &&
			cause.code === "ENOENT"
		) {
			// No `cause`: a runtime or renderer may print an error's cause (a raw ENOENT), and this
			// message already says what is missing.
			// oxlint-disable-next-line preserve-caught-error -- see above.
			throw new Error(
				`api: the OpenAPI data was not found at "${file}". Run \`crust build\` first, and ship its "${artifact}" directory with the CLI.`,
			);
		}
		const reason = cause instanceof Error ? cause.message : String(cause);
		throw new Error(`api: cannot read the OpenAPI document "${file}" (${reason})`, { cause });
	}
	if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
		throw new Error(`api: the OpenAPI document "${file}" is not a JSON object`);
	}
	return spec;
}

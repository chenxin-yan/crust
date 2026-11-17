import {
	type ExtensionFactory,
	type ExtensionId,
	CrustError,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";
import type { RunInputValue } from "@crustjs/core/tooling";

const CONFIG: ExtensionId = /* @__PURE__ */ defineExtensionId("crust:config");

/** Options for {@link config}. */
export interface ConfigOptions {
	/** App name: the user file is `config.json` in `configDir(name)` from `@crustjs/store`. */
	readonly name: string;
	/** Project file name, searched from the working directory up to the filesystem root. */
	readonly project?: string;
	/** Also read the user file; the project file wins key by key. */
	readonly user?: boolean;
}

type ConfigValues = Readonly<Record<string, RunInputValue>>;

function findUp(name: string, from: string): string | undefined {
	const { dirname, join } = process.getBuiltinModule("node:path");
	const { statSync } = process.getBuiltinModule("node:fs");
	for (let dir = from; ; dir = dirname(dir)) {
		const file = join(dir, name);
		if (statSync(file, { throwIfNoEntry: false })?.isFile()) return file;
		if (dirname(dir) === dir) return undefined;
	}
}

/** A missing file is no layer; every other failure names the path and never the content. */
function readConfigFile(path: string): ConfigValues | undefined {
	let text: string;
	try {
		text = process.getBuiltinModule("node:fs").readFileSync(path, "utf8");
	} catch (cause) {
		if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return undefined;
		throw new CrustError("PARSE", `Cannot read config file ${path}.`).withCause(cause);
	}
	let values: unknown;
	try {
		// Editors on Windows may save a byte order mark, which JSON.parse rejects.
		values = JSON.parse(text.replace(/^\uFEFF/u, ""));
	} catch {
		// No engine reason: newer engines quote a snippet of the file.
		throw new CrustError("PARSE", `Invalid JSON in config file ${path}.`);
	}
	if (typeof values !== "object" || values === null || Array.isArray(values)) {
		throw new CrustError("PARSE", `Config file ${path} must contain a JSON object.`);
	}
	// SAFETY: JSON.parse returns JSON values, which core checks against each flag.
	return values as ConfigValues;
}

/** JSON has no URL type: a `url` flag's string becomes a `URL`; anything else fails in core. */
function toUrl(value: RunInputValue): RunInputValue {
	return typeof value === "string" && URL.canParse(value) ? new URL(value) : value;
}

/**
 * Fills flags that declare a `config` key from JSON files: the project file found by walking
 * up from the working directory, then the user file. argv, typed `run()` input, `env` and
 * plain `bindInput` values win; the flag's default loses. It binds in `setup`, so every
 * `preRun` sees the values whatever the `.extend()` order. Reads no file when the routed
 * command has no flag with a `config` key.
 */
export const config: ExtensionFactory<[options: ConfigOptions]> = /* @__PURE__ */ defineExtension(
	CONFIG,
).factory((extension, options: ConfigOptions) =>
	extension.setup(async (ctx) => {
		const keyed = Object.entries(ctx.command.flags).flatMap(([name, flag]) =>
			flag.config === undefined ? [] : [{ name, key: flag.config, url: flag.type === "url" }],
		);
		if (keyed.length === 0) return;
		const paths: string[] = [];
		if (options.project !== undefined) {
			const project = findUp(options.project, process.cwd());
			if (project) paths.push(project);
		}
		if (options.user) {
			const { configDir } = await import("@crustjs/store");
			paths.push(
				process.getBuiltinModule("node:path").join(configDir(options.name), "config.json"),
			);
		}
		const layers = paths.flatMap((path) => {
			const values = readConfigFile(path);
			return values ? [{ path, values }] : [];
		});
		const flags: Record<string, RunInputValue> = {};
		const from: Record<string, string> = {};
		for (const { name, key, url } of keyed) {
			const layer = layers.find(({ values }) => Object.hasOwn(values, key));
			const value = layer?.values[key];
			if (layer === undefined || value === undefined) continue;
			flags[name] = url ? (Array.isArray(value) ? value.map(toUrl) : toUrl(value)) : value;
			from[name] = `${layer.path} key "${key}"`;
		}
		ctx.bindInput({ flags }, { source: "config", from });
	}),
);

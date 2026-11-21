import {
	type ExtensionContext,
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
	/** Project file name: the first entry with it from the working directory up to the filesystem root. */
	readonly project?: string;
	/** Also read the user file; the project file wins key by key. */
	readonly user?: boolean;
}

type ConfigValues = Readonly<Record<string, RunInputValue>>;

const MAX_BYTES = 1024 * 1024;

/** Per invocation: why the files could not be read, raised in `preRun` so `--help` answers first. */
const fileErrors = /* @__PURE__ */ new WeakMap<ExtensionContext, unknown>();

function isMissing(cause: unknown): boolean {
	return (
		cause instanceof Error &&
		"code" in cause &&
		(cause.code === "ENOENT" || cause.code === "ENOTDIR")
	);
}

function cannotRead(path: string, cause: unknown): CrustError {
	return new CrustError("PARSE", `Cannot read config file ${path}.`).withCause(cause);
}

/** The first entry named `name` from `from` up to the filesystem root. */
function findUp(name: string, from: string): string | undefined {
	const { dirname, join } = process.getBuiltinModule("node:path");
	const { statSync } = process.getBuiltinModule("node:fs");
	for (let dir = from; ; dir = dirname(dir)) {
		const file = join(dir, name);
		try {
			statSync(file);
			return file;
		} catch (cause) {
			if (!isMissing(cause)) throw cannotRead(file, cause);
		}
		if (dirname(dir) === dir) return undefined;
	}
}

/** At most {@link MAX_BYTES} of a regular file (or a symlink to one); `undefined` when missing. */
function readBounded(path: string): string | undefined {
	const { closeSync, constants, fstatSync, openSync, readSync } =
		process.getBuiltinModule("node:fs");
	const notRegular = () => new CrustError("PARSE", `Config file ${path} is not a regular file.`);
	let fd: number;
	try {
		// Non-blocking, so opening a FIFO returns at once instead of waiting for a writer.
		fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
	} catch (cause) {
		if (isMissing(cause)) return undefined;
		if (cause instanceof Error && "code" in cause && cause.code === "EISDIR") throw notRegular();
		throw cannotRead(path, cause);
	}
	try {
		if (!fstatSync(fd).isFile()) throw notRegular();
		// Read to the end rather than trusting the size: the file may grow while it is read.
		const buffer = Buffer.alloc(MAX_BYTES + 1);
		let length = 0;
		for (;;) {
			const read = readSync(fd, buffer, length, buffer.length - length, null);
			length += read;
			if (read === 0 || length > MAX_BYTES) break;
		}
		if (length > MAX_BYTES) {
			throw new CrustError("PARSE", `Config file ${path} is larger than 1 MiB.`);
		}
		return buffer.toString("utf8", 0, length);
	} catch (cause) {
		throw cause instanceof CrustError ? cause : cannotRead(path, cause);
	} finally {
		closeSync(fd);
	}
}

/** A missing file is no layer; every other failure names the path and never the content. */
function readConfigFile(path: string): ConfigValues | undefined {
	const text = readBounded(path);
	if (text === undefined) return undefined;
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

/** The project file, then the user file, each when it exists. */
async function readLayers(
	options: ConfigOptions,
): Promise<{ path: string; values: ConfigValues }[]> {
	const paths: string[] = [];
	if (options.project !== undefined) {
		const project = findUp(options.project, process.cwd());
		if (project) paths.push(project);
	}
	if (options.user) {
		const { configDir } = await import("@crustjs/store");
		paths.push(process.getBuiltinModule("node:path").join(configDir(options.name), "config.json"));
	}
	return paths.flatMap((path) => {
		const values = readConfigFile(path);
		return values ? [{ path, values }] : [];
	});
}

/** JSON has no URL type: a `url` flag's string becomes a `URL`; anything else fails in core. */
function toUrl(value: RunInputValue): RunInputValue {
	return typeof value === "string" && URL.canParse(value) ? new URL(value) : value;
}

/**
 * Fills flags that declare a `config` key from JSON files: the project file found by walking
 * up from the working directory, then the user file. argv, typed `run()` input, `env` and
 * plain `bindInput` values win; the flag's default loses. It binds in `setup`, so every
 * `preRun` sees the values whatever the `.extend()` order. A file it cannot read fails the
 * invocation in `preRun`, so `--help` and `--version` still answer. Reads no file when the
 * routed command has no flag with a `config` key.
 */
export const config: ExtensionFactory<[options: ConfigOptions]> = /* @__PURE__ */ defineExtension(
	CONFIG,
).factory((extension, options: ConfigOptions) =>
	extension
		.setup(async (ctx) => {
			const keyed = Object.entries(ctx.command.flags).flatMap(([name, flag]) =>
				flag.config === undefined ? [] : [{ name, key: flag.config, url: flag.type === "url" }],
			);
			if (keyed.length === 0) return;
			let layers: { path: string; values: ConfigValues }[];
			try {
				layers = await readLayers(options);
			} catch (error) {
				fileErrors.set(ctx, error);
				return;
			}
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
		})
		.preRun((ctx) => {
			if (fileErrors.has(ctx)) throw fileErrors.get(ctx);
		}),
);

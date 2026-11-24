import {
	CrustError,
	defineCommand,
	defineExtension,
	defineExtensionId,
	type CommandDefinition,
	type Extension,
	type ExtensionContext,
	type FlagDef,
	type FlagsDef,
	type ValidatedInput,
} from "@crustjs/core";
import { formatDescription, type LocalValueBrand, parseFlagValues } from "@crustjs/core/tooling";

declare const settingKey: unique symbol;

/** A setting's key on a flag, as only `config.flag()` writes it: a string literal is not one. */
export type SettingKey = string & { readonly [settingKey]: true };

declare module "@crustjs/core" {
	interface FlagExtras {
		/**
		 * The setting whose file value this flag takes when the run gives it none. Written only by
		 * `config.flag(key)` from `@crustjs/config`, and read only by that config's `extension`.
		 */
		config?: SettingKey;
	}
}

/**
 * One setting: the definition of a string, number or boolean flag. Every command that takes the
 * setting as a flag (`config.flag(key)`) uses it as is.
 */
export type ConfigSetting = Extract<
	FlagDef,
	{ type: "string" | "number" | "boolean"; schema?: never }
> & {
	/** A setting is shared by every command that takes it, so it requires no flag of one. */
	readonly requires?: never;
	/** Written by `config.flag(key)`. */
	readonly config?: never;
};

/** Settings keyed by name: the key in the files and in `config.flag()`, `get()` and `set()`. */
export type ConfigSettings = Record<string, ConfigSetting>;

type AllKeys<T> = T extends unknown ? keyof T : never;

/** A property no setting has, which a generic record of settings would otherwise admit. */
type KnownPropertiesBrand<D> = [Exclude<keyof D, AllKeys<ConfigSetting>>] extends [never]
	? {}
	: {
			readonly FIX_UNKNOWN_PROPERTY: `a setting has no property "${Exclude<keyof D, AllKeys<ConfigSetting>> & string}"`;
		};

/** `$schema` is a file's pointer to its JSON Schema. */
type ReservedNameBrand<S> = [Extract<keyof S, "$schema">] extends [never]
	? unknown
	: { readonly FIX_RESERVED_NAME: "no setting may be named $schema" };

/** A setting's value, as its flag's would be: `required`, `default`, `choices`, `parse`. */
export type SettingValue<D> = D extends unknown
	? { value: D } extends infer R extends FlagsDef
		? ValidatedInput<[], R>["flags"]["value"]
		: never
	: never;

/** One item of a setting as a file holds it: what the user types for a `parse` setting. */
type FileItem<D> = D extends { parse: (text: string) => unknown }
	? string
	: D extends { choices: readonly (infer C)[] }
		? C
		: D extends { type: "number" }
			? number
			: D extends { type: "boolean" }
				? boolean
				: string;

/** A setting as a file holds it: a list for a `multiple` setting. */
export type SettingFileValue<D> = D extends unknown
	? D extends { multiple: true }
		? readonly FileItem<D>[]
		: FileItem<D>
	: never;

/** Values to save, by setting; `undefined` removes a setting from the file. */
export type ConfigValues<S extends ConfigSettings, K extends keyof S> = {
	readonly [P in K]?: SettingFileValue<S[P]> | undefined;
};

/** Where a setting's value comes from, as `config.list()` reports it. */
export type ConfigSource =
	| { readonly kind: "env"; readonly name: string }
	| { readonly kind: "file"; readonly path: string }
	| { readonly kind: "default" }
	| { readonly kind: "unset" };

/** One setting in `config.list()`: its value, `undefined` when unset, and where it comes from. */
export type ConfigEntry<S extends ConfigSettings> = {
	readonly [K in keyof S & string]: {
		readonly key: K;
		readonly value: SettingValue<S[K]> | undefined;
		readonly source: ConfigSource;
	};
}[keyof S & string];

/** The `config` command that `command: true` adds. */
export type ConfigCommandDefinition = CommandDefinition<"config">;

/** The files of {@link defineConfig}: their names and their format. */
export type ConfigFiles = {
	/** The user's own file, in the app's configuration directory. @default "config.json" */
	readonly user?: string;
	/** The project file, the nearest from the working directory up. @default "<name>.config.json" */
	readonly project?: string;
} & (
	| { readonly parse?: never; readonly stringify?: never }
	| {
			/** Reads a file's text into an object of settings, such as an INI, TOML or YAML parser. */
			readonly parse: (text: string) => unknown;
			/** Writes an object of settings as a file's text, the reverse of `parse`. */
			readonly stringify: (values: Record<string, unknown>) => string;
	  }
);

/** The options of {@link defineConfig}. */
export interface ConfigOptions<S extends ConfigSettings, P extends keyof S & string> {
	/** The app's name: the user's file is in its configuration directory, `configDir(name)`. */
	readonly name: string;
	/** Every setting, each the definition of a string, number or boolean flag. */
	readonly settings: S;
	/**
	 * Turns on the project file and lists the settings it may set. A project file arrives with a
	 * cloned repository, so any other setting it sets is ignored with a warning.
	 */
	readonly project?: readonly P[];
	/** The files' names and format; JSON by default. */
	readonly files?: ConfigFiles;
	/** Adds `config get`, `set`, `unset` and `list`. @default false */
	readonly command?: boolean;
}

/** What {@link defineConfig} returns for the settings `S` and the project list `P`. */
export interface Config<
	S extends ConfigSettings,
	P extends keyof S & string,
	Commands extends readonly ConfigCommandDefinition[],
> {
	/**
	 * The flag for a setting, under any flag name: `.flags({ format: config.flag("psFormat") })`.
	 * When a run gives it no value, from argv, its variable or input, it takes the files' value.
	 */
	flag<K extends keyof S & string>(key: K): S[K] & { readonly config: SettingKey };
	/**
	 * A setting's value from its environment variable, the project file, the user's file, or its
	 * default. Throws a `VALIDATION` `CrustError` for a `required` setting that none of them gives.
	 */
	get<K extends keyof S & string>(key: K): Promise<SettingValue<S[K]>>;
	/** Every setting with its value and where it comes from. */
	list(): Promise<ConfigEntry<S>[]>;
	/**
	 * Save settings in the user's file; `undefined` removes one. Throws for a value the setting's
	 * rules refuse, before anything is saved.
	 */
	set(values: ConfigValues<S, keyof S>): Promise<void>;
	/**
	 * Save settings in the project file, the nearest, or a new one in the working directory. Throws
	 * for a value the setting's rules refuse or a linked project file, before anything is saved.
	 */
	set(
		values: [P] extends [never] ? never : ConfigValues<S, P>,
		options: { readonly project: true },
	): Promise<void>;
	/** Binds the files' values into the flags `config.flag()` gave: `.extend(config.extension)`. */
	readonly extension: Extension<{}, [], {}, Commands>;
	/** The JSON Schema (draft 2020-12) of a JSON config file. */
	jsonSchema(): Record<string, unknown>;
}

/** The variable name the files' text is converted under, as the text of an environment variable. */
const TEXT = "CRUST_CONFIG_TEXT";

type FileValues = Readonly<Record<string, unknown>>;
type ConfigFile = { readonly path: string; readonly values: FileValues };

/**
 * `text` from `env[variable]` as the setting's value, converted as core converts an environment
 * variable's text; core's `--value (from $…)` in an error becomes `label`.
 */
async function convert(
	def: ConfigSetting,
	env: Readonly<Record<string, string | undefined>>,
	variable: string,
	label: string,
): Promise<unknown> {
	// The flag is never read from argv: its spellings could only collide with its name `value`.
	const { default: _default, required: _required, aliases: _aliases, ...flag } = def;
	try {
		return (await parseFlagValues({ value: { ...flag, env: variable } }, env)).value;
	} catch (error) {
		if (error instanceof CrustError) {
			error.message = error.message.replaceAll(`--value (from $${variable})`, label);
		}
		throw error;
	}
}

/** A file value as words, one per item: a number or boolean as its text. */
function fileWords(key: string, def: ConfigSetting, value: unknown, path: string) {
	const word = (item: unknown) =>
		typeof item === "string" || typeof item === "number" || typeof item === "boolean"
			? String(item)
			: undefined;
	const words = def.multiple && Array.isArray(value) ? value.map(word) : [word(value)];
	if (words.every((item) => item !== undefined)) return words;
	throw new CrustError(
		"PARSE",
		`Expected ${def.multiple ? "a value or a list of values" : "one value"} for "${key}" in ${path}.`,
	);
}

/** Reads `path` into an object of settings; a missing file holds none. */
async function readValues(path: string, parse: (text: string) => unknown): Promise<FileValues> {
	let text: string;
	try {
		const fs = process.getBuiltinModule("node:fs/promises");
		// A device or a FIFO, which a project file can link to, would never finish reading.
		const stats = await fs.stat(path);
		if (!stats.isFile() || stats.size > 16 * 1024 * 1024) {
			throw new Error("not a regular file of at most 16 MiB");
		}
		text = await fs.readFile(path, "utf8");
	} catch (error) {
		const code = (error as { code?: unknown }).code;
		if (code === "ENOENT" || code === "ENOTDIR") return {};
		throw new CrustError("PARSE", `Cannot read config file: ${path}`).withCause(error);
	}
	let values: unknown;
	try {
		values = parse(text.replace(/^\uFEFF/u, ""));
	} catch (cause) {
		// Not the parser's message: it may repeat the file's text.
		throw new CrustError("PARSE", `Malformed config file: ${path}`).withCause(cause);
	}
	if (typeof values !== "object" || values === null || Array.isArray(values)) {
		throw new CrustError("PARSE", `Config file ${path} must hold an object of settings`);
	}
	return values as FileValues;
}

/**
 * Replaces `path` with `text` in one step, so a failed write leaves the old file whole; the file
 * keeps its mode.
 */
async function writeFile(path: string, text: string): Promise<void> {
	const fs = process.getBuiltinModule("node:fs/promises");
	await fs.mkdir(process.getBuiltinModule("node:path").dirname(path), { recursive: true });
	const existing = await fs.stat(path).catch(() => undefined);
	const temporary = `${path}.${crypto.randomUUID()}.tmp`;
	try {
		await fs.writeFile(temporary, text, {
			flag: "wx",
			mode: existing === undefined ? undefined : existing.mode & 0o7777,
		});
		if (existing !== undefined) await fs.chmod(temporary, existing.mode & 0o7777);
		await fs.rename(temporary, path);
	} catch (error) {
		await fs.rm(temporary, { force: true });
		throw error;
	}
}

/** The nearest `file` from the working directory up. */
function nearest(file: string): string | undefined {
	const { dirname, join } = process.getBuiltinModule("node:path");
	const { existsSync } = process.getBuiltinModule("node:fs");
	for (let dir = process.cwd(); ; dir = dirname(dir)) {
		if (existsSync(join(dir, file))) return join(dir, file);
		if (dirname(dir) === dir) return undefined;
	}
}

/** How `config list` and `config get` print a value. */
function shown(value: unknown, separator: string): string {
	return Array.isArray(value) ? value.join(separator) : String(value);
}

/**
 * A CLI's settings, each defined once: `defineConfig({ name, settings, project?, files?, command? })`.
 * A command takes a setting as a flag with `config.flag(key)`, and `config.extension` binds the
 * files' value into it when the run gives none, so the action reads the final value from `flags`:
 * argv or input, then the flag's `env`, then the project file, then the user's file, then
 * `default`. `get`, `list` and `set` read and save settings from anywhere.
 */
export function defineConfig<
	const S extends ConfigSettings,
	const P extends keyof S & string = never,
	const C extends boolean = false,
>(
	options: ConfigOptions<S, P> & {
		// Same value brands as defineFlag (default within choices, synchronous parse), per setting.
		readonly settings: {
			readonly [K in keyof S]: LocalValueBrand<S[K]> & KnownPropertiesBrand<S[K]>;
		} & ReservedNameBrand<S>;
		readonly command?: C;
	},
): Config<S, P, C extends true ? readonly [ConfigCommandDefinition] : []> {
	const { name, settings, project } = options;
	const fileOptions = options.files ?? {};
	const parse = fileOptions.parse ?? JSON.parse;
	const stringify =
		fileOptions.stringify ??
		((values: Record<string, unknown>) => `${JSON.stringify(values, null, 2)}\n`);
	const projectName = fileOptions.project ?? `${name}.config.json`;
	const userName = fileOptions.user ?? "config.json";
	const keys = Object.keys(settings);
	const isKey = (key: string) => Object.hasOwn(settings, key);
	// A flag's `config` is `<name>:<key>`, so two configs with a same-named setting stay apart.
	const prefix = `${name}:`;
	// The store loads when a command first reads the files, never at start-up.
	const userPath = async () =>
		process
			.getBuiltinModule("node:path")
			.join((await import("@crustjs/store")).configDir(name), userName);

	/** The files in the order they apply: the project file's allowed settings, then the user's file. */
	const readFiles = async (warn: (line: string) => void): Promise<ConfigFile[]> => {
		const user = await userPath();
		const found = project === undefined ? undefined : nearest(projectName);
		const read: ConfigFile[] = [];
		if (found !== undefined) {
			const values = { ...(await readValues(found, parse)) };
			for (const key of Object.keys(values)) {
				if (!isKey(key) || project!.includes(key as P)) continue;
				delete values[key];
				warn(`Warning: ${found} sets "${key}", which only ${user} may set; ignored.`);
			}
			read.push({ path: found, values });
		}
		read.push({ path: user, values: await readValues(user, parse) });
		return read;
	};

	/** Reads the files on the first call only, for the settings of one `list()` or `get()`. */
	const filesOnce = (warn: (line: string) => void) => {
		let pending: Promise<ConfigFile[]> | undefined;
		return () => (pending ??= readFiles(warn));
	};

	/** The first file that gives `key` a value: a value that converts to nothing gives none. */
	const fromFiles = async (key: string, files: readonly ConfigFile[]) => {
		const def = settings[key]!;
		for (const { path, values } of files) {
			if (!Object.hasOwn(values, key)) continue;
			const words = fileWords(key, def, values[key], path);
			const converted = await Promise.all(
				words.map((word) => convert(def, { [TEXT]: word }, TEXT, `"${key}" in ${path}`)),
			);
			const value = def.multiple
				? converted.flat().filter((item) => item !== undefined)
				: converted[0];
			if (value !== undefined && !(Array.isArray(value) && value.length === 0)) {
				return { path, words, value };
			}
		}
		return undefined;
	};

	const resolve = async (
		key: string,
		files: () => Promise<ConfigFile[]>,
	): Promise<{ value: unknown; source: ConfigSource }> => {
		const def = settings[key]!;
		// The first variable that is set, as core picks it, whatever its text converts to.
		const variable = [def.env ?? []].flat().find((candidate) => {
			const raw = Object.hasOwn(process.env, candidate) ? process.env[candidate] : undefined;
			return raw !== undefined && !(raw === "" && def.type === "boolean");
		});
		if (variable !== undefined) {
			const value = await convert(def, process.env, variable, `"${key}" (from $${variable})`);
			if (value !== undefined) return { value, source: { kind: "env", name: variable } };
		}
		const file = await fromFiles(key, await files());
		if (file !== undefined) return { value: file.value, source: { kind: "file", path: file.path } };
		// Core's own default: a `parse` setting's default is parsed, as on the flag.
		const { env: _env, required: _required, aliases: _aliases, ...withDefault } = def;
		const value = (await parseFlagValues({ value: withDefault }, {})).value;
		return { value, source: value === undefined ? { kind: "unset" } : { kind: "default" } };
	};

	const saveNow = async (values: Record<string, unknown>, inProject: boolean): Promise<string> => {
		if (inProject) {
			const refused = Object.keys(values).filter((key) => !(project ?? []).includes(key as P));
			if (refused.length > 0) {
				throw new CrustError(
					"VALIDATION",
					`${projectName} cannot set ${refused.map((key) => `"${key}"`).join(", ")}; it may set only: ${(project ?? []).join(", ")}`,
				);
			}
		}
		const fs = process.getBuiltinModule("node:fs/promises");
		// A linked user file, such as one from a dotfiles repository, stays a link; a project file
		// arrives with a clone, and saving in it would copy its target's keys into the working tree.
		const path = inProject
			? (nearest(projectName) ??
				process.getBuiltinModule("node:path").join(process.cwd(), projectName))
			: await userPath().then((user) => fs.realpath(user).catch(() => user));
		if (inProject && (await fs.lstat(path).catch(() => undefined))?.isSymbolicLink()) {
			throw new CrustError(
				"VALIDATION",
				`${path} is a symbolic link; replace it with a file to save in it`,
			);
		}
		const next: Record<string, unknown> = { ...(await readValues(path, parse)) };
		for (const [key, value] of Object.entries(values)) {
			if (value === undefined) delete next[key];
			else next[key] = value;
		}
		await writeFile(path, stringify(next));
		return path;
	};
	// One save at a time, so each reads what the one before it wrote.
	let saving: Promise<unknown> = Promise.resolve();
	const save = (values: Record<string, unknown>, inProject: boolean): Promise<string> => {
		const next = saving.then(() => saveNow(values, inProject));
		saving = next.catch(() => {});
		return next;
	};

	const toStderr = (line: string) => void process.stderr.write(`${line}\n`);

	const bindFiles = async (ctx: ExtensionContext) => {
		const wanted = Object.entries(ctx.command.flags).filter(([flagName, flag]) => {
			const source = ctx.sources.flags[flagName];
			return (
				flag.config?.startsWith(prefix) === true &&
				isKey(flag.config.slice(prefix.length)) &&
				(source === undefined || source === "default")
			);
		});
		if (wanted.length === 0) return;
		const read = await readFiles((line) => ctx.stderr(line));
		for (const [flagName, flag] of wanted) {
			const file = await fromFiles(flag.config!.slice(prefix.length), read);
			// Converted once already, so binding the same words cannot fail.
			if (file !== undefined) {
				ctx.bindText({ flags: { [flagName]: flag.multiple ? file.words : file.words[0]! } });
			}
		}
	};

	// A file's error waits for the action, so `--help` works whatever the files hold, as for an
	// invalid environment value.
	const failures = new WeakMap<object, unknown>();
	const where = [
		...(project === undefined
			? []
			: [
					`${projectName} (the nearest from the working directory up; only ${project.join(", ") || "no settings"})`,
				]),
		`${userName} in the configuration directory of ${name}`,
	];
	const width = Math.max(0, ...keys.map((key) => key.length));
	const extension = defineExtension(defineExtensionId(`crust:config:${name}`))
		.owns("config")
		.setup(async (ctx) => {
			try {
				await bindFiles(ctx);
			} catch (error) {
				failures.set(ctx, error);
			}
		})
		.preRun((ctx) => {
			if (failures.has(ctx)) throw failures.get(ctx);
		})
		.sections(() => [
			{
				command: [],
				title: "Configuration",
				body: [
					`A flag for a setting that the run does not give takes its environment variable, then ${where.join(", then ")}, then its default.`,
					...keys
						.filter((key) => !settings[key]!.hidden)
						.map((key) => {
							const def = settings[key]!;
							return `${key.padEnd(width)}  ${formatDescription(def.description, def.default, def.choices, undefined, def.env)}`.trimEnd();
						}),
				].join("\n"),
			},
		]);

	const configCommand = () => {
		const key = {
			name: "key",
			type: "string",
			// SAFETY: the setting names, as the choices of the argument.
			choices: keys as [string, ...string[]],
			required: true,
			description: "A setting",
		} as const;
		// `--project` exists only with a project file; the actions read it as optional.
		const inProject: {} =
			project === undefined
				? {}
				: { project: { type: "boolean", description: `Use ${projectName}, not your own file` } };
		const toProject = (flags: object) => (flags as { project?: boolean }).project === true;
		const origin = (source: ConfigSource) =>
			source.kind === "env"
				? `$${source.name}`
				: source.kind === "file"
					? source.path
					: source.kind;
		return defineCommand("config", { description: "Read and change settings" }, (command) =>
			command
				.command("list", { description: "Show every setting, its value and its source" }, (list) =>
					list.action(async ({ stdout, stderr }) => {
						const files = filesOnce((line) => stderr(line));
						const entries = await Promise.all(
							keys.map(async (setting) => ({ setting, ...(await resolve(setting, files)) })),
						);
						const values = entries.map(({ value }) =>
							value === undefined ? "" : shown(value, ","),
						);
						const valueWidth = Math.max(0, ...values.map((value) => value.length));
						entries.forEach(({ setting, source }, index) =>
							stdout(
								`${setting.padEnd(width)}  ${values[index]!.padEnd(valueWidth)}  ${origin(source)}`,
							),
						);
					}),
				)
				.command("get", { description: "Print a setting's value" }, (get) =>
					get.args(key).action(async ({ args, stdout, stderr }) => {
						const { value } = await resolve(
							args.key,
							filesOnce((line) => stderr(line)),
						);
						if (value !== undefined) stdout(shown(value, "\n"));
					}),
				)
				.command("set", { description: "Save a setting" }, (set) =>
					set
						.args(key, { name: "value", type: "string", required: true, description: "Its value" })
						.flags(inProject)
						.action(async ({ args, flags, stdout }) => {
							const def = settings[args.key]!;
							const value = await convert(def, { [TEXT]: args.value }, TEXT, `"${args.key}"`);
							// A `parse` setting keeps what the user typed, as a file holds it.
							const saved = def.parse === undefined ? value : args.value;
							const path = await save({ [args.key]: saved }, toProject(flags));
							stdout(`Saved ${args.key} in ${path}`);
						}),
				)
				.command("unset", { description: "Remove a setting from a file" }, (unset) =>
					unset
						.args(key)
						.flags(inProject)
						.action(async ({ args, flags, stdout }) => {
							const path = await save({ [args.key]: undefined }, toProject(flags));
							stdout(`Removed ${args.key} from ${path}`);
						}),
				),
		);
	};

	const config = {
		flag: (key: string) => ({ ...settings[key], config: `${prefix}${key}` }),
		get: async (key: string) => {
			const { value } = await resolve(key, filesOnce(toStderr));
			const def = settings[key]!;
			if (value === undefined && def.required) {
				const variables = [def.env ?? []].flat().map((variable) => `$${variable}`);
				throw new CrustError(
					"VALIDATION",
					`Missing setting "${key}" of ${name}: set ${[...variables, `"${key}" in ${await userPath()}`].join(" or ")}.`,
				);
			}
			return value;
		},
		list: async () => {
			const files = filesOnce(toStderr);
			return Promise.all(keys.map(async (key) => ({ key, ...(await resolve(key, files)) })));
		},
		set: async (values: Record<string, unknown>, target?: { readonly project?: true }) => {
			// A value the setting's rules refuse would fail every command that reads it.
			for (const [key, value] of Object.entries(values)) {
				if (value === undefined) continue;
				const def = settings[key]!;
				for (const word of fileWords(key, def, value, "set()")) {
					await convert(def, { [TEXT]: word }, TEXT, `"${key}"`);
				}
			}
			await save(values, target?.project === true);
		},
		extension: options.command ? extension.add(configCommand()) : extension,
		jsonSchema: () => jsonSchema(name, settings),
	};
	// SAFETY: each member matches `Config`'s; the types of keys and values are erased here.
	return Object.freeze(config) as never;
}

/** What a user writes in a file for one setting: the text type for `parse`, never the parsed value. */
function settingSchema(def: ConfigSetting): Record<string, unknown> {
	const item: Record<string, unknown> =
		def.choices === undefined
			? {
					type: def.parse === undefined ? def.type : "string",
					...(Number.isFinite(def.min) ? { minimum: def.min } : {}),
					...(Number.isFinite(def.max) ? { maximum: def.max } : {}),
				}
			: { enum: [...def.choices] };
	return {
		...(def.multiple ? { type: "array", items: item } : item),
		...(def.description === undefined ? {} : { description: def.description }),
		...(def.default === undefined
			? {}
			: { default: Array.isArray(def.default) ? [...def.default] : def.default }),
	};
}

function jsonSchema(name: string, settings: ConfigSettings): Record<string, unknown> {
	return {
		$schema: "https://json-schema.org/draft/2020-12/schema",
		title: `${name} config file`,
		type: "object",
		properties: {
			$schema: { type: "string" },
			...Object.fromEntries(
				Object.entries(settings).map(([key, def]) => [key, settingSchema(def)]),
			),
		},
		additionalProperties: false,
	};
}

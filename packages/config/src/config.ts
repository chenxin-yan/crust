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
// Types only: the store loads when a command first reads the files, never at start-up.
import type { StoreFormat } from "@crustjs/store";

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
 * One setting: the definition of a string, number, integer or boolean flag. Every command that
 * takes the setting as a flag (`config.flag(key)`) uses it as is.
 */
export type ConfigSetting = Extract<
	FlagDef,
	{ type: "string" | "number" | "integer" | "boolean"; schema?: never }
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
		: D extends { type: "number" | "integer" }
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

/** The names of the files of {@link defineConfig}, without their extension. */
export interface ConfigFiles {
	/** The user's own file, in the app's configuration directory. @default "config" */
	readonly user?: string;
	/** The project file, the nearest from the working directory up. @default "<name>.config" */
	readonly project?: string;
}

/** The options of {@link defineConfig}: its settings in three groups, by the file that may hold them. */
export interface ConfigOptions<
	U extends ConfigSettings | undefined,
	P extends ConfigSettings | undefined,
	B extends ConfigSettings | undefined,
> {
	/** The app's name: the user's file is in its configuration directory, `configDir(name)`. */
	readonly name: string;
	/**
	 * Settings only the user's own file may hold: anything a repository must not choose, such as
	 * what the app runs as a command. Each is the definition of a string, number, integer or
	 * boolean flag.
	 */
	readonly user?: U;
	/** Settings only the project file may hold, such as what describes the project itself. */
	readonly project?: P;
	/** Settings either file may hold; the project file's value wins. */
	readonly both?: B;
	/** The files' format, as a store's `format`. @default JSON */
	readonly format?: StoreFormat;
	/** The files' names. */
	readonly files?: ConfigFiles | undefined;
	/** Adds `config get`, `set`, `unset` and `list`. @default false */
	readonly command?: boolean;
}

/**
 * What {@link defineConfig} returns for the settings `S`, of which the user's file may hold `UK`
 * and the project file `PK`.
 */
export interface Config<
	S extends ConfigSettings,
	UK extends keyof S & string,
	PK extends keyof S & string,
	Commands extends readonly ConfigCommandDefinition[],
	Entry = ConfigEntry<S>,
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
	list(): Promise<Entry[]>;
	/**
	 * Save settings in the user's file; `undefined` removes one. Throws for a value the setting's
	 * rules refuse or a file that would exceed 16 MiB, before anything is saved.
	 */
	set(values: [UK] extends [never] ? never : ConfigValues<S, UK>): Promise<void>;
	/**
	 * Save settings in the project file, the nearest, or a new one in the working directory. Throws
	 * for a value the setting's rules refuse, a linked project file or a file that would exceed
	 * 16 MiB, before anything is saved.
	 */
	set(
		values: [PK] extends [never] ? never : ConfigValues<S, PK>,
		target: { readonly project: true },
	): Promise<void>;
	/** Binds the files' values into the flags `config.flag()` gave: `.extend(config.extension)`. */
	readonly extension: Extension<{}, [], {}, Commands>;
	/**
	 * The JSON Schema (draft 2020-12) of the user's JSON config file, or with `{ project: true }`
	 * of the project file: the settings that file may hold.
	 */
	jsonSchema(target?: { readonly project: true }): Record<string, unknown>;
}

/** Same value brands as defineFlag (default within choices, synchronous parse), per setting. */
type CheckedSettings<G> = {
	readonly [K in keyof G]: LocalValueBrand<G[K]> & KnownPropertiesBrand<G[K]>;
} & ReservedNameBrand<G>;

/** A group's settings: none for a group given as `undefined`. */
type Group<G> = G extends ConfigSettings ? G : {};

/** The names a group declares: a record of any names tells nothing about another group. */
type Names<G> = keyof { [K in keyof G as string extends K ? never : K]: unknown };

/** The settings that are in two groups. */
type InTwoGroups<U, P, B> = (Names<U> & Names<P>) | (Names<U> & Names<B>) | (Names<P> & Names<B>);

/** The variable name the files' text is converted under, as the text of an environment variable. */
const TEXT = "CRUST_CONFIG_TEXT";

type FileValues = Readonly<Record<string, unknown>>;
/** A file as read: the settings it may hold, and its values or why it could not be read. */
type ConfigFile = {
	readonly may: (key: string) => boolean;
	readonly path: string;
	readonly values: FileValues;
	readonly error?: unknown;
};

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

/** A store field that holds whatever the file holds: core converts a setting's value. */
const ANY_VALUE = {
	schema: {
		"~standard": { version: 1, vendor: "crust", validate: (value: unknown) => ({ value }) },
	},
};

/** A store's failure as the config file's: the store's own message names a "store file". */
function fileError(error: unknown, path: string, action: "read" | "save"): unknown {
	const { code, details } = error as {
		code?: unknown;
		details?: { issues?: readonly { message: string }[] };
	};
	if (code === "PARSE") {
		// Not the parser's message: it may repeat the file's text.
		return new CrustError("PARSE", `Malformed config file: ${path}`).withCause(error);
	}
	if (code === "VALIDATION" && details?.issues !== undefined) {
		const reasons = details.issues.map((issue) => issue.message).join("; ");
		return new CrustError("VALIDATION", `Cannot save ${path}: ${reasons}`).withCause(error);
	}
	return action === "read"
		? new CrustError("PARSE", `Cannot read config file: ${path}`).withCause(error)
		: error;
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
 * A CLI's settings, each defined once: `defineConfig({ name, user?, project?, both?, format?, files?, command? })`.
 * The group says which file may hold a setting: the user's own, the project's, or both. A command
 * takes a setting as a flag with `config.flag(key)`, and `config.extension` binds the files' value
 * into it when the run gives none, so the action reads the final value from `flags`: argv or
 * input, then the flag's `env`, then the project file, then the user's file, then `default`.
 * `get`, `list` and `set` read and save settings from anywhere.
 */
export function defineConfig<
	// `| undefined`: a group given as `undefined` is then inferred as that, not as every name.
	const U extends ConfigSettings | undefined = {},
	const P extends ConfigSettings | undefined = {},
	const B extends ConfigSettings | undefined = {},
	const C extends boolean = false,
>(
	options: ConfigOptions<U, P, B> & {
		readonly user?: CheckedSettings<U>;
		readonly project?: CheckedSettings<P>;
		readonly both?: CheckedSettings<B>;
		readonly command?: C;
	},
	// A setting is in one group. Said by the result, not by a brand on `options`: a type there that
	// names two groups stops TypeScript inferring a group that holds a `parse` function.
): [InTwoGroups<Group<U>, Group<P>, Group<B>>] extends [never]
	? Config<
			Group<U> & Group<P> & Group<B>,
			keyof (Group<U> & Group<B>) & string,
			keyof (Group<P> & Group<B>) & string,
			C extends true ? readonly [ConfigCommandDefinition] : [],
			// By group: one of any names would otherwise give its value type to every entry.
			ConfigEntry<Group<U>> | ConfigEntry<Group<P>> | ConfigEntry<Group<B>>
		>
	: { readonly FIX_SETTING_IN_TWO_GROUPS: InTwoGroups<Group<U>, Group<P>, Group<B>> } {
	const { name, format } = options;
	const groups: Record<"user" | "project" | "both", ConfigSettings> = {
		user: options.user ?? {},
		project: options.project ?? {},
		both: options.both ?? {},
	};
	// `config list` and help show them in this order.
	const settings: ConfigSettings = { ...groups.both, ...groups.user, ...groups.project };
	const fileExtension = format?.extension ?? "json";
	const userName = `${options.files?.user ?? "config"}.${fileExtension}`;
	const projectName = `${options.files?.project ?? `${name}.config`}.${fileExtension}`;
	const keys = Object.keys(settings);
	const inUser = (key: string) =>
		Object.hasOwn(groups.user, key) || Object.hasOwn(groups.both, key);
	const inProject = (key: string) =>
		Object.hasOwn(groups.project, key) || Object.hasOwn(groups.both, key);
	const userKeys = keys.filter(inUser);
	const projectKeys = keys.filter(inProject);
	// A file exists only when a group names it.
	const hasUser = userKeys.length > 0;
	const hasProject = projectKeys.length > 0;
	// A flag's `config` is `<name>:<key>`, so two configs with a same-named setting stay apart.
	const prefix = `${name}:`;
	const isKey = (key: string) => Object.hasOwn(settings, key);
	// The store loads when a command first reads the files, never at start-up.
	const userPath = async () =>
		process
			.getBuiltinModule("node:path")
			.join((await import("@crustjs/store")).configDir(name), userName);
	const fields = Object.fromEntries(keys.map((key) => [key, ANY_VALUE]));
	/** The store of the config file at `path`: it reads, locks and replaces the file. */
	const storeAt = async (path: string) => {
		const { createStore } = await import("@crustjs/store");
		const { basename, dirname, sep } = process.getBuiltinModule("node:path");
		return createStore({
			// With the separator: the store takes a `dirPath` ending in `.json` for a file's path, and a
			// project's folder may be named so.
			dirPath: dirname(path) + sep,
			name: basename(path, `.${fileExtension}`),
			// SAFETY: a setting's value is checked by core when it is converted, not by the store.
			fields: fields as never,
			format,
		}) as unknown as { read(): Promise<FileValues>; patch(values: FileValues): Promise<unknown> };
	};
	/** The settings the file at `path` holds; a missing file holds none. */
	const readValues = async (path: string): Promise<FileValues> => {
		const values = await (await storeAt(path)).read().catch((error: unknown) => {
			throw fileError(error, path, "read");
		});
		return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
	};

	// What a run has warned of: it reads the files more than once (for its flags, then for a
	// `get()` in its action) and warns once. Kept per run, so two runs at once each warn.
	type Run = { readonly warned: Set<string>; over: boolean };
	let runs: import("node:async_hooks").AsyncLocalStorage<Run> | undefined;
	/** Marks the start of a run. Called before a hook first awaits, so the run's later steps see it. */
	const startRun = (ctx: { defer(cleanup: () => void): void }) => {
		runs ??= new (process.getBuiltinModule("node:async_hooks").AsyncLocalStorage)<Run>();
		const run: Run = { warned: new Set(), over: false };
		// Not `run()`: a hook cannot wrap the rest of its invocation.
		runs.enterWith(run);
		ctx.defer(() => void (run.over = true));
	};
	/**
	 * The files in the order they apply: the project file, then the user's file. A file that cannot
	 * be read keeps its error for the setting that needs it, so a broken project file does not
	 * stand in the way of a setting only the user's file holds.
	 */
	const readFiles = async (warn: (line: string) => void): Promise<ConfigFile[]> => {
		const run = runs?.getStore();
		const warned = run === undefined || run.over ? new Set<string>() : run.warned;
		const read: ConfigFile[] = [];
		/** The file `locate` finds, without the settings only the `other` file may set. */
		const add = async (
			file: string,
			locate: () => string | Promise<string>,
			may: (key: string) => boolean,
			other: () => string | Promise<string>,
		) => {
			let path = file;
			try {
				path = await locate();
				const values = { ...(await readValues(path)) };
				for (const key of Object.keys(values)) {
					if (may(key)) continue;
					delete values[key];
					// The other file by its name, when its folder cannot be told.
					const only = await Promise.resolve(other()).catch(() => userName);
					const line = `Warning: ${path} sets "${key}", which only ${only} may set; ignored.`;
					if (!warned.has(line)) warn(line);
					warned.add(line);
				}
				read.push({ may, path, values });
			} catch (error) {
				read.push({ may, path, values: {}, error });
			}
		};
		const found = hasProject ? nearest(projectName) : undefined;
		if (found !== undefined) await add(projectName, () => found, inProject, userPath);
		if (hasUser) await add(userName, userPath, inUser, () => projectName);
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
		for (const { may, path, values, error } of files) {
			if (!may(key)) continue;
			// Only a setting this file may hold fails on it.
			if (error !== undefined) throw error;
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

	// Read when a save is asked for, not when its turn comes: the working directory may have changed.
	const projectFile = (): string =>
		nearest(projectName) ?? process.getBuiltinModule("node:path").join(process.cwd(), projectName);
	// `projectPath` is the project file to save in; without it the user's file is saved.
	const saveNow = async (
		values: Record<string, unknown>,
		projectPath: string | undefined,
	): Promise<string> => {
		const toProject = projectPath !== undefined;
		const refused = Object.keys(values).filter((key) => !(toProject ? inProject : inUser)(key));
		if (refused.length > 0) {
			throw new CrustError(
				"VALIDATION",
				`${toProject ? projectName : userName} cannot set ${refused.map((key) => `"${key}"`).join(", ")}; it may set only: ${(toProject ? projectKeys : userKeys).join(", ")}`,
			);
		}
		const fs = process.getBuiltinModule("node:fs/promises");
		let path = projectPath;
		if (path === undefined) {
			// A linked user file, such as one from a dotfiles repository, stays a link: the file it
			// points to is saved, when it has the format's extension as the store's file must.
			const user = await userPath();
			const linked = await fs.realpath(user).catch(() => user);
			path = linked.endsWith(`.${fileExtension}`) ? linked : user;
		} else if ((await fs.lstat(path).catch(() => undefined))?.isSymbolicLink()) {
			// A project file arrives with a clone, and saving in it would copy its target's keys into
			// the working tree.
			throw new CrustError(
				"VALIDATION",
				`${path} is a symbolic link; replace it with a file to save in it`,
			);
		}
		// The store keeps the file's other keys, holds its lock, so another config or process saving
		// at the same time keeps its key, and replaces the file in one step.
		const saved = path;
		await (await storeAt(saved)).patch(values).catch((error: unknown) => {
			throw fileError(error, saved, "save");
		});
		return saved;
	};
	// One save of this config at a time, in call order; the lock alone would let a later call go first.
	let saving: Promise<unknown> = Promise.resolve();
	const queued = <T>(task: () => Promise<T>): Promise<T> => {
		const next = saving.then(task);
		saving = next.catch(() => {});
		return next;
	};
	const save = (values: Record<string, unknown>, toProject: boolean): Promise<string> => {
		const projectPath = toProject ? projectFile() : undefined;
		return queued(() => saveNow(values, projectPath));
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
		...(hasProject ? [`${projectName} (the nearest from the working directory up)`] : []),
		...(hasUser ? [`${userName} in the configuration directory of ${name}`] : []),
	];
	/** The one file that may hold `key`, when the config has two. */
	const only = (key: string) =>
		!hasUser || !hasProject || (inUser(key) && inProject(key))
			? ""
			: ` (${inUser(key) ? userName : projectName} only)`;
	const width = Math.max(0, ...keys.map((key) => key.length));
	const extension = defineExtension(defineExtensionId(`crust:config:${name}`))
		.owns("config")
		.setup(async (ctx) => {
			startRun(ctx);
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
							return `${key.padEnd(width)}  ${formatDescription(def.description, def.default, def.choices, undefined, def.env)}${only(key)}`.trimEnd();
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
		// `--project` exists only when there are two files to choose from; the actions read it as
		// optional, and a config with one file saves in it.
		const inProjectFlag: {} =
			hasUser && hasProject
				? { project: { type: "boolean", description: `Use ${projectName}, not your own file` } }
				: {};
		const toProject = (setting: string, flags: object) => {
			const project = !hasUser || (flags as { project?: boolean }).project === true;
			if (!project && !inUser(setting)) {
				throw new CrustError(
					"VALIDATION",
					`"${setting}" is a setting of ${projectName}: pass --project`,
				);
			}
			return project;
		};
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
						.flags(inProjectFlag)
						.action(async ({ args, flags, stdout }) => {
							const def = settings[args.key]!;
							const value = await convert(def, { [TEXT]: args.value }, TEXT, `"${args.key}"`);
							// A `parse` setting keeps what the user typed, as a file holds it.
							const saved = def.parse === undefined ? value : args.value;
							const path = await save({ [args.key]: saved }, toProject(args.key, flags));
							stdout(`Saved ${args.key} in ${path}`);
						}),
				)
				.command("unset", { description: "Remove a setting from a file" }, (unset) =>
					unset
						.args(key)
						.flags(inProjectFlag)
						.action(async ({ args, flags, stdout }) => {
							const path = await save({ [args.key]: undefined }, toProject(args.key, flags));
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
					`Missing setting "${key}" of ${name}: set ${[...variables, `"${key}" in ${inUser(key) ? await userPath() : projectName}`].join(" or ")}.`,
				);
			}
			return value;
		},
		list: async () => {
			const files = filesOnce(toStderr);
			return Promise.all(keys.map(async (key) => ({ key, ...(await resolve(key, files)) })));
		},
		set: async (values: Record<string, unknown>, target?: { readonly project?: true }) => {
			// Copied and queued before anything is awaited: saves apply in call order, and the values
			// checked are the values saved.
			const patch = Object.fromEntries(
				Object.entries(values).map(([key, value]) => [
					key,
					Array.isArray(value) ? [...value] : value,
				]),
			);
			const projectPath = target?.project === true ? projectFile() : undefined;
			await queued(async () => {
				// A value the setting's rules refuse would fail every command that reads it.
				for (const [key, value] of Object.entries(patch)) {
					if (value === undefined) continue;
					const def = settings[key]!;
					for (const word of fileWords(key, def, value, "set()")) {
						await convert(def, { [TEXT]: word }, TEXT, `"${key}"`);
					}
				}
				await saveNow(patch, projectPath);
			});
		},
		extension: options.command ? extension.add(configCommand()) : extension,
		jsonSchema: (target?: { readonly project: true }) =>
			jsonSchema(
				name,
				Object.fromEntries(
					(target?.project === true ? projectKeys : userKeys).map((key) => [key, settings[key]!]),
				),
			),
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

import {
	CrustError,
	defineContext,
	defineExtension,
	defineExtensionId,
	defineFlag,
	type ContextFactory,
	type Extension,
	type FlagDef,
	type FlagsDef,
	type ValidatedInput,
} from "@crustjs/core";
import { formatDescription, type LocalValueBrand, parseFlagValues } from "@crustjs/core/tooling";
// Types only: the store loads when a command first reads the config, never at start-up.
import type { FieldsDef, InferStoreConfig, Store } from "@crustjs/store";

/** The value types a JSON file holds as the user types them; the store holds no others. */
type SettingType = "string" | "number" | "boolean";

/**
 * One setting: the flag definition you would write in `.flags({...})` for a string, number or
 * boolean flag. `default` and `required` apply after the files are read.
 */
export type ConfigFlagDef = Extract<FlagDef, { type: SettingType; schema?: never }> & {
	/** `false`: no flag; the setting comes from its environment variable, the files or its default. */
	readonly flag?: false;
};

/** Settings keyed by name: the flag's name and the key in the files. */
type ConfigFlagsDef = Record<string, ConfigFlagDef>;

type AllKeys<T> = T extends unknown ? keyof T : never;

/** Every property a setting may have; `false` for those a flag definition has but a setting does not. */
const SETTING_PROPERTIES = {
	type: true,
	description: true,
	short: true,
	aliases: true,
	env: true,
	multiple: true,
	delimiter: true,
	choices: true,
	noNegate: true,
	parse: true,
	default: true,
	required: true,
	flag: true,
	// A flag schema validates argv text; a file holds JSON values.
	schema: false,
} as const satisfies Record<AllKeys<ConfigFlagDef>, boolean>;

/** A config file: `true` for its default name, or a file name of your own ending in `.json`. */
type ConfigFileOption = true | `${string}.json`;

/**
 * What a setting is once it can come from a file: no `default`, `required` or `flag` on the flag.
 * Distributed, so a definition typed as a union keeps each variant's own value type.
 */
type FlagOf<D> = D extends unknown ? Omit<D, "default" | "required" | "flag"> : never;

/** The flags the Context owns: every setting without `flag: false`. */
type ConfigFlags<F extends ConfigFlagsDef> = {
	[K in keyof F as F[K] extends { flag: false } ? never : K]: FlagOf<F[K]>;
} extends infer D extends FlagsDef
	? D
	: never;

/**
 * A setting's value: inferred as the setting would be as a flag (`required`, `default`, `choices`,
 * `parse`), for each variant of a definition typed as a union.
 */
type SettingValue<D> = D extends unknown
	? { value: Omit<D, "flag"> } extends infer R extends FlagsDef
		? ValidatedInput<[], R>["flags"]["value"]
		: never
	: never;

/** The store field of a setting: what the user types, so a `parse` setting holds a string. */
type StoreFieldOf<D extends ConfigFlagDef> = {
	type: D extends { parse: (raw: string) => unknown } ? "string" : D["type"];
} & (D extends { multiple: true } ? { array: true } : {}) &
	(D extends { choices: infer C extends readonly string[] } ? { choices: C } : {});

/** A config file as the store reads it: every key may be unset, in the shape the user writes it. */
type ConfigFileContent<F extends ConfigFlagsDef> = {
	[K in keyof F]: StoreFieldOf<F[K]>;
} extends infer S extends FieldsDef
	? { -readonly [K in keyof S]: InferStoreConfig<S>[K] }
	: never;

/** `true` for each variant of a definition that surely owns a flag: no `flag`, or `flag: undefined`. */
type OwnsFlag<D> = D extends unknown
	? "flag" extends keyof D
		? D["flag" & keyof D] extends undefined
			? true
			: false
		: true
	: never;

/**
 * The flag a setting's Context owns: none for `flag: false`, and none in the types when a definition
 * typed as a union or with an optional `flag` may not own one.
 */
type SettingFlags<F extends ConfigFlagsDef, K extends keyof F> = (
	[OwnsFlag<F[K]>] extends [true] ? { [P in K]: FlagOf<F[K]> } : {}
) extends infer D extends FlagsDef
	? D
	: never;

/** A setting's Context: named after it, owning its flag, its value settled from every source. */
type SettingContext<F extends ConfigFlagsDef, K extends keyof F & string> = ContextFactory<
	K,
	void,
	SettingValue<F[K]>,
	SettingFlags<F, K>
>;

/**
 * The settings' Contexts as a tuple: core types the Contexts an Extension provides from a static
 * tuple, and an object of settings has no order.
 *
 * This relies on TypeScript inferring the LAST overload of an intersection of functions (built from
 * the union of setting names), which is unspecified behaviour. The order it yields does not matter
 * here: every Context has its own name, and nothing reads the tuple's order (at run time the
 * Extension provides the settings in key order). If it ever stops
 * working, the replacement is a core change: map a non-tuple array of distinctly named Context
 * instances to their values by name, as a tuple is mapped today.
 */
type SettingInstances<
	F extends ConfigFlagsDef,
	Keys = keyof F & string,
	Acc extends readonly unknown[] = [],
> = [Keys] extends [never]
	? Acc
	: (
				(Keys extends unknown ? (last: () => Keys) => void : never) extends (last: infer I) => void
					? I
					: never
		  ) extends () => infer K
		? K extends keyof F & string
			? SettingInstances<F, Exclude<Keys, K>, [ReturnType<SettingContext<F, K>>, ...Acc]>
			: Acc
		: Acc;

/**
 * What `.flags()` returns for the settings `F` and the `global` option `G`: one Context factory
 * per setting, the Extension that provides them all, the JSON Schema of a file, and with `global`
 * set, the typed store of the global file.
 */
export type Config<F extends ConfigFlagsDef, G extends ConfigFileOption | undefined = undefined> = {
	/** Each setting's Context factory, by setting name: `.use()` one where a command reads it. */
	readonly settings: { readonly [K in keyof F & string]: SettingContext<F, K> };
	/** Provides every setting to the app: `.extend(config.extension)`. */
	readonly extension: Extension<{}, SettingInstances<F>, {}, []>;
	/** The JSON Schema (draft 2020-12) of a config file. */
	jsonSchema(): Record<string, unknown>;
} & (G extends ConfigFileOption ? { readonly global: Store<ConfigFileContent<F>> } : {});

/** A property no setting has, which a generic `F` would otherwise admit. */
type KnownPropertiesBrand<D> = [Exclude<keyof D, AllKeys<ConfigFlagDef>>] extends [never]
	? {}
	: {
			readonly FIX_UNKNOWN_PROPERTY: `a setting has no property "${Exclude<keyof D, AllKeys<ConfigFlagDef>> & string}"`;
		};

/** A file name with a directory, or with no name before `.json`, would read another place. */
type FileNameBrand<N> = N extends
	| `${string}/${string}`
	| `${string}\\${string}`
	| ".json"
	| `${string}.json.json`
	? { readonly FIX_FILE_NAME: "a file name ending in .json, without a directory" }
	: unknown;

/** `.` and `..` would name a directory above the app's own. */
type AppNameBrand<N> = N extends "." | ".."
	? { readonly FIX_APP_NAME: "a name of its own, not . or .." }
	: unknown;

/** `$schema` is a file's pointer to its JSON Schema; core refuses `__proto__` as a flag name. */
type ReservedNameBrand<F> = [Extract<keyof F, "$schema" | "__proto__">] extends [never]
	? unknown
	: { readonly FIX_RESERVED_NAME: "no setting may be named $schema or __proto__" };

// Types only: core's public `.flags()` signature, to reuse its checks on the flags the Context owns.
declare const ownedFlagsBuilder: ReturnType<typeof defineContext<"config">>;

/** Core's checks of a flag record (a bad `short`, two settings with one spelling) on the owned flags. */
type CoreFlagChecks<F extends ConfigFlagsDef> =
	ConfigFlags<F> extends Parameters<typeof ownedFlagsBuilder.flags<ConfigFlags<F>>>[0]
		? unknown
		: {
				readonly FIX_FLAG_SPELLING: "a setting's flag is one .flags() refuses: check each short and alias, and that no two settings share one";
			};

type NoFileBrand<G, P> = [G, P] extends [undefined, undefined]
	? { readonly FIX_NO_FILE: "set global, project, or both" }
	: unknown;

function definitionError(message: string): CrustError {
	return new CrustError("DEFINITION", message);
}

/** A bare file name: no directory, and a name before `.json`. */
function fileName(name: string, option: "global" | "project", value: true | string | undefined) {
	if (value === undefined) return undefined;
	const file =
		value === true ? (option === "global" ? "config.json" : `${name}.config.json`) : value;
	// The store refuses a name ending in .json, so `prefs.json.json` could never be read.
	if (!/^[^/\\]+\.json$/u.test(file) || file.slice(0, -".json".length).endsWith(".json")) {
		throw definitionError(
			`${option} of config "${name}" must be true or a file name ending in .json, without a directory: got "${file}"`,
		);
	}
	return file;
}

/** The checks `.flags()` makes on a flag, for every setting; `undefined` properties change nothing. */
function ownSetting(name: string, key: string, def: ConfigFlagDef): ConfigFlagDef {
	for (const [property, value] of Object.entries(def)) {
		const known = Object.hasOwn(SETTING_PROPERTIES, property);
		if (
			value === undefined ||
			(known && SETTING_PROPERTIES[property as keyof typeof SETTING_PROPERTIES])
		) {
			continue;
		}
		throw definitionError(`Setting "${key}" of config "${name}" has no property "${property}"`);
	}
	if (def.type !== "string" && def.type !== "number" && def.type !== "boolean") {
		throw definitionError(
			`Setting "${key}" of config "${name}" is a string, number or boolean: a config file holds no ${(def as { type: string }).type}`,
		);
	}
	const { flag, ...flagDef } = def;
	let owned: FlagDef;
	try {
		// defineFlag's own copy, so changing the caller's definition later changes nothing here.
		owned = defineFlag(flagDef as FlagDef);
	} catch (error) {
		if (!(error instanceof CrustError && error.is("DEFINITION"))) throw error;
		throw definitionError(`Invalid setting "${key}" of config "${name}"`).withCause(error);
	}
	// SAFETY: the owned copy of a setting's flag definition, plus its own `flag`.
	return (flag === undefined ? owned : { ...owned, flag }) as ConfigFlagDef;
}

/** The store field of each setting; a switch that cannot be negated is not negated in a file either. */
function storeFields(settings: readonly (readonly [string, ConfigFlagDef])[]): FieldsDef {
	const onlyTrue = (value: unknown) => {
		if ((Array.isArray(value) ? value : [value]).some((item) => item !== true)) {
			throw new Error("Expected true");
		}
	};
	const fields = settings.map(([key, def]) => [
		key,
		{
			type: def.parse === undefined ? def.type : "string",
			...(def.multiple ? { array: true } : {}),
			...(def.choices === undefined ? {} : { choices: def.choices }),
			...(def.type === "boolean" && def.noNegate ? { validate: onlyTrue } : {}),
		},
	]);
	// SAFETY: each field is a string, number or boolean store field built from its setting.
	return Object.fromEntries(fields) as FieldsDef;
}

/**
 * The nearest entry named `file` from the working directory up, whatever it is: reading it checks
 * the kind, and a dangling link reads as a missing file. Only a missing entry is skipped.
 */
function findUp(file: string, store: StoreModule): string | undefined {
	const { dirname, join } = process.getBuiltinModule("node:path");
	const { lstatSync } = process.getBuiltinModule("node:fs");
	for (let dir = process.cwd(); ; dir = dirname(dir)) {
		const path = join(dir, file);
		try {
			lstatSync(path);
			return path;
		} catch (error) {
			const code = (error as { code?: unknown }).code;
			if (code !== "ENOENT" && code !== "ENOTDIR") {
				throw new store.CrustStoreError(
					"IO",
					`Failed to inspect store file: ${path}`,
					{ path, operation: "read" },
					error,
				);
			}
		}
		if (dirname(dir) === dir) return undefined;
	}
}

type StoreModule = typeof import("@crustjs/store");

/** A store for the file at `path`, wherever its directory is. */
function storeAt(store: StoreModule, path: string, fields: FieldsDef): AnyStore {
	const { basename, dirname, sep } = process.getBuiltinModule("node:path");
	// The store takes a directory ending in `.json` for a file path; the separator says it is one.
	const dirPath = `${dirname(path)}${sep}`;
	return store.createStore({ dirPath, name: basename(path, ".json"), fields });
}

type FileValues = Readonly<Record<string, unknown>>;
type AnyStore = Store<Record<string, unknown>>;

/** A file value or the default as the setting's value: a `parse` setting parses what the user typed. */
function settled(key: string, def: ConfigFlagDef, value: unknown, where: string): unknown {
	const { parse } = def;
	if (parse === undefined || value === undefined) return value;
	const parseOne = (raw: string) => {
		let parsed: unknown;
		try {
			parsed = parse(raw);
		} catch (cause) {
			// As core shows a flag parser's message, so the parser must not echo a sensitive input.
			const reason = cause instanceof Error ? cause.message : String(cause);
			throw new CrustError("PARSE", `Invalid value for "${key}" in ${where}: ${reason}`).withCause(
				cause,
			);
		}
		// As core refuses it for argv; the rejection is handled so it never goes unhandled.
		if (process.getBuiltinModule("node:util/types").isPromise(parsed)) {
			parsed.catch(() => {});
			throw new CrustError(
				"PARSE",
				`Invalid value for "${key}" in ${where}: parse must be synchronous`,
			);
		}
		return parsed;
	};
	return Array.isArray(value) ? value.map(parseOne) : parseOne(value as string);
}

function missingMessage(name: string, key: string, def: ConfigFlagDef, files: readonly string[]) {
	const ways = [
		...(def.flag === false ? [] : [`pass --${key}`]),
		...(def.env === undefined ? [] : [`set ${def.env.name}`]),
	];
	const inFiles = `set "${key}" in ${files.join(" or ")}`;
	const all = ways.length === 0 ? inFiles : `${ways.join(", ")}, or ${inFiles}`;
	return `Missing setting "${key}" of ${name}: ${all}.`;
}

/** The options of {@link defineConfig}, so an unknown one, such as `flags`, is refused at run time. */
const OPTIONS = new Set(["name", "global", "project"]);

/**
 * What {@link defineConfig} returns for the `global` option `G`: where the files are, waiting for
 * `.flags()` and its settings.
 */
export interface ConfigBuilder<G extends ConfigFileOption | undefined> {
	/**
	 * Declare the settings, each the flag definition you would write in a command's `.flags({...})`,
	 * and get a Context per setting and the Extension that provides them.
	 */
	flags<const F extends ConfigFlagsDef>(
		// Same value brands as defineFlag (default within choices, synchronous parse), per setting.
		settings: F & {
			readonly [K in keyof F]: LocalValueBrand<Omit<F[K], "flag">> & KnownPropertiesBrand<F[K]>;
		} & ReservedNameBrand<F> &
			CoreFlagChecks<F>,
	): Config<F, G>;
}

/**
 * A CLI's settings, declared once: `defineConfig({ name, global, project }).flags({...})`. Each
 * setting is the flag definition you would write in a command's `.flags({...})` and becomes its own
 * lazy Context, named after it, that owns that flag. A command built with `defineCommand()` and
 * added with `.add()` `.use()`s the settings it reads and gets only their flags; the root and its
 * inline `.command()` children get every setting's flag, as for any Extension-provided Context.
 * argv, `--input`, typed `run()` input and `env` resolve as for any flag; what is still unset comes
 * from the project file, then the global file, then the `default`. The files are read for a setting
 * when a command reads it and neither its flag nor its variable gave it, once for each such setting,
 * and `@crustjs/store` is not imported before that.
 *
 * @throws {CrustError} `DEFINITION` for an unknown option, a file name with a directory or not
 *   ending in `.json`, or no file at all; `.flags()` throws it for a setting that is not a string,
 *   number or boolean flag definition, or one that `defineFlag` rejects (such as a default outside
 *   `choices`).
 */
export function defineConfig<
	const G extends ConfigFileOption | undefined = undefined,
	const P extends ConfigFileOption | undefined = undefined,
	const N extends string = string,
>(
	options: {
		/** The app name: the global file is in `configDir(name)`; the project file defaults to `<name>.config.json`. */
		readonly name: N & AppNameBrand<N>;
		/** `true` for `config.json` in `configDir(name)`, or a file name of your own there. */
		readonly global?: G & FileNameBrand<G>;
		/** `true` for `<name>.config.json`, or a file name of your own; the nearest from the working directory up. */
		readonly project?: P & FileNameBrand<P>;
	} & NoFileBrand<G, P>,
): ConfigBuilder<G> {
	const unknown = Object.keys(options).find((option) => !OPTIONS.has(option));
	if (unknown !== undefined) {
		throw definitionError(
			`defineConfig() has no option "${unknown}"${unknown === "flags" ? ": declare the settings with .flags()" : ""}`,
		);
	}
	const name: string = options.name;
	if (!/^[^/\\]+$/u.test(name) || name === "." || name === "..") {
		throw definitionError(`Config name "${name}" must be a non-empty name without a directory`);
	}
	const globalFile = fileName(name, "global", options.global);
	const projectFile = fileName(name, "project", options.project);
	if (globalFile === undefined && projectFile === undefined) {
		throw definitionError(`Config "${name}" reads no file: set global, project, or both`);
	}
	return Object.freeze({
		flags: (input: ConfigFlagsDef) => withSettings(name, globalFile, projectFile, input),
	}) as unknown as ConfigBuilder<G>;
}

/** The `config` Context factory for `settings`, read from `globalFile` and `projectFile`. */
function withSettings(
	name: string,
	globalFile: string | undefined,
	projectFile: string | undefined,
	input: ConfigFlagsDef,
) {
	const settings = Object.entries(input).map(([key, def]) => {
		// `$schema` in a file points editors at its JSON Schema; core refuses `__proto__` as a flag name
		// and when it parses env, so neither can be a setting.
		if (key === "$schema" || key === "__proto__") {
			throw definitionError(`Config "${name}" cannot have a setting named "${key}"`);
		}
		return [key, ownSetting(name, key, def)] as const;
	});
	const fields = storeFields(settings);

	// The import is cached, not a store: the config directory is resolved again for each use.
	let storeModule: Promise<StoreModule> | undefined;
	const loadStore = () =>
		(storeModule ??= import("@crustjs/store").catch((error: unknown) => {
			storeModule = undefined;
			throw error;
		}));
	const globalAt = (store: StoreModule) =>
		process.getBuiltinModule("node:path").join(store.configDir(name), globalFile!);
	const globalStore = async () => {
		const store = await loadStore();
		return storeAt(store, globalAt(store), fields);
	};

	const where = [
		...(projectFile === undefined
			? []
			: [`${projectFile} (the nearest from the working directory up)`]),
		...(globalFile === undefined
			? []
			: [`${globalFile} in the configuration directory of ${name}`]),
	];
	const width = Math.max(0, ...settings.map(([key]) => key.length));
	const readFiles = async () => {
		const store = await loadStore();
		const projectPath = projectFile === undefined ? undefined : findUp(projectFile, store);
		const globalPath = globalFile === undefined ? undefined : globalAt(store);
		const read = (path: string | undefined) =>
			path === undefined ? undefined : storeAt(store, path, fields).read();
		const [project, global] = await Promise.all([read(projectPath), read(globalPath)]);
		return { project, projectPath, global, globalPath };
	};

	// Own properties only: a setting named `constructor` must not read Object.prototype.
	const own = (record: FileValues | undefined, key: string) =>
		record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;

	const contexts = settings.map(([key, def]) => {
		// The package applies `default` and `required` after the files; on the flag, core would apply
		// them first.
		const { flag, default: _default, required: _required, ...owned } = def;
		// A setting without a flag reads only its variable: parsed under a fixed key, since its own name
		// need not be a valid argv spelling, and without argv-only spellings.
		const { short: _short, aliases: _aliases, ...envOnly } = owned;
		const fromEnv = owned.env === undefined ? undefined : (envOnly as FlagDef);
		const base = defineContext(key);
		const withFlag = flag === false ? base : base.flags({ [key]: owned } as never);
		const context = withFlag.setup(async ({ flags }) => {
			// Core resolves env for a flag; a setting without one gets the same env handling here.
			const given =
				flag === false
					? fromEnv === undefined
						? undefined
						: own(await parseFlagValues({ value: fromEnv }, process.env), "value")
					: own(flags, key);
			// `null` from a parser is a value: only undefined falls through, and a setting its flag or
			// variable gave reads no file.
			if (given !== undefined) return given;
			const read = await readFiles();
			for (const value of [
				() => settled(key, def, own(read.project, key), read.projectPath!),
				() => settled(key, def, own(read.global, key), read.globalPath!),
				// A fresh array each time: an action may change the value it gets.
				() =>
					settled(
						key,
						def,
						Array.isArray(def.default) ? [...def.default] : def.default,
						"its default",
					),
			]) {
				const settledValue = value();
				if (settledValue !== undefined) return settledValue;
			}
			if (def.required) {
				const places = [
					...(projectFile === undefined ? [] : [projectFile]),
					...(read.globalPath === undefined ? [] : [read.globalPath]),
				];
				const message = missingMessage(name, key, def, places);
				throw new CrustError("VALIDATION", message, {
					issues: [{ message, path: `config.${key}` }],
				});
			}
			return undefined;
		});
		return [key, context] as const;
	});

	const result: Record<string, unknown> = {
		settings: Object.freeze(Object.fromEntries(contexts)),
		// SAFETY: the type of `extension` is `Config["extension"]`; the runtime list is erased.
		extension: defineExtension(defineExtensionId(`crust:config:${name}`))
			.provide(...(contexts.map(([, context]) => context()) as never[]))
			.sections(() => [
				{
					command: [],
					title: "Configuration",
					body: [
						`Each setting is the first of: its flag, its environment variable, ${where.join(", ")}, its default.`,
						...settings.map(([key, def]) =>
							`${key.padEnd(width)}  ${formatDescription(def.description, def.default, def.choices, undefined, def.env?.name)}`.trimEnd(),
						),
					].join("\n"),
				},
			]),
		jsonSchema: () => jsonSchema(name, settings),
	};
	if (globalFile !== undefined) {
		const global: AnyStore = {
			read: async () => (await globalStore()).read(),
			write: async (config, mutation) => (await globalStore()).write(config, mutation),
			update: async (updater, mutation) => (await globalStore()).update(updater, mutation),
			patch: async (partial, mutation) => (await globalStore()).patch(partial, mutation),
			reset: async (mutation) => (await globalStore()).reset(mutation),
		};
		result.global = Object.freeze(global);
	}
	return Object.freeze(result);
}

/** What a user writes in a file for one setting: the text type for `parse`, never the parsed value. */
function settingSchema(def: ConfigFlagDef): Record<string, unknown> {
	const item: Record<string, unknown> =
		def.type === "boolean" && def.noNegate
			? { const: true }
			: def.choices === undefined
				? { type: def.parse === undefined ? def.type : "string" }
				: { enum: [...def.choices] };
	return {
		...(def.multiple ? { type: "array", items: item } : item),
		...(def.description === undefined ? {} : { description: def.description }),
		...(def.default === undefined
			? {}
			: { default: Array.isArray(def.default) ? [...def.default] : def.default }),
	};
}

function jsonSchema(
	name: string,
	settings: readonly (readonly [string, ConfigFlagDef])[],
): Record<string, unknown> {
	return {
		$schema: "https://json-schema.org/draft/2020-12/schema",
		title: `${name} config file`,
		type: "object",
		properties: {
			$schema: { type: "string" },
			...Object.fromEntries(settings.map(([key, def]) => [key, settingSchema(def)])),
		},
		additionalProperties: false,
	};
}

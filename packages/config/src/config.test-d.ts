import {
	type ContextInstance,
	Crust,
	defineCommand,
	type Extension,
	type FactoryValueOf,
} from "@crustjs/core";
import type { Store } from "@crustjs/store";

import { type Config, type ConfigBuilder, type ConfigFlagDef, defineConfig } from "./index.ts";

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

const config = defineConfig({
	name: "acme",
	global: true,
	project: true,
}).flags({
	org: { type: "string", env: { name: "ACME_ORG" }, required: true },
	region: { type: "string", choices: ["us", "eu"], default: "us" },
	port: { type: "number", short: "p", aliases: ["listen"] },
	timeout: { type: "string", parse: (raw) => Number(raw), default: "30" },
	tags: { type: "string", multiple: true, delimiter: "," },
	yes: { type: "boolean", noNegate: true, description: "Skip confirmations" },
	telemetry: { type: "boolean", flag: false, env: { name: "ACME_TELEMETRY" } },
});

// Each setting's value: inferred as the settings would be as flags; required and defaulted
// settings are never undefined, choices are a union, parse gives its output.
const { org, region, port, timeout, tags, yes, telemetry } = config.settings;
type _Values = Expect<
	Equal<
		[
			FactoryValueOf<typeof org>,
			FactoryValueOf<typeof region>,
			FactoryValueOf<typeof port>,
			FactoryValueOf<typeof timeout>,
			FactoryValueOf<typeof tags>,
			FactoryValueOf<typeof yes>,
			FactoryValueOf<typeof telemetry>,
		],
		[
			string,
			"us" | "eu",
			number | undefined,
			number,
			string[] | undefined,
			boolean | undefined,
			boolean | undefined,
		]
	>
>;

// `config.global` is the typed store of the global file: what the user types, every key optional.
type File = Awaited<ReturnType<typeof config.global.read>>;
type _File = Expect<
	Equal<
		File,
		{
			org: string | undefined;
			region: "us" | "eu" | undefined;
			port: number | undefined;
			timeout: string | undefined;
			tags: string[] | undefined;
			yes: boolean | undefined;
			telemetry: boolean | undefined;
		}
	>
>;
const _global: Store<File> = config.global;
void config.global.patch({ region: "eu" });
// @ts-expect-error -- outside choices
void config.global.patch({ region: "mars" });
// @ts-expect-error -- a parse setting holds what the user types
void config.global.patch({ timeout: 30 });
// @ts-expect-error -- without `global`, the config exposes no global store
void defineConfig({ name: "acme", project: true }).flags({}).global;

// A command `.use()`s the settings it reads, and gets only their flags.
const deploy = defineCommand("deploy", (command) =>
	command.use(org, region).action(async ({ ctx, flags }) => {
		const value = await ctx.org;
		type _Org = Expect<Equal<typeof value, string>>;
		type _Region = Expect<Equal<Awaited<typeof ctx.region>, "us" | "eu">>;
		// `flags.org` is only what was typed or came from env; the settled value is `await ctx.org`.
		type _Flag = Expect<Equal<typeof flags.org, string | undefined>>;
		// @ts-expect-error -- a setting the command did not `.use()`
		void ctx.port;
		// @ts-expect-error -- nor its flag
		void flags.port;
		return value;
	}),
);
const serve = defineCommand("serve", (command) =>
	command.use(port, telemetry).action(async ({ ctx }) => (await ctx.port) ?? 0),
);

// `flags` holds what the run was given for each kind of setting: typed as the flag, never required
// and never defaulted, since `required` and `default` apply after the files. `ctx` holds the setting.
defineCommand("every", (command) =>
	command
		.use(org, region, port, timeout, tags, yes, telemetry)
		.flags({ local: { type: "string", required: true } })
		.action(({ ctx, flags }) => {
			type _Flags = Expect<
				Equal<
					[
						typeof flags.org,
						typeof flags.region,
						typeof flags.port,
						typeof flags.timeout,
						typeof flags.tags,
						typeof flags.yes,
						// The command's own flags keep their types.
						typeof flags.local,
					],
					[
						string | undefined,
						"us" | "eu" | undefined,
						number | undefined,
						number | undefined,
						string[] | undefined,
						boolean | undefined,
						string,
					]
				>
			>;
			type _Ctx = Expect<
				Equal<
					[Awaited<typeof ctx.org>, Awaited<typeof ctx.region>, Awaited<typeof ctx.timeout>],
					[string, "us" | "eu", number]
				>
			>;
			// @ts-expect-error -- a `flag: false` setting is in `ctx` only
			void flags.telemetry;
			// @ts-expect-error -- an alias is a spelling, not a key of `flags`
			void flags.listen;
			// @ts-expect-error -- `ctx.org` is a promise: the missing `await` is caught
			const text: string = ctx.org;
			void text;
		}),
);
// An inline child of the root reads every setting, typed the same way.
new Crust("acme").extend(config.extension).command("inline", (command) =>
	command.action(({ ctx, flags }) => {
		type _Inline = Expect<
			Equal<
				[Awaited<typeof ctx.region>, typeof flags.region],
				["us" | "eu", "us" | "eu" | undefined]
			>
		>;
	}),
);
const app = new Crust("acme").extend(config.extension).add(deploy, serve);
// @ts-expect-error -- the settings' Extension is missing
new Crust("acme").add(deploy);
// A test replaces one setting with its double, without the Extension.
new Crust("acme").provide(org.of("test-org"), region.of("eu")).add(deploy);
// @ts-expect-error -- a double has the setting's type
org.of(1);
// @ts-expect-error -- a setting that is not in the config
void config.settings.nope;
// @ts-expect-error -- a setting name that another provided Context already has
new Crust("acme").provide(org.of("x")).extend(config.extension).add(deploy);
const _config: Config<{ org: { type: "string" } }, true> = defineConfig({
	name: "acme",
	global: true,
}).flags({ org: { type: "string" } });

// Typed input: a command takes only its settings' flags, all optional (a file may give them).
void app.run(["deploy"], {});
void app.run(["deploy"], { flags: { org: "o", region: "eu" } });
// @ts-expect-error -- outside choices
void app.run(["deploy"], { flags: { region: "mars" } });
// @ts-expect-error -- deploy does not use port
void app.run(["deploy"], { flags: { port: 1 } });
void app.run(["serve"], { flags: { port: 1 } });
// @ts-expect-error -- a setting with `flag: false` owns no flag
void app.run(["serve"], { flags: { telemetry: true } });

// The Extension's tuple of Contexts holds every setting, whatever their number.
const one = defineConfig({ name: "one", global: true }).flags({ a: { type: "string" } });
new Crust("one")
	.extend(one.extension)
	.add(defineCommand("x", (command) => command.use(one.settings.a)));
const thirty = defineConfig({ name: "thirty", global: true }).flags({
	s0: { type: "string" },
	s1: { type: "number" },
	s2: { type: "boolean" },
	s3: { type: "string" },
	s4: { type: "number" },
	s5: { type: "boolean" },
	s6: { type: "string" },
	s7: { type: "number" },
	s8: { type: "boolean" },
	s9: { type: "string" },
	s10: { type: "number" },
	s11: { type: "boolean" },
	s12: { type: "string" },
	s13: { type: "number" },
	s14: { type: "boolean" },
	s15: { type: "string" },
	s16: { type: "number" },
	s17: { type: "boolean" },
	s18: { type: "string" },
	s19: { type: "number" },
	s20: { type: "boolean" },
	s21: { type: "string" },
	s22: { type: "number" },
	s23: { type: "boolean" },
	s24: { type: "string" },
	s25: { type: "number" },
	s26: { type: "boolean" },
	s27: { type: "string" },
	s28: { type: "number" },
	s29: { type: "string", required: true },
});
const first = defineCommand("first", (command) =>
	command.use(thirty.settings.s0).action(async ({ ctx }) => ctx.s0),
);
const last = defineCommand("last", (command) =>
	command.use(thirty.settings.s29, thirty.settings.s14).action(async ({ ctx }) => {
		type _S29 = Expect<Equal<Awaited<typeof ctx.s29>, string>>;
		type _S14 = Expect<Equal<Awaited<typeof ctx.s14>, boolean | undefined>>;
		return ctx.s29;
	}),
);
new Crust("thirty").extend(thirty.extension).add(first, last);

// The Extension provides exactly the settings, each once, whatever order the tuple has.
type Provided<E> = E extends Extension<any, infer P, any, any> ? P : never;
type ProvidedNames<E> = Provided<E>[number] extends infer I
	? I extends ContextInstance<infer N, any, any, any, any>
		? N
		: never
	: never;
type _ThirtyNames = Expect<
	Equal<ProvidedNames<typeof thirty.extension>, keyof typeof thirty.settings>
>;
type _ThirtyLength = Expect<Equal<Provided<typeof thirty.extension>["length"], 30>>;
type _ConfigNames = Expect<
	Equal<ProvidedNames<typeof config.extension>, keyof typeof config.settings>
>;
type _ConfigLength = Expect<Equal<Provided<typeof config.extension>["length"], 7>>;
type _OneLength = Expect<Equal<Provided<typeof one.extension>["length"], 1>>;
// A setting of another config is not provided by this one's Extension.
const foreign = defineCommand("foreign", (command) =>
	command.use(one.settings.a).action(async ({ ctx }) => ctx.a),
);
// @ts-expect-error -- `a` belongs to another config
new Crust("thirty").extend(thirty.extension).add(foreign);

// A setting is a flag definition for a string, number or boolean.
const shared = { type: "string", description: "Organization" } as const satisfies ConfigFlagDef;
defineConfig({ name: "acme", global: true }).flags({ org: shared });
defineConfig({
	name: "acme",
	global: true,
}).flags(
	// @ts-expect-error -- a default outside choices, as for a flag
	{ region: { type: "string", choices: ["us"], default: "eu" } },
);
defineConfig({
	name: "acme",
	global: true,
}).flags(
	// @ts-expect-error -- an unknown property in a setting
	{ org: { type: "string", nope: 1 } },
);
defineConfig({
	name: "acme",
	global: true,
}).flags(
	// @ts-expect-error -- a setting is a flag or `flag: false`, never `flag: true`
	{ org: { type: "string", flag: true } },
);
// @ts-expect-error -- the store holds no URL
defineConfig({ name: "acme", global: true }).flags({ api: { type: "url" } });
// @ts-expect-error -- nor a path
defineConfig({ name: "acme", global: true }).flags({ dir: { type: "path" } });
// @ts-expect-error -- nor JSON
defineConfig({ name: "acme", global: true }).flags({ data: { type: "json" } });
defineConfig({
	name: "acme",
	global: true,
}).flags(
	// @ts-expect-error -- a flag schema validates argv text, not a file's JSON value
	{ org: { type: "string", schema: {} as never } },
);

// The files: `true`, or a bare file name ending in `.json`.
defineConfig({ name: "acme", global: "settings.json", project: ".acme.json" }).flags({});
// @ts-expect-error -- the global file must be a .json file
defineConfig({ name: "acme", global: "settings.toml" }).flags({});
// @ts-expect-error -- a file name, not a path
defineConfig({ name: "acme", global: "a/b.json" }).flags({});
// @ts-expect-error -- a file name, not a Windows path
defineConfig({ name: "acme", project: "a\\b.json" }).flags({});
// @ts-expect-error -- a file name, not only the extension
defineConfig({ name: "acme", project: ".json" }).flags({});
// @ts-expect-error -- a config reads at least one file
defineConfig({ name: "acme" }).flags({});

// Names the file or the store would read elsewhere, or not at all.
// @ts-expect-error -- not the app's own directory
defineConfig({ name: "..", global: true }).flags({});
// @ts-expect-error -- the store refuses a name ending in .json
defineConfig({ name: "acme", global: "prefs.json.json" }).flags({});
// @ts-expect-error -- `$schema` points a file at its JSON Schema
defineConfig({ name: "acme", global: true }).flags({ $schema: { type: "string" } });
// @ts-expect-error -- also without a flag
defineConfig({ name: "acme", global: true }).flags({ $schema: { type: "string", flag: false } });

// Core's own flag-record checks apply to the settings' flags.
defineConfig({
	name: "acme",
	global: true,
}).flags(
	// @ts-expect-error -- a short spelling is one character
	{ port: { type: "number", short: "xx" } },
);
defineConfig({
	name: "acme",
	global: true,
}).flags(
	// @ts-expect-error -- two settings with the same short spelling
	{ a: { type: "string", short: "x" }, b: { type: "string", short: "x" } },
);
defineConfig({
	name: "acme",
	global: true,
}).flags({ a: { type: "string", short: "x" }, b: { type: "string", short: "y", flag: false } });

// Settings come only from `.flags()`, called once on what defineConfig() returns.
// @ts-expect-error -- `flags` is not an option
defineConfig({ name: "acme", global: true, flags: { org: { type: "string" } } });
const builder = defineConfig({ name: "acme", global: true });
// @ts-expect-error -- the builder is not a Context: call .flags() first
defineCommand("x", (command) => command.use(builder));
// @ts-expect-error -- nor a Context factory
new Crust("acme").provide(builder());
// @ts-expect-error -- the global store comes with the settings
void builder.global;
// @ts-expect-error -- .flags() is called once
void builder.flags({ org: { type: "string" } }).flags;

// A module that exports the builder for another to finish can name its type in a declaration.
export const files: ConfigBuilder<true> = defineConfig({ name: "acme", global: true });
void files.flags({ org: { type: "string" } }).global;

// A definition typed as a union keeps each variant's value type; a flag it may not own is not typed.
declare const either: { type: "string" } | { type: "string"; parse: (raw: string) => number };
const unioned = defineConfig({ name: "acme", global: true }).flags({ x: either });
type _Either = Expect<
	Equal<FactoryValueOf<typeof unioned.settings.x>, string | number | undefined>
>;
declare const maybeFlag: { type: "number"; flag?: false };
const maybe = defineConfig({ name: "acme", global: true }).flags({ y: maybeFlag });
const usesMaybe = defineCommand("m", (command) =>
	command.use(maybe.settings.y).action(async ({ ctx }) => ctx.y),
);
const maybeApp = new Crust("acme").extend(maybe.extension).add(usesMaybe);
// @ts-expect-error -- `flag?: false` may own no flag, so typed input does not offer it
void maybeApp.run(["m"], { flags: { y: 1 } });

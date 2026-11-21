import { Crust, defineCommand, type FactoryValueOf } from "@crustjs/core";
import type { Store } from "@crustjs/store";

import { type ConfigFactory, type ConfigFlagDef, defineConfig } from "./index.ts";

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

const config = defineConfig({
	name: "acme",
	global: true,
	project: true,
	flags: {
		org: { type: "string", env: { name: "ACME_ORG" }, required: true },
		region: { type: "string", choices: ["us", "eu"], default: "us" },
		port: { type: "number", short: "p", aliases: ["listen"] },
		timeout: { type: "string", parse: (raw) => Number(raw), default: "30" },
		tags: { type: "string", multiple: true, delimiter: "," },
		yes: { type: "boolean", noNegate: true, description: "Skip confirmations" },
		telemetry: { type: "boolean", flag: false, env: { name: "ACME_TELEMETRY" } },
	},
});

// `await ctx.config`: inferred as the settings would be as flags; required and defaulted
// settings are never undefined, choices are a union, parse gives its output.
type Value = FactoryValueOf<typeof config>;
type _Value = Expect<
	Equal<
		Value,
		Readonly<{
			org: string;
			region: "us" | "eu";
			port: number | undefined;
			timeout: number;
			tags: string[] | undefined;
			yes: boolean | undefined;
			telemetry: boolean | undefined;
		}>
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
void defineConfig({ name: "acme", project: true, flags: {} }).global;

// The factory: `.use(config)`, `.provide(config())`, `.provide(config.of(...))`.
const deploy = defineCommand("deploy", (command) =>
	command.use(config).action(async ({ ctx }) => {
		const { org, region } = await ctx.config;
		type _Org = Expect<Equal<typeof org, string>>;
		return region;
	}),
);
const app = new Crust("acme").provide(config()).add(deploy);
new Crust("acme").provide(config.of({} as Value)).add(deploy);
// @ts-expect-error -- a test double has the setting types
config.of({ org: 1 });
const _factory: ConfigFactory<{ org: { type: "string" } }, true> = defineConfig({
	name: "acme",
	global: true,
	flags: { org: { type: "string" } },
});

// Typed input: every flag a setting owns is optional (a required setting may come from a file).
void app.run(["deploy"], {});
void app.run(["deploy"], { flags: { org: "o", region: "eu", port: 1, tags: ["a"] } });
// @ts-expect-error -- outside choices
void app.run(["deploy"], { flags: { region: "mars" } });
// @ts-expect-error -- a setting with `flag: false` owns no flag
void app.run(["deploy"], { flags: { telemetry: true } });

// A setting is a flag definition for a string, number or boolean.
const shared = { type: "string", description: "Organization" } as const satisfies ConfigFlagDef;
defineConfig({ name: "acme", global: true, flags: { org: shared } });
defineConfig({
	name: "acme",
	global: true,
	// @ts-expect-error -- a default outside choices, as for a flag
	flags: { region: { type: "string", choices: ["us"], default: "eu" } },
});
defineConfig({
	name: "acme",
	global: true,
	// @ts-expect-error -- an unknown property in a setting
	flags: { org: { type: "string", nope: 1 } },
});
defineConfig({
	name: "acme",
	global: true,
	// @ts-expect-error -- a setting is a flag or `flag: false`, never `flag: true`
	flags: { org: { type: "string", flag: true } },
});
// @ts-expect-error -- the store holds no URL
defineConfig({ name: "acme", global: true, flags: { api: { type: "url" } } });
// @ts-expect-error -- nor a path
defineConfig({ name: "acme", global: true, flags: { dir: { type: "path" } } });
// @ts-expect-error -- nor JSON
defineConfig({ name: "acme", global: true, flags: { data: { type: "json" } } });
defineConfig({
	name: "acme",
	global: true,
	// @ts-expect-error -- a flag schema validates argv text, not a file's JSON value
	flags: { org: { type: "string", schema: {} as never } },
});

// The files: `true`, or a bare file name ending in `.json`.
defineConfig({ name: "acme", global: "settings.json", project: ".acme.json", flags: {} });
// @ts-expect-error -- the global file must be a .json file
defineConfig({ name: "acme", global: "settings.toml", flags: {} });
// @ts-expect-error -- a file name, not a path
defineConfig({ name: "acme", global: "a/b.json", flags: {} });
// @ts-expect-error -- a file name, not a Windows path
defineConfig({ name: "acme", project: "a\\b.json", flags: {} });
// @ts-expect-error -- a file name, not only the extension
defineConfig({ name: "acme", project: ".json", flags: {} });
// @ts-expect-error -- a config reads at least one file
defineConfig({ name: "acme", flags: {} });

// Names the file or the store would read elsewhere, or not at all.
// @ts-expect-error -- not the app's own directory
defineConfig({ name: "..", global: true, flags: {} });
// @ts-expect-error -- the store refuses a name ending in .json
defineConfig({ name: "acme", global: "prefs.json.json", flags: {} });
// @ts-expect-error -- `$schema` points a file at its JSON Schema
defineConfig({ name: "acme", global: true, flags: { $schema: { type: "string" } } });
// @ts-expect-error -- also without a flag
defineConfig({ name: "acme", global: true, flags: { $schema: { type: "string", flag: false } } });

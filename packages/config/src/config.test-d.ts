import { Crust, defineCommand } from "@crustjs/core";

import { type ConfigEntry, defineConfig, type SettingKey } from "./index.ts";

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

const config = defineConfig({
	name: "acme",
	user: {
		org: { type: "string", env: "ACME_ORG", required: true },
		timeout: { type: "string", parse: (raw) => Number(raw), default: "30" },
		tags: { type: "string", multiple: true, delimiter: "," },
		yes: { type: "boolean" },
	},
	project: { entry: { type: "string" } },
	both: {
		region: { type: "string", choices: ["us", "eu"], default: "us" },
		port: { type: "number", min: 1 },
	},
	command: true,
});

// get(): each value as the setting's flag would have it.
void (async () => {
	type _Values = Expect<
		Equal<
			[
				Awaited<ReturnType<typeof config.get<"org">>>,
				Awaited<ReturnType<typeof config.get<"region">>>,
				Awaited<ReturnType<typeof config.get<"port">>>,
				Awaited<ReturnType<typeof config.get<"timeout">>>,
				Awaited<ReturnType<typeof config.get<"tags">>>,
				Awaited<ReturnType<typeof config.get<"yes">>>,
			],
			[string, "us" | "eu", number | undefined, number, string[] | undefined, boolean | undefined]
		>
	>;
	const region: "us" | "eu" = await config.get("region");
	void region;
	// @ts-expect-error -- not a setting
	await config.get("regoin");
	const entries: ConfigEntry<{ region: { type: "string"; choices: ["us", "eu"] } }>[] = [];
	for (const entry of entries) {
		if (entry.key === "region") {
			const _value: "us" | "eu" | undefined = entry.value;
		}
	}
	const listed = await config.list();
	type _Listed = Expect<
		Equal<
			(typeof listed)[number]["key"],
			"org" | "region" | "port" | "timeout" | "tags" | "yes" | "entry"
		>
	>;
})();

// set(): keys and values as a file holds them; each file takes only the settings it may hold.
void config.set({ region: "eu", timeout: "45", tags: ["a"], org: undefined });
void config.set({ region: "eu", port: 8080, entry: "src/main.ts" }, { project: true });
// @ts-expect-error -- only the project file may set entry
void config.set({ entry: "src/main.ts" });
// @ts-expect-error -- outside choices
void config.set({ region: "mars" });
// @ts-expect-error -- a parse setting holds what the user types
void config.set({ timeout: 30 });
// @ts-expect-error -- not a setting
void config.set({ regoin: "eu" });
// @ts-expect-error -- the project file may not set org
void config.set({ org: "acme" }, { project: true });
const userOnly = defineConfig({ name: "acme", user: { pager: { type: "string" } } });
// @ts-expect-error -- no setting of a project file, so no project file to save in
void userOnly.set({ pager: "less" }, { project: true });
const projectOnly = defineConfig({ name: "acme", project: { entry: { type: "string" } } });
void projectOnly.set({ entry: "src/main.ts" }, { project: true });
// @ts-expect-error -- no setting of the user's file, so no user's file to save in
void projectOnly.set({ entry: "src/main.ts" });

// flag(): the setting's definition, with its key in `config`, under any flag name.
const deploy = defineCommand("deploy", (command) =>
	command
		.flags({
			where: config.flag("region"),
			port: config.flag("port"),
			when: config.flag("timeout"),
		})
		.action(({ flags }) => {
			type _Flags = Expect<
				Equal<
					[typeof flags.where, typeof flags.port, typeof flags.when],
					["us" | "eu", number | undefined, number]
				>
			>;
		}),
);
void new Crust("acme").extend(config.extension).add(deploy);
// @ts-expect-error -- not a setting
config.flag("regoin");
const _key: SettingKey = config.flag("org").config;
// @ts-expect-error -- only config.flag() writes the config key
void defineCommand("x", (command) => command.flags({ org: { type: "string", config: "org" } }));

// Definitions: a setting is a string, number or boolean flag definition, and nothing else.
defineConfig({
	name: "acme",
	// @ts-expect-error -- no such property
	user: { org: { type: "string", flag: false } },
});
defineConfig({
	name: "acme",
	// @ts-expect-error -- a config file holds no url
	project: { site: { type: "url" } },
});
defineConfig({
	name: "acme",
	// @ts-expect-error -- default outside choices
	both: { region: { type: "string", choices: ["us", "eu"], default: "mars" } },
});
defineConfig({
	name: "acme",
	// @ts-expect-error -- $schema is a file's pointer to its schema
	user: { $schema: { type: "string" } },
});
const twice = defineConfig({
	name: "acme",
	user: { region: { type: "string" } },
	both: { region: { type: "string" } },
});
type _Twice = Expect<Equal<typeof twice, { readonly FIX_SETTING_IN_TWO_GROUPS: "region" }>>;
// @ts-expect-error -- a setting is in one group, so this is no config
twice.flag("region");
defineConfig({
	name: "acme",
	// @ts-expect-error -- a format reads and writes: parse and stringify go together
	format: { extension: "toml", parse: (text: string) => JSON.parse(text) },
});
defineConfig({
	name: "acme",
	files: { user: "settings", project: "acme" },
	format: { extension: "toml", parse: () => ({}), stringify: () => "" },
});

import { Crust, defineCommand } from "@crustjs/core";

import { type ConfigEntry, defineConfig, type SettingKey } from "./index.ts";

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

const config = defineConfig({
	name: "acme",
	settings: {
		org: { type: "string", env: "ACME_ORG", required: true },
		region: { type: "string", choices: ["us", "eu"], default: "us" },
		port: { type: "number", min: 1 },
		timeout: { type: "string", parse: (raw) => Number(raw), default: "30" },
		tags: { type: "string", multiple: true, delimiter: "," },
		yes: { type: "boolean" },
	},
	project: ["region", "port"],
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
		Equal<(typeof listed)[number]["key"], "org" | "region" | "port" | "timeout" | "tags" | "yes">
	>;
})();

// set(): keys and values as a file holds them; the project form takes only the project's keys.
void config.set({ region: "eu", timeout: "45", tags: ["a"], org: undefined });
void config.set({ region: "eu", port: 8080 }, { project: true });
// @ts-expect-error -- outside choices
void config.set({ region: "mars" });
// @ts-expect-error -- a parse setting holds what the user types
void config.set({ timeout: 30 });
// @ts-expect-error -- not a setting
void config.set({ regoin: "eu" });
// @ts-expect-error -- the project file may not set org
void config.set({ org: "acme" }, { project: true });

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
	settings: { org: { type: "string", flag: false } },
});
defineConfig({
	name: "acme",
	// @ts-expect-error -- a config file holds no url
	settings: { site: { type: "url" } },
});
defineConfig({
	name: "acme",
	// @ts-expect-error -- default outside choices
	settings: { region: { type: "string", choices: ["us", "eu"], default: "mars" } },
});
defineConfig({
	name: "acme",
	// @ts-expect-error -- $schema is a file's pointer to its schema
	settings: { $schema: { type: "string" } },
});
defineConfig({
	name: "acme",
	settings: { region: { type: "string" } },
	// @ts-expect-error -- the project list names settings
	project: ["regoin"],
});
defineConfig({
	name: "acme",
	settings: {},
	// @ts-expect-error -- a format reads and writes: parse and stringify go together
	files: { parse: (text: string) => JSON.parse(text) },
});
defineConfig({
	name: "acme",
	settings: {},
	files: { user: "acmerc", project: ".acmerc", parse: () => ({}), stringify: () => "" },
});

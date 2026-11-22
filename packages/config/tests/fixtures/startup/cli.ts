import { Crust, defineCommand } from "@crustjs/core";

import { defineConfig } from "../../../src/index.ts";

const config = defineConfig({
	name: "acme",
	global: true,
	project: true,
}).flags({ org: { type: "string", env: { name: "ACME_ORG" } } });

const { org } = config.settings;

await new Crust("acme")
	.extend(config.extension)
	.add(
		defineCommand("ping", (command) => command.action(({ stdout }) => stdout("pong"))),
		defineCommand("show", (command) =>
			command.use(org).action(async ({ ctx, stdout }) => stdout(`org=${await ctx.org}`)),
		),
	)
	.execute();

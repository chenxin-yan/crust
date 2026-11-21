import { Crust } from "@crustjs/core";

import { defineConfig } from "../../../src/index.ts";

const config = defineConfig({
	name: "acme",
	global: true,
	project: true,
}).flags({ org: { type: "string", env: { name: "ACME_ORG" } } });

await new Crust("acme")
	.provide(config())
	.command("ping", (command) => command.action(({ stdout }) => stdout("pong")))
	.command("show", (command) =>
		command.use(config).action(async ({ ctx, stdout }) => stdout(`org=${(await ctx.config).org}`)),
	)
	.execute();

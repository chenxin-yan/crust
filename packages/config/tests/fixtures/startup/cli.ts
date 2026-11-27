import { Crust, defineCommand } from "@crustjs/core";

import { defineConfig } from "../../../src/index.ts";

const config = defineConfig({
	name: "acme",
	both: { org: { type: "string", env: "ACME_ORG" } },
});

await new Crust("acme")
	.extend(config.extension)
	.add(
		defineCommand("ping", (command) => command.action(({ stdout }) => stdout("pong"))),
		defineCommand("show", (command) =>
			command
				.flags({ org: config.flag("org") })
				.action(({ flags, stdout }) => stdout(`org=${flags.org}`)),
		),
	)
	.execute();

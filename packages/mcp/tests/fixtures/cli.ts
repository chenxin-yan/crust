import { type AnyCrust, Crust, defineCommand } from "@crustjs/core";

import { mcpExtension } from "../../src/index.ts";

const app = new Crust("demo", { description: "MCP fixture", version: "0.1.0" })
	.add(
		defineCommand("greet", { description: "Greet someone" }, (command) =>
			command
				.args({ name: "name", type: "string", required: true })
				.flags({ name: "shout", type: "boolean" })
				.action(({ args, flags, stdout }) => {
					// Logged through the invocation IO, so serving over stdio captures it instead of leaking protocol bytes.
					stdout("greeting");
					const text = `hello ${args.name}`;
					return { greeting: flags.shout ? text.toUpperCase() : text };
				}),
		),
	)
	.extend(mcpExtension({ app: (): AnyCrust => app }));

process.exitCode = await app.execute();

import { type AnyCrust, Crust, defineCommand } from "@crustjs/core";
import { input } from "@crustjs/extensions";
import { readStdin } from "@crustjs/utils/process";

import { mcpExtension } from "../../src/index.ts";

const app = new Crust("demo", { description: "MCP fixture", version: "0.1.0" })
	.add(
		defineCommand("greet", { description: "Greet someone" }, (command) =>
			command
				.args({ name: "name", type: "string", required: true })
				.flags({ shout: { type: "boolean" } })
				.action(({ args, flags, stdout }) => {
					// Logged through the invocation IO, so serving over stdio captures it instead of leaking protocol bytes.
					stdout("greeting");
					const text = `hello ${args.name}`;
					return { greeting: flags.shout ? text.toUpperCase() : text };
				}),
		),
	)
	.add(
		defineCommand("whoami", { description: "Show the configured token" }, (command) =>
			command
				.flags({ token: { type: "string", env: { name: "DEMO_TOKEN" }, required: true } })
				.action(({ flags }) => ({ token: flags.token })),
		),
	)
	.add(
		// Reads stdin like `--body -` would; under `mcp`, stdin carries protocol frames.
		defineCommand("slurp", { description: "Read stdin" }, (command) =>
			command.action(async ({ signal }) => ({ text: await readStdin(signal) })),
		),
	)
	.extend(input(), mcpExtension({ app: (): AnyCrust => app }));

process.exitCode = await app.execute();

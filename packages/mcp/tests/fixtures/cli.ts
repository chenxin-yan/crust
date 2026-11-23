import { Crust, defineCommand } from "@crustjs/core";
import { jsonInput } from "@crustjs/extensions";

import { mcp } from "../../src/index.ts";

// Installed before the commands: `mcp` serves the tree it runs in, not the one it was added to.
const app = new Crust("demo", { description: "MCP fixture", version: "0.1.0" })
	.extend(jsonInput(), mcp())
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
		defineCommand(
			"whoami",
			{ description: "Show the configured token", mcp: { readOnlyHint: true } },
			(command) =>
				command
					.flags({ token: { type: "string", env: "DEMO_TOKEN", required: true } })
					.action(({ flags }) => ({ token: flags.token })),
		),
	)
	.add(defineCommand("login", { mcp: false }, (command) => command.action(() => "signed in")))
	.add(
		// Reads stdin like `--body -` would; under `mcp`, stdin carries protocol frames.
		defineCommand("slurp", { description: "Read stdin" }, (command) =>
			command.action(async ({ stdin }) => ({ text: await stdin.text() })),
		),
	);

process.exitCode = await app.execute();

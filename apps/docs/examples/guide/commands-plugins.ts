import { spawnSync } from "node:child_process";

import { Crust, unknownCommand } from "@crustjs/core";

const tool = new Crust("tool")
	.args(
		{ name: "plugin", type: "string", required: true },
		// Every word after the plugin's name is its own, flags included.
		{ name: "argv", type: "string", variadic: "passthrough" },
	)
	.command("build", (build) => build.action(({ stdout }) => stdout("building")))
	.action(({ args, command, exitCode }) => {
		const child = spawnSync(`tool-${args.plugin}`, args.argv, { stdio: "inherit" });
		// No `tool-<name>` on PATH: fail as for any unknown command, with a suggestion.
		if (child.error && "code" in child.error && child.error.code === "ENOENT") {
			throw unknownCommand(command, args.plugin);
		}
		if (child.error) throw child.error;
		exitCode(child.status ?? 1);
	});

await tool.execute();

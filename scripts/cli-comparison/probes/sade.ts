import sade from "sade";

sade("cli")
	.command("config <key>")
	.option("-v, --value", "value")
	.action((key, options) =>
		console.log(JSON.stringify({ command: "config", key, value: options.value })),
	)
	.parse(["runtime", "cli", "config", "theme", "-v", "dark"]);

import arg from "arg";

import { config, deploy, route } from "../contract.ts";
export function invoke(argv: string[]) {
	const { command, args } = route(argv);
	if (command === "config") {
		const p = arg({ "--value": String, "-v": "--value" }, { argv: args });
		return config(p._[0], p["--value"]);
	}
	const p = arg(
		{
			"--region": String,
			"-r": "--region",
			"--replicas": String,
			"-n": "--replicas",
			"--force": Boolean,
			"-f": "--force",
			"--tag": [String],
			"-t": "--tag",
		},
		{ argv: args },
	);
	return deploy(
		p._[0],
		p["--region"] ?? "us-east-1",
		p["--replicas"] ?? "1",
		p["--force"] ?? false,
		p["--tag"],
	);
}

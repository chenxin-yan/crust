import minimist from "minimist";

import { config, deploy, knownKeys, route } from "../contract.ts";
export function invoke(argv: string[]) {
	const { command, args } = route(argv);
	const p = minimist(
		args,
		command === "deploy"
			? {
					string: ["_", "region", "replicas", "tag"],
					boolean: ["force"],
					alias: { r: "region", n: "replicas", f: "force", t: "tag" },
					default: { region: "us-east-1", replicas: "1", force: false },
				}
			: { string: ["_", "value"], alias: { v: "value" } },
	);
	knownKeys(p, command);
	return command === "deploy"
		? deploy(p._[0], p.region, p.replicas, p.force, p.tag)
		: config(p._[0], p.value);
}

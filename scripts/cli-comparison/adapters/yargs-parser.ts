import parser from "yargs-parser";

import { config, deploy, knownKeys, route } from "../contract.ts";
export function invoke(argv: string[]) {
	const { command, args } = route(argv);
	const p = parser(args, {
		...(command === "deploy"
			? {
					string: ["region", "replicas", "tag"],
					boolean: ["force"],
					alias: { r: "region", n: "replicas", f: "force", t: "tag" },
				}
			: { string: ["value"], alias: { v: "value" } }),
		configuration: {
			"parse-positional-numbers": false,
			"camel-case-expansion": false,
			"greedy-arrays": false,
		},
	});
	knownKeys(p, command);
	return command === "deploy"
		? deploy(p._[0], p.region ?? "us-east-1", p.replicas ?? "1", p.force ?? false, p.tag)
		: config(p._[0], p.value);
}

import { parseArgs } from "node:util";

import { config, deploy, route } from "../contract.ts";
export function invoke(argv: string[]) {
	const { command, args } = route(argv);
	if (command === "config") {
		const p = parseArgs({
			args,
			allowPositionals: true,
			strict: true,
			options: { value: { type: "string", short: "v" } },
		});
		return config(p.positionals[0], p.values.value);
	}
	const p = parseArgs({
		args,
		allowPositionals: true,
		strict: true,
		options: {
			region: { type: "string", short: "r", default: "us-east-1" },
			replicas: { type: "string", short: "n", default: "1" },
			force: { type: "boolean", short: "f", default: false },
			tag: { type: "string", short: "t", multiple: true, default: [] },
		},
	});
	return deploy(p.positionals[0], p.values.region, p.values.replicas, p.values.force, p.values.tag);
}

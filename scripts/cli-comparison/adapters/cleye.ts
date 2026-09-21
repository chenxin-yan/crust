import { cli, command } from "cleye";

import { completed, config, deploy, type Result } from "../contract.ts";
export async function invoke(argv: string[]) {
	let result: Result | undefined;
	await cli(
		{
			name: "cli",
			help: false,
			strictFlags: true,
			commands: [
				command(
					{
						name: "deploy",
						help: false,
						parameters: ["<target>"],
						flags: {
							region: { type: String, alias: "r", default: "us-east-1" },
							replicas: { type: String, alias: "n", default: "1" },
							force: { type: Boolean, alias: "f", default: false },
							tag: { type: [String], alias: "t", default: [] },
						},
					},
					(p) => {
						result = deploy(
							p._.target,
							p.flags.region,
							p.flags.replicas,
							p.flags.force,
							p.flags.tag,
						);
					},
				),
				command(
					{
						name: "config",
						help: false,
						parameters: ["<key>"],
						flags: { value: { type: String, alias: "v" } },
					},
					(p) => {
						result = config(p._.key, p.flags.value);
					},
				),
			],
		},
		undefined,
		argv,
	);
	return completed(result);
}

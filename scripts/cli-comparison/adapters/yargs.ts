import yargs from "yargs";

import { completed, config, deploy, type Result } from "../contract.ts";
export function invoke(argv: string[]) {
	let result: Result | undefined;
	yargs()
		.scriptName("cli")
		.exitProcess(false)
		.help(false)
		.version(false)
		.strict()
		.demandCommand(1)
		.parserConfiguration({ "parse-positional-numbers": false, "greedy-arrays": false })
		.command(
			"deploy <target>",
			"deploy",
			(y) =>
				y
					.positional("target", { type: "string", demandOption: true })
					.option("region", { type: "string", alias: "r", default: "us-east-1", requiresArg: true })
					.option("replicas", { type: "string", alias: "n", default: "1", requiresArg: true })
					.option("force", { type: "boolean", alias: "f", default: false })
					.option("tag", {
						type: "string",
						array: true,
						alias: "t",
						default: [],
						requiresArg: true,
					}),
			(p) => {
				result = deploy(p.target, p.region, p.replicas, p.force, p.tag);
			},
		)
		.command(
			"config <key>",
			"config",
			(y) =>
				y
					.positional("key", { type: "string", demandOption: true })
					.option("value", { type: "string", alias: "v", requiresArg: true }),
			(p) => {
				result = config(p.key, p.value);
			},
		)
		.parseSync(argv);
	return completed(result);
}

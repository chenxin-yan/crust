import { Command } from "commander";

import { completed, config, deploy, type Result } from "../contract.ts";
export function invoke(argv: string[]) {
	let result: Result | undefined;
	const app = new Command("cli").exitOverride();
	app
		.command("deploy <target>")
		.option("-r, --region <text>", "region", "us-east-1")
		.option("-n, --replicas <number>", "replicas", "1")
		.option("-f, --force", "force", false)
		.option(
			"-t, --tag <text>",
			"tag",
			(value: string, previous: string[]) => [...previous, value],
			[],
		)
		.action((target, options) => {
			result = deploy(target, options.region, options.replicas, options.force, options.tag);
		});
	app
		.command("config <key>")
		.option("-v, --value <text>")
		.action((key, options) => {
			result = config(key, options.value);
		});
	app.parse(argv, { from: "user" });
	return completed(result);
}

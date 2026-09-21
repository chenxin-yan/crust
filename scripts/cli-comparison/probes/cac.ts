import { cac } from "cac";

cac("cli")
	.command("deploy <target>")
	.option("--region <text>", "region")
	.option("--tag <text>", "tag", { type: [String] })
	.action((target, options) =>
		console.log(JSON.stringify({ target, region: options.region, tag: options.tag })),
	)
	.cli.parse(["runtime", "cli", "deploy", "api", "--region", "001", "--tag", "002"]);

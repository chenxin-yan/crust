import { Crust } from "@crustjs/core";

import { completed, config, deploy, type Result } from "../contract.ts";
export async function invoke(argv: string[]) {
	let result: Result | undefined;
	const app = new Crust("cli")
		.command("deploy", (c) =>
			c
				.args({ name: "target", type: "string", required: true })
				.flags(
					{ name: "region", type: "string", short: "r", default: "us-east-1" },
					{ name: "replicas", type: "string", short: "n", default: "1" },
					{ name: "force", type: "boolean", short: "f", default: false },
					{ name: "tag", type: "string", short: "t", multiple: true, default: [] },
				)
				.action(({ args, flags }) => {
					result = deploy(args.target, flags.region, flags.replicas, flags.force, flags.tag);
				}),
		)
		.command("config", (c) =>
			c
				.args({ name: "key", type: "string", required: true })
				.flags({ name: "value", type: "string", short: "v" })
				.action(({ args, flags }) => {
					result = config(args.key, flags.value);
				}),
		);
	if ((await app.execute({ argv })) !== 0) throw new Error("Crust command failed");
	return completed(result);
}

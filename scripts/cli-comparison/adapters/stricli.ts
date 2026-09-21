import { buildApplication, buildCommand, buildRouteMap, run } from "@stricli/core";

import { completed, config, deploy, type Result } from "../contract.ts";
export async function invoke(argv: string[]) {
	let result: Result | undefined;
	const d = buildCommand({
		func: (
			flags: { region: string; replicas: string; force: boolean; tag?: string[] },
			target: string,
		) => {
			result = deploy(target, flags.region, flags.replicas, flags.force, flags.tag);
		},
		parameters: {
			flags: {
				region: { kind: "parsed", parse: String, brief: "region", default: "us-east-1" },
				replicas: { kind: "parsed", parse: String, brief: "replicas", default: "1" },
				force: { kind: "boolean", brief: "force", default: false },
				tag: { kind: "parsed", parse: String, brief: "tag", variadic: true, optional: true },
			},
			aliases: { r: "region", n: "replicas", f: "force", t: "tag" },
			positional: { kind: "tuple", parameters: [{ parse: String, brief: "target" }] },
		},
		docs: { brief: "deploy" },
	});
	const c = buildCommand({
		func: (flags: { value?: string }, key: string) => {
			result = config(key, flags.value);
		},
		parameters: {
			flags: { value: { kind: "parsed", parse: String, brief: "value", optional: true } },
			aliases: { v: "value" },
			positional: { kind: "tuple", parameters: [{ parse: String, brief: "key" }] },
		},
		docs: { brief: "config" },
	});
	const app = buildApplication(
		buildRouteMap({ routes: { deploy: d, config: c }, docs: { brief: "cli" } }),
		{ name: "cli" },
	);
	await run(app, argv, { process });
	return completed(result);
}

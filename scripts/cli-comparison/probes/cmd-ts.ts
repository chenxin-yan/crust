import { command, option, optional, runSafely, string } from "cmd-ts";

const results = [];
for (const argv of [[], ["--region="], ["--region"], ["--value="], ["--value"]]) {
	const app = command({
		name: "cli",
		args: {
			region: option({ type: string, long: "region", defaultValue: () => "us-east-1" }),
			value: option({ type: optional(string), long: "value" }),
		},
		handler: (p) => ({ region: p.region, value: p.value ?? null }),
	});
	results.push({ argv, result: await runSafely(app, argv) });
}
console.log(JSON.stringify(results));

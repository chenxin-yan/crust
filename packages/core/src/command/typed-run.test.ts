import { describe, expect, it } from "bun:test";

import type { StandardSchema } from "@crustjs/utils/schema";

import { Crust, defineCommand } from "./crust.ts";

describe("typed programmatic invocation", () => {
	it("serializes structured input through routing and the parser", async () => {
		let received: unknown;
		const remoteAdd = defineCommand("remote-add", (command) =>
			command
				.args(
					{ name: "name", type: "string", required: true },
					{ name: "count", type: "number", required: true },
					{ name: "files", type: "string", variadic: true },
				)
				.flags(
					{ name: "fetch", type: "boolean" },
					{ name: "tag", type: "string", multiple: true },
					{ name: "config", type: "json" },
				)
				.action(({ args, flags, rawArgs }) => {
					received = { args, flags, rawArgs };
				}),
		);
		const app = new Crust("git").add(remoteAdd);

		await app.run(["remote-add"], {
			args: { name: "origin", count: 2, files: ["a.ts", "b.ts"] },
			flags: { fetch: true, tag: ["one", "two"], config: { force: true } },
			raw: ["--literal"],
		});

		expect(received).toEqual({
			args: { name: "origin", count: 2, files: ["a.ts", "b.ts"] },
			flags: { fetch: true, tag: ["one", "two"], config: { force: true } },
			rawArgs: ["--literal"],
		});
	});

	it("preserves command aliases and pre-parse input types", () => {
		const rawNumber: StandardSchema<string | undefined, number> = {
			"~standard": {
				version: 1,
				vendor: "test",
				validate: (value) => ({ value: Number(value) }),
			},
		};
		const deploy = defineCommand("deploy", { aliases: ["ship"] }, (command) =>
			command
				.args({ name: "port", schema: rawNumber })
				.flags(
					{ name: "mode", type: "string", choices: ["dev", "prod"], required: true },
					{ name: "retries", type: "string", parse: Number },
				)
				.action(() => {}),
		);
		const app = new Crust("cli").add(deploy);

		void app.run(["ship"], { args: { port: "8080" }, flags: { mode: "prod", retries: "2" } });
		if (false) {
			// @ts-expect-error -- unknown command path
			void app.run(["deply"]);
			// @ts-expect-error -- required mode flag is missing
			void app.run(["deploy"], { args: { port: "8080" } });
			// @ts-expect-error -- unknown argument name
			void app.run(["deploy"], { args: { port: "8080", host: "localhost" }, flags: { mode: "dev" } });
			// @ts-expect-error -- choices remain a literal union
			void app.run(["deploy"], { flags: { mode: "staging" } });
		}
		expect(true).toBe(true);
	});
});

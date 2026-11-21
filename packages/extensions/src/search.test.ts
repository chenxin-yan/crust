import { Crust, defineCommand } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { describe, expect, it } from "vite-plus/test";

import { help } from "./help.ts";
import { json } from "./json.ts";
import { search } from "./search.ts";

function buildCli() {
	return new Crust("acme", { description: "Acme CLI" }).extend(search(), help()).add(
		defineCommand("keys", { description: "Manage API keys" }, (cmd) =>
			cmd.add(
				defineCommand("rotate", { description: "Rotate an API key" }, (sub) =>
					sub.action(() => {}),
				),
				defineCommand("list", (sub) => sub.action(() => {})),
			),
		),
		defineCommand("deploy", { description: "Deploy the app" }, (cmd) => cmd.action(() => {})),
		defineCommand("internal", { hidden: true, description: "Rotate the secret" }, (cmd) =>
			cmd.add(
				defineCommand("secret", { description: "Rotate the secret" }, (sub) =>
					sub.action(() => {}),
				),
			),
		),
	);
}

describe("search", () => {
	it("prints the best matches for people, best first", async () => {
		const { stdout, stderr, exitCode } = await captureExecute(buildCli(), [
			"search",
			"rotate api key",
		]);

		expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
		expect(stdout).toBe(
			[
				"acme keys rotate  Rotate an API key",
				"acme keys         Manage API keys",
				"acme keys list",
			].join("\n"),
		);
	});

	it("prints only the matches as JSON under --json, groups and itself included", async () => {
		const app = buildCli().extend(json());
		const { stdout, stderr, exitCode } = await captureExecute(app, [
			"search",
			"find",
			"keys",
			"--json",
		]);

		expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
		expect(JSON.parse(stdout)).toEqual([
			{ command: "acme keys", description: "Manage API keys", hasAction: false },
			{ command: "acme keys rotate", description: "Rotate an API key", hasAction: true },
			{ command: "acme keys list", hasAction: true },
			{
				command: "acme search",
				description: "Find the commands that best match a task described in words",
				hasAction: true,
			},
		]);
	});

	it("returns no matches and exits 0 when nothing matches, hidden commands included", async () => {
		const plain = await captureExecute(buildCli(), ["search", "secret"]);
		expect(plain).toMatchObject({ stdout: 'No command matches "secret".', exitCode: 0 });

		const app = buildCli().extend(json());
		const data = await captureExecute(app, ["search", "secret", "--json"]);
		expect(data).toMatchObject({ stdout: "[]", stderr: "", exitCode: 0 });
	});

	it("publishes the match array as the command's output schema", async () => {
		const snapshot = await buildCli().snapshot();

		expect(snapshot.subCommands.search?.outputSchema).toMatchObject({
			type: "array",
			items: { type: "object", required: ["command", "hasAction"] },
		});
	});

	it("tells people about itself in the root help", async () => {
		const { stdout } = await captureExecute(buildCli(), ["--help"]);

		expect(stdout).toContain("Find a command");
		expect(stdout).toContain('acme search "<task>"');
	});
});

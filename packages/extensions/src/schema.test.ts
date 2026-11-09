import { Crust, CrustError, defineCommand } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { describe, expect, it } from "vite-plus/test";

import { help } from "./help.ts";
import { input } from "./input.ts";
import { json } from "./json.ts";
import { schema } from "./schema.ts";

const deployResult = {
	type: "object",
	properties: { id: { type: "string" } },
	required: ["id"],
};

/** A Standard Schema whose `jsonSchema.output` returns `json`, or throws when `json` is an Error. */
function outputSchema(json: Record<string, unknown> | Error) {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate: (value: unknown) => ({ value: value as { id: string } }),
			jsonSchema: {
				input: () => ({}),
				output: () => {
					if (json instanceof Error) throw json;
					return json;
				},
			},
		},
	} as const;
}

function buildCli() {
	return new Crust("mycli", { description: "Test CLI" })
		.extend(schema(), help())
		.add(
			defineCommand("deploy", { description: "Deploy the app" }, (cmd) =>
				cmd
					.args({
						name: "target",
						type: "string",
						required: true,
						description: "Where to deploy",
						choices: ["staging", "production"],
					})
					.flags({
						force: { type: "boolean", short: "f", description: "Skip checks", default: false },
						tag: { type: "string", multiple: true, env: { name: "DEPLOY_TAG" } },
					})
					.output(outputSchema(deployResult))
					.action(() => ({ id: "dep_1" })),
			),
			defineCommand("remote", { description: "Manage remotes" }, (cmd) =>
				cmd.add(
					defineCommand("add", { aliases: ["new"] }, (sub) =>
						sub
							.args({ name: "url", type: "url", required: true })
							.output(outputSchema(new Error("cannot convert")))
							.action(() => ({ id: "r" })),
					),
				),
			),
			defineCommand("internal", { hidden: true }, (cmd) => cmd.action(() => {})),
		)
		.action(() => {});
}

describe("schema", () => {
	it("prints a command's input and output JSON Schema", async () => {
		const { stdout, stderr, exitCode } = await captureExecute(buildCli(), ["schema", "deploy"]);

		expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
		expect(JSON.parse(stdout)).toEqual({
			input: {
				type: "object",
				properties: {
					target: {
						type: "string",
						enum: ["staging", "production"],
						description: "Where to deploy",
					},
					force: { type: "boolean", description: "Skip checks", default: false },
					tag: {
						type: "array",
						items: { type: "string" },
						description: "Falls back to $DEPLOY_TAG",
					},
					raw: {
						type: "array",
						items: { type: "string" },
						description: "Passthrough values, received as `rawArgs`; they never fill arguments",
					},
				},
				required: ["target"],
			},
			output: deployResult,
		});
	});

	it("omits output when the schema cannot produce JSON Schema, and resolves aliases", async () => {
		const { stdout } = await captureExecute(buildCli(), ["schema", "remote", "new"]);

		expect(JSON.parse(stdout)).toEqual({
			input: {
				type: "object",
				properties: {
					url: { type: "string", format: "uri" },
					raw: expect.any(Object),
				},
				required: ["url"],
			},
		});
	});

	it("describes the root command without a path", async () => {
		const { stdout } = await captureExecute(buildCli(), ["schema"]);

		expect(Object.keys(JSON.parse(stdout))).toEqual(["input"]);
		// Extension flags such as --help and --llms are no command input.
		expect(Object.keys(JSON.parse(stdout).input.properties)).toEqual(["raw"]);
	});

	it("returns the schema as the run() result", async () => {
		const outcome = await buildCli().run(["schema"], { args: { path: ["remote", "add"] } });

		expect(outcome.status).toBe("completed");
		expect(outcome.status === "completed" && outcome.result).toMatchObject({
			input: { required: ["url"] },
		});
	});

	it("fails with COMMAND_NOT_FOUND naming an unknown path", async () => {
		const outcome = await buildCli().run(["schema"], { args: { path: ["remote", "ad", "x"] } });

		expect(outcome.status).toBe("failed");
		const error = outcome.status === "failed" ? outcome.error : undefined;
		expect(error).toBeInstanceOf(CrustError);
		expect(error).toMatchObject({
			code: "COMMAND_NOT_FOUND",
			message: 'Unknown command "remote ad".',
			details: { input: "ad", available: ["add"], commandPath: ["mycli", "remote"] },
		});
		expect(await captureExecute(buildCli(), ["schema", "nope"])).toEqual({
			stdout: "",
			stderr: 'Error: Unknown command "nope".',
			exitCode: 1,
		});
	});

	it("--llms prints a Markdown index of every visible command", async () => {
		const { stdout, stderr, exitCode } = await captureExecute(buildCli(), ["--llms"]);

		expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
		expect(stdout).toBe(
			[
				"# mycli",
				"",
				"## `mycli [options]`",
				"",
				"Test CLI",
				"",
				"Flags:",
				"",
				"- `-h`, `--help` (boolean): Show help",
				"- `--llms` (boolean): Print a Markdown index of all commands for LLMs",
				"",
				"## `mycli deploy <target> [options]`",
				"",
				"Deploy the app",
				"",
				"Arguments:",
				"",
				"- `<target>` (string): Where to deploy [choices: staging, production]",
				"",
				"Flags:",
				"",
				"- `-f`, `--force`, `--no-force` (boolean): Skip checks [default: false]",
				"- `--tag` (string, multiple): [env: DEPLOY_TAG]",
				"- `-h`, `--help` (boolean): Show help",
				"",
				"## `mycli remote <command> [options]`",
				"",
				"Manage remotes",
				"",
				"Flags:",
				"",
				"- `-h`, `--help` (boolean): Show help",
				"",
				"## `mycli remote add <url> [options]`",
				"",
				"Arguments:",
				"",
				"- `<url>` (url)",
				"",
				"Flags:",
				"",
				"- `-h`, `--help` (boolean): Show help",
				"",
				"## `mycli schema [path...] [options]`",
				"",
				"Print a command's input and output JSON Schema",
				"",
				"Arguments:",
				"",
				"- `[path...]` (string): Command path, e.g. `remote add`; omit for the root command",
				"",
				"Flags:",
				"",
				"- `-h`, `--help` (boolean): Show help",
			].join("\n"),
		);
	});

	it("--llms renders each listed command's sections visible to schema() after its flags", async () => {
		const schemaExtension = schema();
		const cli = new Crust("mycli", {
			sections: [
				{ title: "Auth", body: "Set MYCLI_TOKEN." },
				{ title: "Not for schema", body: "Help only.", except: [schemaExtension] },
			],
		})
			.extend(schemaExtension, json(), input())
			.add(
				defineCommand(
					"deploy",
					{ sections: [{ title: "Safety", body: "Run preview first." }] },
					(cmd) => cmd.action(() => {}),
				),
				defineCommand(
					"internal",
					{ hidden: true, sections: [{ title: "Secret", body: "Hidden body." }] },
					(cmd) => cmd.action(() => {}),
				),
			)
			.action(() => {});

		const { stdout } = await captureExecute(cli, ["--llms"]);
		const [root, deploy] = stdout.split("\n## ").slice(1);

		expect(root).toMatch(
			/- `--llms` [^\n]*\n\n### Auth\n\nSet MYCLI_TOKEN\.\n\n### JSON output\n\n--json [^\n]*\n\n### JSON input\n\n--input [^\n]*\n$/,
		);
		expect(deploy).toMatch(/\n\n### Safety\n\nRun preview first\.\n$/);
		expect(stdout).not.toContain("Not for schema");
		expect(stdout).not.toContain("Secret");
	});

	it("--llms places an afterDoubleDash argument after --", async () => {
		const app = new Crust("mono")
			.extend(schema())
			.add(
				defineCommand("run", (cmd) =>
					cmd
						.args(
							{ name: "task", type: "string", required: true },
							{ name: "extra", type: "string", variadic: true, afterDoubleDash: true },
						)
						.action(() => {}),
				),
			);
		const { stdout } = await captureExecute(app, ["--llms"]);
		expect(stdout).toContain("## `mono run <task> [-- <extra>...]`");
		expect(stdout).toContain("- `[-- <extra>...]` (string)");
	});

	it("--llms is root-only", async () => {
		const { exitCode, stderr } = await captureExecute(buildCli(), ["deploy", "staging", "--llms"]);

		expect(exitCode).toBe(1);
		expect(stderr).toContain("--llms");
	});
});

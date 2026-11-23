// `prompts()` from `@crustjs/prompts/extension`, driven through `execute()`. It lives here, not in
// `@crustjs/prompts`: `@crustjs/testing` and `jsonInput()` depend on prompts, so prompts cannot
// depend on them for its own tests.
import { Crust } from "@crustjs/core";
import { withTerminalIO } from "@crustjs/prompts";
import { prompts } from "@crustjs/prompts/extension";
import { createPromptIO } from "@crustjs/prompts/testing";
import { captureExecute } from "@crustjs/testing";
import { runInteractive } from "@crustjs/testing/interactive";
import { describe, expect, it } from "vite-plus/test";

import { jsonInput } from "../src/json-input.ts";
import { db, deploy } from "./prompts-extension-fixture.ts";

const app = new Crust("acme")
	.extend(jsonInput(), prompts())
	.command("init", (c) =>
		c
			.args({ name: "name", type: "string", required: true, prompt: "Project name" })
			.action(({ args, stdout }) => stdout(`init ${args.name}`)),
	)
	.command("env", (c) =>
		c.command("set", (s) =>
			s
				.flags({ key: { type: "string", required: true, prompt: "Key" } })
				.action(({ flags, stdout }) => stdout(`env set ${flags.key}`)),
		),
	)
	.command("create", (c) =>
		c
			.args({ name: "name", type: "string", required: true, prompt: "Project name" })
			.flags({
				template: {
					type: "string",
					choices: ["vanilla", "vue"],
					required: true,
					prompt: "Framework",
				},
				features: {
					type: "string",
					multiple: true,
					choices: ["lint", "test", "release"],
					prompt: "Features",
				},
				tags: { type: "string", multiple: true, prompt: "Tags" },
			})
			.action(({ args, flags, stdout }) =>
				stdout(
					`name=${args.name} template=${flags.template} features=${String(flags.features)} tags=${String(flags.tags)}`,
				),
			),
	)
	.command("serve", (c) =>
		c
			.flags({
				port: { type: "number", required: true, prompt: "Port" },
				origin: { type: "url", required: true, prompt: "Origin" },
				out: { type: "path", required: true, prompt: "Output folder" },
				size: {
					type: "string",
					required: true,
					prompt: "Upload limit",
					parse: (raw) => {
						const match = /^(\d+)k$/.exec(raw);
						if (!match) throw new Error("use a number of kilobytes, such as 10k");
						return Number(match[1]) * 1024;
					},
				},
			})
			.action(({ flags, stdout }) => {
				const port: number = flags.port;
				const origin: URL = flags.origin;
				const size: number = flags.size;
				stdout(`port=${port} origin=${origin.href} out=${flags.out} size=${size}`);
			}),
	)
	.add(deploy)
	.add(db);

/** Waits for each question in turn and answers it with text and keys. */
async function answer(
	run: ReturnType<typeof runInteractive>,
	...steps: [question: RegExp, text: string, ...keys: Parameters<typeof run.keys>][]
) {
	for (const [question, text, ...keys] of steps) {
		await run.waitFor(question);
		if (text) run.type(text);
		run.keys(...keys, "return");
	}
	return run.done;
}

describe("prompts()", () => {
	it("asks for a missing argument of an inline command", async () => {
		const run = runInteractive(app, ["init"]);
		expect(await answer(run, [/Project name/, "acme"])).toEqual({
			stdout: "init acme\n",
			stderr: "",
			exitCode: 0,
		});
		expect(run.screen()).toContain("Project name acme");
	});

	it("asks for a flag of an inline command two levels deep", async () => {
		const run = runInteractive(app, ["env", "set"]);
		expect(await answer(run, [/Key/, "TOKEN"])).toMatchObject({
			stdout: "env set TOKEN\n",
			exitCode: 0,
		});
	});

	it("asks in a command from another file: a list for choices, the default preselected", async () => {
		const run = runInteractive(app, ["deploy"]);
		const result = await answer(
			run,
			[/Service/, "api"],
			[/Region/, "", "down"],
			// Enter keeps the default.
			[/Replicas/, ""],
		);
		expect(result).toMatchObject({ stdout: "deploy api region=eu replicas=1\n", exitCode: 0 });
		expect(run.screen()).toContain("Replicas 1");
	});

	it("asks in a group from another file, for an inline child and an added one", async () => {
		const reset = runInteractive(app, ["db", "reset"]);
		expect(await answer(reset, [/Drop all tables\?/, "y"])).toMatchObject({
			stdout: "db reset confirm=true\n",
			exitCode: 0,
		});
		const migrate = runInteractive(app, ["db", "migrate"]);
		expect(await answer(migrate, [/Target version/, "3"])).toMatchObject({
			stdout: "db migrate to=3\n",
			exitCode: 0,
		});
	});

	it("never asks for a value from argv or an environment variable", async () => {
		const run = runInteractive(app, ["deploy", "api", "--replicas", "2"], {
			env: { ...process.env, DEPLOY_REGION: "ap" },
		});
		expect(await run.done).toEqual({
			stdout: "deploy api region=ap replicas=2\n",
			stderr: "",
			exitCode: 0,
		});
		expect(run.screen()).toBe("");
	});

	it("takes --input values without asking, and asks for the rest", async () => {
		const run = runInteractive(app, ["create", "--input", '{"name":"from-json"}']);
		const result = await answer(run, [/Framework/, "", "down"], [/Features/, "", "space"]);
		expect(result).toMatchObject({
			stdout: "name=from-json template=vue features=lint tags=undefined\n",
			exitCode: 0,
		});
		expect(run.screen()).not.toContain("Project name");
	});

	it("picks several values for a list with choices, and asks nothing for a list without", async () => {
		const run = runInteractive(app, ["create", "web", "--template", "vanilla"]);
		const result = await answer(run, [/Features/, "", "space", "down", "space"]);
		expect(result).toMatchObject({
			stdout: "name=web template=vanilla features=lint,test tags=undefined\n",
			exitCode: 0,
		});
		expect(run.screen()).not.toContain("Tags");
	});

	const serveFlags = {
		port: ["--port", "80"],
		origin: ["--origin", "https://example.com"],
		out: ["--out", "/srv/www"],
		size: ["--size", "1k"],
	};
	it.each([
		["port", /Port/, "eighty", "Expected a number for --port.", "8080", "port=8080"],
		[
			"origin",
			/Origin/,
			"example.com",
			"Invalid URL for --origin (missing protocol — e.g. https://example.com).",
			"https://api.example.com",
			"origin=https://api.example.com/",
		],
		["out", /Output folder/, "", "Path for --out cannot be empty", "/tmp/site", "out=/tmp/site"],
		["size", /Upload limit/, "big", "use a number of kilobytes, such as 10k", "10k", "size=10240"],
	] as const)(
		"shows the command line's error for a bad %s and asks again",
		async (flag, question, bad, error, good, expected) => {
			const others = Object.entries(serveFlags).flatMap(([name, argv]) =>
				name === flag ? [] : argv,
			);
			const run = runInteractive(app, ["serve", ...others]);
			await run.waitFor(question);
			run.type(bad);
			run.keys("return");
			await run.waitFor(new RegExp(RegExp.escape(error)));
			// The rejected text stays in the field.
			run.keys(...Array.from(bad, () => "backspace" as const));
			run.type(good);
			run.keys("return");
			const result = await run.done;
			expect(result).toMatchObject({ exitCode: 0, stderr: "" });
			expect(result.stdout).toContain(expected);
		},
	);

	it("leaves a missing value to the command's own error without a terminal", async () => {
		expect(await captureExecute(app, ["env", "set"])).toEqual({
			stdout: "",
			stderr: 'Error: Missing required flag "--key"\n',
			exitCode: 2,
		});
	});

	it("never asks under typed run(), even inside a terminal scope", async () => {
		const outcome = await withTerminalIO(createPromptIO().io, () => app.run(["db", "reset"]));
		expect(outcome).toMatchObject({ status: "completed", stdout: "db reset confirm=false" });
	});
});

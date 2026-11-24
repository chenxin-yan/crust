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
					required: true,
					prompt: "Features",
				},
				tags: { type: "string", multiple: true, prompt: "Tags" },
				verbose: { type: "boolean", multiple: true, prompt: "Verbose?" },
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
	.command("new", (c) =>
		c
			.args(
				{ name: "name", type: "string", default: "my-app", prompt: "Project name" },
				{ name: "dir", type: "string", prompt: "Directory" },
				// A variadic argument's default is one word.
				{
					name: "targets",
					type: "string",
					variadic: true,
					choices: ["web", "api"],
					default: "api",
					prompt: "Targets",
				},
			)
			.flags({
				template: {
					type: "string",
					choices: ["vanilla", "vue"],
					default: "vue",
					prompt: "Framework",
				},
				features: {
					type: "string",
					multiple: true,
					choices: ["lint", "test"],
					// Out of choice order: Enter keeps it as declared.
					default: ["test", "lint"],
					prompt: "Features",
				},
				git: { type: "boolean", default: true, prompt: "Use git?" },
				description: { type: "string", prompt: "Description" },
				config: { type: "json", default: { enabled: true }, prompt: "Config" },
			})
			.action(({ args, flags, stdout }) =>
				stdout(
					`name=${args.name} dir=${args.dir} targets=${String(args.targets)} template=${flags.template} features=${String(flags.features)} git=${flags.git} description=${flags.description} config=${JSON.stringify(flags.config)}`,
				),
			),
	)
	.command("copy", (c) =>
		c
			.args({ name: "from", type: "string" }, { name: "to", type: "string", prompt: "Destination" })
			.action(({ args, stdout }) => stdout(`copy ${args.from} ${args.to}`)),
	)
	.command("exec", (c) =>
		c
			.args(
				{ name: "files", type: "string", variadic: true },
				{
					name: "command",
					type: "string",
					variadic: "afterDoubleDash",
					choices: ["lint", "test"],
					prompt: "Command",
				},
			)
			.action(({ args, stdout }) =>
				stdout(`exec ${String(args.files)} -- ${String(args.command)}`),
			),
	)
	.command("rename", (c) =>
		c
			.args(
				{ name: "prefix", type: "string", default: "", prompt: "Prefix" },
				{ name: "name", type: "string", prompt: "Name" },
			)
			.action(({ args, stdout }) => stdout(`rename prefix=${args.prefix} name=${args.name}`)),
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
		expect(run.screen()).not.toContain("Verbose?");
	});

	it("keeps every default on Enter, and leaves an optional value without one unset", async () => {
		const run = runInteractive(app, ["new"]);
		const result = await answer(
			run,
			[/Project name/, ""],
			// A later positional follows the kept default.
			[/Directory/, "out"],
			[/Targets/, ""],
			[/Framework/, ""],
			[/Features/, ""],
			[/Use git\?/, ""],
			[/Description/, ""],
			[/Config/, ""],
		);
		expect(result).toMatchObject({
			stdout:
				'name=my-app dir=out targets=api template=vue features=test,lint git=true description=undefined config={"enabled":true}\n',
			stderr: "",
			exitCode: 0,
		});
		expect(run.screen()).toContain("Targets api");
	});

	it("binds an empty default kept on Enter, so a later positional is asked", async () => {
		const run = runInteractive(app, ["rename"]);
		expect(await answer(run, [/Prefix/, ""], [/Name/, "bee"])).toMatchObject({
			stdout: "rename prefix= name=bee\n",
			exitCode: 0,
		});
	});

	it("asks for no positional after an omitted one", async () => {
		const run = runInteractive(app, ["copy"]);
		expect(await run.done).toEqual({
			stdout: "copy undefined undefined\n",
			stderr: "",
			exitCode: 0,
		});
		expect(run.screen()).not.toContain("Destination");
	});

	it("asks for a list after -- even when a positional before it is omitted", async () => {
		const run = runInteractive(app, ["exec"]);
		expect(await answer(run, [/Command/, "", "space"])).toMatchObject({
			stdout: "exec  -- lint\n",
			exitCode: 0,
		});
	});

	it("refuses an empty pick for a required list and asks again", async () => {
		const run = runInteractive(app, ["create", "web", "--template", "vanilla"]);
		await run.waitFor(/Features/);
		run.keys("return");
		await run.waitFor(/At least one item must be selected/);
		run.keys("space", "return");
		expect(await run.done).toMatchObject({
			stdout: "name=web template=vanilla features=lint tags=undefined\n",
			exitCode: 0,
		});
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
		// A path takes any text but an empty one, which is refused as a required value.
		["out", /Output folder/, "", "A value is required", "/tmp/site", "out=/tmp/site"],
		["size", /Upload limit/, "big", "use a number of kilobytes, such as 10k", "10k", "size=10240"],
	] as const)(
		"shows the error for a bad %s and asks again",
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

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Crust } from "@crustjs/core";
import { expect, it } from "vite-plus/test";

import { database } from "../examples/guide/contexts-setup";
import { app as extensionsExample } from "../examples/modules/extensions/index";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

it("the disposable Context example cleans up after success and failure", async () => {
	for (const fail of [false, true]) {
		const app = new Crust("work").provide(database()).action(async ({ ctx, stdout }) => {
			const db = await ctx.database;
			if (fail) throw new Error("query failed");
			stdout(db.query("select 1"));
		});
		const outcome = await app.run([]);
		expect(outcome.status).toBe(fail ? "failed" : "completed");
		expect(outcome.stdout.trim()).toBe(
			fail ? "database opened\ndatabase closed" : "database opened\nselect 1: ok\ndatabase closed",
		);
	}
});

it("extensions example prints the version for `--version` on the actionless root", async () => {
	const outcome = await extensionsExample.run([], { flags: { version: true } });
	expect(outcome).toMatchObject({ status: "handled", by: "crust:version" });
	expect(outcome.stdout.trim()).toBe("my-cli v0.2.0");
});

it.each([
	["validate", 1, "", 'Error: Missing required flag "--name"\n'],
	[
		"cleanup",
		1,
		"",
		"Error: Deployment service is unavailable. Try again later.\nClosed database\n",
	],
	["config", 1, "", "Error: No app.config.json found. Run `app init` to create one.\n"],
	["cancel", 130, "", ""],
	["inspect", 0, "No app.config.json found. Run `app init` to create one.\n", ""],
])(
	"error-handling example %s prints only its own diagnostics",
	(scenario, exitCode, stdout, stderr) => {
		const result = spawnSync(
			"bun",
			[fileURLToPath(new URL("../examples/guide/error-handling.ts", import.meta.url)), scenario],
			{ encoding: "utf8", timeout: 10_000 },
		);
		expect(result.error).toBeUndefined();
		expect(result.status).toBe(exitCode);
		expect(result.stdout).toBe(stdout);
		expect(result.stderr).toBe(stderr);
	},
);

it.each([
	[
		["deploy", "--input", '{"target":"staging","release":"v2"}'],
		0,
		"Deploying v2 to staging\n",
		"Next steps:\n  Watch the rollout:\n    my-cli status staging\n",
	],
	[
		["deploy", "staging", "--json"],
		0,
		'{"target":"staging","release":"latest","dryRun":false}\n',
		"Deploying latest to staging\nNext steps:\n  Watch the rollout:\n    my-cli status staging\n",
	],
	[
		["status", "prod", "--json"],
		0,
		'{"type":"event","data":{"step":"build"}}\n{"type":"event","data":{"step":"ship"}}\n{"type":"result","data":{"target":"prod","healthy":true}}\n',
		"build: done\nship: done\n",
	],
	[["deploy", "prod", "--dry-run"], 0, "Would deploy latest to prod\n", ""],
	[
		["deploy", "prod"],
		1,
		"",
		"Error: Confirmation required: Deploy latest to prod? Pass --yes to confirm.\n",
	],
	[
		["deploy", "prod", "--yes"],
		0,
		"Deploying latest to prod\n",
		"Next steps:\n  Watch the rollout:\n    my-cli status prod\n",
	],
	[["init"], 1, "", "Error: Prompts require an interactive terminal (TTY).\n"],
	[["init", "--name", "demo"], 0, "Created demo in us-east-1\n", ""],
])("agents guide example %j prints what the guide shows", (argv, exitCode, stdout, stderr) => {
	const result = spawnSync(
		"bun",
		[fileURLToPath(new URL("../examples/guide/agents.ts", import.meta.url)), ...argv],
		{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000 },
	);
	expect(result.error).toBeUndefined();
	expect(result.status).toBe(exitCode);
	expect(result.stdout).toBe(stdout);
	expect(result.stderr).toBe(stderr);
});

it("commands guide sections example prints what the guide shows", async () => {
	const result = spawnSync(
		"bun",
		[
			fileURLToPath(new URL("../examples/guide/commands-sections.ts", import.meta.url)),
			"deploy",
			"--help",
		],
		{ encoding: "utf8", timeout: 10_000 },
	);
	const guide = await read("../content/docs/guide/commands.mdx");
	expect(result.status).toBe(0);
	expect(guide).toContain(`$ my-cli deploy --help\n${result.stdout}\`\`\``);
});

it("error-handling example reports an unreadable config as is, not as missing", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "crust-docs-"));
	try {
		await mkdir(join(cwd, "app.config.json"));
		const result = spawnSync(
			"bun",
			[fileURLToPath(new URL("../examples/guide/error-handling.ts", import.meta.url)), "config"],
			{ cwd, encoding: "utf8", timeout: 10_000 },
		);
		expect(result.status).toBe(1);
		expect(result.stderr).toMatch(/^Error: EISDIR/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

it("build guide example names its root after the guide's `bin` launcher", async () => {
	const example = await read("../examples/guide/build.ts");
	const guide = await read("../content/docs/guide/build-and-distribution.mdx");
	const rootName = /new Crust\("([^"]+)"\)/.exec(example)?.[1];
	const launcher = /node \.crust\/root\/bin\/([^.\s]+)\.js origin/.exec(guide)?.[1];
	expect(launcher).toBeDefined();
	expect(rootName).toBe(launcher);
});

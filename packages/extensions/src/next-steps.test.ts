import { type AnyCrust, Crust, CrustError, defineCommand, defineContext } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { describe, expect, it } from "vite-plus/test";

import { help } from "./help.ts";
import { type NextStepsOptions, nextSteps } from "./next-steps.ts";

class NotLoggedInError extends Error {}

/** POSIX shell word splitting for the single-quoted lines nextSteps() prints. */
function shellWords(line: string): string[] {
	const words: string[] = [];
	let word: string | undefined;
	for (let i = 0; i < line.length; i++) {
		const char = line[i]!;
		if (char === " ") {
			if (word !== undefined) words.push(word);
			word = undefined;
		} else if (char === "'") {
			const end = line.indexOf("'", i + 1);
			word = (word ?? "") + line.slice(i + 1, end);
			i = end;
		} else if (char === "\\") {
			word = (word ?? "") + line[++i];
		} else {
			word = (word ?? "") + char;
		}
	}
	if (word !== undefined) words.push(word);
	return words;
}

/** Runs each printed step line, `  app …`, and expects it to succeed. */
async function replay(app: AnyCrust, lines: readonly string[]) {
	for (const line of lines) {
		expect(await captureExecute(app, shellWords(line.trim()).slice(1)), line).toMatchObject({
			exitCode: 0,
		});
	}
}

const status = defineCommand("status", (cmd) =>
	cmd.args({ name: "env", type: "string" }).action(() => {}),
);
const logs = defineCommand("logs", (cmd) => cmd.action(() => {}));
const login = defineCommand("login", (cmd) =>
	cmd.flags({ sso: { type: "boolean" } }).action(({ stdout }) => stdout("logged in")),
);
const deploy = defineCommand("deploy", (cmd) =>
	cmd
		.use(nextSteps)
		.args({ name: "env", type: "string", required: true })
		.flags({ fail: { type: "boolean" } })
		.action(async ({ args, flags, ctx }) => {
			const next = await ctx.nextSteps;
			next.add(status, { args: { env: args.env } }, "Check the deployment");
			next.add(logs);
			if (flags.fail) throw new NotLoggedInError("not logged in");
			return { env: args.env };
		}),
);

function appWith(options?: NextStepsOptions) {
	return new Crust("app").extend(nextSteps(options)).add(deploy, status, logs, login);
}

const recovery: NextStepsOptions = {
	onError: (error) =>
		error instanceof NotLoggedInError
			? [{ command: login, input: { flags: { sso: true } }, description: "Log in" }]
			: undefined,
};

describe("nextSteps", () => {
	it("prints the steps the action added on stderr after it completes", async () => {
		expect(await captureExecute(appWith(), ["deploy", "prod"])).toEqual({
			stdout: "",
			stderr: "Next steps:\n  Check the deployment:\n    app status prod\n  app logs\n",
			exitCode: 0,
		});
	});

	it("prints nothing when no step was added", async () => {
		expect(await captureExecute(appWith(), ["login"])).toEqual({
			stdout: "logged in\n",
			stderr: "",
			exitCode: 0,
		});
	});

	it("prints onError steps first, then the action's, after the default error line", async () => {
		expect(await captureExecute(appWith(recovery), ["deploy", "prod", "--fail"])).toEqual({
			stdout: "",
			stderr:
				"Error: not logged in\nNext steps:\n  Log in:\n    app login --sso\n  Check the deployment:\n    app status prod\n  app logs\n",
			exitCode: 1,
		});
	});

	it("prints only the action's steps when onError returns undefined", async () => {
		const { stderr } = await captureExecute(appWith({ onError: () => undefined }), [
			"deploy",
			"prod",
			"--fail",
		]);

		expect(stderr).toBe(
			"Error: not logged in\nNext steps:\n  Check the deployment:\n    app status prod\n  app logs\n",
		);
	});

	it("passes onError the thrown object and suggests steps after a validation failure", async () => {
		const seen: unknown[] = [];
		const app = appWith({
			onError: (error) => {
				seen.push(error);
				return [{ command: deploy, input: { args: { env: "staging" } } }];
			},
		});

		const { stderr, exitCode } = await captureExecute(app, ["deploy"]);

		expect(exitCode).toBe(2);
		expect(stderr).toMatch(/^Error: .*\nNext steps:\n {2}app deploy staging\n$/);
		expect(seen).toHaveLength(1);
	});

	it("suggests steps after a Context setup failure", async () => {
		const broken = defineContext("broken").setup((): string => {
			throw new Error("setup failed");
		});
		const doctor = defineCommand("doctor", (cmd) => cmd.action(() => {}));
		const app = new Crust("app")
			.provide(broken())
			.extend(nextSteps({ onError: () => [{ command: doctor }] }))
			.add(doctor)
			.command("run", (cmd) => cmd.use(broken).action(async ({ ctx }) => void (await ctx.broken)));

		expect(await captureExecute(app, ["run"])).toEqual({
			stdout: "",
			stderr: "Error: setup failed\nNext steps:\n  app doctor\n",
			exitCode: 1,
		});
	});

	it("prints nothing when a flag handler takes over", async () => {
		const { stderr, exitCode } = await captureExecute(appWith().extend(help()), [
			"deploy",
			"--help",
		]);

		expect(exitCode).toBe(0);
		expect(stderr).toBe("");
	});

	it("renders flags, booleans, repeated values, and positionals as a quoted command line", async () => {
		const copy = defineCommand("copy", (cmd) =>
			cmd
				.args(
					{ name: "from", type: "string", required: true },
					{ name: "to", type: "string", variadic: true },
				)
				.flags({
					message: { type: "string" },
					count: { type: "number" },
					tag: { type: "string", multiple: true },
					force: { type: "boolean" },
					cache: { type: "boolean", negatable: true },
					quiet: { type: "boolean" },
					verbose: { type: "count" },
					meta: { type: "json" },
					offset: { type: "number" },
					url: { type: "url" },
				})
				.action(() => {}),
		);
		const exec = defineCommand("exec", (cmd) =>
			cmd.args({ name: "command", type: "string", variadic: "passthrough" }).action(() => {}),
		);
		const seek = defineCommand("seek", (cmd) =>
			cmd.args({ name: "at", type: "number" }).action(() => {}),
		);
		const app = new Crust("app")
			.extend(nextSteps())
			.add(copy, exec, seek)
			.command("suggest", (cmd) =>
				cmd.use(nextSteps).action(async ({ ctx }) => {
					const next = await ctx.nextSteps;
					next.add(copy, {
						args: { from: "a b.txt", to: ["it's", "c"] },
						flags: {
							message: "hello world",
							count: 3,
							tag: ["x", "y"],
							force: true,
							cache: false,
							// `false` on a flag that is not negatable has no spelling and is left out.
							quiet: false,
							verbose: 2,
							meta: { a: 1 },
							offset: -5,
							url: new URL("https://example.com/a?b=1"),
						},
					});
					next.add(exec, { args: { command: ["--watch", "src"] } });
					next.add(seek, { args: { at: -5 } });
				}),
			);

		const { stderr } = await captureExecute(app, ["suggest"]);

		expect(stderr).toBe(
			[
				"Next steps:",
				`  app copy --message 'hello world' --count 3 --tag x --tag y --force --no-cache --verbose --verbose --meta '{"a":1}' --offset=-5 --url 'https://example.com/a?b=1' 'a b.txt' 'it'\\''s' c`,
				"  app exec -- --watch src",
				"  app seek -- -5",
				"",
			].join("\n"),
		);
	});

	it("prints the path the application added a nested definition at", async () => {
		const migrate = defineCommand("migrate", (cmd) => cmd.action(() => {}));
		const db = defineCommand("db", { aliases: ["d"] }, (cmd) => cmd.add(migrate));
		const app = new Crust("app")
			.extend(nextSteps())
			.add(db)
			.command("suggest", (cmd) =>
				cmd.use(nextSteps).action(async ({ ctx }) => {
					(await ctx.nextSteps).add(migrate);
				}),
			);

		expect((await captureExecute(app, ["suggest"])).stderr).toBe("Next steps:\n  app db migrate\n");
	});

	it("skips an invalid step with a note on stderr and never fails the invocation", async () => {
		const unadded = defineCommand("nope", (cmd) => cmd.action(() => {}));
		const status = defineCommand("status", (cmd) =>
			cmd
				.args({ name: "env", type: "string" }, { name: "region", type: "string" })
				.action(() => {}),
		);
		const app = new Crust("app")
			.extend(nextSteps())
			.add(status)
			.command("suggest", (cmd) =>
				cmd.use(nextSteps).action(async ({ ctx }) => {
					const next = await ctx.nextSteps;
					next.add(unadded);
					// @ts-expect-error -- runtime regression for input the types reject.
					next.add(status, { flags: { verbose: true } });
					// @ts-expect-error -- runtime regression for input the types reject.
					next.add(status, { args: { region: "eu" } });
					// @ts-expect-error -- runtime regression for input the types reject.
					next.add(status, { args: { stage: "eu" } });
					next.add(status, { args: { env: "prod" } }, "Check prod");
				}),
			);

		expect(await captureExecute(app, ["suggest"])).toEqual({
			stdout: "",
			stderr: [
				'nextSteps(): skipped "nope": the application does not add this command',
				'nextSteps(): skipped "app status": unknown flag "--verbose"',
				'nextSteps(): skipped "app status": argument "region" follows omitted "env"',
				'nextSteps(): skipped "app status": unknown argument "stage"',
				"Next steps:",
				"  Check prod:",
				"    app status prod",
				"",
			].join("\n"),
			exitCode: 0,
		});
	});

	it("skips a step whose command fails to build while searching, with a note", async () => {
		const broken = defineCommand("broken", (): never => {
			throw new Error("recipe failed");
		});
		const unadded = defineCommand("nope", (cmd) => cmd.action(() => {}));
		const app = new Crust("app")
			.extend(nextSteps())
			.add(broken)
			.command("suggest", (cmd) =>
				cmd.use(nextSteps).action(async ({ ctx }) => {
					const next = await ctx.nextSteps;
					next.add(unadded);
					next.add(logs);
				}),
			)
			.add(logs);

		const { stderr, exitCode } = await captureExecute(app, ["suggest"]);
		expect(exitCode).toBe(0);
		expect(stderr).toBe('nextSteps(): skipped "nope": recipe failed\nNext steps:\n  app logs\n');
	});

	it("skips an onError step whose boolean flag value is not a boolean", async () => {
		const app = appWith({
			onError: () => [
				{ command: login, input: { flags: { sso: "true" } } },
				{ command: login, input: { flags: { sso: true } } },
			],
		});

		expect(await captureExecute(app, ["deploy", "prod", "--fail"])).toEqual({
			stdout: "",
			stderr: [
				"Error: not logged in",
				'nextSteps(): skipped "app login": "--sso" value is not a boolean',
				"Next steps:",
				"  app login --sso",
				"  Check the deployment:",
				"    app status prod",
				"  app logs",
				"",
			].join("\n"),
			exitCode: 1,
		});
	});

	it("skips false on a boolean flag that is not negatable but reads an environment variable or is required", async () => {
		const go = defineCommand("go", (cmd) =>
			cmd
				.flags({ cache: { type: "boolean", env: "CACHE" }, quiet: { type: "boolean" } })
				.action(() => {}),
		);
		const ship = defineCommand("ship", (cmd) =>
			cmd.flags({ sign: { type: "boolean", required: true } }).action(() => {}),
		);
		const app = new Crust("app")
			.extend(nextSteps())
			.add(go)
			.add(ship)
			.command("suggest", (cmd) =>
				cmd.use(nextSteps).action(async ({ ctx }) => {
					const next = await ctx.nextSteps;
					next.add(go, { flags: { cache: false } });
					next.add(ship, { flags: { sign: false } });
					next.add(go, { flags: { quiet: false } });
				}),
			);

		expect((await captureExecute(app, ["suggest"])).stderr).toBe(
			[
				'nextSteps(): skipped "app go": "--cache" false has no spelling, and its environment variable may set it',
				'nextSteps(): skipped "app ship": "--sign" false has no spelling, and the flag is required',
				"Next steps:",
				"  app go",
				"",
			].join("\n"),
		);
	});

	it("reports a throwing onError on stderr and still prints the action's steps", async () => {
		const app = appWith({
			onError: () => {
				throw new Error("boom");
			},
		});

		expect(await captureExecute(app, ["deploy", "prod", "--fail"])).toEqual({
			stdout: "",
			stderr:
				"Error: not logged in\nnextSteps(): onError: boom\nNext steps:\n  Check the deployment:\n    app status prod\n  app logs\n",
			exitCode: 1,
		});
	});

	it("replays each suggested command line to the input it was built from", async () => {
		const seen: unknown[] = [];
		const remove = defineCommand("delete", { aliases: ["rm"] }, (cmd) =>
			cmd.action(() => void seen.push(["delete"])),
		);
		const group = defineCommand("group", (cmd) =>
			cmd
				.args({ name: "target", type: "string" })
				.action(({ args }) => void seen.push(["group", args]))
				.add(remove),
		);
		const show = defineCommand("show", (cmd) =>
			cmd
				.args({ name: "doc", type: "json" })
				.flags({
					meta: { type: "json" },
					metas: { type: "json", multiple: true },
					tags: { type: "string", multiple: true, delimiter: "," },
				})
				.action(({ args, flags }) => void seen.push(["show", args, flags])),
		);
		const app = new Crust("app")
			.extend(nextSteps())
			.add(group, show)
			.command("suggest", (cmd) =>
				cmd.use(nextSteps).action(async ({ ctx }) => {
					const next = await ctx.nextSteps;
					next.add(group, { args: { target: "delete" } });
					next.add(group, { args: { target: "rm" } });
					next.add(show, {
						args: { doc: "123" },
						flags: { meta: "hello", metas: ["1", "x"], tags: ["a", "b"] },
					});
				}),
			);

		const { stderr } = await captureExecute(app, ["suggest"]);
		const lines = stderr.split("\n").slice(1, -1);
		expect(lines).toEqual([
			"  app group -- delete",
			"  app group -- rm",
			`  app show --meta '"hello"' --metas '"1"' --metas '"x"' --tags a --tags b '"123"'`,
		]);
		await replay(app, lines);
		expect(seen).toEqual([
			["group", { target: "delete" }],
			["group", { target: "rm" }],
			["show", { doc: "123" }, { meta: "hello", metas: ["1", "x"], tags: ["a", "b"] }],
		]);
	});

	it('prints an "afterDoubleDash" argument after --, a "passthrough" one as typed, and replays them', async () => {
		const seen: unknown[] = [];
		const run = defineCommand("run", (cmd) =>
			cmd
				.args(
					{ name: "task", type: "string" },
					{ name: "pkgs", type: "string", variadic: true },
					{ name: "extra", type: "string", variadic: "afterDoubleDash" },
				)
				.action(({ args }) => void seen.push(args)),
		);
		const exec = defineCommand("exec", (cmd) =>
			cmd
				.args(
					{ name: "image", type: "string" },
					{ name: "command", type: "string", variadic: "passthrough" },
				)
				.flags({ rm: { type: "boolean" } })
				.action(({ args, flags }) => void seen.push({ ...args, ...flags })),
		);
		const app = new Crust("app")
			.extend(nextSteps())
			.add(run, exec)
			.command("suggest", (cmd) =>
				cmd.use(nextSteps).action(async ({ ctx }) => {
					const next = await ctx.nextSteps;
					next.add(run, { args: { task: "build", pkgs: ["core"], extra: ["--watch", "-5"] } });
					next.add(run, { args: { extra: ["--watch"] } });
					next.add(run, { args: { task: "build" } });
					next.add(exec, { args: { image: "alpine", command: ["echo", "hi"] } });
					next.add(exec, {
						args: { image: "alpine", command: ["ls", "--", "-la"] },
						flags: { rm: true },
					});
					// Skipped: tokens before `--` have no escape.
					next.add(run, { args: { task: "-x" } });
				}),
			);

		const { stderr } = await captureExecute(app, ["suggest"]);
		const all = stderr.split("\n").slice(0, -1);
		expect(all.slice(0, 1)).toEqual([
			'nextSteps(): skipped "app run": argument value "-x" starts with "-" before "--"',
		]);
		const lines = all.slice(2);
		expect(lines).toEqual([
			"  app run build core -- --watch -5",
			"  app run -- --watch",
			"  app run build",
			"  app exec alpine echo hi",
			"  app exec --rm alpine ls -- -la",
		]);
		await replay(app, lines);
		expect(seen).toEqual([
			{ task: "build", pkgs: ["core"], extra: ["--watch", "-5"] },
			{ task: undefined, pkgs: [], extra: ["--watch"] },
			{ task: "build", pkgs: [], extra: [] },
			{ image: "alpine", command: ["echo", "hi"], rm: undefined },
			{ image: "alpine", command: ["ls", "--", "-la"], rm: true },
		]);
	});

	it("replays negative zero and skips non-finite numbers, which argv cannot spell", async () => {
		const seen: unknown[] = [];
		const wait = defineCommand("wait", (cmd) =>
			cmd
				.args({ name: "at", type: "number" })
				.flags({ timeout: { type: "number" } })
				.action(({ args, flags }) => void seen.push([args, flags])),
		);
		const app = new Crust("app")
			.extend(nextSteps())
			.add(wait)
			.command("suggest", (cmd) =>
				cmd.use(nextSteps).action(async ({ ctx }) => {
					const next = await ctx.nextSteps;
					next.add(wait, { args: { at: -Infinity } });
					next.add(wait, { flags: { timeout: Number.NaN } });
					next.add(wait, { args: { at: -0 }, flags: { timeout: -0 } });
				}),
			);

		const { stderr } = await captureExecute(app, ["suggest"]);
		const lines = stderr.split("\n").slice(0, -1);
		expect(lines).toEqual([
			'nextSteps(): skipped "app wait": argument "at" value -Infinity has no argv spelling',
			'nextSteps(): skipped "app wait": "--timeout" value NaN has no argv spelling',
			"Next steps:",
			"  app wait --timeout=-0 -- -0",
		]);
		await replay(app, lines.slice(3));
		expect(seen).toEqual([[{ at: -0 }, { timeout: -0 }]]);
	});

	it("skips a number argv would reject for its integer type or min and max", async () => {
		const scale = defineCommand("scale", (cmd) =>
			cmd
				.args({ name: "port", type: "number", min: 1, max: 10 })
				.flags({ jobs: { type: "integer" } })
				.action(() => {}),
		);
		const app = new Crust("app")
			.extend(nextSteps())
			.add(scale)
			.command("suggest", (cmd) =>
				cmd.use(nextSteps).action(async ({ ctx }) => {
					const next = await ctx.nextSteps;
					next.add(scale, { flags: { jobs: 1.5 } });
					next.add(scale, { args: { port: 99 } });
					next.add(scale, { args: { port: 10 }, flags: { jobs: 2 } });
				}),
			);

		const { stderr } = await captureExecute(app, ["suggest"]);
		const lines = stderr.split("\n").slice(0, -1);
		expect(lines).toEqual([
			'nextSteps(): skipped "app scale": Expected an integer for "--jobs".',
			'nextSteps(): skipped "app scale": Expected a number from 1 to 10 for argument "port".',
			"Next steps:",
			"  app scale --jobs 2 10",
		]);
		await replay(app, lines.slice(-1));
	});

	it("spells an exclusive group's value as its member flag, and replays it", async () => {
		const seen: unknown[] = [];
		const scoped = defineCommand("scoped", (cmd) =>
			cmd
				.flags({
					scope: {
						type: "exclusive",
						required: true,
						flags: {
							"org-id": { type: "string" },
							all: { type: "boolean" },
							data: { type: "json" },
						},
					},
				})
				.action(({ flags }) => void seen.push(flags.scope)),
		);
		const app = new Crust("app")
			.extend(nextSteps())
			.add(scoped)
			.command("suggest", (cmd) =>
				cmd.use(nextSteps).action(async ({ ctx }) => {
					const next = await ctx.nextSteps;
					next.add(scoped, { flags: { scope: { flag: "org-id", value: "acme" } } });
					next.add(scoped, { flags: { scope: { flag: "all" } } });
					next.add(scoped, { flags: { scope: { flag: "data", value: null } } });
					next.add(scoped, { flags: { scope: { flag: "org-id" } } });
				}),
			);

		const { stderr } = await captureExecute(app, ["suggest"]);
		const lines = stderr.split("\n").slice(0, -1);
		expect(lines).toEqual([
			'nextSteps(): skipped "app scoped": "--org-id" value is missing',
			"Next steps:",
			"  app scoped --org-id acme",
			"  app scoped --all",
			"  app scoped --data null",
		]);
		await replay(app, lines.slice(2));
		expect(seen).toEqual([
			{ flag: "org-id", value: "acme" },
			{ flag: "all" },
			{ flag: "data", value: null },
		]);
	});

	it("skips json values JSON would change and replays the rest", async () => {
		const seen: unknown[] = [];
		const show = defineCommand("show", (cmd) =>
			cmd.flags({ meta: { type: "json" } }).action(({ flags }) => void seen.push(flags.meta)),
		);
		const app = new Crust("app")
			.extend(nextSteps())
			.add(show)
			.command("suggest", (cmd) =>
				cmd.use(nextSteps).action(async ({ ctx }) => {
					const next = await ctx.nextSteps;
					next.add(show, { flags: { meta: { limit: Infinity } } });
					next.add(show, { flags: { meta: [Number.NaN] } });
					next.add(show, { flags: { meta: { at: -0 } } });
					next.add(show, { flags: { meta: { limit: 5, tags: ["a"] } } });
				}),
			);

		const { stderr } = await captureExecute(app, ["suggest"]);
		const lines = stderr.split("\n").slice(0, -1);
		expect(lines).toEqual([
			'nextSteps(): skipped "app show": "--meta" value has no JSON spelling (Not JSON data)',
			'nextSteps(): skipped "app show": "--meta" value has no JSON spelling (Not JSON data)',
			'nextSteps(): skipped "app show": "--meta" value has no JSON spelling (-0 does not survive JSON)',
			"Next steps:",
			`  app show --meta '{"limit":5,"tags":["a"]}'`,
		]);
		await replay(app, lines.slice(-1));
		expect(seen).toEqual([{ limit: 5, tags: ["a"] }]);
	});

	it("skips a repeatable flag value its delimiter would split or drop", async () => {
		const tag = defineCommand("tag", (cmd) =>
			cmd.flags({ tags: { type: "string", multiple: true, delimiter: "," } }).action(() => {}),
		);
		const app = new Crust("app")
			.extend(nextSteps())
			.add(tag)
			.command("suggest", (cmd) =>
				cmd.use(nextSteps).action(async ({ ctx }) => {
					const next = await ctx.nextSteps;
					next.add(tag, { flags: { tags: ["a,b"] } });
					next.add(tag, { flags: { tags: [""] } });
				}),
			);

		expect((await captureExecute(app, ["suggest"])).stderr).toBe(
			[
				'nextSteps(): skipped "app tag": "--tags" value "a,b" contains its delimiter ","',
				'nextSteps(): skipped "app tag": "--tags" value "" is dropped by its delimiter ","',
				"",
			].join("\n"),
		);
	});

	it("renders omitted prototype-named arguments as omitted", async () => {
		const seen: unknown[] = [];
		const target = defineCommand("target", (cmd) =>
			cmd
				.args({ name: "constructor", type: "string" }, { name: "__proto__", type: "string" })
				.action(({ args }) => void seen.push({ ...args })),
		);
		const app = new Crust("app")
			.extend(nextSteps())
			.add(target)
			.command("suggest", (cmd) =>
				cmd.use(nextSteps).action(async ({ ctx }) => {
					const next = await ctx.nextSteps;
					next.add(target);
					next.add(target, { args: { constructor: "x" } });
				}),
			);

		const { stderr } = await captureExecute(app, ["suggest"]);
		const lines = stderr.split("\n").slice(1, -1);
		expect(lines).toEqual(["  app target", "  app target x"]);
		await replay(app, lines);
		const omitted: unknown = {};
		expect(seen).toEqual([omitted, { constructor: "x" }]);
	});

	it("keeps a completed result when writing to stderr throws", async () => {
		const outcome = await appWith().run(
			["deploy"],
			{ args: { env: "prod" } },
			{
				stderr: () => {
					throw new Error("stderr closed");
				},
			},
		);

		expect(outcome).toMatchObject({ status: "completed", result: { env: "prod" } });
	});

	it("rejects a command that uses nextSteps without extending nextSteps()", async () => {
		// @ts-expect-error -- runtime regression deliberately exercises the preparation check.
		const unextended = new Crust("app").add(deploy);
		const error = await unextended.snapshot().catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(CrustError);
		expect(error).toMatchObject({
			code: "DEFINITION",
			details: { subject: "extension", name: "crust:next-steps", reason: "missing-extension" },
		});
	});
});
